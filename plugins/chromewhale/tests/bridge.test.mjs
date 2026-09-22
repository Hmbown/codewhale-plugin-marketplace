import assert from "node:assert/strict";
import test from "node:test";

import { createBridge } from "../src/bridge.mjs";

const TOKEN = "a".repeat(64);

/**
 * Start a bridge on an ephemeral port.
 *
 * Port 0 lets the OS choose, so these suites never collide with a real bridge
 * or with each other. `status().baseUrl` reports where it actually landed.
 */
async function start(options = {}) {
  const bridge = createBridge({ token: TOKEN, host: "127.0.0.1", port: 0, ...options });
  await bridge.listen();
  return bridge;
}

/** @param {ReturnType<typeof createBridge>} bridge */
function baseUrlOf(bridge) {
  return bridge.status().baseUrl;
}

test("a request without the pairing token is refused, and says how to fix it", async () => {
  const bridge = await start();
  const base = baseUrlOf(bridge);
  try {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error, "unauthorized");
    assert.match(body.detail, /\/chromewhale/);
  } finally {
    await bridge.close();
  }
});

test("a wrong token of the same length is refused too", async () => {
  const bridge = await start();
  const base = baseUrlOf(bridge);
  try {
    const response = await fetch(`${base}/health`, {
      headers: { Authorization: `Bearer ${"b".repeat(64)}` },
    });
    assert.equal(response.status, 401);
  } finally {
    await bridge.close();
  }
});

test("a call with no panel attached fails immediately and names the fix", async () => {
  const bridge = await start();
  try {
    const started = Date.now();
    const result = await bridge.call("page_snapshot", {});
    assert.equal(result.success, false);
    assert.match(result.content[0].text, /No Chromewhale panel is attached/);
    assert.ok(Date.now() - started < 1_000, "it must not wait out the call timeout");
  } finally {
    await bridge.close();
  }
});

test("a call reaches the attached panel and its result comes back", async () => {
  const bridge = await start();
  const base = baseUrlOf(bridge);
  const panel = await attach(base);
  try {
    const pending = bridge.call("page_click", { ref: "e4" });
    const frame = await panel.next("call");
    assert.equal(frame.tool, "page_click");
    assert.deepEqual(frame.args, { ref: "e4" });
    assert.equal(frame.summary, "click e4", "the server owns the human-readable summary");
    assert.ok(Number.isFinite(frame.budget), "the snapshot budget travels with every call");

    const accepted = await fetch(`${base}/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ id: frame.id, success: true, content: [{ type: "text", text: "clicked" }] }),
    });
    assert.equal(accepted.status, 202);

    const result = await pending;
    assert.equal(result.success, true);
    assert.deepEqual(result.content, [{ type: "text", text: "clicked" }]);
  } finally {
    panel.close();
    await bridge.close();
  }
});

test("a result for an unknown call is refused, not silently accepted", async () => {
  const bridge = await start();
  const base = baseUrlOf(bridge);
  const panel = await attach(base);
  try {
    const response = await fetch(`${base}/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ id: "not-a-call", success: true, content: [] }),
    });
    assert.equal(response.status, 404);
  } finally {
    panel.close();
    await bridge.close();
  }
});

test("a second panel supersedes the first, and the first is told why", async () => {
  const bridge = await start();
  const base = baseUrlOf(bridge);
  const first = await attach(base);
  const second = await attach(base);
  try {
    const notice = await first.next("superseded");
    assert.match(notice.detail, /Only the newest panel/);
    assert.equal(bridge.status().paired, true);

    // The live panel is the second one: a call must reach it, not the corpse.
    const pending = bridge.call("page_snapshot", {});
    const frame = await second.next("call");
    assert.equal(frame.tool, "page_snapshot");
    await fetch(`${base}/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ id: frame.id, success: true, content: [] }),
    });
    assert.equal((await pending).success, true);
  } finally {
    first.close();
    second.close();
    await bridge.close();
  }
});

test("a panel that disconnects mid-call fails that call instead of stranding it", async () => {
  const bridge = await start();
  const base = baseUrlOf(bridge);
  const panel = await attach(base);
  const pending = bridge.call("page_snapshot", {});
  await panel.next("call");
  panel.close();
  try {
    const result = await pending;
    assert.equal(result.success, false);
    assert.match(result.content[0].text, /panel closed before page_snapshot/);
  } finally {
    await bridge.close();
  }
});

test("a call the panel never answers times out with a readable reason", async () => {
  const bridge = await start({ timeoutMs: 120 });
  const base = baseUrlOf(bridge);
  const panel = await attach(base);
  try {
    const result = await bridge.call("page_snapshot", {});
    assert.equal(result.success, false);
    assert.match(result.content[0].text, /did not answer page_snapshot/);
    assert.equal(bridge.status().pending, 0, "a timed-out call must not leak");
  } finally {
    panel.close();
    await bridge.close();
  }
});

test("health reports whether a panel is actually attached", async () => {
  const bridge = await start();
  const base = baseUrlOf(bridge);
  const before = await (await fetch(`${base}/health`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
  assert.equal(before.paired, false);
  const panel = await attach(base);
  try {
    const after = await (await fetch(`${base}/health`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
    assert.equal(after.paired, true);
    assert.equal(after.service, "chromewhale");
  } finally {
    panel.close();
    await bridge.close();
  }
});

test("an unknown route is a 404, not a hang", async () => {
  const bridge = await start();
  const base = baseUrlOf(bridge);
  try {
    const response = await fetch(`${base}/anything`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(response.status, 404);
  } finally {
    await bridge.close();
  }
});

/**
 * Attach to `/calls` the way the panel does and expose the frames as a queue.
 *
 * @param {string} base
 */
async function attach(base) {
  const controller = new AbortController();
  const response = await fetch(`${base}/calls`, {
    headers: { Accept: "text/event-stream", Authorization: `Bearer ${TOKEN}` },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const queue = [];
  /** @type {Array<(frame: any) => void>} */
  const waiters = [];

  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) {
            continue;
          }
          const parsed = JSON.parse(line.slice(6));
          const waiter = waiters.findIndex((w) => w.type === parsed.type);
          if (waiter !== -1) {
            waiters.splice(waiter, 1)[0].resolve(parsed);
          } else {
            queue.push(parsed);
          }
        }
      }
    } catch {
      // Aborted on close; nothing to report.
    }
  })();

  // The stream opens with a `ready` frame; consume it so tests start clean.
  const ready = await nextOf("ready");
  assert.equal(ready.type, "ready");

  /** @param {string} type */
  function nextOf(type) {
    const found = queue.findIndex((frame) => frame.type === type);
    if (found !== -1) {
      return Promise.resolve(queue.splice(found, 1)[0]);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no "${type}" frame arrived`)), 4_000);
      waiters.push({
        type,
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
      });
    });
  }

  return { next: nextOf, close: () => controller.abort() };
}
