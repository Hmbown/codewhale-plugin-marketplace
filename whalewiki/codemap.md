# Codemap

_326 files. Regenerate with `whalewiki map` — deterministic, no model._

## Languages

- `.mjs` — 129
- `.md` — 99
- `.json` — 51
- `.png` — 11
- `(none)` — 8
- `.m` — 6
- `.svg` — 4
- `.yml` — 3
- `.h` — 3
- `.sh` — 3
- `.py` — 2
- `.ps1` — 2
- `.c` — 1
- `.plist` — 1
- `.gif` — 1
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

### `docs/` (5 files)

- `CONNECTIONS.md`
- `MARKETPLACE-REVIEW-20260919.md`
- `REVIEW-BOT.md`
- `SECURITY-20260911.md`
- `VALIDATION-20260911.md`

### `integrations/` (3 files)

- `LICENSE`
- `README.md`
- `upstream.json`

### `integrations/bridge-core/` (1 files)

- `package.json`

### `integrations/bridge-core/src/` (1 files)

- `lib.mjs` — `ThreadStore`, `envFirst`, `parseList`, `parseBool`, `parseEnvText`, `cleanEnvValue`, `isPlaceholderValue`, `parseTextContent`, `stripGroupPrefix`, `parseCommand`, `parseApprovalDecisionArgs`, `commandAction`

### `integrations/bridge-core/test/` (2 files)

- `lib.test.mjs`
- `recovery-policy.test.mjs`

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

### `plugins/cloudflare-docs/` (4 files)

- `LICENSE`
- `README.md`
- `mcp.json`
- `plugin.json`

### `plugins/cloudflare-docs/skills/cloudflare-docs/` (1 files)

- `SKILL.md`

### `plugins/computer-use/` (11 files)

- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `LICENSE`
- `README.md`
- `SECURITY.md`
- `agent.mjs`
- `kimi.plugin.json`
- `mcp.json`
- `package-lock.json`
- `package.json`
- `plugin.json`

### `plugins/computer-use/.github/workflows/` (1 files)

- `verify.yml`

### `plugins/computer-use/app/` (5 files)

- `background-check.mjs` — `runBackgroundCheck`
- `daemon.mjs`
- `install-macos.mjs` — `replaceMacBundle`, `verifySignature`, `verifyReleaseBundle`
- `node-lock.json`
- `updates.mjs` — `readUpdateResult`, `newerVersion`, `releaseUpdate`, `checkForUpdate`, `validateReleaseZip`, `prepareUpdate`, `restartWithUpdate`

### `plugins/computer-use/app/macos/` (4 files)

- `control-panel.h`
- `launcher.c`
- `node-entitlements.plist`
- `practice.m`

### `plugins/computer-use/assets/` (12 files)

- `README.md`
- `icon-dark-256.png`
- `icon-dark-32.png`
- `icon-dark-64.png`
- `icon-dark.svg`
- `icon-light-256.png`
- `icon-light-32.png`
- `icon-light-64.png`
- `icon-light.svg`
- `icon-menubar.png`
- `icon-mono.svg`
- `icon-source.png`

### `plugins/computer-use/assets/macos/` (4 files)

- `codewhale-cu`
- `dmg-background.png`
- `dmg-background.svg`
- `dmg-background@2x.png`

### `plugins/computer-use/commands/` (1 files)

- `computer.md`

### `plugins/computer-use/docker/` (5 files)

- `Dockerfile`
- `README.md`
- `agent-exec.sh`
- `entrypoint.sh`
- `run.sh`

### `plugins/computer-use/docs/` (10 files)

- `BACKGROUND-20260912.md`
- `DEMO.md`
- `DISTRIBUTION.md`
- `LIMITATIONS.md`
- `PARITY.md`
- `PARITY_MATRIX.md`
- `PORTING.md`
- `PUBLICATION_REVIEW.md`
- `RELEASE_CHECKLIST.md`
- `TROUBLESHOOTING.md`

### `plugins/computer-use/docs/media/` (1 files)

