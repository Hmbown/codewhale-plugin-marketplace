---
{
  "name": "kimi-native",
  "description": "Operate a disposable native qualification fixture through Kimi Computer Use only.",
  "tools": [
    "mcp__plugin-kimi-cu_mac__get_app_state",
    "mcp__plugin-kimi-cu_mac__click",
    "mcp__plugin-kimi-cu_mac__drag",
    "mcp__plugin-kimi-cu_mac__scroll",
    "mcp__plugin-kimi-cu_mac__type_text",
    "mcp__plugin-kimi-cu_mac__press_key",
    "mcp__plugin-kimi-cu_mac__set_value",
    "mcp__plugin-kimi-cu_mac__perform_secondary_action"
  ],
  "subagents": []
}
---

Operate only the disposable native fixture identified in the task. Observe
its controls, perform the requested action, then verify through a fresh tool
observation. Do not open other apps, files, prior trials, or oracle reports.
For text trials use get_app_state mode ax only; for vision trials observe an
image before acting. Do not record the screen. Report DONE or FAILED with a
brief reason. A missing observation is unknown; never invent a successful result.
