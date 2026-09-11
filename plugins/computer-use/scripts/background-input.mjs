#!/usr/bin/env node
// Background-input receipts, per application family.
//
// The claim under test is narrow and specific: with an application bound by
// open_application(activate:false), can the agent observe it, type into it and
// press a control in it *without* bringing it to the foreground, and does the
// window stay behind the user's work?
//
// Every family is a disposable instance the script launches and kills — never
// an application the user already has open, and never their profile. Each row
// ends as one of:
//   verified live          the effect was observed through an oracle outside
//                          the tool surface (a file on disk, the fixture's own
//                          state file, the page's loopback beacon)
//   verified failed-closed the action was refused or provably did nothing, and
//                          the receipt said so
//   untested               the precondition was missing (says which)
//
// Foreground is sampled by parity/darwin-probe.m, which shares no code with
// the backend under test.
//
// Usage: node scripts/background-input.mjs [--only <family>] [--out <dir>]
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { sh } from "./lib/sh.mjs";

if (process.platform !== "darwin") throw new Error("background-input receipts are macOS-specific");

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const PARITY = path.join(ROOT, "parity");
const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const OUT = (argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : null)
  ?? path.join(ROOT, "receipts", `background-input-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const MARKER = "codewhale-bg-" + crypto.randomBytes(3).toString("hex");

// ---------- desktop probe (independent of the backend) ----------
function build(name, source) {
  const hash = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex").slice(0, 16);
  const bin = path.join(os.tmpdir(), `cu-parity-${name}-${hash}`);
  if (!fs.existsSync(bin)) {
    const tmp = `${bin}-${process.pid}`;
    const r = sh("clang", ["-fobjc-arc", "-Os", "-framework", "Cocoa", source, "-o", tmp], { timeoutMs: 90_000 });
    if (r.code !== 0) throw new Error(`${name} build failed: ${r.stderr}`);
    fs.renameSync(tmp, bin);
  }
  return bin;
}
const frontmost = () => {
  const r = sh(build("probe", path.join(PARITY, "darwin-probe.m")), [], { timeoutMs: 8000 });
  try { return JSON.parse(r.stdout.trim()).frontmost_name; } catch { return "?"; }
};

// ---------- MCP client ----------
const server = spawn(process.execPath, [path.join(ROOT, "mcp/server.mjs")], { stdio: ["pipe", "pipe", "inherit"] });
let seq = 0, buffer = "";
const pending = new Map();
server.stdout.setEncoding("utf8");
server.stdout.on("data", (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const msg = JSON.parse(buffer.slice(0, i));
    buffer = buffer.slice(i + 1);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  }
});
async function tool(name, args = {}, { timeoutMs = 70_000 } = {}) {
  const id = ++seq;
  const res = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} timed out`)), timeoutMs);
    pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
  });
  if (!res.result) throw new Error(JSON.stringify(res.error));
  return JSON.parse(res.result.content[0].text);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- shared fixture plumbing ----------
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cu-bg-"));
const cleanups = [];
function killTree(proc) {
  if (!proc) return;
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try { process.kill(-proc.pid, signal); } catch { try { proc.kill(signal); } catch {} }
  }
}

/** Serves the parity browser fixture and collects its beacons (the oracle). */
async function pageServer() {
  let state = null;
  let frame = null;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname === "/s") {
      try { const p = JSON.parse(u.searchParams.get("j")); state = p.state; frame = p.frame; } catch {}
      res.writeHead(204); res.end(); return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(fs.readFileSync(path.join(PARITY, "fixtures", "browser.html")));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  cleanups.push(() => srv.close());
  return { port: srv.address().port, get state() { return state; }, get frame() { return frame; } };
}

async function waitFor(fn, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await sleep(200);
  }
  throw new Error(`${what} did not happen within ${timeoutMs}ms`);
}

function findElement(state, predicate) {
  return (state.elements ?? []).find(predicate) ?? null;
}

