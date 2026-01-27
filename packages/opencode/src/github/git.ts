import { $ } from "bun"
import { Log } from "@/util/log"
import z from "zod"

const log = Log.create({ service: "git" })

export namespace Git {
  export const RemoteInfo = z.object({
    url: z.string(),
    owner: z.string(),
    repo: z.string(),
    isHttps: z.boolean(),
  })
  export type RemoteInfo = z.infer<typeof RemoteInfo>

  export const BranchInfo = z.object({
    name: z.string(),
    isNew: z.boolean(),
  })
  export type BranchInfo = z.infer<typeof BranchInfo>

  export const PushResult = z.object({
    branch: z.string(),
    sha: z.string(),
    success: z.boolean(),
  })
  export type PushResult = z.infer<typeof PushResult>

  /**
   * Get the current branch name for a directory
   */
  export async function getCurrentBranch(directory: string): Promise<string | undefined> {
    const result = await $`git rev-parse --abbrev-ref HEAD`
      .quiet()
      .nothrow()
      .cwd(directory)
      .text()
      .catch(() => undefined)

    if (!result) return undefined
    const branch = result.trim()
    return branch === "HEAD" ? undefined : branch
  }

  /**
   * Check if a branch exists locally
   */
  export async function branchExists(directory: string, branchName: string): Promise<boolean> {
    const result = await $`git rev-parse --verify ${branchName}`.quiet().nothrow().cwd(directory)

    return result.exitCode === 0
  }

  /**
   * Check if a branch exists on remote
   */
  export async function remoteBranchExists(
    directory: string,
    branchName: string,
    remote: string = "origin",
  ): Promise<boolean> {
    const result = await $`git ls-remote --heads ${remote} ${branchName}`
      .quiet()
      .nothrow()
      .cwd(directory)
      .text()
      .catch(() => "")

    return result.trim().length > 0
  }

  /**
   * Create and checkout a new branch, or switch to it if it exists
   */
  export async function checkoutBranch(
    directory: string,
    branchName: string,
    createIfNotExists: boolean = true,
  ): Promise<BranchInfo> {
    const exists = await branchExists(directory, branchName)

    if (exists) {
      const result = await $`git checkout ${branchName}`.quiet().nothrow().cwd(directory)
      if (result.exitCode !== 0) {
        throw new Error(`Failed to checkout branch ${branchName}`)
      }
      log.info("switched to existing branch", { branch: branchName })
      return { name: branchName, isNew: false }
    }

    if (!createIfNotExists) {
      throw new Error(`Branch ${branchName} does not exist`)
    }

    const result = await $`git checkout -b ${branchName}`.quiet().nothrow().cwd(directory)
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create branch ${branchName}`)
    }
    log.info("created and switched to new branch", { branch: branchName })
    return { name: branchName, isNew: true }
  }

  /**
   * Get uncommitted changes count (staged + unstaged)
   */
  export async function getChangesCount(directory: string): Promise<number> {
    const result = await $`git status --porcelain`
      .quiet()
      .nothrow()
      .cwd(directory)
      .text()
      .catch(() => "")

    const lines = result
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
    return lines.length
  }

  /**
   * Stage all changes and create a commit
   */
  export async function commitChanges(directory: string, message: string): Promise<string> {
    // Stage all changes
    const addResult = await $`git add -A`.quiet().nothrow().cwd(directory)
    if (addResult.exitCode !== 0) {
      throw new Error("Failed to stage changes")
    }

    // Check if there are changes to commit
    const statusResult = await $`git status --porcelain`.quiet().nothrow().cwd(directory).text()
    if (statusResult.trim().length === 0) {
      throw new Error("No changes to commit")
    }

    // Create commit
    const commitResult = await $`git commit -m ${message}`.quiet().nothrow().cwd(directory)
    if (commitResult.exitCode !== 0) {
      throw new Error("Failed to create commit")
    }

    // Get commit SHA
    const sha = await $`git rev-parse HEAD`.quiet().nothrow().cwd(directory).text()
    log.info("created commit", { sha: sha.trim(), message })
    return sha.trim()
  }

  /**
   * Parse git remote URL to extract owner and repo
   */
  export function parseRemoteUrl(url: string): RemoteInfo | undefined {
    // HTTPS format: https://github.com/owner/repo.git
    const httpsMatch = url.match(/https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?$/)
    if (httpsMatch) {
      return {
        url,
        owner: httpsMatch[1],
        repo: httpsMatch[2].replace(/\.git$/, ""),
        isHttps: true,
      }
    }

    // SSH format: git@github.com:owner/repo.git
    const sshMatch = url.match(/git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/)
    if (sshMatch) {
      return {
        url,
        owner: sshMatch[1],
        repo: sshMatch[2].replace(/\.git$/, ""),
        isHttps: false,
      }
    }

    return undefined
  }

  /**
   * Get remote URL and parse it
   */
  export async function getRemoteInfo(directory: string, remote: string = "origin"): Promise<RemoteInfo | undefined> {
    const result = await $`git remote get-url ${remote}`
      .quiet()
      .nothrow()
      .cwd(directory)
      .text()
      .catch(() => "")

    const url = result.trim()
    if (!url) return undefined

    return parseRemoteUrl(url)
  }

  /**
   * Build an authenticated HTTPS URL for pushing
   */
  export function buildAuthenticatedUrl(remoteInfo: RemoteInfo, token: string): string {
    // Always use HTTPS for token-based auth
    return `https://x-access-token:${token}@github.com/${remoteInfo.owner}/${remoteInfo.repo}.git`
  }

