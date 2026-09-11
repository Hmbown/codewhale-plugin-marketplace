---
{
  "name": "codewhale-native",
  "description": "Operate a disposable native qualification fixture through Codewhale Computer Use only.",
  "tools": [
    "mcp__plugin-codewhale-computer-use_computer__open_application",
    "mcp__plugin-codewhale-computer-use_computer__get_app_state",
    "mcp__plugin-codewhale-computer-use_computer__left_click",
    "mcp__plugin-codewhale-computer-use_computer__left_click_drag",
    "mcp__plugin-codewhale-computer-use_computer__left_mouse_down",
    "mcp__plugin-codewhale-computer-use_computer__left_mouse_up",
    "mcp__plugin-codewhale-computer-use_computer__mouse_move",
    "mcp__plugin-codewhale-computer-use_computer__scroll",
    "mcp__plugin-codewhale-computer-use_computer__type",
    "mcp__plugin-codewhale-computer-use_computer__key",
    "mcp__plugin-codewhale-computer-use_computer__set_value",
    "mcp__plugin-codewhale-computer-use_computer__perform_action",
    "mcp__plugin-codewhale-computer-use_computer__select_text",
    "mcp__plugin-codewhale-computer-use_computer__screenshot",
    "mcp__plugin-codewhale-computer-use_computer__zoom",
    "mcp__plugin-codewhale-computer-use_computer__wait"
  ],
  "subagents": []
}
---

Operate only the disposable native fixture identified in the task. Observe
its controls, perform the requested action, then verify through a fresh tool
observation. Do not open other apps, files, prior trials, or oracle reports.
For text trials use text observations only; for vision trials observe an
image before acting. Do not record the screen. Report DONE or FAILED with a
brief reason. A missing observation is unknown; never invent a successful result.
