# Provider Architecture

## Overview

A **provider** is a remote service that provides resources (repositories, etc.). Currently only GitHub is supported, but architecture must support adding more providers (GitLab, Bitbucket, etc.) and multiple instances of each provider.

## Directory Structure

```
~/.opencode/
├── data/
│   └── project/
│       └── providers.json    # Provider configurations (may not exist)
└── opencode-workspaces/       # Cloned repositories
```

## providers.json Schema

```json
{
  "providers": [
    {
      "id": "gh_abc123",
      "type": "github",
      "appId": 123456,
      "slug": "opencode-host-abc",
      "clientId": "abc123",
      "clientSecret": "secret",
      "privateKey": "-----BEGIN RSA PRIVATE KEY-----...",
      "createdAt": 1738000000000
    }
  ]
}
```

- `id`: Unique identifier, auto-generated (e.g., `gh_` prefix for GitHub)
- `type`: Provider type (`github`, `gitlab`, etc.)
- Config stored per-provider. More fields added per type.

**Not** a list of installations/repositories. Repositories are stored in `workspace.json` at the workspace level.

## Routes

### GET /project/providers

List all configured providers.

```json
{
  "providers": [
    {
      "id": "gh_abc123",
      "type": "github",
      "configured": true,
      "appId": 123456,
      "slug": "opencode-host-abc",
      "clientId": "abc123"
    }
  ]
}
```

### POST /project/providers

Create a new provider setup flow.

```json
// Request
{ "type": "github", "organization": "myorg" }

// Response
{ "url": "https://github.com/settings/apps/new?manifest=..." }
```

### GET /project/providers/:providerId/callback

Handle provider callback (exchanges code for config, saves to providers.json).
Query: `?code=xxx&state=providerId`

### DELETE /project/providers/:providerId

Remove provider configuration.

### GET /project/providers/:providerId/installations

**Only for GitHub**. List app installations for that specific provider.

```json
[
  {
    "id": 99999,
    "account": { "login": "myuser", "avatar_url": "..." }
  }
]
```

### GET /project/providers/:providerId/repos

List repositories for a provider. Requires `installationId` query param.

```json
// ?installationId=123&query=myrepo&page=1&perPage=30
[
  { "id": 1, "name": "myrepo", "full_name": "myuser/myrepo", ... }
]
```

### GET /project/providers/:providerId/repos/:owner/:repo/branches

List branches for a repository under a provider.

```json
// ?installationId=123
[ { "name": "main", "protected": true }, ... ]
```

### POST /project/clone

Clone a repository using a provider.

```json
// Request
{
  "providerId": "gh_abc123",
  "installationId": 123,
  "owner": "myuser",
  "repo": "myrepo",
  "branch": "main"
}

// Response
{ "path": "/Users/.../opencode-workspaces/..." }
```

## UI Flow

### 1. Provider Selection Dialog

Shows:

- Local projects (existing workspaces from `opencode-workspaces/`)
- Configured providers (GitHub icon with account name/slug)
- "Add GitHub" button if no providers configured
- "Add Provider" dropdown for other types (future)

### 2. Provider Click → Installation Selection (GitHub)

- User clicks provider
- UI shows installation/account selector
- If no installations → show "Install on GitHub" button → opens GitHub app settings
- User selects installation → UI stores `installationId` in state

### 3. Installation → Repository Selection

- After selecting installation, show repos
- Search/filter repos
- User selects repo

### 4. Clone → Workspace Creation

- Clone repo to `opencode-workspaces/open-code-{kebab-repo}-{random}`
- Create `workspace.json` in workspace root:

```json
{
  "provider": {
    "id": "gh_abc123",
    "type": "github",
    "installationId": 123,
    "owner": "myuser",
    "repo": "myrepo"
  },
  "createdAt": 1738000000000
}
```

This binds the workspace to a specific provider + installation. Even if user removes provider config, workspace remembers which provider/installation it used.

### 5. Subsequent Opens

- On load, scan `opencode-workspaces/` for `workspace.json`
- Parse provider info to show "Last opened" projects
- When opening project, use stored `provider.id + installationId` for git operations

## What Should NOT Exist

- ❌ `github-keys.json` - PAT-based, removed
- ❌ `github-app.json` - replaced by `project/providers.json`
- ❌ `/keys/*` endpoints - removed, used PATs
- ❌ Installation "registration" as keys - removed, confusing
- ❌ Auto-creating keys from installations
- ❌ Storing repositories in providers.json
- ❌ Mixing git operations with provider config

## Simple GitHub Flow

1. User clicks "Add GitHub"
2. Frontend calls `/project/providers` (POST with type=github) → gets GitHub URL
3. User creates app on GitHub → redirects to `/project/providers/:providerId/callback?code=xxx`
4. Backend exchanges code → generates providerId → saves to `providers.json`
5. Backend fetches installations → returns to UI
6. User selects installation → shows repos
7. User selects repo → clones to workspace
8. Workspace saved with `provider.id` and `installationId`

## Implementation Plan

1. Create `src/project/provider.ts` - providers.json read/write
2. Create `src/project/providers/github.ts` - GitHub-specific (manifest/setup/callback)
3. Create `src/server/routes/project/index.ts` - provider CRUD routes
4. Move `github/app.ts` → `project/providers/github.ts`
5. Update UI to use new routes
6. Add `workspace.json` binding in existing workspace creation
7. Update "Open Project" to scan workspaces and parse provider info

## Example provider.json Generation

When GitHub callback is handled:

1. Generate providerId: `gh_${random6chars}` (e.g., `gh_abc123`)
2. Exchange manifest code with GitHub API
3. Get app config from GitHub response
4. Save to providers.json:

```json
{
  "providers": [
    {
      "id": "gh_abc123",
      "type": "github",
      "appId": 123456,
      "slug": "opencode-host-abc",
      "clientId": "abc123",
      "clientSecret": "secret_from_github",
      "privateKey": "pem_from_github",
      "createdAt": 1738000000000
    }
  ]
}
```
