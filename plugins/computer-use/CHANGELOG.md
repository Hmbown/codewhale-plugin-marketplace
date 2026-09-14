# Release notes

## 0.4.0 — AX primitives

The session that tried to send a WeChat message could not press Return, could
not read a truncated tree, and had no click path for a non-AXPressable
control. This version adds those primitives without weakening the
shared-pointer gate.

- `type` treats newlines and `press_enter` as Return/Enter instead of
  inserting a literal character (the WeChat composer U+FFFC failure).
- `key` remains the named key-press tool (`return`, `backspace`, chords).
- `get_app_state` filters (`query`, `role`), paginates (`limit`, `offset`),
  and truncates oversized dumps instead of eating the middle of the JSON.
  `detail:"compact"` is actually smaller. `find_elements` searches a cached
  `state_id`.
- `focus` and `get_value` act on observed elements; text-field values stay
  in the state dump.
- Accessibility clicks will focus a field that exposes AXFocused even when
  it is not AXPressable (Qt search boxes).
- `strategy:"app"` is the missing middle: a pointer event allowed only when
  the point is inside the bound app's window, then the cursor is restored.
  `strategy:"event"` still requires shared-desktop authorization.
- Coordinate targets accept `space:"screen"` so AX screen points do not need
  a hand conversion through the latest raster.
- `ocr_region` limits OCR to a screen rect. `run_actions` batches up to 8
  steps.
- Receipts no longer tell the model to use tools that are not in this
  catalog.

0.4.0 is a Developer ID-signed, notarized universal macOS build from commit 249ae77fad9162c2af11d5460d91b2b5b909c06c, with its packaging receipt in [docs/releases/0.4.0.json](docs/releases/0.4.0.json). Source suite at that commit: 245 passed, 0 failed, 15 platform skips. It was published on 2026-09-13 (PDT) as the [v0.4.0 GitHub release](https://github.com/Hmbown/codewhale-cu-plugin/releases/tag/v0.4.0); the setup page at https://codewhale.net/computer-use offers the download and **Check for updates…** in an installed 0.3.1 app offers it.

0.3.1 is the first public macOS build: a Developer ID-signed, notarized universal app built from commit 9f6c39f738c0d8e8dcc93af11af5e00d19081b60, with its packaging receipt in [docs/releases/0.3.1.json](docs/releases/0.3.1.json). It was published on 2026-09-13 as the [v0.3.1 GitHub release](https://github.com/Hmbown/codewhale-cu-plugin/releases/tag/v0.3.1); the setup page at https://codewhale.net/computer-use offers the download. Earlier versions were developed privately; their notes are kept below for context.

## 0.3.1 — macOS beta

- Retire the helper when its menu-bar owner disconnects, so reopening the app
  restores human controls with input still stopped.
- Preserve a replacement helper's socket and run receipt during old-session
  cleanup.
- Show the result of an update after relaunch, including failed installs.
- Report the manifest version to MCP hosts and explain how to repair a missing
  registered app without bypassing it.
- Limit the public plugin host eligibility to macOS. Windows and Linux remain
  experimental source-only backends pending targeting, human controls and
  native qualification.

Qualification record. The public build was produced on 2026-09-13 from commit
`9f6c39f738c0d8e8dcc93af11af5e00d19081b60` (clean `main`); all 33 packaged
runtime files are byte-identical to that commit. The archive
`Codewhale-Computer-Use-0.3.1-macos-universal.zip` (79,720,031 bytes, SHA-256
`76752d33fff60d62b5445452e5a7f21396eb5aace6dbf632fc2a172f75e4720a`) is signed
with "Developer ID Application: Hunter Bown (5RDNSHA5TY)" under the hardened
runtime, is universal (arm64 and x86_64), bundles Node 24.21.0 and requires
macOS 13.5+. Apple notarization submission
`769ff14d-ee5c-4db5-a3b9-f733c2743e6e` was Accepted; the ticket is stapled,
`codesign --verify --deep --strict` passes, and `spctl` accepts the app with
source "Notarized Developer ID". The source suite at that commit passes
(240 passed, 0 failed, 15 platform skips). The build scripts ran with Node
v25.8.0 on the maintainer Mac; hosted CI pins Node 22. Later on 2026-09-13 the
drag-to-Applications disk image
`Codewhale-Computer-Use-0.3.1-macos-universal.dmg` (88,246,026 bytes, SHA-256
`91491faa6d44b8e4b52113fea1831c07c402fdd8f673323c8125468d0d89be3a`) was built
from that same stapled app by `scripts/package-dmg.mjs`, signed, notarized
(submission `a24464ec-f3ed-4670-b873-fcacb8a1bef3` Accepted), stapled and
added to the v0.3.1 release as the human download; the archive is unchanged
and remains the updater's input. Earlier on the same
Mac, a signed 0.3.1 candidate passed the menu-bar owner crash and reopen check
with isolated state, and the updater's apply step replaced an installed
notarized 0.3.0 with that notarized 0.3.1 build, kept the previous bundle and
restarted with controls stopped.

Still open, recorded as open and not as done: a clean-machine install with
fresh Accessibility and Screen Recording grants; a model-driven task through
an installed Codewhale Engine; the non-admin Applications-directory update;
and the real post-publication **Check for updates…** path from an installed
older notarized build. See
[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

## 0.3.0 — notarized locally, never published

- Whale-and-pointer identity with light, dark, small and monochrome assets.
- Marketplace artwork, publisher and host-platform labels.
- macOS menu-bar setup with live Accessibility and Screen Recording status.
- A disposable background edit-and-capture check with an observed result.
- Live app/mode status, Pause and Stop. Pausing cancels active and queued
  input; stopped sessions stay invalid after new sessions are allowed.
- Installed-helper routing takes precedence over embedded binaries and fails
  closed when the helper is unavailable.
- Self-contained macOS packaging with a pinned universal Node runtime,
  notarization gates and verified updates that preserve the prior install.

Native panel and updater: macOS 13.5+. Other host platforms retain their
existing MCP setup. The 0.3.0 universal archive was Developer ID signed and
accepted by Apple notarization (record in
[docs/releases/0.3.0.json](docs/releases/0.3.0.json)) and installed on one
Mac, but it was never published as a release. Source availability alone is not
a notarization verdict.

## 0.2.2

Background field focus, text selection, accessibility scrolling and context
menus on macOS. Default observations follow the selected app. Foreground
gestures stop when the user changes apps instead of reclaiming focus.
