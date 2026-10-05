---
description: Offline check of a Vercel project's config, env files and Next.js setup before any deploy
usage: /vercel-preflight [project-dir]
---

$ARGUMENTS

Run the plugin's static checker on the project (default: the current workspace).
Find the installed plugin root with `/plugin show vercel-workflow`, then:

```
node <plugin-root>/scripts/preflight.mjs <project-dir>
```

Add `--json` for machine-readable output.

- It reads `vercel.json`, env file names, `package.json`, the Next.js config as
  text and `.vercel/project.json`. It never runs the Vercel CLI, never evaluates
  `vercel.ts` or `next.config`, never touches the network, and never prints the
  value of a credential-shaped string.
- Report every ERROR and WARN to the user in plain language with the file and
  key. Pay particular attention to VC-NOT-LINKED: a first deploy of a new project
  is always production.
- A clean result only means no known static problems. It is not a deploy
  approval and does not prove the deploy will succeed. Deploying still follows
  the `vercel-deploy` skill: preview first, plan, explicit yes.
- Exit status 0 = no errors, 1 = errors, 2 = directory not found. If node is not
  installed, say so and review the files by hand against the same list.
