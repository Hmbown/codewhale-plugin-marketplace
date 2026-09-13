# Parity matrix — darwin-aqua

- commit: `bf27c8e02551c247e070010241cbfd70fc91266c` (dirty)
- node v22.20.0; darwin 25.1.0 (macOS 26.1); display `aqua:main` geometry 2880 1620 @2x (5760x3240 px)
- suite: `parity/tasks.darwin.json`; chrome: Google Chrome 152.0.7977.76; python3: Python 3.12.8; native fixture: AppKit (parity/fixtures/native-macos.m)
- date: 2026-09-07T21:28:06.285Z; repeats: 5
- Codex baseline: untested (no codex results)

| task | issue | Codewhale | Codex | status | median elapsed | median tool calls | pointer displacement | foreground | notes |
|---|---|---|---|---|---|---|---|---|---|
| browser.download | #2 | 5/5 | untested | demonstrated | 3592ms | 2 | 0px | preserved | - |
| browser.drag_drop | #2 | 5/5 | untested | demonstrated | 4130ms | 2 | 0px | preserved | - |
| browser.dynamic_content | #2 | 4/5 | untested | partial | 4118ms | 4 | 12.5px | taken 1/5 | fail: step4 expect {"path":"dyn","not_equals":"confirmed"} never held; last={"name":"","agree":false,"color":"","submitted":nu |
| browser.element_click | #2 | 5/5 | untested | demonstrated | 3004ms | 2 | 0px | preserved | optional_a11y |
| browser.form_submit | #2 | 5/5 | untested | demonstrated | 4428ms | 8 | 0px | preserved | - |
| browser.iframe_click | #2 | 5/5 | untested | demonstrated | 3281ms | 2 | 0px | preserved | - |
| browser.modifiers | #3 | 5/5 | untested | demonstrated | 3746ms | 4 | 0px | preserved | - |
| browser.outside_raster_fails | #4 | 5/5 | untested | demonstrated | 3340ms | 3 | 0px | preserved | - |
| browser.scroll_reveal | #2 | 5/5 | untested | demonstrated | 5043ms | 3 | 0px | taken 1/5 | - |
| browser.stale_element | #2 | 5/5 | untested | demonstrated | 3585ms | 3 | 0px | preserved | optional_a11y |
| browser.tabs | #2 | 5/5 | untested | demonstrated | 3419ms | 4 | 0px | preserved | - |
| browser.unicode_type | #3 | 5/5 | untested | demonstrated | 3662ms | 3 | 0px | preserved | - |
| browser.upload | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.zoom_click | #4 | 5/5 | untested | demonstrated | 3415ms | 3 | 0px | preserved | - |
| control.cancellation | #6 | 5/5 | untested | demonstrated | 5087ms | 2 | 65.6px | preserved | - |
| control.permission_denied | #6 | 5/5 | untested | demonstrated | 1274ms | 2 | 0px | preserved | - |
| control.reconnect_no_replay | #6 | 5/5 | untested | demonstrated | 3732ms | 4 | 4.5px | taken 2/5 | - |
| control.stop_blocks_actions | #6 | 5/5 | untested | demonstrated | 3283ms | 3 | 47.7px | taken 1/5 | - |
| native.drag_square | #3 | 5/5 | untested | demonstrated | 4770ms | 2 | 0px | preserved | - |
| native.entry_apply | #3 | 5/5 | untested | demonstrated | 4295ms | 4 | 0px | preserved | - |
| native.list_scroll_select | #3 | 5/5 | untested | demonstrated | 4571ms | 3 | 0px | preserved | - |
| native.menu_command | #3 | 5/5 | untested | demonstrated | 4181ms | 4 | 0px | preserved | - |
| native.modal_dialog | #3 | 5/5 | untested | demonstrated | 6325ms | 7 | 0px | preserved | - |
| native.modifiers | #3 | 5/5 | untested | demonstrated | 4295ms | 3 | 0px | taken 1/5 | - |
| native.second_window | #3 | 5/5 | untested | demonstrated | 5391ms | 4 | 0px | preserved | - |
| native.select_text | #3 | 5/5 | untested | demonstrated | 4135ms | 2 | 0px | preserved | - |
| native.unicode_type | #3 | 5/5 | untested | demonstrated | 4402ms | 4 | 0px | preserved | - |

# Parity matrix — darwin-aqua

- commit: `bf27c8e02551c247e070010241cbfd70fc91266c` (dirty)
- node v22.20.0; darwin 25.1.0 (macOS 26.1); display `aqua:main` geometry 2880 1620 @2x (5760x3240 px)
- suite: `parity/tasks.darwin.json`; chrome: Google Chrome 152.0.7977.76; python3: Python 3.12.8; native fixture: AppKit (parity/fixtures/native-macos.m)
- date: 2026-09-07T21:35:57.137Z; repeats: 5
- Codex baseline: untested (no codex results)

