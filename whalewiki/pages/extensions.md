# Choose and ship an extension

This repository has six installable bundles: Computer Use, Chromewhale,
WhaleSong, WhaleWiki, Cloudflare docs and the bundled Codewhale skills. The
catalog declares
relative sources, stable IDs, human-readable names and versions. An entry offers installation; it does not grant
capabilities or establish a service login.

Computer Use source 0.12.0 is a macOS beta candidate. It combines app
scripting, accessibility and window-routed input, CDP browser control, and
session-owned Linux desktops through Docker. Local apps require per-app
consent; foreground activation needs a separate decision. Shared input waits
for a quiet hardware-input window and refuses `user_busy` if the person
remains active. Input arriving mid-action is still a documented limitation.

In 0.12.0 the agent has its own pointer on macOS: clicks, hover, drag and
scroll go to the bound app's window as window-routed events in every mode,
and the helper refuses any request to drive the person's cursor
(`real_pointer_refused`). It also adds the shared-computer attach mode for
Codewhale Computers (browser attach, control lease gate, turn hold) and a
safety floor: `app_script` refuses shell and keystroke escapes, irreversible
clicks need an explicit confirmation, and consent is never batched or replayed.

The 0.11.3 patch answers `resources/templates/list` with an empty template
list instead of `-32601`. The server publishes a fixed skill pack and never a
parameterized URI space, so an empty list is the correct answer and a host that
probes the method because `resources` is advertised no longer records a
discovery warning at the start of every session; advertised capabilities are
unchanged and genuinely unknown methods are still refused. Earlier 0.11.2 work
fixes uninitialized typing receipts and includes the Docker
build context in installed app bundles. macOS background actions that require
a focus lease now refuse before input instead of silently borrowing the user's
keyboard focus. Linux semantic value edits choose the supported accessibility
interface, verify readback, and do not retry a refused or uncertain write. The Windows hardening follow-up binds
UIA actions to observed window/element identities, preserves screenshot origins
and regions, repairs browser discovery, and supports a bundled Node runtime
with staged, backup-preserving installs. Canonical Windows CI now runs both
native input contracts and a controlled desktop acceptance check. Source tests
and simulated clocks do
not establish complete Codex parity, clean-machine acceptance, or production
Linux/Windows readiness. The marketplace remains enabled on macOS only.

The 0.12.0 release packages the notarized universal Mac app and an explicitly
unsigned Windows x64 preview. Linux remains source/Docker-based. A source
version alone does not establish download availability. The [official setup page](https://codewhale.net/computer-use)
reports public download availability, and the [release checklist](../../plugins/computer-use/docs/RELEASE_CHECKLIST.md)
records qualification and remaining final-installed, fresh-grant and upgrade
checks. Actual isolated model observe/edit/verify and checkpoint Stop/reconnect
checks passed; physical keyboard coexistence remains open. The existing Engine remains the session and model-loop authority.

Chromewhale source 0.1.0 also drives a browser, and the two do not overlap.
Computer Use owns a Chromium instance it launches under its own
`--user-data-dir` and states that the person's own profile is never attached
to, typed into or closed; Chromewhale acts on the tab the person is already
looking at, in their own profile and their own sessions. The vocabularies are
kept apart for that reason: `browser_*` for the self-owned instance, `page_*`
for the person's. Chromewhale's tools live in its MCP server rather than in the
Chrome extension it ships, so they reach the model through the ordinary tool
path and the bundle's trust review; a client that registered them with the
Runtime directly would carry `ApprovalRequirement::Auto` and reach no approval
gate. The extension is loaded unpacked and dials out to a token-gated loopback
bridge — a Chrome extension cannot listen on a socket. A per-origin decision in
the side panel, Chrome's own optional host permission, and a refusal to type
into password, one-time-code or payment-card fields sit under that. Source
tests cover the server, bridge and gates; no run against a live Chrome profile
is recorded, so the extension half is unqualified.

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

## Find a skill by the job you need done

The [skill directory](../../skills/README.md) groups 47 current Core skills into
software work, research/documents, everyday tasks and agent extension. Run
`npm run skills -- email` or `npm run skills -- audio` for a filtered list.
Each skill installs as `codewhale-skills:<name>`; accounts, tools and permissions
are separate prerequisites.

The active set comes from Core's catalog matrix, not every retained asset
folder. `skills/upstream.json` records its source commit and hashes. The mirror
includes supporting resources and excludes old generation bodies. Repository
skills (`feedback`, `contributor-onboarding`), optional Feishu and retired v4
instructions do not become current defaults merely because their files remain
in Core for migration.

After committing a reviewed Core update, `npm run sync:skills` refreshes the
mirror and directory. It refuses dirty source assets or locally edited skill
content. `npm run check` validates pinned bytes; adding `-- --core ../codewhale`
also catches upstream changes to membership, wording or resources.

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
- `scripts/skills.mjs`, `skills/upstream.json`, `skills/README.md`: active catalog,
  provenance, resource checks and user-facing workflow directory.
- `plugins/computer-use/docs/DISTRIBUTION.md`: build, notarization and website qualification procedure.
- `plugins/computer-use/docs/RELEASE_CHECKLIST.md`: qualification record and the human-only publication steps.
- `plugins/computer-use/docs/releases/0.6.0.json`: packaging and notarization receipt for the signed 0.6.0 macOS build.
- `plugins/computer-use/CHANGELOG.md`: release record and open qualification gates.
- `plugins/computer-use/docs/PUBLICATION_REVIEW.md`: review findings, source fixes and platform release gates.
- `plugins/chromewhale/README.md`: the `page_*` surface, the bridge, and the
  stated split from Computer Use's `browser_*` tools.
- `plugins/chromewhale/src/tools.mjs`: the advertised tool set and why it does
  not reuse the `browser_*` names.

The current macOS candidate refuses background actions that borrow keyboard focus, including raw pointer fallbacks and modified keys. Accessibility and browser control remain the preferred routes for concurrent use. Native sharing-picker integration and continuous keyboard coexistence qualification remain open.
