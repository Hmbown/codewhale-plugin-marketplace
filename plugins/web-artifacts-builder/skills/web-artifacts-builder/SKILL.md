---
name: web-artifacts-builder
description: Build a self-contained web page, dashboard, prototype, calculator or small interactive tool as ONE HTML file (plain HTML/CSS/JS, or React plus Tailwind bundled into a single file), check it, and preview it locally. Use when the user wants a page they can open, share as a file, or iterate on in a browser.
invocation: model+user
---

# Web artifacts builder

An artifact here is one `.html` file that opens from disk, an email attachment
or any static host, with nothing else to install or serve. You build it locally,
check it, preview it on loopback and hand back the file. This skill never
publishes or deploys anything.

The installed `scripts/wab.mjs` (Node 22+, no dependencies) scaffolds, checks,
builds and previews. Find the installed plugin directory with
`/plugin show web-artifacts-builder`; do not assume the process cwd. Call it as
`node <plugin-dir>/scripts/wab.mjs <command>`.

## Choose the smallest tier that fits

1. **Single file, no build.** Plain HTML, CSS and a script block. Use this for
   most pages: a calculator, a report, a one-screen tool, a visual explainer.
   No network, no dependencies, opens instantly. Start here unless state or
   component reuse is genuinely getting complicated.
2. **React + Tailwind, bundled to one file.** Use it when the page has many
   interacting components or non-trivial state. It needs Node, npm and the npm
   registry once (`npm install`), then produces the same single `dist/index.html`.
   Tell the user that `build` downloads packages before you run it.

Do not load React, Tailwind or fonts from a CDN in a "single file". That page
fails offline, behind a firewall and when the CDN changes. If the user insists
on a CDN, say what it costs and run `check --allow-network`.

## Workflow

1. **Pin the job.** One sentence: who opens this, what they do, what data it
   shows. Ask only if the answer changes the design. Real content beats lorem
   ipsum; if you lack data, build with clearly labelled sample data the user can
   replace, and keep it in one object at the top of the script.
2. **Scaffold.** `wab.mjs new <dir> --template single|react --title "Name"`.
   The directory must be new or empty. Read the generated file before editing it.
3. **Write the page.** Follow the build rules below. Replace the starter content
   entirely; do not ship the starter's checklist.
4. **Build (react only).** `wab.mjs build <dir>` runs `npm install` if needed and
   `npm run build`, leaving `<dir>/dist/index.html`. Report any npm failure with
   its output instead of guessing.
5. **Check.** `wab.mjs check <file.html>`. It fails on: missing doctype, title or
   viewport, unreplaced placeholders, files over the size limit, any `src`/`href`
   to a separate file, any network-loaded resource, and strings shaped like API
   keys or private keys. Fix every error. A warning needs a reason to keep it.
6. **Preview and look.** `wab.mjs preview <file-or-dir>` serves on
   `127.0.0.1` and prints the URL; it keeps running until stopped, so start it
   in the background. If a browser tool is available (the Browser pane,
   Chromewhale, Computer Use or a Playwright MCP), open the URL, read the console
   for errors, exercise each control once, and view it at phone width (about
   375 px) and desktop width. If none is available, say you could only run the
   static check and could not look at the rendered page.
7. **Hand back** the absolute path of the single file, what you verified and what
   you did not. Stop the preview server.

## Build rules

- **Self-contained.** Inline CSS and JS. Images are inline SVG or `data:` URIs.
  Use the system font stack unless the user supplies a font to embed.
- **No secrets, no private data.** Anything in the file is readable by whoever
  receives it. Never paste credentials, tokens or private records into the page.
  `check` catches common key shapes, not all secrets.
- **No network at runtime by default.** Do not call APIs from the page unless the
  user asked and understands the endpoint receives their visitors' requests. Never
  embed an API key in client-side code.
- **Responsive.** Works at 375 px wide without horizontal scroll. Use fluid
  widths, `min-width: 0` on flex children and a 16 px minimum body size.
- **Light and dark.** Define colors as CSS variables and swap them under
  `prefers-color-scheme: dark`. Set the background explicitly.
- **Accessible by default.** Real `<button>`, `<label>`, `<main>` and heading
  order; visible `:focus-visible` outlines; text contrast of at least 4.5:1;
  state changes announced with `aria-live` where the user would otherwise miss
  them; motion respects `prefers-reduced-motion`.
- **Persist only what is safe.** `localStorage` can be blocked or full, so wrap
  every read and write in `try/catch` and render correctly without it.
- **Decide on the look.** Pick a point of view (editorial, instrument panel,
  paper, terminal) and commit to a small palette, one type scale and consistent
  spacing. Avoid the default template look: purple gradient hero, three identical
  cards, emoji as icons.
- **Small is a feature.** Aim well under 200 KB for a single-file page. If React
  pushes it near the 1 MB limit, you probably wanted tier 1.

## Failure recovery

- `npm install` fails or there is no network: fall back to tier 1, or ask the
  user to approve network access for the registry.
- `check` reports an external resource: inline it, or remove it. For a font or
  library, copy the minimal needed part into the file if its license permits.
- Blank page in preview: read the console error first; in the react tier, confirm
  you opened `dist/index.html`, not the source `index.html`.
- `preview` refuses to start: the path does not exist, or the port is taken.
  Omit `--port` to take a free one.
