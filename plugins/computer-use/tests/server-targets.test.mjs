// Target-pipeline tests: real MCP server over stdio with an injected fake
// backend (CODEWHALE_CU_TEST_BACKEND) so raster math and element
// revalidation can be asserted against the exact args the backend receives.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cu-tgt-state-"));
const recDir = fs.mkdtempSync(path.join(os.tmpdir(), "cu-tgt-rec-"));
const callsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cu-tgt-")), "calls.jsonl");
const controlFile = callsFile + ".control.json";

let server;
let buf = "";
const pending = new Map();
let nextId = 1;

function rpc(method, params, timeoutMs = 30_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`timeout: ${method}`)); }, timeoutMs);
    pending.set(id, (msg) => { clearTimeout(t); resolve(msg); });
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function rpcId(method, params) {
  const id = nextId++;
  const p = new Promise((resolve) => pending.set(id, resolve));
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return { id, p };
}

function notify(method, params) {
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

async function tool(name, args = {}) {
  const res = await rpc("tools/call", { name, arguments: args });
  assert.ok(res.result, `${name}: protocol error ${JSON.stringify(res.error ?? {})}`);
  return JSON.parse(res.result.content[0].text);
}

function calls(method) {
  if (!fs.existsSync(callsFile)) return [];
  return fs.readFileSync(callsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((c) => c.method === method);
}

function setControl(obj) {
  if (obj == null) fs.rmSync(controlFile, { force: true });
  else fs.writeFileSync(controlFile, JSON.stringify(obj));
}

before(async () => {
  server = spawn("node", [path.join(ROOT, "mcp", "server.mjs")], {
    env: {
      ...process.env,
      CODEWHALE_CU_APP: "off",
      CODEWHALE_CU_STATE_DIR: stateDir,
      CODEWHALE_CU_RECORDINGS_DIR: recDir,
      CODEWHALE_CU_TEST_BACKEND: path.join(__dirname, "fixtures", "fake-backend.mjs"),
      FAKE_BACKEND_CALLS: callsFile,
      FAKE_BACKEND_CONTROL: controlFile,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  server.stdout.setEncoding("utf8");
  server.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      } catch {}
    }
  });
  const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
  assert.equal(init.result.serverInfo.name, "codewhale-cu");
});

after(() => {
  server?.kill("SIGTERM");
  for (const d of [stateDir, recDir, path.dirname(callsFile)]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
});

test("app-state arguments distinguish an omitted reference from an explicit null", async () => {
  await tool("get_app_state", {});
  assert.equal(Object.hasOwn(calls("get_app_state").at(-1).args, "app_ref"), false);
  await tool("get_app_state", { app_ref: null });
  assert.equal(calls("get_app_state").at(-1).args.app_ref, null);
});

test("summary preserves readable UI and original target indices while full retains tree structure", async () => {
  for (const detail of [undefined, "summary", "compact"]) {
    const state = await tool("get_app_state", { detail });
    assert.equal(state.detail, "summary");
    assert.deepEqual(state.elements.map(e => e.index), [0, 1, 2, 3, 6, 7, 8]);
    assert.ok(state.elements.every(e => !("path" in e) && !("windowIndex" in e)));
    const field = state.elements.find(e => e.index === 8);
    assert.deepEqual(field, { index: 8, role: "AXTextField", value: "Fixture text", focused: true, enabled: true, actions: ["AXConfirm"], position: { x: 10, y: 60 }, size: { w: 150, h: 25 } });
    const action = await tool("perform_action", { target: { type: "element", state_id: state.state_id, index: 1 }, action: "AXPress" });
    assert.equal(action.ok, true, JSON.stringify(action));
    assert.deepEqual(calls("perform_action").at(-1).args.target.path, [0, 1]);
    assert.equal(calls("perform_action").at(-1).args.target.windowIndex, 0);
  }
  const full = await tool("get_app_state", { detail: "full" });
  assert.equal(full.elements.length, 9);
  assert.deepEqual(full.elements.find(e => e.label === "Save").path, [0, 0, 0]);
  assert.equal(full.elements.find(e => e.label === "Save").windowIndex, -1);
  const summary = await tool("get_app_state", {});
  setControl({ found: true, element: { role: "AXTextField", position: { x: 10, y: 60 }, size: { w: 150, h: 25 } } });
  try {
    const changed = await tool("set_value", { target: { type: "element", state_id: summary.state_id, index: 8 }, value: "Changed" });
    assert.equal(changed.ok, true, JSON.stringify(changed));
    assert.deepEqual(calls("set_value").at(-1).args.target.path, [0, 2], "sparse public index still addresses the original cached text field");
  } finally { setControl(null); }
  assert.equal((await tool("get_app_state", { detail: "guess" })).error.code, "bad_args");
  assert.equal((await tool("get_app_state", { window_id: -1 })).error.code, "bad_args");
  assert.equal((await tool("get_app_state", { window_id: 0.5 })).error.code, "bad_args");
  assert.equal((await tool("get_app_state", { include_ocr: "yes" })).error.code, "bad_args");
});

test("optional OCR binds its exact raster for coordinate actions while preserving AX state", async () => {
  const state = await tool("get_app_state", { include_ocr: true });
  assert.equal(state.ok, true);
  assert.equal(state.ocr.status, "ok");
  assert.ok(state.elements.some(e => e.index === 8 && e.value === "Fixture text"));
  assert.equal(state.ocr.blocks[0].role, undefined, "recognized text is not a fabricated semantic element");
  const clicked = await tool("left_click", { target: state.ocr.blocks[0].target });
  assert.equal(clicked.ok, true);
  assert.deepEqual(calls("left_click").at(-1).args.target, { type: "coordinate", x: 140, y: 70, strategy: "event" });
  assert.equal((await tool("left_click", { target: { type: "coordinate", x: 400, y: 0 } })).error.code, "target_outside_raster");
  const unavailable = await tool("get_app_state", { include_ocr: true, app_ref: { name: "OCR unavailable" } });
  assert.equal(unavailable.ok, true);
  assert.equal(unavailable.ocr.status, "unavailable");
  assert.ok(unavailable.elements.length > 0);
  assert.equal((await tool("get_app_state", {})).ocr, undefined, "normal observations do not request OCR");
});

test("coordinate targets map raster pixels through the bound scale", async () => {
  const shot = await tool("screenshot");
  assert.equal(shot.ok, true);
  assert.deepEqual(shot.pixels, { w: 1600, h: 1200 });
  const r = await tool("left_click", { target: { type: "coordinate", x: 400, y: 300 } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const last = calls("left_click").at(-1);
  assert.deepEqual({ x: last.args.target.x, y: last.args.target.y }, { x: 200, y: 150 });
});

test("region screenshots bind the region origin for later coordinates", async () => {
  const shot = await tool("screenshot", { region: [50, 40, 400, 200] });
  assert.equal(shot.ok, true);
  const r = await tool("left_click", { target: { type: "coordinate", x: 100, y: 60 } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const last = calls("left_click").at(-1);
  // origin (50,40) + pixel (100,60) / scale 2 -> (100, 70)
  assert.deepEqual({ x: last.args.target.x, y: last.args.target.y }, { x: 100, y: 70 });
});

test("zoom binds a child raster that keeps parent scale and shifted origin", async () => {
  await tool("screenshot"); // rebind the full 1600x1200 @ scale 2 raster
  const z = await tool("zoom", { region: [100, 100, 200, 200] });
  assert.equal(z.ok, true, JSON.stringify(z.error));
  const r = await tool("left_click", { target: { type: "coordinate", x: 10, y: 10 } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const last = calls("left_click").at(-1);
  // origin 0 + (100 + 10) / 2 = 55
  assert.deepEqual({ x: last.args.target.x, y: last.args.target.y }, { x: 55, y: 55 });
});

test("zoom without a bound raster fails with no_raster", async () => {
  // Fresh computer id has no raster — hdc "pad" registered with no state.
  const reg = await tool("computer_register", { computer: "pad", transport: "hdc" });
  assert.equal(reg.ok, true);
  const z = await tool("zoom", { region: [0, 0, 10, 10], computer: "pad" });
  assert.equal(z.ok, false);
  assert.equal(z.error.code, "no_raster");
  await tool("computer_remove", { computer: "pad" });
});

test("coordinate outside the bound raster fails with target_outside_raster", async () => {
  await tool("screenshot"); // 1600x1200 bound
  const r = await tool("left_click", { target: { type: "coordinate", x: 2000, y: 10 } });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "target_outside_raster");
  assert.match(r.error.message, /1600x1200/);
  assert.equal(calls("left_click").filter((c) => c.args.target.x === 2000).length, 0, "backend must not be called");
});

async function freshState() {
  const st = await tool("get_app_state", { app_ref: { name: "FakeApp" } });
  assert.equal(st.ok, true, JSON.stringify(st.error));
  assert.ok(st.state_id);
  return st;
}

test("element targets are revalidated; moved geometry re-aims and marks the receipt", async () => {
  const st = await freshState();
  setControl({ found: true, element: { role: "AXButton", label: "OK", position: { x: 100, y: 200 }, size: { w: 60, h: 30 } }, reason: null });
  try {
    const r = await tool("left_click", { target: { type: "element", state_id: st.state_id, index: 1 } });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.target_reacquired, true);
    const last = calls("left_click").at(-1);
    assert.deepEqual({ x: last.args.target.x, y: last.args.target.y }, { x: 130, y: 215 }); // fresh center
    assert.deepEqual(last.args.target.path, [0, 1], "pointer dispatch retains the original element path");
    assert.equal(last.args.target.windowIndex, 0);
    assert.equal(last.args.target.label, "OK");
  } finally {
    setControl(null);
  }
});

test("unmoved element geometry does not mark the receipt reacquired", async () => {
  const st = await freshState();
  setControl(null); // fake returns the cached geometry for element 1
  const r = await tool("left_click", { target: { type: "element", state_id: st.state_id, index: 1 } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.notEqual(r.target_reacquired, true);
  const last = calls("left_click").at(-1);
  assert.deepEqual({ x: last.args.target.x, y: last.args.target.y }, { x: 40, y: 35 });
});

test("stale element fails element_stale without touching the pointer", async () => {
  const st = await freshState();
  setControl({ found: false, element: null, reason: "element_gone" });
  const before = calls("left_click").length;
  try {
    const r = await tool("left_click", { target: { type: "element", state_id: st.state_id, index: 1 } });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "element_stale");
    assert.match(r.error.message, /element 1/);
    assert.equal(calls("left_click").length, before, "backend pointer must not be called");
  } finally {
    setControl(null);
  }
});

test("in-place replacement (same geometry, different label) fails element_stale", async () => {
  const st = await freshState();
  setControl({ found: true, element: { role: "AXButton", label: "Confirm", position: { x: 10, y: 20 }, size: { w: 60, h: 30 } }, reason: null });
  const before = calls("left_click").length;
  try {
    const r = await tool("left_click", { target: { type: "element", state_id: st.state_id, index: 1 } });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "element_stale");
    assert.match(r.error.message, /changed label \(OK → Confirm\)/);
    assert.equal(calls("left_click").length, before, "backend pointer must not be called");
  } finally {
    setControl(null);
  }
});

test("an element losing its label or role is stale even if the geometry matches", async () => {
  const st = await freshState();
  const before = calls("left_click").length;
  try {
    for (const identity of [{ role: "AXButton", label: "" }, { role: "AXButton" }, { label: "OK" }]) {
      setControl({ found: true, element: { ...identity, position: { x: 10, y: 20 }, size: { w: 60, h: 30 } } });
      const r = await tool("left_click", { target: { type: "element", state_id: st.state_id, index: 1 } });
      assert.equal(r.ok, false);
      assert.equal(r.error.code, "element_stale");
    }
    assert.equal(calls("left_click").length, before);
  } finally { setControl(null); }
});

test("a state_id issued on another computer fails state_wrong_computer", async () => {
  const st = await freshState(); // bound to "local"
  const reg = await tool("computer_register", { computer: "other-pad", transport: "hdc" });
  assert.equal(reg.ok, true);
  try {
    const r = await tool("left_click", { computer: "other-pad", target: { type: "element", state_id: st.state_id, index: 1 } });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "state_wrong_computer");
  } finally {
    await tool("computer_remove", { computer: "other-pad" });
    await tool("computer_switch", { computer: "local" });
  }
});

test("notifications/cancelled drops the in-flight response but not the server", async () => {
  const { id, p } = rpcId("tools/call", { name: "wait", arguments: { seconds: 3 } });
  await new Promise((r) => setTimeout(r, 200));
  notify("notifications/cancelled", { requestId: id });
  const winner = await Promise.race([
    p.then((m) => ({ got: true, m })),
    new Promise((r) => setTimeout(() => r({ got: false }), 4_000)),
  ]);
  assert.equal(winner.got, false, "cancelled request must not produce a response");
  const ping = await rpc("ping", {});
  assert.deepEqual(ping.result, {});
});
