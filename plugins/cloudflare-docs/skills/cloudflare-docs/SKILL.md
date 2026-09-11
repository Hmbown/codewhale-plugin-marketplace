---
name: cloudflare-docs
description: Look up current Cloudflare documentation (Workers, Pages, KV, R2, D1, Queues, DNS, WAF, platform APIs) through Cloudflare's official remote MCP server. Use when answering Cloudflare questions or writing Cloudflare config.
---

# Cloudflare Docs

Remote MCP server: `https://docs.mcp.cloudflare.com/mcp` — no credentials.

## When to use

- Answering "how do I X on Cloudflare" questions where docs currency matters.
- Checking a wrangler config key, binding type, or platform limit.
- Not for: managing the user's actual Cloudflare account (this server is
  documentation-only) or non-Cloudflare questions.

## Usage

Call the `search_cloudflare_documentation` tool with a specific query, then
quote what it returns with the doc URL it cites. Prefer it over memory for
anything that could have changed since training (limits, pricing, flags).

## Failure recovery

- No tools listed: the plugin is installed but not enabled or trusted —
  `/plugin enable cloudflare-docs` after reviewing it.
- Timeout: the endpoint is public; retry once, then say docs are
  unreachable rather than guessing from memory.
