# macOS background control — 0.2.2

The raw pointer helper could reactivate its bound application after the user
switched away. That contradicted the background-control instructions. A native
negative control against cd56260 records one activation and two global events;
the new guard refuses before either operation. OS writes are replaced by counters
in this regression test, so that control does not operate the user's desktop.

The implementation also adds accessibility field focus, row selection, menu
selection, context-menu actions and scrollbar control. Background text entry
prefers writable accessibility selection. Exact text readback replaces the old
length/suffix heuristic, which could verify text that never arrived. Ordinary
observations and screenshots stay on the selected application. Failed activation
clears the previous input binding; an older standalone helper is rejected before
input because it lacks the new background protocol.

## Verification

- Marketplace `npm test && npm run check:web`: **389 Node tests, 374 passed,
  15 platform skips, zero failures; four browser checks passed**.
- Canonical, marketplace and carried Core runtime/test files match. Catalog
  version and manifest version are 0.2.2. All three wiki pages are fresh.
- The signed universal macOS helper and its packaged daemon/MCP path completed
  field focus, Unicode insertion, Apply, scrolling and an app-scoped screenshot
  in a disposable native AppKit window behind another application. The fixture's
  own file confirmed the effects; an independent OS observer sampled foreground
  PID and cursor position with a 10 ms polling interval.
- Two packaged trials recorded **400 and 195 samples**, respectively, with zero
  foreground or cursor changes. The latter also completed orderly MCP/daemon
  shutdown. A direct-source trial recorded 839 unchanged samples.
- Failed/inconclusive trials are retained: one packaged trial had cursor changes
  with no foreground change, and another could not start its observer in time.
  These are not counted as passes. The harness now reports observer exits,
  allows bounded startup under load and closes MCP before its daemon.
- All **26 packaged runtime source files** match the authored source. The native
  helper SHA-256 is
  `5e73737065fad7a816a9906a22a4448dd1069c0af6d8141a2ee232c331ad7b99`.
  `codesign --verify --deep --strict` passed.

Sanitized machine-readable evidence:
[background-control-darwin-2026-09-12.json](../parity/results/background-control-darwin-2026-09-12.json).
Reproduce with `node scripts/verify-background-macos.mjs`; pass
`--bundle /path/to/Codewhale\ Computer\ Use.app` to exercise a built package through
an isolated daemon. Fixtures and receipts are disposable; the user's applications
and installed helper are not stopped by this verification.

## Remaining qualification

This fixes specific macOS defects and expands the working background path. It
does not establish complete Codex parity. Arbitrary background dragging, hover,
and raw double/triple/middle clicks remain unavailable; context menus and scrolling
require supported accessibility controls. Other toolkits, browser workflows,
platforms, a full comparison suite and an Engine-triggered model journey remain
separate acceptance work. Earlier Chrome/Chromium "background" receipts were
overstated because those targets were already frontmost; the limitations page
now states that explicitly.

The source is integrated into Core's existing built-in plugin. An installed Core
binary needs rebuilding to include these bytes; changing the marketplace or
standalone helper does not update that embedded binary. The separately signed
0.2.2 app is a local review artifact, not a notarized release. No installed helper,
Core installation, public remote, provider or deployment was changed in this pass.
