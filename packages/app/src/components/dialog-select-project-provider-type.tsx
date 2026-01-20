import { createMemo } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { List } from "@opencode-ai/ui/list"
import { DialogAddGithubKey } from "./dialog-add-github-key"

interface ProviderType {
  id: string
  name: string
  icon: string
}

const providerTypes: ProviderType[] = [
  {
    id: "github",
    name: "GitHub",
    icon: "github",
  },
]

interface BackItem {
  id: "__back__"
  name: string
  type: "back"
}

type ListItem = BackItem | ProviderType

export function DialogSelectProjectProviderType(props: { onBack: () => void }) {
  const dialog = useDialog()

  function handleSelect(item: ListItem) {
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

  const items = createMemo<ListItem[]>(() => [
    { id: "__back__", name: "Back to providers", type: "back" as const },
    ...providerTypes,
  ])

  return (
    <Dialog title="Select provider" description="Choose a provider to connect">
      <List
        search={{ placeholder: "Search providers", autofocus: true }}
        items={items}
        key={(x) => x.id}
        onSelect={(item) => {
          if (!item) return
          handleSelect(item as ListItem)
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-x-3">
            <Icon
              name={"type" in item && item.type === "back" ? "arrow-left" : ((item as ProviderType).icon as any)}
              class="shrink-0 size-4 text-text-weak"
            />
            <span>{item.name}</span>
          </div>
        )}
      </List>
    </Dialog>
  )
}
