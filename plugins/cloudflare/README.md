# Cloudflare

Workflows for building on Cloudflare Workers with Codewhale, with a hard stop
before anything changes your account.

| Skill | Use it to |
| --- | --- |
| `cloudflare-workers` | write and configure a Worker, bindings, static assets; run it locally with `cf dev` and tests |
| `cloudflare-deploy` | deploy with cf: preflight, dry run, a plan you approve, verification, rollback, secrets |
| `cloudflare-storage` | KV, R2 and D1: bindings, code, migrations, local versus remote data |
| `cloudflare-durable-objects` | SQLite-backed objects, RPC, WebSocket hibernation, alarms, class lifecycle |
| `cloudflare-pages-to-workers` | convert a Pages project to Workers with static assets |

Command: `/cloudflare-preflight [dir]` runs an offline checker over
`wrangler.jsonc|json|toml` (placeholder IDs, credentials in `vars`, Durable
Object classes with no lifecycle entry, future compatibility dates, local secret
files that are not gitignored). It needs Node18+. If `cloudflare.config.ts`
is present, it reports typed config as unvalidated, never evaluates it and
never treats a stale legacy config as authoritative. Read the module, then
use project tests, `cf build` and `cf deploy --dry-run`.

## First task

After installing, reviewing, trusting and enabling the plugin, in a Worker
project ask:

> Run the Cloudflare preflight on this project, review the active Cloudflare
> config, then do a dry run and show me what a deploy would do. Do not deploy.

Success: you get the preflight findings, a `cf deploy --dry-run` summary
and a question asking whether to deploy. Nothing is uploaded until you answer
yes.

## Account actions and prerequisites

- Authored commands use Cloudflare's `cf` CLI (or its `cloudflare` alias if cf
  is another installed tool). Pin it in the project. Typed config needs
  Node22.18+; Bun does not load it. The adapter can still use an official
  compatibility delegate internally.
- Start from `cloudflare.config.ts`; preview legacy migration with
  `cf migrate --dry-run`, review the conversion and preserve identities/data.
- Deployment, version uploads/traffic changes, rollback, remote writes,
  resource creation/deletion and secret mutations need explicit approval for
  the target/change. Existing approval persists within its agreed scope.
- Authentication stays in your terminal: `cf auth login`, then `cf auth whoami`.
  The plugin never asks for tokens in chat or prints secret values. Secret
  inputs must stay out of arguments, logs and transcripts.
- No MCP server, hooks or network host is declared. The preflight itself is
  offline and never executes project config. cf commands use your own account;
  the documented dry run uploads nothing. Reviewed real commands can send
  code, data or user-entered secrets to Cloudflare after approval.

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
  a reviewed cf migration and its official build/dry-run path; never evaluate
  unreviewed TypeScript just to make a static checker green.
- A deploy was refused or failed: the agent shows the cf output and
  `cf workers deployments list` before proposing a fix.

CLI reference: https://developers.cloudflare.com/cf/.
