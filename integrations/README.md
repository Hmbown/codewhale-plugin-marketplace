# Chat and event integrations

Use Codewhale from the service where a request starts. All adapters connect to
the existing Engine runtime; no adapter runs its own model loop.

```sh
npm run integrations -- list
npm run integrations -- check telegram
npm run integrations -- start telegram --env-file /absolute/private/telegram.env
```

Copy the chosen adapter's `.env.example` to a private location and fill in the
required values. Keep `auto_approve` and `trust_mode` false. Set an explicit
model, workspace and allowlist. Run `codewhale serve --http` on loopback with
its runtime token; read the selected bridge's README for its complete setup.
No service is started merely by installing a plugin.

| Integration | Transport | Current scope |
| --- | --- | --- |
| [Telegram](telegram-bridge/README.md) | Bot API long polling | Existing commands, replies, thread control, approval buttons and reconnect handling |
| [WeChat / Weixin](weixin-bridge/README.md) | iLink Bot polling and QR setup | Existing Core adapter; protocol/account availability needs live qualification |
| [WeCom](wecom-bridge/README.md) | WeCom SDK connection | Existing Core adapter; install dependencies and follow its configuration guide |
| [Feishu](feishu-bridge/README.md) | Feishu SDK | Existing Core adapter; install its declared dependencies first |
| [Slack + Linear](webhook-bridge/README.md) | Signed HTTP webhooks | Durable intake and explicit dispatch; no reply delivery or unattended worker |

The first four bridges and `bridge-core` are exact copies of the clean Core
source snapshot recorded in [upstream.json](upstream.json). Their tests run here.
Presence and passing tests do not establish a working live account on every
service. Their original setup docs and license are retained.

Before starting an SDK adapter, install its dependencies:

```sh
npm ci --prefix integrations/feishu-bridge
npm ci --prefix integrations/wecom-bridge
```

Only install the package you intend to use. Telegram, WeChat/Weixin and the
webhook adapter need no npm runtime dependencies. Keep service credentials
outside this repository.

Do not automatically start a listener or bot during plugin activation. Background
hosting belongs to the existing runtime/service operator, with an explicit start,
stop, health and recovery path. A hosted multi-user bot needs tenant isolation,
managed authorization and durable reply delivery before admission as a product.
