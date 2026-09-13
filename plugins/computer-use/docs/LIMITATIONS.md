# Limitations


## Version 0.3.0 presentation and controls

The new menu-bar setup panel, live session status, Pause/Stop, practice check
and verified updater are macOS features. Windows/Linux still use host-side
permission probes and the existing stop tool; no native menu panel or signed
installer qualification is claimed for those platforms. The self-contained
macOS bundle requires macOS 13.5+ (its pinned Node runtime minimum).

Installed local helpers take precedence over embedded native binaries. A
registered helper that fails to start does not fall back to direct input.
Explicit developer mode (`CODEWHALE_CU_APP=off`) has no menu-bar controls and
must never be used by a model to bypass a user's Pause or Stop.

The practice check proves one AppKit field/button and scoped screenshot. It
measures foreground/pointer changes but cannot distinguish a physical user
move from another process's move; any movement makes isolation inconclusive.
It does not qualify arbitrary apps, raw background dragging or full Codex
parity. Packaging scripts refuse a release archive until notarization,
stapling, signature and Gatekeeper checks pass.

Everything below is either untested or known-broken. The source of truth for
live verification is `docs/PARITY_MATRIX.md`; this file lists what the matrix
cannot claim, and the behaviour behind the numbers it does claim.

## Platforms not live-verified in this repo's receipts

Every row marked **untested** in the matrix's "Platforms" table appears here:

| surface | state |
|---|---|
| macOS Retina | local 0.2.1 development receipts on one arm64 Mac (macOS 26.1): 26-task run 129/130, dynamic-page retry 5/5, upload retry 5/5; all 27 workflows have five-trial passing evidence, with earlier failures retained; final artifact and full Codex parity remain separate |
| macOS non-Retina | code-complete; every macOS receipt so far is from a 2x display |
| macOS mixed | code-complete, no receipts (mixed-scale display moves are unprobed live) |
| Windows | code-complete, no receipts (backend is PowerShell/user32; never executed here) |
| Wayland | code-complete, no receipts; `scroll` is unsupported on Wayland (`scroll on Wayland is not available in this build`), and ydotool input is never probed (the probe cannot move the pointer) |
| HarmonyOS (hdc) | code-complete, no receipts (no device) |
| SSH remote | experimental one-shot transport; no remote device receipts; see session limitation below |
| Codex / Claude Desktop host registration | full registration/restart flow untested; one native Codex editing baseline is recorded below |
| signed-update permission persistence | demonstrated — a Developer-ID-signed reinstall over a granted install kept its grants, and a notarized 0.3.0 → 0.3.1 update applied on the same Mac; a clean-machine install with fresh grants is still open |

**The Linux X11 rows in the matrix predate this repo's parity-runner refactor.**
`scripts/parity-run.mjs` was split into a platform-neutral engine plus
`scripts/lib/desktop-<platform>.mjs`; the X11 driver is a move of the existing
code, but it has not been re-executed since (no Linux host here). Those rows are
rendered from the committed summaries in `parity/results/`, not from a fresh run.

The SSH agent currently runs once per call. It does not retain a macOS
`open_application` binding for a later raw-input call, and it has no leased
remote owner for Linux/Windows held-input gestures. Do not treat registering
an SSH computer as proof of a complete remote interaction workflow. A
persistent remote session and remote-device receipts remain release work for
that transport.

## Hosts not fresh-session tested

Codex CLI, Claude Code, and Claude Desktop: none were run here. The suite
spawns `mcp/server.mjs` directly over stdio, which is the same transport every
host uses, but per-host session behavior (registration, restart, permission
prompts) has not been observed live for any host product.

## Codex baseline

The full 27-task suite still has no matching Codex column. A separate
[same-document native editing comparison](../parity/results/native-text-comparison-darwin-2026-09-07.json)
ran five times through each tool surface: both completed all five Unicode,
selection and replacement trials. Median wall time was 721 ms for Codewhale
and 2,291 ms for Codex, with six API calls per trial. These are sequential
local trials with different observation response shapes; they do not establish
whole-product parity, cost or general performance. A separate
[public-browser comparison](../parity/results/public-browser-comparison-darwin-2026-09-07.json)
completed five of five navigation trials on each surface: observe Example
Domain, follow its link and verify the IANA destination. Codewhale used the
0.2.1 signed helper. Browser engines, caching, network and polling differ, so
the timings do not establish a general performance advantage. The original
local-file browser baseline was blocked by Codex file URL policy and was not
worked around. See
`docs/PARITY.md` for full-suite baseline requirements.

## What "background" actually means on macOS

