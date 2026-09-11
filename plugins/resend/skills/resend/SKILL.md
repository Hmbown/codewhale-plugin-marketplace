---
name: resend
description: Send transactional email and manage Resend resources — domains, audiences, broadcasts, API keys — through Resend's official remote MCP server. Use when a task sends or inspects email through Resend.
---

# Resend

Remote MCP server: `https://mcp.resend.com/mcp`.

## Prerequisites

`RESEND_API_KEY` in the environment (Resend → API Keys). A sending-only
key is enough for email work and is the safer default.

## Usage

- `send-email` delivers real mail to real inboxes. Confirm recipient,
  subject, and from-domain before calling; report the returned email id.
- Domain/audience/broadcast tools read and mutate account state — inspect
  before writing.
- For template or draft work, prefer generating the HTML locally and only
  calling the tool once the content is confirmed.

## Failure recovery

- `missing_api_key` / `Unauthorized`: `RESEND_API_KEY` unset or revoked.
- A failed send returns the Resend error verbatim — relay it; do not
  silently retry (a retry can double-send when the first call landed).