| task | issue | Codewhale | Codex | status | median elapsed | median tool calls | pointer displacement | foreground | notes |
|---|---|---|---|---|---|---|---|---|---|
| browser.download | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.drag_drop | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.dynamic_content | #2 | 5/5 | untested | demonstrated | 4614ms | 4 | 0px | preserved | - |
| browser.element_click | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run · optional_a11y |
| browser.form_submit | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.iframe_click | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.modifiers | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.outside_raster_fails | #4 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.scroll_reveal | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.stale_element | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run · optional_a11y |
| browser.tabs | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.unicode_type | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.upload | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.zoom_click | #4 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| control.cancellation | #6 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| control.permission_denied | #6 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| control.reconnect_no_replay | #6 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| control.stop_blocks_actions | #6 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.drag_square | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.entry_apply | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.list_scroll_select | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.menu_command | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.modal_dialog | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.modifiers | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.second_window | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.select_text | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.unicode_type | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |

# Parity matrix — darwin-aqua

- commit: `9d91cdf7de3b1e1e8ddb7b626026fa72bf0a42fb` (dirty)
- node v22.20.0; darwin 25.1.0 (macOS 26.1); display `aqua:main` geometry 2880 1620 @2x (5760x3240 px)
- suite: `parity/tasks.darwin.json`; chrome: Google Chrome 152.0.7977.76; python3: Python 3.12.8; native fixture: AppKit (parity/fixtures/native-macos.m)
- date: 2026-09-07T21:37:37.432Z; repeats: 5
- Codex baseline: untested (no codex results)

| task | issue | Codewhale | Codex | status | median elapsed | median tool calls | pointer displacement | foreground | notes |
|---|---|---|---|---|---|---|---|---|---|
| browser.download | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.drag_drop | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.dynamic_content | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.element_click | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run · optional_a11y |
| browser.form_submit | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.iframe_click | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.modifiers | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.outside_raster_fails | #4 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.scroll_reveal | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.stale_element | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run · optional_a11y |
| browser.tabs | #2 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.unicode_type | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| browser.upload | #2 | 5/5 | untested | demonstrated | 10797ms | 11 | 0px | preserved | - |
| browser.zoom_click | #4 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| control.cancellation | #6 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| control.permission_denied | #6 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| control.reconnect_no_replay | #6 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| control.stop_blocks_actions | #6 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.drag_square | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.entry_apply | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.list_scroll_select | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.menu_command | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.modal_dialog | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.modifiers | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.second_window | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.select_text | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |
| native.unicode_type | #3 | 0/0 | untested | untested | -ms | - | -px | - | not executed in this run |

# Parity matrix — linux-x11

- commit: `9e6fd39550a68b6506dddbacc701c27f0e47f6f0`; date: 2026-09-06T23:58:28.366Z
- rendered from the committed summary `parity/results/linux-x11-2026-09-06.json` (run recorded on another host)

| task | issue | Codewhale | status | median elapsed | median tool calls | pointer displacement | notes |
|---|---|---|---|---|---|---|---|
| browser.download | #2 | 5/5 | demonstrated | 1567ms | 2 | 0px | - |
| browser.drag_drop | #2 | 5/5 | demonstrated | 1703ms | 2 | 0px | - |
| browser.dynamic_content | #2 | 5/5 | demonstrated | 2553ms | 4 | 0px | - |
| browser.element_click | #2 | 5/5 | demonstrated | 1591ms | 2 | 0px | optional_a11y |
| browser.form_submit | #2 | 5/5 | demonstrated | 2796ms | 9 | 0px | - |
| browser.iframe_click | #2 | 5/5 | demonstrated | 1553ms | 2 | 0px | - |
| browser.modifiers | #3 | 5/5 | demonstrated | 1825ms | 4 | 0px | - |
| browser.outside_raster_fails | #4 | 5/5 | demonstrated | 1348ms | 3 | 0px | - |
| browser.scroll_reveal | #2 | 5/5 | demonstrated | 3356ms | 3 | 0px | - |
| browser.stale_element | #2 | 5/5 | demonstrated | 2445ms | 3 | 0px | optional_a11y |
| browser.tabs | #2 | 5/5 | demonstrated | 2150ms | 4 | 0px | - |
| browser.unicode_type | #3 | 5/5 | demonstrated | 2597ms | 3 | 0px | - |
| browser.upload | #2 | 5/5 | demonstrated | 10763ms | 5 | 0px | - |
| browser.zoom_click | #4 | 5/5 | demonstrated | 1605ms | 3 | 0px | - |
| control.cancellation | #6 | 5/5 | demonstrated | 3848ms | 2 | 0px | - |
| control.permission_denied | #6 | 5/5 | demonstrated | 37ms | 2 | 0px | - |
| control.reconnect_no_replay | #6 | 5/5 | demonstrated | 1396ms | 4 | 0px | - |
| control.stop_blocks_actions | #6 | 5/5 | demonstrated | 1214ms | 3 | 0px | - |
| native.drag_square | #3 | 5/5 | demonstrated | 1387ms | 2 | 0px | - |
| native.entry_apply | #3 | 5/5 | demonstrated | 1771ms | 4 | 0px | - |
| native.list_scroll_select | #3 | 5/5 | demonstrated | 1869ms | 3 | 0px | - |
| native.menu_command | #3 | 5/5 | demonstrated | 1865ms | 4 | 0px | - |
| native.modal_dialog | #3 | 0/5 | missing | 5782ms | 7 | 0px | fail: step10 expect {"path":"dialog","equals":"closed"} never held; last={"entry":"blocked","applied":"","menu":[],"selected": · known limitation: KWin does not give the transient Tk dialog X input focus, so typed text does not reach it; passes on the isolated Xvfb route |
| native.modifiers | #3 | 5/5 | demonstrated | 1407ms | 3 | 0px | - |
| native.second_window | #3 | 5/5 | demonstrated | 2075ms | 4 | 0px | - |
| native.select_text | #3 | 5/5 | demonstrated | 1422ms | 2 | 0px | - |
| native.unicode_type | #3 | 5/5 | demonstrated | 1939ms | 4 | 0px | - |

