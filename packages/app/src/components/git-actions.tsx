import { Component, createMemo, createSignal, onMount, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { useSDK } from "@/context/sdk"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { getFilename } from "@opencode-ai/util/path"
import { useGitHubProjects } from "@/context/github-projects"

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
    const githubProjects = useGitHubProjects()

    const [pushing, setPushing] = createSignal(false)
    const [creatingPR, setCreatingPR] = createSignal(false)
    const [githubKeys, setGithubKeys] = createSignal<GitHubKey[]>([])
    const [gitStatus, setGitStatus] = createSignal<{
        branch?: string
        changesCount: number
        isClean: boolean
    } | null>(null)
    const [hasRemote, setHasRemote] = createSignal(false)

    // Get GitHub project info for current directory
    const githubProject = createMemo(() => {
        const project = githubProjects.get(sdk.directory)
        return project()
    })

    // Get the first available GitHub key (prefer from project, fallback to list)
    const githubKey = createMemo(() => {
        const project = githubProject()
        if (project) {
            // Return a minimal key object from the stored project
            return { id: project.keyId, name: "", type: "classic" as const, createdAt: 0 }
        }
        const keys = githubKeys()
        return keys[0]
    })

    const hasGitHubKey = createMemo(() => !!githubKey())

    // Check if this is a GitHub project with PR info
    const hasPR = createMemo(() => {
        const project = githubProject()
        return project?.prNumber !== undefined && project?.prUrl !== undefined
    })

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

    // Create Draft PR
    const handleCreateDraftPR = async () => {
        const key = githubKey()
        const project = githubProject()

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
                baseBranch: project?.baseBranch ?? "main",
            })

            if (result.data) {
                // Update the GitHub project with PR info
                if (project) {
                    githubProjects.setPR(sdk.directory, result.data.number, result.data.url)
                }

                showToast({
                    title: "Draft PR created",
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
    const handleViewPR = () => {
        const project = githubProject()
        if (project?.prUrl) {
            window.open(project.prUrl, "_blank")
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
