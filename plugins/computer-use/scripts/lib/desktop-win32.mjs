// Windows desktop driver for the parity engine. Everything that knows about
// the interactive console session, Chrome-on-Windows and the Tk fixture lives
// here; scripts/parity-run.mjs owns the task DSL and the oracle.
//
// What differs structurally from the other drivers and is deliberate:
//
//  * There is no isolated route. Windows containers and job objects have no
//    interactive desktop; a second session is a different user's desktop.
//    The shared console session is the only honest surface, so interference
//    is measured, not engineered away.
//  * Raw input follows the foreground window, not a bound process. The
//    driver keeps the fixture foregrounded (focusFixture) and the prelude is
//    empty — like the X11 driver, not like macOS.
//  * The browser fixture is served over loopback http (same as darwin) so its
//    state + frame beacons are same-origin and the oracle never travels
//    through the tool surface under test. The native fixture reports its own
//    client origin through its state file (Tk winfo_rootx/y).
//  * This driver requires a real interactive Windows desktop: Node.js, Chrome
//    and Python 3 + Tk (the python.org installer bundles tcl/tk). A Windows
//    CI session or VM console counts only if it has a visible desktop —
//    record which produced the receipt.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { sh } from "./sh.mjs";

export function createDesktop({ parityDir, tasksDoc, isolated }) {
  if (isolated) {
    throw new Error("--isolated has no Windows equivalent: containers have no interactive desktop and a second session is a different user's desktop. Run the shared-console route; interference is reported per task.");
  }
  const PARITY = parityDir;
  const TASKS_DOC = tasksDoc;
  const probeSession = crypto.randomUUID();

  // ---------- PowerShell helpers ----------
  function ps(script, timeoutMs = 15_000) {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    return sh("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { timeoutMs });
  }
  function psJson(script, timeoutMs) {
    const r = ps(script, timeoutMs);
    if (r.code !== 0) return null;
    try { return JSON.parse(r.stdout.trim()); } catch { return null; }
  }

  function probeDesktop() {
    const r = sh("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", path.join(PARITY, "win32-probe.ps1")], { timeoutMs: 10_000 });
    if (r.code !== 0) return null;
    try { return JSON.parse(r.stdout.trim()); } catch { return null; }
  }

  function hostProbe() {
    const p = probeDesktop();
    return { pointer: { x: p?.pointer?.x ?? 0, y: p?.pointer?.y ?? 0 }, activeWindow: p?.activeWindow ?? "" };
  }

  // ---------- tool discovery ----------
  function chromePath() {
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    const roots = [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean);
    for (const root of roots) {
      const p = path.join(root, "Google", "Chrome", "Application", "chrome.exe");
      if (fs.existsSync(p)) return p;
    }
    const w = sh("where.exe", ["chrome"], { timeoutMs: 5_000 });
    const first = w.stdout.trim().split("\n")[0]?.trim();
    if (w.code === 0 && first && fs.existsSync(first)) return first;
    return null;
  }
  const CHROME = chromePath();

  // python.org's launcher is `py -3`; a bare `python` also works when it is on
  // PATH. Microsoft Store aliases answer --version but cannot run scripts
  // unattended, so probe with -c rather than trusting the lookup alone.
  function pythonCmd() {
    for (const [exe, args] of [["py", ["-3"]], ["python", []], ["python3", []]]) {
      const r = sh(exe, [...args, "-c", "import tkinter,sys;print(sys.version.split()[0])"], { timeoutMs: 10_000 });
      if (r.code === 0 && r.stdout.trim()) return { exe, args, version: r.stdout.trim() };
    }
    return null;
  }
  const PYTHON = pythonCmd();

  // ---------- oracle transport ----------
  // The browser fixture is served from this loopback server so its beacons are
  // same-origin: no CORS, no file:// private-network refusals, and the oracle
  // never travels through the tool surface under test.
  let server = null, port = 0;
  let browser = { state: null, frame: null, seq: -1 };

  async function start() {
    if (!CHROME) throw new Error("Google Chrome not found (looked in Program Files, LocalAppData and PATH; set CHROME_PATH)");
    if (!PYTHON) throw new Error("Python 3 with tkinter not found (tried `py -3`, `python`, `python3`); the python.org installer bundles tcl/tk");
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
    return { rasters_removed: 0 };
  }

  // ---------- env ----------
  const baseEnv = () => ({});
  // No desktop helper on Windows: force the direct backend explicitly.
  const serverEnv = () => ({ CODEWHALE_CU_APP: "off" });

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

  async function launchFixture(kind, repCtx) {
    const fx = TASKS_DOC.fixtures[kind];
    if (kind === "browser") {
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
        "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ], { stdio: "ignore", detached: true });
      proc.unref();
      repCtx.pid = proc.pid;
      await waitFor(() => browser.frame, 25_000, "browser fixture");
      return proc;
    }
    if (kind === "native") {
      const stateFile = path.join(repCtx.dir, `native-state-${crypto.randomBytes(3).toString("hex")}.json`);
      const proc = spawn(PYTHON.exe, [...PYTHON.args, path.join(PARITY, fx.file), stateFile], { stdio: "ignore", detached: true });
      proc.unref();
      repCtx.pid = proc.pid;
      repCtx.nativeStateFile = stateFile;
      await waitFor(() => {
        try { return JSON.parse(fs.readFileSync(stateFile, "utf8")).origin ? true : false; } catch { return false; }
      }, 25_000, "native fixture");
      return proc;
    }
    return null;
  }

  /**
   * Windows raw input follows the foreground window, so the fixture must hold
   * foreground before any task step runs. SetForegroundWindow refuses calls
   * from a process that did not receive the last input event, so this first
   * satisfies the last-input check with a no-op event, then attaches to the
   * foreground thread's input queue as a fallback.
   */
  function focusFixture(repCtx) {
    const pid = repCtx?.pid;
    if (!pid) return;
    ps(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CUFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool on);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@
$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
if ($p -and $p.MainWindowHandle -ne 0) {
  $h = $p.MainWindowHandle
  [void][CUFocus]::keybd_event(0, 0, 0, [UIntPtr]::Zero)
  [void][CUFocus]::ShowWindow($h, 9)
  if (-not [CUFocus]::SetForegroundWindow($h)) {
    $fg = [CUFocus]::GetForegroundWindow()
    $fgPid = 0
    $fgTid = [CUFocus]::GetWindowThreadProcessId($fg, [ref]$fgPid)
    $me = [CUFocus]::GetCurrentThreadId()
    [void][CUFocus]::AttachThreadInput($me, $fgTid, $true)
    [void][CUFocus]::SetForegroundWindow($h)
    [void][CUFocus]::AttachThreadInput($me, $fgTid, $false)
  }
}`);
  }

  async function killFixture(proc, repCtx) {
    if (proc?.pid) {
      sh("taskkill.exe", ["/PID", String(proc.pid), "/T", "/F"], { timeoutMs: 10_000 });
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        try { process.kill(proc.pid, 0); } catch { break; }
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (repCtx?.userDataDir) { try { fs.rmSync(repCtx.userDataDir, { recursive: true, force: true }); } catch {} }
  }

  /** Input follows the foreground window; focusFixture already owns that. */
  function prelude() {
    return [];
  }

  // ---------- geometry ----------
  function clientOrigin(fixtureKey, { window = "main", repCtx } = {}) {
    if (fixtureKey === "browser") {
      const f = browser.frame;
      if (!f) throw new Error("browser fixture has not reported its frame yet");
      // An --app window has no side chrome beyond the border; derive it so a
      // bordered/DPI-scaled window is still exact.
      const side = Math.max(0, (f.outerWidth - f.innerWidth) / 2);
      return { x: Math.round(f.screenX + side), y: Math.round(f.screenY + (f.outerHeight - f.innerHeight) - side) };
    }
    if (fixtureKey === "native") {
      const s = readNativeState(repCtx);
      const o = window === "second" ? s?.origin2 : s?.origin;
      if (!o) throw new Error(`native fixture has not reported its ${window} window origin`);
      return { x: o[0], y: o[1] };
    }
    throw new Error(`no win32 client origin for fixture "${fixtureKey}"`);
  }

  /**
   * Geometry of a non-fixture top-level window (file chooser, native dialog)
   * by title substring. Only visible windows count; the first match wins.
   */
  function windowGeometry(title, repCtx) {
    const needle = JSON.stringify(title);
    const j = psJson(`
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class CUEnum {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  public struct RECT { public int L, T, R, B; }
}
"@
$hit = $null
$cb = [CUEnum+EnumProc]{ param($h, $l)
  if (-not [CUEnum]::IsWindowVisible($h)) { return $true }
  $sb = New-Object System.Text.StringBuilder 512
  [void][CUEnum]::GetWindowText($h, $sb, $sb.Capacity)
  if ($sb.ToString().Contains(${needle})) {
    $r = New-Object CUEnum+RECT
    [void][CUEnum]::GetWindowRect($h, [ref]$r)
    $script:hit = @{ x = $r.L; y = $r.T; w = ($r.R - $r.L); h = ($r.B - $r.T); title = $sb.ToString() }
    return $false
  }
  return $true
}
[void][CUEnum]::EnumWindows($cb, [IntPtr]::Zero)
if ($hit) { $hit | ConvertTo-Json -Compress } else { 'null' }`);
    return j ?? null;
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
    sessionType: () => "desktop",
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
    windowGeometry,
    oracleState,
    meta: () => {
      const p = probeDesktop();
      const osVer = ps("[System.Environment]::OSVersion.Version.ToString()").stdout.trim();
      return {
        display: "win32:console",
        display_geometry: p?.display ? `${p.display.w} ${p.display.h} @1x (virtual screen; scale unknown to powershell.exe)` : "unknown",
        chrome: CHROME ? sh(CHROME, ["--version"]).stdout.trim() : "not found",
        python3: PYTHON ? `${PYTHON.exe} ${PYTHON.args.join(" ")} ${PYTHON.version}`.trim() : "not found",
        native_fixture: "Tk (parity/fixtures/native.py)",
        windows: osVer,
        oracle_transport: "loopback http (fixture-served)",
      };
    },
  };
}
