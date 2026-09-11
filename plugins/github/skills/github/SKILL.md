---
name: github
description: Work with GitHub repositories, issues, pull requests, Actions runs, releases and code search through GitHub's official remote MCP server. Use for org-wide queries, repos that are not checked out locally, or when the gh CLI is unavailable.
---

# GitHub

Remote MCP server: `https://api.githubcopilot.com/mcp/`.

## Prerequisites

`GITHUB_PERSONAL_ACCESS_TOKEN` in the environment. Create a fine-grained PAT
scoped to the repositories and permissions the work needs — the MCP surface
inherits the token's whole authority, so do not hand it a broad classic PAT
for narrow work.

## Usage

- Prefer the local `gh` CLI when a checkout exists and the task is local —
  it respects the user's existing auth and stays off the network for local
  state. Use this server for cross-repo queries, org search, and hosts where
  `gh` is not installed or not authenticated.
- Toolsets can be narrowed in the plugin's `mcp.json` via the
  `X-MCP-Toolsets` header (e.g. `repos,issues,pull_requests`) when a
  smaller surface is wanted at review time.
- For read-mostly work consider the `/mcp/readonly` endpoint instead.

## Failure recovery

- 401 `bad request: missing required Authorization header`: the env var is
  unset — name it in the report.
- 403 / resource-not-accessible: the PAT lacks scope or SSO authorization;
  report rather than retry.
- Rate limits: back off and say the budget was hit; do not fan out retries.
