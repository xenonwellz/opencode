import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import z from "zod"
import { Octokit } from "@octokit/rest"

export namespace GithubKey {
  export const Info = z
    .object({
      name: z.string(),
      token: z.string(),
      type: z.enum(["classic", "fine-grained"]),
      createdAt: z.number(),
    })
    .meta({ ref: "GithubKey" })

  export type Info = z.infer<typeof Info>

  const filepath = path.join(Global.Path.data, "github-keys.json")

  export async function get(id: string): Promise<(Info & { id: string }) | undefined> {
    const all = await list()
    return all.find((k) => k.id === id)
  }

  export async function list(): Promise<Array<Info & { id: string }>> {
    const file = Bun.file(filepath)
    const data = await file.json().catch(() => ({}) as Record<string, unknown>)
    return Object.entries(data).reduce(
      (acc, [key, value]) => {
        const parsed = Info.safeParse(value)
        if (parsed.success) {
          acc.push({ ...parsed.data, id: key })
        }
        return acc
      },
      [] as Array<Info & { id: string }>,
    )
  }

  export async function getRawData(): Promise<Record<string, unknown>> {
    const file = Bun.file(filepath)
    return file.json().catch(() => ({}))
  }

  export async function set(id: string, info: Omit<Info, "createdAt">): Promise<Info & { id: string }> {
    const file = Bun.file(filepath)
    const data = await list().then((keys) => {
      const map: Record<string, unknown> = {}
      for (const k of keys) {
        map[k.id] = { name: k.name, token: k.token, type: k.type, createdAt: k.createdAt }
      }
      return map
    })
    const now = Date.now()
    data[id] = { ...info, createdAt: now }
    await Bun.write(file, JSON.stringify(data, null, 2))
    await fs.chmod(file.name!, 0o600)
    return { ...info, id, createdAt: now }
  }

  export async function remove(id: string): Promise<void> {
    const file = Bun.file(filepath)
    const data = await list().then((keys) => {
      const map: Record<string, unknown> = {}
      for (const k of keys) {
        if (k.id !== id) {
          map[k.id] = { name: k.name, token: k.token, type: k.type, createdAt: k.createdAt }
        }
      }
      return map
    })
    await Bun.write(file, JSON.stringify(data, null, 2))
    await fs.chmod(file.name!, 0o600)
  }

  export function createOctokit(token: string): Octokit {
    return new Octokit({ auth: token })
  }
}
