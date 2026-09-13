# Release notes

## 0.3.1 — source candidate; app release pending

- Retire the helper when its menu-bar owner disconnects, so reopening the app
  restores human controls with input still stopped.
- Preserve a replacement helper's socket and run receipt during old-session
  cleanup.
- Show the result of an update after relaunch, including failed installs.
- Report the manifest version to MCP hosts and explain how to repair a missing
  registered app without bypassing it.
- Limit the public marketplace listing to macOS. Windows and Linux remain
  development backends pending targeting, human controls and native qualification.

The published notarized app remains 0.3.0. These changes require a newly built,
signed and qualified app; a source update does not modify an installed bundle.

## 0.3.0

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
existing MCP setup. Publication and native qualification are recorded in the
release's receipts; source availability alone is not a notarization verdict.

## 0.2.2

Background field focus, text selection, accessibility scrolling and context
menus on macOS. Default observations follow the selected app. Foreground
gestures stop when the user changes apps instead of reclaiming focus.
