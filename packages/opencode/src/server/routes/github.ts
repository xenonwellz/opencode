import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Git } from "../../github/git"
import { lazy } from "../../util/lazy"
import { errors } from "../error"
import { get } from "../../project/providers"
import * as GithubProvider from "../../project/providers/github"
import { getWorkspace } from "../../project/workspace"
import { LLM } from "../../session/llm"
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"

export const GithubRoutes = lazy(() => {
  return new Hono()
    .get(
      "/remote-info",
      describeRoute({
        summary: "Get remote info",
        description: "Get remote URL information for a directory.",
        operationId: "github.remoteInfo",
        responses: {
          200: {
            description: "Remote info",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    url: z.string(),
                    owner: z.string(),
                    repo: z.string(),
                    isHttps: z.boolean(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string(),
        }),
      ),
      async (c) => {
        const { directory } = c.req.valid("query")
        const info = await Git.getRemoteInfo(directory)
        if (!info) {
          return c.json({ error: "Could not get remote info" }, { status: 400 })
        }
        return c.json(info)
      },
    )
    .get(
      "/status",
      describeRoute({
        summary: "Get git status",
        description: "Get current branch and uncommitted changes count.",
        operationId: "github.status",
        responses: {
          200: {
            description: "Git status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    branch: z.string().optional(),
                    changesCount: z.number(),
                    isClean: z.boolean(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string(),
        }),
      ),
      async (c) => {
        const { directory } = c.req.valid("query")
        const branch = await Git.getCurrentBranch(directory)
        const changesCount = await Git.getChangesCount(directory)
        return c.json({
          branch,
          changesCount,
          isClean: changesCount === 0,
        })
      },
    )
    .post(
      "/push",
      describeRoute({
        summary: "Push changes",
        description:
          "Commit and push changes to GitHub. Uses GitHub App token if project was created via provider, otherwise falls back to SSH.",
        operationId: "github.push",
        responses: {
          200: {
            description: "Push result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    branch: z.string(),
                    sha: z.string(),
                    success: z.boolean(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          directory: z.string(),
          message: z.string().optional(),
          branchName: z.string().optional(),
        }),
      ),
      async (c) => {
        const { directory, message, branchName } = c.req.valid("json")

        try {
          const changesCount = await Git.getChangesCount(directory)
          if (changesCount > 0) {
            const commitMessage = message || `OpenCode: Auto-commit ${new Date().toISOString()}`
            await Git.commitChanges(directory, commitMessage)
          }

          const currentBranch = await Git.getCurrentBranch(directory)
          const targetBranch = branchName || currentBranch
          if (!targetBranch) {
            return c.json({ error: "Could not determine branch" }, { status: 400 })
          }

          // Check if project was created with GitHub App provider
          const workspace = await getWorkspace(directory)
          const providerId = workspace?.provider?.id
          const installationId = workspace?.provider?.installationId
          const isGitHubProvider = workspace?.provider?.type === "github"

          if (isGitHubProvider && providerId && installationId) {
            const provider = await get(providerId)
            if (provider) {
              const octokit = GithubProvider.createOctokit(provider, installationId)
              const { data: installationToken } = await octokit.rest.apps.createInstallationAccessToken({
                installation_id: installationId,
              })
              const result = await Git.pushWithToken(directory, installationToken.token, targetBranch)
              return c.json(result)
            }
          }

          // Fall back to SSH
          const result = await Git.push(directory, targetBranch)
          return c.json(result)
        } catch (error) {
          console.error("Push failed", { error })
          return c.json({ error: String(error) }, { status: 400 })
        }
      },
    )
    .post(
      "/pull-requests",
      describeRoute({
        summary: "Create pull request",
        description: "Create a pull request on GitHub.",
        operationId: "github.pullRequests.create",
        responses: {
          200: {
            description: "PR created",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    number: z.number(),
                    url: z.string(),
                    title: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          directory: z.string(),
          title: z.string(),
          body: z.string().optional(),
          baseBranch: z.string(),
          headBranch: z.string().optional(),
        }),
      ),
      async (c) => {
        const { directory, title, body, baseBranch, headBranch } = c.req.valid("json")

        try {
          const remoteInfo = await Git.getRemoteInfo(directory)
          if (!remoteInfo) {
            return c.json({ error: "Could not get remote info" }, { status: 400 })
          }

          const head = headBranch || (await Git.getCurrentBranch(directory))
          if (!head) {
            return c.json({ error: "Could not determine head branch" }, { status: 400 })
          }

          // Check if project was created with GitHub App provider
          const workspace = await getWorkspace(directory)
          const providerId = workspace?.provider?.id
          const installationId = workspace?.provider?.installationId
          const isGitHubProvider = workspace?.provider?.type === "github"

          if (!isGitHubProvider || !providerId || !installationId) {
            return c.json({ error: "Project not created with GitHub App provider" }, { status: 400 })
          }

          const provider = await get(providerId)
          if (!provider) {
            return c.json({ error: "Provider not found" }, { status: 404 })
          }

          const octokit = GithubProvider.createOctokit(provider, installationId)
          const response = await octokit.rest.pulls.create({
            owner: remoteInfo.owner,
            repo: remoteInfo.repo,
            title,
            body: body || "",
            head,
            base: baseBranch,
          })

          return c.json({
            number: response.data.number,
            url: response.data.html_url,
            title: response.data.title,
          })
        } catch (error) {
          console.error("Create PR failed", { error })
          return c.json({ error: String(error) }, { status: 400 })
        }
      },
    )
    .get(
      "/pull-requests",
      describeRoute({
        summary: "Get pull request",
        description: "Get pull request for a branch.",
        operationId: "github.pullRequests.get",
        responses: {
          200: {
            description: "PR info",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      number: z.number(),
                      url: z.string(),
                      title: z.string(),
                      state: z.enum(["open", "closed"]),
                    })
                    .optional(),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string(),
          headBranch: z.string().optional(),
        }),
      ),
      async (c) => {
        const { directory, headBranch } = c.req.valid("query")

        try {
          const remoteInfo = await Git.getRemoteInfo(directory)
          if (!remoteInfo) {
            return c.json({ error: "Could not get remote info" }, { status: 400 })
          }

          const head = headBranch || (await Git.getCurrentBranch(directory))
          if (!head) {
            return c.json({ error: "Could not determine head branch" }, { status: 400 })
          }

          // Check if project was created with GitHub App provider
          const workspace = await getWorkspace(directory)
          const providerId = workspace?.provider?.id
          const installationId = workspace?.provider?.installationId
          const isGitHubProvider = workspace?.provider?.type === "github"

          if (!isGitHubProvider || !providerId || !installationId) {
            return c.json({ error: "Project not created with GitHub App provider" }, { status: 400 })
          }

          const provider = await get(providerId)
          if (!provider) {
            return c.json({ error: "Provider not found" }, { status: 404 })
          }

          const octokit = GithubProvider.createOctokit(provider, installationId)
          const response = await octokit.rest.pulls.list({
            owner: remoteInfo.owner,
            repo: remoteInfo.repo,
            head: `${remoteInfo.owner}:${head}`,
            state: "all",
          })

          const pr = response.data[0]
          if (!pr) {
            return c.json(null)
          }

          return c.json({
            number: pr.number,
            url: pr.html_url,
            title: pr.title,
            state: pr.state as "open" | "closed",
          })
        } catch (error) {
          console.error("Get PR failed", { error })
          return c.json({ error: String(error) }, { status: 400 })
        }
      },
    )
    .get(
      "/diff",
      describeRoute({
        summary: "Get git diff",
        description: "Get git diff between current branch and base branch.",
        operationId: "github.diff",
        responses: {
          200: {
            description: "Git diff",
            content: {
              "application/json": {
                schema: resolver(z.string()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string(),
          base: z.string(),
          head: z.string().optional(),
        }),
      ),
      async (c) => {
        const { directory, base, head } = c.req.valid("query")
        try {
          const diff = await Git.getDiff(directory, base, head)
          return c.json(diff)
        } catch (error) {
          return c.json({ error: String(error) }, { status: 400 })
        }
      },
    )
    .post(
      "/pull-requests/generate-message",
      describeRoute({
        summary: "Generate PR message",
        description: "Generate a PR title and body based on git diffs using an AI model.",
        operationId: "github.pullRequests.generateMessage",
        responses: {
          200: {
            description: "Generated message",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    title: z.string(),
                    body: z.string(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          directory: z.string(),
          baseBranch: z.string(),
          model: z.object({
            providerID: z.string(),
            modelID: z.string(),
          }),
        }),
      ),
      async (c) => {
        const { directory, baseBranch, model: modelKey } = c.req.valid("json")

        try {
          const diff = await Git.getDiff(directory, baseBranch)
          if (!diff.trim()) {
            return c.json({ title: "", body: "No changes detected." })
          }

          const agent = await Agent.get("title") // Use title agent or generic
          const model = await Provider.getModel(modelKey.providerID, modelKey.modelID)

          const prompt = `
            You are a helpful assistant that generates GitHub Pull Request titles and descriptions.
            Based on the following git diff, generate a concise and descriptive PR title and a detailed body.
            
            Return your response in the following format:
            [TITLE]
            Your title here
            [BODY]
            Your body here

            Git diff:
            \`\`\`
            ${diff.slice(0, 10000)}
            \`\`\`
          `

          const stream = await LLM.stream({
            agent: agent || (await Agent.defaultAgent()),
            user: {
              id: "0",
              sessionID: "pr-gen",
              role: "user",
              time: { created: Date.now() },
              agent: "title",
              model: modelKey,
            },
            tools: {},
            model,
            small: true,
            messages: [
              {
                role: "user",
                content: prompt,
              },
            ],
            abort: new AbortController().signal,
            sessionID: "pr-gen",
            system: [],
          })

          const text = await stream.text
          const [titlePart, bodyPart] = text.split("[BODY]")
          const title = titlePart.replace("[TITLE]", "").trim()
          const body = bodyPart ? bodyPart.trim() : ""

          return c.json({
            title: title || "PR: Automated Changes",
            body: body || text,
          })
        } catch (error) {
          console.error("Generate PR message failed", { error })
          return c.json({ error: String(error) }, { status: 400 })
        }
      },
    )
})
