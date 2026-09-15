# Release notes

## Unreleased — window-routed background pointer

- **Background mouse input now reaches AppKit views without touching the
  user's cursor.** Process-directed mouse events (`CGEventPostToPid`) never
  reach AppKit, and posting to the HID tap moves the real cursor. The
  production route addresses each event to the target window id (event fields
  `0x33`/`0x5b`/`0x5c`) with a window-space location
  (`CGEventSetWindowLocation`) and posts it as its raw event record through
  `SLPSPostEventRecordTo`. Measured on macOS 26.1: view-level delivery
  requires the window to be *key* — the window-focus record alone makes it
  only *main* (events arrive and are swallowed) — so the helper takes a
  momentary front-process lease with no-windows options and restores it in
  `@finally`, re-asserting the previous app through the Accessibility grant
  when the restore lags. Every receipt reports `front_lease` truthfully.
  - Coordinate `left_click`/`double_click`/`triple_click`/
    `right_click`/`middle_click` on a point with no pressable AX element and
    `left_click_drag` now deliver in background mode instead of refusing
    with `shared_pointer_required`. Delivery is by window id to a window
    owned by the bound app, so events cannot land on a covering window.
  - **Menus survive the flow.** A menu opened by a background click closes
    the moment the lease ends, so menu-opening clicks hold the lease across
    calls (state file + 15 s watchdog + restore at the next raw-input call,
    and only while the target is still frontmost). Web popup buttons report
    unpressable so they get a real click — `AXPress` does not open the
    native menu — and the helper polls for the menu through Chromium's
    post-activation AX rebuild. Observes poll for menu items while a menu
    lease is held.
  - **Wheel scrolling uses pixel units.** Chromium ignores line-unit wheel
    events entirely (measured); one notch now maps to 40 px.
  - **Astral-plane typing works in occluded windows.** The WindowServer
    drops key translation for covered windows, losing surrogate-pair
    graphemes (measured: "héllo wörld 日本 🐳" → "héllo wörld 日本 "). Any
    multi-unit grapheme now routes the whole keystream through the record
    channel under one lease; receipts say `keyboard_delivery:"window-record"`.
  - **Activation repaired.** `open_application(activate:true)` uses the
    WindowServer front-process channel (options 0x200) with the AXFrontmost
    fallback, and the confirmation wait pumps the run loop — a one-shot
    helper otherwise reads a stale NSWorkspace answer for seconds.
  - **`set_value` covers web text fields.** Direct `AXValue` writes are
    still refused (Chromium ignores or coerces them), but the backend now
    answers with the replacement path instead of an instruction: focus,
    select-all through the window-record channel (menu key equivalents need
    a key window — new `bg_key` primitive), type, read-back verify.
    Receipts say `strategy:"focus-type-replace"` with `verified` from the
    control's own value — the last capability kimi-cu held over us.
  - **Observation rides out Chromium's a11y rebuilds.** Windows that vend
    zero content are rebuilt-tree states, not empty pages: unfiltered
    observes poll up to 2.4 s (longer while a menu lease is held) before
    returning. Filtered observes are exempt — an empty match is a legitimate
    answer.
  - Live receipts (macOS 26.1): full parity suite 28/28 tasks × 5 reps —
    background drag to a drop zone, `<select>` popup open + pick, native
    file-picker upload, emoji into a fully occluded window — with the real
    cursor position unchanged across every gesture and the operator's
    foreground restored.

## 0.6.0 — web-area traversal and flat-index targeting

The plugin could not see inside browser pages: `get_app_state` on Chrome
returned the toolbar and tab strip but never descended into `AXWebArea`, so
every control on the page was invisible to observe, target and verify. This
version fixes the blindness and the interaction-model friction around it,
matching the behavior kimi-cu demonstrated while keeping Codewhale's
receipts, batching, clipboard, preview and remote-computer surfaces.

- **macOS observation now unlocks web content.** The backend sets
  `AXEnhancedUserInterface` + `AXManualAccessibility` on target app
  elements before walking, so Chrome/Electron `AXWebArea` subtrees vend
  their DOM. Traversal budgets grow to depth 16 / 900 elements for
  summaries and depth 24 / 1600 for `detail:"full"` and `query`/`role`
  filtered observes — a filtered find can now reach deeply nested web
  controls. An `AXWebArea` that arrives with no descendants (page still
  populating) triggers one 200 ms re-observation before returning.
- **`state_id` is optional on element targets.** `{type:"element", index}`
  binds the computer's latest observation — observe, then act on the flat
  index, kimi-style. Passing `state_id` pins a specific earlier snapshot
  (e.g. one returned by `wait_for`). Live-tree revalidation,
  `element_stale`, `state_wrong_computer` and `target_reacquired` receipts
  are unchanged.
