---
description: Build, refresh, and query the repo's evidence-bound wiki
usage: /whalewiki [init|update|status|map|export|ask <question>]
---

$ARGUMENTS

Locate the engine at `scripts/whalewiki.mjs` inside this plugin's directory
(`/plugin show whalewiki` prints the staged root). Use this reviewed engine.
Scaffolding also copies it to `whalewiki/.tool/status.mjs` for an offline CI
gate; inspect that executable before running a repository's copy.

- No arguments or `status`: run `status --short`. Report one line — how many
  pages are fresh, stale, orphaned, or unsealed — and stop. Do not regenerate anything.
- `init`: load the whalewiki skill and follow its init workflow — scaffold,
  scan, plan the page set, write pages, seal each into `manifest.json`.
- `update`: run `status`. Review stale, orphaned, and unsealed pages against
  their source files; rewrite where needed and re-seal only after verifying
  their claims. Re-scan for new modules absent from the existing page bases.
- `map`: run `map` to regenerate `whalewiki/codemap.md` deterministically.
- `export`: run `export` to render a single self-contained HTML viewer.
- `ask <question>`: search the wiki (`wiki_search` via MCP or grep over
  `whalewiki/pages/`), read the freshest matching pages, answer with
  citations to page and source file, and report each relied-on page's verdict.

Never edit a page without re-sealing its basis (`manifest set`), and never
mark a page fresh without re-reading the sources it claims.
