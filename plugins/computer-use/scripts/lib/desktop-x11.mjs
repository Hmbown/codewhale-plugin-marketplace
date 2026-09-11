// Linux/X11 desktop driver for the parity engine. Everything that knows about
// X11, Xvfb, xdotool, xwininfo, AT-SPI, Chrome-on-Linux and the Tk fixture
// lives here; scripts/parity-run.mjs owns the task DSL and the oracle.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sh } from "./sh.mjs";

export function createDesktop({ parityDir, tasksDoc, isolated }) {
  const TASKS_DOC = tasksDoc;
  const PARITY = parityDir;
  const HOME = os.homedir();
  const ISOLATED = isolated;

const HOST_DISPLAY = ":0"; // where the user's pointer/window live; interference is always measured here
let workDisplay = process.env.DISPLAY || ":0";
let xvfb = null;
let wm = null;

function sessionType() {
  if (ISOLATED) return "xvfb";
  if (process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland") return "wayland";
  return "x11";
}

async function startIsolated() {
  if (!fs.existsSync("/tmp/.X99-lock")) {
    xvfb = spawn("Xvfb", [":99", "-screen", "0", "1600x1200x24"], { stdio: "ignore" });
    xvfb.unref();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (sh("xdotool", ["getdisplaygeometry"], { env: { DISPLAY: ":99" } }).code === 0) break;
    }
  }
  workDisplay = ":99";
  for (const wmName of ["openbox", "xfwm4", "metacity"]) {
    if (sh("which", [wmName]).code === 0) {
      wm = spawn(wmName, [], { env: { ...process.env, DISPLAY: ":99" }, stdio: "ignore" });
      wm.unref();
      await new Promise((r) => setTimeout(r, 1000));
      break;
    }
  }
}

// ---------- env shared by fixtures and the server ----------
function baseEnv() {
  const env = { DISPLAY: workDisplay };
  // The AT-SPI bus rides the session bus; this shell often lacks the address.
  if (!process.env.DBUS_SESSION_BUS_ADDRESS && fs.existsSync(`/run/user/${process.getuid()}/bus`)) {
    env.DBUS_SESSION_BUS_ADDRESS = `unix:path=/run/user/${process.getuid()}/bus`;
  }
  return env;
}

// ---------- x helpers (always against a chosen display) ----------
const xd = (d, args, opts) => sh("xdotool", args, { ...opts, env: { DISPLAY: d, ...opts?.env } });

function hostProbe() {
  const loc = xd(HOST_DISPLAY, ["getmouselocation"]);
  const m = /x:(-?\d+)\s+y:(-?\d+)/.exec(loc.stdout) ?? [null, 0, 0];
  const win = xd(HOST_DISPLAY, ["getactivewindow", "getwindowname"]);
  return { pointer: { x: Number(m[1]), y: Number(m[2]) }, activeWindow: win.stdout.trim() };
}

function findWindow(nameRe, timeoutMs = 12_000, pid = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Prefer windows owned by the fixture process we just launched — stale
    // windows from earlier reps/debugging share the title prefix.
    if (pid) {
      const pr = xd(workDisplay, ["search", "--pid", String(pid), "--name", nameRe]);
      const pids = pr.stdout.trim().split("\n").filter(Boolean);
      if (pids.length) return pids[pids.length - 1];
    }
    const r = xd(workDisplay, ["search", "--name", nameRe]);
    const ids = r.stdout.trim().split("\n").filter(Boolean);
    for (const id of ids.reverse()) {
      const t = xd(workDisplay, ["getwindowname", id]).stdout.trim();
      if (nameRe instanceof RegExp ? nameRe.test(t) : t.includes(nameRe)) return id;
    }
    // search already filters; accept newest when the title can't be read
    if (ids.length && r.code === 0) { const t = xd(workDisplay, ["getwindowname", ids[ids.length - 1]]); if (t.stdout) return ids[ids.length - 1]; }
    // sleep
    const t0 = Date.now(); while (Date.now() - t0 < 300) {}
  }
  return null;
}

function xwininfo(id) {
  // This xwininfo build prints only the tree with -children and only the stats
  // without it — two calls.
  const stats = sh("xwininfo", ["-id", id], { env: { DISPLAY: workDisplay } });
  const tree = sh("xwininfo", ["-id", id, "-children"], { env: { DISPLAY: workDisplay } });
  const out = (stats.stdout ?? "") + "\n" + (stats.stderr ?? "");
  if (process.env.PARITY_DEBUG && !/Absolute upper-left X/.test(out)) console.error(`  [dbg] xwininfo raw (code ${stats.code}): ${JSON.stringify(out.slice(0, 300))}`);
  const abs = { x: Number(/Absolute upper-left X:\s+(-?\d+)/.exec(out)?.[1]), y: Number(/Absolute upper-left Y:\s+(-?\d+)/.exec(out)?.[1]) };
  const wh = { w: Number(/Width:\s+(\d+)/.exec(out)?.[1]), h: Number(/Height:\s+(\d+)/.exec(out)?.[1]) };
  const children = [];
  for (const m of ((tree.stdout ?? "") + (tree.stderr ?? "")).matchAll(/0x[0-9a-f]+ \(has no name\).*?(\d+)x(\d+)\+(-?\d+)\+(-?\d+)\s+([-+]\d+)([-+]\d+)/g)) {
    children.push({ w: +m[1], h: +m[2], relX: +m[3], relY: +m[4], absX: +m[5], absY: +m[6] });
  }
  return { abs, wh, children };
}

