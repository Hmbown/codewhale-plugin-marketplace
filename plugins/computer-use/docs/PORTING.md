# Porting the parity suite to a platform

What someone picking up Ubuntu or Windows needs to know, and what is already
true so they do not re-derive it.

## State of play

| platform | backend | parity driver | receipts |
|---|---|---|---|
| macOS (Aqua) | `src/backends/darwin.mjs` + `darwin-accessibility.m` | `scripts/lib/desktop-darwin.mjs` | 27 tasks × 5 repeats, 24 demonstrated — `parity/results/darwin-aqua-2026-09-07.json` |
| Linux (X11) | `src/backends/linux.mjs` | `scripts/lib/desktop-x11.mjs` | 27 tasks × 5 repeats, 25 demonstrated + 2 documented skips on the isolated surface — `parity/results/linux-xvfb-isolated-2026-09-16.json`; the 2026-09-07 receipts predate the engine/driver split and are stale |
| Windows | `src/backends/win32.mjs` | `scripts/lib/desktop-win32.mjs` | none yet — driver exists but needs a real Windows desktop run (see below) |
| Wayland | `src/backends/linux.mjs` (wayland paths) | none (the X11 driver is X11-only) | none |

**You do not need an Ubuntu machine to start.** `docker/run.sh parity` builds
a headless Linux desktop — Xvfb, a window manager, the X11 tools, an AT-SPI bus,
Chromium and Tk — and runs the isolated route in it from anywhere Docker runs.
What that does and does not qualify is in [docker/README.md](../docker/README.md);
the short version is that it exercises the real X11 code paths but says nothing
about Wayland or about a real login session's window manager.

**First job on Ubuntu:** run the existing suite on a real login session.
`npm run parity` on a desktop X11 session should reproduce the container
result — 25 demonstrated, 2 documented skips, `native.modal_dialog` failing
under the toolkit-modal limitation. The isolated-surface receipt is fresh
(`parity/results/linux-xvfb-isolated-2026-09-16.json`); the older
`linux-x11-2026-09-06.json` shared-session receipt still predates the
engine/driver split. If a row moves, look at WM behavior first — the
container runs openbox, real desktops differ.

**First job on Windows:** the driver exists (`scripts/lib/desktop-win32.mjs`)
but has no receipts. It needs a real interactive Windows desktop — a Windows
VM (Parallels/UTM/VMware) or a cloud Windows host — with Node.js, Chrome and
Python 3 + Tk (the python.org installer bundles tcl/tk). There is no
`--isolated` route: Windows containers have no interactive desktop, and a
second session is a different user's desktop, so the shared console session
is the only surface and interference is measured, not engineered away.
A CI `windows-latest` run is not a user's desktop; say plainly which produced
any receipt. The suite file is `parity/tasks.win32.json`: held-input rows and
`control.permission_denied` carry committed skip reasons, and `browser.upload`
drives the common "Open" dialog (typed path + Return commits; no
`window_title` click needed).

## How the runner is put together

`scripts/parity-run.mjs` is platform-neutral: CLI, the MCP client, the task
DSL, the oracle comparison, the step executor, interference bookkeeping and the
summary. It knows nothing about any windowing system.

A driver is one module exporting `createDesktop({ parityDir, tasksDoc, isolated })`
which returns:

