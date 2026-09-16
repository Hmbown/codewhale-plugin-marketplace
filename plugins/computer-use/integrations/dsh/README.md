# Codewhale Computer Use for DeepSeek Harness

A `dsh` bundle: one patch layer that adds the Computer Use MCP tool surface to
a profile. Install the [desktop app](../../README.md#the-mac-app) first — it
owns the macOS Accessibility and Screen Recording grants, and this package
points at the server inside it rather than shipping its own.

```bash
dsh plugin --profile web add @codewhale/computer-use-dsh
```

`dsh plugin` forwards to pnpm and then reconciles `dsh.profile.bundles`, so
that one command both installs the package and adds its layer to the profile.
The tools arrive as `mcp__computer-use__<name>`.

The two skills install separately, because a profile whose agent presets own
skill discovery ignores a host-level `skill-filesystem` row. The user skill
root is read in every composition:

```bash
PLUGIN="$HOME/Applications/Codewhale Computer Use.app/Contents/Resources/plugin"
mkdir -p ~/.dsh/skills
ln -sfn "$PLUGIN/skills/computer-use" ~/.dsh/skills/computer-use
ln -sfn "$PLUGIN/skills/recording"    ~/.dsh/skills/recording
```

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `CODEWHALE_CU_SERVER` | `~/Applications/Codewhale Computer Use.app/Contents/Resources/plugin/mcp/server.mjs` | The MCP server to run. Point it at a `/Applications` install or a source checkout's `mcp/server.mjs`. |

## Removing it

```bash
dsh plugin --profile web remove @codewhale/computer-use-dsh
rm ~/.dsh/skills/computer-use ~/.dsh/skills/recording
```
