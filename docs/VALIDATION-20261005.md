# Current source qualification — October 6, 2026

This addendum supersedes the October 5 Computer Use drift report below. Root
reviewed the original wave commit `4e27243` and its follow-up reconciliation on
`feat/marketplace-wave-1005`. Engine G6 `ed5e3f10dac5` is now on remote Main through
original integration PR6846, merge `ad333fdcaf04` with the identical tested tree.

- `npm test`: **997 passed, 0 failed, 26 skipped** across the reported groups.
- `npm run check:web`: **13 passed, 0 failed, 9 skipped**. Mobile extension cases
  remain intentionally skipped; this does not prove mobile extension support.
- Marketplace contract, all four skill provenance manifests, all three wiki
  pages and exact owning-Core Computer Use sync passed. **19 catalog bundles**
  packaged locally from the final source. The implementation was unchanged
  throughout the full local gates; this evidence addendum was written afterward.
- Computer Use exactly mirrors canonical Main `a656f674`; local upstream
  `b47efff5` has the same tree. G6 matches the runtime subset, with three declared
  Core variants. An earlier check against the stale sibling Core checkout failed;
  the corrected owning-lane check passed. No canonical source was forked.
- All **42 canonical bridge files and two referenced Weixin images** now mirror
  G6 byte for byte. `integrations/upstream.json` records that exact commit and
  all 44 hashes. This carries human approval identity, accepted-turn recovery,
  Weixin account binding and QR fixes already present in Engine, instead of
  inventing an independent marketplace fork. The integration wiki was updated
  and resealed against the actual source set.
- Fresh locked Feishu and WeCom installs, syntax checks and production dependency
  audits passed: **0 vulnerabilities** in each. Both SDKs imported their expected
  exports and their own Axios **1.20.0** dependency completed a localhost request.
  No authenticated service was contacted.
- The first hosted follow-up at `6f33bf07` passed macOS but failed one Linux and
  35 Windows cases. Linux exposed truncated `lsof` socket paths; Loop now joins
  listening Unix-socket inodes to ancestor process file descriptors. **40/0**
  tests passed in an isolated Linux container, including a path with spaces.
  Windows fixtures now follow the documented Unix-only Loop socket contract;
  portable module imports and manifest path assertions were corrected.
- Loop completion requires the final nonblank reply line. **Seven installed
  native TUI checks passed again** against the final bundle and the actual G6
  binary using a scripted localhost model. These cover cap/wrap-up, completion,
  cancellation, ordinary messages, missing socket and changed bundle trust.
- Authored Cloudflare commands use `cf`; executable typed config is not evaluated
  by offline preflight or silently substituted with stale legacy config. The
  focused Cloudflare gate passed **24/0**.
- The design checker decodes original HTML entities once and replaces invalid
  numeric scalars. Four-language CodeQL at `6f33bf07` passed after this repair.
  Final-head three-OS CI and security analysis remain required before PR10 merges.
- Catalog and Core provenance URLs use `codewhale-hq`; hello-extension points at
  its actual `plugins/samples/hello-extension` source. Skill commit, generation
  17, bodies and resource hashes are preserved.

Node: **26.10.0**. Raw gate logs, source hashes, package inventories and failed
attempts are retained in the workspace takeover artifact directory. Hosted CI,
authenticated services and publication are separate proofs. Engine's embedded
marketplace revision remains a separate source pin until explicitly refreshed.
No deployment occurred.

---

## Historical October 5 qualification account

# Wave 1005 validation — October 5, 2026

Local source, package and installed-host evidence for the thirteen plugins added
on `feat/marketplace-wave-1005`. It is not hosted CI, an authenticated service
call, a model-driven run or customer acceptance. Those gaps are listed at the end.

Host: Codewhale 0.10.1 (`0c79ef28b165`) at `~/.local/bin/codewhale`, macOS,
Node 26.10. Core source for skill sync: `wave/0.10.1-next`.

## Repository gates

| Gate | Result |
| --- | --- |
| `npm run check` | `marketplace.json contract: OK`, 19 catalog entries, every bundle under the 5 MiB cap, 47 skills at Core generation 17 |
| `npm test` | exit 0 |
| `npm run check:web` | 13 passed, 9 skipped (mobile Chrome-extension specs skip by design) |
| `npm run check:wiki` | 3 fresh, 0 stale (two pages were re-written and re-sealed in this wave) |
| `npm run check:skill-plugins` | 4 plugins checked, 0 stale |
| `npm run check:cu-sync` | **fails, unchanged by this wave** — see below |

`npm test` suites: WhaleWiki 39/39; Computer Use 416 (398 pass, 18 platform
skips, 0 fail); Chromewhale 161/161; **plugin tests 161 (153 pass, 8 skips, 0 fail)**
across 13 plugins; the integration suites (19, 39, 13, 16 and 3 tests) all passing;
repository contract and catalog wiring **31/31** (24 before this wave, 7 new in
`tests/catalog-wiring.test.mjs`).

