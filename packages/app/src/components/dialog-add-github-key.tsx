import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"

export function DialogAddGithubKey(props: { onComplete?: () => void; onCancel?: () => void }) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()

  const [store, setStore] = createStore({
    name: "",
    token: "",
    loading: false,
    error: undefined as string | undefined,
  })

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()

    if (!store.name.trim()) {
      setStore("error", "Name is required")
      return
    }

    if (!store.token.trim()) {
      setStore("error", "Token is required")
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
        title: "GitHub key added",
        description: "You can now use this key to access your GitHub repositories.",
      })

      props.onComplete?.()
    } catch (e) {
      setStore("error", String(e))
    } finally {
      setStore("loading", false)
    }
  }

  function handleCancel() {
    props.onCancel?.()
  }

  return (
    <Dialog title="Add GitHub key" description="Add a GitHub personal access token to access your repositories">
      <form onSubmit={handleSubmit} class="flex flex-col gap-6 p-6">
        <div class="flex flex-col gap-4">
          <div class="text-14-regular text-text-base">
            Enter a name for this key and your GitHub personal access token. The token will be stored securely on your
            machine.
          </div>
          <div class="text-14-regular text-text-weak">
            <a href="https://github.com/settings/tokens" target="_blank" class="underline">
              Create a token on GitHub
            </a>
            . For classic tokens, use the <code>repo</code> scope. For fine-grained tokens, grant repository access.
          </div>
        </div>

        <TextField
          label="Name"
          placeholder="My GitHub Token"
          value={store.name}
          onChange={setStore.bind(null, "name")}
          validationState={store.error && !store.name ? "invalid" : undefined}
          error={store.error && !store.name ? "Name is required" : undefined}
        />

        <TextField
          label="Personal Access Token"
          type="password"
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
          value={store.token}
          onChange={setStore.bind(null, "token")}
          validationState={store.error && !store.token ? "invalid" : undefined}
          error={store.error && !store.token ? "Token is required" : undefined}
        />

        <Show when={store.error && store.name && store.token}>
          <div class="text-14-regular text-text-critical-base">{store.error}</div>
        </Show>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={store.loading}>
            {store.loading ? "Adding..." : "Add key"}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
