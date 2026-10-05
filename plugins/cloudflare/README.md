# Cloudflare

Workflows for building on Cloudflare Workers with Codewhale, with a hard stop
before anything changes your account.

| Skill | Use it to |
| --- | --- |
| `cloudflare-workers` | write and configure a Worker, bindings, static assets; run it locally with `wrangler dev` and tests |
| `cloudflare-deploy` | deploy with Wrangler: preflight, dry run, a plan you approve, verification, rollback, secrets |
| `cloudflare-storage` | KV, R2 and D1: bindings, code, migrations, local versus remote data |
| `cloudflare-durable-objects` | SQLite-backed objects, RPC, WebSocket hibernation, alarms, class lifecycle |
| `cloudflare-pages-to-workers` | convert a Pages project to Workers with static assets |

Command: `/cloudflare-preflight [dir]` runs an offline checker over
`wrangler.jsonc|json|toml` (placeholder IDs, credentials in `vars`, Durable
Object classes with no lifecycle entry, future compatibility dates, local secret
files that are not gitignored). It needs `node` 18 or later; the skills do not.

## First task

After installing, reviewing, trusting and enabling the plugin, in a Worker
project ask:

> Run the Cloudflare preflight on this project, fix any errors in the Wrangler
> config, then do a dry run and show me what a deploy would do. Do not deploy.

Success: you get the preflight findings, a `wrangler deploy --dry-run` summary
and a question asking whether to deploy. Nothing is uploaded until you answer
yes.

## What it will and will not do

- It never runs `wrangler deploy`, `versions upload|deploy`, `rollback`,
  `secret put`, `--remote` data commands, or resource create/delete commands
  without your explicit yes in the conversation. `wrangler login` and API tokens
  stay with you; the plugin never asks you to paste a token.
- It declares no MCP server, no hooks and no network host. All commands run
  through your own Wrangler and your own Cloudflare login.
- Data destinations: whatever Wrangler sends to Cloudflare when you approve a
  command (code bundles, secrets you type into Wrangler, D1/KV/R2 data you
  approve writing). The preflight and dry run send nothing.

## Prerequisites

- Node.js and a project with Wrangler 4 or later (`npx wrangler --version`).
  `npx wrangler deploy --dry-run` may fetch Wrangler from npm if it is not
  installed.
- For deploys: a Cloudflare account and `wrangler login` (or
  `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` exported in your shell).

## Documentation lookup

Install `cloudflare-docs` as well. It is a separate plugin that searches
Cloudflare's official documentation MCP (`docs.mcp.cloudflare.com`, no
credential). The skills here tell the agent to use it for limits, flags and
config keys instead of memory. This plugin does not duplicate it.

## Provenance and license

The skills are original text written for this marketplace (MIT, see
`LICENSE`). Technical details were checked against Cloudflare's developer
documentation in October 2026; the pages-to-workers steps follow the structure
of Cloudflare's published migration guide, rewritten. Cloudflare publishes its
own agent skills at https://github.com/cloudflare/skills under Apache-2.0; none
of that text was copied here. If you want their deeper coverage (Agents SDK,
Sandbox SDK, Cloudflare One, Email Service), install those upstream skills
directly.

## Failure recovery

- Preflight says `no wrangler.jsonc ...`: you are not in the Worker project;
  pass the directory.
- Preflight reports `CF-UNPARSEABLE` for a TOML file: it uses a small parser; use
  the JSON form or run `npx wrangler deploy --dry-run`, which has the real parser.
- A deploy was refused or failed: the agent shows the Wrangler output and
  `wrangler deployments list` before proposing a fix.
