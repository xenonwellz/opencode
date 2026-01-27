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
import { Show, For, createMemo, createSignal, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useGitHubProjects } from "@/context/github-projects"

// ============================================================================
// Types
// ============================================================================

type ProviderType = "local" | "github" | "add_github" | "github_app_setup"

interface ProviderItem {
  type: ProviderType
  id: string
  name: string
  description?: string
  providerData?: {
    providerId: string
    installationId?: number
    slug?: string
  }
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
    providers: [] as Array<{
      id: string
      type: string
      appId: number
      slug: string
      clientId: string
    }>,
    installations: {} as Record<
      string,
      Array<{
        id: number
        account?: {
          login: string
          avatar_url?: string
          name?: string
        }
      }>
    >,
  })

  onMount(() => {
    loadProviders()
  })

  async function loadProviders() {
    setStore("loading", true)
    try {
      const response = await globalSDK.client.project.providers.github.list()
      const providers = Array.isArray(response.data) ? response.data : []
      setStore("providers", providers)

      for (const provider of providers) {
        try {
          const instResponse = await globalSDK.client.project.providers.github.getInstallations({
            providerId: provider.id,
          })
          setStore("installations", provider.id, Array.isArray(instResponse.data) ? instResponse.data : [])
        } catch (e) {
          console.error("Failed to load installations for provider", provider.id, e)
          setStore("installations", provider.id, [])
        }
      }
    } catch (e) {
      console.error("Failed to load providers", e)
    } finally {
      setStore("loading", false)
    }
  }

  const items = createMemo<ProviderItem[]>(() => {
    const result: ProviderItem[] = [
      {
        type: "local",
        id: "local",
        name: language.t("dialog.project.provider.local.name"),
        description: language.t("dialog.project.provider.local.description"),
      },
    ]

    for (const provider of store.providers) {
      const installations = store.installations[provider.id] || []
      if (installations.length > 0) {
        for (const inst of installations) {
          result.push({
            type: "github" as const,
            id: `${provider.id}_${inst.id}`,
            name: inst.account?.login || inst.account?.name || `Installation ${inst.id}`,
            description: `${provider.slug} (${inst.account?.login || "GitHub App"})`,
            providerData: {
              providerId: provider.id,
              installationId: inst.id,
              slug: provider.slug,
            },
          })
        }
      }
    }

    return result
  })

  const addGithubItem = createMemo<ProviderItem | null>(() => ({
    type: "add_github" as const,
    id: "add_github",
    name: language.t("dialog.project.provider.add.name"),
    description: language.t("dialog.project.provider.add.description"),
  }))

  const githubAppItem = createMemo<ProviderItem | null>(() => {
    if (store.providers.length === 0) return null
    const totalInstallations = store.providers.reduce((acc, p) => acc + (store.installations[p.id]?.length || 0), 0)
    return {
      type: "github_app_setup" as const,
      id: "github_app_setup",
      name: language.t("dialog.project.github_app.manage.title"),
      description: `${store.providers.length} provider(s), ${totalInstallations} installation(s)`,
    }
  })

  const allItems = createMemo<ProviderItem[]>(() => {
    const result = [...items()]
    const addItem = addGithubItem()
    if (addItem) result.push(addItem)
    const appItem = githubAppItem()
    if (appItem) result.push(appItem)
    return result
  })

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
    } else if (provider.type === "github_app_setup") {
      dialog.show(() => (
        <DialogGithubAppSetup
          onComplete={() => {
            dialog.close()
            dialog.show(() => <DialogSelectProjectProvider multiple={props.multiple} onSelect={props.onSelect} />)
          }}
          onBack={() => {
            dialog.show(() => <DialogSelectProjectProvider multiple={props.multiple} onSelect={props.onSelect} />)
          }}
        />
      ))
    } else if (provider.type === "add_github") {
      dialog.show(
        () => (
          <DialogSelectProjectProviderType
            onBack={() => {
              dialog.close()
              dialog.show(() => <DialogSelectProjectProvider multiple={props.multiple} onSelect={props.onSelect} />)
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
    <Dialog title={language.t("dialog.project.open.title")} description={language.t("dialog.project.open.description")}>
      <div class="flex flex-col gap-4 pb-4">
        <div class="max-h-[400px] overflow-y-auto">
          <List
            search={{ placeholder: language.t("dialog.project.search.placeholder"), autofocus: true }}
            emptyMessage={language.t("dialog.project.empty")}
            items={allItems}
            filterKeys={["name", "description"]}
            key={(x) => x.id}
            onSelect={(provider) => {
              if (provider) handleSelect(provider)
            }}
          >
            {(item) => (
              <div class="w-full flex items-center justify-between rounded-md group">
                <div class="flex items-center gap-x-3 grow min-w-0">
                  <Icon name={item.type === "local" ? "folder" : "github"} class="shrink-0 size-4 text-text-weak" />
                  <div class="flex flex-col items-start text-left min-w-0">
                    <span class="text-14-regular text-text-strong truncate">{item.name}</span>
                    <Show when={item.description}>
                      <span class="text-12-regular text-text-weak truncate">{item.description}</span>
                    </Show>
                  </div>
                </div>
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
        filterKeys={["name"]}
        key={(x) => x.id}
        onSelect={(item) => {
          if (!item) return
          handleSelect(item as ProviderTypeListItem)
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-x-3">
            <Icon
              name={"type" in item && item.type === "back" ? "arrow-left" : ((item as ProviderTypeItem).icon as any)}
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
// DialogAddGithubKey - Now creates GitHub App Provider instead of PAT key
// ============================================================================

function DialogAddGithubKey(props: { onComplete?: () => void; onBack?: () => void }) {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()

  const [store, setStore] = createStore({
    organization: "",
    loading: false,
    error: undefined as string | undefined,
  })

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()

    setStore("loading", true)
    setStore("error", undefined)

    try {
      const response = await globalSDK.client.project.providers.github.create({
        organization: store.organization || undefined,
      })

      if (response.data?.url) {
        window.location.href = response.data.url
      }

      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("dialog.project.add_github.success.title"),
        description: language.t("dialog.project.add_github.success.description"),
      })

      props.onComplete?.()
    } catch (e) {
      setStore("error", String(e))
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
          <div class="text-14-regular text-text-weak">{language.t("dialog.project.add_github.app_instruction")}</div>
        </div>

        <TextField
          label={language.t("dialog.project.add_github.organization.label")}
          placeholder={language.t("dialog.project.add_github.organization.placeholder")}
          value={store.organization}
          onChange={setStore.bind(null, "organization")}
        />

        <Show when={store.error}>
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
  const [currentPath, setCurrentPath] = createSignal<string>("")

  // Check if we're at the root (home) level
  const isAtRoot = createMemo(() => currentPath() === "")

  // Get the full absolute path
  const absolutePath = createMemo(() => {
    const h = home()
    const rel = currentPath()
    if (!h) return rel
    if (!rel) return h
    return h + "/" + rel
  })

  // Display path (with ~ prefix)
  const displayPath = createMemo(() => {
    const rel = currentPath()
    if (!rel) return "~"
    return "~/" + rel
  })

  // Build list items - back, parent (..), and folders
  type FolderListItem = { id: string; type: "back" | "parent" | "folder"; path?: string; name: string; label: string }

  async function fetchItems(searchQuery: string): Promise<FolderListItem[]> {
    const items: FolderListItem[] = []

    // Only show navigation items when not searching
    if (!searchQuery) {
      items.push({
        id: "__back__",
        type: "back",
        name: language.t("dialog.directory.back"),
        label: language.t("dialog.directory.back"),
      })
      if (!isAtRoot()) {
        items.push({ id: "__parent__", type: "parent", name: "..", label: ".." })
      }
    }

    // Use displayPath which uses ~/ prefix that backend understands
    const directory = displayPath()

    try {
      // API now returns direct children only, filtered by query
      const result = await sdk.client.find.files({
        directory,
        query: searchQuery || undefined,
        type: "directory",
        limit: 100,
      })

      // Check for 404 error
      if (result.error) {
        return items
      }

      const folders = result.data ?? []
      const absDir = absolutePath()

      for (const folder of folders) {
        // Remove trailing slash
        const name = folder.replace(/[\\/]+$/, "")
        const absPath = absDir + "/" + name

        items.push({
          id: absPath,
          type: "folder",
          path: absPath,
          name: name,
          label: name,
        })
      }
    } catch {
      // Return just navigation items on error
    }

    return items
  }

  function navigateInto(folderPath: string) {
    const h = home()
    if (!h) return

    // Get relative path from home
    const rel = folderPath.startsWith(h + "/")
      ? folderPath.slice(h.length + 1)
      : folderPath.startsWith(h)
        ? folderPath.slice(h.length).replace(/^\//, "")
        : folderPath

    setCurrentPath(rel)
  }

  function navigateUp() {
    const rel = currentPath()
    if (!rel) return

    const parts = rel.split("/")
    parts.pop()
    setCurrentPath(parts.join("/"))
  }

  function openAsProject(folderPath: string) {
    props.onSelect(props.multiple ? [folderPath] : folderPath)
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

  function handleSelect(item: FolderListItem) {
    if (item.type === "back") {
      handleGoBack()
    } else if (item.type === "parent") {
      navigateUp()
    } else if (item.path) {
      navigateInto(item.path)
    }
  }

  // Handle path input change
  function handlePathInput(value: string) {
    if (value === "/" || value === "~") {
      setCurrentPath("")
      return
    }

    // Ensure path always starts with ~/ conceptually
    let cleanPath = value
    if (value.startsWith("~/")) {
      cleanPath = value.slice(2)
    } else if (value.startsWith("/")) {
      cleanPath = value.slice(1)
    }
    setCurrentPath(cleanPath)
  }

  const [openLoading, setOpenLoading] = createSignal(false)

  // Consolidate opening logic with verification
  async function openDirectoryAsProject(path: string) {
    if (!path || openLoading()) return

    setOpenLoading(true)
    try {
      // Verify directory exists and we can access it
      const result = await sdk.client.find.files({
        directory: path.startsWith("/") ? path : "~/" + (path.startsWith("~/") ? path.slice(2) : path),
        type: "directory",
        limit: 1,
      })

      if (result.error) {
        showToast({
          variant: "error",
          icon: "circle-x",
          title: language.t("dialog.directory.error.not_found.title"),
          description: language.t("dialog.directory.error.not_found.description", { path }),
        })
      } else {
        openAsProject(path)
      }
    } catch {
      showToast({
        variant: "error",
        icon: "circle-x",
        title: language.t("dialog.directory.error.failed.title"),
        description: language.t("dialog.directory.error.failed.description"),
      })
    } finally {
      setOpenLoading(false)
    }
  }

  // Check if path exists and open or show error
  function handleOpenPath() {
    openDirectoryAsProject(absolutePath())
  }

  return (
    <Dialog title={props.title ?? language.t("dialog.project.open.title")}>
      <List
        search={{ placeholder: language.t("dialog.directory.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.directory.empty")}
        items={fetchItems}
        filterKeys={["label", "name"]}
        key={(item) => item.id + currentPath()}
        onSelect={(item) => item && handleSelect(item)}
      >
        {(item) => (
          <div
            class="w-full flex items-center justify-between rounded-md"
            onDblClick={() => {
              if (item.type === "folder" && item.path) {
                openDirectoryAsProject(item.path)
              }
            }}
          >
            <div class="flex items-center gap-x-3 grow min-w-0">
              <Show when={item.type === "back"}>
                <Icon name="arrow-left" class="shrink-0 size-4 text-text-weak" />
              </Show>
              <Show when={item.type === "parent"}>
                <Icon name="folder" class="shrink-0 size-4 text-text-weak" />
              </Show>
              <Show when={item.type === "folder"}>
                <FileIcon node={{ path: item.path ?? "", type: "directory" }} class="shrink-0 size-4" />
              </Show>
              <span class="text-14-regular text-text-strong truncate">{item.name}</span>
            </div>

            {/* Open button (visible after leaving root, only for folders) */}
            <Show when={!isAtRoot() && item.type === "folder" && item.path}>
              <Button
                variant="ghost"
                size="small"
                disabled={openLoading()}
                onClick={(e: MouseEvent) => {
                  e.stopPropagation()
                  if (item.path) openDirectoryAsProject(item.path)
                }}
              >
                {language.t("common.open")}
              </Button>
            </Show>
          </div>
        )}
      </List>

      {/* Footer: Path input with Open button */}
      <div class="flex items-center gap-2 px-3 py-2 border-t border-border-base">
        <div class="flex-1 flex items-center h-9 bg-surface-subtle-base rounded-md border border-border-base focus-within:border-border-focus-base">
          <span class="pl-3 text-14-regular text-text-weak font-mono select-none">~/</span>
          <input
            type="text"
            value={currentPath()}
            onInput={(e) => handlePathInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleOpenPath()
              }
            }}
            disabled={openLoading()}
            class="flex-1 h-full bg-transparent px-1 text-14-regular text-text-strong font-mono outline-none disabled:opacity-50"
          />
        </div>
        <Button variant="primary" class="h-9" onClick={handleOpenPath} disabled={openLoading()}>
          <Show when={openLoading()} fallback={language.t("common.open")}>
            <Spinner class="size-4" />
          </Show>
        </Button>
      </div>
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
  const githubProjects = useGitHubProjects()

  const [store, setStore] = createStore({
    repos: [] as Repo[],
    loading: false,
    loadingMore: false,
    error: undefined as string | undefined,
    page: 1,
    hasMore: true,
    query: "",
  })

  async function fetchRepos(query: string): Promise<RepoListItem[]> {
    const backItem: BackItem = { id: "__back__", name: language.t("dialog.directory.back"), type: "back" }

    setStore("loading", true)
    setStore("query", query)

    try {
      const response = await globalSDK.client.github.repos.list({
        keyID: props.keyID,
        query: query || undefined,
        page: 1,
        perPage: 30,
      })

      const repos = ((response.data as Array<Repo>) ?? []).map((r) => ({
        ...r,
        type: "repo" as const,
      }))

      setStore("repos", repos)
      setStore("error", undefined)
      setStore("loading", false)
      return [backItem, ...repos]
    } catch (e) {
      setStore("error", String(e))
      setStore("loading", false)
      return [backItem]
    }
  }

  function handleSelectRepo(repo: Repo) {
    dialog.show(() => (
      <DialogSelectGithubBranch
        keyID={props.keyID}
        keyName={props.keyName}
        owner={repo.full_name.split("/")[0]}
        repo={repo.name}
        defaultBranch={repo.default_branch}
        onSelect={async (branch) => {
          dialog.show(() => <DialogCloning repo={repo} branch={branch} keyID={props.keyID} onSelect={props.onSelect} />)
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
    const owner = repo.full_name.split("/")[0]

    try {
      // @ts-ignore - SDK will be regenerated
      const response = await globalSDK.client.github.clone({
        keyID: props.keyID,
        owner,
        repo: repo.name,
        branch,
      })

      if (response.data?.path) {
        const projectPath = response.data.path

        // Get the actual branch info from the project after clone
        const status = await globalSDK.client.github.status({ directory: projectPath })
        const currentBranch = status.data?.branch || "main"

        // If it's an opencode/ branch, determine the base branch
        const workingBranch = currentBranch
        const baseBranch = workingBranch.startsWith("opencode/")
          ? workingBranch.slice("opencode/".length).replace(/-[a-z0-9]{4}-[a-z0-9]{4}$/, "")
          : (branch ?? repo.default_branch)

        // Register this project in GitHub projects storage
        githubProjects.register({
          projectId: projectPath,
          keyId: props.keyID,
          owner,
          repo: repo.name,
          baseBranch,
          workingBranch,
        })

        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("dialog.project.clone.success.title"),
          description: language.t("dialog.project.clone.success.description_with_branch", {
            name: repo.full_name,
            branch: workingBranch,
          }),
        })
        dialog.close()
        props.onSelect(projectPath)
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

  return (
    <Dialog
      title={language.t("dialog.project.select_repo.title")}
      description={language.t("dialog.project.select_repo.description", { name: props.keyName })}
    >
      <List
        search={{ placeholder: language.t("dialog.project.select_repo.search.placeholder"), autofocus: true }}
        emptyMessage={store.error ? "" : language.t("dialog.project.select_repo.empty")}
        items={fetchRepos}
        filterKeys={["name", "full_name"]}
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
                      <span class="text-14-regular text-text-strong truncate">{(item as Repo).name}</span>
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
          <span class="text-14-regular text-text-critical-base">{language.t("dialog.project.select_repo.error")}</span>
        </div>
      </Show>

      <Show when={store.loadingMore}>
        <div class="flex items-center justify-center gap-2 py-2">
          <Spinner class="size-4" />
          <span class="text-14-regular text-text-weak">{language.t("dialog.project.select_repo.loading_more")}</span>
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
  })

  async function fetchBranches(query: string): Promise<BranchListItem[]> {
    const backItem: BackItem = { id: "__back__", name: language.t("dialog.project.select_branch.back"), type: "back" }
    const defaultItem: DefaultBranchItem = {
      id: "__default__",
      name: language.t("dialog.project.select_branch.default", { branch: props.defaultBranch }),
      type: "default",
      defaultBranch: props.defaultBranch,
    }

    try {
      // @ts-ignore - SDK will be regenerated
      const response = await globalSDK.client.github.repos.branches({
        keyID: props.keyID,
        owner: props.owner,
        repo: props.repo,
        query: query || undefined,
        perPage: 50,
      })

      const branches = (response.data ?? []) as Branch[]
      setStore("branches", branches)
      setStore("error", undefined)
      setStore("loading", false)
      return [backItem, defaultItem, ...branches]
    } catch (e) {
      setStore("error", String(e))
      setStore("loading", false)
      return [backItem, defaultItem]
    }
  }

  function handleSelectBranch(branch: Branch) {
    props.onSelect(branch.name === props.defaultBranch ? undefined : branch.name)
  }

  function handleUseDefault() {
    props.onSelect(undefined)
  }

  function handleGoBack() {
    dialog.show(() => <DialogSelectGithubRepo keyID={props.keyID} keyName={props.keyName} onSelect={props.onSelect} />)
  }

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
        emptyMessage={store.error ? "" : language.t("dialog.project.select_branch.empty")}
        items={fetchBranches}
        filterKeys={["name"]}
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
          <span class="text-14-regular text-text-weak">{language.t("dialog.project.select_branch.loading")}</span>
        </div>
      </Show>
      <Show when={store.error && !store.loading}>
        <div class="flex items-start gap-2 p-3 bg-surface-critical-base rounded-md border border-border-critical-base mx-3 mb-2">
          <Icon name="circle-x" class="shrink-0 size-4 text-icon-critical-base mt-0.5" />
          <span class="text-14-regular text-text-critical-base">{String(store.error)}</span>
        </div>
      </Show>
    </Dialog>
  )
}

// ============================================================================
// DialogGithubAppSetup
// ============================================================================

function DialogGithubAppSetup(props: { onComplete?: () => void; onBack?: () => void }) {
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const dialog = useDialog()

  const [loading, setLoading] = createSignal(false)
  const [organization, setOrganization] = createSignal("")

  function handleSetup() {
    setLoading(true)
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
    const manifest = {
      name: `opencode-host-${suffix}`,
      description: "OpenCode AI coding assistant",
      url: window.location.origin,
      redirect_url: `${globalSDK.url}/github/app/callback`,
      callback_urls: [`${globalSDK.url}/github/app/callback`],
      public: false,
      default_permissions: {
        contents: "write",
        pull_requests: "write",
        issues: "write",
        metadata: "read",
      },
      default_events: [],
    }

    const form = document.createElement("form")
    form.method = "POST"
    form.action = organization()
      ? `https://github.com/organizations/${organization()}/settings/apps/new`
      : "https://github.com/settings/apps/new"

    const manifestInput = document.createElement("input")
    manifestInput.type = "hidden"
    manifestInput.name = "manifest"
    manifestInput.value = JSON.stringify(manifest)
    form.appendChild(manifestInput)

    document.body.appendChild(form)
    form.submit()
  }

  return (
    <Dialog
      title={language.t("dialog.project.github_app.setup.title")}
      description={language.t("dialog.project.github_app.setup.description")}
    >
      <div class="flex flex-col gap-6 p-6 pt-0">
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-2">
            <label class="text-14-medium text-text-strong">Organization (optional)</label>
            <input
              type="text"
              value={organization()}
              onInput={(e) => setOrganization(e.currentTarget.value)}
              placeholder="Leave empty for personal app"
              class="w-full px-3 py-2 bg-surface-base border border-border-base rounded-md text-14-regular text-text-strong placeholder:text-text-weak focus:outline-none focus:border-border-primary"
            />
            <span class="text-12-regular text-text-weak">
              Enter your organization name to create the app under an organization
            </span>
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="large" onClick={props.onBack}>
            {language.t("common.back")}
          </Button>
          <Button type="button" variant="primary" size="large" onClick={handleSetup} disabled={loading()}>
            <Show when={loading()} fallback={language.t("dialog.project.github_app.setup.button")}>
              <div class="flex items-center gap-2">
                <Spinner class="size-4" />
                {language.t("dialog.project.github_app.setup.button.loading")}
              </div>
            </Show>
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
