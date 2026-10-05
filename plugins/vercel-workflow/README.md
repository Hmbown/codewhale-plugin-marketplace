# Vercel

Workflows for deploying and operating projects on Vercel with Codewhale, with a
hard stop before anything changes your account or goes live.

| Skill | Use it to |
| --- | --- |
| `vercel-deploy` | deploy: preview versus production, linking, Git and CLI flows, promote, rollback; always after your approval |
| `vercel-env-vars` | list, add, rotate and pull environment variables without exposing values |
| `vercel-logs-debug` | read build and runtime logs, reproduce a failed build locally, find the cause |
| `vercel-nextjs-config` | `next.config` versus `vercel.json`, proxy (formerly middleware), images, headers, functions, static-export pitfalls |

Command: `/vercel-preflight [dir]` runs an offline checker over `vercel.json`,
env file names, `package.json`, the Next.js config and the project link
(legacy `routes` mixed with rewrites, invalid crons, env files that are not
gitignored, secret-looking `NEXT_PUBLIC_` names, a project that is not linked,
`middleware` still present on Next.js 16). It needs `node` 18 or later; the
skills do not.

## First task

After installing, reviewing, trusting and enabling the plugin, in a project
ask:

> Run the Vercel preflight, fix any errors in the project config, run a local
> production build, and tell me what a preview deploy would do. Do not deploy.

Success: you get the preflight findings, the local build result and a question
asking whether to deploy a preview. Nothing is uploaded or published until you
answer yes.

## What it will and will not do

- It never runs `vercel`, `vercel --prod`, `promote`, `rollback`, `redeploy`,
  `remove`, any `vercel env` write, `link`, domain commands, or a `git push` to a
  connected repository without your explicit yes in the conversation. A new,
  unlinked project is called out because its first deployment is always
  production. `vercel login` and tokens stay with you; the plugin never asks you
  to paste a token or a secret value.
- It declares no MCP server, no hooks and no network host. Everything runs
  through your own Vercel CLI and login.
- Data destinations: whatever the Vercel CLI sends to Vercel when you approve a
  command (source files for a deployment, environment values you type into the
  CLI). The preflight, local builds and log reads do not deploy anything.

## Why there is no remote MCP here

Vercel's official MCP server (`https://mcp.vercel.com`) requires an OAuth
sign-in; an unauthenticated request is answered with HTTP 401. Codewhale
plugin bundles cannot complete OAuth, and the marketplace only ships remote MCP
endpoints that are public and credential-free, so this plugin includes none.
Vercel documentation is available as plain text without credentials by
appending `.md` to a docs URL, for example `https://vercel.com/docs/cli/env.md`,
and the skills point there for details that change.

## Prerequisites

- Node.js and the Vercel CLI (`npm i -g vercel`, or `npx vercel`).
- For anything that talks to your account: `vercel login` run by you, or
  `VERCEL_TOKEN` exported in your shell.
- A project directory; link it with `vercel link` (an approved action) before
  deploying.

## Provenance and license

The skills are original text written for this marketplace (MIT, see
`LICENSE`). Technical details were checked against Vercel's and Next.js's
public documentation in October 2026. No third-party skill text was copied: the
upstream `vercel-labs/agent-skills` repository carries no license file, so it was
not used. Vercel's own Claude Code plugin is a separate product and was not used.

## Failure recovery

- Preflight says `not a directory`: pass the project directory.
- `VC-NOT-LINKED`: the directory is not linked to a Vercel project; ask to link it
  (approved action) or confirm the intended project.
- A deploy failed: the agent reads `vercel inspect <url> --logs`, classifies the
  first real error and proposes a fix; it does not redeploy until you approve.
- A preview answers 401: that is Deployment Protection, not an outage; open it
  while signed in to Vercel.
