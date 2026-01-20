import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { GithubKey } from "../../github/keys"
import { Global } from "../../global"
import path from "path"
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
          const response = await octokit.rest.repos.listForAuthenticatedUser({
            sort: "updated",
            direction: "desc",
            per_page: perPage,
            page,
            ...(query ? { query } : {}),
          })

          return c.json(
            response.data.map((repo) => ({
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
          await Bun.write(targetDir, "")

          const repoUrl = `https://x-access-token:${key.token}@github.com/${owner}/${repo}.git`
          const cloneArgs: string[] = ["git", "clone", "--bare", repoUrl, targetDir]

          if (branch) {
            cloneArgs.push("--branch", branch, "--single-branch")
          }

          const cloneProcess = Bun.spawn({
            cmd: cloneArgs,
            env: {},
            stderr: "pipe",
            stdout: "pipe",
          })
          await cloneProcess.exited

          return c.json({ path: targetDir })
        } catch (error) {
          log.error("Failed to clone repo", { error })
          return c.json({ error: "Failed to clone repository" }, { status: 400 })
        }
      },
    )
})
