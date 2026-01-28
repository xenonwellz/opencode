import path from "path"
import { Global } from "../global"
import fs from "fs/promises"

export interface WorkspaceConfig {
  provider?: {
    id: string
    type: string
    installationId: number
    owner: string
    repo: string
  }
  createdAt: number
}

export interface WorkspacesConfig {
  workspaces: Record<string, WorkspaceConfig>
}

const filepath = path.join(Global.Path.data, "workspaces.json")

export async function readWorkspaces(): Promise<WorkspacesConfig> {
  const file = Bun.file(filepath)
  const data = await file.json().catch(() => undefined)
  if (!data) return { workspaces: {} }
  return data as WorkspacesConfig
}

export async function writeWorkspaces(config: WorkspacesConfig): Promise<void> {
  await Bun.write(filepath, JSON.stringify(config, null, 2))
  await fs.chmod(filepath, 0o600)
}

export async function getWorkspace(directory: string): Promise<WorkspaceConfig | undefined> {
  const config = await readWorkspaces()
  const normalizedDir = path.resolve(directory)
  return config.workspaces[normalizedDir]
}

export async function setWorkspace(directory: string, workspace: WorkspaceConfig): Promise<void> {
  const config = await readWorkspaces()
  const normalizedDir = path.resolve(directory)
  config.workspaces[normalizedDir] = workspace
  await writeWorkspaces(config)
}

export async function removeWorkspace(directory: string): Promise<boolean> {
  const config = await readWorkspaces()
  const normalizedDir = path.resolve(directory)
  if (!config.workspaces[normalizedDir]) return false
  delete config.workspaces[normalizedDir]
  await writeWorkspaces(config)
  return true
}