- `background-check.gif`

### `plugins/computer-use/docs/releases/` (5 files)

- `0.3.0.json`
- `0.3.1.json`
- `0.4.0.json`
- `0.5.0.json`
- `0.6.0.json`

### `plugins/computer-use/integrations/dsh/` (3 files)

- `README.md`
- `cordis.patch.yml`
- `package.json`

### `plugins/computer-use/mcp/` (1 files)

- `server.mjs`

### `plugins/computer-use/parity/` (7 files)

- `darwin-probe.m`
- `tasks.darwin.json`
- `tasks.json`
- `tasks.model-native.json`
- `tasks.win32.json`
- `thresholds.json`
- `win32-probe.ps1`

### `plugins/computer-use/parity/agents/` (2 files)

- `codewhale-native.md`
- `kimi-native.md`

### `plugins/computer-use/parity/fixtures/` (4 files)

- `activate-macos.m`
- `browser.html`
- `native-macos.m`
- `native.py` — `oracle`, `mark`, `apply`, `on_select`, `sq_center`, `down`, `move`, `up`, `open_dialog`, `new_window`, `report_selection`, `keys`

### `plugins/computer-use/parity/results/` (12 files)

- `background-control-darwin-2026-09-12.json`
- `background-input-darwin-2026-09-07.json`
- `darwin-aqua-2026-09-07-run2.json`
- `darwin-aqua-2026-09-07-run3.json`
- `darwin-aqua-2026-09-07.json`
- `darwin-aqua-2026-09-15.json`
- `improvement-log.md`
- `linux-x11-2026-09-06.json`
- `linux-xvfb-isolated-2026-09-07.json`
- `linux-xvfb-isolated-2026-09-16.json`
- `native-text-comparison-darwin-2026-09-07.json`
- `public-browser-comparison-darwin-2026-09-07.json`

### `plugins/computer-use/scripts/` (16 files)

- `background-input.mjs`
- `build-app.mjs` — `RUNTIME_ENTRIES`, `MAC_BUNDLE`, `LINUX_DIR`, `WIN_DIR`, `macSigningIdentity`, `timestampArg`, `signMacCode`, `macLauncher`, `buildMac`, `desktopEntry`, `buildLinux`, `buildWindows`
- `build-icons.mjs` — `ICON_NAME`, `buildIcons`
- `check-receipts.mjs`
- `demo.mjs`
- `install-app.mjs` — `installApp`, `removeApp`
- `package-dmg.mjs`
- `package-macos.mjs`
- `parity-matrix.mjs`
- `parity-run.mjs`
- `prepare-node-runtime.mjs` — `verifyNodeArchive`, `nodeTarget`, `prepareNodeRuntime`
- `render-branding.mjs`
- `smoke.mjs`
- `verify-background-macos.mjs`
- `verify-bundle.mjs`
- `verify-macos.mjs`

### `plugins/computer-use/scripts/lib/` (7 files)

- `desktop-darwin.mjs` — `createDesktop`
- `desktop-win32.mjs` — `createDesktop`
- `desktop-x11.mjs` — `createDesktop`
- `model-trials.mjs` — `modelProfile`, `qualifyModelTrials`
- `parity-oracle.mjs` — `observation`, `checkExpect`
- `png.mjs` — `decodePng`, `encodePng`, `crop`, `resize`, `roundedMask`, `pixel`
- `sh.mjs` — `sh`

### `plugins/computer-use/skills/computer-use/` (1 files)

- `SKILL.md`

### `plugins/computer-use/skills/computer-use/references/` (2 files)

- `quick-reference.md`
- `refusal-codes.md`

### `plugins/computer-use/skills/recording/` (1 files)

- `SKILL.md`

### `plugins/computer-use/src/` (12 files)

