---
usage: /loop <prompt> [--max N] [--until <phrase>]
argument-hint: <prompt> [--max N] [--until phrase]
---

<<loop-start>>
$ARGUMENTS
<<loop-end>>

The loop plugin's message hook replaces this whole message before the model sees it. If you can read this text, that hook did not run: do nothing else, and tell the user that the loop plugin is not active (they should run /plugin show loop, trust and enable it, then check /hooks list and that hooks are enabled in config.toml).