# Parity matrix — linux-xvfb (isolated)

- commit: `9e6fd39550a68b6506dddbacc701c27f0e47f6f0`; date: 2026-09-07T00:05:16.985Z
- rendered from the committed summary `parity/results/linux-xvfb-isolated-2026-09-07.json` (run recorded on another host)

| task | issue | Codewhale | status | median elapsed | median tool calls | pointer displacement | notes |
|---|---|---|---|---|---|---|---|
| browser.download | #2 | 5/5 | demonstrated | 1462ms | 2 | 0px | - |
| browser.drag_drop | #2 | 5/5 | demonstrated | 1591ms | 2 | 0px | - |
| browser.dynamic_content | #2 | 5/5 | demonstrated | 2495ms | 4 | 0px | - |
| browser.element_click | #2 | 5/5 | demonstrated | 1603ms | 2 | 0px | optional_a11y |
| browser.form_submit | #2 | 5/5 | demonstrated | 2741ms | 9 | 0px | - |
| browser.iframe_click | #2 | 5/5 | demonstrated | 1557ms | 2 | 0px | - |
| browser.modifiers | #3 | 5/5 | demonstrated | 1723ms | 4 | 0px | - |
| browser.outside_raster_fails | #4 | 5/5 | demonstrated | 1210ms | 3 | 0px | - |
| browser.scroll_reveal | #2 | 5/5 | demonstrated | 3280ms | 3 | 0px | - |
| browser.stale_element | #2 | 5/5 | demonstrated | 2438ms | 3 | 0px | optional_a11y |
| browser.tabs | #2 | 5/5 | demonstrated | 2089ms | 4 | 0px | - |
| browser.unicode_type | #3 | 5/5 | demonstrated | 2488ms | 3 | 0px | - |
| browser.upload | #2 | 5/5 | demonstrated | 10775ms | 5 | 0px | - |
| browser.zoom_click | #4 | 5/5 | demonstrated | 1530ms | 3 | 0px | - |
| control.cancellation | #6 | 5/5 | demonstrated | 3848ms | 2 | 0px | - |
| control.permission_denied | #6 | 5/5 | demonstrated | 39ms | 2 | 0px | - |
| control.reconnect_no_replay | #6 | 5/5 | demonstrated | 1395ms | 4 | 0px | - |
| control.stop_blocks_actions | #6 | 5/5 | demonstrated | 1247ms | 3 | 0px | - |
| native.drag_square | #3 | 5/5 | demonstrated | 1345ms | 2 | 0px | - |
| native.entry_apply | #3 | 5/5 | demonstrated | 1691ms | 4 | 0px | - |
| native.list_scroll_select | #3 | 5/5 | demonstrated | 1817ms | 3 | 0px | - |
| native.menu_command | #3 | 5/5 | demonstrated | 1778ms | 4 | 0px | - |
| native.modal_dialog | #3 | 5/5 | demonstrated | 2715ms | 7 | 0px | - |
| native.modifiers | #3 | 5/5 | demonstrated | 1323ms | 3 | 0px | - |
| native.second_window | #3 | 5/5 | demonstrated | 1998ms | 4 | 0px | - |
| native.select_text | #3 | 5/5 | demonstrated | 1354ms | 2 | 0px | - |
| native.unicode_type | #3 | 5/5 | demonstrated | 1876ms | 4 | 0px | - |

## Platforms

| surface | status |
|---|---|
| macOS Retina | 25/27 tasks demonstrated at 5 repeats (darwin-aqua, 2026-09-07); separate run: 1/27 tasks demonstrated at 5 repeats (darwin-aqua, 2026-09-07); separate run: 1/27 tasks demonstrated at 5 repeats (darwin-aqua, 2026-09-07) |
| macOS non-Retina | untested — see docs/LIMITATIONS.md |
| macOS mixed | untested — see docs/LIMITATIONS.md |
| Linux X11 | 26/27 tasks demonstrated (linux-x11, 2026-09-06) |
| Wayland | untested — see docs/LIMITATIONS.md |
| Windows | untested — see docs/LIMITATIONS.md |
| HarmonyOS (hdc) | untested — see docs/LIMITATIONS.md |
| SSH remote | untested — see docs/LIMITATIONS.md |
| Codex / Claude Desktop fresh session | untested — see docs/LIMITATIONS.md |
| signed-update permission persistence | untested — see docs/LIMITATIONS.md |
