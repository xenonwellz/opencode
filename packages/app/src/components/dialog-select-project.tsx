import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { List } from "@opencode-ai/ui/list"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { Show, createMemo, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"

// ============================================================================
// Types
// ============================================================================

type ProviderType = "local" | "github" | "add_github"

interface ProviderItem {
    type: ProviderType
    id: string
    name: string
    description?: string
}

interface BackItem {
    id: "__back__"
    name: string
    type: "back"
}

interface DefaultBranchItem {
    id: "__default__"
    name: string
    type: "default"
    defaultBranch: string
}

interface Branch {
    name: string
    protected: boolean
    id?: string
}

interface Repo {
    id: number
    name: string
    full_name: string
    description: string | null
    private: boolean
    default_branch: string
    updated_at: string | null
}

interface ProviderTypeItem {
    id: string
    name: string
    icon: string
}

const providerTypes: ProviderTypeItem[] = [
    {
        id: "github",
        name: "GitHub",
        icon: "github",
    },
]

// ============================================================================
// DialogSelectProjectProvider
// ============================================================================

export function DialogSelectProjectProvider(props: { multiple?: boolean; onSelect: (path: string) => void }) {
    const dialog = useDialog()
    const globalSDK = useGlobalSDK()
    const language = useLanguage()

    const [store, setStore] = createStore({
        loading: false,
        githubKeys: [] as Array<{ id: string; name: string; type: string; createdAt: number }>,
    })

    onMount(loadGithubKeys)

    const items = createMemo<ProviderItem[]>(() => {
        const result: ProviderItem[] = [
            {
                type: "local",
                id: "local",
                name: language.t("dialog.project.provider.local.name"),
                description: language.t("dialog.project.provider.local.description"),
            },
        ]
        for (const key of store.githubKeys) {
            if (!key.id || !key.name) continue
            result.push({
                type: "github",
                id: key.id,
                name: key.name,
                description: language.t("dialog.project.provider.github.description", {
                    type: key.type || "classic",
                }),
            })
        }
        return result
    })

    const addGithubItem = createMemo<ProviderItem>(() => ({
        type: "add_github",
        id: "add_github",
        name: language.t("dialog.project.provider.add.name"),
        description: language.t("dialog.project.provider.add.description"),
    }))

    const allItems = createMemo<ProviderItem[]>(() => [...items(), addGithubItem()])

    async function loadGithubKeys() {
        setStore("loading", true)
        try {
            const response = await globalSDK.client.github.keys.list()
            setStore(
                "githubKeys",
                response.data?.map((key) => ({
                    id: key.id,
                    name: key.name,
                    type: key.type,
                    createdAt: key.createdAt,
                })) ?? [],
            )
        } catch (e) {
            console.error("Failed to load GitHub keys", e)
        } finally {
            setStore("loading", false)
        }
    }

    async function handleDeleteKey(e: Event, keyId: string, keyName: string) {
        e.stopPropagation()
        dialog.show(
            () => (
                <Dialog
                    title={language.t("dialog.project.delete.title")}
                    description={language.t("dialog.project.delete.description", { name: keyName })}
                    class="min-h-0"
                >
                    <div class="flex justify-end gap-2 px-6 pt-2 pb-4">
                        <Button
                            variant="secondary"
                            size="large"
                            onClick={() => {
                                dialog.close()
                                dialog.show(() => (
                                    <DialogSelectProjectProvider multiple={props.multiple} onSelect={props.onSelect} />
                                ))
                            }}
                        >
                            {language.t("common.cancel")}
                        </Button>
                        <Button
                            variant="secondary"
                            size="large"
                            class="text-text-critical-base hover:bg-surface-critical-base"
                            onClick={async () => {
                                dialog.close()
                                await performDelete(keyId, keyName)
                            }}
                        >
                            {language.t("common.delete")}
                        </Button>
                    </div>
                </Dialog>
            ),
            undefined,
        )
    }

    async function performDelete(keyId: string, keyName: string) {
        try {
            await globalSDK.client.github.keys.delete({ keyID: keyId })
            setStore("githubKeys", (prev) => prev.filter((k) => k.id !== keyId))
            showToast({
                variant: "success",
                icon: "circle-check",
                title: language.t("dialog.project.delete.success.title"),
                description: language.t("dialog.project.delete.success.description", { name: keyName }),
            })
            dialog.show(() => (
                <DialogSelectProjectProvider
                    multiple={props.multiple}
                    onSelect={(path: string) => {
                        dialog.close()
                        props.onSelect(path)
                    }}
                />
            ))
        } catch (e) {
            showToast({
                variant: "error",
                icon: "circle-x",
                title: language.t("dialog.project.delete.error.title"),
                description: String(e),
            })
            dialog.show(() => (
                <DialogSelectProjectProvider
                    multiple={props.multiple}
                    onSelect={(path: string) => {
                        dialog.close()
                        props.onSelect(path)
                    }}
                />
            ))
        }
    }

    function handleSelect(provider: ProviderItem) {
        if (provider.type === "local") {
            dialog.show(() => (
                <DialogSelectDirectory
                    multiple={props.multiple}
                    onSelect={(result) => {
                        dialog.close()
                        if (result && !Array.isArray(result)) {
                            props.onSelect(result)
                        } else if (Array.isArray(result) && result.length > 0) {
                            props.onSelect(result[0])
                        }
                    }}
                />
            ))
        } else if (provider.type === "add_github") {
            dialog.show(
                () => (
                    <DialogSelectProjectProviderType
                        onBack={() => {
                            dialog.close()
                            dialog.show(() => (
                                <DialogSelectProjectProvider multiple={props.multiple} onSelect={props.onSelect} />
                            ))
                        }}
                    />
                ),
                undefined,
            )
        } else {
            dialog.show(() => (
                <DialogSelectGithubRepo
                    keyID={provider.id}
                    keyName={provider.name}
                    onSelect={(path) => {
                        dialog.close()
                        props.onSelect(path)
                    }}
                />
            ))
        }
    }

    return (
        <Dialog
            title={language.t("dialog.project.open.title")}
            description={language.t("dialog.project.open.description")}
        >
            <div class="flex flex-col gap-4 pb-4">
                <div class="max-h-[400px] overflow-y-auto">
                    <List
                        search={{ placeholder: language.t("dialog.project.search.placeholder"), autofocus: true }}
                        emptyMessage={language.t("dialog.project.empty")}
                        items={allItems}
                        key={(x) => x.id}
                        onSelect={(provider) => {
                            if (provider) handleSelect(provider)
                        }}
                    >
                        {(item) => (
                            <div class="w-full flex items-center justify-between rounded-md group">
                                <div class="flex items-center gap-x-3 grow min-w-0">
                                    <Icon
                                        name={
                                            item.type === "local"
                                                ? "folder"
                                                : item.type === "add_github"
                                                  ? "plus-small"
                                                  : "github"
                                        }
                                        class="shrink-0 size-4 text-text-weak"
                                    />
                                    <div class="flex flex-col items-start text-left min-w-0">
                                        <span class="text-14-regular text-text-strong truncate">{item.name}</span>
                                        <Show when={item.description}>
                                            <span class="text-12-regular text-text-weak truncate">
                                                {item.description}
                                            </span>
                                        </Show>
                                    </div>
                                </div>
                                <Show when={item.type === "github"}>
                                    <button
                                        onClick={(e) => handleDeleteKey(e, item.id, item.name)}
                                        class="p-1 rounded transition-colors hover:bg-surface-critical-base"
                                        title={language.t("dialog.project.delete.title")}
                                    >
                                        <Icon name="trash" class="size-4 text-text-weak hover:text-text-critical-base" />
                                    </button>
                                </Show>
                            </div>
                        )}
                    </List>
                </div>
            </div>
        </Dialog>
    )
}


// ============================================================================
// DialogSelectProjectProviderType
// ============================================================================

type ProviderTypeListItem = BackItem | ProviderTypeItem

function DialogSelectProjectProviderType(props: { onBack: () => void }) {
    const dialog = useDialog()
    const language = useLanguage()

    function handleSelect(item: ProviderTypeListItem) {
        if ("type" in item && item.type === "back") {
            props.onBack()
            return
        }
        if (item.id === "github") {
            dialog.show(() => (
                <DialogAddGithubKey
                    onComplete={() => {
                        dialog.close()
                        props.onBack()
                    }}
                    onBack={() => {
                        dialog.show(() => <DialogSelectProjectProviderType onBack={props.onBack} />)
                    }}
                />
            ))
        }
    }

    const items = createMemo<ProviderTypeListItem[]>(() => [
        { id: "__back__", name: language.t("dialog.directory.back"), type: "back" as const },
        ...providerTypes,
    ])

    return (
        <Dialog
            title={language.t("dialog.project.select_provider.title")}
            description={language.t("dialog.project.select_provider.description")}
        >
            <List
                search={{ placeholder: language.t("dialog.project.search.placeholder"), autofocus: true }}
                items={items}
                key={(x) => x.id}
                onSelect={(item) => {
                    if (!item) return
                    handleSelect(item as ProviderTypeListItem)
                }}
            >
                {(item) => (
                    <div class="w-full flex items-center gap-x-3">
                        <Icon
                            name={
                                "type" in item && item.type === "back"
                                    ? "arrow-left"
                                    : ((item as ProviderTypeItem).icon as any)
                            }
                            class="shrink-0 size-4 text-text-weak"
                        />
                        <span>{item.name}</span>
                    </div>
                )}
            </List>
        </Dialog>
    )
}


// ============================================================================
// DialogAddGithubKey
// ============================================================================

function DialogAddGithubKey(props: { onComplete?: () => void; onBack?: () => void }) {
    const globalSDK = useGlobalSDK()
    const language = useLanguage()

    const [store, setStore] = createStore({
        name: "",
        token: "",
        loading: false,
        error: undefined as string | undefined,
    })

    function isTokenError(error: string): boolean {
        const lower = error.toLowerCase()
        return (
            lower.includes("401") ||
            lower.includes("unauthorized") ||
            lower.includes("bad credentials") ||
            lower.includes("invalid token") ||
            lower.includes("authentication")
        )
    }

    async function handleSubmit(e: SubmitEvent) {
        e.preventDefault()

        if (!store.name.trim()) {
            setStore("error", language.t("dialog.project.add_github.error.name_required"))
            return
        }

        if (!store.token.trim()) {
            setStore("error", language.t("dialog.project.add_github.error.token_required"))
            return
        }

        setStore("loading", true)
        setStore("error", undefined)

        try {
            // @ts-ignore - SDK will be regenerated
            await globalSDK.client.github.keys.create({
                name: store.name,
                token: store.token,
            })

            showToast({
                variant: "success",
                icon: "circle-check",
                title: language.t("dialog.project.add_github.success.title"),
                description: language.t("dialog.project.add_github.success.description"),
            })

            props.onComplete?.()
        } catch (e) {
            const errorMsg = String(e)
            if (isTokenError(errorMsg)) {
                setStore("error", language.t("dialog.project.add_github.error.invalid_token"))
            } else {
                setStore("error", errorMsg)
            }
        } finally {
            setStore("loading", false)
        }
    }

    function handleBack() {
        props.onBack?.()
    }

    return (
        <Dialog
            title={language.t("dialog.project.add_github.title")}
            description={language.t("dialog.project.add_github.description")}
        >
            <form onSubmit={handleSubmit} class="flex flex-col gap-6 p-6 pt-0">
                <div class="flex flex-col gap-4">
                    <div class="text-14-regular text-text-weak">
                        <a href="https://github.com/settings/tokens" target="_blank" class="underline">
                            {language.t("dialog.project.add_github.create_token")}
                        </a>
                        . {language.t("dialog.project.add_github.token_instruction")}
                    </div>
                </div>

                <TextField
                    label={language.t("dialog.project.add_github.name.label")}
                    placeholder={language.t("dialog.project.add_github.name.placeholder")}
                    value={store.name}
                    onChange={setStore.bind(null, "name")}
                    validationState={store.error && !store.name ? "invalid" : undefined}
                    error={store.error && !store.name ? language.t("dialog.project.add_github.error.name_required") : undefined}
                />

                <TextField
                    label={language.t("dialog.project.add_github.token.label")}
                    type="password"
                    placeholder={language.t("dialog.project.add_github.token.placeholder")}
                    value={store.token}
                    onChange={setStore.bind(null, "token")}
                    validationState={store.error && !store.token ? "invalid" : undefined}
                    error={store.error && !store.token ? language.t("dialog.project.add_github.error.token_required") : undefined}
                />

                <Show when={store.error && store.name && store.token}>
                    <div class="flex items-start gap-2 p-3 bg-surface-critical-base rounded-md border border-border-critical-base">
                        <Icon name="circle-x" class="shrink-0 size-4 text-icon-critical-base mt-0.5" />
                        <span class="text-14-regular text-text-critical-base">{store.error}</span>
                    </div>
                </Show>

                <div class="flex justify-end gap-2">
                    <Button type="button" variant="secondary" size="large" onClick={handleBack}>
                        {language.t("common.back")}
                    </Button>
                    <Button type="submit" variant="primary" size="large" disabled={store.loading}>
                        <Show when={store.loading} fallback={language.t("dialog.project.add_github.button.add")}>
                            <div class="flex items-center gap-2">
                                <div class="size-4 animate-spin border-2 border-text-strong border-t-transparent rounded-full" />
                                {language.t("dialog.project.add_github.button.adding")}
                            </div>
                        </Show>
                    </Button>
                </div>
            </form>
        </Dialog>
    )
}


// ============================================================================
// DialogSelectDirectory
// ============================================================================

interface DialogSelectDirectoryProps {
    title?: string
    multiple?: boolean
    onSelect: (result: string | string[] | null) => void
}

export function DialogSelectDirectory(props: DialogSelectDirectoryProps) {
    const sync = useGlobalSync()
    const sdk = useGlobalSDK()
    const dialog = useDialog()
    const language = useLanguage()

    const home = createMemo(() => sync.data.path.home)
    const root = createMemo(() => sync.data.path.home || sync.data.path.directory)

    function join(base: string | undefined, rel: string) {
        const b = (base ?? "").replace(/[\\/]+$/, "")
        const r = rel.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "")
        if (!b) return r
        if (!r) return b
        return b + "/" + r
    }

    function display(rel: string) {
        const full = join(root(), rel)
        const h = home()
        if (!h) return full
        if (full === h) return "~"
        if (full.startsWith(h + "/") || full.startsWith(h + "\\")) {
            return "~" + full.slice(h.length)
        }
        return full
    }

    function normalizeQuery(query: string) {
        const h = home()

        if (!query) return query
        if (query.startsWith("~/")) return query.slice(2)

        if (h) {
            const lc = query.toLowerCase()
            const hc = h.toLowerCase()
            if (lc === hc || lc.startsWith(hc + "/") || lc.startsWith(hc + "\\")) {
                return query.slice(h.length).replace(/^[\\/]+/, "")
            }
        }

        return query
    }

    async function fetchDirs(query: string) {
        const directory = root()
        if (!directory) return [] as string[]

        const results = await sdk.client.find
            .files({ directory, query, type: "directory", limit: 50 })
            .then((x) => x.data ?? [])
            .catch(() => [])

        return results.map((x) => x.replace(/[\\/]+$/, ""))
    }

    const directories = async (filter: string) => {
        const query = normalizeQuery(filter.trim())
        return fetchDirs(query)
    }

    function resolve(rel: string) {
        const absolute = join(root(), rel)
        props.onSelect(props.multiple ? [absolute] : absolute)
        dialog.close()
    }

    function handleGoBack() {
        dialog.show(() => (
            <DialogSelectProjectProvider
                multiple={props.multiple}
                onSelect={(path: string) => {
                    dialog.close()
                    props.onSelect(path)
                }}
            />
        ))
    }

    type DirectoryListItem = BackItem | string

    async function directoriesWithBack(filter: string): Promise<DirectoryListItem[]> {
        const backItem: BackItem = { id: "__back__", name: language.t("dialog.directory.back"), type: "back" }
        const dirs = await directories(filter)
        return [backItem, ...dirs]
    }

    return (
        <Dialog title={props.title ?? language.t("dialog.project.open.title")}>
            <List
                search={{ placeholder: language.t("dialog.directory.search.placeholder"), autofocus: true }}
                emptyMessage={language.t("dialog.directory.empty")}
                items={directoriesWithBack}
                key={(x) => (x as BackItem).id ?? (x as string)}
                onSelect={(item) => {
                    if (!item) return
                    const backItem = item as BackItem
                    if (backItem.id === "__back__") {
                        handleGoBack()
                        return
                    }
                    resolve(item as string)
                }}
            >
                {(item) => {
                    const backItem = item as BackItem
                    if (backItem.id === "__back__") {
                        return (
                            <div class="w-full flex items-center justify-between rounded-md">
                                <div class="flex items-center gap-x-3 grow min-w-0">
                                    <Icon name="arrow-left" class="shrink-0 size-4 text-text-weak" />
                                    <div class="flex flex-col items-start text-left min-w-0">
                                        <span class="text-14-regular text-text-strong truncate">{backItem.name}</span>
                                    </div>
                                </div>
                            </div>
                        )
                    }
                    const rel = item as string
                    const path = display(rel)
                    return (
                        <div class="w-full flex items-center justify-between rounded-md">
                            <div class="flex items-center gap-x-3 grow min-w-0">
                                <FileIcon node={{ path: rel, type: "directory" }} class="shrink-0 size-4" />
                                <div class="flex items-center text-14-regular min-w-0">
                                    <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                                        {getDirectory(path)}
                                    </span>
                                    <span class="text-text-strong whitespace-nowrap">{getFilename(path)}</span>
                                </div>
                            </div>
                        </div>
                    )
                }}
            </List>
        </Dialog>
    )
}