Measured on macOS 26.1 (arm64), and the reason the macOS pointer path looks the
way it does. Receipts: `parity/results/darwin-aqua-2026-09-07.json`,
`parity/results/background-input-darwin-2026-09-07.json`.

- **Keyboard is process-scoped and quiet.** `type` prefers writable accessibility selection; otherwise text and keys post
  to the process chosen by `open_application(activate:false)`. They do not move
  the pointer and do not change the foreground.
- **The measured raw pointer path did not deliver to the tested AppKit app.**
  `CGEventPostToPid` (with a NULL source and with an HID source) and
  `CGEventPostToPSN` all deliver keyboard events and silently drop mouse and
  scroll events — measured against an AppKit application both in the background
  *and* while it was frontmost. These fixtures do not establish that every
  toolkit or process-directed pointer technique is unsupported. The production
  background path uses verified accessibility actions; raw pointer delivery
  requires separate qualification.
- **So a coordinate click resolves through accessibility first.**
  `left_click` hit-tests the point against the bound application's AX tree
  (`AXUIElementCopyElementAtPosition`, then a bounded geometric search for the
  smallest pressable element containing the point, because Chromium answers the
  hit test with the window rather than the control). A hit performs the
  element's supported click, focus or selection action: no pointer motion, no activation. The receipt says
  `strategy: "a11y"`.
- **Background mode refuses shared pointer gestures.** With no pressable
  element, and for raw double/triple/middle click, drag and hover,
  the default `activate:false` binding returns `shared_pointer_required`.
  Context menus and scrolling now use supported accessibility operations;
  unavailable semantic operations fail without a raw pointer fallback.
  Only explicit `activate:true` shared-desktop control permits the event tap.
  That moves the user's cursor (it is put back
  afterwards: `pointer_restored: true`; observed displacement is reported in
  the matrix and can be nonzero on the shared desktop) and requires the target application to remain
  frontmost. Gestures stop on focus loss and never reactivate the target. The receipt carries `strategy: "event"`, `pointer_moved: true`,
  `foreground_taken`, `foreground_before` and `foreground_after`.
- **The foreground cannot be given back.** macOS 14+ ignores activation
  requests from a process that is not itself frontmost — measured for both
  `-[NSRunningApplication activateWithOptions:]` and setting `AXFrontmost`. The
  helper takes the foreground deliberately (otherwise AppKit swallows the
  activating mouse-down and a drag loses its press) and reports it. It does not
  pretend to restore it.
- **A global gesture is refused when the point belongs to someone else.**
  Before posting, the window under the point is resolved
  (`CGWindowListCopyWindowInfo`, skipping fully transparent overlays and
  system-level windows such as the Dock and menu bar). If a normal-layer window
  from another application covers the point, the action fails closed and names
  the owner. Observed live during development: a stray TextEdit window over the
  fixture produced a refusal rather than a click into the user's document.
- **An accessibility press refuses to cross a modal sheet.** `AXPress` invokes
  a control's action directly and would otherwise sail past a window-modal
  sheet that a real click cannot cross; `hit_test` reports
  `window_blocked_by_modal_sheet` and the click fails rather than acting.
- **`strategy` is explicit on `left_click`**: `auto` (default, accessibility
  then the pointer gesture), `a11y` (require accessibility, fail closed),
  `event` (force the pointer gesture). Other backends refuse `a11y` rather than
  silently degrading to a raw click.

## Input destination and foreground delivery

`open_application(activate:false)` binds raw keyboard input to the selected
process without requiring foreground focus. Version 0.2.1 also supports
explicit `activate:true` for workflows that require shared foreground
keyboard delivery. Each key-down and Unicode grapheme checks that the chosen
process is still frontmost. If focus changed, the action is refused before
sending more text; held keys are released only when this session actually
sent a press (or a dispatched helper was interrupted before acknowledging it).
Receipts distinguish `keyboard_delivery: "process"` and
`"foreground-guarded"`. Selecting `activate:false` resets the latter.

Neither delivery mode supplies application acknowledgement. Observe the
result, especially in native file dialogs and applications whose toolkit
ignores synthesized input. Session bindings and observations are independent
across MCP clients; local app actions are serialized. Old clients/helpers
must be restarted or upgraded together for session protocol 2.

## Background input, per application family

Historical observations from `node scripts/background-input.mjs`, each against a disposable
instance the script launches and kills — never an application the user already
has open. "Background" means bound with `open_application(activate:false)` and
not explicitly activated by a tool. However, the old harness did not ensure
that the target was inactive, compared app names rather than PIDs, and sampled
only before/after. In the Chrome and Chromium receipts the target was already
frontmost. Those rows establish effects, not background isolation.

