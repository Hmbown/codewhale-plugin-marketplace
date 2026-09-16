# The Linux box

A container that is a real, if headless, Linux desktop: Xvfb, a window manager,
the X11 command-line tools the backend shells out to, an AT-SPI accessibility
bus, and the parity suite's two fixtures (Chromium and Tk). It exists so the
Linux backend can be exercised from any machine with Docker, instead of only
from someone's Ubuntu install.

```sh
docker/run.sh            # npm test
docker/run.sh parity     # npm run parity -- --isolated
docker/run.sh smoke      # npm run smoke
docker/run.sh shell      # a shell on the X session
docker/run.sh -- npm run parity -- --isolated --task 'native.*' --repeats 5
```

Receipts land in `receipts/linux-docker/<timestamp>/` on the host. The source is
copied into the image rather than mounted, so every run reflects a build; the
dependency layer is cached, so edit-and-re-run costs a few seconds.

## What a green run here is, and is not, evidence for

It qualifies the X11 code paths and the isolated parity route on a live X
server with a live accessibility bus. Both are real: the backend runs the same
`xdotool`, `wmctrl`, `scrot` and `pyatspi` calls it runs anywhere.

It is not evidence for **Wayland** (no driver exists), for a **real login
session** — `native.modal_dialog` depends on window-manager focus policy and
fails under the stacking WMs tested here and under KWin — or for anything the
**macOS app** holds, which is where permissions, human controls and background
input live. It also cannot speak to hardware input, multi-monitor or scaled
displays.

Interference is measured, not assumed away. The entrypoint runs a second Xvfb
on `:0` as the "host" desktop, because the isolated route's claim is that it
leaves the host untouched — and a probe against a display that does not exist
reports zeroes whether or not anything moved.

## Two things the container gets to decide

**The browser is Chromium.** There is no arm64 Google Chrome for Linux, and
most distributions ship only Chromium. The driver reads the browser's
accessibility name from `--version` and the tasks target it by that name, so
both browsers work; the receipt records which one ran.

**Chromium's sandbox is off** (`/etc/chromium.d/00-container`). It needs
privileges the container does not have. This affects the fixture, not the code
under test.

## Resolved non-green rows (2026-09-16)

`docker/run.sh parity --repeats 5` on 2026-09-16 (Chromium 152, Debian 12,
node 24.21, Xvfb 1600x1200) is **25/27 demonstrated**: every row green except
`native.modal_dialog` (fails, documented below) and the two held-input rows
(skipped, documented). Receipt: `parity/results/linux-xvfb-isolated-2026-09-16.json`
on a clean tree. Each originally non-green row was traced to a cause and
either fixed or given a committed `known_limitations` reason:

| row | what happened | resolution |
|---|---|---|
| `browser.drag_drop`, `native.drag_square` | `input_owner_required` | **product.** Held-input gestures require a persistent input owner (desktop helper or `agent --serve`); the in-process route refuses by design. The 2026-09-07 receipt predates the guard. Both tasks are now `skip` with a committed reason. |
| `native.unicode_type` | `Ünïcödé ✓` arrived as `ünïcödé ✓` | **real bug, fixed.** `xdotool type` remaps a spare keycode for a character absent from the keymap; XKB resolves a lone uppercase alphabetic keysym at level 0 and emits lowercase (`key U00DC` → `ü`, `key shift+U00DC` → `Ü`). The backend now sends every non-ASCII code point via `key U<hex>` (adding `shift+` for cased capitals) with a short settle between remapped chars. |
| `browser.upload` | every step "succeeded" but no file arrived | **two real issues, both fixed.** (a) The chooser window had been escaping onto the host `:0` display — dbus-activated services inherit the *bus daemon's* environment, so the isolated route now runs a private session bus under `DISPLAY=:99` (keeps the chooser, and the AT-SPI registry, on the isolated display — the isolation claim the host probe exists to check). (b) Chromium's in-process GTK chooser discards a location-entry path on Return (closes with no selection — a stock `GtkFileChooserDialog` commits it, so this is Chromium's wrapper); the task now types the path then clicks the dialog's Open button via the new `window_title` target. The chooser exposes no AT-SPI elements, so a pointer click is the only drive path. |
| `native.modal_dialog` | dialog stays open | **real limitation, documented.** The Tk `simpledialog` is toolkit-modal only (`WM_TRANSIENT_FOR` + `grab_set`, no `_NET_WM_STATE_MODAL`), so under openbox *and* metacity the parent-window click takes X input focus; the grab still blocks the click but the typed answer never reaches the dialog. Recorded in `known_limitations["linux-xvfb"]`. |
| `browser.stale_element` | `dyn` stuck at `loading` | **stale task, fixed.** The fixture holds `loading` until `#dyn` itself is clicked; the shared task wrongly expected `ready`. The corrected steps (already proven in `tasks.darwin.json`) are now in `tasks.json`. |
| `browser.form_submit` | intermittent | **resolved.** 5/5 in the repeats-5 receipt; the flake was fixture-launch/oracle timing, now gated on a readable `CU-FIXTURE` state. |
| `control.permission_denied` | error text lacked `DISPLAY` | **environment leak, fixed.** The image sets `XDG_SESSION_TYPE=x11`, which survived the task's `DISPLAY`/`WAYLAND_DISPLAY` blanking and took the `permissions_denied` branch instead of `no_session`. The task now blanks `XDG_SESSION_TYPE` too. |

Two harness-level defects surfaced only at `--repeats 5`: Chromium children
`setpgid` into their own groups inside the fixture's session, so a group kill
left live orphans that accumulated across 135 launches (the driver now sweeps
the fixture's whole session); and a `launchFixture` throw after spawn leaked
the family entirely (it is killed before the throw now). A rep that fails in
runner setup — fixture never ran the task — is retried once and the receipt
records `launch_retry`.
