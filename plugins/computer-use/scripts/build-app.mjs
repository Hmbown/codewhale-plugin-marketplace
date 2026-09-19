#!/usr/bin/env node
// Build the desktop app bundles that give the plugin an OS identity of its own:
//
//   dist/macos/Codewhale Computer Use.app       .app bundle (Info.plist, AppIcon.icns, sh launcher)
//   dist/linux/codewhale-computer-use/          launcher + .desktop + hicolor icons
//   dist/windows/Codewhale Computer Use/        hidden PowerShell launcher + icon.ico
//
// Every bundle carries a complete runtime copy of the plugin under `plugin/`
// (Contents/Resources/plugin on macOS), so a host can also point its MCP
// config at that stable path. The launchers start app/daemon.mjs with
// CODEWHALE_CU_APP_BUNDLE set, which is what makes the daemon register itself.
//
// Zero dependencies; runs on any OS and builds every layout. Icon artifacts
// are regenerated on demand from the committed assets/icon-source.png — they
// are gitignored, not committed, so an installed or freshly cloned bundle
// stays under host install size caps.
//
// Usage: node scripts/build-app.mjs [--out <dir>] [--platform macos|linux|windows|all] [--rebuild-launcher]
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";
import { APP_ID, APP_NAME, APP_VERSION } from "../src/app-socket.mjs";
import { ICON_NAME, buildIcons } from "./build-icons.mjs";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
export const RUNTIME_ENTRIES = ["plugin.json", "mcp.json", "package.json", "package-lock.json", ".dockerignore", "LICENSE", "agent.mjs", "app", "mcp", "src", "commands", "skills", "docker"];
export const MAC_BUNDLE = `${APP_NAME}.app`;
export const LINUX_DIR = "codewhale-computer-use";
export const WIN_DIR = APP_NAME;

/**
 * Pick the macOS signing identity. TCC grants (Accessibility, Screen
 * Recording) are keyed to the code's designated requirement — team + bundle
 * id — so an app signed with a real identity keeps its grants across
 * updates. Ad-hoc ("-") re-hashes on every build and loses them, so it is a
 * last resort for machines with no signing certificate.
 *
 * Order: CODEWHALE_CU_SIGN_IDENTITY env (use "-" to force ad-hoc), then a
 * "Developer ID Application" certificate from the keychain (stable, valid
 * outside this machine, notarization-ready), then "Apple Development"
 * (stable on this team's machines), then ad-hoc.
 */
export function macSigningIdentity(bundle) {
  if (process.env.CODEWHALE_CU_SIGN_IDENTITY) return process.env.CODEWHALE_CU_SIGN_IDENTITY;
  if (process.platform === "darwin") {
    const r = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
    const names = [...(r.stdout ?? "").matchAll(/^\s*\d+\) ([0-9A-F]+) "(.+)"$/gm)].map((m) => m[2]);
    const named = names.find((n) => n.startsWith("Developer ID Application:"))
      ?? names.find((n) => n.startsWith("Apple Development:"));
    if (named) return named;
  }
  if (bundle) {
    const r = spawnSync("codesign", ["--display", "--verbose=2", bundle], { encoding: "utf8" });
    const authority = r.stderr?.match(/^Authority=(Developer ID Application: .+)$/m)?.[1];
    if (authority) return authority;
  }
  return "-";
}

/** Secure timestamps are required for notarization but are meaningless for ad-hoc. */
export function timestampArg(identity) {
  return identity === "-" ? "--timestamp=none" : "--timestamp";
}

/** Sign native code inside-out, with the hardened runtime required by Apple. */
export function signMacCode(target, identity, { entitlements } = {}) {
  const signed = spawnSync("codesign", ["--force", "--options", "runtime", timestampArg(identity), ...(entitlements ? ["--entitlements", entitlements] : []), "--sign", identity, target], { encoding: "utf8" });
  if (signed.status !== 0) throw new Error(`codesign failed for ${target}: ${signed.stderr}`);
  const verified = spawnSync("codesign", ["--verify", "--strict", target], { encoding: "utf8" });
  if (verified.status !== 0) throw new Error(`invalid signature for ${target}: ${verified.stderr}`);
}

function xml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

function copyRuntime(dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of RUNTIME_ENTRIES) {
    const src = path.join(ROOT, entry);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, path.join(dest, entry), { recursive: true, filter: (p) => !/node_modules|\.DS_Store/.test(p) });
  }
}

