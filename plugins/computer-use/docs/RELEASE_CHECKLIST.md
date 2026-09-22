# Release checklist

Keyed to the release commit. Fill in results as steps run; a release is only
publishable when every applicable row has a recorded result. Steps marked
**human-only** are never performed by scripts.

Release commit: `e52a124f832f340330fd522cefc52e50363a8a96` — date: `2026-09-15` — operator: `Hunter Bown (build and packaging run by Devin)`

## Qualification record

Release status is recorded in [CHANGELOG.md](../CHANGELOG.md). Records below
come from one maintainer Mac (arm64, Retina) and are evidence, not a
publication verdict.

### 0.11.3 — release qualification, 2026-09-21

Protocol-conformance patch over
[v0.11.2](https://github.com/Hmbown/codewhale-cu-plugin/releases/tag/v0.11.2):
the MCP server answers `resources/templates/list` with an empty template list
instead of `-32601`, so a host that probes the method because the advertised
`resources` capability implies it stops recording a discovery warning at the
start of every session. The capability advertisement and every existing method
are unchanged; the dispatcher still refuses genuinely unknown methods. Users
on 0.11.2 lose no capability — the warning was log noise — but they keep seeing
it, because the installed bundle predates this fix.

- Local source suite at the 0.11.3 source commit: **383 tests, 366 passed,
  0 failed, 17 platform skips** in the CI ad-hoc signing posture
  (`CODEWHALE_CU_SIGN_IDENTITY=-`); receipt hygiene
  (`node scripts/check-receipts.mjs docs parity/results`) clean. Every skip is
  a Windows-PowerShell gate; the Docker-desktop tests ran against a live
  daemon.
- Hosted CI runs the same suite on macOS, Ubuntu and Windows for this commit.
- Fix verification against a rebuilt and installed bundle: `initialize`,
  `resources/templates/list`, `resources/list`, `resources/read`,
  `tools/list` and `skills/list` answered over stdio; a genuinely unknown
  method still returned `-32601`; a fresh interactive session logged no
  `resources/templates/list` warning, where the previous build logged one at
  connect.
- **Signed candidate: built and verified** from the release commit
  (`4968228`) — universal (arm64 + x86_64) launcher and bundled Node 24.21.0,
  `Developer ID Application: Hunter Bown (5RDNSHA5TY)` under the hardened
  runtime, `codesign --verify --deep --strict` valid, bundled plugin reports
  0.11.3. That candidate's MCP surface answered `initialize`,
  `resources/templates/list` (an empty list, no error), `resources/list`,
  `resources/read`, `tools/list` and `skills/list` over stdio, and a genuinely
  unknown method still returned `-32601`.
- **Notarization: complete.** The App Store Connect Team Issuer ID was
  recovered on the maintainer Mac and a `codewhale-cu` notarytool keychain
  profile now authenticates (`xcrun notarytool history` returns this team's
  submission history). Apple accepted both submissions —
  app `eeed7947-6ffd-4ae5-aa7e-d76e39029a5f` and
  disk image `ed5e88e0-88df-4e52-be9a-3bccb51f596f` — and both are stapled.
  Gatekeeper now assesses the app and the disk image as
  `source=Notarized Developer ID`. The 46 packaged runtime files are
  byte-identical to canonical source.
- **Publication: performed.** `v0.11.3` is tagged on
  `b06279b67abb856fcfab289d06120910fe7e85ff` and published as the latest
  release with 11 assets; the marketplace mirror is
  `1ad65160c63f92042243c522fea4a47cff717481`. Details in §5.

Windows and Linux are untouched by this patch and carry their 0.11.2
qualification; every open gate recorded there stays open.

### 0.11.2 — release qualification, 2026-09-19

The publication pass includes macOS background-focus refusal, verified Linux
semantic edits, orderly Docker restart, and Windows identity/input/packaging
hardening. Exact source, hosted CI and signed asset hashes are recorded in the
release assets. Windows is an unsigned experimental preview; no Windows
production-readiness or full Codex parity claim is made.

A real DeepSeek Engine trial observed, edited Unicode text, applied once and
verified the isolated GTK result. Core checkpoint14c64b5bdc additionally stopped
a pending write in0.373seconds, rejected a late approval, and reconnected after
Runtime restart without replay. These are isolated Linux/checkpoint receipts,
not physical Mac coexistence or final installed Core evidence. The final Core
installation is a separately coordinated check.

The older candidate qualification below is retained as historical evidence.


- Local source suite: **358 passed, 0 failed, 15 platform skips**.
  After switching foreground revalidation to the existing live WindowServer
  identity check, the focused native/cancellation suite passed **71/71**.
- Fixes: initialize typing's optional focus lease, refuse `user_busy` when
  the hardware-input quiet window never arrives, revalidate foreground before
  key-down, and include the Docker context/lockfile in app bundles.
- The new busy/idle/cancel checks use the real native wait with a simulated
  hardware clock. They do not prove coexistence with an actively typing user.
- Source version and all manifests are 0.11.2. The older local notarized
  0.11.1 candidate does not contain this source; never publish it as this fix.
- Publication remains pending exact-source artifact/CI receipts and the
  applicable human qualification below. The latest published installer before this publication pass was 0.6.0;
  no complete Codex parity is claimed.

### 0.6.0 — window-routed background pointer and web-area traversal

- Source suite at commit `e52a124f832f340330fd522cefc52e50363a8a96`:
  **260 passed, 0 failed, 15 platform skips**; darwin-aqua parity suite
  **28/28 tasks × 5 reps** (run `darwin-aqua-2026-09-15T15-45-34-087Z`,
  pointer drift 0 px, operator foreground preserved).
- Public build: produced 2026-09-15 from that commit on `main`. Signed with
  "Developer ID Application: Hunter Bown (5RDNSHA5TY)" under the hardened
  runtime; universal (arm64 and x86_64); bundled Node 24.21.0; macOS 13.5+.
- Notarization: submission `3f76ab14-74ff-4650-b668-1bb3ecefb795` Accepted;
  ticket stapled; `codesign --verify --deep --strict` ok; `spctl` accepted
  with source "Notarized Developer ID". Receipt:
  [releases/0.6.0.json](releases/0.6.0.json).
- Archive: `Codewhale-Computer-Use-0.6.0-macos-universal.zip`, 79,766,090
  bytes, SHA-256
  `c8f25537a16287d5397cb0c938e759746904d040edb2cd842bd6963c44a77ea2`.
- Disk image: `Codewhale-Computer-Use-0.6.0-macos-universal.dmg`, 88,300,064
  bytes, SHA-256
  `20d63bf43e40b9eaff97ab7294edc7296cf3d8317e1fd5f90c6b9f99b17a876c`;
  submission `27d89e49-4551-4b0e-aaa3-3245d56e989f` Accepted, stapled.
- Open gates, carried forward and recorded as open: clean-machine install
  with fresh Accessibility and Screen Recording grants; a model-driven task
  through an installed Codewhale Engine; the non-admin Applications-directory
  update; the real post-publication **Check for updates…** path from an
  installed older notarized build.

### 0.5.0 — stateful waits and persistent SSH sessions

- Source suite at commit `b25f11c8673667329af2d9172aa57b153b9cc49d`:
  **258 passed, 0 failed, 15 platform skips**; live smoke on the maintainer
  Mac 23/23 (`receipts/smoke-2026-09-15T04-13-17-742Z.json`).
- Public build: produced 2026-09-15 from that commit on `main`. Signed with
  "Developer ID Application: Hunter Bown (5RDNSHA5TY)" under the hardened
  runtime; universal (arm64 and x86_64); bundled Node 24.21.0; macOS 13.5+.
- Notarization: submission `bd1180c2-4661-401e-a5e5-4188917196d0` Accepted;
  ticket stapled; `codesign --verify --deep --strict` ok; `spctl` accepted
  with source "Notarized Developer ID". Receipt:
  [releases/0.5.0.json](releases/0.5.0.json).
- Archive: `Codewhale-Computer-Use-0.5.0-macos-universal.zip`, 79,730,597
  bytes, SHA-256
  `b5688ccbe117b23a533251275abc84a63ed397c20c5ba0dd87addd832133124a`.
- Disk image: `Codewhale-Computer-Use-0.5.0-macos-universal.dmg`, 88,260,407
  bytes, SHA-256
  `56aa7097e5ad57d6b4d37539750f71adb0d9713731a975930c442473b659b269`;
  submission `cc2fd378-84d8-4992-b0c8-5bd9b7db9885` Accepted, stapled.
- Open gates, carried forward and recorded as open: clean-machine install
  with fresh Accessibility and Screen Recording grants; a model-driven task
  through an installed Codewhale Engine; the non-admin Applications-directory
  update; the real post-publication **Check for updates…** path from an
  installed older notarized build.

### 0.4.0 — macOS beta

- Source suite at commit `249ae77fad9162c2af11d5460d91b2b5b909c06c`:
  **245 passed, 0 failed, 15 platform skips**. The hosted CI workflow runs the
  same suite and the receipt hygiene check on macOS and Ubuntu runners.
- Public build: produced 2026-09-13 from that commit on clean `main`. Signed
  with "Developer ID Application: Hunter Bown (5RDNSHA5TY)" under the hardened
  runtime; universal (arm64 and x86_64); bundled Node 24.21.0; macOS 13.5+.
  The build scripts ran with Node v25.8.0 on the maintainer Mac, while CI pins
  Node 22.
- Notarization: submission `08f574c9-e4d7-4ff7-b7e1-431136fd4262` Accepted;
  ticket stapled; `codesign --verify --deep --strict` ok; `spctl` accepted with
  source "Notarized Developer ID". Receipt:
  [releases/0.4.0.json](releases/0.4.0.json).
- Archive: `Codewhale-Computer-Use-0.4.0-macos-universal.zip`, 79,725,412
  bytes, SHA-256
  `753565134e9fa36ac1435b64af0613d4df8195503bad56b93c80fdee0df6a637`.
- Disk image: `Codewhale-Computer-Use-0.4.0-macos-universal.dmg`, 88,254,027
  bytes, SHA-256
  `3ee12be851a9f7a2feb43fa55eea0abbd5ea9ffc83472b20ccb2d0dab7aae4d8`;
  submission `0416455e-1798-4397-b0d0-c9b1bf5cb8dd` Accepted, stapled,
  `spctl --type open` accepted.
- Local install: the notarized 0.4.0 app was installed over the notarized
  0.3.1 app in the maintainer's `~/Applications` through `install-app.mjs`;
  Gatekeeper assessed the installed bundle as Notarized Developer ID.
- Open gates, carried forward from 0.3.1 and recorded as open: clean-machine
  install with fresh Accessibility and Screen Recording grants; a model-driven
  task through an installed Codewhale Engine; the non-admin
  Applications-directory update; the real post-publication
  **Check for updates…** path from an installed older notarized build.

### 0.3.1 — macOS beta

- Source suite at commit `9f6c39f738c0d8e8dcc93af11af5e00d19081b60`:
  **240 passed, 0 failed, 15 platform skips**. The hosted CI workflow runs the
  same suite and the receipt hygiene check on macOS and Ubuntu runners.
- Public build: produced 2026-09-13 from that commit on clean `main`; all 33
  packaged runtime files are byte-identical to it. Signed with
  "Developer ID Application: Hunter Bown (5RDNSHA5TY)" under the hardened
  runtime; universal (arm64 and x86_64); bundled Node 24.21.0; macOS 13.5+.
  The build scripts ran with Node v25.8.0 on the maintainer Mac, while CI pins
  Node 22.
- Notarization: submission `769ff14d-ee5c-4db5-a3b9-f733c2743e6e` Accepted;
  ticket stapled; `codesign --verify --deep --strict` ok; `spctl` accepted with
  source "Notarized Developer ID". Receipt:
  [releases/0.3.1.json](releases/0.3.1.json).
- Archive: `Codewhale-Computer-Use-0.3.1-macos-universal.zip`, 79,720,031
  bytes, SHA-256
  `76752d33fff60d62b5445452e5a7f21396eb5aace6dbf632fc2a172f75e4720a`.
- Signed native build (earlier 0.3.1 candidate on the same Mac): the menu-bar
  owner crash and reopen check passed with isolated state. The human-control
  fixture has request deadlines, channel-error handling and bounded teardown;
  its focused checks pass on macOS. Windows execution remains unqualified.
- Updater apply (earlier 0.3.1 candidate on the same Mac): the notarized 0.3.1
  build replaced an installed notarized 0.3.0 app through the real apply step.
  The previous bundle was retained, the helper restarted with controls
  stopped, and all 33 runtime files plus the 3 native executables in the
  installed bundle matched the build.
- Open gates, recorded as open: clean-machine install with fresh Accessibility
  and Screen Recording grants; a model-driven task through an installed
  Codewhale Engine; the non-admin Applications-directory update; the real
  post-publication **Check for updates…** path from an installed older
  notarized build.

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
| Unit tests | `npm test` | e52a124 on macOS: 260 passed, 0 failed, 15 platform skips |
| Parity suite | `npm run parity` (each supported platform) | `receipts/parity/darwin-aqua-2026-09-15T15-45-34-087Z` — 28/28 × 5 reps |
| Parity suite, isolated | `npm run parity -- --isolated` | not run this cycle; aqua session run recorded above |
| Matrix regenerated | `npm run parity:matrix -- --run <dir> [--run <dir>...]` | `docs/PARITY_MATRIX.md` regenerated against `darwin-aqua-2026-09-15T15-45-34-087Z` |
| Model comparison eligibility | `npm run parity:matrix -- --model-trials <trial-dir> --out <report-dir>` | complete valid fixture outcomes, exclusions retained; see `docs/PARITY.md` |
| Receipt hygiene | `node scripts/check-receipts.mjs parity/results docs` | clean |
| README claims match matrix | manual read of `docs/PARITY_MATRIX.md` vs README claims | ok / diff noted |

## 2. Bundle verification (macOS only — record "unavailable" elsewhere)

| step | command | result |
|---|---|---|
| Build app bundle | `node scripts/prepare-node-runtime.mjs && node scripts/build-app.mjs --platform macos --node-runtime dist/node` | e52a124: built and Developer ID-signed (hardened runtime, universal, Node 24.21.0) |
| Verify signature | `node scripts/verify-bundle.mjs dist/macos/"Codewhale Computer Use.app"` (runs `codesign --verify --deep --strict`, `codesign -dv`, `spctl --assess --type execute`) | e52a124: codesign ok, identifier net.codewhale.computer-use, team 5RDNSHA5TY; spctl rejected before notarization, accepted (Notarized Developer ID) after |
| Notarize and package | `node scripts/package-macos.mjs --notary-profile <profile>` | e52a124: notarized:true, submission 3f76ab14-74ff-4650-b668-1bb3ecefb795 Accepted, stapled; archive 79,766,090 bytes, sha256 c8f25537a16287d5397cb0c938e759746904d040edb2cd842bd6963c44a77ea2 |
| Disk image | `node scripts/package-dmg.mjs --notary-profile <profile>` | e52a124 app, 2026-09-15: dmgbuild layout (app, Applications shortcut, branded background), Developer ID signed, submission 27d89e49-4551-4b0e-aaa3-3245d56e989f Accepted, stapled; 88,300,064 bytes, sha256 20d63bf43e40b9eaff97ab7294edc7296cf3d8317e1fd5f90c6b9f99b17a876c |

## 3. Permission flow (manual on macOS)

| step | result |
|---|---|
| Clean install: install app, connect host, `request_access` shows Accessibility + Screen Recording granted to the app | |
| Upgrade: rebuild/reinstall over a granted install, verify TCC grants persist for the same bundle identity | |
| Revoke + re-grant: remove grants in System Settings, verify `request_access` reports them missing and the next call fails closed | |
| Notarized update: after publication, from an installed older notarized build, **Check for updates…** offers exactly **Install 0.3.1…**, downloads the GitHub asset, verifies the digest, keeps the previous bundle and restarts with controls stopped | | After publication (2026-09-13): the updater contract was exercised against the live release from a 0.3.0 identity and offers exactly `Install 0.3.1…` with the canonical URL, GitHub digest and size; the real apply from an installed notarized 0.3.0 is still open | Model-driven task: a Codewhale Engine task observes, acts and verifies through the installed helper | |

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

- [x] **Repository visibility change** — public since 2026-09-13 (human).
- [x] **Publish release** — v0.3.1 published 2026-09-13 by Hunter Bown (human); tag on `44bf9fcde4bebacf3d69d03d08972ba02b0d1bc5`; anonymous download verified (size 79,720,031, SHA-256 match, Gatekeeper accepted as Notarized Developer ID, stapled ticket valid).
- [x] **Publish release** — v0.4.0 published 2026-09-13 (PDT) at Hunter Bown's direction (GitHub release created and published by Claude Fable 5.1 from the human's authenticated `gh` session); tag on `e03e206b50ca5e52e72042e126d7afd08e85d49e`; GitHub's asset digests match the receipt (zip 753565134e9f…, dmg 3ee12be851a9…); anonymous download of `release.json` verified.
- [x] **Publish release** — v0.5.0 published 2026-09-15 (PDT) at Hunter Bown's direction (GitHub release created and published by Devin from the human's authenticated `gh` session); tag on `8a7b7dd`; GitHub's asset digests match the receipt (zip b5688ccbe117…, dmg 56aa7097e5ad…).
- [x] **Publish release** — v0.6.0 published 2026-09-15 at Hunter Bown's direction (GitHub release created and published by Devin from the human's authenticated `gh` session); tag on `c9d36d9`; GitHub's asset digests match the receipt (zip c8f25537a162…, dmg 20d63bf43e40…); anonymous `release.json` download verified.
- [x] **Publish release** — v0.11.3 published 2026-09-21 (PDT) at Hunter Bown's direction (GitHub release created and published by Claude Opus 5 from the human's authenticated `gh` session); tag on `b06279b67abb856fcfab289d06120910fe7e85ff`; exact-head three-platform CI run 35678169352 success (ubuntu, macos, windows); Apple accepted app `eeed7947-6ffd-4ae5-aa7e-d76e39029a5f` and disk image `ed5e88e0-88df-4e52-be9a-3bccb51f596f`, both stapled and Gatekeeper `Notarized Developer ID`; all 11 GitHub asset digests match the local receipt (zip 409ed976f58e…, dmg ddbbd037763b…); marketplace mirror `1ad65160c63f92042243c522fea4a47cff717481`.

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