// ============================================================================
// DialogSelectGithubRepo
// ============================================================================

type RepoListItem = BackItem | Repo

function DialogSelectGithubRepo(props: { keyID: string; keyName: string; onSelect: (path: string) => void }) {
    const dialog = useDialog()
    const globalSDK = useGlobalSDK()
    const language = useLanguage()

    const [store, setStore] = createStore({
        repos: [] as Repo[],
        loading: true,
        loadingMore: false,
        error: undefined as string | undefined,
        page: 1,
        hasMore: true,
        query: "",
    })

    async function loadRepos(reset = false) {
        if (reset) {
            setStore({ repos: [], page: 1, hasMore: true })
        }

        if (!store.hasMore) return

        setStore(reset ? "loading" : "loadingMore", true)
        setStore("error", undefined)

        try {
            // @ts-ignore - SDK will be regenerated
            const response = await globalSDK.client.github.repos.list({
                keyID: props.keyID,
                query: store.query || undefined,
                page: store.page,
                perPage: 30,
            })

            const repos = (response.data as Array<Repo>) ?? []
            setStore("repos", (prev) => (reset ? repos : [...prev, ...repos]))
            setStore("hasMore", repos.length === 30)
            setStore("page", (prev) => prev + 1)
        } catch (e) {
            setStore("error", String(e))
        } finally {
            setStore("loading", false)
            setStore("loadingMore", false)
        }
    }

    onMount(() => {
        loadRepos(true)
    })

    function handleSelectRepo(repo: Repo) {
        dialog.show(() => (
            <DialogSelectGithubBranch
                keyID={props.keyID}
                keyName={props.keyName}
                owner={repo.full_name.split("/")[0]}
                repo={repo.name}
                defaultBranch={repo.default_branch}
                onSelect={async (branch) => {
                    dialog.show(() => (
                        <DialogCloning repo={repo} branch={branch} keyID={props.keyID} onSelect={props.onSelect} />
                    ))
                    await handleClone(repo, branch)
                }}
                onBack={() => {
                    dialog.show(() => (
                        <DialogSelectGithubRepo keyID={props.keyID} keyName={props.keyName} onSelect={props.onSelect} />
                    ))
                }}
            />
        ))
    }

    async function handleClone(repo: Repo, branch?: string) {
        try {
            // @ts-ignore - SDK will be regenerated
            const response = await globalSDK.client.github.clone({
                keyID: props.keyID,
                owner: repo.full_name.split("/")[0],
                repo: repo.name,
                branch,
            })

            if (response.data?.path) {
                showToast({
                    variant: "success",
                    icon: "circle-check",
                    title: language.t("dialog.project.clone.success.title"),
                    description: language.t("dialog.project.clone.success.description", { name: repo.full_name }),
                })
                dialog.close()
                props.onSelect(response.data.path)
            }
        } catch (e) {
            showToast({
                variant: "error",
                icon: "circle-x",
                title: language.t("dialog.project.clone.error.title"),
                description: String(e),
            })
            dialog.show(() => <DialogSelectProjectProvider multiple={false} onSelect={props.onSelect} />)
        }
    }

    const computedItems = createMemo<RepoListItem[]>(() => {
        const repos: RepoListItem[] = store.repos.map((r) => ({ ...r, type: "repo" as const }))
        const backItem: BackItem = { id: "__back__", name: language.t("dialog.directory.back"), type: "back" }
        return [backItem, ...repos]
    })

    return (
        <Dialog
            title={language.t("dialog.project.select_repo.title")}
            description={language.t("dialog.project.select_repo.description", { name: props.keyName })}
        >
            <List
                search={{ placeholder: language.t("dialog.project.select_repo.search.placeholder"), autofocus: true }}
                emptyMessage={language.t("dialog.project.select_repo.empty")}
                items={computedItems}
                key={(x) => (typeof x.id === "number" ? x.id.toString() : x.id)}
                onSelect={(item) => {
                    if (!item) return
                    const backItem = item as BackItem
                    if (backItem.id === "__back__") {
                        dialog.show(() => (
                            <DialogSelectProjectProvider
                                multiple={false}
                                onSelect={(path: string) => {
                                    dialog.close()
                                    props.onSelect(path)
                                }}
                            />
                        ))
                        return
                    }
                    handleSelectRepo(item as Repo)
                }}
            >
                {(item) => (
                    <div class="w-full flex items-center justify-between rounded-md">
                        <div class="flex items-center gap-x-3 grow min-w-0">
                            <Icon
                                name={(item as BackItem).id === "__back__" ? "arrow-left" : "github"}
                                class="shrink-0 size-4 text-text-weak"
                            />
                            <div class="flex flex-col items-start text-left min-w-0">
                                <Show
                                    when={(item as BackItem).id === "__back__"}
                                    fallback={
                                        <div class="flex items-start text-left min-w-0 gap-2">
                                            <span class="text-14-regular text-text-weak truncate">
                                                {(item as Repo).full_name.split("/").slice(0, -1).join("/")}
                                            </span>
                                            <span class="text-14-regular text-text-weak truncate">/</span>
                                            <span class="text-14-regular text-text-strong truncate">
                                                {(item as Repo).name}
                                            </span>
                                        </div>
                                    }
                                >
                                    <span class="text-14-regular text-text-strong truncate">{(item as Repo).name}</span>
                                </Show>
                                {"description" in item && (item as Repo).description ? (
                                    <span class="text-12-regular text-text-weak truncate max-w-[300px]">
                                        {(item as Repo).description}
                                    </span>
                                ) : (
                                    "description" in item && (
                                        <span class="text-12-regular text-text-weak truncate max-w-[300px] italic opacity-50">
                                            {language.t("dialog.project.select_repo.no_description")}
                                        </span>
                                    )
                                )}
                            </div>
                        </div>
                        {"full_name" in item && <Icon name="chevron-right" class="size-4 text-text-weak" />}
                    </div>
                )}
            </List>

            <Show when={store.loading}>
                <div class="flex items-center justify-center gap-2 py-4">
                    <Spinner class="size-4" />
                    <span class="text-14-regular text-text-weak">{language.t("dialog.project.select_repo.loading")}</span>
                </div>
            </Show>

            <Show when={store.error && !store.loading}>
                <div class="flex items-start gap-2 p-3 bg-surface-critical-base rounded-md border border-border-critical-base mx-3 mb-3">
                    <Icon name="circle-x" class="shrink-0 size-4 text-icon-critical-base mt-0.5" />
                    <span class="text-14-regular text-text-critical-base">
                        {language.t("dialog.project.select_repo.error")}
                    </span>
                </div>
            </Show>

            <Show when={store.loadingMore}>
                <div class="flex items-center justify-center gap-2 py-2">
                    <Spinner class="size-4" />
                    <span class="text-14-regular text-text-weak">
                        {language.t("dialog.project.select_repo.loading_more")}
                    </span>
                </div>
            </Show>
        </Dialog>
    )
}


