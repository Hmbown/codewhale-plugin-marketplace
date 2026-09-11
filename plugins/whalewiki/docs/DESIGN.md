# WhaleWiki design

The useful reading path is index → page → cited source. Codewhale's current
session generates prose. This plugin handles deterministic inventory, seals,
retrieval and an offline reader. It has no provider integration or second model
loop.

## Evidence contract

Manifest version 2 stores a page digest, nonempty source basis, exact source
SHA-256 hashes, title and sealing time. Freshness compares both the current page
and current sources. An unchanged timestamp alone means nothing. Legacy version
1 manifests load, but entries without a page digest require resealing.

Source changes always invalidate the seal. The initial whitespace/comment
normalizer was unsafe for indentation, string content, directives and documentation.
The legacy `touched` count remains zero for output compatibility; it never allows
a changed source through the gate. Empty wikis fail `--exit-stale`.

The seal does not prove semantic correctness, source completeness or that a
human/model read a file. New files outside the basis require a fresh inventory
and page-planning review. Missing, unreadable, oversized and symlinked evidence
is reported as orphaned. Invalid manifest structure fails closed.

## Reading and authoring

Five read-only MCP tools return structure, page text, ranked search, freshness
and codemap. `workspace` binds each request to an explicit repository when the
plugin host uses its installed directory as cwd. `WHALEWIKI_DIR` is an operator
binding. Arbitrary wiki-relative files cannot be read as pages.

CLI authoring is explicit. `scaffold` preserves human content and copies the
engine into `.tool/status.mjs`. The copied verifier is executable source under
repository review, not a remotely updated helper. There is no automatic hook
that executes that repository-owned copy at session start.

The brief guides documentation scope under the active task's instructions. Wiki
prose, source comments and search results are evidence, never a higher-priority
instruction channel. Operator controls such as AGENTS.md/CLAUDE.md are not edited
or shipped by this workflow.

## Reader

Mode: Read. Preserve the compact documentation layout with a quiet green accent,
clear headings, readable measure, semantic tables and ordinary links. Search
filters the page list by full text. Freshness filters identify pages needing
review. A single selected page, deep links and native collapsible mobile
navigation avoid an endless concatenated document. All content remains readable
without JavaScript and in print.

The export embeds no remote assets. Repository HTML is escaped, link destinations
are validated before attribute encoding, inline code stays literal, and a
hash-bound CSP permits only the bundled navigation script. It is a snapshot;
its footer records the check time and tells readers to re-export for new status.

## Limits

- 2 MiB per file, 1,000 manifest pages and 1,000 basis entries per page.
- 256 KiB MCP requests; oversized or malformed requests do not crash the server.
- Up to 8,000 scanned files, Git ignores respected; symbols/imports are approximate
  regex inventory, not a compiler or an exhaustive dependency graph.
- Search is simple Unicode text matching with heading weights, no embeddings.
- The Markdown subset includes headings, paragraphs, code, emphasis, lists, tables,
  quotes and links. Images/HTML are text; Mermaid remains code.
- Named source roots support cross-repository seals. Codemap generation currently
  covers one active repository.
- Static exports cannot re-read local source files or validate newer changes.
