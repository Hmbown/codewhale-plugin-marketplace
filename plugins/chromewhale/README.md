<img src="extension/media/icon.png" alt="Codewhale" width="72" />

# Chromewhale

Codewhale in your own Chrome. A side panel that chats with your local Codewhale
runtime, and five tools that let the model read and act on the tab you are
looking at — one granted site at a time, only while the panel is open.

Your browser, your logged-in sessions, your tabs. Nothing is relayed anywhere:
the plugin, the runtime, and the bridge are all on loopback.

## Chromewhale or computer-use?

Both can drive a browser. They are for different jobs, and the difference is
whose browser it is.

| | **Chromewhale** (`page_*`) | **computer-use** (`browser_*`) |
| --- | --- | --- |
| Whose browser | Yours, already open, already logged in | One it launches, in a profile of its own |
| Your cookies and sessions | Used — that is the point | Never touched |
| How you address things | `[eN]` refs from a page snapshot | CSS selectors |
| Where you talk to it | A side panel next to the page | Wherever you run Codewhale |
| Good for | "What does this page say?", filling a form you are on, following a link | Scripted flows, scraping, anything that should not see your identity |

Reach for `computer-use` when the browser is a tool. Reach for Chromewhale when
the browser is *yours*.

## Install

```text
/plugin marketplace install codewhale chromewhale
```

Then review and enable it — `/plugin install` never activates anything by
itself. Once enabled, finish the browser half:

```text
/chromewhale setup
```

That prints the absolute path to load and the pairing token to paste. The short
version, if you would rather do it by hand:

1. Open `chrome://extensions`, turn on **Developer mode**, choose **Load
   unpacked**, and select the `extension/` directory inside this plugin's
   staged root (`/plugin show chromewhale` prints it). The extension is not on
   the Chrome Web Store.
2. Click the Chromewhale toolbar button to open the side panel.
3. In **Settings**, fill both sections. The **runtime** fields point at
   `codewhale app-server --http` and carry its token — that is what the chat
   talks to. The **bridge** fields take port 8899 and the token from
   `/chromewhale token` — that is what carries tool calls.

The panel's second status line reads "Attached" when the bridge is paired.

## Use it

Ask about the tab you are on, or tell Codewhale what to do in it — from the
side panel, or from any Codewhale session once the panel is open:

- "What is this page actually claiming? Quote the parts that support it."
- "Fill the title and body of this issue form from my notes, but don't submit."
- "Open the docs for this error and tell me which section applies."

The first time a turn touches a site, the panel asks. Allowing grants Chrome's
own host permission for that origin and records the decision; the site then
appears under **Settings → Sites**, where **Forget** revokes both. **Pause**
stops every browser tool at once without disconnecting the chat.

## What it will not do

- Type into a password, one-time-code, or payment-card field. It refuses and
  says so; fill those yourself.
- Touch `chrome://` pages, extension pages, local files, or the Chrome Web
  Store.
- Act on a site you have not allowed, or on any site while paused or while the
  panel is closed.
- Enumerate or switch your tabs. It works on the active tab of the window the
  panel is open in, and nothing else.
- See inside cross-origin iframes, or dispatch clicks that pass an
  `event.isTrusted` check.

Page text reaches the model wrapped in an explicit untrusted-content envelope,
because any page can try to talk to your agent. That reduces prompt injection;
it does not eliminate it. Grant sites the way you would grant a browser
extension — because that is exactly what you are doing.

## How it fits together

```
Codewhale ──MCP(stdio)──> mcp/server.mjs ──SSE + POST──> side panel ──chrome.*──> your tab
```

The tools live in the MCP server, not in the extension, and that placement is
the point of shipping this as a plugin: tools that arrive over MCP go through
Codewhale's normal permission profiles and approval prompts, and the plugin's
trust review covers the authority this bundle declares. An extension that
registered its tools straight with the runtime would bypass both, because
runtime dynamic tools carry `ApprovalRequirement::Auto`.

The extension dials *out* to the bridge because a Chrome extension cannot
listen on a socket. The bridge is loopback-only and requires a bearer token —
which also blocks the cross-origin POST a malicious page would otherwise be
able to make.

The panel's own per-origin gate sits underneath all of that. It is not
redundant with Codewhale's approval prompt: it is the only part that knows
which page is in front of you.

## Develop

```sh
npm test    # node --test: policy, tool routing, page guards, SSE framing,
            # the bridge over real loopback HTTP, and the MCP server end to end
```

No dependencies and no build step: Chrome loads the extension's ES modules
directly and the suites run the same files. Reload the extension from
`chrome://extensions` after editing it; restart Codewhale after editing the
server.
