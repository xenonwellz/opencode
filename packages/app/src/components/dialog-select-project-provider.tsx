import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { List } from "@opencode-ai/ui/list"
import { Show, createMemo, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { DialogSelectDirectory } from "./dialog-select-directory"
import { DialogSelectGithubRepo } from "./dialog-select-github-repo"
import { showToast } from "@opencode-ai/ui/toast"
import { Button } from "@opencode-ai/ui/button"
import { DialogSelectProjectProviderType } from "./dialog-select-project-provider-type"

type ProviderType = "local" | "github" | "add_github"

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

  const addGithubItem: ProviderItem = {
    type: "add_github",
    id: "add_github",
    name: "Add provider",
    description: "Connect a new provider",
  }

  const allItems = createMemo<ProviderItem[]>(() => [...items(), addGithubItem])

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
          title="Delete provider"
          description={`Are you sure you want to delete "${keyName}"? This will remove the GitHub access token from your machine.`}
          class="min-h-0"
        >
          <div class="flex justify-end gap-2 px-6 pt-2 pb-4">
            <Button
              variant="secondary"
              size="large"
              onClick={() => {
                dialog.close()
                dialog.show(() => <DialogSelectProjectProvider multiple={props.multiple} onSelect={props.onSelect} />)
              }}
            >
              Cancel
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
              Delete
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
        title: "Provider deleted",
        description: `"${keyName}" has been removed.`,
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
        title: "Failed to delete provider",
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
    <Dialog title="Open project" description="Choose how to open your project">
      <div class="flex flex-col gap-4 pb-4">
        <div class="max-h-[400px] overflow-y-auto">
          <List
            search={{ placeholder: "Search providers", autofocus: true }}
            emptyMessage="No providers available"
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
                    name={item.type === "local" ? "folder" : item.type === "add_github" ? "plus-small" : "github"}
                    class="shrink-0 size-4 text-text-weak"
                  />
                  <div class="flex flex-col items-start text-left min-w-0">
                    <span class="text-14-regular text-text-strong truncate">{item.name}</span>
                    <Show when={item.description}>
                      <span class="text-12-regular text-text-weak truncate">{item.description}</span>
                    </Show>
                  </div>
                </div>
                <Show when={item.type === "github"}>
                  <button
                    onClick={(e) => handleDeleteKey(e, item.id, item.name)}
                    class="p-1 rounded transition-colors hover:bg-surface-critical-base"
                    title="Delete provider"
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