- `app-handler.mjs` — `ALLOWED`, `controlStatus`, `setControlMode`, `releaseSessionInput`, `closeSession`, `reopenSession`, `closeAllSessions`, `summarizeSessions`, `handle`
- `app-socket.mjs` — `PLUGIN_ROOT`, `APP_ID`, `APP_NAME`, `APP_VERSION`, `socketPath`, `registrationPath`, `runInfoPath`, `readRegistration`, `writeRegistration`, `appRequest`, `openAppSession`, `appSessionRequest`
- `browser-cdp.mjs` — `checkBrowserUrl`, `findBrowserApp`, `createBrowser`
- `consent.mjs` — `appKeys`, `parseAppArg`, `decisionFor`, `record`, `alias`, `revoke`, `foregroundDecision`, `recordForeground`, `revokeForeground`, `status`, `dropSession`
- `exec.mjs` — `currentSignal`, `withSignal`, `throwIfAborted`, `wait`, `run`, `runInputLease`, `runOk`, `ExecError`, `have`, `trim`, `tryJson`
- `png-size.mjs` — `pngSize`
- `registry.mjs` — `RegistryError`, `stateDir`, `load`, `save`, `list`, `get`, `active`, `switchTo`, `register`, `remove`
- `remote-runtime.mjs`
- `spawn.mjs` — `SPAWN_LABEL`, `SESSION_LABEL`, `COMPUTER_LABEL`, `DEFAULT_IMAGE`, `dockerAvailable`, `spawnDockerComputer`, `destroyDockerComputer`, `destroySessionSpawns`
- `tools.mjs` — `TOOLS`, `TOOL_NAMES`, `REQUIRED_ARGS`, `ELEMENT_ONLY_TARGET`, `READ_ONLY_TOOLS`, `REMOTE_TOOLS`, `BACKEND_METHOD`, `MERGED_EXPANSION`, `parseGrant`, `OBSERVATION_TOOLS`, `resolveTool`
- `trajectory.mjs` — `trajectoriesDir`, `isTrajectoryTool`, `createRecorder`, `readTrajectory`, `listTrajectories`, `resolveTrajectory`
- `transport.mjs` — `PLUGIN_ROOT`, `SESSION_ID`, `closeAppSession`, `b64`, `safeRemotePath`, `localExec`, `appExec`, `ensureSshChannel`, `closeSshChannel`, `channelRequest`, `sshExec`, `dockerExec`

### `plugins/computer-use/src/backends/` (7 files)

- `darwin-accessibility.m`
- `darwin-ocr.h`
- `darwin-recording.h`
- `darwin.mjs` — `nativeErrorCode`, `pickMenuElement`, `selectApps`, `leaseVerdict`, `leaseAccounting`, `create`
- `harmonyos.mjs` — `parseBounds`, `flatten`, `create`
- `linux.mjs` — `create`
- `win32.mjs` — `create`

### `plugins/computer-use/tests/` (40 files)

- `app-controls.test.mjs`
- `app-script.test.mjs`
- `app-shutdown.test.mjs` — `create`
- `app-targeting.test.mjs`
- `app.test.mjs`
- `backends.test.mjs`
- `browser-cdp.test.mjs`
- `check-receipts.test.mjs`
- `consent.test.mjs`
- `darwin-ocr.test.mjs`
- `darwin-recording.test.mjs`
- `darwin.test.mjs`
- `exec-transport.test.mjs`
- `grants.test.mjs`
- `harmony-route-lifecycle.test.mjs`
- `input-cancellation.test.mjs`
- `manifest.test.mjs`
- `mcp-skills.test.mjs`
- `model-trials.test.mjs`
- `parity-matrix.test.mjs`
- `platform-selectors.test.mjs`
- `registry.test.mjs`
- `security-input.test.mjs`
- `server-payload-budget.test.mjs`
- `server-protocol.test.mjs`
- `server-routes.test.mjs` — `create`
- `server-targets.test.mjs`
- `server-wire-targets.test.mjs`
- `session-lifecycle.test.mjs`
- `spawn.test.mjs`
- … 10 more

### `plugins/computer-use/tests/fixtures/` (8 files)

