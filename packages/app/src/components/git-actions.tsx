import { Component, createMemo, createSignal, onMount, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { useSDK } from "@/context/sdk"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { getFilename } from "@opencode-ai/util/path"

interface GitActionsProps {
    class?: string
}

interface GitHubKey {
    id: string
    name: string
    type: "classic" | "fine-grained"
    createdAt: number
}

export const GitActions: Component<GitActionsProps> = (props) => {
    const sdk = useSDK()
    const dialog = useDialog()

    const [pushing, setPushing] = createSignal(false)
    const [creatingPR, setCreatingPR] = createSignal(false)
    const [githubKeys, setGithubKeys] = createSignal<GitHubKey[]>([])
    const [gitStatus, setGitStatus] = createSignal<{
        branch?: string
        changesCount: number
        isClean: boolean
    } | null>(null)
    const [hasRemote, setHasRemote] = createSignal(false)

    // Get the first available GitHub key
    const githubKey = createMemo(() => {
        const keys = githubKeys()
        return keys[0]
    })

    const hasGitHubKey = createMemo(() => !!githubKey())

    // Fetch GitHub keys
    const fetchKeys = async () => {
        try {
            const result = await sdk.client.github.keys.list({ directory: sdk.directory })
            if (result.data) {
                setGithubKeys(result.data as GitHubKey[])
            }
        } catch {
            setGithubKeys([])
        }
    }

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
    const refreshStatus = async () => {
        try {
            const result = await sdk.client.github.status({ directory: sdk.directory })
            if (result.data) {
                setGitStatus(result.data)
            }
        } catch {
            setGitStatus(null)
        }
    }

    // Push changes
    const handlePush = async () => {
        const key = githubKey()
        if (!key) {
            showToast({
                title: "No GitHub key configured",
                description: "Add a GitHub personal access token first.",
            })
            return
        }

        setPushing(true)
        try {
            const result = await sdk.client.github.push({
                keyID: key.id,
                body_directory: sdk.directory,
                message: `OpenCode: Changes from ${new Date().toLocaleString()}`,
            })

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

    // Create PR
    const handleCreatePR = async () => {
        const key = githubKey()
        if (!key) {
            showToast({
                title: "No GitHub key configured",
                description: "Add a GitHub personal access token first.",
            })
            return
        }

        setCreatingPR(true)
        try {
            const status = gitStatus()
            const projectName = getFilename(sdk.directory)

            const result = await sdk.client.github.pullRequests.create({
                keyID: key.id,
                body_directory: sdk.directory,
                title: `OpenCode: Changes to ${projectName}`,
                body: `Automated PR created by OpenCode.\n\nBranch: ${status?.branch || "unknown"}`,
                baseBranch: "main", // TODO: Get target branch from project config
            })

            if (result.data) {
                showToast({
                    title: "PR created",
                    description: `PR #${result.data.number}: ${result.data.title}`,
                })
            } else {
                throw new Error("Failed to create PR")
            }
        } catch (error) {
            showToast({
                title: "Failed to create PR",
                description: String(error),
            })
        } finally {
            setCreatingPR(false)
        }
    }

    // View existing PR
    const handleViewPR = async () => {
        const key = githubKey()
        if (!key) return

        try {
            const result = await sdk.client.github.pullRequests.get({
                keyID: key.id,
                directory: sdk.directory,
            })

            if (result.data) {
                window.open(result.data.url, "_blank")
            } else {
                showToast({
                    title: "No PR found",
                    description: "No pull request exists for the current branch.",
                })
            }
        } catch (error) {
            showToast({
                title: "Failed to get PR",
                description: String(error),
            })
        }
    }

    // Initial load
    onMount(() => {
        fetchKeys()
        checkRemote()
        refreshStatus()
    })

    return (
        <Show when={hasRemote() && hasGitHubKey()}>
            <div
                class={`flex items-center gap-1 px-3 py-1.5 border-b border-border-base ${props.class ?? ""}`}
            >
                {/* Git Status Indicator */}
                <div class="flex items-center gap-2 mr-2">
                    <Icon name="branch" size="small" class="text-icon-base" />
                    <span class="text-12-regular text-text-weak">
                        {gitStatus()?.branch ?? "..."}
                    </span>
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
                        Push
                    </Button>
                </Tooltip>

                {/* Create PR Button */}
                <Tooltip placement="bottom" value="Create a pull request">
                    <Button
                        variant="ghost"
                        size="small"
                        disabled={creatingPR()}
                        onClick={handleCreatePR}
                        class="gap-1.5"
                    >
                        <Show when={creatingPR()} fallback={<Icon name="branch" size="small" />}>
                            <Spinner class="size-3" />
                        </Show>
                        Create PR
                    </Button>
                </Tooltip>

                {/* View PR Button */}
                <Tooltip placement="bottom" value="View existing pull request">
                    <Button variant="ghost" size="small" onClick={handleViewPR} class="gap-1.5">
                        <Icon name="share" size="small" />
                        View PR
                    </Button>
                </Tooltip>
            </div>
        </Show>
    )
}
