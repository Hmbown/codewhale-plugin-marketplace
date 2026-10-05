---
name: cloudflare-deploy
description: Deploy or change a Cloudflare Worker with Wrangler safely. Preflight, dry-run, show the plan, wait for the user's explicit approval, deploy, verify, roll back. Use for wrangler deploy, versions, secrets, rollbacks and environments.
---

# Cloudflare: deploy with approval

**Hard rule.** Never run a command from the "needs approval" list until the user
has, in this conversation, said yes to that specific action after you showed
them the command, the Worker name, the account, and what it will change. An
earlier yes does not cover a later, different command. Pushing to a branch that
a Cloudflare Workers Build deploys from is a deploy: treat it the same way.

## Commands by risk

Safe without approval (local or read-only):

- `npx wrangler --version`, `npx wrangler whoami`, `npx wrangler types`
- `npx wrangler dev` (local), `npx wrangler deploy --dry-run`
- `npx wrangler d1 migrations list <db> --local`, `... apply <db> --local`
- reading deployments: `npx wrangler deployments list`, `npx wrangler versions list`
- the `/cloudflare-preflight` check

Needs approval (changes the account, costs money, or is hard to undo):

- `wrangler deploy`, `wrangler versions upload`, `wrangler versions deploy`,
  `wrangler rollback`, `wrangler delete`
- `wrangler secret put|delete|bulk`, `wrangler versions secret ...`
- any `--remote` command: `d1 execute|migrations apply --remote`,
  `kv key put|delete --remote`, `r2 object put|delete`
- creating or deleting resources: `kv namespace create|delete`,
  `d1 create|delete`, `r2 bucket create|delete`, `queues create`
- `wrangler login` and anything that opens a browser OAuth flow: the user does
  this themselves
- `wrangler tail` against production (it reads live traffic; say what it will
  show, and bound it with a timeout)

Never ask the user to paste an API token into the chat and never print one. If
authentication is missing, tell the user to run `wrangler login` or to export
`CLOUDFLARE_API_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID`) in their own shell.

## Workflow

1. **Preflight.** Run `/cloudflare-preflight`. Fix errors; explain warnings.
2. **Identify the target.** Run `npx wrangler whoami` and read `name`,
   `account_id`, `routes` and `env` from the config. If several accounts are
   listed and the config has no `account_id`, stop and ask which one.
3. **Build and test** the project the way its `package.json` defines.
4. **Dry run.** `npx wrangler deploy --dry-run [--env <name>]`. Report bundle
   size, bindings, and anything created automatically. Recent Wrangler versions
   can provision a resource for a binding that has no ID; call that out.
5. **Ask.** Present a short plan:
   - exact command, Worker name, environment, account
   - what changes: new version, routes/domains, bindings, migrations
   - how you will verify, and how to roll back
   Then stop and wait for an explicit yes.
6. **Deploy** only the command the user approved.
7. **Verify.** Request the deployed URL (`curl -sS -o /dev/null -w "%{http_code}\n"`),
   check the path that changed, and read `npx wrangler deployments list`. If
   observability is on, point the user to the Workers Logs view rather than
   tailing production.
8. **Report** the version ID and URL from the command output. If it failed, show
   the error text and the state check (`deployments list`) before suggesting a fix.

## Gradual rollouts and rollback

- `wrangler versions upload` creates a version that serves no traffic.
  `wrangler versions deploy` then splits traffic (interactive percentages). Use
  this for risky changes; ask before each step.
- `wrangler rollback [version-id]` immediately creates a new deployment of an
  older version across all routes. It does not restore data. Offer it, but run
  it only on approval.
- Durable Object class changes (create, rename, delete, transfer) cannot be
  uploaded as a version and cannot be rolled back past; they go through a plain
  `wrangler deploy` on their own, separate from other code changes. See
  cloudflare-durable-objects.

## Secrets and environments

- Production secrets: `npx wrangler secret put NAME` prompts for the value in
  the user's terminal. You do not see or relay it. List names only with
  `wrangler secret list`.
- Declare required secret names in the config (`"secrets": {"required": [...]}`)
  so deploy fails clearly when one is missing.
- Use named environments (`--env staging`) or a separate Worker for staging;
  never test a risky change by deploying it over production.
- Containers: deploying a Worker with a container config can roll running
  container instances; do not deploy a feature branch over a production Worker.

## If the user did not approve

Say what was done (preflight, dry run), what was not, and the exact command they
can run or approve. Do not deploy "to check".
