---
description: Understand the repo, find where to make a change, and refresh outdated explanations
usage: /whalewiki [init|update|status|impact <path...>|map|export|ask <question>]
---

$ARGUMENTS

Locate the engine at `scripts/whalewiki.mjs` inside this plugin's directory
(`/plugin show whalewiki` prints the staged root). Use this reviewed engine.
Scaffolding also copies it to `whalewiki/.tool/status.mjs` for an offline CI
gate; inspect that executable before running a repository's copy.

- No arguments: show the wiki's current coverage and freshness with
  `wiki_structure` (or installed-engine status). If empty, explain what init
  will produce. Suggest a relevant question, `impact <source-path>`, or update
  when pages need review. Do not regenerate pages without a request.
- `status`: run `status --short`; report the counts and any needed review.
- `init`: load the whalewiki skill and follow its init workflow — scaffold,
  scan, plan the page set, write pages, seal each into `manifest.json`.
- `update`: run `status`. Review stale, orphaned, and unsealed pages against
  their source files; rewrite where needed and re-seal only after verifying
  their claims. Re-scan for new modules absent from the existing page bases.
- `impact <path...>`: use `wiki_impact` or the installed engine's `impact`
  command. Report the pages citing those files/directories and any uncovered
  paths. Read code before making claims about runtime impact; wiki evidence
  is not an exhaustive dependency graph.
- `map`: run `map` to regenerate `whalewiki/codemap.md` deterministically.
- `export`: run `export` to render a single self-contained HTML viewer.
- `ask <question>`: search the wiki (`wiki_search` via MCP or grep over
  `whalewiki/pages/`), read the freshest matching pages, answer with
  citations to page and source file, and report each relied-on page's verdict.

Never edit a page without re-sealing its basis (`manifest set`), and never
mark a page fresh without re-reading the sources it claims.
