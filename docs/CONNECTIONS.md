# Connecting Codewhale to services

Three tiers, in order of how far the trust boundary moves. Pick the
narrowest tier that does the job.

```
Tier 1  plugin-delivered remote MCP   install from this catalog; bearer env var only
Tier 2  user-level remote MCP         ~/.codewhale/mcp.json; interactive OAuth possible
Tier 3  app-level integration         a hosted Codewhale process driven by webhooks
```

## Tier 1 — plugin bundles in this catalog

These work through the reviewed plugin path: install → review (the review
screen shows the exact `network_hosts` the bundle can reach) → trust →
enable. **Plugin-contributed servers authenticate only through
environment-backed headers or bearer tokens — never interactive OAuth.**
That is a deliberate host constraint: a bundle cannot pop a browser.

| Plugin | Endpoint | Credential | Notes |
| --- | --- | --- | --- |
| `cloudflare-docs` | `docs.mcp.cloudflare.com/mcp` | none | Docs search only; verified live |
| `linear` | `mcp.linear.app/mcp` | `LINEAR_API_KEY` | `…/mcp/readonly` variant exists — edit the bundle's `mcp.json` before install for read-only |
| `github` | `api.githubcopilot.com/mcp/` | `GITHUB_PERSONAL_ACCESS_TOKEN` | fine-grained PAT; `/mcp/readonly` variant exists |
| `stripe` | `mcp.stripe.com` | `STRIPE_SECRET_KEY` | use a restricted `rk_` key — tools can move money |
| `supabase` | `mcp.supabase.com/mcp` | `SUPABASE_ACCESS_TOKEN` | personal access token; tools reach every visible project |
| `resend` | `mcp.resend.com/mcp` | `RESEND_API_KEY` | sending-only key suffices for email |
| `vercel` | `mcp.vercel.com` | `VERCEL_TOKEN` | scoped to the owning team |

A missing env var leaves the server enabled but unauthenticated — the
honest failure mode is the endpoint's 401, which the tool list surfaces as
"no tools". Set the variable and reconnect; nothing else is needed.

## Tier 2 — user-level MCP config (OAuth services)

Services that require interactive OAuth cannot be plugins. They go in the
user-global MCP config, `~/.codewhale/mcp.json`, where the self-serve
OAuth login flow (`codewhale mcp login <name>`, or the synthetic
`mcp_<name>_authenticate` tool in-session) can run:

```json
{
  "mcpServers": {
    "slack":     { "type": "streamable-http", "url": "https://mcp.slack.com/mcp" },
    "notion":    { "type": "streamable-http", "url": "https://mcp.notion.com/mcp" },
    "atlassian": { "type": "streamable-http", "url": "https://mcp.atlassian.com/v1/mcp" },
    "sentry":    { "type": "streamable-http", "url": "https://mcp.sentry.dev/mcp" }
  }
}
```

Notes per service:

- **Slack** — `mcp.slack.com/mcp`, OAuth 2.0. Slack's server expects the
  client to authenticate against *your* Slack app's client ID, so create a
  Slack app first (api.slack.com/apps) and set `extensions["net.codewhale"].oauth.client_id`
  if the default client registration is refused. Read-only scopes are
  enough for search/context work.
- **Notion** — OAuth; authorize once per workspace.
- **Atlassian** — OAuth; covers Jira + Confluence cloud sites you can see.
- **Sentry** — OAuth; `mcp.sentry.dev/mcp`.

## Tier 3 — app-level integrations (bots)

These are not MCP connections — they are external services *calling into*
a running Codewhale. The host is the app-server (`codewhale serve`, REST
on its bound port): create sessions, send messages, read results over
`/v1/apps/...`. A thin webhook bridge per service is all that is needed:

- **Codewhale Slackbot** — Slack app (Events API, `app_mention` +
  `message.im`) → bridge receives the event → `POST /v1/apps/sessions`
  (or an existing per-channel session) → `POST …/messages` with the text →
  reply with the assistant response. Keep one Codewhale session per Slack
  channel/thread so context accumulates. Needs: a Slack app, a public
  webhook URL, and a reachable Codewhale app-server. The bridge itself is
  ~100 lines of your favorite HTTP stack.
- **Linear → Codewhale** — Linear webhook on issue create/update → bridge
  spawns a session with the issue context + acceptance criteria, or posts
  back a comment when a tagged agent finishes. Alternatively agents use
  the `linear` plugin (Tier 1) *inside* sessions to read/update issues
  themselves — often the better pattern, since the agent fetches exactly
  what it needs.
- **GitHub PR review bot** — see `docs/REVIEW-BOT.md`. Webhook or Actions
  → `codewhale exec` with the `review` skill on the PR diff, findings
  posted as a PR review via the GitHub API.

## What not to do

- Do not put OAuth-only endpoints in a plugin bundle — they cannot
  complete auth; the plugin will sit enabled with zero tools.
- Do not bake tokens into plugin manifests or `mcp.json` — the
  `bearer_token_env_var` indirection exists so credentials live in the
  environment and the bundle stays reviewable text.
- Do not point a webhook bridge at a shared interactive Codewhale home —
  give bot sessions their own `CODEWHALE_HOME` so their trust/review
  state is theirs.
