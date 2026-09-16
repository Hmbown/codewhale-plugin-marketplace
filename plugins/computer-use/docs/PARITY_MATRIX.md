# Parity matrix — linux-xvfb (isolated)

- commit: `b6c65ed5c29d5c4f2d27ecbc06b81ee7b3d7ee6a`
- node v24.21.0; linux 6.8.0-64-generic; display `:99` geometry 1600 1200
- suite: `parity/tasks.json`; chrome: Chromium 152.0.7977.82 built on Debian GNU/Linux 12 (bookworm); python3: Python 3.11.2; tk: 8.6
- date: 2026-09-16T08:57:57.006Z; repeats: 5
- Codex baseline: untested (no codex results)

| task | issue | Codewhale | Codex | status | median elapsed | median tool calls | pointer displacement | foreground | notes |
|---|---|---|---|---|---|---|---|---|---|
| browser.download | #2 | 5/5 | untested | demonstrated | 18272ms | 2 | 0px | preserved | - |
| browser.drag_drop | #2 | 0/5 | untested | untested | 0ms | 0 | 0px | preserved | skipped: held-input gestures require a persistent input owner — the desktop helper or the · known limitation: no Linux desktop helper exists; the local route has no input owner and left_click_drag is refused input_owner_required. The 2026-09-07 receipt predates the input-owner guard — its 5/5 for this row is stale. |
| browser.dynamic_content | #2 | 5/5 | untested | demonstrated | 56142ms | 4 | 0px | preserved | known limitation: reps right after a fixture relaunch raced the oracle: the window mapped before Chromium published the CU-FIXTURE title state, so the first expect sampled nulls (observed 2026-09-16 as 1/5 then 2/5 fails across two runs). The X11 driver now waits for a readable oracle state before launchFixture returns; kept as a note on what the wait is for. |
| browser.element_click | #2 | 5/5 | untested | demonstrated | 20394ms | 2 | 0px | preserved | optional_a11y |
| browser.form_submit | #2 | 5/5 | untested | demonstrated | 2083ms | 9 | 0px | preserved | - |
| browser.iframe_click | #2 | 5/5 | untested | demonstrated | 18041ms | 2 | 0px | preserved | - |
| browser.modifiers | #3 | 5/5 | untested | demonstrated | 18425ms | 4 | 0px | preserved | - |
| browser.outside_raster_fails | #4 | 5/5 | untested | demonstrated | 1215ms | 3 | 0px | preserved | - |
| browser.scroll_reveal | #2 | 5/5 | untested | demonstrated | 3307ms | 3 | 0px | preserved | - |
| browser.stale_element | #2 | 5/5 | untested | demonstrated | 19797ms | 3 | 0px | preserved | optional_a11y |
| browser.tabs | #2 | 5/5 | untested | demonstrated | 2132ms | 4 | 0px | preserved | - |
| browser.unicode_type | #3 | 5/5 | untested | demonstrated | 18401ms | 3 | 0px | preserved | known limitation: non-ASCII chars go through per-char `key U<hex>` (deterministic case fix), but under heavy host load XTEST can still drop a remapped char — observed 2026-09-16 as a single missing é/日 in ~1/5 reps. A delivery-layer flake on a loaded container, not a mapping defect; a starved Xvfb run is exactly where it shows. |
| browser.upload | #2 | 5/5 | untested | demonstrated | 4431ms | 5 | 0px | preserved | known limitation: Chromium's GTK file chooser commits a typed location-entry path only via the Open button — Return in the entry closes the dialog with no selection (a stock GTK3 FileChooserDialog commits the same path on Return, so this is Chromium's wrapper). The dialog also carries no AT-SPI elements, so only a window-relative pointer click reaches it. |
| browser.zoom_click | #4 | 5/5 | untested | demonstrated | 18016ms | 3 | 0px | preserved | - |
| control.cancellation | #6 | 5/5 | untested | demonstrated | 3879ms | 2 | 0px | preserved | - |
| control.permission_denied | #6 | 5/5 | untested | demonstrated | 60ms | 2 | 0px | preserved | - |
| control.reconnect_no_replay | #6 | 5/5 | untested | demonstrated | 1238ms | 4 | 0px | preserved | - |
| control.stop_blocks_actions | #6 | 5/5 | untested | demonstrated | 1154ms | 3 | 0px | preserved | - |
| native.drag_square | #3 | 0/5 | untested | untested | 0ms | 0 | 0px | preserved | skipped: held-input gestures require a persistent input owner — the desktop helper or the · known limitation: no Linux desktop helper exists; the local route has no input owner and left_click_drag is refused input_owner_required. The 2026-09-07 receipt predates the input-owner guard — its 5/5 for this row is stale. |
| native.entry_apply | #3 | 5/5 | untested | demonstrated | 1336ms | 4 | 0px | preserved | - |
| native.list_scroll_select | #3 | 5/5 | untested | demonstrated | 1817ms | 3 | 0px | preserved | - |
| native.menu_command | #3 | 5/5 | untested | demonstrated | 1720ms | 4 | 0px | preserved | - |
| native.modal_dialog | #3 | 0/5 | untested | missing | 5206ms | 7 | 0px | preserved | fail: step10 expect {"path":"dialog","equals":"closed"} never held; last={"entry":"blocked","applied":"","menu":[],"selected": · known limitation: Tk's simpledialog is toolkit-modal only: it sets WM_TRANSIENT_FOR + grab_set but no _NET_WM_STATE_MODAL, so a stacking WM lets the parent Apply click take X input focus (verified under openbox and metacity). The grab still blocks the click (applied stays empty) but the typed answer then goes to the parent and the dialog stays open. Passes where the WM keeps focus on the transient. |
| native.modifiers | #3 | 5/5 | untested | demonstrated | 17985ms | 3 | 0px | preserved | - |
| native.second_window | #3 | 5/5 | untested | demonstrated | 1994ms | 4 | 0px | preserved | - |
| native.select_text | #3 | 5/5 | untested | demonstrated | 18463ms | 2 | 0px | preserved | - |
| native.unicode_type | #3 | 5/5 | untested | demonstrated | 1981ms | 4 | 0px | preserved | known limitation: per-char `key U<hex>` + `shift+` for cased capitals fixes the level-0 lowercase remap (Ü→ü). Residual: under heavy host load XTEST can still drop a remapped char — an X11 delivery characteristic, not a mapping defect. |

