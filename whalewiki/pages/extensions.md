# Choose and ship an extension

This repository has five installable bundles: Computer Use, WhaleSong,
WhaleWiki, Cloudflare docs and the bundled Codewhale skills. The catalog
declares
relative sources and versions. An entry offers installation; it does not grant
capabilities or establish a service login.

Computer Use source 0.11.2 is a macOS beta candidate. It combines app
scripting, accessibility and window-routed input, CDP browser control, and
session-owned Linux desktops through Docker. Local apps require per-app
consent; foreground activation needs a separate decision. Shared input waits
for a quiet hardware-input window and refuses `user_busy` if the person
remains active. Input arriving mid-action is still a documented limitation.

The 0.11.2 patch fixes uninitialized typing receipts and includes the Docker
build context in installed app bundles. Source tests and simulated clocks do
not establish complete Codex parity, clean-machine acceptance, or production
Linux/Windows readiness. The marketplace remains enabled on macOS only.

The published installer is still the notarized 0.6.0 build; 0.11.2 source is
not a claim of a published 0.11.2 download. The [official setup page](https://codewhale.net/computer-use)
reports public download availability, and the [release checklist](../../plugins/computer-use/docs/RELEASE_CHECKLIST.md)
records qualification and remaining installed-Engine, fresh-grant and upgrade
checks. The existing Engine remains the session and model-loop authority.

Catalog artwork is inline PNG, bounded to
32 KiB and 256 by 256 pixels; browsing a listing never fetches an icon URL.

## Choose a home

| Surface | Responsibility | Example |
| --- | --- | --- |
| `plugins/` | Reviewed tools, commands or skills that complete a useful task | WhaleWiki's repository read tools |
| `connections/` | Official endpoints and host-owned authentication guidance | Linear's read-only MCP setup |
| `integrations/` | External messages connected to the existing runtime | Telegram polling and signed webhook intake |
| `skills/` | Reusable agent workflows with a separate Core mirror owner | Review, handoff and implementation workflows |

A URL alone does not earn an installable plugin. See
[Connections and inbound requests](integrations.md) for service setup and bot
boundaries. An adapter must reuse Codewhale's runtime, approvals and model
selection; adding another model loop or credential store splits that ownership.

## Package before review

From a development checkout, run `npm run package:plugin -- whalewiki` or select
another catalog name. `packagePlugin` reads Git's working source inventory,
excludes ignored local artifacts and deleted files, refuses symlinks, and rejects
a bundle over 5 MiB. It creates `dist/<name>` and refuses to overwrite it.
Use `--out /another/directory` when building a later revision.

Review the packaged capabilities before trusting and enabling them. Computer
Use can accumulate local receipts large enough to exceed the host's cap; the
packager avoids shipping those artifacts. Installation remains a host operation.

## Evidence before readiness

Run `npm run check` and `npm test && npm run check:web`. The catalog check covers
manifest identity, declared remote hosts and skill metadata. Unit and protocol
tests cover implementation behavior; browser tests exercise the wiki reader.
The repository wiki has its own `npm run check:wiki` source-drift gate.

Passing local checks is not hosted CI, a real service login, native platform
acceptance or a customer completing a task. Preserve those distinctions in the
handoff and inspect the current validation receipt before publication.

## Source basis

- `marketplace.json`: installable names, versions and source directories.
- `CONTRIBUTING.md`: admission and ownership rules.
- `scripts/package-plugin.mjs`, `packagePlugin`: source inventory and package guards.
- `scripts/check-marketplace.mjs`: catalog, manifest and MCP contract checks.
- `package.json`: executable repository gates.
- `plugins/computer-use/docs/DISTRIBUTION.md`: build, notarization and website qualification procedure.
- `plugins/computer-use/docs/RELEASE_CHECKLIST.md`: qualification record and the human-only publication steps.
- `plugins/computer-use/docs/releases/0.6.0.json`: packaging and notarization receipt for the signed 0.6.0 macOS build.
- `plugins/computer-use/CHANGELOG.md`: release record and open qualification gates.
- `plugins/computer-use/docs/PUBLICATION_REVIEW.md`: review findings, source fixes and platform release gates.
