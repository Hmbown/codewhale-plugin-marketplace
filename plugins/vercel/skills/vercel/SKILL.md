---
name: vercel
description: Inspect and manage Vercel projects, deployments, domains, env vars and logs through Vercel's official remote MCP server. Use for deployment state, build logs, or project configuration on Vercel.
---

# Vercel

Remote MCP server: `https://mcp.vercel.com`.

## Prerequisites

`VERCEL_TOKEN` in the environment — a token from Vercel → Account → Tokens,
scoped to the team that owns the project. The tools act with the token's
whole authority across that team's projects.

## Usage

- Resolve the project first (list/search), then act on the deployment or
  domain by id — names are not unique across teams.
- Log and deployment-inspection tools are the reliable read path; use them
  before suggesting config changes.
- Redeploy/delete actions are real production state — confirm scope and
  target id with the user first.

## Failure recovery

- `invalid_token`: `VERCEL_TOKEN` unset or expired — say so and stop.
- Team-scope errors mean the token cannot see the project; report it rather
  than guessing ids.
