<img src="assets/codewhale.png" alt="Codewhale" width="96" />

# Codewhale plugin marketplace

The first-party catalog: the plugins and skills Codewhale ships, kept in the
open so anyone can read them, propose a change, or add their own.

```
/plugin marketplace add codewhale <path-to>/marketplace.json
```

Adding a catalog installs nothing. It lists what is available; trust and
enablement stay separate, explicit steps, and tier and provenance are display
only. That separation is the point — a catalog is a menu, not a permission.

## What is here

| | |
| --- | --- |
| `plugins/computer-use` | See the screen and operate it — accessibility-first control, screenshots and zoom on macOS, Windows and Linux, macOS recording, HarmonyOS over `hdc`. |
| `skills/` | The 37 skills Codewhale bundles. They also ship inside the binary and are unpacked on first run, so you already have them; they live here so they can be read and improved by people who do not build Codewhale. |

`marketplace.json` is Codewhale's native catalog format. An entry is a `name`
plus a `source` that is exactly the install spec `/plugin install` accepts:

```json
{ "name": "formatter", "source": "github:owner/repo", "version": "2.1.0" }
```

`path:` sources are relative to this repository, so a plugin carried here needs
no home of its own. `github:owner/repo` and `https://` tarballs point outward
for plugins that have one.

Codewhale also reads the Claude (`.claude-plugin/marketplace.json`), Kimi and
Codex catalog formats, so a catalog written for one of those can be added
without conversion.

## Contributing

A skill is a directory with a `SKILL.md`; a plugin is a directory with a
`plugin.json`. Add yours, add the matching entry to `marketplace.json`, and open
a pull request.

Two things make a contribution easy to accept:

- **Say what it does in one line.** The `description` is what someone reads
  before deciding to trust it, so write the sentence that would let them decide.
- **Ask for what you need and no more.** Permissions are reviewed. A plugin that
  wants the filesystem to format a string will be asked why.

Issues are the right place for "this should exist" and "this is wrong" alike.

## License

Each entry carries its own license. `plugins/computer-use` is MIT.