/**
 * Client origin of a fixture window. Tk draws its menubar as a child window
 * inside the toplevel, so the content origin is the child matching the
 * fixture's declared size. Chrome draws its toolbar inside one CSD window;
 * the content origin is the AT-SPI "document web" extents (fall back to the
 * window origin when a11y is unavailable).
 */
/** Search for the named window and return its parsed xwininfo; retries because
 *  Chrome recycles window ids during startup. */
function windowInfo(nameRe, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const r = xd(workDisplay, ["search", "--name", nameRe]);
    const ids = r.stdout.trim().split("\n").filter(Boolean);
    if (process.env.PARITY_DEBUG) console.error(`  [dbg] windowInfo "${nameRe}" try${i} code=${r.code} ids=[${ids}]`);
    for (const id of ids) {
      const title = xd(workDisplay, ["getwindowname", id]).stdout.trim();
      if (process.env.PARITY_DEBUG) console.error(`  [dbg]   id=${id} title="${title.slice(0, 60)}"`);
      const okTitle = nameRe instanceof RegExp ? nameRe.test(title) : title.includes(nameRe);
      if (!okTitle) continue;
      const info = xwininfo(id);
      if (process.env.PARITY_DEBUG) console.error(`  [dbg]   xwininfo abs=${JSON.stringify(info.abs)}`);
      if (Number.isFinite(info.abs.x) && Number.isFinite(info.abs.y)) return { id, info };
    }
    const t0 = Date.now(); while (Date.now() - t0 < 250) {}
  }
  return null;
}

function clientOrigin(fixtureKey, { window = "main", repCtx } = {}) {
  const fx = TASKS_DOC.fixtures[fixtureKey];
  let id, info;
  if (window !== "second" && repCtx?.winId) {
    // The window we launched — re-read geometry (windows can move).
    id = repCtx.winId;
    info = xwininfo(id);
    if (!Number.isFinite(info.abs.x) || !Number.isFinite(info.abs.y)) {
      throw new Error(`fixture window ${id} no longer readable on ${workDisplay}`);
    }
  } else {
    const name = window === "second" ? fx.second_window_title : fx.title_prefix;
    const found = windowInfo(name);
    if (!found) throw new Error(`fixture window "${name}" not found on ${workDisplay}`);
    ({ id, info } = found);
  }
  if (fixtureKey === "native") {
    // Tk draws its menubar as a child window; the content child matches the
    // declared fixture size. Second window has no menubar -> absolute origin.
    const [w, h] = window === "second" ? [null, null] : fx.size;
    const content = info.children.find((c) => c.w === w && c.h === h);
    if (content) return { x: content.absX, y: content.absY, winId: id };
    return { ...info.abs, winId: id };
  }
  if (fixtureKey === "browser") {
    // Chrome's toolbar lives inside the one CSD window; the content origin is
    // the AT-SPI "document web" extents, cached as an offset from the window.
    if (repCtx) {
      if (repCtx.docOffset === undefined) {
        const doc = atspiDocOrigin();
        repCtx.docOffset = doc ? { x: doc.x - info.abs.x, y: doc.y - info.abs.y } : null;
      }
      if (repCtx.docOffset) return { x: info.abs.x + repCtx.docOffset.x, y: info.abs.y + repCtx.docOffset.y, winId: id };
    }
    return { ...info.abs, winId: id };
  }
  return { ...info.abs, winId: id };
}

const ATSPI_DOC = `import json, pyatspi
d = pyatspi.Registry.getDesktop(0)
for i in range(d.childCount):
    a = d.getChildAtIndex(i)
    if a and "chrome" in (a.name or "").lower():
        def walk(e, depth=0):
            if depth > 10: return None
            try:
                if e.getRoleName() == "document web":
                    x = e.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
                    return (x.x, x.y)
            except Exception: return None
            try:
                for k in range(e.childCount):
                    r = walk(e.getChildAtIndex(k), depth + 1)
                    if r: return r
            except Exception: pass
            return None
        for j in range(a.childCount):
            w = a.getChildAtIndex(j)
            if not w: continue
            try:
                t = (w.name or "")
            except Exception: t = ""
            if "CU-FIXTURE" in t:
                r = walk(w)
                if r:
                    print(json.dumps({"x": r[0], "y": r[1]}))
                    raise SystemExit(0)`;

function atspiDocOrigin() {
  const r = sh("python3", ["-c", ATSPI_DOC], { env: baseEnv(), timeoutMs: 20_000 });
  try { return JSON.parse(r.stdout.trim().split("\n").pop()); } catch { return null; }
}


const fixtureProcs = [];

