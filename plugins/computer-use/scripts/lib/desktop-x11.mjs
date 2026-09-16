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

/** The browser the fixture runs in. Google Chrome when it is installed,
 *  Chromium otherwise — Debian and most distributions ship only the latter,
 *  and it has no arm64 Google Chrome at all. */
function browserBinary() {
  const local = `${HOME}/.local/bin/google-chrome`;
  if (fs.existsSync(local)) return local;
  return sh("which", ["google-chrome"]).code === 0 ? "google-chrome" : "chromium";
}

/** What the accessibility tree calls that browser. Tasks target an application
 *  by exact name and the content origin is found by walking it, so guessing
 *  wrong makes every element target and every client coordinate miss. Read it
 *  from --version rather than the binary name: a distribution may install
 *  Chromium as google-chrome. */
function browserAppName() {
  return /chromium/i.test(sh(browserBinary(), ["--version"]).stdout) ? "Chromium" : "Chrome";
}
let workDisplay = process.env.DISPLAY || ":0";
let xvfb = null;
let wm = null;
// The isolated display gets its own session bus. Dbus-activated services
// (the AT-SPI registry, xdg-desktop-portal) inherit the daemon's
// environment, so a bus launched under DISPLAY=:99 keeps their windows on
// the isolated display — on the shared session bus they inherit the host's
// DISPLAY and Chromium's portal file chooser maps onto the host desktop.
let isoBusAddr = null;
let isoBusPid = null;

// The engine reads meta() after stop(), by which point an isolated run has
// already torn down its own Xvfb — so sample the display while it is up and
// keep the answer, or the receipt records a run with no screen.
let displayGeometry = "";
function geometry() {
  if (!displayGeometry) displayGeometry = xd(workDisplay, ["getdisplaygeometry"]).stdout.trim();
  return displayGeometry;
}

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
  const bus = sh("env", ["-u", "DBUS_SESSION_BUS_ADDRESS", "dbus-daemon", "--session", "--fork", "--print-address=1", "--print-pid=1"], { env: { DISPLAY: ":99" } });
  if (bus.code === 0) {
    const [addr, pid] = bus.stdout.trim().split("\n");
    isoBusAddr = addr;
    isoBusPid = Number(pid);
  }
}

