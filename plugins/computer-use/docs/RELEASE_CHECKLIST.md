# Release checklist

Keyed to the release commit. Fill in results as steps run; a release is only
publishable when every applicable row has a recorded result. Steps marked
**human-only** are never performed by scripts.

Release commit: `<sha>` — date: `<date>` — operator: `<name>`

## Qualification record

No release has been published from this repository. The records below come
from one maintainer Mac (arm64, Retina) and are kept as evidence, not as a
publication verdict.

### 0.3.1 — macOS beta candidate, unpublished

- Source suite: **240 passed, 0 failed, 15 platform skips**. The hosted CI
  workflow runs the same suite and the receipt hygiene check on macOS and
  Ubuntu runners.
- Signed native build: the menu-bar owner crash and reopen check passed with
  isolated state. The human-control fixture has request deadlines,
  channel-error handling and bounded teardown; its focused checks pass on
  macOS. Windows execution remains unqualified.
- Updater apply: the notarized 0.3.1 build replaced an installed notarized
  0.3.0 app through the real apply step. The previous bundle was retained, the
  helper restarted with controls stopped, and all 33 runtime files plus the 3
  native executables in the installed bundle matched the build.
- Open gates: clean-machine install with fresh Accessibility and Screen
  Recording grants; a model-driven task through an installed Codewhale Engine;
  the non-admin Applications-directory update scenario.

### 0.3.0 — notarized locally, never published

The whale identity, native setup panel, permission actions, background check,
human Pause/Stop, bundled Node and verified-update path were implemented here.
The universal macOS archive was Developer ID signed and **Apple notarization
was accepted**; stapling, signature verification and Gatekeeper assessment
passed. The archive name, size, digest and notary submission are recorded in
[releases/0.3.0.json](releases/0.3.0.json). Verification accepts the notarized
Codewhale app and rejects a differently signed app.

The owned practice workflow verified the edit, Apply result and app
screenshot; 720 samples recorded zero foreground-app changes and zero pointer
changes. The installed setup-panel trial also verified edit/capture but
reported background isolation as inconclusive when movement occurred. Both
outcomes are retained; see [the reproducible demo](DEMO.md).

The installed notarized helper also passed the two-trial MCP check: 173
samples without foreground/pointer interference, then 212 samples around a
deliberate app switch during held input. The original target received key-up
after the switch; the decoy's contents/input counters and the pointer stayed
unchanged, with no focus reclaim. The standalone observer services the
NSWorkspace run loop so foreground changes are live; earlier watch-probe
receipts without that fix are superseded. See
[the opt-in command](DEMO.md#verify-an-installed-helper-through-mcp).

### Earlier development candidate (0.2.1)

- macOS repeated tasks: broad 26-task run 129/130; corrected dynamic fixture
  5/5; file upload 5/5; all three runs preserved in the matrix.
- Native and public-browser comparisons: 5/5 on each tool surface for each
  named workflow; different response shapes and browser engines, so no general
  speed or full parity claim.
- Installed helper: session protocol 2, Developer ID identity and hardened
  runtime verified; existing Accessibility and screen capture grants retained
  across a signed reinstall.
- Gatekeeper rejected that candidate; it had no notarization acceptance.
- Text observations: saved app-state payload 67% smaller with all app nodes
  and nonempty values retained. Local OCR passed on a generated image and a
  real background app-window capture, with no remote inference.
- Codewhale's built-in plugin review, trust, enable and task navigation were
  observed in a packaged internal build; a release-host model-triggered
  look/act/verify turn remains open.
- Non-Retina/mixed displays, Windows, Wayland, HarmonyOS, SSH and fresh
  external MCP hosts remain explicitly unqualified.

Use [the distribution workflow](DISTRIBUTION.md) to qualify the exact signed
bundle with an existing Apple notary Keychain profile. Do not describe a
signed local installation as a notarized public release. Track remaining
acceptance in this repository's issues; no private screenshots or raw desktop
receipts belong in a public issue.

## 1. Automated verification (all hosts that release)

| step | command | result |
|---|---|---|
| Unit tests | `npm test` | `<count>` passing |
| Parity suite | `npm run parity` (each supported platform) | run dir recorded below |
| Parity suite, isolated | `npm run parity -- --isolated` | run dir recorded below |
| Matrix regenerated | `npm run parity:matrix -- --run <dir> [--run <dir>...]` | `docs/PARITY_MATRIX.md` current |
| Model comparison eligibility | `npm run parity:matrix -- --model-trials <trial-dir> --out <report-dir>` | complete valid fixture outcomes, exclusions retained; see `docs/PARITY.md` |
| Receipt hygiene | `node scripts/check-receipts.mjs parity/results docs` | clean |
| README claims match matrix | manual read of `docs/PARITY_MATRIX.md` vs README claims | ok / diff noted |

## 2. Bundle verification (macOS only — record "unavailable" elsewhere)

| step | command | result |
|---|---|---|
| Build app bundle | `npm run build:app` | |
| Verify signature | `node scripts/verify-bundle.mjs dist/macos/"Codewhale Computer Use.app"` (runs `codesign --verify --deep --strict`, `codesign -dv`, `spctl --assess --type execute`) | |
| Notarize and package | `node scripts/package-macos.mjs --notary-profile <profile>` | `dist/release/release.json` reports `notarized: true` |

## 3. Permission flow (manual on macOS)

| step | result |
|---|---|
| Clean install: install app, connect host, `request_access` shows Accessibility + Screen Recording granted to the app | |
| Upgrade: rebuild/reinstall over a granted install, verify TCC grants persist for the same bundle identity | |
| Revoke + re-grant: remove grants in System Settings, verify `request_access` reports them missing and the next call fails closed | |
| Notarized update: **Check for updates…** installs the published release, keeps the previous bundle, restarts with controls stopped | |
| Model-driven task: a Codewhale Engine task observes, acts and verifies through the installed helper | |

## 4. Cross-references

- The `issue` tags in `parity/tasks.json` group acceptance themes: #1
  reproducible parity evidence, #2 coordinate/element targeting, #3 input
  fidelity, #4 raster binding, #5 cancellation/stop, #6 permission probe and
  fail-closed behaviour, #7 this checklist, #8 documentation. They are theme
  labels, not links to issues in this repository.
- Matrix: `docs/PARITY_MATRIX.md` — every "untested" platform row must also
  appear in `docs/LIMITATIONS.md`.
- Suite usage: `docs/PARITY.md`.

## 5. Final actions — human-only, never scripted

- [ ] **Repository visibility change** — performed by a human, by hand.
- [ ] **Publish release** — performed by a human, by hand.

---

## Filled example — a pre-publication linux-x11 run

| step | result |
|---|---|
| `npm test` | 51 passing |
| `npm run parity` (shared :0) | `receipts/parity/linux-x11-<ts>/` — see matrix |
| `npm run parity -- --isolated` (Xvfb :99) | `receipts/parity/linux-xvfb-<ts>/` — see matrix |
| `npm run parity:matrix` | regenerated `docs/PARITY_MATRIX.md` + `parity/results/*.json` |
| `check:receipts` on `parity/results docs` | clean |
| `npm run build:app` + `verify-bundle` | unavailable (codesign requires macOS) |
| macOS permission flows | unavailable (no macOS host) |
| Repository visibility / publish | not performed — human-only |
