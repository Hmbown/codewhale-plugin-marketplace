# Release notes

## 0.8.0 — window frames, installed apps, trajectories, capability grants

The last four from the dogfood gap list, in one batch (no per-feature version
churn):

- **`set_window_frame`** — move or resize one window by exact geometry
  (`{x,y,w,h}` in the `list_windows` space) and read the result back from the
  app itself: `verified` is the app's own geometry after a settle loop, with
  `ax_errors` and a plain note when an app constrains (minimum sizes are
  common) or refuses (fixed-size windows) part of the frame. Both axes
  refusing is `frame_refused`.
- **`list_apps {installed:true}`** — the installed catalog of openable apps
  (`/Applications`, `/System/Applications`, `~/Applications`, one
  subdirectory deep; bundle identity read from the bundle, never the folder
  name) with running flags. On the dogfood machine: 143 apps, the user's
  Chrome correctly flagged with its pid. The running-process list is not
  consulted for this view.
- **Trajectories — record, status, replay** (`trajectory`, advertised 36).
  A local JSONL of every tool call the session makes — refusals included —
  in the recordings dir, off until started. `replay` re-enters the normal
  pipeline (grants, permissions and the kill switch all still apply), stops
  at the first refusal, never re-records itself, refuses ids that escape the
  trajectories directory, and caps a replay at 200 turns; `dry_run` lists the
  plan first. Arguments are stored verbatim so replay is faithful — that is
  the documented trade.
- **Capability grants** — `CODEWHALE_CU_GRANT` (`read-only`, or a comma list
  of tool names; merged names expand to their whole action set), fixed at
  launch, nothing can widen it. Enforced twice: the server filters
  `tools/list` and refuses calls as `not_granted` before validation, and the
  app daemon stores the granted wire set on the session lease and refuses
  ungranted tools at the boundary that actually sends input. Cleanup
  (`close_session` / `release_session_input`) and `stop_computer_control` are
  never blocked; `request_access` reports the active grant.

Verification: `npm test` 332 tests — 318 pass / 0 fail / 15 platform-skipped
(9 new across darwin, trajectory, grants, session lifecycle). Live smoke, app
mode against the installed bundle: 143-app installed catalog with running
flags (the user's Chrome flagged, its pid intact); TextEdit and Calculator
frame changes with the app's own readback (Calculator's fixed-size refusal
surfaced as ax_errors while the position moved); trajectory recorded three
turns including a refusal, dry-run listed the plan, replay stopped at the
refusal; a read-only grant narrowed the surface to 19 tools, refused
`click` as not_granted, rode the daemon lease, and reported itself via
request_access; browser and session registry spot checks stayed green —
25/25 (receipts in /tmp/cu-probe-082).

Follow-up on the same release, from the first hosted CI run of the sync:
`request_access` now reports the active grant on its *refusal* receipt too.
The Linux CI environment has no `DISPLAY`, so the probe itself refuses with
`no_session` before the grant was attached — a narrowed session on a headless
host could not see its own bounds. The grant is a launch-time server fact; it
now rides both the success and the refusal receipt, and the Linux suite (which
runs the platform tests macOS skips) is green: 333 tests — 306 pass / 0 fail /
27 skipped in a `node:22` Linux container; macOS 318 pass / 0 fail / 15
skipped. This is a fix, not a feature: the release stays 0.8.0.

Second follow-up on the same release, from the muse-driven acceptance pass:
macOS `open_application` reported `launched: true` even when it merely
resolved an already-running process — the literal was hardcoded while the
launch branch above it is conditional. It now reports whether this call
actually ran the opener (linux/win32/harmonyos always spawn, so theirs was
already accurate). macOS suite: 334 tests — 319 pass / 0 fail / 15 skipped.
Still a fix: the release stays 0.8.0.

## 0.7.2 — browser control over CDP

The capability axis we did not have: a Chromium-family browser driven over the
DevTools protocol, in a **self-owned profile** (`state/browser/profile`) with
one tab per session. The user's own browser — profile, tabs, logins — is never
attached to and never touched; the last session out closes the shared browser.
No screen coordinates and no accessibility are involved: elements are CSS
selectors through the DOM domain, and coordinate clicks are page-viewport
pixels — a space named differently from screen points so the two can never be
confused.

One advertised tool (`browser`, 33 -> 34) with actions `start | status |
navigate | click | type | screenshot | stop`; the seven wire names stay
callable and hidden. Page screenshots come back as inline images through the
same single-message budget guard as screen captures. Wired into all three
desktop backends (CDP is OS-independent) and the ssh transport. Node needs a
global WebSocket (22+); older runtimes refuse with `unsupported_runtime`
instead of half-working.

