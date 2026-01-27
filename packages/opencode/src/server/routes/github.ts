import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { GithubApp } from "../../github/app"
import { Git } from "../../github/git"
import { Global } from "../../global"
import path from "path"
import fs from "fs/promises"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

export const GithubRoutes = lazy(() => {
  const log = Log.create({ service: "github" })

  return new Hono()
    .get(
      "/app/config",
      describeRoute({
        summary: "Get GitHub App config",
        description: "Get the current GitHub App configuration.",
        operationId: "github.app.config.get",
        responses: {
          200: {
            description: "GitHub App config",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      appId: z.number(),
                      slug: z.string(),
                      clientId: z.string(),
                      createdAt: z.number(),
                    })
                    .optional(),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        console.log("[DEBUG] GET /github/app/config")
        const app = await GithubApp.get()
        console.log("[DEBUG] App found:", !!app, app?.appId, app?.slug)
        if (!app) return c.json(undefined)
        return c.json({
          appId: app.appId,
          slug: app.slug,
          clientId: app.clientId,
          createdAt: app.createdAt,
        })
      },
    )
    .post(
      "/app/setup",
      describeRoute({
        summary: "Setup GitHub App",
        description: "Get the GitHub App creation URL.",
        operationId: "github.app.setup",
        responses: {
          200: {
            description: "GitHub App creation URL",
            content: {
              "application/json": {
                schema: resolver(z.object({ url: z.string() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          redirectUrl: z.string().url(),
          organization: z.string().optional(),
        }),
      ),
      async (c) => {
        const { redirectUrl, organization } = c.req.valid("json")
        const url = GithubApp.getCreationUrl(redirectUrl, organization)
        return c.json({ url })
      },
    )
    .get(
      "/app/callback",
      describeRoute({
        summary: "GitHub App callback",
        description: "Handle the callback from GitHub after creating an app.",
        operationId: "github.app.callback",
      }),
      validator("query", z.object({ code: z.string() })),
      async (c) => {
        const { code } = c.req.valid("query")
        console.log("[DEBUG] GitHub App callback received", { codeLength: code.length, codePrefix: code.slice(0, 10) })

        try {
          const app = await GithubApp.exchangeManifestCode(code)
          console.log("[DEBUG] GitHub App setup successful", { appId: app.appId, slug: app.slug })
          return c.redirect("/")
        } catch (error) {
          console.error("[DEBUG] GitHub App setup failed", { error })
          return c.redirect("/?error=github_app_setup_failed")
        }
      },
    )
    .delete(
      "/app/config",
      describeRoute({
        summary: "Delete GitHub App config",
        description: "Remove the GitHub App configuration.",
        operationId: "github.app.config.delete",
      }),
      async (c) => {
        await GithubApp.remove()
        return c.json(true)
      },
    )
    .get(
      "/app/installations",
      describeRoute({
        summary: "List installations",
        description: "List all installations of the GitHub App.",
        operationId: "github.app.installations.list",
      }),
      async (c) => {
        const app = await GithubApp.get()
        const configPath = path.join(Global.Path.data, "github-app.json")
        console.log("[DEBUG] GET /github/app/installations - config path:", configPath, "app found:", !!app)
        if (!app) return c.json([])
        const octokit = GithubApp.createOctokit(app)
        const installations = await octokit.rest.apps.listInstallations()
        console.log("[DEBUG] GET /github/app/installations - count:", installations.data.length)
        return c.json(installations.data)
      },
    )
    .post(
      "/app/installations/:installationId/repos",
      describeRoute({
        summary: "List repositories for an installation",
        description: "List all repositories accessible to a GitHub App installation.",
        operationId: "github.app.installations.repos",
      }),
      validator("param", z.object({ installationId: z.coerce.number() })),
      validator(
        "query",
        z.object({
          query: z.string().optional(),
          page: z.coerce.number().int().min(1).default(1),
          perPage: z.coerce.number().int().min(1).max(100).default(30),
        }),
      ),
      async (c) => {
        const { installationId } = c.req.valid("param")
        const { query, page, perPage } = c.req.valid("query")

        const app = await GithubApp.get()
        if (!app) {
          return c.json({ error: "GitHub App not configured" }, { status: 400 })
        }

        const octokit = GithubApp.createOctokit(app, installationId)

        try {
          let repos: any[] = []

          if (query) {
            const response = await octokit.rest.search.repos({
              q: `${query} in:name is:public,private fork:true`,
              sort: "updated",
              order: "desc",
              per_page: perPage,
              page,
            })
            repos = response.data.items
          } else {
            const response = await octokit.rest.apps.listReposAccessibleToInstallation({
              per_page: perPage,
              page,
            })
            repos = (response.data as any).repositories
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
          log.error("Failed to list repos", { error, installationId })
          return c.json({ error: "Failed to fetch repositories" }, { status: 400 })
        }
      },
    )
    .get(
      "/app/installations/:installationId/repos/:owner/:repo/branches",
      describeRoute({
        summary: "List branches",
        description: "List branches for a GitHub repository.",
        operationId: "github.app.installations.repos.branches",
      }),
      validator(
        "param",
        z.object({
          installationId: z.coerce.number(),
          owner: z.string(),
          repo: z.string(),
        }),
      ),
      validator(
        "query",
        z.object({
          query: z.string().optional(),
          perPage: z.coerce.number().int().min(1).max(100).default(50),
        }),
      ),
      async (c) => {
        const { installationId, owner, repo } = c.req.valid("param")
        const { query, perPage } = c.req.valid("query")

        const app = await GithubApp.get()
        if (!app) {
          return c.json({ error: "GitHub App not configured" }, { status: 400 })
        }

        const octokit = GithubApp.createOctokit(app, installationId)

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
          installationId: z.number(),
          owner: z.string(),
          repo: z.string(),
          branch: z.string().optional(),
        }),
      ),
      async (c) => {
        const { installationId, owner, repo, branch } = c.req.valid("json")

        const app = await GithubApp.get()
        if (!app) {
          return c.json({ error: "GitHub App not configured" }, { status: 400 })
        }

        const octokit = GithubApp.createOctokit(app, installationId)

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

          const { data: installationToken } = await octokit.rest.apps.createInstallationAccessToken({
            installation_id: installationId,
          })

          const repoUrl = `https://x-access-token:${installationToken.token}@github.com/${owner}/${repo}.git`
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
        description: "Commit and push changes to GitHub using GitHub App.",
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
          installationId: z.number(),
          directory: z.string(),
          message: z.string().optional(),
          branchName: z.string().optional(),
        }),
      ),
      async (c) => {
        const { installationId, directory, message, branchName } = c.req.valid("json")

        const app = await GithubApp.get()
        if (!app) {
          return c.json({ error: "GitHub App not configured" }, { status: 400 })
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

          const octokit = GithubApp.createOctokit(app, installationId)
          const { data: installationToken } = await octokit.rest.apps.createInstallationAccessToken({
            installation_id: installationId,
          })

          const result = await Git.pushWithToken(directory, installationToken.token, targetBranch)
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
          installationId: z.number(),
          directory: z.string(),
          title: z.string(),
          body: z.string().optional(),
          baseBranch: z.string(),
          headBranch: z.string().optional(),
        }),
      ),
      async (c) => {
        const { installationId, directory, title, body, baseBranch, headBranch } = c.req.valid("json")

        const app = await GithubApp.get()
        if (!app) {
          return c.json({ error: "GitHub App not configured" }, { status: 400 })
        }

        const octokit = GithubApp.createOctokit(app, installationId)

        try {
          const remoteInfo = await Git.getRemoteInfo(directory)
          if (!remoteInfo) {
            return c.json({ error: "Could not get remote info" }, { status: 400 })
          }

          const head = headBranch || (await Git.getCurrentBranch(directory))
          if (!head) {
            return c.json({ error: "Could not determine head branch" }, { status: 400 })
          }

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
          installationId: z.coerce.number(),
          directory: z.string(),
          headBranch: z.string().optional(),
        }),
      ),
      async (c) => {
        const { installationId, directory, headBranch } = c.req.valid("query")

        const app = await GithubApp.get()
        if (!app) {
          return c.json({ error: "GitHub App not configured" }, { status: 400 })
        }

        const octokit = GithubApp.createOctokit(app, installationId)

        try {
          const remoteInfo = await Git.getRemoteInfo(directory)
          if (!remoteInfo) {
            return c.json({ error: "Could not get remote info" }, { status: 400 })
          }

          const head = headBranch || (await Git.getCurrentBranch(directory))
          if (!head) {
            return c.json({ error: "Could not determine head branch" }, { status: 400 })
          }

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
