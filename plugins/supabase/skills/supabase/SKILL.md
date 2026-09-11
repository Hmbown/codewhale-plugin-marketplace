---
name: supabase
description: Manage Supabase projects — database schema and queries, migrations, auth users, storage, edge functions — through Supabase's official remote MCP server. Use when a task touches a Supabase project.
---

# Supabase

Remote MCP server: `https://mcp.supabase.com/mcp`.

## Prerequisites

`SUPABASE_ACCESS_TOKEN` in the environment — a personal access token from
Supabase dashboard → Account → Access Tokens. The token reaches every org
and project it can see; scope the work to one project_ref.

## Usage

- Start with `list_projects` / `list_organizations` to resolve the project
  the user means, then pass `project_id` explicitly — never guess a ref.
- Database tools can run SQL. Read-only queries are safe to run; migrations
  and destructive statements need the user's explicit go-ahead and a named
  project.
- Prefer `list_tables`/`execute_sql` inspection before proposing schema
  changes; cite what the live schema actually contains.

## Failure recovery

- `Unauthorized`: `SUPABASE_ACCESS_TOKEN` unset or expired — say so.
- Project-not-found: list projects and ask which ref the user means.
