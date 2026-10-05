---
name: vercel-deploy
description: Deploy a project to Vercel safely. Preview versus production, project linking, vercel CLI and Git-based flows, promote, rollback. Never deploys without the user's explicit approval. Use for any request to deploy, ship, publish, promote or roll back on Vercel.
---

# Vercel: deploy with approval

**Hard rule.** Never run a command from the "needs approval" list until the
user has, in this conversation, said yes to that specific action after you
showed them the command, the team and project it targets, whether it is a
preview or production deployment, and what it changes. An earlier yes does not
cover a later, different command.

Pushing a commit is a deploy when the project has Git integration: a push to the
production branch (usually `main`) creates a production deployment, and a push
to any other branch creates a preview. Treat `git push`, merging a pull request
and `vercel --prod` the same way.

## Preview versus production

| | Preview | Production |
| --- | --- | --- |
| Created by | `vercel`, `vercel deploy`, push to a non-production branch, a PR | `vercel --prod`, `vercel deploy --target=production`, push to the production branch, promoting a deployment |
| URL | unique per deployment (and a branch URL) | your production domains |
| Env vars | Preview environment (optionally per branch) | Production environment |
| Risk | low, but may still run build hooks and write to shared services | real users, real data |

**The first deployment of a brand-new project is always production**, even if
you omit `--prod`. So `vercel` run in a directory that is not yet linked to a
project can create the project and make a production deployment. Check for
`.vercel/project.json` first (the `/vercel-preflight` command reports it); if it
is absent, say so and ask before linking or creating anything. Never use
`--yes` to skip the project-setup questions without approval; it answers them
with guessed defaults.

Custom environments (for example `staging`) are targeted with
`vercel deploy --target=staging`.

## Commands by risk

Safe without approval (local or read-only):

- `vercel --version`, `vercel whoami`, `vercel list`, `vercel inspect <url>`
- `vercel logs ...` (read-only; see `vercel-logs-debug`)
- `vercel deploy --dry` (CLI 59.x: reports the detected framework preset and the
  files that would be uploaded, without creating a deployment; it needs the user
  to be logged in, and you should confirm with `vercel deploy --help` on their
  version)
- `vercel build` (builds locally into `.vercel/output`; needs `vercel pull` first)
- `vercel env ls` (names and types, not values); `vercel env run -- <cmd>` with
  the default Development values (production or preview values go to the
  command's process, so ask first)
- `/vercel-preflight`

Needs approval (changes the account, creates a deployment, or writes secrets):

- `vercel`, `vercel deploy` (preview), `vercel --prod` (shorthand for
  `--target=production`), `vercel deploy --prebuilt`, and `vercel deploy
  --temporary` (uploads the source to a temporary public deployment without a
  login)
- `vercel link`, `vercel project add|rm`, `vercel git connect`
- `vercel promote`, `vercel rollback`, `vercel redeploy`, `vercel remove`
- `vercel env add|update|rm`, and `vercel env pull` / `vercel pull` (they write
  environment values to files on disk; use `vercel env run` when you only need
  them for one command)
- `vercel domains ...`, `vercel alias ...`, `vercel dns ...`, `vercel certs ...`
- `vercel login` and anything that opens a browser OAuth flow: the user does this
- `git push` / opening or merging a PR on a Vercel-connected repository
- Vercel MCP tools that deploy, change settings, or buy anything

Never ask for a Vercel token in chat and never print one. Authentication is the
user's `vercel login` or a `VERCEL_TOKEN` they export themselves. A Vercel
command run without credentials may start a browser login flow instead of
failing; if you see "No existing credentials found", stop and tell the user to
run `vercel login`. Do not drive the login yourself.

Agent-run CLIs are non-interactive by default (`--non-interactive`), so prompts
fail instead of waiting. Do not "fix" that by adding `--yes`; ask the user.

## Workflow

1. **Preflight.** Run `/vercel-preflight`. Fix errors; explain warnings.
2. **Identify the target.** `vercel whoami`, then read `.vercel/project.json`
   (project name and org) or the Git remote. State team, project and branch. If
   the team is ambiguous, ask.
3. **Build and test** locally with the project's own commands. To reproduce
   Vercel's build: `vercel pull --environment=preview` then `vercel build`
   (`--environment=production` and `vercel build --prod` for production
   settings). Pulling writes env files under `.vercel/`; keep them gitignored.
4. **Choose preview first.** Even for a production release, deploy a preview,
   verify it, then promote or merge. Say that in the plan.
5. **Ask.** Present a short plan:
   - exact command, team/project, environment (preview, production, custom)
   - what changes: new deployment, domains, env vars, build cache (`--force`)
   - how you will verify, and how to roll back
   Then stop and wait for an explicit yes.
6. **Run only the approved command.** `vercel` prints the deployment URL on
   stdout; use `--logs` if you need build logs, `--no-wait` only if asked.
7. **Verify.** `vercel inspect <url>` for status. Request the URL with `curl -sS -o
   /dev/null -w "%{http_code}\n" <url>`. A preview behind Deployment Protection
   answers 401 or redirects to login: that is expected. Do not disable protection
   or generate bypass links; ask the user to open it signed in, or to use the
   documented `vercel curl` helper themselves.
8. **Report** the deployment URL and ID from the command output. If it failed,
   show the error text, run `vercel inspect <url> --logs`, and only then propose
   a fix.

## Promote and rollback

- `vercel promote <deployment-url-or-id>` makes an existing deployment the
  current production deployment (promoting a preview creates a production
  deployment and asks for confirmation; `--yes` bypasses it, so do not add it
  without approval). `vercel promote status` shows pending promotions.
- `vercel rollback [deployment-url-or-id]` points production back at an earlier
  deployment. On the Hobby plan only the previous production deployment is
  eligible. `vercel rollback status` shows pending rollbacks. To undo a
  rollback, `vercel promote` a deployment.
- A rollback restores code and its build-time configuration, not data. Database
  changes made by the bad release are not reverted.

## Prebuilt deploys

`vercel build` followed by `vercel deploy --prebuilt` (optionally
`--archive=tgz` for thousands of files) deploys local build output. System
environment variables such as `VERCEL_ENV` are missing at build time then, so
use Git-based or plain `vercel` deploys if the build reads them.

## If the user did not approve

Say what was done (preflight, local build), what was not, and the exact command
they can run or approve. Do not deploy "to see if it works".