function writeExec(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

// ---------- macOS ----------
// The bundle executable must be a real Mach-O that stays alive as the app's
// process (see app/macos/launcher.c). It is compiled here when clang is
// available and otherwise taken from the committed prebuilt copy.
const LAUNCHER_SRC = path.join(ROOT, "app", "macos", "launcher.c");
const LAUNCHER_PREBUILT = path.join(ROOT, "assets", "macos", "codewhale-cu");

// Compile current source on macOS. Ad-hoc signatures can require a permission
// regrant after updates; a configured Developer ID preserves the app identity.
export function macLauncher({ rebuild = false, output = LAUNCHER_PREBUILT } = {}) {
  const canCompile = process.platform === "darwin" && spawnSync("xcrun", ["--find", "clang"], { stdio: "ignore" }).status === 0;
  if (canCompile) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const r = spawnSync("clang", ["-x", "objective-c", "-framework", "Cocoa", "-Os", "-Wall", "-arch", "arm64", "-arch", "x86_64", "-mmacosx-version-min=13.0", "-framework", "ApplicationServices", "-framework", "ScreenCaptureKit", "-framework", "AVFoundation", "-framework", "CoreMedia", "-framework", "CoreGraphics", "-o", output, LAUNCHER_SRC], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`clang failed:\n${r.stderr}`);
    const signed = spawnSync("codesign", ["--force", "--options", "runtime", "--sign", "-", "--identifier", APP_ID, output], { encoding: "utf8" });
    if (signed.status !== 0) throw new Error(`launcher codesign failed: ${signed.stderr}`);
  }
  if (canCompile) return output;
  if (!fs.existsSync(LAUNCHER_PREBUILT)) throw new Error(`no macOS launcher binary at ${LAUNCHER_PREBUILT} and clang is unavailable to build it`);
  return LAUNCHER_PREBUILT;
}