  /**
   * Push changes to remote using token authentication
   */
  export async function pushWithToken(
    directory: string,
    token: string,
    branchName: string,
    remote: string = "origin",
  ): Promise<PushResult> {
    const remoteInfo = await getRemoteInfo(directory, remote)
    if (!remoteInfo) {
      throw new Error("Could not get remote URL")
    }

    const authUrl = buildAuthenticatedUrl(remoteInfo, token)

    // Push to the authenticated URL
    const pushProcess = Bun.spawn({
      cmd: ["git", "push", authUrl, `${branchName}:${branchName}`, "--set-upstream"],
      cwd: directory,
      env: {},
      stderr: "pipe",
      stdout: "pipe",
    })

    await pushProcess.exited

    if (pushProcess.exitCode !== 0) {
      const stderr = await new Response(pushProcess.stderr).text()
      log.error("push failed", { stderr, exitCode: pushProcess.exitCode })
      throw new Error("Failed to push changes")
    }

    const sha = await $`git rev-parse HEAD`.quiet().nothrow().cwd(directory).text()

    log.info("pushed to remote", { branch: branchName, sha: sha.trim() })
    return {
      branch: branchName,
      sha: sha.trim(),
      success: true,
    }
  }

  /**
   * Push changes to remote using SSH (no token needed)
   */
  export async function push(directory: string, branchName: string, remote: string = "origin"): Promise<PushResult> {
    const result = await $`git push ${remote} ${branchName}:${branchName} --set-upstream`
      .quiet()
      .nothrow()
      .cwd(directory)

    if (result.exitCode !== 0) {
      log.error("push failed", { stderr: result.stderr.toString(), exitCode: result.exitCode })
      throw new Error("Failed to push changes")
    }

    const sha = await $`git rev-parse HEAD`.quiet().nothrow().cwd(directory).text()

    log.info("pushed to remote via ssh", { branch: branchName, sha: sha.trim() })
    return {
      branch: branchName,
      sha: sha.trim(),
      success: true,
    }
  }

  /**
   * Generate a unique branch name for OpenCode
   */
  export function generateBranchName(worktreeName: string, sessionId: string): string {
    const sanitized = worktreeName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30)

    const shortSessionId = sessionId.slice(0, 8)
    return `opencode/${sanitized}/${shortSessionId}`
  }

  /**
   * Get the current commit SHA
   */
  export async function getCurrentSha(directory: string): Promise<string | undefined> {
    const result = await $`git rev-parse HEAD`
      .quiet()
      .nothrow()
      .cwd(directory)
      .text()
      .catch(() => "")

    return result.trim() || undefined
  }

  /**
   * Check if working directory is clean (no uncommitted changes)
   */
  export async function isClean(directory: string): Promise<boolean> {
    const count = await getChangesCount(directory)
    return count === 0
  }
}
