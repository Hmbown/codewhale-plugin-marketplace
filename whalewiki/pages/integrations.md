# Connections and inbound requests

A connection lets a running agent use a service. A bot lets an outside message
request work. Installation and authentication are separate operations.

## Outbound service access

`npm run connections -- list` shows the service recipes. `show <name>` prints
documented setup commands or a configuration fragment. `doctor <name>` reports
local prerequisites without contacting the service, changing configuration or
claiming authentication. It never prints token values.

OAuth belongs to the host connection owner. Plugin-contributed MCP servers
cannot use the current interactive OAuth login path. The catalog therefore
keeps service setup outside installable URL wrappers. Slack and Vercel require
further Codewhale client qualification, so their recipes offer no install
command. A documented endpoint is not a verified login.

BaizhiCloud Agent Toolkit is a documented bearer connection. The generated
server entry keeps the token in the host environment through the native
`bearer_token_env_var` field. It offers search/read setup guidance but does not
claim every remote tool is read-only or that a live service account was tested.
Codewhale v0.9.13 uses `mcp add <name> --url <url>` and `codewhale doctor`;
`codewhale mcp list` is not guaranteed to be a network-free check.

## Existing chat adapters

Telegram, WeChat/Weixin, WeCom, Feishu and `bridge-core` are copied from the exact
Core snapshot in `integrations/upstream.json`. Each copied file has a SHA-256
pin. Update the canonical Core implementation first and refresh its complete
changed source/test set here. Their presence does not qualify a live account.

`npm run integrations -- list` locates each guide. `start <name>` requires a
private absolute env-file path and launches the chosen adapter from its package
directory. Feishu and WeCom have declared dependencies to install first. No plugin
activation automatically starts a bot or listener.

Telegram and Feishu persist the admitted sender's identity for recovery. Before
reattaching after restart they check that identity against the current allowlist
and group policy. Legacy state without identity stays detached. Feishu updates
its reply destination only after admitting the incoming sender.

## Signed webhook intake

The marketplace-owned webhook bridge reuses `bridge-core`'s runtime client.
Slack requests require a v0 HMAC, a timestamp within five minutes, and configured
team, channel and user admission. Bot messages and message edits are ignored.
Linear requires its raw-body HMAC, a timestamp within one minute, organization
and team admission, and the configured trigger label on issue create/update.

Bodies are capped at 256 KiB. Slack's signed event identity and Linear's signed
body determine duplicate keys. Complete receipts are atomically published in a
private inbox and synced before acknowledgement. HTTP 202 means queued, not
completed. Corrupt receipts and persistence failures cannot masquerade as success.

## Dispatch and recovery

Dispatch is an explicit operator command with an absolute workspace, exact model
and local runtime token. It creates one plan-mode thread and turn per pending
event through `/v1/threads` and `/v1/threads/<id>/turns`, with shell execution,
automatic approvals and trust mode disabled. The runtime owns the actual work.

The dispatcher persists `creating_thread` and `starting_turn` before those
requests. A lost response leaves an uncertain stage or `needs_review`; it is
never blindly retried. A single dispatcher lock also prevents competing workers.
Inspect the receipts and runtime before recovering a stale lock or uncertain
delivery. There is no exactly-once network-delivery claim.

This adapter supplies intake and explicit dispatch. Slack replies, continuing
conversations, approval presentation, result delivery and a supervised worker
remain unfinished. No live Slack/Linear service or model call is claimed here.

## Source basis

- `connections/catalog.json` and `scripts/connections.mjs`: service setup and qualification.
- `docs/CONNECTIONS.md`: host authentication boundary and service documentation.
- `integrations/upstream.json` and `integrations/README.md`: source ownership and setup.
- `scripts/integrations.mjs`: package routing and explicit startup.
- `integrations/webhook-bridge/src/lib.mjs`: `parseEvent`, `Inbox`, `dispatch`.
- `integrations/webhook-bridge/src/index.mjs`: bounded HTTP listener and commands.
- `integrations/webhook-bridge/README.md`: durability, recovery and product limits.