// ============================================================================
// DialogCloning
// ============================================================================

function DialogCloning(props: { repo: Repo; branch?: string; keyID: string; onSelect: (path: string) => void }) {
    const language = useLanguage()
    return (
        <Dialog title={language.t("dialog.project.clone.title")} class="min-h-0" action={<div />}>
            <div class="flex flex-col items-center justify-center py-12 gap-4 pb-6 px-6">
                <Spinner class="size-10" />
                <span class="text-14-medium text-text-strong">
                    {language.t("dialog.project.clone.cloning", { name: props.repo.full_name })}
                </span>
                <Show when={props.branch}>
                    <span class="text-12-regular text-text-weak">
                        {language.t("dialog.project.clone.branch", { branch: props.branch ?? "" })}
                    </span>
                </Show>
                <span class="text-12-regular text-text-weak">{language.t("dialog.project.clone.moments")}</span>
            </div>
        </Dialog>
    )
}


// ============================================================================
// DialogSelectGithubBranch
// ============================================================================

type BranchListItem = BackItem | DefaultBranchItem | Branch

function DialogSelectGithubBranch(props: {
    keyID: string
    keyName: string
    owner: string
    repo: string
    defaultBranch: string
    onSelect: (branch?: string) => void
    onBack: () => void
}) {
    const dialog = useDialog()
    const globalSDK = useGlobalSDK()
    const language = useLanguage()

    const [store, setStore] = createStore({
        branches: [] as Branch[],
        loading: true,
        error: undefined as string | undefined,
        query: "",
    })

    async function loadBranches() {
        setStore("loading", true)
        setStore("error", undefined)

        try {
            // @ts-ignore - SDK will be regenerated
            const response = await globalSDK.client.github.repos.branches({
                keyID: props.keyID,
                owner: props.owner,
                repo: props.repo,
                query: store.query || undefined,
                perPage: 50,
            })

            setStore("branches", response.data ?? [])
        } catch (e) {
            setStore("error", String(e))
        } finally {
            setStore("loading", false)
        }
    }

    onMount(() => {
        loadBranches()
    })

    function handleSelectBranch(branch: Branch) {
        props.onSelect(branch.name === props.defaultBranch ? undefined : branch.name)
    }

    function handleUseDefault() {
        props.onSelect(undefined)
    }

    function handleGoBack() {
        dialog.show(() => (
            <DialogSelectGithubRepo keyID={props.keyID} keyName={props.keyName} onSelect={props.onSelect} />
        ))
    }

    const items = createMemo<BranchListItem[]>(() => {
        let branches = store.branches
        if (store.query) {
            const q = store.query.toLowerCase()
            branches = branches.filter((b) => b.name.toLowerCase().includes(q))
        }
        const backItem: BackItem = { id: "__back__", name: language.t("dialog.project.select_branch.back"), type: "back" }
        const defaultItem: DefaultBranchItem = {
            id: "__default__",
            name: language.t("dialog.project.select_branch.default", { branch: props.defaultBranch }),
            type: "default",
            defaultBranch: props.defaultBranch,
        }
        return [backItem, defaultItem, ...branches]
    })

    return (
        <Dialog
            title={
                <div class="flex items-center gap-2">
                    <Show when={store.loading}>
                        <Spinner class="size-4" />
                    </Show>
                    <span>{language.t("dialog.project.select_branch.title")}</span>
                </div>
            }
            description={`${props.owner}/${props.repo}`}
        >
            <Show when={store.error && !store.loading}>
                <div class="flex items-start gap-2 p-3 bg-surface-critical-base rounded-md border border-border-critical-base mx-3">
                    <Icon name="circle-x" class="shrink-0 size-4 text-icon-critical-base mt-0.5" />
                    <span class="text-14-regular text-text-critical-base">{store.error}</span>
                </div>
            </Show>
            <List
                search={{ placeholder: language.t("dialog.project.select_branch.search.placeholder"), autofocus: true }}
                emptyMessage={language.t("dialog.project.select_branch.empty")}
                items={items}
                key={(x) => x.id ?? x.name}
                onSelect={(item) => {
                    if (!item) return
                    const backItem = item as BackItem
                    if (backItem.id === "__back__") {
                        handleGoBack()
                        return
                    }
                    const defaultItem = item as DefaultBranchItem
                    if (defaultItem.id === "__default__") {
                        handleUseDefault()
                        return
                    }
                    handleSelectBranch(item as Branch)
                }}
            >
                {(item) => (
                    <div class="w-full flex items-center justify-between rounded-md">
                        <div class="flex items-center gap-x-3 grow min-w-0">
                            <Icon
                                name={
                                    (item as BackItem).id === "__back__"
                                        ? "arrow-left"
                                        : (item as DefaultBranchItem).id === "__default__"
                                          ? "check"
                                          : "branch"
                                }
                                class="shrink-0 size-4 text-text-weak"
                            />
                            <div class="flex flex-col items-start text-left min-w-0">
                                <span class="text-14-regular text-text-strong truncate">{item.name}</span>
                                {(item as Branch).protected && (
                                    <Show when={(item as Branch).protected}>
                                        <span class="text-12-regular text-text-warning-base">
                                            {language.t("dialog.project.select_branch.protected")}
                                        </span>
                                    </Show>
                                )}
                            </div>
                        </div>
                        {(item as Branch).name === props.defaultBranch && (
                            <Icon name="check-small" class="size-4 text-icon-success-base" />
                        )}
                    </div>
                )}
            </List>
            <Show when={store.loading}>
                <div class="flex items-center justify-center gap-2 py-2">
                    <Spinner class="size-4" />
                    <span class="text-14-regular text-text-weak">
                        {language.t("dialog.project.select_branch.loading")}
                    </span>
                </div>
            </Show>
        </Dialog>
    )
}