The 8 plugin skips are opt-in: `LOOP_E2E=1` (7 tests, real Codewhale 0.10.1 through tmux
against a scripted local model server) and `WAB_E2E=1` (1 test, a real `npm install` and
Vite build). Both were run during integration and passed: loop 45/45 (38 unit + 7 real-TUI
scenarios), web-artifacts-builder 11/11.

Baseline: `computer-use`, `chromewhale`, `whalewiki`, `whalesong` and `cloudflare-docs`
are unchanged since `596aeae` (origin/main), so a failure in their suites could not
come from this wave; none occurred. A pristine clone of `596aeae` passes
`npm run check` and 24/24 repository tests, and shows the same `check:cu-sync` failures.

## New tests that guard the wiring

- `scripts/test-plugins.mjs` (`npm run test:plugins`) discovers every
  `plugins/*/tests/*.test.mjs` outside `computer-use`, `chromewhale` and
  `whalewiki`. Before it existed, none of the new plugins' tests ran from `npm test`.
- `tests/catalog-wiring.test.mjs`: catalog name and version match each manifest; every
  bundle under `plugins/` is cataloged (the two documented fixtures excepted); a
  qualified skill reference such as `github-workflow:pr-review` names the plugin that
  ships that skill; README install commands use the installed plugin id; README
  links every plugin; `loop`, `computer-use` and `hello-extension` declare their
  platforms; the domain skill plugins match the `skills/` pin.
- `scripts/sync-skill-plugins.mjs`: refreshes the four `skills-*` plugins after
  `npm run sync:skills`, or fails under `--check`.

Mutation checks run on these: restoring a stale `github:pr-review` in
`commands/pr.md` failed the reference test; appending a line to `skills/gmail/SKILL.md`
failed `--check`. Both were reverted.

A real defect was found and fixed while integrating: the three connection-recipe ids
(`github`, `linear`, `vercel`) collided with plugin names, so the plugins were renamed
to `github-workflow`, `linear-workflow` and `vercel-workflow`. That rename left skill
references (`github:pr-review`, `linear:issue-triage`) and `/plugin show github`
instructions pointing at names that no longer exist; a command would have asked the
model to load a skill that is not there. They are fixed and the reference test now
catches the class.

## Install test from the catalog

Real Codewhale TUI driven through tmux in a scratch `HOME` and `CODEWHALE_HOME`, telemetry
off, workspace untrusted, no provider connected. The real `~/.codewhale/plugins/state.json`
and `config.toml` hashes were identical before and after.

1. `/plugin marketplace add local <repo>/marketplace.json` reported
   `19 candidate(s), 0 warning(s)`.
2. For each of the 13 new plugins: `/plugin marketplace install local <name>`, then the
   exact `/plugin trust <name> <content>.<capability>` line it printed, then
   `/plugin enable <name>`. Twelve ended `active`, `user · trusted · compatibility=full`.
   `hello-extension` installs and trusts but stays disabled with
   `compatibility=unsupported` because the experimental extension host is off. That is
   the documented behavior for a native extension.
3. A wrong token (`deadbeef.deadbeef`) was refused: `Review token does not match this
   bundle content and capability set`. `/plugin enable` before trust opened the review
   instead of enabling.
4. `/skill <plugin>:<skill>` for all **44** skills shipped by the twelve enabled plugins:
   44 activated.
5. Slash palette showed `/review-pr`, `/loop`, `/loop-status`, `/cancel-loop`, `/pr`,
   `/linear`, `/cloudflare-preflight`, `/vercel-preflight`, `/artifact` and
   `/design-review` with their descriptions and usage lines. `/hello-greet` is absent, as
   expected without the extension host.
6. `/fleet roster` went to 17 members with the six reviewer profiles listed.
   `/mcp status` listed `github-workflow/github` and `linear-workflow/linear`.
   `/hooks list` showed the two `loop` hooks.
7. `/plugin disable github-workflow` removed `/pr` from the palette and made
   `/skill github-workflow:pr-review` answer `not found`. Uninstall and reinstall from the
   catalog worked.
8. The installed copies of `cloudflare/scripts/preflight.mjs`,
   `vercel-workflow/scripts/preflight.mjs`, `design-review/scripts/design-review.mjs` and
   `web-artifacts-builder/scripts/wab.mjs` were run from the scratch home against
   fixtures: errors found, exit codes correct, and a planted `sk-live-...` value was
   never echoed.

## Computer Use sync (gap report item 1)

Not changed here; `plugins/computer-use` and the `codewhale-cu-plugin` repo were not
touched.

