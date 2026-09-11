# Codemap

_213 files. Regenerate with `whalewiki map` — deterministic, no model._

## Languages

- `.mjs` — 95
- `.md` — 64
- `.json` — 36
- `(none)` — 4
- `.m` — 4
- `.png` — 2
- `.py` — 2
- `.h` — 2
- `.yml` — 1
- `.c` — 1
- `.html` — 1
- `.toml` — 1

## Modules

### `./` (6 files)

- `CONTRIBUTING.md`
- `README.md`
- `marketplace.json`
- `package-lock.json`
- `package.json`
- `playwright.config.mjs`

### `.github/workflows/` (1 files)

- `check.yml`

### `assets/` (1 files)

- `codewhale.png`

### `connections/` (1 files)

- `catalog.json`

### `docs/` (2 files)

- `CONNECTIONS.md`
- `REVIEW-BOT.md`

### `integrations/` (3 files)

- `LICENSE`
- `README.md`
- `upstream.json`

### `integrations/bridge-core/` (1 files)

- `package.json`

### `integrations/bridge-core/src/` (1 files)

- `lib.mjs` — `ThreadStore`, `envFirst`, `parseList`, `parseBool`, `parseEnvText`, `cleanEnvValue`, `isPlaceholderValue`, `parseTextContent`, `stripGroupPrefix`, `parseCommand`, `parseApprovalDecisionArgs`, `commandAction`

### `integrations/bridge-core/test/` (1 files)

- `lib.test.mjs`

### `integrations/feishu-bridge/` (3 files)

- `README.md`
- `package-lock.json`
- `package.json`

### `integrations/feishu-bridge/scripts/` (1 files)

- `validate-config.mjs`

### `integrations/feishu-bridge/src/` (2 files)

- `index.mjs`
- `lib.mjs` — `parseTextContent`, `incomingIdentity`, `isAllowed`, `pairingRefusalText`, `stripGroupPrefix`, `commandAction`, `preservedChatStateFields`, `validateBridgeConfig`, `formatValidationReport`, `helpText`

### `integrations/feishu-bridge/test/` (2 files)

- `lib.test.mjs`
- `startup-order.test.mjs`

### `integrations/telegram-bridge/` (3 files)

- `README.md`
- `package-lock.json`
- `package.json`

### `integrations/telegram-bridge/scripts/` (1 files)

- `validate-config.mjs`

### `integrations/telegram-bridge/src/` (2 files)

- `index.mjs`
- `lib.mjs` — `telegramIdentity`, `isGroupChat`, `isAllowed`, `pairingRefusalText`, `stripGroupPrefix`, `parseCommand`, `commandAction`, `controlKeyboard`, `activeTurnKeyboard`, `approvalKeyboard`, `threadListKeyboard`, `callbackAction`

### `integrations/telegram-bridge/test/` (3 files)

- `dispatch-concurrency.test.mjs`
- `lib.test.mjs`
- `startup-order.test.mjs`

### `integrations/webhook-bridge/` (2 files)

- `README.md`
- `package.json`

### `integrations/webhook-bridge/src/` (2 files)

- `index.mjs`
- `lib.mjs` — `parseEvent`, `configFromEnv`, `Inbox`, `dispatch`

### `integrations/webhook-bridge/test/` (1 files)

- `bridge.test.mjs`

### `integrations/wecom-bridge/` (4 files)

- `DEPLOYMENT.md`
- `README.md`
- `package-lock.json`
- `package.json`

### `integrations/wecom-bridge/src/` (2 files)

- `index.mjs`
- `lib.mjs` — `requiredEnv`, `parseTextContent`, `incomingIdentity`, `isAllowed`, `pairingRefusalText`, `stripGroupPrefix`, `isApprovalResponse`, `isDenyResponse`, `commandAction`, `helpText`, `ThreadStore`, `validateBridgeConfig`

### `integrations/wecom-bridge/test/` (1 files)

- `lib.test.mjs`

### `integrations/weixin-bridge/` (2 files)

- `README.md`
- `package.json`

### `integrations/weixin-bridge/src/` (2 files)

- `index.mjs`
- `lib.mjs` — `randomUin`, `MessageItemType`, `extractText`, `helpText`, `ILinkLoginBase`, `apiPost`, `apiGet`, `getLoginQR`, `waitForLogin`, `getUpdates`, `sendMessage`, `sendTyping`

### `integrations/weixin-bridge/test/` (1 files)