# Parity matrix — darwin-aqua

- commit: `f1cceb105177d8eb67bc191878de7885e10cd06f`; date: 2026-09-15T15:53:38.719Z
- rendered from the committed summary `parity/results/darwin-aqua-2026-09-15.json` (run recorded on another host)

| task | issue | Codewhale | status | median elapsed | median tool calls | pointer displacement | notes |
|---|---|---|---|---|---|---|---|
| browser.download | #2 | 5/5 | demonstrated | 2243ms | 2 | 0px | - |
| browser.drag_drop | #2 | 5/5 | demonstrated | 4197ms | 2 | 0px | - |
| browser.dynamic_content | #2 | 5/5 | demonstrated | 3533ms | 4 | 0px | - |
| browser.element_click | #2 | 5/5 | demonstrated | 2140ms | 2 | 0px | optional_a11y |
| browser.form_submit | #2 | 5/5 | demonstrated | 4996ms | 8 | 0px | - |
| browser.iframe_click | #2 | 5/5 | demonstrated | 2291ms | 2 | 0px | - |
| browser.modifiers | #3 | 5/5 | demonstrated | 2545ms | 4 | 0px | - |
| browser.outside_raster_fails | #4 | 5/5 | demonstrated | 2120ms | 3 | 0px | - |
| browser.scroll_reveal | #2 | 5/5 | demonstrated | 4044ms | 3 | 0px | - |
| browser.stale_element | #2 | 5/5 | demonstrated | 3188ms | 3 | 0px | optional_a11y |
| browser.tabs | #2 | 5/5 | demonstrated | 2717ms | 4 | 0px | - |
| browser.unicode_type | #3 | 5/5 | demonstrated | 2861ms | 3 | 0px | - |
| browser.upload | #2 | 5/5 | demonstrated | 17262ms | 11 | 0px | - |
| browser.zoom_click | #4 | 5/5 | demonstrated | 2310ms | 3 | 0px | - |
| control.cancellation | #6 | 5/5 | demonstrated | 4156ms | 2 | 0px | - |
| control.permission_denied | #6 | 5/5 | demonstrated | 367ms | 2 | 0px | - |
| control.reconnect_no_replay | #6 | 5/5 | demonstrated | 2329ms | 4 | 0px | - |
| control.stop_blocks_actions | #6 | 5/5 | demonstrated | 2098ms | 3 | 0px | - |
| native.drag_square | #3 | 5/5 | demonstrated | 3919ms | 2 | 0px | - |
| native.entry_apply | #3 | 5/5 | demonstrated | 2591ms | 4 | 0px | - |
| native.list_scroll_select | #3 | 5/5 | demonstrated | 2184ms | 3 | 0px | - |
| native.menu_command | #3 | 5/5 | demonstrated | 2811ms | 4 | 0px | - |
| native.modal_dialog | #3 | 5/5 | demonstrated | 5464ms | 7 | 0px | - |
| native.modifiers | #3 | 5/5 | demonstrated | 2285ms | 3 | 0px | - |
| native.second_window | #3 | 5/5 | demonstrated | 3199ms | 4 | 0px | - |
| native.select_text | #3 | 5/5 | demonstrated | 3306ms | 2 | 0px | - |
| native.unicode_type | #3 | 5/5 | demonstrated | 2550ms | 4 | 0px | - |

## Platforms

| surface | status |
|---|---|
| macOS Retina | untested — see docs/LIMITATIONS.md |
| macOS non-Retina | untested — see docs/LIMITATIONS.md |
| macOS mixed | untested — see docs/LIMITATIONS.md |
| Linux X11 | 24/27 tasks demonstrated at 5 repeats (linux-xvfb (isolated), 2026-09-16) |
| Wayland | untested — see docs/LIMITATIONS.md |
| Windows | untested — see docs/LIMITATIONS.md |
| HarmonyOS (hdc) | untested — see docs/LIMITATIONS.md |
| SSH remote | untested — see docs/LIMITATIONS.md |
| Codex / Claude Desktop fresh session | untested — see docs/LIMITATIONS.md |
| signed-update permission persistence | untested — see docs/LIMITATIONS.md |
