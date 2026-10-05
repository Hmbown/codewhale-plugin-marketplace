# Sample plugins

Three tiny, runnable plugins that each prove one way a bundle reaches Codewhale.
They exist to be installed, read and copied.

| Sample | Path it proves | How you use it |
| --- | --- | --- |
| [`dsh-sample`](dsh-sample/README.md) | A DeepSeek Harness package converted by `/plugin import dsh` | `/plugin import dsh <dir>` then `approve` |
| [`claude-sample`](claude-sample/README.md) | A Claude Code format bundle read from `.claude-plugin/plugin.json` | `/plugin install <dir>` |
| [`hello-extension`](hello-extension/README.md) | A Native TypeScript extension run by the experimental extension host | `/plugin install <dir>` with `--enable extension_host` |

Each README gives the exact commands, the prerequisites and what success looks
like. None of them contacts the network or reads your files. Installing any of
them leaves it untrusted and disabled until you review and trust it.

Run the samples' tests with `node --test plugins/samples/tests/*.test.mjs`. The
unit tests check each sample's files, the sample MCP server's protocol behavior and the
Native module's behavior against a stand-in host. The install paths themselves were
exercised in Codewhale 0.10.1 through a pseudo-terminal in a scratch home; CI here does
not repeat that.

## Status in Codewhale 0.10.1 (build 0c79ef28b165)

| Sample | Installs and reviews | Components load after trust and enable |
| --- | --- | --- |
| `dsh-sample` | Yes, with `/plugin install <dir>` or `/plugin import dsh approve`. `/plugin import dsh <dir>` (the preview) panics in this build | Yes: skill listed and activated, MCP server listed |
| `claude-sample` | Yes | No: runtime activation is denied for every Claude-format bundle ("reviewed source could not be revalidated") |
| `hello-extension` | Yes | Yes with `--enable extension_host`: `/hello-greet Ada` prints `Hello, Ada!`. With the flag off, enable is refused |

Each README names the exact failure and the likely cause. The samples stay as they are
so the same commands become the regression checks when the host is fixed.
