import { createSignal, onMount, Show, createMemo } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { List } from "@opencode-ai/ui/list"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { DialogSelectGithubBranch } from "./dialog-select-github-branch"
import { DialogSelectProjectProvider } from "./dialog-select-project-provider"

interface Repo {
  id: number
  name: string
  full_name: string
  description: string | null
  private: boolean
  default_branch: string
  updated_at: string | null
}

interface BackItem {
  id: "__back__"
  name: string
  type: "back"
}

type ListItem = BackItem | Repo

export function DialogSelectGithubRepo(props: { keyID: string; keyName: string; onSelect: (path: string) => void }) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()

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
          title: "Repository cloned",
          description: `Successfully cloned ${repo.full_name}`,
        })
        dialog.close()
        props.onSelect(response.data.path)
      }
    } catch (e) {
      showToast({
        variant: "error",
        icon: "circle-x",
        title: "Failed to clone repository",
        description: String(e),
      })
      dialog.show(() => <DialogSelectProjectProvider multiple={false} onSelect={props.onSelect} />)
    }
  }

  const computedItems = createMemo<ListItem[]>(() => {
    const repos: ListItem[] = store.repos.map((r) => ({ ...r, type: "repo" as const }))
    const backItem: BackItem = { id: "__back__", name: "Back to providers", type: "back" }
    return [backItem, ...repos]
  })

  return (
    <Dialog title="Select repository" description={`Connected with ${props.keyName}`}>
      <List
        search={{ placeholder: "Search repositories", autofocus: true }}
        emptyMessage="No repositories found"
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
                      No description
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
          <span class="text-14-regular text-text-weak">Loading repositories...</span>
        </div>
      </Show>

      <Show when={store.error && !store.loading}>
        <div class="flex items-start gap-2 p-3 bg-surface-critical-base rounded-md border border-border-critical-base mx-3 mb-3">
          <Icon name="circle-x" class="shrink-0 size-4 text-icon-critical-base mt-0.5" />
          <span class="text-14-regular text-text-critical-base">
            There was an error loading repositories, this can be caused by incorrect configuration or invalid/expired
            token.
            <br />
            Please check your configuration and try again.
          </span>
        </div>
      </Show>

      <Show when={store.loadingMore}>
        <div class="flex items-center justify-center gap-2 py-2">
          <Spinner class="size-4" />
          <span class="text-14-regular text-text-weak">Loading more...</span>
        </div>
      </Show>
    </Dialog>
  )
}

function DialogCloning(props: { repo: Repo; branch?: string; keyID: string; onSelect: (path: string) => void }) {
  return (
    <Dialog title="Cloning repository" class="min-h-0" action={<div />}>
      <div class="flex flex-col items-center justify-center py-12 gap-4 pb-6 px-6">
        <Spinner class="size-10" />
        <span class="text-14-medium text-text-strong">Cloning {props.repo.full_name}...</span>
        <Show when={props.branch}>
          <span class="text-12-regular text-text-weak">Branch: {props.branch}</span>
        </Show>
        <span class="text-12-regular text-text-weak">This may take a few moments</span>
      </div>
    </Dialog>
  )
}
