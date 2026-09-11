# Extension validation — September 11, 2026

This is local source and package evidence, not a hosted deployment or live-service
acceptance report. The takeover started at marketplace `c32a8d9`; the public
`origin/main` was `1fd701c4590c2fc4450f77a750469f7be3b99936` when checked.

## Local gates

`npm run check` and the required `npm test && npm run check:web` passed on macOS.
The Node suites reported **369 tests: 354 passed, 15 skipped, zero failures**.

| Suite | Passed | Skipped |
| --- | ---: | ---: |
| WhaleWiki engine, freshness and MCP | 31 | 0 |
| Computer Use | 213 | 15 |
| Shared Core bridge helpers | 11 | 0 |
| Feishu | 19 | 0 |
| Telegram | 39 | 0 |
| Slack/Linear webhook adapter | 13 | 0 |
| WeCom | 16 | 0 |
| WeChat/Weixin | 3 | 0 |
| Repository contract and packaging | 9 | 0 |

All **four Playwright checks passed**, across desktop and mobile Chromium:
page/heading links, full-text and Unicode search, empty state, freshness filter,
safe HTML/link rendering, keyboard search, deep links and horizontal overflow.
The resulting desktop/mobile screenshots were visually inspected.

`npm run check:wiki` reports three fresh pages and no stale, orphaned or unsealed
pages. They describe the actual repository and are sealed to their source basis.
The offline HTML export is generated locally and excluded from the source bundle.

CI now defines macOS, Linux and Windows jobs for these gates and all four plugin
packages. **Hosted CI and Windows/Linux runs have not yet been observed.**
LF checkout attributes keep source seals and vendored hashes consistent across OSes.

## Real Codewhale plugin path

An isolated test home and workspace ran the installed binary
`codewhale 0.9.13 (3df2ed421747)`, SHA-256
`303a47f13afc300715ce17f7a8445a4730cbec7ac51d186d4513fccac6529894`.
The environment excluded provider/service credentials and disabled telemetry.
Only a synthetic loopback runtime token was supplied.

The final packaged WhaleWiki completed install, capability review, trust, enable
and live discovery through `/v1/apps/mcp/tools?connect=true`. The runtime reported
`active` and returned `wiki_structure`, `wiki_read`, `wiki_search`, `wiki_status`
and `wiki_codemap` from its plugin-owned MCP process.

- Content hash: `07dd729f5c600fec9cf55ed10bf6c75463561b0f0717b5b1a1151554f6f3e059`.
- Capability hash: `433e3e35e898b196cad258dc15909498b1c3e5abc8791142a271a2d613877315`.
- Inventory: one skill, one stdio MCP server, one command, one agent, zero hooks,
  no remote servers or network-host grants.

Direct MCP protocol tests exercise reads and workspace selection separately.
No model was invoked to author or consume a page through the installed host.
The test host was stopped afterward; the user's plugin configuration was untouched.

## Package and source ownership

Working-checkout packages fit the host's 5 MiB limit:

| Bundle | Files | Bytes |
| --- | ---: | ---: |
| WhaleWiki | 13 | 79,373 |
| Computer Use | 102 | 2,048,886 |
| Cloudflare docs | 3 | 2,119 |
| Codewhale skills | 38 | 62,137 |

The skills figures reflect the existing dirty skill lane, which this takeover
does not commit. Computer Use's development directory is about 6.6 MiB because
of local ignored artifacts; package its reviewed source before a path install.
No recordings or operational receipts are included in the package.

`npm run check:cu-sync` verified that the marketplace Computer Use mirror equals
canonical source `7ff244dfef7d`, and Core runtime copies match. One Core test
mirror differs: `tests/server-routes.test.mjs` lacks upstream atomic fixture
writes. That test synchronization remains with the active Core lane. No Computer
Use runtime patch was justified by this review, and no desktop input or screen
capture was performed as part of the test suite qualification.

The existing four chat bridges and shared helper retain exact source hashes from
Core `40d04faa4af7d2e2ea1ea932dc3ccc315c11e885` in `integrations/upstream.json`.
They are not independent forks. The webhook adapter is marketplace-owned and
reuses the shared runtime client.

## Remaining product work

- Service recipes are documented routes, not verified account connections.
  Slack and Vercel need Codewhale client qualification. No service login,
  real provider turn or external message was performed.
- Slack/Linear intake has real local HTTP/signature, disk-failure, deduplication
  and dispatch-contract coverage. Replies, conversation continuity, approval
  presentation, result following and supervised dispatch remain unfinished.
- Native Computer Use acceptance on each supported platform is separate from
  these tests. Platform skips are not passes.
- Hosted CI, public push and deployment are separate evidence stages.
  No public release or hosted bot is claimed by this receipt.

Reproduce with `npm ci`, `npx playwright install chromium`, `npm run check`,
`npm run check:wiki`, and `npm test && npm run check:web`. Use private synthetic
fixtures for protocol checks; do not put service credentials in test output.