// ---------- env shared by fixtures and the server ----------
function baseEnv() {
  const env = { DISPLAY: workDisplay };
  if (isoBusAddr) {
    env.DBUS_SESSION_BUS_ADDRESS = isoBusAddr;
  } else if (!process.env.DBUS_SESSION_BUS_ADDRESS && fs.existsSync(`/run/user/${process.getuid()}/bus`)) {
    // The AT-SPI bus rides the session bus; this shell often lacks the address.
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

/** Top-left origin and size of a non-fixture window on the work display
 *  (native dialogs, file choosers). Used by the `window_title` target. */
function windowGeometry(titleRe) {
  const found = windowInfo(titleRe);
  if (!found) return null;
  const { abs, wh } = found.info;
  return { x: abs.x, y: abs.y, w: wh.w, h: wh.h };
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

const ATSPI_DOC = `import json, sys, pyatspi
want = sys.argv[1].casefold()
d = pyatspi.Registry.getDesktop(0)
for i in range(d.childCount):
    a = d.getChildAtIndex(i)
    if a and (a.name or "").casefold() == want:
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
  const r = sh("python3", ["-c", ATSPI_DOC, browserAppName()], { env: baseEnv(), timeoutMs: 20_000 });
  try { return JSON.parse(r.stdout.trim().split("\n").pop()); } catch { return null; }
}


const fixtureProcs = [];

async function launchFixture(kind, repCtx) {
  const fx = TASKS_DOC.fixtures[kind];
  if (kind === "browser") {
    const chrome = browserBinary();
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
    // detached makes proc.pid a session leader; killFixture sweeps the whole
    // session because chromium children setpgid out of the group kill.
    proc.cuSessionId = proc.pid;
    fixtureProcs.push(proc);
    try {
      const id = findWindow(fx.title_prefix, 15_000, proc.pid);
      if (!id) throw new Error("browser fixture window did not appear");
      repCtx.winId = id;
      // The window maps before the page's first CU-FIXTURE title write; a task
      // that samples the oracle in that gap sees nulls the run counts as fails.
      // Fatal when it never becomes readable: a renderer that never publishes
      // state is a fixture failure, not a task result.
      let ready = false;
      const stateDeadline = Date.now() + 40_000;
      while (Date.now() < stateDeadline && !(ready = await oracleState({ fixture: "browser" }, repCtx))) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!ready) throw new Error("browser fixture window mapped but never published a CU-FIXTURE state");
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
    } catch (e) {
      // A throw after spawn leaves the caller's proc unset; the browser
      // family would leak live onto the display and into AT-SPI lookups.
      await killFixture(proc);
      throw e;
    }
  }
  if (kind === "native") {
    const stateFile = path.join(repCtx.dir, "native-state.json");
    const proc = spawn("python3", [path.join(PARITY, fx.file), stateFile], {
      env: { ...process.env, ...baseEnv() }, stdio: "ignore",
    });
    fixtureProcs.push(proc);
    const id = findWindow(fx.title_prefix, 15_000, proc.pid);
    if (!id) {
      try { proc.kill("SIGKILL"); } catch {}
      throw new Error("native fixture window did not appear");
    }
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

/** All live processes whose session id equals sid — /proc/<pid>/stat field 6.
 * The sweep catches descendants that setpgid out of the launcher group. */
function sessionMembers(sid) {
  const out = [];
  for (const e of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(e) || Number(e) === process.pid) continue;
    try {
      const rest = fs.readFileSync(`/proc/${e}/stat`, "utf8").split(")").pop().trim().split(" ");
      if (Number(rest[3]) === sid) out.push(Number(e));
    } catch {}
  }
  return out;
}

async function killFixture(proc) {
  if (!proc) return;
  try { process.kill(-proc.pid ?? proc.pid, "SIGTERM"); } catch { try { proc.kill("SIGTERM"); } catch {} }
  try { proc.kill("SIGTERM"); } catch {}
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    try { process.kill(proc.pid, 0); } catch { break; }
    await new Promise((r) => setTimeout(r, 150));
  }
  try { process.kill(-proc.pid, "SIGKILL"); } catch {}
  try { proc.kill("SIGKILL"); } catch {}
  if (proc.cuSessionId) {
    for (const p of sessionMembers(proc.cuSessionId)) { try { process.kill(p, "SIGKILL"); } catch {} }
  }
}


async function oracleState(task, repCtx) {
  if (task.fixture === "browser") {
    const id = repCtx.winId;
    if (!id) return null;
    const prefix = TASKS_DOC.fixtures.browser.title_prefix;
    // A transient xdotool spawn/read failure (or a mid-write title) must not
    // masquerade as a task result: retry the measurement briefly before
    // reporting null. A genuinely missing window still reads null after the
    // retries, so real absences are unchanged — only slower to report.
    for (let attempt = 0; attempt < 4; attempt++) {
      const t = xd(workDisplay, ["getwindowname", id]).stdout.trim();
      const i = t.indexOf(prefix);
      if (i !== -1) {
        try { return JSON.parse(t.slice(i + prefix.length)); } catch {}
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 150));
    }
    return null;
  }
  if (task.fixture === "native") {
    try { return JSON.parse(fs.readFileSync(repCtx.nativeStateFile, "utf8")); } catch { return null; }
  }
  return null;
}

  return {
    sessionType,
    async start() { if (ISOLATED) await startIsolated(); geometry(); },
    stop() {
      // Backstop for any fixture family a rep failed to reap (e.g. a launch
      // error path before killFixture existed for it).
      for (const p of fixtureProcs) {
        try { process.kill(-p.pid, "SIGKILL"); } catch { try { p.kill("SIGKILL"); } catch {} }
        if (p.cuSessionId) for (const m of sessionMembers(p.cuSessionId)) { try { process.kill(m, "SIGKILL"); } catch {} }
      }
      if (wm) try { wm.kill(); } catch {}
      if (isoBusPid) try { process.kill(isoBusPid); } catch {}
      if (xvfb) try { xvfb.kill(); } catch {}
    },
    baseEnv,
    browserAppName,
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
    windowGeometry,
    oracleState,
    meta: () => ({
      display: workDisplay,
      display_geometry: geometry(),
      chrome: sh(browserBinary(), ["--version"]).stdout.trim(),
      browser_app_name: browserAppName(),
      python3: sh("python3", ["--version"]).stdout.trim(),
      tk: sh("python3", ["-c", "import tkinter;print(tkinter.TkVersion)"]).stdout.trim(),
    }),
  };
}
