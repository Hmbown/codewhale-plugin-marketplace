#!/usr/bin/env node
// A disposable AppKit app behind the user's work; effects come from its own
// oracle, foreground/pointer samples from an independent observer with a 10 ms polling interval.
// No activation, shared pointer input, recording, or user app cleanup.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import crypto from "node:crypto";

if (process.platform !== "darwin") throw new Error("macOS is required");
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const bundleAt = process.argv.indexOf("--bundle");
const bundle = bundleAt >= 0 ? path.resolve(process.argv[bundleAt + 1]) : null;
const root = bundle ? path.join(bundle, "Contents", "Resources", "plugin") : repoRoot;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cu-background-"));
const outAt = process.argv.indexOf("--out");
const output = outAt >= 0 ? path.resolve(process.argv[outAt + 1]) : path.join(scratch, "receipt.json");
const receipt = { source: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
  dirty: !!execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim(),
  sourceHashes: Object.fromEntries(["mcp/server.mjs", "src/backends/darwin.mjs", "src/backends/darwin-accessibility.m"].map(rel=>[rel,crypto.createHash("sha256").update(fs.readFileSync(path.join(root,rel))).digest("hex")])),
  startedAt: new Date().toISOString(), route: bundle ? "packaged-daemon-mcp" : "direct-source-mcp", checks: [], actions: [], samples: [] };
