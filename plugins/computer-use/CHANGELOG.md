# Release notes

This repository's public history starts at the 0.3.1 source snapshot. Earlier
versions were developed privately; their notes are kept below for context. No
version has been published as a signed download yet. 0.3.0 was notarized and
qualified on one maintainer Mac only, and 0.3.1 is the macOS beta candidate.
A source checkout never modifies an installed app. The developer installer
can install a locally signed build; in-app updates require a signed,
notarized build from this repository's GitHub Releases.

## 0.3.1 — macOS beta candidate (unreleased)

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

Qualification so far, all on one maintainer Mac: the source suite passes
(240 passed, 0 failed, 15 platform skips); a signed 0.3.1 build passed the
menu-bar owner crash and reopen check with isolated state; the updater's
apply step replaced an installed notarized 0.3.0 with the notarized 0.3.1
build, kept the previous bundle, restarted with controls stopped, and every
installed runtime file and native executable matched the build. A
clean-machine install with fresh permission grants and a model-driven task
through an installed Codewhale Engine remain open. See
[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

## 0.3.0 — notarized locally, not published

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
