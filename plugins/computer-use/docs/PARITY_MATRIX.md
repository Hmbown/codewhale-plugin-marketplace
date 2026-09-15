# Parity matrix — darwin-aqua

- commit: `f1cceb105177d8eb67bc191878de7885e10cd06f`
- node v25.8.0; darwin 25.1.0 (macOS 26.1); display `aqua:main` geometry 2880 1620 @2x (5760x3240 px)
- suite: `parity/tasks.darwin.json`; chrome: Google Chrome 153.0.8010.36; python3: Python 3.14.7; native fixture: AppKit (parity/fixtures/native-macos.m)
- date: 2026-09-15T15:53:38.719Z; repeats: 5
- Codex baseline: untested (no codex results)

| task | issue | Codewhale | Codex | status | median elapsed | median tool calls | pointer displacement | foreground | notes |
|---|---|---|---|---|---|---|---|---|---|
| browser.download | #2 | 5/5 | untested | demonstrated | 2243ms | 2 | 0px | preserved | - |
| browser.drag_drop | #2 | 5/5 | untested | demonstrated | 4197ms | 2 | 0px | preserved | - |
| browser.dynamic_content | #2 | 5/5 | untested | demonstrated | 3533ms | 4 | 0px | preserved | - |
| browser.element_click | #2 | 5/5 | untested | demonstrated | 2140ms | 2 | 0px | preserved | optional_a11y |
| browser.form_submit | #2 | 5/5 | untested | demonstrated | 4996ms | 8 | 0px | taken 5/5 | - |
| browser.iframe_click | #2 | 5/5 | untested | demonstrated | 2291ms | 2 | 0px | preserved | - |
| browser.modifiers | #3 | 5/5 | untested | demonstrated | 2545ms | 4 | 0px | preserved | - |
| browser.outside_raster_fails | #4 | 5/5 | untested | demonstrated | 2120ms | 3 | 0px | preserved | - |
| browser.scroll_reveal | #2 | 5/5 | untested | demonstrated | 4044ms | 3 | 0px | preserved | - |
| browser.stale_element | #2 | 5/5 | untested | demonstrated | 3188ms | 3 | 0px | preserved | optional_a11y |
| browser.tabs | #2 | 5/5 | untested | demonstrated | 2717ms | 4 | 0px | preserved | - |
| browser.unicode_type | #3 | 5/5 | untested | demonstrated | 2861ms | 3 | 0px | preserved | - |
| browser.upload | #2 | 5/5 | untested | demonstrated | 17262ms | 11 | 0px | taken 5/5 | - |
| browser.zoom_click | #4 | 5/5 | untested | demonstrated | 2310ms | 3 | 0px | preserved | - |
| control.cancellation | #6 | 5/5 | untested | demonstrated | 4156ms | 2 | 0px | preserved | - |
| control.permission_denied | #6 | 5/5 | untested | demonstrated | 367ms | 2 | 0px | preserved | - |
| control.reconnect_no_replay | #6 | 5/5 | untested | demonstrated | 2329ms | 4 | 0px | preserved | - |
| control.stop_blocks_actions | #6 | 5/5 | untested | demonstrated | 2098ms | 3 | 0px | preserved | - |
| native.drag_square | #3 | 5/5 | untested | demonstrated | 3919ms | 2 | 0px | preserved | - |
| native.entry_apply | #3 | 5/5 | untested | demonstrated | 2591ms | 4 | 0px | preserved | - |
| native.list_scroll_select | #3 | 5/5 | untested | demonstrated | 2184ms | 3 | 0px | preserved | - |
| native.menu_command | #3 | 5/5 | untested | demonstrated | 2811ms | 4 | 0px | preserved | - |
| native.modal_dialog | #3 | 5/5 | untested | demonstrated | 5464ms | 7 | 0px | preserved | - |
| native.modifiers | #3 | 5/5 | untested | demonstrated | 2285ms | 3 | 0px | preserved | - |
| native.second_window | #3 | 5/5 | untested | demonstrated | 3199ms | 4 | 0px | preserved | - |
| native.select_text | #3 | 5/5 | untested | demonstrated | 3306ms | 2 | 0px | preserved | - |
| native.unicode_type | #3 | 5/5 | untested | demonstrated | 2550ms | 4 | 0px | preserved | - |

## Platforms

| surface | status |
|---|---|
| macOS Retina | 27/27 tasks demonstrated at 5 repeats (darwin-aqua, 2026-09-15) |
| macOS non-Retina | untested — see docs/LIMITATIONS.md |
| macOS mixed | untested — see docs/LIMITATIONS.md |
| Linux X11 | untested — see docs/LIMITATIONS.md |
| Wayland | untested — see docs/LIMITATIONS.md |
| Windows | untested — see docs/LIMITATIONS.md |
| HarmonyOS (hdc) | untested — see docs/LIMITATIONS.md |
| SSH remote | untested — see docs/LIMITATIONS.md |
| Codex / Claude Desktop fresh session | untested — see docs/LIMITATIONS.md |
| signed-update permission persistence | untested — see docs/LIMITATIONS.md |
