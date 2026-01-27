import path from "path"
import fs from "fs/promises"
import { Global } from "../../global"
import z from "zod"

export const Provider = z
  .object({
    id: z.string(),
    type: z.literal("github"),
    appId: z.number(),
    slug: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
    privateKey: z.string(),
    createdAt: z.number(),
  })
  .meta({ ref: "Provider" })

export type Provider = z.infer<typeof Provider>

export const ProvidersConfig = z
  .object({
    providers: z.array(Provider),
  })
  .meta({ ref: "ProvidersConfig" })

export type ProvidersConfig = z.infer<typeof ProvidersConfig>

const filepath = path.join(Global.Path.data, "providers.json")

function getId(type: "github", existingIds: Set<string>): string {
  const prefix = type === "github" ? "gh" : type
  let id: string
  do {
    const suffix = Math.random().toString(36).slice(2, 8)
    id = `${prefix}_${suffix}`
  } while (existingIds.has(id))
  return id
}

export async function read(): Promise<ProvidersConfig> {
  const file = Bun.file(filepath)
  const data = await file.json().catch(() => undefined)
  if (!data) return { providers: [] }
  const parsed = ProvidersConfig.safeParse(data)
  return parsed.success ? parsed.data : { providers: [] }
}

export async function write(config: ProvidersConfig): Promise<void> {
  await Bun.write(filepath, JSON.stringify(config, null, 2))
  await fs.chmod(filepath, 0o600)
}

export async function list(): Promise<Provider[]> {
  const config = await read()
  return config.providers
}

export async function get(providerId: string): Promise<Provider | undefined> {
  const config = await read()
  return config.providers.find((p) => p.id === providerId)
}

export async function add(provider: Omit<Provider, "id" | "createdAt">): Promise<Provider> {
  const config = await read()
  const existingIds = new Set(config.providers.map((p) => p.id))
  const id = getId(provider.type, existingIds)
  const now = Date.now()
  const newProvider: Provider = {
    ...provider,
    id,
    createdAt: now,
  }
  config.providers.push(newProvider)
  await write(config)
  return newProvider
}

export async function remove(providerId: string): Promise<boolean> {
  const config = await read()
  const index = config.providers.findIndex((p) => p.id === providerId)
  if (index === -1) return false
  config.providers.splice(index, 1)
  await write(config)
  return true
}

export async function update(
  providerId: string,
  updates: Partial<Omit<Provider, "id" | "type" | "createdAt">>,
): Promise<Provider | undefined> {
  const config = await read()
  const provider = config.providers.find((p) => p.id === providerId)
  if (!provider) return undefined
  Object.assign(provider, updates)
  await write(config)
  return provider
}
