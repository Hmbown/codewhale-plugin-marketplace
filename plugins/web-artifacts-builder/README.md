# Web Artifacts Builder

Turn "make me a page for this" into one HTML file you can open, attach or host,
after a local check and a loopback preview. The plugin never publishes or
deploys anything.

After installing, reviewing, trusting and enabling it, ask:

> Build a loan payoff calculator as a single HTML page with a chart, check it,
> and preview it.

You get one `.html` file, the check result, and a statement of whether the
rendered page was actually opened in a browser.

## What it contains

| Piece | What it does |
| --- | --- |
| `web-artifacts-builder` skill | The workflow: pick a tier, scaffold, write, check, preview, hand back |
| `/artifact` command | Entry point: `/artifact <brief>`, `/artifact check <file>`, `/artifact preview <path>` |
| `scripts/wab.mjs` | Node 22+ tool with no dependencies: `new`, `check`, `build`, `preview` |
| `templates/single` | A plain HTML/CSS/JS starter, no build and no network |
| `templates/react` | Vite + React 19 + Tailwind 4 starter that builds to one inlined `dist/index.html` |

## Prerequisites and data destinations

- Node 22 or newer for `wab.mjs`.
- The single-file tier needs nothing else and contacts no service.
- The React tier needs npm. `build` runs `npm install`, which downloads packages
  from the npm registry the first time. Review `templates/react/package.json`
  before building. Nothing else leaves your machine.
- `preview` binds `127.0.0.1` only and serves the chosen file or directory
  read-only, refusing paths outside it.

## Use the tool directly

```sh
node scripts/wab.mjs new ./loan --template single --title "Loan payoff"
node scripts/wab.mjs check ./loan/index.html
node scripts/wab.mjs preview ./loan          # prints http://127.0.0.1:<port>/

node scripts/wab.mjs new ./dash --template react --title "Sales dashboard"
node scripts/wab.mjs build ./dash            # npm install + vite build
node scripts/wab.mjs check ./dash/dist/index.html
```

`check` exits 1 on an error. It verifies the doctype, title, viewport, size
limit (1 MB by default), unreplaced placeholders, references to separate files,
network-loaded resources, and strings shaped like API keys or private keys.

## What success looks like

- `check: OK` with no errors, and warnings you can explain.
- The preview URL loads, the console is clean and each control works, as seen in
  a browser tool. If no browser tool was available, the assistant says it only
  ran the static check.
- Failure looks like `check: FAILED` with a specific line to fix, an npm error
  printed in full, or `preview` refusing a missing path.

## Limits

`check` is a static scan, not a security audit or a render test. It does not
prove the page works, is accessible or looks right; pair it with a browser
check. Treat anything in the file as public to whoever receives it.

## Development

```sh
node --test plugins/web-artifacts-builder/tests/*.test.mjs
WAB_E2E=1 node --test plugins/web-artifacts-builder/tests/*.test.mjs   # also builds the React template (uses npm and network)
```

License: MIT. The templates and skill text are original to this repository.