The new `scripts/verify-background-macos.mjs` keeps a disposable native AppKit
window behind the user, checks the fixture file for text/button/scroll effects,
and samples foreground PID and cursor through an independent observer with a
10 ms polling interval. Its watch loop now services NSWorkspace notifications;
earlier watch-probe receipts with cached foreground state are superseded.
It also checks that an unqualified observation and capture stay app-scoped.
A physical cursor move or any focus change invalidates that trial's isolation
verdict. It can also bind the running installed helper. An opt-in separate
trial deliberately switches to an owned decoy during held input and checks
target completion, no decoy input and no focus reclaim. These are MCP tests,
not Engine/model parity; see [the commands](DEMO.md).

| family | observable (AX elements) | keyboard in background | accessibility press in background | window stays behind | verdict |
|---|---|---|---|---|---|
| AppKit (`parity/fixtures/native-macos.m`) | 101 | yes | yes | yes | **verified live** |
| Browser — Google Chrome | 85 | target was frontmost | effect observed | not established | **background unqualified** |
| Chromium-based — Chromium | 122 | target was frontmost | effect observed | not established | **background unqualified** |
| Electron — Visual Studio Code | 12 | **no** | no oracle-backed control to press | yes | **verified failed** |
| Tk — python3 tkinter | 6 | **no** | **no** (no pressable element exists) | yes | **verified failed** |
| Java — Swing/AWT | — | — | — | — | **untested** (no Java runtime on this host) |

The two failures in detail:

- **Electron (VS Code).** Keystrokes posted to the process do not reach the
  editor: with the previous batched encoding exactly the final batch arrived
  (three characters of a nineteen-character marker, reproducibly, 3/3 runs),
  and with one grapheme per event nothing arrives. Its window exposes 12
  accessibility elements — `AXWindow`, `AXGroup`, `AXButton` — and no editable
  element at all, so there is no semantic route either. The `type` receipt
  says so: the focused element has no readable text value, so it returns
  `verified: false` with `verification_required: "screenshot"` instead of
  claiming success. Confirm through a screenshot or the application's own
  state before relying on a keystroke here.
- **Tk (python3 tkinter).** Tk/Aqua consumes no CGEvent posted to its process —
  not keyboard, not pointer — whether the application is frontmost or not, and
  it exposes almost no accessibility tree (6 elements for a window with a dozen
  widgets). This is why the macOS parity suite uses a purpose-built AppKit
  fixture rather than the Tk one the Linux suite uses: Tk could not tell a
  product failure apart from a toolkit that ignores the input.

Not covered: Java (no runtime installed), Qt, GTK-on-macOS, and applications
that only expose accessibility after the user has enabled it in their own
settings.

## macOS workflow qualification

The earlier menu skip and form/file-panel failures have five-trial passing
receipts in the current matrix. Native menus use their observed AX actions;
Chrome popup choices use AXPick; file upload observes the native Go to Folder
field and completion row before opening the verified fixture file.

The broad 26-task run retained one dynamic-page failure: the fixture's 800 ms
loading timer expired before the supposedly premature click was delivered.
The fixture now holds loading until that click arrives, then reveals Confirm;
all five repetitions passed. This is a corrected test precondition, not proof
that arbitrary dynamic pages cannot race. Re-observe changed interfaces.

Native panels remain application-dependent. In the packaged Codewhale app's
folder picker, semantic setting changed the visible path, but confirming it
did not navigate; focused, foreground-guarded typing and Return did. Verify the
result after dispatch. Shared raw gestures can take focus, and physical-user
input preemption is not yet qualified.

## Models without vision

Both model types can observe text and act through the same semantic targets.
The default summary preserves controls, values, actions and layout without a
screenshot. Full detail remains available for nested menus and hierarchy.
The saved Codewhale app observation shrank from 51,759 to 17,082 bytes (67%)
while retaining all 18 nonempty values and all 77 non-menu nodes.

Optional macOS OCR recognizes text from the selected app window locally. Live
app capture returned 28 text blocks and correctly read the selected computer
and folder. A generated image independently checked exact text and pixel
bounds. OCR can misread icons or characters even at high confidence; its
blocks are recognized text, not accessibility roles or advertised actions.
It cannot substitute for visual reasoning about unlabeled graphics or charts.
Windows, Linux and HarmonyOS do not yet have this OCR path. Their accessibility
state remains available with an explicit OCR-unavailable result.

A full same-task comparison of models with and without vision is still open;
local OCR and MCP tests do not establish equal completion rates by themselves.

## Host and direct-input limits

