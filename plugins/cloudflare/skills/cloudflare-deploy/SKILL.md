---
name: cloudflare-deploy
description: Deploy or change a Cloudflare Worker with cf. Review config, preflight, build and dry-run; show the target and change, obtain explicit approval, deploy and verify. Covers versions, secrets, rollback and named modes.
---

# Cloudflare: deploy with approval

**Hard rule.** Never run a command from the "needs approval" list unless the
user has approved that account, target and change after seeing a concrete plan.
Respect approval already granted for that same scope; a different target,
data change or traffic change needs its own approval. A push to a branch that
Workers Builds deploys is a deploy too.

## Commands by risk

Safe without approval (local or read-only):

- `cf --version`, `cf auth whoami`
- `cf dev`, `cf build`, `cf deploy --dry-run`, `cf migrate --dry-run`
- reading deployments: `cf workers deployments list`
- listing secret names: `cf workers secrets list` (never secret values)
- supported resource simulations with explicit `--local`
- `/cloudflare-preflight` (legacy JSON/TOML; typed config is not evaluated)

Needs approval (changes the account, data, money or traffic):

- `cf deploy`, `cf workers versions create` (upload),
  `cf workers deployments create`, `cf workers triggers deploy`, rollback,
  or deletion of a Worker/version/deployment
- `cf workers secrets update` or `cf workers secrets delete`
- remote D1 queries or migrations that write, KV/R2 writes or deletes, and
  creating/deleting resources; cf API commands are remote unless their
  documented `--local` mode was explicitly selected
- `cf auth login`: the user completes the authentication flow
- reading production traffic/logs: explain the scope and bound its duration

Use anonymous `cf cli search "<action and resource type>"` queries to discover
resource commands, then inspect the returned command with `--help` and its
`cf schema` entry. Never put names, domains, IDs, email addresses or credentials
in command-search queries. Search can return an upload command for a local
build request: that is still a mutation, not a substitute for `cf build`.

Never ask for an API token in chat or print one. Authentication stays in the
user's terminal through `cf auth login` or their environment. Secret updates
must use a documented input mechanism that keeps values out of command
arguments, logs and transcripts; if unavailable, let the user enter them
outside the agent session. Never invent a `cf secret put` compatibility alias.

## Workflow

1. Read `cloudflare.config.ts` and source before executing it. For a legacy
   project, preview `cf migrate --dry-run`, review the local conversion, and
   preserve existing resource IDs, domains, schedules and storage.
2. Run `/cloudflare-preflight` if applicable. Typed TypeScript is executable;
   the static checker reports it as unvalidated and never imports it.
3. Identify the exact Worker, account and named mode. Read `cf auth whoami`
   and configuration; `CLOUDFLARE_ACCOUNT_ID` can override `accountId`.
   Resolve an ambiguous account before any mutation. Pass `--mode <name>`
   consistently when configuration depends on it.
4. Run project tests, `cf build`, then `cf deploy --dry-run [--mode <name>]`.
   Inspect the actual entry, assets, bindings, lifecycle changes and warnings.
   A dry run uploads nothing; it does not prove production will work.
5. Present the exact deployment command, account/Worker/mode, code and traffic
   changes, any new resources or migrations, verification and rollback plan.
   Obtain explicit yes for any scope not already approved.
6. Run only the approved deployment. Request the changed routes and inspect
   `cf workers deployments list`; record version/deployment IDs and URL.
   If it fails, retain the error and actual state before planning a retry.

## Versions, rollback, secrets and data

Uploading a version (`cf workers versions create`) and assigning traffic
(`cf workers deployments create`) are separate mutations. Discover exact flags
and schema for the installed cf version; do not translate Wrangler flags by
renaming the executable. A rollback assigns an older version to traffic and
never restores storage. It needs approval and a state check.

Durable Object creation/rename/delete/transfer can be irreversible. Review the
lifecycle diff and deploy it separately with approval; do not assume a gradual
rollout or rollback can undo it. See `cloudflare-durable-objects`.

Use named `--mode` values or a separate staging Worker. Do not test by deploying
over production. Container config can roll running instances. Keep required
secret names declared with the project's current typed configuration API;
values never belong in source or chat. Remote database migrations require
reviewed SQL, backup/restore planning and approval.

References: [cf sign-in/account selection](https://developers.cloudflare.com/cf/get-started/), [migration reference](https://developers.cloudflare.com/cf/wrangler/reference/), [projects and deployment](https://developers.cloudflare.com/cf/projects/).
