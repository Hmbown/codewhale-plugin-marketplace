---
description: Print the Chromewhale pairing token and bridge status, or set up the Chrome extension
usage: /chromewhale [setup|token|status]
---

$ARGUMENTS

Locate this plugin's staged root with `/plugin show chromewhale`; never assume
the process cwd is it. Everything below is relative to that root.

- **No arguments, or `status`**: report whether the bridge is up and whether a
  panel is attached. Read it from the running server rather than guessing:

  ```sh
  curl -sS -H "Authorization: Bearer $(node -e 'console.log(JSON.parse(require("fs").readFileSync(require("path").join(process.env.CODEWHALE_HOME || require("path").join(require("os").homedir(), ".codewhale"), "chromewhale", "bridge.json"), "utf8")).token)')" \
    http://127.0.0.1:8899/health
  ```

  `{"paired": true}` means a side panel is attached and the `page_*` tools will
  reach a tab. `paired: false` means the plugin is running but no panel is
  open — the tools will refuse and say so. Connection refused means the MCP
  server is not running: check that the plugin is enabled.

- **`token`**: print the pairing token so the user can paste it into the side
  panel's Settings. It lives in `bridge.json` under the Codewhale home
  (`~/.codewhale/chromewhale/bridge.json` unless `CODEWHALE_HOME` or
  `CHROMEWHALE_STATE_DIR` say otherwise). Print the token itself — the user
  cannot pair without seeing it — but do not paste it into a file, a commit,
  or anywhere it would outlive this conversation.

- **`setup`**: walk the user through first-time setup, in this order.
  1. The Chrome extension is not on the Web Store. Tell them to open
     `chrome://extensions`, turn on **Developer mode**, choose **Load
     unpacked**, and select the `extension/` directory inside this plugin's
     staged root. Give them the absolute path.
  2. Have them click the Chromewhale toolbar button to open the side panel.
  3. In the panel's Settings, the **Codewhale runtime** fields point at
     `codewhale app-server --http` (default `127.0.0.1:7878`) and carry that
     server's token — this is what the panel's chat talks to. The
     **Chromewhale bridge** fields take the port (default 8899) and the token
     from `token` above — this is what carries `page_*` tool calls.
  4. Confirm it worked by checking that the panel's bridge line reads
     "Attached", then running `status` above and seeing `paired: true`.

Explain the permission model once, plainly, when setting up: Chromewhale can
touch only sites the user allows in the panel, allowing a site grants Chrome's
own host permission for that origin, and the panel's Pause button stops every
browser tool at once. It never types into password, one-time-code, or
payment-card fields.
