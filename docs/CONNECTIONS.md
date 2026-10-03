# Connections

A **connection** lets a running agent use a service. A **bot integration** lets
an outside message request work from Codewhale. A **plugin** adds reviewed
capabilities, skills or tools. These are different setup tasks.

The six credential-dependent URL wrappers from the initial catalog have been
removed. They added an install/trust step without proving authentication or a
useful tool. Their history remains in Git. Cloudflare docs stays installable
because it provides useful tools without another login.

## Find the correct setup

```sh
npm run connections -- list
npm run connections -- show linear
npm run connections -- doctor github
```

`show` prints the host's setup commands or a config fragment. It does not replace
an existing config or copy tokens. `doctor` reports local prerequisites; it never
claims a token is authenticated or a tool works. It does not make network calls.

[connections/catalog.json](../connections/catalog.json) contains the endpoint,
auth method, qualification status and primary documentation. `documented` means
the service documents the route; it does **not** mean this checkout completed
its login. Use the official docs linked there before granting access.

For a supported OAuth service, the ordinary terminal flow is:

```sh
codewhale mcp add linear --url https://mcp.linear.app/mcp/readonly
codewhale mcp login linear
codewhale doctor
```

The real qualification is: authorize the intended account, list tools, perform
one permitted read, verify its result, restart and verify reconnect, then revoke
and verify loss of access. Account authorization should be reused across sessions
through Codewhale's existing connection owner, with grants controlling which
agent can use it. A plugin installation is not that account connection.

## What the initial bundles got wrong

- **Resend:** its official remote setup uses browser OAuth. `RESEND_API_KEY` in a
  bearer environment variable was not a verified remote login. The local server
  has separate setup. [Resend's official server](https://github.com/resend/resend-mcp)
- **Vercel:** its remote server uses OAuth and requires an approved client.
  Codewhale was absent from the documented supported-client list when checked
  September 11, 2026. A `VERCEL_TOKEN` wrapper does not establish compatibility.
  [Vercel MCP](https://vercel.com/docs/agent-resources/vercel-mcp)
- **Slack:** its MCP path requires an eligible app and confidential OAuth client
  credentials. Adding only a URL or client ID does not complete that setup.
  [Slack MCP authentication](https://docs.slack.dev/ai/slack-mcp-server/)
- **Linear:** the official endpoint supports OAuth and direct API-key bearer
  authentication. The new guidance starts with its read-only endpoint.
  [Linear MCP](https://linear.app/docs/mcp)

Plugin-contributed MCP servers currently cannot invoke Codewhale's interactive
OAuth login path. User-level MCP configuration can. Keep authentication in the
host; do not work around this with browser-driving login scripts, copied OAuth
tokens or an extra credential store inside every plugin.

## BaizhiCloud Agent Toolkit

BaizhiCloud provides a hosted Streamable HTTP MCP endpoint with API-key bearer
authentication. Obtain your own Agent Toolkit key from
[BaizhiCloud](https://baizhi.cloud/landing/agent-toolkit), review the service's
pricing, and make `BAIZHI_API_KEY` available to the Codewhale process. Keep the
value out of committed configuration and terminal transcripts.

```sh
npm run connections -- show baizhi
npm run connections -- doctor baizhi
```

`show` emits a server entry using Codewhale's `bearer_token_env_var` field.
On Codewhale v0.9.13, `codewhale mcp init` prints the resolved config path
(the default is `~/.codewhale/mcp.json`). Merge the generated server entry into
that config, preserving existing entries; use `codewhale mcp list` to confirm
it was read, then `codewhale doctor` for local diagnostics. `mcp list` may make
authentication-discovery requests; it is not guaranteed to be offline. The
directory's `doctor` command only checks whether the variable is present: it does not contact BaizhiCloud
or validate the key.

A first task after connecting is: “Find the official Model Context Protocol
transport documentation, read the relevant page, and summarize it with source
links.” Review the offered tools and the requested operation before approving
the call. Queries, URLs and other tool inputs are sent to BaizhiCloud, and calls
may incur service charges. An authentication error requires checking the key
and account access; a configured entry or successful local prerequisite check
does not prove a tool call worked.

This entry is `documented`, not live-qualified in Codewhale. The linked public
integration code does not make the hosted service's backend open source, and
catalog membership is not an endorsement or service certification.

## Bots and webhooks

See [integrations/README.md](../integrations/README.md). Existing chat bridges
use `codewhale serve --http` and `/v1/threads` + `/v1/threads/<id>/turns`.
The previous `/v1/apps/sessions` recipe did not describe the existing bridge
contract and has been retired.

Slack Events and Linear webhooks also require request authentication, replay
protection, admission rules, durable storage and recovery. The supplied webhook
bridge implements intake and explicit dispatch. A complete Slackbot also needs
reply delivery, session continuity, approval presentation and installed service
verification; it is not described as a finished bot here.
