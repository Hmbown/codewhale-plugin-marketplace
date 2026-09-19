# WhaleWiki

Understand an unfamiliar repo, find where a change belongs, and see which
explanations need review when code moves. WhaleWiki keeps the answers beside
the source, with citations you can inspect and an offline reader you can share.

| When you need to… | Try this | You get |
| --- | --- | --- |
| Get oriented | `/whalewiki init` | A source-backed starting guide, architecture and change recipes |
| Find where to work | `/whalewiki ask Where would I add a new provider?` | Relevant pages, code references and freshness |
| Check a change's documentation impact | `/whalewiki impact src/providers` | Pages that cite that directory, plus gaps in coverage |
| Repair outdated explanations | `/whalewiki update` | Reviewed changes to affected pages, then new seals |
| Share the context | `/whalewiki export` | A searchable HTML file that works offline |

**Start here:** install the plugin, run `/whalewiki init` in a repository, then
ask “How do I run this project, and where does a request enter?” Read the cited
files to check the answer. If a wiki already exists, ask your question directly.

## Use it

Install, review, trust and enable the `whalewiki` plugin. Then in your repository:

```text
/whalewiki init
/whalewiki status
/whalewiki ask How does this project start?
/whalewiki update
/whalewiki export
```

`init` asks the current session's model to read the repository, plan useful
pages, write citations and seal the result. It uses that session's selected
provider/model and can incur its normal inference cost. The deterministic CLI
`scaffold` creates directories and instructions; it does not generate prose.

`export` creates a single offline HTML reader: full-text page search, review
filter, relative page/heading links, keyboard navigation, mobile navigation,
dark-mode support, per-page source evidence and print output. Search matches
multiple words across a page; Enter opens the first matching page. `/` focuses search. The viewer needs no CDN,
server or separate credentials. Markdown code fences, lists, tables and links
are supported; Mermaid blocks remain readable diagram source, not rendered art.

## Know what “fresh” means

| Verdict | Meaning | What to do |
| --- | --- | --- |
| `fresh` | Page text and every declared source file match their sealed hashes | Read the page, then check the cited source for consequential claims |
| `stale` | A source changed or someone edited the page after sealing | Review the changes and reseal only after checking the claims |
| `orphaned` | A page/source is missing, unsafe to follow, oversized or unreadable | Restore it or review its successor and update the basis |
| `unsealed` | No complete page/source seal, including legacy manifests without page digests | Read the page and sources, then seal them |

A seal proves unchanged bytes, not correct prose or complete coverage. New source
files outside a page's declared basis are not detected as changes to that page.
Re-scan periodically to discover new modules. All source-byte changes require
review: indentation, string whitespace and comment directives can affect behavior.
The earlier `touched` classification was retired because its normalization could
hide meaningful changes.

## CLI and CI

The bundled engine requires Node 20+ with no npm install. Locate its installed
path through `/plugin show whalewiki`:

```sh
node /installed/plugin/scripts/whalewiki.mjs scaffold
node /installed/plugin/scripts/whalewiki.mjs scan --json
node /installed/plugin/scripts/whalewiki.mjs map
node /installed/plugin/scripts/whalewiki.mjs impact src/providers --json
node /installed/plugin/scripts/whalewiki.mjs manifest set pages/architecture.md --sources src/main.ts,package.json
node /installed/plugin/scripts/whalewiki.mjs status --json
node /installed/plugin/scripts/whalewiki.mjs export --out /path/to/wiki.html
```

`scaffold` preserves the brief, pages and manifest, and copies the engine to
`whalewiki/.tool/status.mjs`. After reviewing that snapshot, a repository can
run its own offline drift gate:

```sh
node whalewiki/.tool/status.mjs --exit-stale
```

Exit 0 means at least one page is fully sealed and current; 2 means empty or
stale/orphaned/unsealed; 1 means invalid configuration or another error. Re-run
`scaffold` from the installed engine to update the copied verifier. Review that
code change like any other executable in the repository.

Status, search, export and MCP reads do not write receipts. `status --receipt`
explicitly records `.last-run.json`; `status --mark` explicitly annotates index
rows. No session-start hook automatically executes code from the target repo.

## Agent read tools

`wiki_structure`, `wiki_read`, `wiki_search`, `wiki_status`, `wiki_codemap`,
and `wiki_impact`
are read-only. Pass `workspace` as the absolute repository path when the host
starts the MCP server in its install directory:

```json
{"workspace":"/projects/example","page":"pages/architecture.md"}
```

That is a `wiki_read` argument object. An operator can instead bind the server
with `WHALEWIKI_DIR=/projects/example/whalewiki`. A missing wiki returns an
explicit error and setup instruction. Reads accept only wiki pages, `INDEX.md`
and `codemap.md`; they reject traversal, symlink files/parents, directories and
files over 2 MiB. Search results include titles, relevant line snippets, matched-term counts,
source paths and page freshness. Search is lexical, not an AI answer generator.

`wiki_impact` takes `paths: ["src/providers", "api:src/routes.ts"]`. It matches
exact source paths and directory boundaries, including deleted files. It finds
**declared documentation dependencies**, not transitive code dependencies. An
uncovered path is a documentation gap to investigate, not proof a change is safe.

## Multiple repositories

Add named roots to `whalewiki/whalewiki.toml`:

```toml
[[sources]]
name = "api"
root = "../api"
```

Paths are relative to the wiki's parent. A mixed basis can use
`--sources src/main.ts,api:src/routes.ts`. Named roots must be explicit and unique;
`repo` always identifies the wiki's parent. Configuration supports simple quoted
root/name values and one-line lists of ignored file/directory names, not full
TOML or glob syntax. Repository scans honor Git ignore rules when Git is available
and cap their inventory at 8,000 files. Codemaps currently describe the active
repository; mixed-root page evidence is supported separately.

[Design and limitations](docs/DESIGN.md) · [Authoring protocol](skills/whalewiki/SKILL.md)

Run `npm run test:whalewiki` and `npm run check:web` from the marketplace root.
Engine/MCP tests use scratch repositories; browser checks cover desktop and
mobile. These checks do not prove a model wrote accurate documentation.