- `lib.test.mjs`

### `plugins/cloudflare-docs/` (2 files)

- `mcp.json`
- `plugin.json`

### `plugins/cloudflare-docs/skills/cloudflare-docs/` (1 files)

- `SKILL.md`

### `plugins/computer-use/` (7 files)

- `LICENSE`
- `README.md`
- `agent.mjs`
- `kimi.plugin.json`
- `mcp.json`
- `package.json`
- `plugin.json`

### `plugins/computer-use/app/` (1 files)

- `daemon.mjs`

### `plugins/computer-use/app/macos/` (1 files)

- `launcher.c`

### `plugins/computer-use/assets/` (1 files)

- `icon-source.png`

### `plugins/computer-use/assets/macos/` (1 files)

- `codewhale-cu`

### `plugins/computer-use/commands/` (1 files)

- `computer.md`

### `plugins/computer-use/docs/` (5 files)

- `LIMITATIONS.md`
- `PARITY.md`
- `PARITY_MATRIX.md`
- `PORTING.md`
- `RELEASE_CHECKLIST.md`

### `plugins/computer-use/mcp/` (1 files)

- `server.mjs`

### `plugins/computer-use/parity/` (5 files)

- `darwin-probe.m`
- `tasks.darwin.json`
- `tasks.json`
- `tasks.model-native.json`
- `thresholds.json`

### `plugins/computer-use/parity/agents/` (2 files)

- `codewhale-native.md`
- `kimi-native.md`

### `plugins/computer-use/parity/fixtures/` (3 files)

- `browser.html`
- `native-macos.m`
- `native.py` — `oracle`, `mark`, `apply`, `on_select`, `sq_center`, `down`, `move`, `up`, `open_dialog`, `new_window`, `report_selection`, `keys`

### `plugins/computer-use/parity/results/` (8 files)

- `background-input-darwin-2026-09-07.json`
- `darwin-aqua-2026-09-07-run2.json`
- `darwin-aqua-2026-09-07-run3.json`
- `darwin-aqua-2026-09-07.json`
- `linux-x11-2026-09-06.json`
- `linux-xvfb-isolated-2026-09-07.json`
- `native-text-comparison-darwin-2026-09-07.json`
- `public-browser-comparison-darwin-2026-09-07.json`

### `plugins/computer-use/scripts/` (10 files)

- `background-input.mjs`
- `build-app.mjs` — `RUNTIME_ENTRIES`, `MAC_BUNDLE`, `LINUX_DIR`, `WIN_DIR`, `macSigningIdentity`, `timestampArg`, `signMacCode`, `macLauncher`, `buildMac`, `desktopEntry`, `buildLinux`, `buildWindows`
- `build-icons.mjs` — `ICON_NAME`, `buildIcons`
- `check-receipts.mjs`
- `install-app.mjs` — `installApp`, `removeApp`
- `parity-matrix.mjs`
- `parity-run.mjs`
- `smoke.mjs`
- `verify-bundle.mjs`
- `verify-macos.mjs`

### `plugins/computer-use/scripts/lib/` (6 files)

- `desktop-darwin.mjs` — `createDesktop`
- `desktop-x11.mjs` — `createDesktop`
- `model-trials.mjs` — `modelProfile`, `qualifyModelTrials`
- `parity-oracle.mjs` — `observation`, `checkExpect`
- `png.mjs` — `decodePng`, `encodePng`, `crop`, `resize`, `roundedMask`, `pixel`
- `sh.mjs` — `sh`

### `plugins/computer-use/skills/computer-use/` (1 files)

- `SKILL.md`

### `plugins/computer-use/skills/recording/` (1 files)

- `SKILL.md`

### `plugins/computer-use/src/` (8 files)

- `app-handler.mjs` — `ALLOWED`, `releaseSessionInput`, `closeSession`, `reopenSession`, `closeAllSessions`, `handle`
- `app-socket.mjs` — `PLUGIN_ROOT`, `APP_ID`, `APP_NAME`, `APP_VERSION`, `socketPath`, `registrationPath`, `runInfoPath`, `readRegistration`, `writeRegistration`, `appRequest`, `openAppSession`, `appSessionRequest`
- `exec.mjs` — `currentSignal`, `withSignal`, `throwIfAborted`, `wait`, `run`, `runInputLease`, `runOk`, `ExecError`, `have`, `trim`, `tryJson`
- `png-size.mjs` — `pngSize`
- `registry.mjs` — `RegistryError`, `stateDir`, `load`, `save`, `list`, `get`, `active`, `switchTo`, `register`, `remove`
- `remote-runtime.mjs`
- `tools.mjs` — `TOOLS`, `TOOL_NAMES`, `READ_ONLY_TOOLS`, `REMOTE_TOOLS`, `BACKEND_METHOD`
- `transport.mjs` — `PLUGIN_ROOT`, `SESSION_ID`, `closeAppSession`, `b64`, `safeRemotePath`, `localExec`, `appExec`, `sshExec`, `installRemoteAgent`, `hdcExec`, `executorFor`, `routeFingerprint`