Verification: `npm test` 321 tests — 306 pass / 0 fail / 15 platform-skipped
(14 new: scripted-CDP unit coverage for every action, launch-tab adoption,
busy-instance tab creation, live-endpoint reuse, stale-port replacement,
last-one-out close, url refusals). Live smoke against the installed bundle:
real Chrome launched in its own profile, fixture-page click and type verified
by the page's own title, page screenshot inlined as an image, `stop` closed
the tab and the browser while the user's own Chrome was untouched — 20/20
(receipts in /tmp/cu-smoke-072).

## 0.7.1 — live preview, session visibility, kill_app; dogfood fixes

Straight out of the 2026-09-17 live dogfooding of 0.7.0 on a real Mac (a
scripted 9-check sweep with raw JSON-RPC receipts, run while another model
drove the same daemon):

- **The preview panel is live while a session is bound.** After the first
  successful capture a timer keeps refreshing it (default 1s;
  `CODEWHALE_CU_PREVIEW_REFRESH_MS=0` disables), so the person watches the app
  instead of a frozen still. A hide now quiesces an in-flight capture (its late
  notify could re-show a just-dismissed panel), and the session that showed
  the panel hides it on close — a dead session no longer leaves an orphaned
  panel with no owner to refresh or hide it.
- **`list_sessions`.** Multi-agent coexistence made visible: live sessions as
  content-free summaries (bound target, delivery mode, current action, idle
  age, whether any session holds a pointer) plus the user's control mode.
  Lease-gated; available even while the user has paused or stopped another
  session, because seeing who is driving is how a model explains machine
  state. In direct mode it reports the one in-process session.
- **`kill_app`.** Quit or force-quit by exact name, bundle id or pid. Refuses
  an ambiguous name match (`ambiguous_application` — pass pid), never
  terminates the Computer Use helper or its host (`protected_application`),
  and reports verified termination in the receipt.
- **`open_application` now returns `app_not_found`** for names and bundle ids
  that resolve nowhere and for dead pids. The dogfood sweep showed all three
  answering with a generic `tool_error` (`open failed: Unable to find
  application named ...`), so agents could not branch on a documented code.

