// macOS desktop driver for the parity engine. Everything that knows about
// Aqua, LaunchServices, Chrome-on-macOS and the AppKit fixture lives here;
// scripts/parity-run.mjs owns the task DSL and the oracle.
//
// Three things differ structurally from the X11 driver and are deliberate:
//
//  * There is no isolated route. macOS has one WindowServer session per login,
//    so the shared desktop is the only surface; interference is measured, not
//    engineered away.
//  * Input is bound to a process, not to whatever holds keyboard focus, so
//    every task runs a prelude that calls open_application(activate:false) on
//    the fixture's own pid. Individual dialog tasks may explicitly activate it.
//  * The fixtures report their own content origin (AppKit window conversion, the
//    page's window.screenX/screenY) instead of the runner measuring windows.
//    That is exact, needs no extra TCC grant, and is independent of the
//    accessibility backend under test.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { sh } from "./sh.mjs";
import { appSessionRequest } from "../../src/app-socket.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export function createDesktop({ parityDir, tasksDoc, isolated }) {
  if (isolated) {
    throw new Error("--isolated has no macOS equivalent: one login session owns the WindowServer. Run the shared-desktop route; interference is reported per task.");
  }
  const PARITY = parityDir;
  const TASKS_DOC = tasksDoc;
  const probeSession = crypto.randomUUID();

  // ---------- compiled helpers (probe + native fixture) ----------
  /** Build an Obj-C helper once per source hash and cache it in tmp. */
  function build(name, source) {
    const hash = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex").slice(0, 16);
    const bin = path.join(os.tmpdir(), `cu-parity-${name}-${hash}`);
    if (!fs.existsSync(bin)) {
      const tmp = `${bin}-${process.pid}`;
      const r = sh("clang", ["-fobjc-arc", "-Os", "-framework", "Cocoa", source, "-o", tmp], { timeoutMs: 90_000 });
      if (r.code !== 0) throw new Error(`parity ${name} build failed (needs Xcode Command Line Tools): ${r.stderr}`);
      fs.renameSync(tmp, bin);
    }
    return bin;
  }
  const cache = new Map();
  function helper(name, file) {
    if (!cache.has(name)) cache.set(name, build(name, path.join(PARITY, file)));
    return cache.get(name);
  }
  function probeDesktop() {
    const r = sh(helper("probe", "darwin-probe.m"), [], { timeoutMs: 8_000 });
    try { return JSON.parse(r.stdout.trim()); } catch { return null; }
  }

  function hostProbe() {
    const p = probeDesktop();
    // activeWindow is the engine's foreground identity; on macOS the
    // meaningful unit is the frontmost application, not one window.
    return { pointer: p?.pointer ?? { x: 0, y: 0 }, activeWindow: p?.frontmost ?? "" };
  }

  // ---------- oracle transport ----------
  // The browser fixture is served from this loopback server so its beacons are
  // same-origin: no CORS, no file:// private-network refusals, and the oracle
  // never travels through the tool surface under test.
  let server = null, port = 0;
  let browser = { state: null, frame: null, seq: -1 };

  async function start() {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname === "/s") {
        const seq = Number(url.searchParams.get("n"));
        try {
          const payload = JSON.parse(url.searchParams.get("j"));
          // Beacons can arrive out of order; only ever move forward.
          if (!(seq < browser.seq)) browser = { state: payload.state, frame: payload.frame, seq };
        } catch {}
        res.writeHead(204); res.end();
        return;
      }
      if (url.pathname === "/" || url.pathname === "/browser.html") {
        const body = fs.readFileSync(path.join(PARITY, TASKS_DOC.fixtures.browser.file));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(body);
        return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  }

  async function stop() {
    server?.close();
    // A timestamp is not ownership: other MCP sessions may capture in parallel.
    // Keep their files and the run's raw evidence; never sweep the global store.
    await appSessionRequest({ tool: "close_session", sessionId: probeSession }).catch(() => {});
    return { rasters_removed: 0 };
  }

  // ---------- env ----------
  // No DISPLAY, no D-Bus. The server must keep the real state dir so it finds
  // the desktop app's socket: the app owns the Accessibility grant, and a
  // scratch state dir would silently demote every task to direct mode.
  const baseEnv = () => ({});
  const serverEnv = () => ({});

  // ---------- fixtures ----------
  function waitFor(predicate, timeoutMs, what) {
    const deadline = Date.now() + timeoutMs;
    return (async () => {
      while (Date.now() < deadline) {
        const v = predicate();
        if (v) return v;
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error(`${what} did not appear within ${timeoutMs}ms`);
    })();
  }

  /**
   * Chromium builds its renderer accessibility tree lazily, so a coordinate
   * action issued in the first second finds nothing to press and degrades to a
   * raw event. This is fixture readiness, exactly like the X11 driver waiting
   * for AT-SPI registration before it measures anything — so it asks the
   * platform accessibility service (through the app that holds the grant, the
   * only process here that has one) rather than adding a blind sleep. The
   * oracle never travels this way; only "is the app observable yet".
   */
  async function waitForAccessibility(pid, timeoutMs = 12_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      try {
        const r = await appSessionRequest({ tool: "get_app_state", sessionId: probeSession, args: { app_ref: { pid } } }, { timeoutMs: 20_000 });
        last = r?.data?.elements?.length ?? 0;
        if (last > 20) return { ready: true, elements: last, waited_ms: timeoutMs - (deadline - Date.now()) };
      } catch (e) {
        // No desktop app on this machine: nothing to wait on, and the run will
        // report whatever the direct backend can do.
        return { ready: false, reason: e.code ?? "unavailable" };
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return { ready: false, reason: "accessibility tree stayed empty", elements: last };
  }

  async function launchFixture(kind, repCtx) {
    const fx = TASKS_DOC.fixtures[kind];
    // Chrome activates itself on launch no matter how it is spawned (verified
    // for both direct exec and `open -g`), which steals the operator's typing
    // focus. Remember who was frontmost and hand activation back once the
    // fixture is up; input is process-bound, so the fixture never needs focus.
    const frontBefore = probeDesktop()?.frontmost_pid ?? -1;
    if (kind === "browser") {
      if (!fs.existsSync(CHROME)) throw new Error(`Google Chrome is not installed at ${CHROME}`);
      browser = { state: null, frame: null, seq: -1 };
      const udd = fs.mkdtempSync(path.join(os.tmpdir(), "cu-parity-chrome-"));
      fs.mkdirSync(path.join(udd, "Default"), { recursive: true });
      fs.writeFileSync(path.join(udd, "Default", "Preferences"), JSON.stringify({
        download: { default_directory: repCtx.downloadDir, prompt_for_download: false },
      }));
      repCtx.userDataDir = udd;
      repCtx.url = `http://127.0.0.1:${port}/browser.html`;
      const proc = spawn(CHROME, [
        `--user-data-dir=${udd}`, `--app=http://127.0.0.1:${port}/browser.html`,
        `--window-size=${fx.size[0]},${fx.size[1]}`, `--window-position=${fx.position?.[0] ?? 0},${fx.position?.[1] ?? 40}`,
        "--no-first-run", "--no-default-browser-check", "--disable-features=Translate",
        "--force-renderer-accessibility",
        // The runner hands focus back to the operator after launch, which can
        // leave the fixture window fully covered; Chrome would then clamp the
        // page's timers and dynamic-content tasks stall in "loading".
        "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ], { stdio: "ignore", detached: true });
      repCtx.pid = proc.pid;
      await waitFor(() => browser.frame, 25_000, "browser fixture");
      repCtx.ax = await waitForAccessibility(proc.pid);
      restoreFocus(frontBefore, repCtx);
      return proc;
    }
    if (kind === "native") {
      const stateFile = path.join(repCtx.dir, `native-state-${crypto.randomBytes(3).toString("hex")}.json`);
      const proc = spawn(helper("native-fixture", fx.file), [stateFile], { stdio: "ignore", detached: true });
      repCtx.pid = proc.pid;
      repCtx.nativeStateFile = stateFile;
      await waitFor(() => {
        try { return JSON.parse(fs.readFileSync(stateFile, "utf8")).origin ? true : false; } catch { return false; }
      }, 25_000, "native fixture");
      restoreFocus(frontBefore, repCtx);
      return proc;
    }
    return null;
  }

  /** Give foreground activation back to whoever held it before the launch. */
  function restoreFocus(pid, repCtx) {
    if (!pid || pid <= 0 || pid === process.pid || pid === repCtx?.pid) return;
    try { sh(helper("probe", "darwin-probe.m"), ["--restore-focus", String(pid)], { timeoutMs: 5_000 }); } catch {}
  }

  /** Selection happens through the recorded prelude, not out-of-band focus. */
  function focusFixture() {}

  async function killFixture(proc, repCtx) {
    if (proc) {
      for (const signal of ["SIGTERM", "SIGKILL"]) {
        try { process.kill(-proc.pid, signal); } catch { try { proc.kill(signal); } catch {} }
        const deadline = Date.now() + (signal === "SIGTERM" ? 3000 : 1500);
        let gone = false;
        while (Date.now() < deadline) {
          try { process.kill(proc.pid, 0); } catch { gone = true; break; }
          await new Promise((r) => setTimeout(r, 100));
        }
        if (gone) break;
      }
    }
    if (repCtx?.userDataDir) { try { fs.rmSync(repCtx.userDataDir, { recursive: true, force: true }); } catch {} }
  }

  /**
   * Every task binds raw input to the fixture's own process first. pid (not
   * bundle id) is the identity that matters: the user may already be running
   * their own Chrome, and binding that one would type into their windows.
   * The suite is the consenting user: it allows its own fixture pid before
   * the app gate, exactly like smoke does.
   */
  function prelude(task, repCtx) {
    if (!task.fixture || !repCtx.pid) return [];
    const steps = [
      { call: "consent_allow", args: { pid: repCtx.pid } },
      { call: "open_application", args: { pid: repCtx.pid, activate: false } },
    ];
    const wantsForeground = (task.steps ?? []).some((s) => s.call === "open_application" && s.args?.activate === true);
    if (wantsForeground) steps.unshift({ call: "consent_allow", args: { scope: "foreground" } });
    return steps;
  }

  // ---------- geometry ----------
  function clientOrigin(fixtureKey, { window = "main", repCtx } = {}) {
    if (fixtureKey === "browser") {
      const f = browser.frame;
      if (!f) throw new Error("browser fixture has not reported its frame yet");
      // An --app window has no side chrome on macOS, but derive it anyway so a
      // bordered window is still exact.
      const side = Math.max(0, (f.outerWidth - f.innerWidth) / 2);
      return { x: Math.round(f.screenX + side), y: Math.round(f.screenY + (f.outerHeight - f.innerHeight) - side) };
    }
    if (fixtureKey === "native") {
      const s = readNativeState(repCtx);
      const o = window === "second" ? s?.origin2 : s?.origin;
      if (!o) throw new Error(`native fixture has not reported its ${window} window origin`);
      return { x: o[0], y: o[1] };
    }
    throw new Error(`no macOS client origin for fixture "${fixtureKey}"`);
  }

  function readNativeState(repCtx) {
    try { return JSON.parse(fs.readFileSync(repCtx.nativeStateFile, "utf8")); } catch { return null; }
  }

  async function oracleState(task, repCtx) {
    if (task.fixture === "browser") return browser.state;
    if (task.fixture === "native") return readNativeState(repCtx);
    return null;
  }

  return {
    sessionType: () => "aqua",
    start,
    stop,
    baseEnv,
    serverEnv,
    hostProbe,
    launchFixture,
    focusFixture,
    killFixture,
    prelude,
    clientOrigin,
    oracleState,
    meta: () => {
      const p = probeDesktop();
      return {
        display: "aqua:main",
        display_geometry: p ? `${p.display.points.w} ${p.display.points.h} @${p.display.scale}x (${p.display.pixels.w}x${p.display.pixels.h} px)` : "unknown",
        chrome: sh(CHROME, ["--version"]).stdout.trim(),
        python3: sh("python3", ["--version"]).stdout.trim(),
        native_fixture: "AppKit (parity/fixtures/native-macos.m)",
        macos: sh("sw_vers", ["-productVersion"]).stdout.trim(),
        oracle_transport: "loopback http (fixture-served)",
      };
    },
  };
}
