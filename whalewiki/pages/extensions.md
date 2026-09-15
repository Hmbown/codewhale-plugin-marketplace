# Choose and ship an extension

This repository has four installable bundles: Computer Use, WhaleWiki,
Cloudflare docs and the bundled Codewhale skills. The catalog declares their
relative sources and versions. An entry offers installation; it does not grant
capabilities or establish a service login.

Computer Use source 0.5.0 adds `wait_for` stateful polling, element-targeted
`type`/`key` (focus-then-act in one call), app-window-scoped recording and
persistent SSH agent sessions that retain bindings between calls; the
marketplace enables it on macOS only. Windows and Linux remain experimental
source-only backends. The native macOS helper provides permission setup, a
background check, human Pause/Stop and on-demand verified updates. The
Developer ID-signed, notarized 0.5.0 macOS build is published as the v0.5.0
GitHub release, with its packaging receipt in
`plugins/computer-use/docs/releases/0.5.0.json`; the
[official setup page](https://codewhale.net/computer-use) reports whether the
download is available, and the
[Computer Use CHANGELOG](../../plugins/computer-use/CHANGELOG.md) records the
release and qualification status. Clean-machine, installed-Engine, non-admin
update and post-publication update-check qualification remain open. The
source repository starts with a clean initial commit and preserves the MIT
license and attribution.
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
- `plugins/computer-use/docs/releases/0.5.0.json`: packaging and notarization receipt for the signed 0.5.0 macOS build.
- `plugins/computer-use/CHANGELOG.md`: release record and open qualification gates.
- `plugins/computer-use/docs/PUBLICATION_REVIEW.md`: review findings, source fixes and platform release gates.