- `command-shims.mjs`
- `darwin-targeting-backend.mjs` — `create`
- `darwin-targeting.m`
- `fake-backend.mjs` — `create`
- `pyatspi.py` — `Node`, `Registry`
- `selector-backend.mjs` — `calls`, `create`
- `session-backend.mjs` — `create`
- `windows-desktop.ps1`

### `plugins/whalesong/` (4 files)

- `LICENSE`
- `README.md`
- `mcp.json`
- `plugin.json`

### `plugins/whalesong/mcp/` (1 files)

- `server.mjs`

### `plugins/whalesong/skills/whalesong-analyze/` (1 files)

- `SKILL.md`

### `plugins/whalesong/skills/whalesong-annotate/` (1 files)

- `SKILL.md`

### `plugins/whalesong/skills/whalesong-listen/` (1 files)

- `SKILL.md`

### `plugins/whalesong/skills/whalesong-rhythm/` (1 files)

- `SKILL.md`

### `plugins/whalesong/skills/whalesong-triage/` (1 files)

- `SKILL.md`

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

### `plugins/whalewiki/tests/` (3 files)

- `engine.test.mjs` — `greet`, `x`, `Engine`, `moved`, `drift`
- `safety.test.mjs`
- `write-boundaries.test.mjs` — `x`

### `scripts/` (7 files)

- `check-cu-sync.mjs`
- `check-marketplace.mjs`
- `connections.mjs`
- `integrations.mjs`
- `package-plugin.mjs` — `ROOT`, `packagePlugin`
- `skills.mjs`
- `test-integrations.mjs`

### `skills/` (4 files)

- `LICENSE`
- `README.md`
- `plugin.json`
- `upstream.json`

### `skills/batch/` (1 files)

- `SKILL.md`

### `skills/best-of-n/` (1 files)

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

### `skills/fleet-manager/` (1 files)

- `SKILL.md`

### `skills/flights/` (1 files)

- `SKILL.md`

### `skills/forget/` (1 files)

- `SKILL.md`

### `skills/frontend-design/` (1 files)

- `SKILL.md`

### `skills/github/` (1 files)

- `SKILL.md`

### `skills/gmail/` (1 files)

- `SKILL.md`

### `skills/goals/` (1 files)

- `SKILL.md`

### `skills/google-calendar/` (1 files)

- `SKILL.md`

### `skills/handoff/` (1 files)

- `SKILL.md`

### `skills/help/` (1 files)

- `SKILL.md`

### `skills/image-search/` (1 files)

- `SKILL.md`

### `skills/implement/` (1 files)

- `SKILL.md`

### `skills/interview/` (1 files)

- `SKILL.md`

### `skills/mcp-builder/` (1 files)

- `SKILL.md`

### `skills/mcp-discovery/` (1 files)

- `SKILL.md`

### `skills/money/` (1 files)

- `SKILL.md`

### `skills/pdf/` (1 files)

- `SKILL.md`

### `skills/photos/` (1 files)

- `SKILL.md`

### `skills/plan/` (1 files)

- `SKILL.md`

### `skills/plugin-creator/` (1 files)

- `SKILL.md`

### `skills/podcast/` (1 files)

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

### `skills/shopping/` (1 files)

- `SKILL.md`

### `skills/simplify/` (1 files)

- `SKILL.md`

### `skills/skill-creator/` (1 files)

- `SKILL.md`

### `skills/skill-installer/` (1 files)

- `SKILL.md`

### `skills/spotify/` (1 files)

- `SKILL.md`

### `skills/spreadsheets/` (1 files)

- `SKILL.md`

### `skills/test/` (1 files)

- `SKILL.md`

### `skills/tts/` (1 files)

- `SKILL.md`

### `skills/verify/` (1 files)

- `SKILL.md`

### `skills/webapp-testing/` (1 files)

- `SKILL.md`

### `skills/xlsx/` (1 files)

- `SKILL.md`

### `tests/` (1 files)

- `repository.test.mjs` — `value`

### `tests/browser/` (1 files)

- `viewer.spec.mjs` — `mode`

## Internal edges

