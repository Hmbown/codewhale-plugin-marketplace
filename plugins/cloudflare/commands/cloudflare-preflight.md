---
description: Offline legacy-config check; typed cf config is explicitly unvalidated
usage: /cloudflare-preflight [project-dir]
---

$ARGUMENTS

Run the plugin's static checker on the project (default: the current workspace).
Find the installed plugin root with `/plugin show cloudflare`, then:

```
node <plugin-root>/scripts/preflight.mjs <project-dir>
```

Add `--json` for machine-readable output.

- It reads `wrangler.jsonc`, `wrangler.json` or `wrangler.toml` and the project
  tree. When cloudflare.config.ts is present, it returns2/unvalidated before
  reading any legacy config. It never imports TypeScript, invokes a CLI, touches
  the network or prints the
  value of a credential-shaped string.
- Report every ERROR and WARN to the user in plain language with the file and
  key; fix errors that are in files you were asked to change.
- A clean result only means no known static problems. It is not a deploy
  approval and does not prove the deploy will succeed. Deploying still follows
  the `cloudflare-deploy` skill: dry run, plan, explicit yes.
- Exit status 0 = no errors, 1 = errors, 2 = no supported static config (including typed cf config). For typed config,
  read the module, run the project tests and use `cf build`/`cf deploy --dry-run`.
  If node
  is not installed, say so and review the config by hand against the same list.