// ---------- families ----------
/**
 * A Chromium browser driving the parity page. The page reports its own state
 * to a loopback server, so "did the keystroke land" is answered outside the
 * tool surface entirely.
 */
function chromiumFamily({ id, label, family, binary }) {
  return {
    id, label, family,
    async run(record) {
      if (!fs.existsSync(binary)) return record.untested(`not installed at ${binary}`);
      const page = await pageServer();
      const profile = fs.mkdtempSync(path.join(scratch, "profile-"));
      const proc = spawn(binary, [
        `--user-data-dir=${profile}`, `--app=http://127.0.0.1:${page.port}/browser.html`,
        "--window-size=1000,800", "--window-position=0,60",
        "--no-first-run", "--no-default-browser-check", "--disable-features=Translate",
        "--force-renderer-accessibility",
      ], { stdio: "ignore", detached: true });
      try {
        await waitFor(async () => page.frame, 30_000, `${label} window`);
        await tool("open_application", { pid: proc.pid, activate: false });
        const before = frontmost();

        const state = await waitFor(async () => {
          const s = await tool("get_app_state", { app_ref: { pid: proc.pid } });
          return (s.elements ?? []).length > 20 ? s : null;
        }, 20_000, `${label} accessibility tree`);
        record.observable(state.elements.length);

        // Keyboard: focus the unicode input through accessibility, then type.
        const input = findElement(state, (e) => e.label === "unicode" || e.role === "AXTextField");
        if (!input) return record.untested("no text field in the accessibility tree");
        await tool("left_click", { target: { type: "element", state_id: state.state_id, index: input.index }, strategy: "a11y" });
        await sleep(300);
        await tool("type", { text: MARKER });
        await sleep(500);
        record.keyboard(page.state?.uni === MARKER || page.state?.name === MARKER, `page reported uni=${JSON.stringify(page.state?.uni)}`);

        // Pointer: press a button by accessibility, with no cursor and no activation.
        const fresh = await tool("get_app_state", { app_ref: { pid: proc.pid } });
        const tab = findElement(fresh, (e) => e.label === "Tab B");
        if (tab) {
          const click = await tool("left_click", { target: { type: "element", state_id: fresh.state_id, index: tab.index }, strategy: "a11y" });
          await sleep(400);
          record.a11yClick(page.state?.tab === "B", `strategy=${click.strategy} tab=${page.state?.tab}`);
        } else {
          record.a11yClick(null, "no labelled button in the tree");
        }
        record.foreground(before, frontmost());
      } finally {
        killTree(proc);
        await sleep(300);
      }
    },
  };
}

/** A plain AppKit application: the parity native fixture, which writes its own oracle. */
const appkitFamily = {
  id: "appkit", label: "AppKit (parity native fixture)", family: "native AppKit",
  async run(record) {
    const bin = build("native-fixture", path.join(PARITY, "fixtures", "native-macos.m"));
    const stateFile = path.join(scratch, `appkit-${crypto.randomBytes(3).toString("hex")}.json`);
    const proc = spawn(bin, [stateFile], { stdio: "ignore", detached: true });
    const read = () => { try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { return null; } };
    try {
      await waitFor(async () => read()?.origin, 20_000, "AppKit fixture");
      await tool("open_application", { pid: proc.pid, activate: false });
      const before = frontmost();
      const state = await tool("get_app_state", { app_ref: { pid: proc.pid } });
      record.observable((state.elements ?? []).length);

      const field = findElement(state, (e) => e.role === "AXTextField" && (e.value ?? "") === "");
      if (!field) return record.untested("no empty text field in the accessibility tree");
      await tool("left_click", { target: { type: "element", state_id: state.state_id, index: field.index }, strategy: "a11y" });
      await sleep(300);
      await tool("type", { text: MARKER });
      await sleep(500);
      record.keyboard(read()?.entry === MARKER, `fixture reported entry=${JSON.stringify(read()?.entry)}`);

      const fresh = await tool("get_app_state", { app_ref: { pid: proc.pid } });
      const apply = findElement(fresh, (e) => e.label === "Apply");
      const click = await tool("left_click", { target: { type: "element", state_id: fresh.state_id, index: apply.index }, strategy: "a11y" });
      await sleep(400);
      record.a11yClick(read()?.applied === MARKER, `strategy=${click.strategy} applied=${JSON.stringify(read()?.applied)}`);
      record.foreground(before, frontmost());
    } finally {
      killTree(proc);
      await sleep(300);
    }
  },
};

