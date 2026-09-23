<img src="extension/media/icon.png" alt="Codewhale" width="72" />

# Codewhale for Chrome

> **Developer preview.** You load the extension unpacked (it is not on the
> Chrome Web Store), and it works inside **your own Chrome profile**, with your
> logged-in sessions. Expect rough edges.

*Formerly Chromewhale.* The plugin id, the `/chromewhale` commands and the
`CHROMEWHALE_*` settings keep that name, so existing installs keep working.

Codewhale in your own Chrome. A side panel that chats with your local Codewhale
runtime, and five tools that let the model read and act on the tab you are
looking at — one granted site at a time, only while the panel is open.

Your browser, your logged-in sessions, your tabs. Nothing is relayed anywhere:
the plugin, the runtime, and the bridge are all on loopback.

## Codewhale for Chrome or computer-use?

Both can drive a browser. They are for different jobs, and the difference is
whose browser it is.

| | **Codewhale for Chrome** (`page_*`) | **computer-use** (`browser_*`) |
| --- | --- | --- |
| Whose browser | Yours, already open, already logged in | One it launches, in a profile of its own |
| Your cookies and sessions | Used — that is the point | Never touched |
| How you address things | `[eN]` refs from a page snapshot | CSS selectors |
| Where you talk to it | A side panel next to the page | Wherever you run Codewhale |
| Good for | "What does this page say?", filling a form you are on, following a link | Scripted flows, scraping, anything that should not see your identity |

Reach for `computer-use` when the browser is a tool. Reach for Codewhale for Chrome when
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

That copies the extension to a stable path — `~/.codewhale/chromewhale/extension`
unless `CHROMEWHALE_STATE_DIR` or `CODEWHALE_HOME` say otherwise — and prints it
with the steps:

1. Open `chrome://extensions`, turn on **Developer mode**, choose **Load
   unpacked**, and select the path setup printed. Do not load `extension/`
   from the plugin's staged root: that directory moves on every plugin update,
   and an unpacked extension's ID follows its path.
2. Click the Codewhale for Chrome toolbar button to open the side panel.
3. In **Settings → Codewhale for Chrome bridge**, set the port setup printed (8899 by
   default) and paste the token from `/chromewhale token` — that is what
   carries tool calls. The **runtime** fields are for the panel's own chat
   (`codewhale app-server --http`) and are optional for tool use.

The panel's second status line reads "Attached" when the bridge is paired, and
warns if the extension and the plugin versions differ. After updating the
plugin, run `/chromewhale setup` again and click **Reload** on the Codewhale for Chrome
card in `chrome://extensions`. `/chromewhale status` asks the running bridge
directly.

## Use it

Ask about the tab you are on, or tell Codewhale what to do in it — from the
side panel, or from any Codewhale session once the panel is open:

- "What is this page actually claiming? Quote the parts that support it."
- "Fill the title and body of this issue form from my notes, but don't submit."
- "Open the docs for this error and tell me which section applies."

The first time a turn touches a site, the panel asks. The default answer is
**Allow for this session**, which Chrome forgets when it exits; **Always allow**
is a separate click. Either grants Chrome's own host permission for that
origin; the site then appears under **Settings → Sites**, where **Forget**
revokes both. Submitting a form — `page_type` with submit, or a click on a
submit button — asks for a confirming click every time, even on an allowed
site. **Pause** stops every browser tool at once without disconnecting the
chat.

## What it will not do

- Type into a password, one-time-code, or payment-card field. It refuses and
  says so; fill those yourself.
- Touch `chrome://` pages, extension pages, local files, or the Chrome Web
  Store.
- Act on a site you have not allowed, or on any site while paused or while the
  panel is closed.
- Enumerate or switch your tabs. It works on the active tab of the window the
  panel is open in, and nothing else.
- See inside iframes (same-origin ones included, for now), or dispatch clicks
  that pass an `event.isTrusted` check.
- Take a screenshot of a tab you have not clicked its toolbar button on.
  Chrome only lets an extension capture a tab under `activeTab`, which that
  click grants; `page_snapshot` covers reading text without it.
- Act late. A call that the model has been told failed — timed out, cancelled
  by the host, or paused by you — closes its prompt, and nothing runs even if
  you click Allow afterwards.

Everything read off a page — text, title, URL, element labels — reaches the
model wrapped in an explicit untrusted-content envelope whose markers carry a
fresh random tag per block, so a page cannot close the envelope early by
printing an end marker of its own. Any page can try to talk to your agent. That reduces prompt injection;
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
listen on a socket. The bridge is loopback-only (a non-loopback
`CHROMEWHALE_BRIDGE_HOST` is refused at startup). It refuses any request
carrying a web `Origin` or a `Host` that is not its own loopback address and
port before looking at credentials, which blocks cross-site requests and DNS
rebinding.

**Neither side ever sends the pairing token.** Each request is signed with an
HMAC over a single-use nonce from the bridge (`GET /challenge`), and the
bridge answers with an HMAC proof of its own. The panel runs nothing until the
stream's first frame carries that proof, and sibling servers discard any
reply without one. So a program that grabs the bridge port while no Codewhale
session holds it learns nothing it can reuse, cannot drive your tabs, and
cannot feed the model fake page content. (The bridge still *accepts* a plain
bearer token so an older panel keeps working until it is reloaded.)

Every Codewhale session that enables the plugin starts its own server, but the
panel dials one port. The first server to bind it owns the panel; later ones
confirm the owner is a Codewhale for Chrome bridge with the same token and forward their
calls to it. When the owning session exits, the next call from another session
takes the port over and the panel reattaches within a few seconds. A call the
old owner had already received is never re-run by the new one; the model is
told the outcome is unknown instead.

Calls run one at a time, and each carries a deadline. Opening the panel in a
second window takes the bridge from the first, which then stays detached until
you press **Save and reconnect** in its Settings rather than taking it back.

The panel's own per-origin gate sits underneath all of that. It is not
redundant with Codewhale's approval prompt: it is the only part that knows
which page is in front of you.

## Develop

```sh
npm test    # node --test: policy, tool routing, page guards, SSE framing,
            # the bridge over real loopback HTTP, and the MCP server end to end
```

From the repository root, `npm run check:web` also runs
`tests/browser/chromewhale.spec.mjs`: the real MCP server, bridge and unpacked
extension in Playwright's Chromium against a live page — the signed pairing
handshake, grants, typing into plain, framework-controlled and rich fields,
secret refusal and redaction, submit confirmation, host cancellation, stale
refs, and a port squatter that must get nothing.

No dependencies and no build step: Chrome loads the extension's ES modules
directly and the suites run the same files. Reload the extension from
`chrome://extensions` after editing it; restart Codewhale after editing the
server.