async function launchFixture(kind, repCtx) {
  const fx = TASKS_DOC.fixtures[kind];
  if (kind === "browser") {
    const chrome = fs.existsSync(`${HOME}/.local/bin/google-chrome`) ? `${HOME}/.local/bin/google-chrome` : (sh("which", ["google-chrome"]).code === 0 ? "google-chrome" : "chromium");
    const udd = fs.mkdtempSync(path.join(os.tmpdir(), "cu-parity-chrome-"));
    fs.mkdirSync(path.join(udd, "Default"), { recursive: true });
    fs.writeFileSync(path.join(udd, "Default", "Preferences"), JSON.stringify({
      download: { default_directory: repCtx.downloadDir, prompt_for_download: false },
    }));
    const file = `file://${path.join(PARITY, fx.file)}`;
    const proc = spawn(chrome, [
      `--user-data-dir=${udd}`, `--app=${file}`,
      `--window-size=${fx.size[0]},${fx.size[1]}`, "--window-position=0,0",
      "--no-first-run", "--disable-features=Translate", "--force-renderer-accessibility",
    ], { env: { ...process.env, ...baseEnv() }, stdio: "ignore", detached: true });
    fixtureProcs.push(proc);
    const id = findWindow(fx.title_prefix, 15_000, proc.pid);
    if (!id) throw new Error("browser fixture window did not appear");
    repCtx.winId = id;
    // Wait (bounded) for the renderer's a11y tree so the content origin can
    // be measured via AT-SPI; fall back to the window origin if it never shows.
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const info = xwininfo(id);
      const doc = atspiDocOrigin();
      if (doc) { repCtx.docOffset = { x: doc.x - info.abs.x, y: doc.y - info.abs.y }; break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    return proc;
  }
  if (kind === "native") {
    const stateFile = path.join(repCtx.dir, "native-state.json");
    const proc = spawn("python3", [path.join(PARITY, fx.file), stateFile], {
      env: { ...process.env, ...baseEnv() }, stdio: "ignore",
    });
    fixtureProcs.push(proc);
    const id = findWindow(fx.title_prefix, 15_000, proc.pid);
    if (!id) throw new Error("native fixture window did not appear");
    repCtx.winId = id;
    repCtx.nativeStateFile = stateFile;
    return proc;
  }
  return null;
}

/** Give the fixture window real X input focus so key/type XTEST events reach
 * it (on a shared desktop the focus may sit on an unrelated window). */
function focusFixture(repCtx) {
  if (!repCtx?.winId) return;
  xd(workDisplay, ["windowactivate", "--sync", repCtx.winId]);
  xd(workDisplay, ["windowfocus", repCtx.winId]);
  if (process.env.PARITY_DEBUG) {
    const f = xd(workDisplay, ["getwindowfocus", "getwindowname"]).stdout.trim();
    console.error(`  [dbg] focusFixture winId=${repCtx.winId} focus="${f}"`);
  }
}

async function killFixture(proc) {
  if (!proc) return;
  try { process.kill(-proc.pid ?? proc.pid, "SIGTERM"); } catch { try { proc.kill("SIGTERM"); } catch {} }
  try { proc.kill("SIGTERM"); } catch {}
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    try { process.kill(proc.pid, 0); } catch { return; }
    await new Promise((r) => setTimeout(r, 150));
  }
  try { process.kill(-proc.pid, "SIGKILL"); } catch {}
  try { proc.kill("SIGKILL"); } catch {}
}


async function oracleState(task, repCtx) {
  if (task.fixture === "browser") {
    const id = repCtx.winId;
    if (!id) return null;
    const t = xd(workDisplay, ["getwindowname", id]).stdout.trim();
    const prefix = TASKS_DOC.fixtures.browser.title_prefix;
    const i = t.indexOf(prefix);
    if (i === -1) return null;
    try { return JSON.parse(t.slice(i + prefix.length)); } catch { return null; }
  }
  if (task.fixture === "native") {
    try { return JSON.parse(fs.readFileSync(repCtx.nativeStateFile, "utf8")); } catch { return null; }
  }
  return null;
}

  return {
    sessionType,
    async start() { if (ISOLATED) await startIsolated(); },
    stop() {
      if (wm) try { wm.kill(); } catch {}
      if (xvfb) try { xvfb.kill(); } catch {}
    },
    baseEnv,
    // The Linux runner drives the backend in-process: there is no desktop app
    // holding OS permissions on X11.
    serverEnv: () => ({ CODEWHALE_CU_APP: "off" }),
    hostProbe,
    launchFixture,
    focusFixture,
    killFixture,
    // X11 input follows keyboard focus, so no per-task binding step is needed.
    prelude: () => [],
    clientOrigin,
    oracleState,
    meta: () => ({
      display: workDisplay,
      display_geometry: xd(workDisplay, ["getdisplaygeometry"]).stdout.trim(),
      chrome: sh(fs.existsSync(`${HOME}/.local/bin/google-chrome`) ? `${HOME}/.local/bin/google-chrome` : "google-chrome", ["--version"]).stdout.trim(),
      python3: sh("python3", ["--version"]).stdout.trim(),
      tk: sh("python3", ["-c", "import tkinter;print(tkinter.TkVersion)"]).stdout.trim(),
    }),
  };
}
