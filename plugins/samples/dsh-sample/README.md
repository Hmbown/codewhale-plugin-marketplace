# DSH sample

A tiny DeepSeek Harness (DSH) bundle package that shows what `/plugin import dsh`
does. It is a DSH-shaped package, not a Codewhale plugin: it has a `package.json`
with a `dsh.bundle.patch` entry and a Cordis patch file, and no `plugin.json`.

| DSH row | Converts to |
| --- | --- |
| `@deepseek-ai/dsh-skill-filesystem` with `customSkillDirs: [skills]` | The skill `dsh-sample:dsh-sample-notes` |
| `@deepseek-ai/dsh-mcp-client`, stdio, `node server.mjs`, `cwd: mcp` | A local MCP server named `sample` with one tool, `echo` |
| `@deepseek-ai/dsh-client-ui-theme` | Nothing. Reported as skipped in `CONVERSION.md` |

Importing never executes DSH code. It reads the patch as data, copies the
packaged `mcp/` directory and the skill, and writes a native bundle with a
`CONVERSION.md` receipt. The result is untrusted and disabled until you review
and trust it.

## Try it

Inside Codewhale, install the package directory. A directory with a
`dsh.bundle.patch` entry and no native manifest is routed to the DSH importer:

```text
/plugin install /absolute/path/to/dsh-sample
/plugin trust dsh-sample <content-hash>.<capability-hash>
/plugin enable dsh-sample
/skills dsh-sample:
/skill dsh-sample:dsh-sample-notes
/mcp status
```

The install converts into scratch, copies exactly the converted bundle, and prints
the standard review (1 skill, 1 local stdio MCP server `sample`, the `node
server.mjs` process it will launch) with the trust command to copy. The bundle
lands disabled and untrusted. `CONVERSION.md` inside the installed bundle lists
each row's outcome, including the skipped `sample-theme` row.

The separate two-step review, which shows the conversion and a content hash
before anything is installed, is:

```text
/plugin import dsh /absolute/path/to/dsh-sample
/plugin import dsh approve /absolute/path/to/dsh-sample <content-hash>
```

Known issue (Codewhale 0.10.1, build 0c79ef28b165): `/plugin import dsh <dir>` panics
with "Cannot start a runtime from within a runtime" for every package, including
Codewhale's own pinned upstream fixture. In one run the TUI stayed up with an error in the
composer; in another the process exited and wrote a crash report naming
`crates/tui/src/extension_host/composition_review.rs:64`. That function builds its own
tokio runtime and blocks on it, and the preview calls the conversion directly on the TUI's
async thread. `/plugin install <dir>` and `/plugin import dsh approve <dir> <hash>`
convert on a blocking worker and succeed. Until the preview is fixed, use
`/plugin install`.

## Prerequisites and authority

- Codewhale 0.10.1 or newer; Node on the host. The importer's review step and the sample
  MCP server both need `node` on PATH.
- The converted bundle declares a local stdio MCP server. It runs with your user's
  authority when enabled (plugin trust is not an OS sandbox). The server is about
  60 lines in `mcp/server.mjs`: it echoes a string and touches no file or network.
  Read it before you trust the bundle.

## Success and failure

- Success: the review lists `skills=1 mcp=1 (stdio=1 remote=0)`, no unsupported
  components, and `/plugin list` shows `dsh-sample` as disabled and not-reviewed. After
  trust and enable, `/skills dsh-sample:` lists `dsh-sample:dsh-sample-notes` and
  `/mcp status` shows the server `dsh-sample/sample`.
- A skill whose frontmatter has a key the importer does not know (for example the
  native `invocation:` key; use `disable-model-invocation: true`) is refused with
  "Unsupported fields", and nothing is installed.
- An `approve` whose hash does not match the converted bytes installs nothing and
  prints both hashes. The approve hash is the hash of the converted bytes, which is not
  the `Content hash` the installed bundle later shows (that one includes the install record).
- Pressing Enter on the server row in `/mcp status` starts it: the log shows
  `plugin-10-dsh-sample-sample connected: 1 tool(s)`.
- Only the TUI slash commands and the Runtime API import DSH packages; there is no
  `codewhale plugin` CLI subcommand for it.

License: MIT. The skill and server are original to this repository.
