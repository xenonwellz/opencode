import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Log } from "../../../../util/log"
import { lazy } from "../../../../util/lazy"
import { errors } from "../../../error"
import { Global } from "../../../../global"
import path from "path"
import fs from "fs/promises"
import { get, list, add, remove, update } from "../../../../project/providers"
import * as GithubProvider from "../../../../project/providers/github"
import { Git } from "../../../../github/git"

export const GithubProviderRoutes = lazy(() => {
  const log = Log.create({ service: "github-provider" })

  return new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List GitHub providers or create form",
        description: "List providers or return auto-submitting form when ?form is set.",
        operationId: "project.providers.github.list",
        responses: {
          200: {
            description: "List of GitHub providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      type: z.literal("github"),
                      configured: z.literal(true),
                      appId: z.number(),
                      slug: z.string(),
                      clientId: z.string(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const isForm = c.req.query("form")
        const organization = c.req.query("organization")

        if (isForm) {
          const redirectUrl = `${c.req.url.replace(c.req.path, "")}/callback`

          const provider = await add({
            type: "github",
            appId: 0,
            slug: "pending",
            clientId: "",
            clientSecret: "",
            privateKey: "",
          })

          const manifest = GithubProvider.buildManifest(redirectUrl, provider.id)
          const manifestStr = JSON.stringify(manifest)
          const encodedManifest = encodeURIComponent(manifestStr)

          const baseUrl = organization
            ? `https://github.com/organizations/${organization}/settings/apps/new`
            : `https://github.com/settings/apps/new`

          c.header("Content-Type", "text/html")
          return c.html(`
<!DOCTYPE html>
<html>
<head>
  <title>Create GitHub App</title>
</head>
<body>
  <form id="form" action="${baseUrl}" method="post">
    <input type="hidden" name="manifest" value="${encodedManifest}">
  </form>
  <script>document.getElementById('form').submit()</script>
</body>
</html>
          `)
        }

        const providers = await list()
        const githubProviders = providers.filter((p) => p.type === "github")
        return c.json(
          githubProviders.map((p) => ({
            id: p.id,
            type: p.type as "github",
            configured: true,
            appId: p.appId,
            slug: p.slug,
            clientId: p.clientId,
          })),
        )
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create GitHub provider",
        description: "Create a new GitHub provider setup flow.",
        operationId: "project.providers.github.create",
        responses: {
          200: {
            description: "Provider creation URL",
            content: {
              "application/json": {
                schema: resolver(z.object({ url: z.string(), providerId: z.string() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          organization: z.string().optional(),
        }),
      ),
      async (c) => {
        const { organization } = c.req.valid("json")
        const redirectUrl = `${c.req.url.replace(c.req.path, "")}/callback`

        const provider = await add({
          type: "github",
          appId: 0,
          slug: "pending",
          clientId: "",
          clientSecret: "",
          privateKey: "",
        })

        const url = await GithubProvider.getCreationUrl(redirectUrl, provider.id, organization)

        return c.json({ url, providerId: provider.id })
      },
    )
    .get(
      "/callback",
      describeRoute({
        summary: "GitHub provider callback",
        description: "Handle GitHub provider callback and complete setup.",
        operationId: "project.providers.github.callback",
      }),
      validator("query", z.object({ code: z.string(), state: z.string() })),
      async (c) => {
        const { code, state } = c.req.valid("query")

        try {
          const provider = await get(state)
          if (!provider) {
            return c.redirect("/?error=provider_not_found")
          }

          const config = await GithubProvider.exchangeManifestCode(code)

          await update(state, {
            appId: config.appId,
            slug: config.slug,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            privateKey: config.privateKey,
          })

          return c.redirect("/")
        } catch (error) {
          log.error("GitHub provider callback failed", { error })
          return c.redirect("/?error=provider_setup_failed")
        }
      },
    )
    .delete(
      "/:providerId",
      describeRoute({
        summary: "Delete GitHub provider",
        description: "Remove a GitHub provider configuration.",
        operationId: "project.providers.github.delete",
        responses: {
          200: {
            description: "Deletion result",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ providerId: z.string() })),
      async (c) => {
        const { providerId } = c.req.valid("param")
        const result = await remove(providerId)
        return c.json(result)
      },
    )
    .get(
      "/:providerId/installations",
      describeRoute({
        summary: "List installations",
        description: "List GitHub App installations for a provider.",
        operationId: "project.providers.github.installations.list",
        responses: {
          200: {
            description: "List of installations",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.number(),
                      account: z
                        .object({
                          login: z.string(),
                          avatar_url: z.string().optional(),
                          name: z.string().optional(),
                        })
                        .optional(),
                    }),
                  ),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ providerId: z.string() })),
      async (c) => {
        const { providerId } = c.req.valid("param")
        const provider = await get(providerId)
        if (!provider) {
          return c.json({ error: "Provider not found" }, { status: 404 })
        }

        const installations = await GithubProvider.listInstallations(provider)
        return c.json(installations)
      },
    )
    .get(
      "/:providerId/repos",
      describeRoute({
        summary: "List repositories",
        description: "List repositories for a provider installation.",
        operationId: "project.providers.github.repos.list",
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
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ providerId: z.string() })),
      validator(
        "query",
        z.object({
          installationId: z.coerce.number(),
          query: z.string().optional(),
          page: z.coerce.number().int().min(1).default(1),
          perPage: z.coerce.number().int().min(1).max(100).default(30),
        }),
      ),
      async (c) => {
        const { providerId } = c.req.valid("param")
        const { installationId, query, page, perPage } = c.req.valid("query")

        const provider = await get(providerId)
        if (!provider) {
          return c.json({ error: "Provider not found" }, { status: 404 })
        }

        try {
          const repos = await GithubProvider.listRepositories(provider, installationId, query, page, perPage)
          return c.json(repos)
        } catch (error) {
          log.error("Failed to list repos", { error })
          return c.json({ error: "Failed to fetch repositories" }, { status: 400 })
        }
      },
    )
    .get(
      "/:providerId/repos/:owner/:repo/branches",
      describeRoute({
        summary: "List branches",
        description: "List branches for a repository.",
        operationId: "project.providers.github.repos.branches",
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
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          providerId: z.string(),
          owner: z.string(),
          repo: z.string(),
        }),
      ),
      validator(
        "query",
        z.object({
          installationId: z.coerce.number(),
        }),
      ),
      async (c) => {
        const { providerId, owner, repo } = c.req.valid("param")
        const { installationId } = c.req.valid("query")

        const provider = await get(providerId)
        if (!provider) {
          return c.json({ error: "Provider not found" }, { status: 404 })
        }

        try {
          const branches = await GithubProvider.listBranches(provider, installationId, owner, repo)
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
        description: "Clone a repository using a GitHub provider.",
        operationId: "project.providers.github.clone",
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
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          providerId: z.string(),
          installationId: z.number(),
          owner: z.string(),
          repo: z.string(),
          branch: z.string().optional(),
        }),
      ),
      async (c) => {
        const { providerId, installationId, owner, repo, branch } = c.req.valid("json")

        const provider = await get(providerId)
        if (!provider) {
          return c.json({ error: "Provider not found" }, { status: 404 })
        }

        const octokit = GithubProvider.createOctokit(provider, installationId)

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

          const workspaceJson = {
            provider: {
              id: providerId,
              type: "github",
              installationId,
              owner,
              repo,
            },
            createdAt: Date.now(),
          }

          const workspaceJsonPath = path.join(targetDir, "workspace.json")
          await Bun.write(workspaceJsonPath, JSON.stringify(workspaceJson, null, 2))

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
})