### `plugins/computer-use/src/backends/` (7 files)

- `darwin-accessibility.m`
- `darwin-ocr.h`
- `darwin-recording.h`
- `darwin.mjs` — `create`
- `harmonyos.mjs` — `parseBounds`, `flatten`, `create`
- `linux.mjs` — `create`
- `win32.mjs` — `create`

### `plugins/computer-use/tests/` (25 files)

- `app-targeting.test.mjs`
- `app.test.mjs`
- `backends.test.mjs`
- `check-receipts.test.mjs`
- `darwin-ocr.test.mjs`
- `darwin-recording.test.mjs`
- `darwin.test.mjs`
- `exec-transport.test.mjs`
- `harmony-route-lifecycle.test.mjs`
- `input-cancellation.test.mjs`
- `manifest.test.mjs`
- `model-trials.test.mjs`
- `parity-matrix.test.mjs`
- `platform-selectors.test.mjs`
- `registry.test.mjs`
- `server-payload-budget.test.mjs`
- `server-protocol.test.mjs`
- `server-routes.test.mjs` — `create`
- `server-targets.test.mjs`
- `server-wire-targets.test.mjs`
- `session-lifecycle.test.mjs`
- `win32-input.test.mjs`
- `win32-native-contract.test.mjs`
- `win32-targeting.test.mjs`
- `win32.test.mjs`

### `plugins/computer-use/tests/fixtures/` (6 files)

- `darwin-targeting-backend.mjs` — `create`
- `darwin-targeting.m`
- `fake-backend.mjs` — `create`
- `pyatspi.py` — `Node`, `Registry`
- `selector-backend.mjs` — `calls`, `create`
- `session-backend.mjs` — `create`

### `plugins/whalewiki/` (5 files)

- `LICENSE`
- `README.md`
- `kimi.plugin.json`
- `mcp.json`
- `plugin.json`

### `plugins/whalewiki/agents/` (1 files)

- `wiki-keeper.toml`

### `plugins/whalewiki/commands/` (1 files)

- `whalewiki.md`

### `plugins/whalewiki/docs/` (1 files)

- `DESIGN.md`

### `plugins/whalewiki/mcp/` (1 files)

- `server.mjs`

### `plugins/whalewiki/scripts/` (1 files)

- `whalewiki.mjs` — `repoRoot`, `wikiDir`, `readWikiConfig`, `normalizeContent`, `safeFile`, `readWikiFile`, `manifestPath`, `loadManifest`, `sourceRoots`, `pageVerdict`, `statusReport`, `scan`

### `plugins/whalewiki/skills/whalewiki/` (1 files)

- `SKILL.md`

### `plugins/whalewiki/tests/` (2 files)

- `engine.test.mjs` — `greet`, `x`, `Engine`, `moved`, `drift`
- `safety.test.mjs`

### `scripts/` (6 files)

- `check-cu-sync.mjs`
- `check-marketplace.mjs`
- `connections.mjs`
- `integrations.mjs`
- `package-plugin.mjs` — `ROOT`, `packagePlugin`
- `test-integrations.mjs`

### `skills/` (1 files)

- `plugin.json`

### `skills/batch/` (1 files)

- `SKILL.md`

### `skills/best-of-n/` (1 files)

- `SKILL.md`

### `skills/contributor-onboarding/` (1 files)

- `SKILL.md`

### `skills/dataviz/` (1 files)

- `SKILL.md`

### `skills/debug/` (1 files)

- `SKILL.md`

### `skills/delegate/` (1 files)

- `SKILL.md`

### `skills/dependency-update/` (1 files)

- `SKILL.md`

### `skills/document/` (1 files)

- `SKILL.md`

### `skills/documents/` (1 files)

- `SKILL.md`

### `skills/docx/` (1 files)

- `SKILL.md`

