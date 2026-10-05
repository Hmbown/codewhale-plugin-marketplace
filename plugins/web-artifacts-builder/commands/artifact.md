---
description: Build a self-contained single-file web page locally, check it and preview it
usage: /artifact <what to build> | check <file.html> | preview <path>
---

$ARGUMENTS

Load the `web-artifacts-builder` skill and follow it. The engine is
`scripts/wab.mjs` inside this plugin's directory (`/plugin show
web-artifacts-builder` prints the staged root).

- `check <file.html>`: run `check` and report each error and warning.
- `preview <path>`: start `preview` in the background, give the loopback URL,
  and stop it when the user is done.
- Anything else: treat it as the brief. Choose the single-file tier unless the
  page clearly needs React, scaffold into a new directory, build, check, preview
  and report the absolute path of the finished file.

Never publish, deploy or upload the result unless the user asks for that
separately. State plainly if you could not open the page in a browser.
