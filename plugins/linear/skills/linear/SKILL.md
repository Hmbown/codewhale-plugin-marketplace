---
name: linear
description: Query or update Linear — issues, projects, cycles, teams, comments — through Linear's official remote MCP server. Use when the task names a Linear issue, project, or cycle, or asks to file/triage work.
---

# Linear

Remote MCP server: `https://mcp.linear.app/mcp` (read-write). Linear also
hosts `https://mcp.linear.app/mcp/readonly` — point the bundle's `mcp.json`
there instead when the install should never mutate.

## Prerequisites

`LINEAR_API_KEY` in the environment (Linear → Settings → Security & access →
API). The key's Linear scopes are the tool's whole authority; a read-only
workflow should use a read-scoped key or the readonly endpoint.

## Usage

- Tools follow Linear's object model: `list_issues`, `get_issue`,
  `create_issue`, `update_issue`, `list_projects`, comments, documents.
- Prefer `list_issues` filters (team, state, label) over fetching and
  filtering client-side — the server-side filter is cheaper and returns
  stable identifiers.
- When the user names an issue like `ENG-123`, fetch it directly; do not
  list-search for it.

## Failure recovery

- `invalid_token` / 401: `LINEAR_API_KEY` is missing or expired. Say so and
  stop — do not retry in a loop.
- A write tool failing on permissions: the key lacks the scope; report what
  failed rather than working around it.
