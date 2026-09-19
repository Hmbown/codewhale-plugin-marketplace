# How WhaleWiki earns a fresh badge

The model reads source and writes documentation. A deterministic Node engine
records which source files support each page and detects when the evidence
changes. The engine itself does not generate prose.

## Page and source seals

`manifest set` records the page's SHA-256 and every declared source file's exact
SHA-256 in manifest version 2. Sealing requires an existing page and at least one
source. A page can combine explicitly configured named source roots.

| Verdict | Condition |
| --- | --- |
| Fresh | Both page bytes and every declared source digest still match |
| Stale | The page or a source changed after sealing |
| Orphaned | A page or source is missing, unreadable, oversized or unsafe |
| Unsealed | No complete page/source seal exists, including older manifests |

Whitespace and comments count as evidence: indentation, string literals and
directives can change behavior. A fresh badge proves unchanged bytes, not that
the prose is correct. New files outside the declared basis do not make an old
page stale. Re-scan to discover new modules.

## Reading without changing the repository

Six MCP tools provide structure, page reads, search, status, a codemap and
documentation-impact lookup. Search returns source paths, freshness and line
snippets; distinct query-term coverage ranks before repeated boilerplate.
Pass an absolute `workspace` when the host starts the server in the installed
plugin directory. File reads are limited to `pages/<name>.md`, `INDEX.md` and
`codemap.md`; traversal, symlink components and files over 2 MiB are refused.

Status, search, export and MCP reads do not write a receipt. The CLI's explicit
`status --receipt` and `status --mark` opt into writes. No session-start hook
automatically runs an executable from the repository being opened.

Generated files use checked destinations and atomic replacement. Linked wiki
directories and symlink leaves, including dangling links, are refused. Replacing
a hardlinked output does not modify its other name. An explicit external export
directory remains an operator-selected destination.

## What documentation depends on this file?

Use `/whalewiki impact plugins/whalewiki/scripts/whalewiki.mjs`, or call
`wiki_impact` with that repository-relative path. The existing manifest supplies
the answer: this page cites the engine. Directory paths match at a slash
boundary; `api:src/routes.ts` selects an explicitly configured named root.
Deleted source files still identify their orphaned pages.

Unmatched paths are reported as uncovered. This is direct documentation
coverage, not an exhaustive code dependency graph or a claim that a change is
safe. Read the cited code before deciding what an implementation change affects.

## Reviewing and sharing

`scaffold` preserves existing prose and copies a verifier into `.tool/status.mjs`.
Review that copied executable before using it in CI. The `--exit-stale` gate
returns 2 for an empty wiki or any stale, orphaned or unsealed page. A malformed
configuration is an error, not a clean pass.

`export` creates a self-contained offline HTML reader with page search, review
filtering, internal page/heading links and mobile navigation. Multiword search
finds terms across a page; Enter opens the first match. Each sealed page has
an expandable list of the source files supporting its explanation. Unsafe HTML is
escaped and unsafe link schemes are rejected. The viewer's badges reflect its
export time; it cannot detect later source edits by itself. Mermaid remains
readable code. Search and symbol maps are lightweight heuristics.

Return to [Choose and ship an extension](extensions.md) for installation and gates.

## Source basis

- `plugins/whalewiki/scripts/whalewiki.mjs`: `safeFile`, `loadManifest`,
  `pageVerdict`, `statusReport`, `searchWiki`, `impactReport`, `scaffold`,
  `mdToHtml`, `exportHtml`, `main`.
- `plugins/whalewiki/mcp/server.mjs`: workspace selection, tool schemas and protocol handling.
- `plugins/whalewiki/plugin.json`: installed extensions and capabilities.
- `plugins/whalewiki/README.md`: supported workflows and limitations.
