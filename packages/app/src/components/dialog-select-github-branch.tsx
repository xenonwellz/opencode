import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { List } from "@opencode-ai/ui/list"
import { Show, createMemo, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"

interface Branch {
  name: string
  protected: boolean
  id?: string
}

interface BackItem {
  id: "__back__"
  name: string
}

type ListItem = BackItem | Branch

export function DialogSelectGithubBranch(props: {
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

  const [store, setStore] = createStore({
    branches: [] as Branch[],
    loading: false,
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
    props.onBack()
  }

  const items = createMemo<ListItem[]>(() => {
    let branches = store.branches
    if (store.query) {
      const q = store.query.toLowerCase()
      branches = branches.filter((b) => b.name.toLowerCase().includes(q))
    }
    const backItem: BackItem = { id: "__back__", name: "Back to repositories" }
    return [backItem, ...branches]
  })

  return (
    <Dialog
      title={
        <div class="flex items-center gap-2">
          <span>Select branch</span>
        </div>
      }
      description={`${props.owner}/${props.repo}`}
    >
      <div class="flex flex-col gap-4 pb-4">
        <div class="px-3 py-2 bg-surface-weak-base rounded-md">
          <Button variant={props.defaultBranch ? "secondary" : "primary"} class="w-full" onClick={handleUseDefault}>
            Use default branch ({props.defaultBranch})
          </Button>
        </div>

        <List
          search={{ placeholder: "Search branches", autofocus: true }}
          emptyMessage="No branches found"
          items={items}
          key={(x) => x.id ?? x.name}
          onSelect={(item) => {
            if (!item) return
            const backItem = item as BackItem
            if (backItem.id === "__back__") {
              handleGoBack()
              return
            }
            handleSelectBranch(item as Branch)
          }}
        >
          {(item) => (
            <div class="w-full flex items-center justify-between rounded-md">
              <div class="flex items-center gap-x-3 grow min-w-0">
                <Icon
                  name={(item as BackItem).id === "__back__" ? "arrow-left" : "branch"}
                  class="shrink-0 size-4 text-text-weak"
                />
                <div class="flex flex-col items-start text-left min-w-0">
                  <span class="text-14-regular text-text-strong truncate">{item.name}</span>
                  {(item as Branch).protected && (
                    <Show when={(item as Branch).protected}>
                      <span class="text-12-regular text-text-warning-base">Protected</span>
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

        <Show when={store.error}>
          <div class="text-14-regular text-text-critical-base px-3">{store.error}</div>
        </Show>
      </div>
    </Dialog>
  )
}
