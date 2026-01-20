import { Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { List } from "@opencode-ai/ui/list"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo, createSignal, onMount } from "solid-js"
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
    loading: false,
    loadingMore: false,
    error: undefined as string | undefined,
    page: 1,
    hasMore: true,
    query: "",
  })

  const [selectedRepo, setSelectedRepo] = createSignal<Repo | null>(null)

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

  function handleGoBack() {
    dialog.show(() => (
      <DialogSelectProjectProvider
        multiple={false}
        onSelect={(path: string) => {
          dialog.close()
          props.onSelect(path)
        }}
      />
    ))
  }

  function handleSelectRepo(repo: Repo) {
    setSelectedRepo(repo)
    dialog.show(() => (
      <DialogSelectGithubBranch
        keyID={props.keyID}
        keyName={props.keyName}
        owner={repo.full_name.split("/")[0]}
        repo={repo.name}
        defaultBranch={repo.default_branch}
        onSelect={async (branch) => {
          await handleClone(repo, branch)
        }}
        onBack={() => {
          setSelectedRepo(null)
          dialog.show(() => (
            <DialogSelectGithubRepo keyID={props.keyID} keyName={props.keyName} onSelect={props.onSelect} />
          ))
        }}
      />
    ))
  }

  async function handleClone(repo: Repo, branch?: string) {
    setStore("loading", true)
    setStore("error", undefined)

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
        props.onSelect(response.data.path)
      }
    } catch (e) {
      setStore("error", String(e))
      showToast({
        variant: "error",
        icon: "circle-x",
        title: "Failed to clone repository",
        description: String(e),
      })
    } finally {
      setStore("loading", false)
    }
  }

  const items = createMemo<ListItem[]>(() => {
    const repos: ListItem[] = store.repos.map((r) => ({ ...r, type: "repo" as const }))
    const backItem: BackItem = { id: "__back__", name: "Back to providers", type: "back" }
    return [backItem, ...repos]
  })

  return (
    <Dialog
      title={
        <div class="flex items-center gap-2">
          <span>Select repository</span>
        </div>
      }
      description={`Connected with ${props.keyName}`}
    >
      <div class="flex flex-col gap-4 pb-4">
        <List
          search={{ placeholder: "Search repositories", autofocus: true }}
          emptyMessage="No repositories found"
          items={items}
          key={(x) => (typeof x.id === "number" ? x.id.toString() : x.id)}
          onSelect={(item) => {
            if (!item) return
            const backItem = item as BackItem
            if (backItem.id === "__back__") {
              handleGoBack()
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
                  <span class="text-14-regular text-text-strong truncate">{item.name}</span>
                  {"description" in item && item.description && (
                    <span class="text-12-regular text-text-weak truncate max-w-[300px]">{item.description}</span>
                  )}
                </div>
              </div>
              {"full_name" in item && <Icon name="chevron-right" class="size-4 text-text-weak" />}
            </div>
          )}
        </List>

        <Show when={store.error}>
          <div class="text-14-regular text-text-critical-base px-3">{store.error}</div>
        </Show>
      </div>
    </Dialog>
  )
}
