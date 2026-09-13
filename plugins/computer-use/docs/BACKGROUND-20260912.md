# macOS background control verification (0.2.2)

This note records why the 0.2.2 background-control changes were made and what
was verified for them. It is a development-time record, kept because the
limitations page and the parity results refer to it.

## What changed

The raw pointer helper could reactivate its bound application after the user
switched away, contradicting the background-control instructions. A native
negative control against the pre-fix source records one activation and two
global events; the new guard refuses before either operation. OS writes are
replaced by counters in that regression test, so the control does not operate
the user's desktop.

The change also added accessibility field focus, row selection, menu
selection, context-menu actions and scrollbar control. Background text entry
prefers writable accessibility selection. Exact text readback replaced the old
length/suffix heuristic, which could verify text that never arrived. Ordinary
observations and screenshots stay on the selected application. Failed
activation clears the previous input binding; an older standalone helper is
rejected before input because it lacks the background protocol.

## Verification

- Marketplace source suite at the time: 374 passed, 15 platform skips,
  0 failures, plus four browser checks.
- The signed universal macOS helper and its packaged daemon/MCP path completed
  field focus, Unicode insertion, Apply, scrolling and an app-scoped screenshot
  in a disposable native AppKit window behind another application. The
  fixture's own file confirmed the effects; an independent OS observer sampled
  the foreground PID and cursor position at a 10 ms interval.
- Two packaged trials recorded 400 and 195 samples with zero foreground or
  cursor changes; the latter also completed orderly MCP/daemon shutdown. A
  direct-source trial recorded 839 unchanged samples.
- Failed and inconclusive trials are retained and not counted as passes: one
  packaged trial had cursor changes with no foreground change, and another
  could not start its observer in time. The harness now reports observer
  exits, allows bounded startup under load and closes MCP before its daemon.
- The packaged runtime source files matched the authored source, and
  `codesign --verify --deep --strict` passed on the signed helper.

Machine-readable summary, with the native helper hash and the negative
control:
[background-control-darwin-2026-09-12.json](../parity/results/background-control-darwin-2026-09-12.json).
Reproduce with `node scripts/verify-background-macos.mjs`; pass
`--bundle /path/to/Codewhale\ Computer\ Use.app` to exercise a built package
through an isolated daemon. Fixtures and receipts are disposable; the user's
applications and installed helper are not stopped by this verification.

## Remaining qualification

This fixed specific macOS defects and expanded the working background path.
It does not establish complete Codex parity. Arbitrary background dragging,
hover, and raw double/triple/middle clicks remain unavailable; context menus
and scrolling require supported accessibility controls. Other toolkits,
browser workflows, other platforms, a full comparison suite and an
Engine-triggered model journey remain separate acceptance work. Earlier
Chrome/Chromium "background" receipts were overstated because those targets
were already frontmost; [LIMITATIONS.md](LIMITATIONS.md) states that
explicitly.

The signed 0.2.2 app used here was a local review artifact, not a notarized
release. An installed Codewhale binary embeds its own copy of this runtime and
needs rebuilding to pick up source changes.