### `skills/feishu/` (1 files)

- `SKILL.md`

### `skills/fleet-manager/` (1 files)

- `SKILL.md`

### `skills/frontend-design/` (1 files)

- `SKILL.md`

### `skills/handoff/` (1 files)

- `SKILL.md`

### `skills/help/` (1 files)

- `SKILL.md`

### `skills/implement/` (1 files)

- `SKILL.md`

### `skills/interview/` (1 files)

- `SKILL.md`

### `skills/mcp-builder/` (1 files)

- `SKILL.md`

### `skills/mcp-discovery/` (1 files)

- `SKILL.md`

### `skills/pdf/` (1 files)

- `SKILL.md`

### `skills/plan/` (1 files)

- `SKILL.md`

### `skills/plugin-creator/` (1 files)

- `SKILL.md`

### `skills/pptx/` (1 files)

- `SKILL.md`

### `skills/presentations/` (1 files)

- `SKILL.md`

### `skills/release/` (1 files)

- `SKILL.md`

### `skills/research/` (1 files)

- `SKILL.md`

### `skills/review/` (1 files)

- `SKILL.md`

### `skills/security-review/` (1 files)

- `SKILL.md`

### `skills/simplify/` (1 files)

- `SKILL.md`

### `skills/skill-creator/` (1 files)

- `SKILL.md`

### `skills/skill-installer/` (1 files)

- `SKILL.md`

### `skills/spreadsheets/` (1 files)

- `SKILL.md`

### `skills/test/` (1 files)

- `SKILL.md`

### `skills/v4-best-practices/` (1 files)

- `SKILL.md`

### `skills/verify/` (1 files)

- `SKILL.md`

### `skills/webapp-testing/` (1 files)

- `SKILL.md`

### `skills/xlsx/` (1 files)

- `SKILL.md`

### `tests/` (1 files)

- `repository.test.mjs`

### `tests/browser/` (1 files)

- `viewer.spec.mjs` — `mode`

## Internal edges