## Windows qualification follow-up (0.11.2 source candidate)

- Canonical CI includes Windows, including managed native input contracts and an
  opt-in real WinForms observe/value/invoke/capture test on the disposable runner.
- Semantic actions carry window and element runtime identities from observation;
  first-child paths are traversed rather than skipped. Changed identities refuse
  input. UIA ValuePattern reads are masked for password fields.
- Capture preserves virtual-screen origins, honors display/region selection,
  and rejects process failure or cancellation even if an old output file exists.
- Browser discovery covers Chrome, Edge, Chromium and Brave vendor folders.
- This is source qualification work. Earlier notarized macOS artifacts still
  represent their recorded source revision; rebuild before publishing revised
  source. No Windows signing, installed Engine, mixed-DPI, raw-input coexistence
  or fresh-machine acceptance is implied by CI.

## Native sharing-session UX requirement

The macOS purple window-sharing pill is system UI. ScreenCaptureKit streams and
SCContentSharingPicker provide native selection and sharing status; this is not
proof of any particular OpenAI implementation. Codewhale currently uses
ScreenCaptureKit for recording and separate still screenshots for ordinary
observation; it does not yet use the native sharing picker for a control session.

Acceptance for adopting that interaction: the user selects the app/window, the
session visibly names that target, and Stop Sharing/window closure/revocation
invalidates its capture handle and aborts queued and held input. Sharing grants
observation scope; it does not replace separate input consent. A cosmetic status
icon or an unrelated recording stream does not meet this requirement. Keep this
inside the existing helper/session ownership path. Native-picker integration
remains open and is not part of the Windows CI qualification claim.

Reference: [Apple ScreenCaptureKit overview](https://developer.apple.com/videos/play/wwdc2023/10136/).

## Keyboard coexistence release blocker (2026-09-19)

The user reported keyboard takeover during concurrent use. Background
window-record routes borrowed the front process, including Unicode typing and
web replacement. Source now refuses these paths before focus/input; the native
lease boundary independently enforces foreground authorization. Background
text requires the new native guard capability, so older helpers fail closed.
Routine consent tests use recording fixtures, never the user's Calculator.

This source change does not update an already installed app. Rebuild and qualify
the exact helper, synchronize the Engine embed, and verify continuous human
keyboard ownership in an authorized isolated trial before claiming coexistence.
The native sharing picker alone cannot supply input isolation.
