import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { List } from "@opencode-ai/ui/list"
import { Show, createMemo, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { DialogSelectDirectory } from "./dialog-select-directory"
import { DialogAddGithubKey } from "./dialog-add-github-key"
import { DialogSelectGithubRepo } from "./dialog-select-github-repo"

type ProviderType = "local" | "github"

interface ProviderItem {
  type: ProviderType
  id: string
  name: string
  description?: string
}

export function DialogSelectProjectProvider(props: { multiple?: boolean; onSelect: (path: string) => void }) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()

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
        name: "Local",
        description: "Open a local directory",
      },
    ]
    for (const key of store.githubKeys) {
      if (!key.id || !key.name) continue
      result.push({
        type: "github",
        id: key.id,
        name: key.name,
        description: `GitHub (${key.type || "classic"})`,
      })
    }
    return result
  })

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

  function handleAddGithubKey() {
    dialog.show(
      () => (
        <DialogAddGithubKey
          onComplete={() => {
            dialog.close()
            setTimeout(() => {
              dialog.show(() => <DialogSelectProjectProvider multiple={props.multiple} onSelect={props.onSelect} />)
            }, 100)
          }}
          onCancel={() => {
            dialog.close()
          }}
        />
      ),
      undefined,
    )
  }

  return (
    <Dialog title="Open project" description="Choose how to open your project">
      <div class="flex flex-col gap-4 pb-4">
        <List
          search={{ placeholder: "Search providers", autofocus: true }}
          emptyMessage="No providers available"
          items={items}
          key={(x) => x.id}
          onSelect={(provider) => {
            if (provider) handleSelect(provider)
          }}
        >
          {(item) => (
            <div class="w-full flex items-center justify-between rounded-md">
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

        <div class="mt-4 px-3 flex flex-col gap-1.5 border-t border-border-weak-base pt-4">
          <h3 class="text-14-regular text-text-weak">Add GitHub provider</h3>
          <Button variant="secondary" size="large" icon="plus-small" onClick={handleAddGithubKey} class="w-full">
            Add GitHub key
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
