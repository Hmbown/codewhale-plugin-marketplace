---
description: Codewhale for Chrome (developer preview) — bridge status, the pairing token, or first-time Chrome extension setup
usage: /chromewhale [status|token|setup|setup --remove]
---

$ARGUMENTS

Locate this plugin's staged root with `/plugin show chromewhale`; never assume
the process cwd is it. Run every command below from that root. They read the
same pairing record the plugin's server writes, so they honour
`CHROMEWHALE_STATE_DIR`, `CODEWHALE_HOME`, and a non-default bridge port.

- **No arguments, or `status`**: report whether the bridge is up and whether a
  panel is attached. Ask the running server rather than guessing:

  ```sh
  node bin/chromewhale.mjs status
  ```

  Relay its lines as printed. "Side panel: attached" means the `page_*` tools
  will reach a tab; "not attached" means the plugin is running but no panel is
  open, and the tools will refuse and say so. "Nothing is answering" means the
  MCP server is not running: check that the plugin is enabled. The command
  only ever queries a loopback address.

- **`token`**: print the pairing token. Only needed when the connector is not
  installed and the user pairs by hand in the side panel's Settings:

  ```sh
  node bin/chromewhale.mjs token
  ```

  Print the token itself — the user cannot pair without seeing it — but do not
  paste it into a file, a commit, or anywhere it would outlive this
  conversation.

- **`setup`**: first-time setup. Say up front, in these words or close to
  them: Codewhale for Chrome is a **developer preview** — it is **loaded unpacked**, not
  from the Chrome Web Store, and it **uses your own Chrome profile**, with your
  logged-in sessions. Then run:

  ```sh
  node bin/chromewhale.mjs setup
  ```

  It copies the extension to a stable path (`~/.codewhale/chromewhale/extension`
  unless `CHROMEWHALE_STATE_DIR` or `CODEWHALE_HOME` say otherwise) and installs
  the connector — a per-user Native Messaging host that pairs the side panel
  with this session automatically, so there is nothing to paste. It prints the
  path, which browsers got the connector, and numbered steps. Give the user the
  path and the steps exactly as printed; never point them at the plugin's
  staged root. After a plugin update, run `setup` again and have them click
  **Reload** on the Codewhale for Chrome card in `chrome://extensions`.

  If setup says no browser profile was found, the connector was not
  registered; the fallback is the panel's Settings → **Codewhale for Chrome
  bridge**, with the printed port and the token from `token` above. Confirm
  pairing with `status`.

- **`setup --remove`**: unregister the connector from every browser:

  ```sh
  node bin/chromewhale.mjs setup --remove
  ```

Explain the permission model once, plainly, when setting up: Codewhale for Chrome can
touch only sites the user allows in the panel; the default answer is **Allow
for this session**, which Chrome forgets when it exits, and **Always allow** is
a separate click. Allowing a site grants Chrome's own host permission for that
origin. Submitting a form always asks for a confirming click, even on an
allowed site. The panel's Pause button stops every browser tool at once. It
never types into password, one-time-code, or payment-card fields.
