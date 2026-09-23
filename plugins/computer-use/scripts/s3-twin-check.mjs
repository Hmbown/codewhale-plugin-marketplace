#!/usr/bin/env node
// S3 acceptance against the codewhale-computing Docker twin (or a real seat).
// Run INSIDE the computer as the Engine's user, e.g.:
//   docker cp . cw-twin:/tmp/cu && docker exec -u cw-engine -e DISPLAY=:1 \
//     -e XAUTHORITY=/run/cw/Xauthority cw-twin node /tmp/cu/scripts/s3-twin-check.mjs
// Checks: the agent's navigation shows in the shared (visible) Chromium; a tab
// the person opens appears in the agent's targets; under a human lease input
// is refused (computer_busy_human_driving) and screenshots still work; after
// hand-back input works; stop detaches without closing anything.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOCK = process.env.CODEWHALE_CU_BROWSER_ATTACH || "/run/cw/cdp.sock";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "s3-"));
const LEASE = path.join(work, "lease.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
const writeLease = (obj) => { fs.writeFileSync(`${LEASE}.tmp`, JSON.stringify(obj)); fs.renameSync(`${LEASE}.tmp`, LEASE); };
const x = (...args) => execFileSync("xdotool", args, { encoding: "utf8" }).trim();

const site = http.createServer((req, res) => {
  const name = req.url.replace(/[^a-z]/g, "") || "root";
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!doctype html><title>S3 ${name} page</title><body style="font:40px sans-serif"><button id=b onclick="document.title='S3 clicked'">${name}</button></body>`);
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${site.address().port}`;

const server = spawn(process.execPath, [path.join(ROOT, "mcp/server.mjs")], {
  env: { ...process.env, CODEWHALE_CU_BROWSER_ATTACH: SOCK, CODEWHALE_CU_LEASE_FILE: LEASE, CODEWHALE_CU_APP: "off", CODEWHALE_CU_APP_WARM: "off",
    CODEWHALE_CU_STATE_DIR: path.join(work, "state"), CODEWHALE_CU_RECORDINGS_DIR: path.join(work, "rec") },
  stdio: ["pipe", "pipe", "inherit"],
});
let buf = ""; const pending = new Map(); let id = 0;
server.stdout.on("data", (c) => { buf += c; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); pending.get(m.id)?.(m); } });
const rpc = (method, params) => new Promise((r) => { const n = ++id; pending.set(n, r); server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: n, method, params })}\n`); });
const tool = async (name, args = {}) => JSON.parse((await rpc("tools/call", { name, arguments: args })).result.content[0].text);

try {
  await rpc("initialize", { protocolVersion: "2025-06-18" });
  writeLease({ holder: "agent", since: new Date().toISOString(), generation: 1 });

  let r = await tool("browser", { action: "start", url: `${base}/agent` });
  check("attach to the shared Chromium (no launch)", r.ok && r.attached === true && r.launched === false, `${r.browser} tab=${r.tab?.url} ${r.error?.message ?? ""}`);
  await sleep(800);
  const title = x("getactivewindow", "getwindowname");
  check("agent navigation is on the visible display", /S3 agent page/.test(title), `active X window: "${title}"`);

  // The person opens a tab with their own keyboard on the shared display.
  x("key", "--clearmodifiers", "ctrl+t"); await sleep(600);
  x("type", "--delay", "20", `${base}/human`); x("key", "Return"); await sleep(1500);
  r = await tool("browser", { action: "status" });
  check("a tab the person opened is in the agent's targets", r.ok && r.tabs?.some((t) => t.url === `${base}/human`), JSON.stringify(r.tabs?.map((t) => t.url)));

  r = await tool("screenshot");
  check("desktop screenshot as the agent", r.ok === true, r.error?.message ?? `${r.pixels?.w}x${r.pixels?.h}`);

  writeLease({ holder: "human", since: new Date().toISOString(), expires_at: null, generation: 2 });
  r = await tool("click", { target: { type: "coordinate", x: 700, y: 400 } });
  check("click refused under the human lease", r.error?.code === "computer_busy_human_driving", r.error?.code);
  r = await tool("browser", { action: "click", selector: "#b" });
  check("browser click refused under the human lease", r.error?.code === "computer_busy_human_driving", r.error?.code);
  r = await tool("screenshot");
  check("screenshot still works under the human lease", r.ok === true, r.error?.message ?? "");
  r = await tool("browser", { action: "screenshot" });
  check("browser screenshot still works under the human lease", r.ok === true, r.error?.message ?? "");

  writeLease({ holder: "agent", since: new Date().toISOString(), generation: 3 });
  r = await tool("browser", { action: "click", selector: "#b" });
  check("after hand-back, browser click works", r.ok === true, r.error?.message ?? "");
  await sleep(300);
  r = await tool("browser", { action: "status" });
  check("the click took effect", r.activeTab?.title === "S3 clicked", r.activeTab?.title);
  r = await tool("screenshot");
  r = await tool("click", { target: { type: "coordinate", x: 5, y: 5 } });
  check("after hand-back, desktop click is dispatched", r.ok === true, r.error?.code ?? "");

  const before = (await tool("browser", { action: "status" })).tabs?.length;
  r = await tool("browser", { action: "stop" });
  check("stop only detaches", r.ok && r.detached === true && r.browser_closed === false);
  r = await tool("browser", { action: "start" });
  const after = (await tool("browser", { action: "status" })).tabs?.length;
  check("the person's browser and tabs survive the agent stopping", r.ok && after >= before, `tabs before=${before} after=${after}`);
  await tool("browser", { action: "stop" });
} finally {
  server.kill(); site.close();
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(failures ? `S3 TWIN CHECKS FAILED: ${failures}` : "ALL S3 TWIN CHECKS PASSED");
process.exit(failures ? 1 : 0);
