# Release checklist

Keyed to the release commit. Fill in results as steps run; a release is only
publishable when every applicable row has a recorded result. Steps marked
**human-only** are never performed by scripts.

Release commit: `<sha>` — date: `<date>` — operator: `<name>`

## 0.3.0 local candidate — 2026-09-13 UTC

The whale identity, native setup panel, permission actions, background check,
human Pause/Stop, bundled Node and verified-update path are implemented.
Local source tests: **227 passed, 0 failed, 15 platform skips** (242 total).
The owned practice workflow verified the edit, Apply result and app screenshot;
720 samples recorded zero foreground-app changes and zero pointer changes.
The installed setup-panel trial also verified edit/capture, but reported
background isolation as inconclusive when movement occurred. Both outcomes
are retained; see [the reproducible demo](DEMO.md).

The universal macOS app is Developer ID signed. **Notarization is pending**:
packaging refused to produce a release archive because no Apple ticket is
stapled to the candidate. The updater correctly reports that no stable
installer is published. A clean-machine update, fresh permission grants and
a model-driven task are still separate acceptance gates.

Use [the distribution workflow](DISTRIBUTION.md) to qualify the exact signed
bundle with an existing Apple notary Keychain profile. Do not describe a
signed local installation as a notarized public release.

## Local candidate qualification — 2026-09-07

Execution and skill source: `6657399` (local commit, not a published release).
Harness/documentation changes are recorded separately in git. Public release
remains blocked until the applicable device, host and artifact gates below pass.

| evidence | result |
|---|---|
| `npm test` | 136 passed, 0 failed, 0 skipped; `check:web` is not defined in this standalone package |
| macOS repeated tasks | broad 26-task run 129/130; corrected dynamic fixture 5/5; file upload 5/5; all three runs preserved in the matrix |
| Native and public-browser comparisons | 5/5 on each tool surface for each named workflow; different response shapes/browser engines, no general speed or full parity claim |
| Installed helper | version 0.2.1, session protocol 2, Developer ID identity and hardened runtime verified; existing Accessibility and screen capture grants retained |
| Gatekeeper / notarization | Gatekeeper rejected the candidate; no notarization acceptance or public installer qualification; bundle verifier exits nonzero |
| Text observations | saved app-state payload 67% smaller, all app nodes and nonempty values retained; semantic targets remain validated against full cached state |
| Local OCR | generated-image recognition and a real background Codewhale app-window capture passed; recognized text and confidence are explicit; no remote inference |
| App inclusion | packaged Dogfood app with bundled Node and embedded Engine helper; actual folder selection, built-in review, trust, enable and Start a task navigation observed |
| Engine model turn | release-host model-triggered look/act/verify remains open; tool listing and direct MCP calls are separate proofs |
| Release pairing | production App still requires its exact published Engine version and manifest; local candidate overrides are Dogfood-only |
| Other devices and hosts | non-Retina/mixed displays, Windows, Wayland, HarmonyOS, SSH and fresh external MCP hosts remain explicitly unqualified |

Track remaining acceptance in GitHub issues #1–8 and the linked Engine/App
issues. No private screenshots or raw desktop receipts belong in a public issue.

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

## 3. Permission flow (manual on macOS)

| step | result |
|---|---|
| Clean install: install app, connect host, `request_access` shows Accessibility + Screen Recording granted to the app | |
| Upgrade: rebuild/reinstall over a granted install, verify TCC grants persist for the same bundle identity | |
| Revoke + re-grant: remove grants in System Settings, verify `request_access` reports them missing and the next call fails closed | |

## 4. Cross-references

- Issues covered by this release: #1 (reproducible parity evidence), #2
  (coordinate/element targeting), #3 (input fidelity), #4 (raster binding),
  #5 (cancellation/stop), #6 (permission probe + fail-closed), #7 (this
  checklist), #8 (docs).
- Matrix: `docs/PARITY_MATRIX.md` — every "untested" platform row must also
  appear in `docs/LIMITATIONS.md`.
- Suite usage: `docs/PARITY.md`.

## 5. Final actions — human-only, never scripted

- [ ] **Repository visibility change** — performed by a human, by hand.
- [ ] **Publish release** — performed by a human, by hand.

---

## Filled example — commit `9e6fd39` (this branch, linux-x11 host)

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
