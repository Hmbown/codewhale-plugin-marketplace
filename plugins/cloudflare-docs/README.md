# Cloudflare Docs

Look up current Cloudflare documentation while building or troubleshooting
Workers, Pages, storage, queues or platform configuration.

After installing, reviewing, trusting and enabling the plugin, ask:

> Find the current documentation for a Workers R2 binding and show a minimal
> configuration with links to the source.

The plugin connects to Cloudflare's official documentation MCP at
`https://docs.mcp.cloudflare.com/mcp`. It needs network access but no account
or credential. Search terms are sent to that endpoint; keep private code,
customer data and secrets out of queries. It cannot manage your Cloudflare
account or deploy resources.

Use the [documentation skill](skills/cloudflare-docs/SKILL.md). A successful
answer includes source links. If the service is unavailable, report that and
use official documentation directly rather than guessing current limits.
