import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { List } from "@opencode-ai/ui/list"
import { Show, createMemo, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { Spinner } from "@opencode-ai/ui/spinner"
import { DialogSelectGithubRepo } from "./dialog-select-github-repo"

interface Branch {
  name: string
  protected: boolean
  id?: string
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

type ListItem = BackItem | DefaultBranchItem | Branch

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
    dialog.show(() => <DialogSelectGithubRepo keyID={props.keyID} keyName={props.keyName} onSelect={props.onSelect} />)
  }

  const items = createMemo<ListItem[]>(() => {
    let branches = store.branches
    if (store.query) {
      const q = store.query.toLowerCase()
      branches = branches.filter((b) => b.name.toLowerCase().includes(q))
    }
    const backItem: BackItem = { id: "__back__", name: "Back to repositories", type: "back" }
    const defaultItem: DefaultBranchItem = {
      id: "__default__",
      name: `Use default branch (${props.defaultBranch})`,
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
          <span>Select branch</span>
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
      <Show when={store.loading}>
        <div class="flex items-center justify-center gap-2 py-2">
          <Spinner class="size-4" />
          <span class="text-14-regular text-text-weak">Loading branches...</span>
        </div>
      </Show>
    </Dialog>
  )
}