Advertised surface: 33 tools (31 + the two above). Docs reconciled: the quick
reference and refusal codes (including the real `window_ambiguous` trigger —
duplicate window frames for the resolved window, not merely "several
windows"), and the README preview paragraph.

Verification: `npm test` 307 tests — 292 pass / 0 fail / 15 platform-skipped
(6 new: live-preview lifecycle, `app_not_found` codes, direct-mode
`list_sessions`, `kill_app` pass-through, daemon session registry). Live smoke
on this machine (0.7.1 installed, receipts in /tmp/cu-smoke-071): 33 tools
advertised; two live MCP clients visible in `list_sessions`; Calculator
launched in the background and killed with `kill_app` (the protected guard
refuses the helper itself); the preview file advanced 2.2s of mtime over a
2.6s window, froze on mute, resumed on re-enable, and stopped on session
disconnect — 17/17.

## 0.7.0 — merged advertised surface; wire names stay aliases

`tools/list` advertises **31 tools instead of 45**. Every session pays for the
schemas it loads, and six families said the same thing with different verbs:

- **`click`** ← `left_click`, `double_click`, `triple_click`, `right_click`,
  `middle_click` (`button`, `clicks`)
- **`pointer`** ← `mouse_move`, `left_mouse_down`, `left_mouse_up`
  (`action: move|down|up`)
- **`clipboard`** ← `read_clipboard`, `write_clipboard` (`action: read|write`)
- **`recording`** ← `recording_start/stop/status/list` (`action`)
- **`computer`** ← `computer_list/switch/register/remove` (`action`, `id`)
- **`key {duration}`** ← `hold_key`

All 19 wire names remain callable as aliases: resolution runs before every gate
(required args, kill switch, routing), so a merged call and its alias enforce
identical policy, and `run_actions` steps accept either. Validation the wire
schemas cannot express (which action, what each action requires) fails as
`bad_args` naming the tool the caller asked for.

Verification: `npm test` 301 tests — 286 pass / 0 fail / 15 platform-skipped
(8 new in `tests/tool-merge.test.mjs`), including that a merged call and its
wire alias produce identical refusals and that aliases never appear in
`tools/list`.

## 0.6.2 — context diet, focus accounting, and a menu route

- **The skill travels with the server.** The existing operating guide gains
  `references/quick-reference.md` (every tool on one page, plus recipes) and
  `references/refusal-codes.md` (fail-closed codes and the move that fixes
  each), and the whole pack is now served as MCP resources: `resources/list`,
  `resources/read`, and `skills/list` / `skills/get` with a sha256 manifest
  (`skill://codewhale-cu/SKILL.md`). Guidance is read once per session
  instead of being re-stated in receipts.
- **Tools advertise MCP annotations** (`readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint`) so hosts can build approval and sandbox
  policy without guessing from prose.
- **`list_apps` defaults to regular apps.** The 22 KB process soup (XPC
  helpers, menu-bar extras, CLI children) is now opt-in with `all:true`; the
  default list is the apps a person would name. A helper that predates the
  new `activation_policy` field still returns the full list rather than
  hiding everything.
- **`invoke_menu` activates menu items by title path through accessibility
  alone** — no key events, no focus lease. App-level commands (New, Save,
  Quit) are exact; window-targeted items (Close) can validate against a key
  window a background app does not have and legitimately no-op, so the
  reference points those at the window's close-button element. Disabled items
  are refused (`menu_item_disabled`) instead of pressed; exact titles only,
  and each level is polled because menus expose items only while open.
- **Focus accounting is honest.** A window-record lease is skipped entirely
  when the target app is already frontmost (the swap would be a no-op);
  leases that *are* taken report `front_restored`, and a failed restore says
  so in the receipt — the person's menu bar must never silently stay where
  they did not put it. Restore re-asserts for up to one second.
- **The chord hedge note is gone.** A process-delivered chord now says what
  happened (`process delivery (no focus lease was taken)`) instead of
  speculating about failure.
- **Stale helpers are named.** When the running helper reports a different
  version than the plugin, `request_access` marks `app.stale` and says which
  restart fixes it — instead of letting an agent debug a build that is not
  running.
- **Native refusals map to stable codes** (`window_ambiguous`,
  `window_not_capturable`, `window_target_not_found`, `app_not_found`) for
  programmatic branching; the `get_app_state` note is shorter.

Verification: `npm test` 293 tests — 278 pass / 0 fail / 15 platform-skipped
(10 new in `tests/mcp-skills.test.mjs`); native helper compiles clean under
`-DCU_TEST=1`.

## 0.6.1 — concurrent-use hardening and honest chord delivery

Dogfooding while a person used the same Mac surfaced four defects; all are
fixed and re-verified live on macOS 26.1 (TextEdit, background mode):

- **Missing arguments no longer crash or reach the helper.** The server now
  enforces each tool schema's `required` fields before dispatch, so a bare
  `left_mouse_down`/`select_text`/`key`/`hold_key`/… call returns a
  structured `bad_args` receipt instead of a `TypeError` ("Cannot read
  properties of undefined") or an opaque native error (`-25205`). Schemas
  themselves were corrected too: `left_mouse_down` and `select_text` now
  declare `required:["target"]`, and `set_value`/`select_text`/
  `perform_action` accept element targets only — a coordinate there never
  worked and now fails `bad_target` at the boundary. Backend handlers got
  matching null-guards for direct/agent call paths.
- **`key` modifier chords actually fire in background mode.** `cmd+w`,
  `cmd+s` and friends are menu key equivalents that only validate against a
  key window; the 0.6.0 process-bound route discarded them while reporting
  `action_sent`. Flagged chords now use the window-record channel when the
  helper supports it (`keyboard_delivery:"window-record"`,
  `front_lease:true` — a momentary no-raise lease, cursor untouched). Live
  check: `cmd+w` closed the target TextEdit document while the user kept
  working. With no focusable window the chord falls back to process
  delivery *and says so* in a receipt note, so a silent no-op is no longer
  reported as success.
- **Stale targets report what actually happened.** A bare element index
  binds the computer's latest observation; the failure message previously
  printed `element 16 of undefined` because it echoed the absent
  `state_id`. Stale/stale-adjacent errors now name the resolved state id
  and app (`element 16 of state s-4 (TextEdit) no longer resolves
  (window_not_found)`) and note that the user or app may have changed it.
- **`open_application` retires cross-app element indices.** Rebinding to a
  different app deletes the computer's latest-observation pointer so a bare
  `index` can't silently address the previous app's tree under a concurrent
  user; the receipt carries a note. Explicit `state_id` pins still resolve
  through their own observation.

Also fixed: `set_value`'s web replacement path sent cmd+a twice — `bg_key`
posts a complete press per call, so the separate down/up calls were
redundant (harmless for select-all, but two front leases).

And the preview panel:

- **Borderless.** The watch panel drops its titlebar and edge chrome — it
  floats as the captured window with rounded corners, still draggable by
  its background, still non-activating. The "Codewhale · app · mode"
  caption is drawn inside the view instead of the titlebar. Close it with
  `preview(enabled:false)` or the control panel.
- **The user's real cursor is drawn too.** Each refresh now passes the
  hardware pointer position through `preview_notify`; the panel draws a
  white "you" arrow next to the cyan "Codewhale" agent arrow, both in the
  same window-relative space, so a person working alongside the agent can
  see where their cursor actually is relative to the controlled window.

Verification: `npm test` 268 pass / 0 fail / 15 platform-skipped (8 new
regression tests); `node scripts/check-receipts.mjs docs parity/results`
clean; live MCP dogfood against the installed 0.6.0 helper (direct mode,
`CODEWHALE_CU_APP=off`) exercised malformed args, background chords, stale
elements and app-switch eviction. No native-helper changes — the running
0.6.0 helper already speaks `bg_key`/`window_record`.

## 0.6.0 — window-routed background pointer and web-area traversal

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