function infoPlist({ nodeRuntime } = {}) {
  const kv = [
    ["CFBundleDevelopmentRegion", "en"],
    ["CFBundleDisplayName", APP_NAME],
    ["CFBundleExecutable", "codewhale-cu"],
    ["CFBundleIconFile", "AppIcon"],
    ["CFBundleIdentifier", APP_ID],
    ["CFBundleInfoDictionaryVersion", "6.0"],
    ["CFBundleName", APP_NAME],
    ["CFBundlePackageType", "APPL"],
    ["CFBundleShortVersionString", APP_VERSION],
    ["CFBundleVersion", APP_VERSION],
    ["LSApplicationCategoryType", "public.app-category.utilities"],
    ["LSMinimumSystemVersion", nodeRuntime ? "13.5" : "13.0"],
    ["NSAppleEventsUsageDescription", `${APP_NAME} reads and drives application windows through System Events so an agent can operate this Mac.`],
    ["NSHumanReadableCopyright", "MIT License — Codewhale contributors"],
  ];
  const body = kv.map(([k, v]) => `\t<key>${xml(k)}</key>\n\t<string>${xml(v)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
\t<key>LSUIElement</key>
\t<true/>
\t<key>NSHighResolutionCapable</key>
\t<true/>
</dict>
</plist>
`;
}

export function buildMac(out, { rebuildLauncher = false, nodeRuntime } = {}) {
  const app = path.join(out, "macos", MAC_BUNDLE);
  fs.rmSync(app, { recursive: true, force: true });
  const contents = path.join(app, "Contents");
  fs.mkdirSync(path.join(contents, "Resources"), { recursive: true });
  fs.writeFileSync(path.join(contents, "Info.plist"), infoPlist({ nodeRuntime }));
  fs.writeFileSync(path.join(contents, "PkgInfo"), "APPL????");
  fs.mkdirSync(path.join(contents, "MacOS"), { recursive: true });
  const launcher = path.join(contents, "MacOS", "codewhale-cu");
  const builtLauncher = macLauncher({ rebuild: rebuildLauncher, output: launcher });
  if (builtLauncher !== launcher) fs.copyFileSync(builtLauncher, launcher);
  fs.chmodSync(path.join(contents, "MacOS", "codewhale-cu"), 0o755);
  fs.copyFileSync(path.join(ROOT, "assets", "icon.icns"), path.join(contents, "Resources", "AppIcon.icns"));
  const menuIcon = path.join(ROOT, "assets", "icon-menubar.png");
  if (fs.existsSync(menuIcon)) fs.copyFileSync(menuIcon, path.join(contents, "Resources", "MenuBarIcon.png"));
  copyRuntime(path.join(contents, "Resources", "plugin"));
  if (process.platform === "darwin") {
    const identity = macSigningIdentity();
    if (nodeRuntime) {
      const node = path.join(contents, "MacOS", "node");
      fs.copyFileSync(path.join(nodeRuntime, "node"), node);
      fs.chmodSync(node, 0o755);
      fs.copyFileSync(path.join(nodeRuntime, "LICENSE"), path.join(contents, "Resources", "Node-LICENSE"));
      fs.copyFileSync(path.join(nodeRuntime, "receipt.json"), path.join(contents, "Resources", "node-receipt.json"));
      signMacCode(node, identity, { entitlements: path.join(ROOT, "app", "macos", "node-entitlements.plist") });
      const check = spawnSync(node, ["--version"], { encoding: "utf8" });
      if (check.status !== 0 || !/^v(?:2[2-9]|[3-9]\d)\./.test(check.stdout.trim())) throw new Error("The bundled Node runtime did not start or is unsupported.");
    }
    const helper = path.join(contents, "MacOS", "accessibility");
    const compiled = spawnSync("clang", ["-fobjc-arc", "-Os", "-arch", "arm64", "-arch", "x86_64", "-mmacosx-version-min=13.0", "-framework", "Cocoa", "-framework", "ApplicationServices", "-framework", "ScreenCaptureKit", "-framework", "AVFoundation", "-framework", "CoreMedia", "-framework", "Vision", path.join(ROOT, "src", "backends", "darwin-accessibility.m"), "-o", helper], { encoding: "utf8" });
    if (compiled.status !== 0) throw new Error(`accessibility helper build failed: ${compiled.stderr}`);
    signMacCode(helper, identity);
    const practiceApp = path.join(contents, "Resources", "Practice.app");
    fs.mkdirSync(path.join(practiceApp, "Contents", "MacOS"), { recursive: true });
    fs.writeFileSync(path.join(practiceApp, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${APP_ID}.practice</string><key>CFBundleExecutable</key><string>practice</string><key>CFBundleName</key><string>Codewhale Practice</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`);
    const practice = path.join(practiceApp, "Contents", "MacOS", "practice");
    const checked = spawnSync("clang", ["-fobjc-arc", "-Os", "-arch", "arm64", "-arch", "x86_64", "-mmacosx-version-min=13.0", "-framework", "Cocoa", "-framework", "CoreGraphics", path.join(ROOT, "app", "macos", "practice.m"), "-o", practice], { encoding: "utf8" });
    if (checked.status !== 0) throw new Error(`practice window build failed: ${checked.stderr}`);
    signMacCode(practiceApp, identity);
    // Sign the complete bundle: a bare executable signature does not bind the
    // Info.plist and is rejected by TCC when evaluated as an application.
    signMacCode(app, identity);
    console.log(`macos     signing identity: ${identity === "-" ? "ad-hoc (TCC grants will not survive reinstall; set CODEWHALE_CU_SIGN_IDENTITY or install a Developer ID certificate)" : identity}`);
  }
  return app;
}

// ---------- Linux ----------
const LINUX_LAUNCHER = `#!/bin/sh
# ${APP_NAME} — launcher. Runs the app daemon from this install.
HERE="$(cd "$(dirname "$0")/.." && pwd)"
LOGDIR="\${XDG_STATE_HOME:-$HOME/.local/state}/codewhale-computer-use"
mkdir -p "$LOGDIR"
NODE=""
if [ -f "$HERE/node-path" ]; then NODE="$(cat "$HERE/node-path")"; fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then NODE="$(command -v node 2>/dev/null)"; fi
if [ -z "$NODE" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  NODE="$(ls -d "$HOME/.nvm/versions/node"/*/bin/node 2>/dev/null | sort -V | tail -n 1)"
fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  echo "$(date -u +%FT%TZ) ${APP_NAME}: Node.js 20+ not found" >> "$LOGDIR/app.log"
  command -v notify-send >/dev/null 2>&1 && notify-send "${APP_NAME}" "Node.js 20 or newer was not found."
  exit 1
fi
export CODEWHALE_CU_APP_BUNDLE="$HERE"
exec "$NODE" "$HERE/plugin/app/daemon.mjs" >> "$LOGDIR/app.log" 2>&1
`;

export function desktopEntry(execPath) {
  return `[Desktop Entry]
Type=Application
Version=1.0
Name=${APP_NAME}
Comment=See the screen and operate it for AI agents over MCP
Exec=${execPath}
Icon=${ICON_NAME}
Terminal=false
Categories=Utility;Accessibility;
Keywords=computer-use;automation;screenshot;accessibility;mcp;
StartupNotify=false
X-GNOME-Autostart-enabled=true
`;
}

export function buildLinux(out) {
  const dir = path.join(out, "linux", LINUX_DIR);
  fs.rmSync(dir, { recursive: true, force: true });
  writeExec(path.join(dir, "bin", "codewhale-computer-use"), LINUX_LAUNCHER);
  fs.mkdirSync(path.join(dir, "share", "applications"), { recursive: true });
  fs.writeFileSync(path.join(dir, "share", "applications", `${APP_ID}.desktop`), desktopEntry(path.join(dir, "bin", "codewhale-computer-use")));
  fs.cpSync(path.join(ROOT, "assets", "icons"), path.join(dir, "share", "icons"), { recursive: true });
  copyRuntime(path.join(dir, "plugin"));
  return dir;
}

// ---------- Windows ----------
const WIN_LAUNCHER = `# ${APP_NAME} — launcher. Starts the app daemon hidden.
$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $env:LOCALAPPDATA "${APP_NAME}"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Node = $null
$Pinned = Join-Path $Here "node-path"
if (Test-Path $Pinned) { $Node = (Get-Content $Pinned -Raw).Trim() }
if (-not $Node -or -not (Test-Path $Node)) {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { $Node = $cmd.Source }
}
if (-not $Node) {
  foreach ($c in @("$env:ProgramFiles\\nodejs\\node.exe", "$env:LOCALAPPDATA\\Programs\\nodejs\\node.exe", "$env:NVM_SYMLINK\\node.exe", "$env:LOCALAPPDATA\\Volta\\bin\\node.exe")) {
    if ($c -and (Test-Path $c)) { $Node = $c; break }
  }
}
if (-not $Node) {
  Add-Content -Path (Join-Path $LogDir "app.log") -Value "$(Get-Date -Format o) ${APP_NAME}: Node.js 20+ not found"
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("Node.js 20 or newer was not found. Install it from nodejs.org, then open the app again.", "${APP_NAME}") | Out-Null
  exit 1
}
$env:CODEWHALE_CU_APP_BUNDLE = $Here
$Daemon = Join-Path $Here "plugin\\app\\daemon.mjs"
Start-Process -FilePath $Node -ArgumentList @('"' + $Daemon + '"') -WindowStyle Hidden -WorkingDirectory $Here \`
  -RedirectStandardError (Join-Path $LogDir "app.log") -RedirectStandardOutput (Join-Path $LogDir "app.out.log")
`;

const WIN_CMD = `@echo off
rem ${APP_NAME} — double-click to start the app (hidden).
powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0launch.ps1"
`;

export function buildWindows(out) {
  const dir = path.join(out, "windows", WIN_DIR);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "launch.ps1"), WIN_LAUNCHER);
  fs.writeFileSync(path.join(dir, `${APP_NAME}.cmd`), WIN_CMD);
  fs.copyFileSync(path.join(ROOT, "assets", "icon.ico"), path.join(dir, "icon.ico"));
  copyRuntime(path.join(dir, "plugin"));
  return dir;
}

/** Regenerate icon artifacts when they are absent (fresh clone, installed bundle). */
export function ensureIcons() {
  const assets = path.join(ROOT, "assets");
  const required = ["icon.png", "icon-macos.png", "icon.icns", "icon.ico", path.join("icons", "hicolor")];
  if (required.every((rel) => fs.existsSync(path.join(assets, rel)))) return false;
  buildIcons({ assets });
  return true;
}

export function buildApp({ out = path.join(ROOT, "dist"), platform = "all", rebuildLauncher = false, nodeRuntime } = {}) {
  ensureIcons();
  const built = {};
  if (platform === "all" || platform === "macos") built.macos = buildMac(out, { rebuildLauncher, nodeRuntime });
  if (platform === "all" || platform === "linux") built.linux = buildLinux(out);
  if (platform === "all" || platform === "windows") built.windows = buildWindows(out);
  return built;
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
  const built = buildApp({ out: path.resolve(opt("--out", path.join(ROOT, "dist"))), platform: opt("--platform", "all"), rebuildLauncher: argv.includes("--rebuild-launcher"), nodeRuntime: opt("--node-runtime") });
  for (const [k, v] of Object.entries(built)) console.log(`${k.padEnd(8)} ${v}`);
}