| member | contract |
|---|---|
| `sessionType()` | short surface name; goes in the receipt and the matrix (`x11`, `xvfb`, `aqua`, …) |
| `start()` / `stop()` | set up and tear down anything the run needs; `stop()` may return a cleanup summary for `run.json` |
| `baseEnv()` | environment shared by fixtures and the spawned MCP server |
| `serverEnv(ctx)` | extra environment for the MCP server only (Linux forces `CODEWHALE_CU_APP=off` and a scratch state dir; macOS must **not**, or requests stop routing through the app that holds the OS permissions) |
| `hostProbe()` | `{ pointer: {x, y}, activeWindow }` sampled independently of the backend under test |
| `launchFixture(kind, repCtx)` | start a disposable fixture, set `repCtx.pid`, return the process |
| `focusFixture(repCtx)` | give it input focus, if that is how the platform works (a no-op on macOS, where input is process-bound) |
| `killFixture(proc, repCtx)` | stop it and remove its scratch dirs |
| `prelude(task, repCtx)` | DSL steps to run before the task's own (macOS binds input here); their tool calls are counted separately |
| `clientOrigin(fixtureKey, { window, repCtx })` | the fixture's content origin in screen points |
| `windowGeometry(title, repCtx)` | optional — origin and size of a **non-fixture** window (a native dialog or chooser) found by title on the work display; backs the `{window_title, at}` target. A driver without it fails that target with "window not found". |
| `oracleState(task, repCtx)` | the fixture's state, read **outside** the tool surface |
| `meta()` | environment facts for `run.json` |

Register it in the `DRIVERS` map at the top of `scripts/parity-run.mjs`.

## Rules worth keeping

- **The oracle never goes through the tool surface.** X11 reads the fixture's
  window title with `xdotool`; macOS serves the page from a loopback server and
  reads its beacons, and reads a state file the native fixture writes. If the
  thing under test also reports the result, the run proves nothing.
- **Interference is sampled by something that shares no code with the backend.**
  X11 uses `xdotool`; macOS uses `parity/darwin-probe.m`, a standalone
  CoreGraphics/AppKit binary; Windows uses `parity/win32-probe.ps1`, a
  standalone `GetCursorPos` + `GetForegroundWindow` script.
- **Fixtures report their own geometry where they can.** Measuring a window
  from outside means guessing where the title bar and decorations end.
  `parity/fixtures/native.py` and `native-macos.m` both publish their content
  origin; `browser.html` publishes `window.screenX/Y` and its inner/outer size
  when it is served over http.
- **A task the platform cannot express gets `skip` with a reason** in the
  per-platform suite, and appears in the matrix as skipped. Never drop a row.
- **Per-platform suites are `parity/tasks.<platform>.json`**, picked up
  automatically, with `parity/tasks.json` as the shared default. Keep the task
  ids identical so the columns stay comparable, and put the platform's reason
  in `known_limitations["<platform>-<session>"]`.

## Things measured on macOS that are worth re-checking elsewhere

These were surprises here; the equivalent question is worth asking on each OS.

1. **Can pointer events be delivered to a chosen process?** On macOS, no —
   keyboard yes, pointer and scroll no, by every API. That is what forced the
   accessibility-first pointer path and the `strategy` parameter on
   `left_click`. X11 and Windows deliver input to the focused window instead,
   so the answer there is different but the receipt should still be honest
   about what it cost.
2. **Does the receipt tell the truth about cost?** `pointer_moved`,
   `foreground_taken`, `foreground_before/after` exist on macOS receipts. A
   Windows backend that moves the cursor should say so the same way.
3. **`strategy: "a11y"` must fail closed on backends without an accessibility
   press for coordinates.** `linux.mjs`, `win32.mjs` and `harmonyos.mjs` do
   this today (`assertEventStrategy`); keep it that way rather than silently
   degrading to a raw click.
4. **Does the app/agent route prepare arguments the same as the in-process
   route?** It did not, until recently: coordinate targets were sent to the
   desktop app and the ssh agent as raster pixels instead of screen points,
   which is wrong on any scaled display and skipped the raster's own refusals.
   `tests/server-wire-targets.test.mjs` covers that route now
   (`CODEWHALE_CU_TEST_REMOTE=1`); it is platform-neutral and should stay green.

## Known small gaps

- `list_apps` reports no `windowCount` on any backend, so a caller cannot tell
  which applications have windows without a second call. `scripts/smoke.mjs`
  works around it by falling back to the frontmost app.
- There is no Wayland driver; the X11 driver's `xdotool`/`xwininfo` calls will
  not work there.
- No Codex baseline exists on any platform, so no parity *claim* is published —
  only the measured matrix. `docs/PARITY.md` says how to record one.
