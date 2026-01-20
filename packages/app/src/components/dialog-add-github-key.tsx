import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { DialogSelectProjectProvider } from "./dialog-select-project-provider"

export function DialogAddGithubKey(props: { onComplete?: () => void; onBack?: () => void }) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()

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
      const errorMsg = String(e)
      if (isTokenError(errorMsg)) {
        setStore("error", "There was an error with the provided token, this token may no longer be valid")
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
      title="Add GitHub key"
      description=" Enter a name for this key and your GitHub personal access token. The token will be stored securely on your machine."
    >
      <form onSubmit={handleSubmit} class="flex flex-col gap-6 p-6 pt-0">
        <div class="flex flex-col gap-4">
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
          <div class="flex items-start gap-2 p-3 bg-surface-critical-base rounded-md border border-border-critical-base">
            <Icon name="circle-x" class="shrink-0 size-4 text-icon-critical-base mt-0.5" />
            <span class="text-14-regular text-text-critical-base">{store.error}</span>
          </div>
        </Show>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="large" onClick={handleBack}>
            Back to providers
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={store.loading}>
            <Show when={store.loading} fallback={"Add key"}>
              <div class="flex items-center gap-2">
                <div class="size-4 animate-spin border-2 border-text-strong border-t-transparent rounded-full" />
                Adding...
              </div>
            </Show>
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
