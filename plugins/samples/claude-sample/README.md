# Claude-format sample

A tiny plugin in Claude Code's layout, to show that Codewhale loads
`.claude-plugin/plugin.json` bundles directly. It has one skill and one command.

```text
claude-sample/
  .claude-plugin/plugin.json
  skills/commit-message/SKILL.md
  commands/draft-commit.md
```

Codewhale reads the declarative subset: skills, commands, agent profiles and MCP
servers. Hooks, LSP declarations, custom MCP file paths and `${CLAUDE_PLUGIN_ROOT}`
are rejected with an explanation rather than half-installed. Nothing is scanned
from another application's plugin directories; you install the bundle explicitly.

## Try it

```text
/plugin install /absolute/path/to/claude-sample
/plugin show claude-sample
/plugin trust claude-sample <content-hash>.<capability-hash>
/plugin enable claude-sample
/skills claude-sample:
/draft-commit
```

In a repository with staged changes, `/draft-commit` loads
`claude-sample:commit-message` and drafts a message. It reads the staged diff with
`git diff --cached` and does not commit or stage anything.

## Success and failure

Expected once Claude-format bundles activate:

- `/plugin show` lists one skill and one command and the Claude manifest path.
- `/skills claude-sample:` shows `claude-sample:commit-message`, and `/draft-commit`
  appears in the command palette.
- With nothing staged the skill says so and stops. Disabling the plugin removes both.

Known issue (Codewhale 0.10.1, build 0c79ef28b165): install, validate and trust work for
this bundle, but `/plugin enable` ends with `Plugin runtime activation failed: Plugin
`claude-sample` commands adapter was denied: ... reviewed source could not be
revalidated`. The skill and command never load (`/skills claude-sample:` finds none),
while `/plugin list` still labels the plugin `active`. Two minimal Claude-format bundles
(a bare `{"name": ...}` manifest with a default `skills/` directory, and one declaring
`"skills": "./skills/"`) fail the same way, so the cause is not this sample. Reading the
source, `PluginInstance::authority()` in `crates/tui/src/plugins/types.rs` keeps only the
manifest's file name (`plugin.json`) and joins it to the bundle root, which points at a
file that does not exist for `.claude-plugin/plugin.json` bundles, so revalidation fails.
Treat this sample as the regression check for that fix.

License: MIT. Original to this repository.
