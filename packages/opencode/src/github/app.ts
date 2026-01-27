import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import z from "zod"
import { Octokit } from "@octokit/rest"
import { createAppAuth } from "@octokit/auth-app"

export namespace GithubApp {
  export const Config = z
    .object({
      appId: z.number(),
      slug: z.string(),
      clientId: z.string(),
      clientSecret: z.string(),
      privateKey: z.string(),
      createdAt: z.number(),
    })
    .meta({ ref: "GithubAppConfig" })

  export type Config = z.infer<typeof Config>

  const filepath = path.join(Global.Path.data, "github-app.json")

  export async function get(): Promise<Config | undefined> {
    const file = Bun.file(filepath)
    const data = await file.json().catch(() => undefined)
    if (!data) return undefined
    const parsed = Config.safeParse(data)
    return parsed.success ? parsed.data : undefined
  }

  export async function set(config: Omit<Config, "createdAt">): Promise<Config> {
    const now = Date.now()
    const data: Config = { ...config, createdAt: now }
    await Bun.write(filepath, JSON.stringify(data, null, 2))
    await fs.chmod(filepath, 0o600)
    return data
  }

  export async function remove(): Promise<void> {
    try {
      await fs.unlink(filepath)
    } catch (e) {
      // Ignore if not exists
    }
  }

  export function getCreationUrl(redirectUrl: string, organization?: string) {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
    const manifest = {
      name: `opencode-host-${suffix}`,
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

    const encodedManifest = encodeURIComponent(JSON.stringify(manifest))

    if (organization) {
      return `https://github.com/organizations/${organization}/settings/apps/new?manifest=${encodedManifest}`
    }

    return `https://github.com/settings/apps/new?manifest=${encodedManifest}`
  }

  export async function exchangeManifestCode(code: string): Promise<Config> {
    console.log("[DEBUG] Exchanging manifest code", { codeLength: code.length, codePrefix: code.slice(0, 10) })

    const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
      },
    })

    console.log("[DEBUG] GitHub manifest API response", { status: response.status, ok: response.ok })

    if (!response.ok) {
      const error = await response.text()
      console.error("[DEBUG] GitHub manifest API failed", { status: response.status, error })
      throw new Error(`Failed to exchange manifest code: ${error}`)
    }

    const data = await response.json()
    console.log("[DEBUG] Raw GitHub API response", {
      hasId: !!data.id,
      hasSlug: !!data.slug,
      hasClientId: !!data.client_id,
      hasClientSecret: !!data.client_secret,
      hasPem: !!data.pem,
      keys: Object.keys(data),
    })

    if (!data.id || !data.slug || !data.client_id || !data.client_secret || !data.pem) {
      console.error("[DEBUG] Invalid GitHub App response", { data })
      throw new Error("Invalid GitHub App response: missing required fields")
    }

    console.log("[DEBUG] GitHub manifest conversion successful", {
      appId: data.id,
      slug: data.slug,
      clientId: data.client_id,
      hasPem: !!data.pem,
    })

    const config = await set({
      appId: data.id,
      slug: data.slug,
      clientId: data.client_id,
      clientSecret: data.client_secret,
      privateKey: data.pem,
    })

    console.log("[DEBUG] GitHub App config saved", {
      appId: config.appId,
      slug: config.slug,
      clientId: config.clientId,
    })
    return config
  }

  export function createOctokit(config: Config, installationId?: number): Octokit {
    const authOptions: any = {
      appId: config.appId,
      privateKey: config.privateKey,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    }

    if (installationId) {
      authOptions.installationId = installationId
    }

    return new Octokit({
      authStrategy: createAppAuth,
      auth: authOptions,
    })
  }
}
