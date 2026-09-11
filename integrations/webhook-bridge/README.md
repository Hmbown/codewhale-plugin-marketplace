# Slack and Linear webhook intake

Receive signed requests, admit only configured users/workspaces, and preserve
them in a private inbox. Dispatch selected pending work through Codewhale's
existing `/v1/threads` and `/v1/threads/<id>/turns` API.

This is a working intake/dispatch adapter with local protocol tests. It is not
a complete Slackbot: it does not post replies, follow live results, maintain a
conversation across deliveries, or run an unattended dispatch worker. Those
features should be built on the same runtime and receipts.

## Start locally

Use Node 22+. Copy `.env.example` outside the repository and fill in either:

- Slack: signing secret **and** allowed team, channel and user IDs. Only
  `app_mention` and direct-message events are admitted. Bot messages and edited
  messages are ignored to avoid loops. Slack `event_id` retries are deduplicated.
- Linear: signing secret **and** organization IDs, team IDs and one trigger-label
  ID. Only issue create/update events carrying that label are admitted. The
  signed payload determines the duplicate key, not the unsigned delivery header.

```sh
node --env-file=/absolute/private/webhooks.env integrations/webhook-bridge/src/index.mjs serve
node --env-file=/absolute/private/webhooks.env integrations/webhook-bridge/src/index.mjs status
```

The HTTP listener binds to `127.0.0.1:8788`. `/health` reports queue mode.
`POST /webhooks/slack` and `POST /webhooks/linear` accept JSON, bounded to 256 KiB.
Expose only these paths through your authenticated service deployment/reverse
proxy when ready to configure a real webhook. No deployment or tunnel is created
by these commands. Slack's signed URL-verification challenge is supported.

Slack requests must have a valid v0 HMAC and timestamp within five minutes.
Linear requests must have a valid raw-body HMAC and signed `webhookTimestamp`
within one minute. Verification follows [Slack's request-signing documentation](https://docs.slack.dev/authentication/verifying-requests-from-slack/)
and [Linear's webhook documentation](https://linear.app/developers/webhooks).

HTTP 202 means a complete receipt was atomically published and its contents
synced to the inbox, **not** that an
agent completed it. Duplicate deliveries return the same receipt ID. Requests
outside the allowlists are acknowledged as ignored. Failure to persist returns
503 so the sender can retry.
The inbox requires a filesystem that supports atomic rename and hard links.
Directory metadata is also synced on macOS/Linux; Windows power-loss persistence
of a newly created directory entry is not guaranteed by this adapter.

## Dispatch explicitly

Configure the local runtime token, absolute workspace and exact model in the
private env file. Then:

```sh
node --env-file=/absolute/private/webhooks.env integrations/webhook-bridge/src/index.mjs dispatch
```

This can spend model tokens; run it only for work you have authorized. It creates
one plan-mode thread/turn per pending event, with shell execution, trust mode
and automatic approvals disabled. The runtime remains the approval authority.
The resulting receipt contains thread and turn IDs to open in Codewhale. A
`dispatched` receipt means the runtime accepted a turn, not that it succeeded.

## Recovery and limitations

The private inbox is capped at 10,000 receipts. No automatic pruning deletes
history. `status` prints identifiers and stages without request text or tokens.
One dispatcher holds `dispatch.lock`. If a dispatcher crashes, inspect its PID,
receipts and runtime state before removing that stale lock. Never remove a lock
held by a running dispatcher.

Stages `creating_thread`, `starting_turn` and `needs_review` are deliberately
not retried automatically: a lost HTTP response may conceal a successful side
effect. Reconcile the runtime first. There is no exactly-once network-delivery
claim. Dispatch uses the current shared Core HTTP client; operator interruption
and uncertain outcomes require this reconciliation. Durable result delivery and
a bounded supervised worker remain follow-up work.

Tests cover real request signatures, replay windows, admission, duplicate
receipts, disk reopening, runtime request shapes, crash stages and refusal to
retry uncertain delivery. No real Slack/Linear account, provider request or
external message has been used to qualify this adapter.