- **Degenerate-frame refusal.** Acting on a zero-size element — collapsed
  placeholder rows vended by virtualized lists (`13x0`, `734x1`) — fails
  `degenerate_frame` telling the caller to scroll the row into view and
  re-observe, instead of pressing a phantom rect.
- **`set_value` handles numeric controls honestly.** `AXIncrementor`,
  `AXSlider`, `AXStepper`, `AXValueIndicator` and `AXProgressIndicator`
  receive an `NSNumber` parsed with a POSIX `NSNumberFormatter`; a
  non-numeric string fails before dispatch with a focus-then-type
  instruction (previously a string write could clear the control). The
  value is read back and reported as `verified`. Elements under
  `AXWebArea` refuse `set_value` before dispatch entirely — Chromium
  accepts `AXValue` sets and then ignores them, or a numeric control
  coerces the write to empty — with an instruction to `focus` the
  element and `type` instead.
- **Web-area typing uses real key events.** `type` skips the
  `AXSelectedText` semantic path for elements under `AXWebArea`
  (Chromium accepts the write and drops it) and sends process-bound
  unicode events after accessibility focus — still no pointer movement,
  still verified against the control's own value.
- **The preview panel is on by default** while an app is bound: a
  nonactivating mini view of the captured app window with the agent
  cursor drawn at each action's target — element-targeted actions update
  it too, not just pointer gestures. The real pointer never moves;
  `preview(enabled:false)` mutes it for the session.
- **Source installs reuse the signed helper.** When the plugin runs from
  a plain checkout (Kimi Code and other hosts' plugin dirs), the backend
  now prefers `~/Applications/Codewhale Computer Use.app`'s signed helper
  over compiling an unsigned one — so accessibility and screen-recording
  grants carry over instead of re-prompting or silently failing.

Live spot check on the maintainer Mac (macOS 26.1, arm64): real Chrome on
a long ChatGPT page yields ~750 elements to depth 24 including the composer
`AXTextArea`; the same call before the change returned ~85 browser-chrome
elements. An OCI-style create-instance form driven end-to-end through the
installed app — background, flat indices, no pointer movement — typed the
name field (`verified:true`), pressed the radio, refused the web
incrementor, filled the textarea and produced `created:<name>`. The real
OCI wizard (`cloud.oracle.com/compute/instances/create`) still wants its
own receipt before the `docs/LIMITATIONS.md` rows change.

Source suite: 260 passed, 0 failed, 15 platform skips (`npm test`);
Objective-C helper compiles clean in normal and `CU_TEST` builds.

## 0.5.0 — stateful waits and persistent SSH sessions

The workflows that burned observe→wait→observe round-trips on dynamic UI now
have a first-class wait, and SSH remotes are no longer one-shot-per-call.

- `wait_for` polls the accessibility tree until a `query`/`role` match
  appears (`state:"present"`, the default) or disappears
  (`state:"absent"` — dialogs dismissed, spinners finished). Intermediate
  polls are ephemeral so they cannot evict the states you already hold or be
  targeted by accident; the satisfying observation is rebound and returned as
  a fresh `state_id` with its matched elements, ready to act on. Timeouts
  return an honest `timed_out:true` receipt rather than throwing, and
  cancellation / stop / computer-switch abort immediately.
- `type` and `key` accept an element `target` from `get_app_state`: the
  element is revalidated and accessibility-focused first, then the text or
  key is sent — the documented focus-then-act idiom in one call. If the
  element went stale, the call fails closed at `stage:"focus"` and no
  keystrokes are sent.
- `recording_start` accepts `app_ref`/`window_id` on macOS to crop the
  recording to that window's rect at start (it does not follow later moves),
  picking the display the window lives on.
- `recording_list` on macOS now returns `.jpg`/`.jpeg` files — screenshots
  saved by the system default JPEG format were previously invisible.
- `agent.mjs --serve` runs the SSH remote agent as a persistent session over
  one connection, so `open_application` bindings and session-owned input
  survive between calls instead of dying with each request. The server uses
  it automatically, falls back to one-shot mode for an older pushed agent,
  and fails closed after a channel restart until the remote app is rebound
  and re-observed — requests that may have run remotely before a timeout or
  disconnect are marked `requestDispatched` rather than silently retried.

Source suite at commit `b25f11c8673667329af2d9172aa57b153b9cc49d`:
258 passed, 0 failed, 15 platform skips (`npm test`); live smoke on the
maintainer Mac 23/23.

0.5.0 is a Developer ID-signed, notarized universal macOS build from commit
b25f11c8673667329af2d9172aa57b153b9cc49d, with its packaging receipt in
[docs/releases/0.5.0.json](docs/releases/0.5.0.json). It was published on
2026-09-15 (PDT) as the [v0.5.0 GitHub release](https://github.com/Hmbown/codewhale-cu-plugin/releases/tag/v0.5.0);
the setup page at https://codewhale.net/computer-use offers the download and
**Check for updates…** in an installed 0.4.0 app offers it.

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
