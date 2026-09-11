---
name: stripe
description: Read and manage Stripe resources — customers, payments, subscriptions, invoices, disputes, balances — through Stripe's official remote MCP server. Use for billing investigations and Stripe configuration.
---

# Stripe

Remote MCP server: `https://mcp.stripe.com`.

## Prerequisites

`STRIPE_SECRET_KEY` in the environment. Prefer a **restricted** key
(`rk_…`) granting only the permissions the work needs — the tools act with
the key's full authority and this surface can move money.

## Usage

- Read tools (customers, payments, subscriptions, invoices) are the common
  case: reconcile a charge, inspect a subscription state, list disputes.
- Write tools (refund, cancel, create) change real billing state. Confirm
  the exact object id and the intended action before calling one; report
  the resulting object state after.
- Test-mode keys (`sk_test_`/`rk_test_`) and live keys look alike — check
  the prefix before any write and say which mode you used.

## Failure recovery

- `Unauthorized`: the key is missing or revoked — stop and say so.
- Never log, echo, or write the key into code, docs, or output.
