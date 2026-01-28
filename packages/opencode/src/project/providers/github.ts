import { Octokit } from "@octokit/rest"
import { createAppAuth } from "@octokit/auth-app"
import { Provider } from "./index"
import { Log } from "../../util/log"

const log = Log.create({ service: "github-provider-logic" })

export interface Installation {
  id: number
  account: {
    login: string
    avatar_url?: string | null
    name?: string | null
  } | null
  target_type?: string | null
  suspended_at?: string | null
}

export interface Repository {
  id: number
  name: string
  full_name: string
  description: string | null
  private: boolean
  default_branch: string
  updated_at: string | null
}

export interface Branch {
  name: string
  protected: boolean
}

export function createOctokit(provider: Provider, installationId?: number): Octokit {
  const authOptions: any = {
    appId: provider.appId,
    privateKey: provider.privateKey,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
  }

  if (installationId) {
    authOptions.installationId = installationId
  }

  return new Octokit({
    authStrategy: createAppAuth,
    auth: authOptions,
  })
}

export function buildManifest(redirectUrl: string, providerId: string) {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
  return {
    name: `OPENCODE-HOST-${suffix}`,
    description: `OpenCode AI coding assistant`,
    url: redirectUrl,
    redirect_url: redirectUrl,
    callback_urls: [redirectUrl],
    public: false,
    default_permissions: {
      contents: "write",
      pull_requests: "write",
      issues: "write",
      metadata: "read",
    },
    default_events: [],
  }
}


export async function exchangeManifestCode(code: string): Promise<Omit<Provider, "id" | "createdAt">> {
  const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to exchange manifest code: ${error}`)
  }

  const data = await response.json()

  if (!data.id || !data.slug || !data.client_id || !data.client_secret || !data.pem) {
    throw new Error("Invalid GitHub App response: missing required fields")
  }

  return {
    type: "github",
    appId: data.id,
    slug: data.slug,
    clientId: data.client_id,
    clientSecret: data.client_secret,
    privateKey: data.pem,
  }
}

export async function listInstallations(provider: Provider): Promise<Installation[]> {
  const octokit = createOctokit(provider)
  const response = await octokit.rest.apps.listInstallations()
  return response.data.map((inst) => {
    const account = inst.account
    return {
      id: inst.id,
      account: account
        ? {
          login: "login" in account ? account.login || "" : "",
          avatar_url: account.avatar_url ?? undefined,
          name: "name" in account ? (account.name ?? undefined) : undefined,
        }
        : null,
      target_type: inst.target_type ?? undefined,
      suspended_at: inst.suspended_at ?? undefined,
    }
  })
}

export async function getInstallation(provider: Provider, installationId: number): Promise<Installation | undefined> {
  const octokit = createOctokit(provider, installationId)
  try {
    const response = await octokit.rest.apps.getInstallation({ installation_id: installationId })
    const account = response.data.account
    return {
      id: response.data.id,
      account: account
        ? {
          login: "login" in account ? account.login || "" : "",
          avatar_url: account.avatar_url ?? undefined,
          name: "name" in account ? (account.name ?? undefined) : undefined,
        }
        : null,
      target_type: response.data.target_type ?? undefined,
      suspended_at: response.data.suspended_at ?? undefined,
    }
  } catch {
    return undefined
  }
}

export async function listRepositories(
  provider: Provider,
  installationId: number,
  query?: string,
  _page = 1,
  _perPage = 100,
): Promise<Repository[]> {
  const octokit = createOctokit(provider, installationId)

  try {
    const allRepos = await octokit.paginate("GET /installation/repositories", {
      per_page: 100,
    })

    let repos: Repository[] = allRepos.map((r: any) => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      description: r.description,
      private: r.private,
      default_branch: r.default_branch,
      updated_at: r.updated_at,
    }))

    repos.sort((a, b) => {
      const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0
      const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0
      return dateB - dateA
    })

    if (query) {
      const q = query.toLowerCase()
      repos = repos.filter(
        (repo) =>
          repo.name.toLowerCase().includes(q) ||
          repo.full_name.toLowerCase().includes(q)
      )
    }

    return repos.slice(0, 1000)
  } catch (error) {
    log.error("Failed to list repositories via installation", { error, installationId })
    throw error
  }
}

export async function listBranches(
  provider: Provider,
  installationId: number,
  owner: string,
  repo: string,
): Promise<Branch[]> {
  const octokit = createOctokit(provider, installationId)

  try {
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo })
    const defaultBranch = repoData.default_branch

    const branches = await octokit.paginate("GET /repos/{owner}/{repo}/branches", {
      owner,
      repo,
      per_page: 100,
    })

    const mappedBranches = branches.map((branch: any) => ({
      name: branch.name,
      protected: branch.protected,
    }))

    return mappedBranches
      .sort((a, b) => {
        if (a.name === defaultBranch) return -1
        if (b.name === defaultBranch) return 1
        if (a.protected && !b.protected) return -1
        if (!a.protected && b.protected) return 1
        return a.name.localeCompare(b.name)
      })
      .slice(0, 1000)
  } catch (error) {
    log.error("Failed to list branches", { error, owner, repo })
    throw error
  }
}
