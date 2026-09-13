#!/usr/bin/env node
// Put the built app where this OS expects an app to live, register it, and
// (by default) start its helper. The native setup panel owns permission
// requests under the app's own name and icon. The reverse is --remove.
//
//   macOS    ~/Applications/Codewhale Computer Use.app  (+ LaunchServices registration)
//            --login  ~/Library/LaunchAgents/net.codewhale.computer-use.plist
//   Linux    ~/.local/share/codewhale-computer-use  + ~/.local/bin symlink,
//            ~/.local/share/applications/*.desktop, ~/.local/share/icons/hicolor/...
//            --login  ~/.config/autostart/*.desktop
//   Windows  %LOCALAPPDATA%\Programs\Codewhale Computer Use + Start Menu shortcut
//            --login  Startup-folder shortcut
//
// Usage: node scripts/install-app.mjs [--dist <dir>] [--login] [--no-open] [--remove]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { APP_ID, APP_NAME, defaultLaunch, writeRegistration, registrationPath, runInfoPath, launchApp, hello } from "../src/app-socket.mjs";
import { MAC_BUNDLE, LINUX_DIR, WIN_DIR, desktopEntry, macSigningIdentity, signMacCode } from "./build-app.mjs";
import { replaceMacBundle } from "../app/install-macos.mjs";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const INSTALL_HOME = os.homedir();

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, ...opts });
  return { code: r.status ?? -1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

/** Refuse to delete anything at the destination that is not our own bundle. */
function assertOurs(dest, marker) {
  if (!fs.existsSync(dest)) return;
  if (!fs.existsSync(path.join(dest, marker))) {
    throw new Error(`${dest} exists but is not a ${APP_NAME} install (missing ${marker}); move it aside first`);
  }
}

function pinNode(file) {
  fs.writeFileSync(file, process.execPath + "\n");
}

// ---------- macOS ----------
const LS_REGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
function macPaths() {
  return {
    dest: path.join(INSTALL_HOME, "Applications", MAC_BUNDLE),
    agent: path.join(INSTALL_HOME, "Library", "LaunchAgents", `${APP_ID}.plist`),
  };
}
function installMac({ dist, login }) {
  const src = path.join(dist, "macos", MAC_BUNDLE);
  if (!fs.existsSync(path.join(src, "Contents", "Info.plist"))) throw new Error(`no built app at ${src}; run "npm run build:app" first`);
  const { dest, agent } = macPaths();
  assertOurs(dest, path.join("Contents", "Resources", "plugin", "app", "daemon.mjs"));
  const { backup } = replaceMacBundle(src, dest, { prepare: staged => {
    // Production bundles carry Node and retain their exact notarized seal.
    // Developer builds can pin the local runtime before signing the stage.
    if (!fs.existsSync(path.join(staged, "Contents", "MacOS", "node"))) {
      pinNode(path.join(staged, "Contents", "Resources", "node-path"));
      signMacCode(staged, macSigningIdentity(src));
    }
  } });
  if (fs.existsSync(LS_REGISTER)) sh(LS_REGISTER, ["-f", dest]);
  const launch = defaultLaunch(dest, "darwin");
  if (login) {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
\t<key>Label</key><string>${APP_ID}</string>
\t<key>ProgramArguments</key><array>${["/usr/bin/open", ...launch.slice(1)].map((a) => `<string>${a.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</string>`).join("")}</array>
\t<key>RunAtLoad</key><true/>
</dict></plist>
`;
    fs.mkdirSync(path.dirname(agent), { recursive: true });
    fs.writeFileSync(agent, plist);
    sh("launchctl", ["bootstrap", `gui/${process.getuid()}`, agent]);
  }
  return { path: dest, launch, backup, extras: login ? [agent] : [] };
}
function removeMac() {
  const { dest, agent } = macPaths();
  const removed = [];
  if (fs.existsSync(agent)) { sh("launchctl", ["bootout", `gui/${process.getuid()}`, agent]); fs.rmSync(agent); removed.push(agent); }
  if (fs.existsSync(dest)) { assertOurs(dest, path.join("Contents", "Resources", "plugin", "app", "daemon.mjs")); fs.rmSync(dest, { recursive: true }); removed.push(dest); }
  return removed;
}

// ---------- Linux ----------
function linuxPaths() {
  const data = process.env.XDG_DATA_HOME || path.join(INSTALL_HOME, ".local", "share");
  const config = process.env.XDG_CONFIG_HOME || path.join(INSTALL_HOME, ".config");
  return {
    dest: path.join(data, LINUX_DIR),
    bin: path.join(INSTALL_HOME, ".local", "bin", "codewhale-computer-use"),
    desktop: path.join(data, "applications", `${APP_ID}.desktop`),
    autostart: path.join(config, "autostart", `${APP_ID}.desktop`),
    icons: path.join(data, "icons", "hicolor"),
  };
}
function installLinux({ dist, login }) {
  const src = path.join(dist, "linux", LINUX_DIR);
  if (!fs.existsSync(path.join(src, "bin", "codewhale-computer-use"))) throw new Error(`no built app at ${src}; run "npm run build:app" first`);
  const p = linuxPaths();
  assertOurs(p.dest, path.join("plugin", "app", "daemon.mjs"));
  fs.rmSync(p.dest, { recursive: true, force: true });
  fs.cpSync(src, p.dest, { recursive: true });
  pinNode(path.join(p.dest, "node-path"));
  const launcher = path.join(p.dest, "bin", "codewhale-computer-use");
  fs.mkdirSync(path.dirname(p.bin), { recursive: true });
  try { fs.unlinkSync(p.bin); } catch {}
  fs.symlinkSync(launcher, p.bin);
  fs.mkdirSync(path.dirname(p.desktop), { recursive: true });
  fs.writeFileSync(p.desktop, desktopEntry(launcher));
  fs.cpSync(path.join(p.dest, "share", "icons", "hicolor"), p.icons, { recursive: true });
  sh("update-desktop-database", [path.dirname(p.desktop)]);
  sh("gtk-update-icon-cache", ["-f", "-t", p.icons]);
  const extras = [p.bin, p.desktop];
  if (login) { fs.mkdirSync(path.dirname(p.autostart), { recursive: true }); fs.copyFileSync(p.desktop, p.autostart); extras.push(p.autostart); }
  return { path: p.dest, launch: defaultLaunch(p.dest, "linux"), extras };
}
function removeLinux() {
  const p = linuxPaths();
  const removed = [];
  for (const f of [p.autostart, p.desktop, p.bin]) if (fs.existsSync(f) || isSymlink(f)) { fs.rmSync(f, { force: true }); removed.push(f); }
  for (const dir of fs.existsSync(p.icons) ? fs.readdirSync(p.icons) : []) {
    const f = path.join(p.icons, dir, "apps", `${APP_ID}.png`);
    if (fs.existsSync(f)) { fs.rmSync(f); removed.push(f); }
  }
  if (fs.existsSync(p.dest)) { assertOurs(p.dest, path.join("plugin", "app", "daemon.mjs")); fs.rmSync(p.dest, { recursive: true }); removed.push(p.dest); }
  return removed;
}
function isSymlink(f) { try { return fs.lstatSync(f).isSymbolicLink(); } catch { return false; } }

// ---------- Windows ----------
function winPaths() {
  const programs = path.join(process.env.LOCALAPPDATA || path.join(INSTALL_HOME, "AppData", "Local"), "Programs");
  const startMenu = path.join(process.env.APPDATA || path.join(INSTALL_HOME, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs");
  return {
    dest: path.join(programs, WIN_DIR),
    shortcut: path.join(startMenu, `${APP_NAME}.lnk`),
    startup: path.join(startMenu, "Startup", `${APP_NAME}.lnk`),
  };
}
function winShortcut(lnk, dest) {
  const ps = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${JSON.stringify(lnk)})
$s.TargetPath = "powershell.exe"
$s.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${dest.replace(/'/g, "''")}\\launch.ps1"'
$s.WorkingDirectory = ${JSON.stringify(dest)}
$s.IconLocation = ${JSON.stringify(path.join(dest, "icon.ico"))}
$s.Description = "${APP_NAME}"
$s.Save()`;
  const r = sh("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps]);
  if (r.code !== 0) throw new Error(`could not create shortcut ${lnk}: ${r.out.trim()}`);
}
function installWindows({ dist, login }) {
  const src = path.join(dist, "windows", WIN_DIR);
  if (!fs.existsSync(path.join(src, "launch.ps1"))) throw new Error(`no built app at ${src}; run "npm run build:app" first`);
  const p = winPaths();
  assertOurs(p.dest, path.join("plugin", "app", "daemon.mjs"));
  fs.rmSync(p.dest, { recursive: true, force: true });
  fs.cpSync(src, p.dest, { recursive: true });
  pinNode(path.join(p.dest, "node-path"));
  fs.mkdirSync(path.dirname(p.shortcut), { recursive: true });
  winShortcut(p.shortcut, p.dest);
  const extras = [p.shortcut];
  if (login) { fs.mkdirSync(path.dirname(p.startup), { recursive: true }); winShortcut(p.startup, p.dest); extras.push(p.startup); }
  return { path: p.dest, launch: defaultLaunch(p.dest, "win32"), extras };
}
function removeWindows() {
  const p = winPaths();
  const removed = [];
  for (const f of [p.startup, p.shortcut]) if (fs.existsSync(f)) { fs.rmSync(f); removed.push(f); }
  if (fs.existsSync(p.dest)) { assertOurs(p.dest, path.join("plugin", "app", "daemon.mjs")); fs.rmSync(p.dest, { recursive: true }); removed.push(p.dest); }
  return removed;
}

const BY_PLATFORM = {
  darwin: { install: installMac, remove: removeMac, pluginRoot: (p) => path.join(p, "Contents", "Resources", "plugin") },
  linux: { install: installLinux, remove: removeLinux, pluginRoot: (p) => path.join(p, "plugin") },
  win32: { install: installWindows, remove: removeWindows, pluginRoot: (p) => path.join(p, "plugin") },
};

export async function installApp({ dist = path.join(ROOT, "dist"), login = false, open = true, platform = process.platform } = {}) {
  const impl = BY_PLATFORM[platform];
  if (!impl) throw new Error(`no desktop app layout for ${platform}`);
  const r = impl.install({ dist, login });
  writeRegistration({ id: APP_ID, path: r.path, launch: r.launch });
  let running = null;
  let replaced = null;
  if (open) {
    // A daemon that is already up keeps the modules it loaded at start, so
    // leaving it running would make every later check report the *previous*
    // build's behavior. Take over instead: stop it, then launch the new bundle.
    replaced = await stopRunningApp();
    // A freshly replaced bundle is not always launchable on the first ask
    // (LaunchServices is still re-reading it), so retry rather than report a
    // false "not running".
    const deadline = Date.now() + 20_000;
    let nextLaunch = 0;
    while (!running && Date.now() < deadline) {
      if (Date.now() >= nextLaunch) { launchApp({ launch: r.launch }); nextLaunch = Date.now() + 5_000; }
      await new Promise((s) => setTimeout(s, 400));
      running = await hello({ timeoutMs: 1_000 });
    }
  }
  return { ...r, pluginRoot: impl.pluginRoot(r.path), registration: registrationPath(), running, replaced };
}

/** Stop a running daemon so the freshly installed bundle is what answers next. */
async function stopRunningApp() {
  const app = await hello();
  if (!app) return null;
  let pid = app.pid ?? null;
  try { pid = pid ?? JSON.parse(fs.readFileSync(runInfoPath(), "utf8")).pid; } catch {}
  if (!pid) return { stopped: false, reason: "running app did not report a pid" };
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try { process.kill(pid, signal); } catch { break; }
    const deadline = Date.now() + (signal === "SIGTERM" ? 5_000 : 2_000);
    while (Date.now() < deadline) {
      if (!(await hello({ timeoutMs: 700 }))) return { stopped: true, pid, signal };
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return { stopped: false, pid, reason: "previous instance did not exit" };
}

export function removeApp({ platform = process.platform } = {}) {
  const impl = BY_PLATFORM[platform];
  if (!impl) throw new Error(`no desktop app layout for ${platform}`);
  const removed = impl.remove();
  if (fs.existsSync(registrationPath())) { fs.rmSync(registrationPath()); removed.push(registrationPath()); }
  return removed;
}

function mcpSnippets(serverPath, nodePath = "node") {
  const q = JSON.stringify(serverPath);
  const executable = JSON.stringify(nodePath);
  return `
Point any MCP host at the installed server (any harness, any model):

  Claude Code    claude mcp add computer -- ${executable} ${q}
  Codex CLI      [mcp_servers.computer]  command = ${executable}  args = [${q}]      (~/.codex/config.toml)
  Cursor/others  {"mcpServers":{"computer":{"command":${executable},"args":[${q}]}}}
  Gemini CLI     {"mcpServers":{"computer":{"command":${executable},"args":[${q}]}}}  (~/.gemini/settings.json)
  opencode       {"mcp":{"computer":{"type":"local","command":[${executable},${q}]}}} (opencode.json)
  Codewhale      already discovers the plugin bundle; nothing to configure.
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
  try {
    if (argv.includes("--remove")) {
      const removed = removeApp();
      console.log(removed.length ? `removed:\n  ${removed.join("\n  ")}` : "nothing to remove");
    } else {
      const r = await installApp({ dist: path.resolve(opt("--dist", path.join(ROOT, "dist"))), login: argv.includes("--login"), open: !argv.includes("--no-open") });
      console.log(`installed ${APP_NAME}\n  app:          ${r.path}\n  plugin root:  ${r.pluginRoot}\n  registration: ${r.registration}`);
      for (const e of r.extras) console.log(`  also:         ${e}`);
      if (r.replaced) console.log(r.replaced.stopped ? `  replaced:     stopped previous instance (pid ${r.replaced.pid})` : `  replaced:     WARNING — ${r.replaced.reason}; the old build may still be answering`);
      console.log(r.running ? `  running:      pid ${r.running.pid} on ${r.running.socket}` : "  running:      not yet — open the app to start its helper");
      if (r.backup) console.log(`  previous app: ${r.backup}`);
      if (process.platform === "darwin") console.log(`\nOpen ${APP_NAME} from its whale menu to review permissions and run the background check.`);
      const bundledNode = path.join(r.path, "Contents", "MacOS", "node");
      console.log(mcpSnippets(path.join(r.pluginRoot, "mcp", "server.mjs"), fs.existsSync(bundledNode) ? bundledNode : "node"));
    }
  } catch (err) {
    console.error(`install-app: ${err.message}`);
    process.exit(1);
  }
}