Codewhale currently attaches one image per tool result up to 5 MiB. Larger
images receive an explicit omission notice; use an app-scoped screenshot,
region or zoom and observe the new raster before selecting coordinates.
Multi-display, mixed-DPI and oversized-raster workflows need device testing.

On Linux and Windows, `hold_key`, `left_mouse_down` and `left_click_drag`
require a connected, session-owning Computer Use desktop helper. Direct mode
refuses these gestures before any pointer movement or key press and reports
`input_owner_required`; `request_access` exposes `held_input`. This prevents
an abruptly killed MCP client from leaving a persistent press behind. A
mouse-up also refuses when this session owns no press. Ordinary one-shot and
semantic operations remain available according to the platform's capabilities.
These command paths have local injected-runner tests, not fresh device proof.

Linux and Windows recording is unavailable in 0.2.1. Their former detached
recorders could outlive the client and a second start could lose the first
recorder's ownership. `recordingStart` now refuses with
`owned_recording_unavailable` before launching a process, and the capability
probe reports recording unavailable. Restoring it requires owned lifecycle
cleanup and device verification. Screenshots and existing recording-file
listing remain available.

## Known behavioral limitations (from the live runs)

- **Shared-desktop route interferes with the user session (Linux).** The shared
  run (DISPLAY=:0) moves the hardware pointer (median displacement 0px, with
  spikes up to ~700px on fixture launches) and changes the active window on
  most repetitions. The isolated route (`--isolated`, Xvfb :99) leaves the
  host untouched (0px, no active-window change).
- **There is no isolated route on macOS.** One login session owns the
  WindowServer, so the parity suite runs on the shared desktop and reports
  interference per task instead of engineering it away. Pointer displacement
  across the agent's own tool calls is 0px on every macOS task (the cursor is
  restored); the foreground is taken on the tasks whose gestures have no
  accessibility equivalent, and the matrix names them.
- **Tk modal dialogs under KWin (linux-x11 shared).** KWin does not give the
  transient Tk dialog X input focus, so synthetic key events do not reach it.
  `native.modal_dialog` fails 5/5 on the shared route and passes 5/5 isolated.
- **Tk posted menus do not receive synthetic key events.** `native.menu_command`
  was reworked to click the menu item with the pointer; keyboard traversal of
  a posted Tk menu is not achievable with XTEST input on this platform.
- **Element revalidation cannot detect an in-place replacement that keeps
  role + label + geometry.** Revalidation compares role, label (when both are
  non-empty), and geometry; a DOM swap that preserves all three is
  indistinguishable.
- **macOS zoom** has single-Retina live receipts; nested zoom and mixed-display
  child rasters remain untested.
- **macOS has an opt-in agent preview** with a drawn cursor. Other platforms
  have no equivalent preview.
- **Each MCP session has its own input binding.** Session protocol 2 separates
  backend state in the long-running daemon. New clients also require background
  protocol 1 so an older app cannot silently serve the preemption/scoping fixes.
  Bind explicitly at the start of a task.
- **`request_access` cannot read macOS Screen Recording TCC state** — the probe
  can attempt a capture but cannot query the TCC database directly.
- **`request_access` / `probe` now fail closed on Linux**: `no_session` when no
  X11/Wayland session is visible, `permissions_denied` when the input or
  screen-capture probe fails — this is intentional, but means headless Linux
  agents get an error rather than a capability table.

## Signed updates / bundle identity

`build:app` / `install:app` now sign with a stable identity when one is
present: `CODEWHALE_CU_SIGN_IDENTITY` if set (use `-` to force ad-hoc), else
the first "Developer ID Application" certificate in the keychain, else
"Apple Development", else ad-hoc. TCC grants (Accessibility, Screen
Recording) are keyed to the designated requirement — team + bundle id — so
Developer-ID-signed reinstalls keep their grants; ad-hoc builds re-hash on
every install and lose them (the build prints a warning when this happens).

`install:app` stops a running daemon before launching the new bundle. A daemon
that is already up keeps the modules it loaded at start, so leaving it running
makes every later check report the *previous* build's behaviour — which is how
one round of development receipts was once produced against stale code.

Demonstrated 2026-09-06 (arm64, macOS): after a one-time grant, killing the
daemon and reinstalling a Developer-ID-signed bundle over the granted install
kept `probe.permissions.accessibility === "granted"` with no System Settings
action — the full `scripts/verify-macos.mjs` run passed immediately after
reinstall. The updater's apply path later replaced an installed notarized
0.3.0 with a notarized 0.3.1 build on the same Mac. Not covered: a
clean-machine install with fresh grants, and an update installed from a
published GitHub release, since none has been published.
