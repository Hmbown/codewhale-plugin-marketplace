---
name: vercel-env-vars
description: Manage Vercel environment variables safely. Environments, vercel env ls/add/update/rm/pull/run, sensitive variables, NEXT_PUBLIC exposure, when changes take effect. Use when adding, rotating, auditing or pulling Vercel env vars.
---

# Vercel environment variables

Secrets are the highest-risk thing this skill touches. Rules first:

1. Never print, log, echo or paste a variable's value into the chat, a commit, a
   command line or a file in the repository. Refer to variables by name.
2. Never ask the user to paste a secret into the chat. Tell them to run the
   command that prompts for the value in their own terminal.
3. Any write (`add`, `update`, `rm`, `--force`) changes the user's project and
   needs a yes from the user in this conversation for that specific variable,
   environment and project. Reads of names (`vercel env ls`) do not.

## Environments

| Environment | Used by | Notes |
| --- | --- | --- |
| Production | production deployments (an approved production deploy, or a push to the production branch) | |
| Preview | every non-production deployment; can be limited to one Git branch | a branch-specific value overrides the general Preview one |
| Development | `vercel dev`, `vercel env pull` | not used by deployments |
| Custom (for example `staging`) | deployments targeting that environment | can import from another environment |

- Changes apply only to **new** deployments. An existing deployment keeps the
  values it was built with; redeploy to pick up a change.
- Total size is 64 KB per deployment; Edge Runtime code is limited to 5 KB per
  variable.
- The CLI stores production, preview and custom variables as
  **sensitive** by default (value cannot be read back from the dashboard or
  CLI). Development variables stay encrypted. `--no-sensitive` opts out, which
  a team policy may forbid; do not use it without approval.
- Variables reach code as `process.env.NAME`. Vercel also sets system variables
  such as `VERCEL_ENV` (`production`, `preview`, `development`), `VERCEL_URL`
  (no protocol), `VERCEL_PROJECT_PRODUCTION_URL`, and `VERCEL_GIT_COMMIT_REF`.

## Public prefixes expose values to browsers

Frameworks inline variables with a public prefix (`NEXT_PUBLIC_`, `VITE_`,
`PUBLIC_`, `NUXT_PUBLIC_`, `REACT_APP_`, `EXPO_PUBLIC_`) into client bundles at
**build time**. Rules:

- Never put a secret, private key, service-role key or password under a public
  prefix. A publishable or anon key is fine by design.
- Changing a public variable requires a rebuild, not just a restart.
- `/vercel-preflight` flags public-prefixed names that look secret.

## Commands

```bash
vercel env ls                        # names, environments, types (no values for sensitive ones)
vercel env ls preview feature-x      # one environment, one branch
vercel env pull .env.local           # writes DEVELOPMENT values to a file (secrets on disk)
vercel env pull .env.preview.local --environment=preview --git-branch=feature-x
vercel env run -- next dev           # run a command with Development values, nothing written
vercel env run -e preview -- npm test
vercel env add API_TOKEN production  # prompts for the value in the user's terminal
vercel env update API_TOKEN production
vercel env rm OLD_TOKEN production
```

- Prefer `vercel env run -- <cmd>` over `pull` when the values are only needed for
  one command: nothing is written to disk.
- `vercel env pull` merges into an existing file and keeps local-only entries.
  Before pulling, confirm the target file is covered by `.gitignore`
  (`.env*.local` is the usual pattern). Sensitive values that Vercel cannot
  return are written as placeholders.
- Never put a secret in a pipe or argument (`echo $SECRET | vercel env add ...`):
  it lands in shell history. Let the CLI prompt, or redirect from a file the user
  controls (`vercel env add NAME production < secret.txt`), and tell the user to
  delete that file afterward.
- Rotating a secret: add the new value with the provider first, `vercel env
  update`, redeploy, verify, then revoke the old one. Each step is a separate
  approval-worthy action.
- `vercel env rm` on a variable still in use breaks the next deployment; check
  usage in code first (`grep -rn "process.env.NAME"`).

## Auditing

To audit without reading values: `vercel env ls`, then compare names against what
the code reads (`grep -rhoE "process\.env\.[A-Z0-9_]+" --include=*.{ts,tsx,js,jsx,mjs}`)
and against `.env.example`. Report variables that are used but not defined for an
environment, defined but unused, and secret-looking names with a public prefix.

## Done means

Names were checked or changed as approved, no value appeared in output or files,
and the user knows which deployments still need a redeploy to see the change.