/** Tk: a toolkit that draws its own widgets and exposes almost no accessibility. */
const tkFamily = {
  id: "tk", label: "Tk (python3 tkinter)", family: "Tk",
  async run(record) {
    if (sh("python3", ["-c", "import tkinter"]).code !== 0) return record.untested("python3 has no tkinter");
    const stateFile = path.join(scratch, `tk-${crypto.randomBytes(3).toString("hex")}.json`);
    const proc = spawn("python3", [path.join(PARITY, "fixtures", "native.py"), stateFile], { stdio: "ignore", detached: true });
    const read = () => { try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { return null; } };
    try {
      await waitFor(async () => read()?.origin, 20_000, "Tk fixture");
      await tool("open_application", { pid: proc.pid, activate: false });
      const before = frontmost();
      const state = await tool("get_app_state", { app_ref: { pid: proc.pid } });
      record.observable((state.elements ?? []).length);

      // No AX text field exists, so aim the pointer at the entry by coordinates.
      const origin = read().origin;
      const shot = await tool("screenshot", { app_ref: { pid: proc.pid } });
      const px = (cx, cy) => ({
        type: "coordinate",
        x: Math.round((origin[0] + cx - shot.points.x) * shot.scale),
        y: Math.round((origin[1] + cy - shot.points.y) * shot.scale),
      });
      const click = await tool("left_click", { target: px(200, 40) });
      await sleep(300);
      await tool("type", { text: MARKER });
      await sleep(600);
      record.keyboard(read()?.entry === MARKER, `fixture reported entry=${JSON.stringify(read()?.entry)}`);
      record.a11yClick(false, `strategy=${click.strategy}${click.a11y_reason ? ` (${click.a11y_reason})` : ""}`);
      record.foreground(before, frontmost());
    } finally {
      killTree(proc);
      await sleep(300);
    }
  },
};

/** Electron: VS Code on a scratch profile, editing a scratch file. The oracle is the saved file. */
const electronFamily = {
  id: "electron", label: "Electron (Visual Studio Code)", family: "Electron",
  async run(record) {
    const binary = "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
    if (!fs.existsSync(binary)) return record.untested("Visual Studio Code is not installed");
    const dir = fs.mkdtempSync(path.join(scratch, "code-"));
    const file = path.join(dir, "codewhale-background-input.txt");
    fs.writeFileSync(file, "");
    const proc = spawn(binary, [
      "--user-data-dir", path.join(dir, "user"), "--extensions-dir", path.join(dir, "ext"),
      "--disable-workspace-trust", "--skip-release-notes", "--disable-updates", "--new-window", file,
    ], { stdio: "ignore", detached: true });
    try {
      const state = await waitFor(async () => {
        try {
          const s = await tool("get_app_state", { app_ref: { pid: proc.pid } });
          return (s.elements ?? []).length > 5 ? s : null;
        } catch { return null; }
      }, 60_000, "VS Code window");
      await tool("open_application", { pid: proc.pid, activate: false });
      const before = frontmost();
      record.observable(state.elements.length);

      // VS Code renders its editor on a canvas and exposes no editable
      // accessibility element, so the caret — which it puts in the file it was
      // asked to open — is the only way in. That is also the realistic case:
      // type, save, and let the file on disk say whether the keys landed.
      const editor = findElement(state, (e) => e.role === "AXTextArea") ?? findElement(state, (e) => e.role === "AXTextField");
      if (editor) {
        await tool("left_click", { target: { type: "element", state_id: state.state_id, index: editor.index }, strategy: "a11y" });
        await sleep(400);
      }
      await sleep(6000);   // the editor takes the caret several seconds after first paint
      await tool("type", { text: MARKER });
      await sleep(900);
      await tool("key", { text: "cmd+s" });
      await sleep(2500);
      const saved = fs.readFileSync(file, "utf8");
      record.keyboard(saved.includes(MARKER),
        `saved file contains ${JSON.stringify(saved.slice(0, 40))}; editable accessibility element: ${editor ? editor.role : "none (roles: " + [...new Set(state.elements.map((e) => e.role))].slice(0, 6).join(", ") + ")"}`);
      record.a11yClick(null, "no pressable control with an oracle in an empty editor window");
      record.foreground(before, frontmost());
    } finally {
      killTree(proc);
      await sleep(500);
    }
  },
};

