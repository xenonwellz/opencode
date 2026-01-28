import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { GithubKey } from "../../github/keys"
import { Git } from "../../github/git"
import { Global } from "../../global"
import path from "path"
import fs from "fs/promises"
import { $ } from "bun"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

export const GithubRoutes = lazy(() => {
  const log = Log.create({ service: "github" })

  return new Hono()
    .get(
      "/keys",
      describeRoute({
        summary: "List GitHub keys",
        description: "Get a list of all saved GitHub personal access tokens.",
        operationId: "github.keys.list",
        responses: {
          200: {
            description: "List of GitHub keys",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      name: z.string(),
                      type: z.enum(["classic", "fine-grained"]),
                      createdAt: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const keys = await GithubKey.list()
        return c.json(keys.map((k) => ({ id: k.id, name: k.name, type: k.type, createdAt: k.createdAt })))
      },
    )
    .post(
      "/keys",
      describeRoute({
        summary: "Add GitHub key",
        description: "Add a new GitHub personal access token.",
        operationId: "github.keys.create",
        responses: {
          200: {
            description: "Created key",
            content: {
              "application/json": {
                schema: resolver(GithubKey.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string().min(1),
          token: z.string().min(1),
        }),
      ),
      async (c) => {
        const { name, token } = c.req.valid("json")
        const type = token.startsWith("github_pat_") ? "classic" : "fine-grained"
        const id = `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const filepath = path.join(Global.Path.data, "github-keys.json")
        const key = await GithubKey.set(id, { name, token, type })
        return c.json({ ...key, filepath })
      },
    )
    .delete(
      "/keys/:keyID",
      describeRoute({
        summary: "Delete GitHub key",
        description: "Remove a GitHub personal access token.",
        operationId: "github.keys.delete",
        responses: {
          200: {
            description: "Key deleted",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          keyID: z.string(),
        }),
      ),
      async (c) => {
        const { keyID } = c.req.valid("param")
        await GithubKey.remove(keyID)
        return c.json(true)
      },
    )
    .get(
      "/repos",
      describeRoute({
        summary: "List repositories",
        description: "List GitHub repositories accessible with the provided key.",
        operationId: "github.repos.list",
        responses: {
          200: {
            description: "List of repositories",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.number(),
                      name: z.string(),
                      full_name: z.string(),
                      description: z.string().nullable(),
                      private: z.boolean(),
                      default_branch: z.string(),
                      updated_at: z.string().nullable(),
                    }),
                  ),
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
          keyID: z.string(),
          query: z.string().optional(),
          page: z.coerce.number().int().min(1).default(1),
          perPage: z.coerce.number().int().min(1).max(100).default(30),
        }),
      ),
      async (c) => {
        const { keyID, query, page, perPage } = c.req.valid("query")
        const key = await GithubKey.get(keyID)
        if (!key) {
          return c.json({ error: "GitHub key not found" }, { status: 404 })
        }

        const octokit = GithubKey.createOctokit(key.token)
        try {
          let repos: any[] = []

          if (query) {
            // Use search API for filtered results
            const response = await octokit.rest.search.repos({
              q: `${query} in:name is:public,private fork:true`,
              sort: "updated",
              order: "desc",
              per_page: perPage,
              page,
            })
            repos = response.data.items
          } else {
            // Use list API for default view
            const response = await octokit.rest.repos.listForAuthenticatedUser({
              sort: "updated",
              direction: "desc",
              per_page: perPage,
              page,
            })
            repos = response.data
          }

          return c.json(
            repos.map((repo) => ({
              id: repo.id,
              name: repo.name,
              full_name: repo.full_name,
              description: repo.description,
              private: repo.private,
              default_branch: repo.default_branch,
              updated_at: repo.updated_at,
            })),
          )
        } catch (error) {
          log.error("Failed to list repos", { error })
          return c.json({ error: "Failed to fetch repositories" }, { status: 400 })
        }
      },
    )
    .get(
      "/repos/:owner/:repo/branches",
      describeRoute({
        summary: "List branches",
        description: "List branches for a GitHub repository.",
        operationId: "github.repos.branches",
        responses: {
          200: {
            description: "List of branches",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      name: z.string(),
                      protected: z.boolean(),
                    }),
                  ),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          owner: z.string(),
          repo: z.string(),
        }),
      ),
      validator(
        "query",
        z.object({
          keyID: z.string(),
          query: z.string().optional(),
          perPage: z.coerce.number().int().min(1).max(100).default(50),
        }),
      ),
      async (c) => {
        const { owner, repo } = c.req.valid("param")
        const { keyID, query, perPage } = c.req.valid("query")
        const key = await GithubKey.get(keyID)
        if (!key) {
          return c.json({ error: "GitHub key not found" }, { status: 404 })
        }

        const octokit = GithubKey.createOctokit(key.token)
        try {
          const response = await octokit.rest.repos.listBranches({
            owner,
            repo,
            per_page: perPage,
            ...(query ? { protected_only: false } : {}),
          })

          let branches = response.data.map((branch) => ({
            name: branch.name,
            protected: branch.protected,
          }))

          if (query) {
            const q = query.toLowerCase()
            branches = branches.filter((b) => b.name.toLowerCase().includes(q))
          }

          return c.json(branches)
        } catch (error) {
          log.error("Failed to list branches", { error })
          return c.json({ error: "Failed to fetch branches" }, { status: 400 })
        }
      },
    )
    .post(
      "/clone",
      describeRoute({
        summary: "Clone repository",
        description: "Clone a GitHub repository to the workspace directory.",
        operationId: "github.clone",
        responses: {
          200: {
            description: "Clone result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    path: z.string(),
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
          keyID: z.string(),
          owner: z.string(),
          repo: z.string(),
          branch: z.string().optional(),
        }),
      ),
      async (c) => {
        const { keyID, owner, repo, branch } = c.req.valid("json")
        const key = await GithubKey.get(keyID)
        if (!key) {
          return c.json({ error: "GitHub key not found" }, { status: 404 })
        }

        const projectNameKebab = repo
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
        const uniqueStr = Math.random().toString(36).slice(2, 6)
        const folderName = `open-code-${projectNameKebab}-${uniqueStr}`
        const workspaceDir = path.join(Global.Path.home, "opencode-workspaces")
        const targetDir = path.join(workspaceDir, folderName)

        try {
          await fs.mkdir(targetDir, { recursive: true })

          const repoUrl = `https://x-access-token:${key.token}@github.com/${owner}/${repo}.git`
          const cloneArgs: string[] = ["git", "clone", "--depth", "1", repoUrl, targetDir]

          if (branch) {
            cloneArgs.push("--branch", branch)
          }

          const cloneProcess = Bun.spawn({
            cmd: cloneArgs,
            env: {},
            stderr: "pipe",
            stdout: "pipe",
          })
          await cloneProcess.exited

          if (cloneProcess.exitCode !== 0) {
            const stderr = await new Response(cloneProcess.stderr).text()
            log.error("Git clone failed", { stderr, exitCode: cloneProcess.exitCode })
            return c.json({ error: "Failed to clone repository" }, { status: 400 })
          }

          // Create opencode working branch
          try {
            const baseBranch = branch || (await Git.getCurrentBranch(targetDir))
            if (baseBranch) {
              const u1 = Math.random().toString(36).slice(2, 6)
              const u2 = Math.random().toString(36).slice(2, 6)
              const workingBranch = `opencode/${baseBranch}-${u1}-${u2}`
              await Git.checkoutBranch(targetDir, workingBranch, true)
              log.info("Created working branch", { branch: workingBranch, directory: targetDir })
            }
          } catch (e) {
            log.error("Failed to create working branch after clone", { error: e })
            // We don't fail the whole clone if branching fails, but log it
          }

          return c.json({ path: targetDir })
        } catch (error) {
          log.error("Failed to clone repo", { error })
          return c.json({ error: "Failed to clone repository" }, { status: 400 })
        }
      },
    )
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
        description: "Commit and push changes to GitHub using stored token.",
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
          keyID: z.string(),
          directory: z.string(),
          message: z.string().optional(),
          branchName: z.string().optional(),
        }),
      ),
      async (c) => {
        const { keyID, directory, message, branchName } = c.req.valid("json")
        const key = await GithubKey.get(keyID)
        if (!key) {
          return c.json({ error: "GitHub key not found" }, { status: 404 })
        }

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

          const result = await Git.pushWithToken(directory, key.token, targetBranch)
          return c.json(result)
        } catch (error) {
          log.error("Push failed", { error })
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
          keyID: z.string(),
          directory: z.string(),
          title: z.string(),
          body: z.string().optional(),
          baseBranch: z.string(),
          headBranch: z.string().optional(),
        }),
      ),
      async (c) => {
        const { keyID, directory, title, body, baseBranch, headBranch } = c.req.valid("json")
        const key = await GithubKey.get(keyID)
        if (!key) {
          return c.json({ error: "GitHub key not found" }, { status: 404 })
        }

        try {
          const remoteInfo = await Git.getRemoteInfo(directory)
          if (!remoteInfo) {
            return c.json({ error: "Could not get remote info" }, { status: 400 })
          }

          const head = headBranch || (await Git.getCurrentBranch(directory))
          if (!head) {
            return c.json({ error: "Could not determine head branch" }, { status: 400 })
          }

          const octokit = GithubKey.createOctokit(key.token)
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
          log.error("Create PR failed", { error })
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
          keyID: z.string(),
          directory: z.string(),
          headBranch: z.string().optional(),
        }),
      ),
      async (c) => {
        const { keyID, directory, headBranch } = c.req.valid("query")
        const key = await GithubKey.get(keyID)
        if (!key) {
          return c.json({ error: "GitHub key not found" }, { status: 404 })
        }

        try {
          const remoteInfo = await Git.getRemoteInfo(directory)
          if (!remoteInfo) {
            return c.json({ error: "Could not get remote info" }, { status: 400 })
          }

          const head = headBranch || (await Git.getCurrentBranch(directory))
          if (!head) {
            return c.json({ error: "Could not determine head branch" }, { status: 400 })
          }

          const octokit = GithubKey.createOctokit(key.token)
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
          log.error("Get PR failed", { error })
          return c.json({ error: String(error) }, { status: 400 })
        }
      },
    )
})
