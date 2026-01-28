import { Component, createMemo, createSignal, onMount, onCleanup, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { useSDK } from "@/context/sdk"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { getFilename } from "@opencode-ai/util/path"
import { useGitHubProjects } from "@/context/github-projects"
import { useLocal } from "@/context/local"

interface GitActionsProps {
  class?: string
}

interface GitHubKey {
  id: string
  name: string
  type: "classic" | "fine-grained" | "installation"
  createdAt: number
  accountName?: string
  accountAvatar?: string
}

export const GitActions: Component<GitActionsProps> = (props) => {
  const sdk = useSDK()
  const dialog = useDialog()
  const githubProjects = useGitHubProjects()
  const local = useLocal()

  const [pushing, setPushing] = createSignal(false)
  const [creatingPR, setCreatingPR] = createSignal(false)
  const [gitStatus, setGitStatus] = createSignal<{
    branch?: string
    changesCount: number
    isClean: boolean
  } | null>(null)
  const [hasRemote, setHasRemote] = createSignal(false)

  // Get GitHub project info for current directory
  const githubProject = githubProjects.get(sdk.directory)

  // Check if this is a GitHub project with PR info
  const hasPR = createMemo(() => {
    const project = githubProject()
    return project?.prNumber !== undefined && project?.prUrl !== undefined
  })

  // Check if this repo has a GitHub remote
  const checkRemote = async () => {
    try {
      const result = await sdk.client.github.remoteInfo({ directory: sdk.directory })
      setHasRemote(!!result.data)
    } catch {
      setHasRemote(false)
    }
  }

  // Refresh git status
  const [refreshingStatus, setRefreshingStatus] = createSignal(false)
  const refreshStatus = async () => {
    if (refreshingStatus()) return
    setRefreshingStatus(true)
    try {
      const result = await sdk.client.github.status({ directory: sdk.directory })
      if (result.data) {
        setGitStatus(result.data as any)
      }
    } catch {
      setGitStatus(null)
    } finally {
      setRefreshingStatus(false)
    }
  }

  // Push changes
  const handlePush = async () => {
    setPushing(true)
    try {
      const result = await sdk.client.github.push({
        body_directory: sdk.directory,
        message: `OpenCode: Changes from ${new Date().toLocaleString()}`,
      } as any)

      if (result.data) {
        showToast({
          title: "Pushed successfully",
          description: `Pushed to ${result.data.branch} (${result.data.sha.slice(0, 7)})`,
        })
        await refreshStatus()
      } else {
        throw new Error("Push failed")
      }
    } catch (error) {
      showToast({
        title: "Push failed",
        description: String(error),
      })
    } finally {
      setPushing(false)
    }
  }

  // Create Draft PR
  const handleCreateDraftPR = async () => {
    const project = githubProject()
    const currentModel = local.model.current()

    if (!currentModel) {
      showToast({
        title: "No AI model selected",
        description: "An AI model is required to generate the PR title and description.",
        variant: "error",
      })
      return
    }

    setCreatingPR(true)
    try {
      const status = gitStatus()

      // Check for differences between branch and base before proceeding
      if (project && status?.branch) {
        const diffResult = await sdk.client.github.diff({
          directory: sdk.directory,
          base: project.baseBranch,
          head: status.branch,
        })

        if (!diffResult.data?.trim()) {
          throw new Error("No changes detected between current branch and base branch. Nothing to create a Pull Request for.")
        }
      }

      let title
      let body

      // Generate PR message using AI
      try {
        const generated = await sdk.client.github.pullRequests.generateMessage({
          body_directory: sdk.directory,
          baseBranch: project?.baseBranch ?? "main",
          model: {
            providerID: currentModel.provider.id,
            modelID: currentModel.id,
          },
        } as any)
        if (generated.data?.title) title = generated.data.title
        if (generated.data?.body) body = generated.data.body
      } catch (e) {
        console.error("Failed to generate PR message", e)
        throw new Error("Failed to generate PR message using AI model.")
      }

      const result = await sdk.client.github.pullRequests.create({
        body_directory: sdk.directory,
        title,
        body,
        baseBranch: project?.baseBranch ?? "main",
      } as any)

      if (result.data) {
        // Update the GitHub project with PR info
        if (project) {
          githubProjects.setPR(sdk.directory, result.data.number, result.data.url)
        }

        showToast({
          title: "Pull Request created",
          description: `PR #${result.data.number}: ${result.data.title}`,
        })
      } else {
        throw new Error("Failed to create PR")
      }
    } catch (error: any) {
      let errorMessage = String(error)
      if (errorMessage.includes("Resource not accessible by personal access token")) {
        errorMessage =
          "GitHub token does not have permission to create pull requests. Please ensure your token has the 'repo' scope (for classic tokens) or 'Pull requests: Read & write' (for fine-grained tokens)."
      }

      showToast({
        title: "Failed to create PR",
        description: errorMessage,
      })
    } finally {
      setCreatingPR(false)
    }
  }

  // View existing PR
  const handleViewPR = () => {
    const project = githubProject()
    if (project?.prUrl) {
      window.open(project.prUrl, "_blank")
    }
  }

  // Initial load
  onMount(() => {
    checkRemote()
    refreshStatus()
    const interval = setInterval(refreshStatus, 5000)
    onCleanup(() => clearInterval(interval))
  })

  return (
    <Show when={hasRemote()}>
      <div class={`flex items-center gap-1 px-3 py-1.5 border-b border-border-base ${props.class ?? ""}`}>
        {/* Git Status Indicator */}
        <div class="flex items-center gap-2 mr-2">
          <Icon name="branch" size="small" class="text-icon-base" />
          <span class="text-12-regular text-text-weak">{gitStatus()?.branch ?? "..."}</span>
          <Show when={(gitStatus()?.changesCount ?? 0) > 0}>
            <span class="text-10-medium text-text-primary bg-surface-primary-base px-1.5 py-0.5 rounded-full">
              {gitStatus()?.changesCount}
            </span>
          </Show>
        </div>

        <div class="flex-1" />

        {/* Push Button */}
        <Tooltip placement="bottom" value="Commit and push changes">
          <Button
            variant="ghost"
            size="small"
            disabled={pushing() || gitStatus()?.isClean}
            onClick={handlePush}
            class="gap-1.5"
          >
            <Show when={pushing()} fallback={<Icon name="arrow-up" size="small" />}>
              <Spinner class="size-3" />
            </Show>
            Commit and Push
          </Button>
        </Tooltip>

        {/* Create/View PR Button */}
        <Show when={githubProject()}>
          <Show
            when={hasPR()}
            fallback={
              <Tooltip placement="bottom" value="Create a draft pull request">
                <Button
                  variant="ghost"
                  size="small"
                  disabled={creatingPR()}
                  onClick={handleCreateDraftPR}
                  class="gap-1.5"
                >
                  <Show when={creatingPR()} fallback={<Icon name="branch" size="small" />}>
                    <Spinner class="size-3" />
                  </Show>
                  Create PR
                </Button>
              </Tooltip>
            }
          >
            <Tooltip placement="bottom" value="View pull request on GitHub">
              <Button variant="ghost" size="small" onClick={handleViewPR} class="gap-1.5">
                <Icon name="share" size="small" />
                View PR
              </Button>
            </Tooltip>
          </Show>
        </Show>
      </div>
    </Show>
  )
}
