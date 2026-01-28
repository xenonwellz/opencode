import { createStore, produce } from "solid-js/store"
import { batch, createContext, createMemo, ParentProps, useContext } from "solid-js"
import { Persist, persisted } from "@/utils/persist"

// ============================================================================
// Types
// ============================================================================

export interface GitHubProjectInfo {
  /** Local project ID (worktree path) */
  projectId: string
  /** Provider ID for GitHub App */
  providerId: string
  /** GitHub App installation ID */
  installationId: number
  /** GitHub repo owner */
  owner: string
  /** GitHub repo name */
  repo: string
  /** Original branch we cloned from */
  baseBranch: string
  /** Branch created for OpenCode work */
  workingBranch: string
  /** Created PR number (nullable) */
  prNumber?: number
  /** PR URL for viewing */
  prUrl?: string
}

interface GitHubProjectsStore {
  /** Map of projectId to GitHubProjectInfo */
  projects: Record<string, GitHubProjectInfo>
}

// ============================================================================
// Context
// ============================================================================

const GitHubProjectsContext = createContext<ReturnType<typeof createGitHubProjectsStore>>()

function createGitHubProjectsStore() {
  const [store, setStore, , ready] = persisted(
    Persist.global("github-projects", ["github-projects.v1"]),
    createStore<GitHubProjectsStore>({
      projects: {},
    }),
  )

  return {
    ready,

    /**
     * Get a GitHub project by its worktree path
     */
    get(projectId: string) {
      return createMemo(() => store.projects[projectId])
    },

    /**
     * Check if a project is a GitHub project
     */
    isGitHubProject(projectId: string) {
      return createMemo(() => !!store.projects[projectId])
    },

    /**
     * Register a new GitHub project after cloning
     */
    register(info: GitHubProjectInfo) {
      setStore("projects", info.projectId, info)
    },

    /**
     * Update a GitHub project (e.g., after creating PR)
     */
    update(projectId: string, updates: Partial<GitHubProjectInfo>) {
      const existing = store.projects[projectId]
      if (!existing) return

      setStore(
        produce((draft) => {
          const project = draft.projects[projectId]
          if (!project) return
          Object.assign(project, updates)
        }),
      )
    },

    /**
     * Set PR info after creating a draft PR
     */
    setPR(projectId: string, prNumber: number, prUrl: string) {
      const existing = store.projects[projectId]
      if (!existing) return

      batch(() => {
        setStore("projects", projectId, "prNumber", prNumber)
        setStore("projects", projectId, "prUrl", prUrl)
      })
    },

    /**
     * Remove a GitHub project (e.g., when project is deleted)
     */
    remove(projectId: string) {
      setStore(
        produce((draft) => {
          delete draft.projects[projectId]
        }),
      )
    },

    /**
     * Get all GitHub projects
     */
    list() {
      return createMemo(() => Object.values(store.projects))
    },
  }
}

// ============================================================================
// Provider & Hook
// ============================================================================

export function GitHubProjectsProvider(props: ParentProps) {
  const store = createGitHubProjectsStore()

  return <GitHubProjectsContext.Provider value={store}>{props.children}</GitHubProjectsContext.Provider>
}

export function useGitHubProjects() {
  const context = useContext(GitHubProjectsContext)
  if (!context) {
    throw new Error("useGitHubProjects must be used within a GitHubProjectsProvider")
  }
  return context
}