- `integrations/bridge-core/test/lib.test.mjs` → `../src/lib.mjs`
- `integrations/bridge-core/test/recovery-policy.test.mjs` → `../src/lib.mjs`
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
- `plugins/computer-use/app/background-check.mjs` → `../src/app-handler.mjs`
- `plugins/computer-use/app/daemon.mjs` → `../src/app-handler.mjs`, `./background-check.mjs`, `./updates.mjs`, `../src/app-socket.mjs`, `../src/registry.mjs`
- `plugins/computer-use/app/updates.mjs` → `./install-macos.mjs`, `../src/app-socket.mjs`, `../src/registry.mjs`
- `plugins/computer-use/mcp/server.mjs` → `../src/registry.mjs`, `../src/consent.mjs`, `../src/transport.mjs`, `../src/spawn.mjs`, `../src/tools.mjs`, `../src/exec.mjs`, `../src/app-socket.mjs`, `../src/trajectory.mjs`
- `plugins/computer-use/scripts/background-input.mjs` → `./lib/sh.mjs`
- `plugins/computer-use/scripts/build-app.mjs` → `../src/app-socket.mjs`, `./build-icons.mjs`
- `plugins/computer-use/scripts/build-icons.mjs` → `./lib/png.mjs`
- `plugins/computer-use/scripts/demo.mjs` → `../app/background-check.mjs`
- `plugins/computer-use/scripts/install-app.mjs` → `../src/app-socket.mjs`, `./build-app.mjs`, `../app/install-macos.mjs`
- `plugins/computer-use/scripts/lib/desktop-darwin.mjs` → `./sh.mjs`, `../../src/app-socket.mjs`
- `plugins/computer-use/scripts/lib/desktop-win32.mjs` → `./sh.mjs`
- `plugins/computer-use/scripts/lib/desktop-x11.mjs` → `./sh.mjs`
- `plugins/computer-use/scripts/lib/model-trials.mjs` → `./parity-oracle.mjs`
- `plugins/computer-use/scripts/package-dmg.mjs` → `../src/app-socket.mjs`, `../app/install-macos.mjs`, `./build-app.mjs`
- `plugins/computer-use/scripts/package-macos.mjs` → `../src/app-socket.mjs`, `../app/install-macos.mjs`, `../app/updates.mjs`
- `plugins/computer-use/scripts/parity-run.mjs` → `./lib/sh.mjs`, `./lib/parity-oracle.mjs`
- `plugins/computer-use/src/app-handler.mjs` → `./remote-runtime.mjs`, `./exec.mjs`
- `plugins/computer-use/src/app-socket.mjs` → `./registry.mjs`, `./tools.mjs`, `./exec.mjs`
- `plugins/computer-use/src/backends/darwin.mjs` → `../exec.mjs`, `../registry.mjs`, `../browser-cdp.mjs`
- `plugins/computer-use/src/backends/harmonyos.mjs` → `../exec.mjs`
- `plugins/computer-use/src/backends/linux.mjs` → `../exec.mjs`, `../png-size.mjs`, `../browser-cdp.mjs`
- `plugins/computer-use/src/backends/win32.mjs` → `../exec.mjs`, `../browser-cdp.mjs`
- `plugins/computer-use/src/browser-cdp.mjs` → `./exec.mjs`, `./registry.mjs`
- `plugins/computer-use/src/consent.mjs` → `./registry.mjs`
- `plugins/computer-use/src/remote-runtime.mjs` → `./exec.mjs`
- `plugins/computer-use/src/spawn.mjs` → `./exec.mjs`, `./transport.mjs`
- `plugins/computer-use/src/trajectory.mjs` → `./registry.mjs`
- `plugins/computer-use/src/transport.mjs` → `./exec.mjs`, `./app-socket.mjs`
- `plugins/computer-use/tests/app-controls.test.mjs` → `../src/app-socket.mjs`
- `plugins/computer-use/tests/app-script.test.mjs` → `../src/app-handler.mjs`
- `plugins/computer-use/tests/app-shutdown.test.mjs` → `../src/app-socket.mjs`
- `plugins/computer-use/tests/app-targeting.test.mjs` → `../src/app-handler.mjs`
- `plugins/computer-use/tests/backends.test.mjs` → `../src/backends/harmonyos.mjs`
- `plugins/computer-use/tests/browser-cdp.test.mjs` → `../src/browser-cdp.mjs`
- `plugins/computer-use/tests/consent.test.mjs` → `../src/consent.mjs`, `../src/spawn.mjs`
- `plugins/computer-use/tests/darwin-ocr.test.mjs` → `../src/backends/darwin.mjs`
- `plugins/computer-use/tests/darwin-recording.test.mjs` → `../src/backends/darwin.mjs`, `../src/exec.mjs`
- `plugins/computer-use/tests/darwin.test.mjs` → `../src/backends/darwin.mjs`, `../src/exec.mjs`
- `plugins/computer-use/tests/exec-transport.test.mjs` → `../src/exec.mjs`, `../src/transport.mjs`, `../src/app-socket.mjs`
- `plugins/computer-use/tests/fixtures/darwin-targeting-backend.mjs` → `../../src/exec.mjs`, `../../src/backends/darwin.mjs`
- `plugins/computer-use/tests/fixtures/selector-backend.mjs` → `../../src/backends/linux.mjs`, `../../src/backends/harmonyos.mjs`
- `plugins/computer-use/tests/fixtures/session-backend.mjs` → `../../src/exec.mjs`
- `plugins/computer-use/tests/harmony-route-lifecycle.test.mjs` → `../src/backends/harmonyos.mjs`, `../src/exec.mjs`
- `plugins/computer-use/tests/input-cancellation.test.mjs` → `../src/backends/win32.mjs`, `../src/backends/linux.mjs`, `../src/exec.mjs`
- `plugins/computer-use/tests/mcp-skills.test.mjs` → `../src/tools.mjs`, `../src/backends/darwin.mjs`
- `plugins/computer-use/tests/model-trials.test.mjs` → `../scripts/lib/model-trials.mjs`, `../scripts/lib/parity-oracle.mjs`
- `plugins/computer-use/tests/platform-selectors.test.mjs` → `../src/app-handler.mjs`, `../src/backends/linux.mjs`, `./fixtures/selector-backend.mjs`
- `plugins/computer-use/tests/security-input.test.mjs` → `../src/backends/win32.mjs`, `../src/backends/harmonyos.mjs`, `../src/backends/linux.mjs`
- `plugins/computer-use/tests/server-routes.test.mjs` → `../src/transport.mjs`, `./src/registry.mjs`
- `plugins/computer-use/tests/tool-merge.test.mjs` → `../src/tools.mjs`
- `plugins/computer-use/tests/updates.test.mjs` → `../app/updates.mjs`, `../app/install-macos.mjs`
- `plugins/computer-use/tests/wait-for.test.mjs` → `../src/transport.mjs`
- `plugins/computer-use/tests/win32-desktop.test.mjs` → `../src/backends/win32.mjs`
- `plugins/computer-use/tests/win32-input.test.mjs` → `../src/backends/win32.mjs`, `../src/exec.mjs`
- `plugins/computer-use/tests/win32-native-contract.test.mjs` → `../src/backends/win32.mjs`
- `plugins/computer-use/tests/win32-package.test.mjs` → `../scripts/build-app.mjs`
- `plugins/computer-use/tests/win32-targeting.test.mjs` → `../src/backends/win32.mjs`
- `plugins/whalewiki/mcp/server.mjs` → `../scripts/whalewiki.mjs`
- `plugins/whalewiki/tests/engine.test.mjs` → `../index`, `../index`
- `plugins/whalewiki/tests/safety.test.mjs` → `../scripts/whalewiki.mjs`
- `tests/browser/viewer.spec.mjs` → `../../plugins/whalewiki/scripts/whalewiki.mjs`
- `tests/repository.test.mjs` → `../scripts/package-plugin.mjs`