- `integrations/bridge-core/test/lib.test.mjs` → `../src/lib.mjs`
- `integrations/feishu-bridge/scripts/validate-config.mjs` → `../src/lib.mjs`
- `integrations/feishu-bridge/src/index.mjs` → `./lib.mjs`, `../../bridge-core/src/lib.mjs`
- `integrations/feishu-bridge/src/lib.mjs` → `../../bridge-core/src/lib.mjs`
- `integrations/feishu-bridge/test/lib.test.mjs` → `../src/lib.mjs`
- `integrations/telegram-bridge/scripts/validate-config.mjs` → `../src/lib.mjs`
- `integrations/telegram-bridge/src/index.mjs` → `./lib.mjs`, `../../bridge-core/src/lib.mjs`
- `integrations/telegram-bridge/src/lib.mjs` → `../../bridge-core/src/lib.mjs`
- `integrations/telegram-bridge/test/lib.test.mjs` → `../src/lib.mjs`
- `integrations/webhook-bridge/src/index.mjs` → `./lib.mjs`
- `integrations/webhook-bridge/src/lib.mjs` → `../../bridge-core/src/lib.mjs`
- `integrations/webhook-bridge/test/bridge.test.mjs` → `../src/lib.mjs`
- `integrations/wecom-bridge/src/index.mjs` → `./lib.mjs`, `../../bridge-core/src/lib.mjs`
- `integrations/wecom-bridge/src/lib.mjs` → `../../bridge-core/src/lib.mjs`
- `integrations/wecom-bridge/test/lib.test.mjs` → `../src/lib.mjs`
- `integrations/weixin-bridge/src/index.mjs` → `./lib.mjs`, `../../bridge-core/src/lib.mjs`
- `integrations/weixin-bridge/src/lib.mjs` → `../../bridge-core/src/lib.mjs`
- `integrations/weixin-bridge/test/lib.test.mjs` → `../src/lib.mjs`
- `plugins/computer-use/agent.mjs` → `./src/app-handler.mjs`
- `plugins/computer-use/app/daemon.mjs` → `../src/app-handler.mjs`, `../src/app-socket.mjs`, `../src/registry.mjs`
- `plugins/computer-use/mcp/server.mjs` → `../src/registry.mjs`, `../src/transport.mjs`, `../src/tools.mjs`, `../src/exec.mjs`
- `plugins/computer-use/scripts/background-input.mjs` → `./lib/sh.mjs`
- `plugins/computer-use/scripts/build-app.mjs` → `../src/app-socket.mjs`, `./build-icons.mjs`
- `plugins/computer-use/scripts/build-icons.mjs` → `./lib/png.mjs`
- `plugins/computer-use/scripts/install-app.mjs` → `../src/app-socket.mjs`, `./build-app.mjs`
- `plugins/computer-use/scripts/lib/desktop-darwin.mjs` → `./sh.mjs`, `../../src/app-socket.mjs`
- `plugins/computer-use/scripts/lib/desktop-x11.mjs` → `./sh.mjs`
- `plugins/computer-use/scripts/lib/model-trials.mjs` → `./parity-oracle.mjs`
- `plugins/computer-use/scripts/parity-run.mjs` → `./lib/sh.mjs`, `./lib/parity-oracle.mjs`
- `plugins/computer-use/src/app-handler.mjs` → `./remote-runtime.mjs`, `./exec.mjs`
- `plugins/computer-use/src/app-socket.mjs` → `./registry.mjs`, `./exec.mjs`
- `plugins/computer-use/src/backends/darwin.mjs` → `../exec.mjs`
- `plugins/computer-use/src/backends/harmonyos.mjs` → `../exec.mjs`
- `plugins/computer-use/src/backends/linux.mjs` → `../exec.mjs`, `../png-size.mjs`
- `plugins/computer-use/src/backends/win32.mjs` → `../exec.mjs`
- `plugins/computer-use/src/remote-runtime.mjs` → `./exec.mjs`
- `plugins/computer-use/src/transport.mjs` → `./exec.mjs`, `./app-socket.mjs`
- `plugins/computer-use/tests/app-targeting.test.mjs` → `../src/app-handler.mjs`
- `plugins/computer-use/tests/backends.test.mjs` → `../src/backends/harmonyos.mjs`
- `plugins/computer-use/tests/darwin-ocr.test.mjs` → `../src/backends/darwin.mjs`
- `plugins/computer-use/tests/darwin-recording.test.mjs` → `../src/backends/darwin.mjs`, `../src/exec.mjs`
- `plugins/computer-use/tests/darwin.test.mjs` → `../src/backends/darwin.mjs`, `../src/exec.mjs`
- `plugins/computer-use/tests/exec-transport.test.mjs` → `../src/exec.mjs`, `../src/transport.mjs`
- `plugins/computer-use/tests/fixtures/darwin-targeting-backend.mjs` → `../../src/exec.mjs`, `../../src/backends/darwin.mjs`
- `plugins/computer-use/tests/fixtures/selector-backend.mjs` → `../../src/backends/linux.mjs`, `../../src/backends/harmonyos.mjs`
- `plugins/computer-use/tests/fixtures/session-backend.mjs` → `../../src/exec.mjs`
- `plugins/computer-use/tests/harmony-route-lifecycle.test.mjs` → `../src/backends/harmonyos.mjs`, `../src/exec.mjs`
- `plugins/computer-use/tests/input-cancellation.test.mjs` → `../src/backends/win32.mjs`, `../src/backends/linux.mjs`, `../src/exec.mjs`
- `plugins/computer-use/tests/model-trials.test.mjs` → `../scripts/lib/model-trials.mjs`, `../scripts/lib/parity-oracle.mjs`
- `plugins/computer-use/tests/platform-selectors.test.mjs` → `../src/app-handler.mjs`, `../src/backends/linux.mjs`, `./fixtures/selector-backend.mjs`
- `plugins/computer-use/tests/server-routes.test.mjs` → `../src/transport.mjs`, `./src/registry.mjs`
- `plugins/computer-use/tests/win32-input.test.mjs` → `../src/backends/win32.mjs`, `../src/exec.mjs`
- `plugins/computer-use/tests/win32-native-contract.test.mjs` → `../src/backends/win32.mjs`
- `plugins/computer-use/tests/win32-targeting.test.mjs` → `../src/backends/win32.mjs`
- `plugins/whalewiki/mcp/server.mjs` → `../scripts/whalewiki.mjs`
- `plugins/whalewiki/tests/engine.test.mjs` → `../index`, `../index`
- `plugins/whalewiki/tests/safety.test.mjs` → `../scripts/whalewiki.mjs`
- `tests/browser/viewer.spec.mjs` → `../../plugins/whalewiki/scripts/whalewiki.mjs`
- `tests/repository.test.mjs` → `../scripts/package-plugin.mjs`
