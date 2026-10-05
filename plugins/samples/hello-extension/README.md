# Hello Extension (native TypeScript sample)

A runnable Native extension: one tool, `hello_greet`, and one slash command,
`/hello-greet [name]`. It reads no files and uses no network. It proves the
Native TypeScript extension path end to end.

This is a copy of Codewhale's `docs/examples/plugins/hello-extension` (MIT,
Copyright 2024-2025 DeepSeek-TUI Contributors), packaged here so it can be
installed from the catalog. The upstream copy is the source of truth; see
Codewhale's `docs/EXTENSIONS.md` for the host contract.

## Prerequisites

- Codewhale 0.10.1 or newer.
- The experimental extension host, which is off by default. Start Codewhale with
  `codewhale --enable extension_host` (or set `[features] extension_host = true`).
  With the host off, the plugin installs and can be trusted, but `/plugin enable` is
  refused (`has no supported declarative components to activate; inactive: native`)
  and `/hello-greet` does not exist.
- A Node runtime on PATH (the host resolves Node or Bun); `.mts` type stripping needs Node 22.18 or newer.
- Known limitation: the extension host is not supported on Windows in 0.10.1.

## Try it

```text
/plugin install /absolute/path/to/hello-extension
/plugin show hello-extension
/plugin trust hello-extension <content-hash>.<capability-hash>
/plugin enable hello-extension
/hello-greet Ada
```

`/hello-greet Ada` prints `Hello, Ada!`. The model can also call `hello_greet`;
the call always asks for approval because Native tools use the `Required` gate.

Set the greeting in your `config.toml`; per the source comment in `hello.mts`, the host
validates it against the extension's schema before the extension starts (not exercised
in this test run):

```toml
[plugins."hello-extension".config]
greeting = "Howdy"
```

## What success and failure look like

Observed in Codewhale 0.10.1 (build 0c79ef28b165) with `--enable extension_host`:

- After install, the review shows `native=1`. After trust and enable, `/plugin show
  hello-extension` lists `Active components: [native (host code: JavaScript)]` and
  `Live tools (1): hello_greet`.
- `/hello-greet Ada` prints `Hello, Ada!`.
- `/plugin disable hello-extension` removes the command: `Unknown command: /hello-greet`.
- Host flag off: the review shows `Compatibility: unsupported` and `Inactive components:
  [native]`, and enable is refused as above.

## Data and authority

The extension runs inside the sandboxed extension host with the authority you
review in `/plugin show`; trust is not an OS sandbox. This sample declares no
network hosts and no filesystem roots.