const children = [];
let sampling = true;
const start = (cmd, args, options) => { const child = spawn(cmd, args, options); children.push(child); return child; };
const compile = (source, name) => {
  const bin = path.join(scratch, name);
  execFileSync("clang", ["-fobjc-arc", "-Os", "-framework", "Cocoa", path.join(repoRoot, source), "-o", bin]);
  return bin;
};
async function until(read, description) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) { const result = read(); if (result) return result; await delay(50); }
  throw new Error(`Timed out: ${description}`);
}
const parseLines = (stream, consume) => {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", chunk => { buffer += chunk; let at;
    while ((at = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, at); buffer = buffer.slice(at + 1); if (line) consume(JSON.parse(line)); }
  });
};
try {
  const probe = start(compile("parity/darwin-probe.m", "probe"), ["--watch"], { stdio: ["ignore", "pipe", "inherit"] });
  parseLines(probe.stdout, sample => { if (sampling) receipt.samples.push(sample); });
  const initial = await until(() => {
    if(probe.exitCode !== null || probe.signalCode !== null) throw new Error(`Desktop observer exited: ${probe.signalCode ?? probe.exitCode}`);
    return receipt.samples[0];
  }, "desktop observer");
  const oracleFile = path.join(scratch, "state.json");
  const fixture = start(compile("parity/fixtures/native-macos.m", "fixture"), [oracleFile, "--background"], { stdio: "ignore" });
  const oracle = () => { try { return JSON.parse(fs.readFileSync(oracleFile, "utf8")); } catch { return null; } };
  await until(() => oracle()?.origin, "background fixture");
  assert.notEqual(initial.frontmost_pid, fixture.pid);
  receipt.targetPid = fixture.pid;
  const env = { ...process.env, CODEWHALE_CU_APP: bundle ? "on" : "off", CODEWHALE_CU_STATE_DIR: path.join(scratch, "state"), CODEWHALE_CU_RECORDINGS_DIR: scratch, CODEWHALE_CU_APP_WARM: "off" };
  delete env.CODEWHALE_CU_APP_SOCKET;
  delete env.CODEWHALE_CU_TEST_BACKEND;
  delete env.CODEWHALE_CU_TEST_REMOTE;
  delete env.CODEWHALE_CU_APP_BUNDLE;
  if (bundle) {
    env.CODEWHALE_CU_APP_BUNDLE = bundle;
    start(process.execPath, [path.join(root, "app/daemon.mjs")], { env, stdio: ["ignore", "ignore", "inherit"] });
    await until(()=>fs.existsSync(path.join(env.CODEWHALE_CU_STATE_DIR,"app-run.json")),"isolated packaged daemon");
  }
  const server = start(process.execPath, [path.join(root, "mcp/server.mjs")], {
    env,
    stdio: ["pipe", "pipe", "inherit"],
  });
  let seq = 0;
  const pending = new Map();
  parseLines(server.stdout, message => pending.get(message.id)?.(message));
  const tool = async (name, args = {}) => {
    const id = ++seq;
    const message = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${name} timeout`)); }, 70_000);
      pending.set(id, result => { clearTimeout(timeout); pending.delete(id); resolve(result); });
      server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
    });
    const data = JSON.parse(message.result?.content?.find(item => item.type === "text")?.text ?? "null");
    if (!["get_app_state", "screenshot"].includes(name)) receipt.actions.push({ name, data });
    assert.ok(data?.ok, `${name}: ${JSON.stringify(data ?? message.error)}`);
    return data;
  };
  const observe = () => tool("get_app_state"); // must stay on the bound background app
  const target = (state, predicate) => {
    const element = state.elements.find(predicate);
    assert.ok(element, "expected accessible control");
    return { type: "element", state_id: state.state_id, index: element.index };
  };
  await tool("open_application", { pid: fixture.pid, activate: false });
  let state = await observe();
  assert.equal(state.pid, fixture.pid);
  receipt.checks.push("unqualified observation follows the selected background app");
  await tool("left_click", { target: target(state, e => e.role === "AXTextField" && e.value === "") });
  await tool("type", { text: "Background café 🐋" });
  await until(() => oracle()?.entry === "Background café 🐋", "Unicode input in target");
  state = await observe();
  await tool("left_click", { target: target(state, e => e.label === "Apply") });
  await until(() => oracle()?.applied === "Background café 🐋", "Apply button effect");
  receipt.checks.push("background field focus, Unicode typing and Apply button confirmed by fixture file");
  state = await observe();
  await tool("scroll", { target: target(state, e => e.role === "AXScrollArea"), direction: "down", amount: 5 });
  await until(() => oracle()?.scroll_top > 0, "background scroll effect");
  receipt.checks.push("background scroll confirmed by native scroll-view offset");
  state = await observe();
  const shot = await tool("screenshot"); // no app_ref: default must capture only fixture
  assert.equal(shot.app_ref.pid, fixture.pid, "capture receipt names the exact selected process");
  assert.ok(shot.points.w < initial.display.points.w, "default capture is the app window");
  receipt.checks.push("default screenshot captures the background app window");
  await tool("stop_computer_control");
  await delay(100);
  const interference = receipt.samples.filter(sample => sample.frontmost_pid !== initial.frontmost_pid || sample.pointer.x !== initial.pointer.x || sample.pointer.y !== initial.pointer.y);
  receipt.sampleCount = receipt.samples.length;
  receipt.foregroundPid = initial.frontmost_pid;
  receipt.pointer = initial.pointer;
  receipt.interferenceSamples = interference.length;
  receipt.foregroundChanges = receipt.samples.filter(sample => sample.frontmost_pid !== initial.frontmost_pid).length;
  // A physical user move invalidates isolation evidence too; it is never
  // silently attributed to the agent or counted as a passing trial.
  assert.equal(interference.length, 0, "foreground or cursor changed during the trial; inspect the samples");
  receipt.checks.push("independent foreground/cursor observer saw no foreground or pointer change");
  receipt.ok = true;
} catch (error) {
  receipt.ok = false;
  receipt.error = error.stack;
  process.exitCode = 1;
} finally {
  sampling = false;
  // Let MCP close its leased session while the daemon is still available.
  // Stopping both at once would manufacture a cleanup failure after a good trial.
  for (const child of children.reverse()) if (child.exitCode === null && child.signalCode === null) {
    await new Promise(resolve => {
      const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
      child.kill("SIGTERM");
    });
  }
  receipt.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ ...receipt, samples: undefined, actions: undefined, output }, null, 2));
}
