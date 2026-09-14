<img src="assets/codewhale.png" alt="Codewhale" width="96" />

# Codewhale extensions

A home for useful Codewhale plugins, skills, connections, and chat integrations.
Each extension should help someone complete a real task and explain how to tell
whether it worked.

Read the repository's [source-sealed wiki](whalewiki/INDEX.md), or build its
offline reader with `node plugins/whalewiki/scripts/whalewiki.mjs export` and
open `whalewiki/whalewiki.html`. Run `npm run check:wiki` to check its evidence.

## Choose what you need

| Job | Start here | What is available |
| --- | --- | --- |
| Understand and maintain a repository wiki | [WhaleWiki](plugins/whalewiki/README.md) | Source and page seals, freshness checks, five read tools, searchable offline reader |
| Operate a computer | [Computer Use](https://codewhale.net/computer-use) | v0.4.0: Return keys, filtered state, app-scoped clicks. The notarized Mac app is published as the [v0.4.0 GitHub release](https://github.com/Hmbown/codewhale-cu-plugin/releases/tag/v0.4.0); [source and platform support](plugins/computer-use/README.md) |
| Look up Cloudflare documentation | [Cloudflare docs](plugins/cloudflare-docs/skills/cloudflare-docs/SKILL.md) | Official remote MCP; no credential required |
| Add workflows to an agent | [Skills](skills/) | Codewhale's bundled skills as one reviewed plugin |
| Connect Linear, GitHub or another service | [Connections](docs/CONNECTIONS.md) | Official endpoints and honest setup/qualification status; no empty connector plugins |
| Use Telegram, WeChat, WeCom or Feishu | [Chat integrations](integrations/README.md) | Existing Core bridges, packaged here with source provenance |
| Receive Slack mentions or Linear webhooks | [Webhook bridge](integrations/webhook-bridge/README.md) | Signed, allowlisted intake, durable queue and explicit runtime dispatch; reply delivery remains open |
| Build a review bot | [Review bot guide](docs/REVIEW-BOT.md) | Review workflow, implementation boundaries and required host integration |

## Install a plugin

Clone this repository, then add its local catalog in Codewhale:

```text
/plugin marketplace add codewhale /absolute/path/codewhale-plugin-marketplace/marketplace.json
```

A catalog entry does not install or authorize anything. Install the selected
plugin, review its capabilities, then trust and enable it through Codewhale.

For a development checkout, package the selected plugin first. Local build and
receipt files can exceed the installer's 5 MiB cap even when the source fits:

```sh
npm run package:plugin -- whalewiki
npm run package:plugin -- computer-use
```

Install the resulting `dist/<name>` directory. Packaging excludes Git-ignored
artifacts, refuses symlinks, enforces the size cap and never overwrites an existing
package. Pass `--out /another/output/directory` for a later build. A clean clone
can use the catalog's `path:` sources directly.

Codewhale carries its own Computer Use runtime and bundled skills. Installing a
reviewed marketplace copy is optional; inspect existing plugins before adding a
duplicate. This repository does not replace account connection management.

## Develop and verify

Node 22+ and Git are required for repository development. WhaleWiki and Computer
Use have no runtime npm dependencies. Browser tests use Playwright as a dev tool.

```sh
npm ci
npx playwright install chromium
npm run check
npm test && npm run check:web
```

On macOS, browser checks use an installed Google Chrome when available. Set
`CW_BROWSER_PATH` to select another Chromium executable. CI installs Chromium.
Tests never require live service credentials or model calls. Native tests skip
platforms unavailable on the host; those skips are not platform acceptance.

`npm run check:cu-sync` compares the Computer Use mirror against sibling source
checkouts. [Validation evidence](docs/VALIDATION-20260911.md) records the current
source, packaging, local checks and remaining qualification work.

Core embeds this catalog for offline browsing and installs each selected bundle
through its existing reviewed installer. After a catalog or bundle update,
commit the marketplace change and run `python3 scripts/sync-marketplace.py`
from the sibling Core checkout. Core's `Marketplace connection` workflow checks
the pinned catalog on changes and checks current upstream mirrors weekly.
See Core's [marketplace maintenance guide](https://github.com/Hmbown/codewhale/blob/main/docs/PLUGIN_MARKETPLACE.md)
for source ownership, update commands, and the publication order. Catalog
membership never grants trust or enablement to an installed plugin.

## Contribute

Read [CONTRIBUTING.md](CONTRIBUTING.md). Put installable capabilities in `plugins/`,
service setup in `connections/`, and inbound bots in `integrations/`. A plugin
needs a useful capability beyond carrying a service URL. Keep one runtime and
reuse the existing bridge and authentication owners.

Each bundle carries its own license. Vendored integrations retain Core's license
and exact provenance in `integrations/upstream.json`.
