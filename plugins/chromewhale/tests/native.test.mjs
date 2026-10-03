import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawn } from "node:child_process";

import { createBridge } from "../src/bridge.mjs";
import { MessageReader, encodeMessage } from "../src/native.mjs";
import { recordEndpoint, resolveEndpoint } from "../src/pairing.mjs";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

test("Native Messaging frames round-trip, split anywhere", () => {
  const messages = [{ type: "hello" }, { type: "result", id: "x", content: [{ type: "text", text: "é🐋".repeat(100) }] }];
  const wire = Buffer.concat(messages.map(encodeMessage));
  const reader = new MessageReader();
  const seen = [];
  for (let i = 0; i < wire.length; i += 7) {
    seen.push(...reader.push(wire.subarray(i, i + 7)));
  }
  assert.deepEqual(seen, messages);
  assert.equal(wire.readUInt32LE(0), Buffer.byteLength(JSON.stringify(messages[0])));
});

test("a message over Chrome's 1 MiB limit is refused rather than sent", () => {
  assert.throws(() => encodeMessage({ text: "x".repeat(1024 * 1024) }), /capped/);
});

test("the host relays bridge calls to the panel and results back, and forwards cancels", async (t) => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "chromewhale-native-"));
  const env = { CHROMEWHALE_STATE_DIR: state };
  const endpoint = resolveEndpoint(env);
  const bridge = createBridge({
    token: endpoint.token,
    host: "127.0.0.1",
    port: 0,
    version: "test",
    onOwner: (live) => recordEndpoint({ ...live, token: endpoint.token }, env),
  });
  await bridge.listen();
  const host = spawn(process.execPath, [path.join(ROOT, "bin", "native-host.mjs")], {
    env: { ...process.env, CHROMEWHALE_STATE_DIR: state },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(async () => {
    host.kill();
    await bridge.close();
  });
  const reader = new MessageReader();
  const inbox = [];
  const waiters = [];
  host.stdout.on("data", (chunk) => {
    for (const message of reader.push(chunk)) {
      const i = waiters.findIndex((w) => w.test(message));
      if (i >= 0) waiters.splice(i, 1)[0].resolve(message);
      else inbox.push(message);
    }
  });
  const next = (test) => {
    const i = inbox.findIndex(test);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no matching message from the host")), 5_000);
      waiters.push({ test, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    });
  };
  const send = (message) => host.stdin.write(encodeMessage(message));

  assert.equal((await next((m) => m.type === "hello")).version, JSON.parse(fs.readFileSync(path.join(ROOT, "plugin.json"))).version);
  await next((m) => m.type === "status" && m.kind === "attached");
  assert.equal(bridge.status().paired, true, "the host attached to the bridge with the signed handshake");

  const pending = bridge.call("page_snapshot", {});
  const call = await next((m) => m.type === "call");
  assert.equal(call.tool, "page_snapshot");
  assert.ok(Number.isFinite(call.deadline));
  send({ type: "result", id: call.id, success: true, content: [{ type: "text", text: "from the panel" }] });
  const result = await pending;
  assert.equal(result.success, true);
  assert.equal(result.content[0].text, "from the panel");

  const abort = new AbortController();
  const cancelled = bridge.call("page_click", { ref: "e1" }, { signal: abort.signal });
  const second = await next((m) => m.type === "call");
  abort.abort();
  assert.equal((await next((m) => m.type === "cancel")).id, second.id);
  assert.equal((await cancelled).success, false);
  send({ type: "result", id: second.id, success: false, content: [{ type: "text", text: "dropped" }] });

  host.stdin.end();
  const code = await new Promise((resolve) => host.on("exit", resolve));
  assert.equal(code, 0, "the host exits when Chrome closes the port");
});