const javaFamily = {
  id: "java", label: "Java (Swing/AWT)", family: "Java",
  async run(record) {
    const home = sh("/usr/libexec/java_home", []);
    if (home.code !== 0) return record.untested("no Java runtime installed on this host (/usr/libexec/java_home finds none)");
    return record.untested("a Java runtime exists but no Swing fixture is built here");
  },
};

const FAMILIES = [
  appkitFamily,
  chromiumFamily({ id: "chrome", label: "Google Chrome", family: "browser (Chromium)", binary: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }),
  chromiumFamily({ id: "chromium", label: "Chromium", family: "Chromium-based app", binary: "/Applications/Chromium.app/Contents/MacOS/Chromium" }),
  electronFamily,
  tkFamily,
  javaFamily,
];

// ---------- run ----------
const results = [];
for (const fam of FAMILIES) {
  if (only && fam.id !== only) continue;
  const row = { id: fam.id, label: fam.label, family: fam.family, notes: [] };
  const record = {
    untested: (why) => { row.verdict = "untested"; row.reason = why; },
    observable: (n) => { row.observable_elements = n; },
    keyboard: (ok, detail) => { row.keyboard_background = ok; row.notes.push(`keyboard: ${detail}`); },
    a11yClick: (ok, detail) => { row.a11y_click_background = ok; row.notes.push(`a11y click: ${detail}`); },
    foreground: (before, after) => { row.foreground_before = before; row.foreground_after = after; row.foreground_preserved = before === after; },
  };
  process.stdout.write(`${fam.label} … `);
  try {
    await fam.run(record);
  } catch (e) {
    row.error = String(e.message ?? e).slice(0, 300);
  }
  if (!row.verdict) {
    const claims = [row.keyboard_background, row.a11y_click_background].filter((v) => v != null);
    row.verdict = row.error ? "untested"
      : claims.length === 0 ? "untested"
      : claims.every((v) => v === true) ? "verified live"
      : claims.every((v) => v === false) ? "verified failed-closed"
      : "partial";
  }
  if (row.error && !row.reason) row.reason = row.error;
  results.push(row);
  console.log(`${row.verdict}${row.reason ? ` (${row.reason.slice(0, 90)})` : ""}`);
}

server.stdin.end();
await once(server, "exit");
for (const c of cleanups) { try { c(); } catch {} }
try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}

fs.mkdirSync(OUT, { recursive: true });
const receipt = {
  date: new Date().toISOString(),
  host: `${process.platform} ${os.release()}`,
  macos: sh("sw_vers", ["-productVersion"]).stdout.trim(),
  commit: sh("git", ["rev-parse", "HEAD"], { env: {} }).stdout.trim(),
  git_dirty: sh("git", ["status", "--porcelain"], { env: {} }).stdout.trim().length > 0,
  claim: "with the application bound by open_application(activate:false): observed, typed into, and pressed, without bringing it forward",
  rows: results,
};
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(receipt, null, 2));
console.log(`\nreceipt: ${path.join(OUT, "results.json")}`);
process.exitCode = results.some((r) => r.error) ? 1 : 0;