| Copy | Version | Revision |
| --- | --- | --- |
| `codewhale-cu-plugin` HEAD | 0.12.1 | `be8ff828` |
| this repo `plugins/computer-use` (`.upstream-sha`) | 0.12.1 | `be8ff828`, identical to upstream |
| Core `crates/tui/plugins/computer-use` (`wave/0.10.1-next`) | 0.12.0 | `843569235f`, 17 upstream commits behind |
| Core built-in catalog `first-party-marketplace.json` | `computer-use` 0.12.0, `chromewhale` 0.3.0, 6 entries | marketplace `ae3dd22` (this repo is at `596aeae` plus this wave; `chromewhale` is 0.4.0 here) |

`node scripts/check-cu-sync.mjs --core <worktree>` reports 30 failures:

- **23 files differ** (Core is older): `commands/computer.md`, `mcp/server.mjs`,
  `package-lock.json`, `plugin.json`, the two `computer-use` and `recording` skills with
  their two references, `src/app-handler`, `app-script-policy`, `app-socket`, `consent`,
  `registry`, `spawn`, `tools`, `trajectory`, `transport`, `browser-cdp`, and the
  darwin, linux, win32 and harmonyos backends plus `darwin-accessibility.m`.
- **7 files exist only in Core**: `src/recordings.mjs`, `src/ssh-args.mjs`,
  `tests/fixtures/host-decision.mjs`, `tests/fixtures/ssh-destinations.json`,
  `tests/helper-policy.test.mjs`, `tests/recordings-path.test.mjs`,
  `tests/ssh-args.test.mjs`. They came from Core commits (for example `e86d67711f`,
  "tighten approval, execution and endpoint boundaries for 0.10.1") that were never
  upstreamed. Re-vendoring 0.12.1 into Core as-is would delete them.

What has to change, in order:

1. **`codewhale-cu-plugin`**: take the seven Core-only files (or confirm the behavior was
   dropped on purpose), land them upstream, and cut the release decision for 0.12.1.
2. **this repo**: re-mirror `plugins/computer-use` and `.upstream-sha` from the new
   upstream revision, byte for byte, as was done for `be8ff828`.
3. **Core**: re-vendor `crates/tui/plugins/computer-use` and update
   `crates/tui/plugins/computer-use.upstream-sha`, then run `python3 scripts/sync-marketplace.py`
   after this branch merges so the built-in catalog moves from `ae3dd22` and gains the new
   plugins.

The `check:cu-sync` default `--core ../codewhale` is a stale checkout (branch
`fix/skills-untrusted-workspace`); pass `--core` explicitly until the default is corrected.

## Skills pack sync

`node scripts/skills.mjs --core <worktree>` reported `Core active skill inventory
changed` (generation 15 pinned, 17 in Core, same 47 names). `--write` changed three files
only: `skills/plugin-creator/SKILL.md` (now describes `plugin.json` and the experimental
extension host), `skills/upstream.json` and `skills/README.md`. It was applied, and the
four `skills-*` provenance files were refreshed to the same commit and generation. None
of the 25 skills they copy changed.

## Not proven

- **No model followed any of these skills or commands.** No provider was connected. The
  `/review-pr` fan-out, the deploy approval gates, the no-drive-by-comment rules and the
  `/loop` hooks under a real model are unverified. `loop` was exercised against a scripted
  local model server by its author; `review-toolkit` reached the point of loading its
  skill and stopped on a local model's context window.
- **No authenticated call** to GitHub, Linear, Cloudflare or Vercel. Both remote MCP
  endpoints answered 401 without a token; tool names in the GitHub and Linear skills and in
  `disabled_tools` are unconfirmed against `tools/list`.
- `hooks` only fire in a trusted workspace; this test ran untrusted, so `/hooks list`
  said hooks are globally suppressed. `loop` was proven separately by its author.
- `hello-extension` was not run under `--enable extension_host` in this integration pass;
  its author ran it (`/hello-greet Ada` prints `Hello, Ada!`).
- Linux and Windows were not tested.

## Host defects found by this wave (Core, not fixable here)

The first five were reported by the plugin authors' own install tests and were not
re-run in the integration pass.

- Claude-format bundles (`.claude-plugin/plugin.json`) install and trust but never
  activate: `PluginInstance::authority()` in `crates/tui/src/plugins/types.rs` keeps only
  the manifest file name, so the reviewed source cannot be revalidated. `claude-sample`
  is the regression check.
- `/plugin import dsh <dir>` (the preview) panics with "Cannot start a runtime from within
  a runtime" in `extension_host/composition_review.rs:64`. Install and approve work.
- Every plugin command whose frontmatter sets `description` starts a native `/goal`, and
  continuations are unlimited by default. The `loop` commands omit `description` for that
  reason.
- A 401 from a plugin remote MCP suggests `/mcp login`, which cannot work for plugin
  servers.
- The Extensions modal skills tab does not list plugin skills; `/skill` and
  `/plugin show` do.

Harness note: the first command typed after Codewhale's onboarding in a fresh home is
swallowed, so a test driver must send it twice. `/plugin marketplace add codewhale <path>`
(the README example) also works and reports 19 candidates.
