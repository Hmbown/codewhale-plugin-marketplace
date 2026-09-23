import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createBridge } from "../src/bridge.mjs";
import { bridgeMessage, mac, newNonce, signedAuthorization } from "../src/pairing.mjs";

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
    assert.match(result.content[0].text, /No Codewhale for Chrome panel is attached/);
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

// --- several servers, one port (CW-2) --------------------------------------

test("a second server on a taken port forwards to the owner, and its call reaches the owner's panel", async () => {
  const port = await freePort();
  const owner = createBridge({ token: TOKEN, host: "127.0.0.1", port });
  assert.equal(await owner.listen(), true);
  const second = createBridge({ token: TOKEN, host: "127.0.0.1", port });
  const panel = await attach(`http://127.0.0.1:${port}`);
  try {
    assert.equal(await second.listen(), true, "a taken port held by our own bridge is not a failure");
    assert.equal(second.status().mode, "forwarding");
    assert.equal(second.status().ownerPid, process.pid, "the owner is named by pid");

    const pending = second.call("page_snapshot", {});
    const frame = await panel.next("call");
    assert.equal(frame.tool, "page_snapshot");
    await postResult(port, frame.id, [{ type: "text", text: "the page", untrusted: true }]);
    const result = await pending;
    assert.equal(result.success, true);
    assert.deepEqual(result.content, [{ type: "text", text: "the page", untrusted: true }]);
  } finally {
    panel.close();
    await second.close();
    await owner.close();
  }
});

test("when the owner exits, the next forwarded call takes the port over and waits for the panel", async () => {
  const port = await freePort();
  const owner = createBridge({ token: TOKEN, host: "127.0.0.1", port });
  await owner.listen();
  const second = createBridge({ token: TOKEN, host: "127.0.0.1", port, takeoverGraceMs: 4_000 });
  await second.listen();
  assert.equal(second.status().mode, "forwarding");
  await owner.close();

  // The panel reconnects on its own backoff; simulate it arriving shortly
  // after the takeover.
  const panelArrives = (async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        return await attach(`http://127.0.0.1:${port}`);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error("the panel never reattached");
  })();
  const pending = second.call("page_snapshot", {});
  const panel = await panelArrives;
  try {
    const frame = await panel.next("call");
    await postResult(port, frame.id, [{ type: "text", text: "ok" }]);
    assert.equal((await pending).success, true);
    assert.equal(second.status().mode, "owner", "the survivor now owns the port");
  } finally {
    panel.close();
    await second.close();
  }
});

test("a port held by a Codewhale for Chrome bridge with another token is refused, naming its pid", async () => {
  const port = await freePort();
  const owner = createBridge({ token: TOKEN, host: "127.0.0.1", port });
  await owner.listen();
  const stranger = createBridge({ token: "c".repeat(64), host: "127.0.0.1", port });
  try {
    assert.equal(await stranger.listen(), false);
    const result = await stranger.call("page_snapshot", {});
    assert.equal(result.success, false);
    assert.match(result.content[0].text, new RegExp(`another Codewhale for Chrome bridge \\(pid ${process.pid}\\)`));
    assert.match(result.content[0].text, /different pairing token/);
  } finally {
    await stranger.close();
    await owner.close();
  }
});

test("a port held by some other program is refused as not a Codewhale for Chrome bridge", async () => {
  const port = await freePort();
  const squatter = http.createServer((req, res) => res.end("hello"));
  await new Promise((resolve) => squatter.listen(port, "127.0.0.1", resolve));
  const bridge = createBridge({ token: TOKEN, host: "127.0.0.1", port });
  try {
    assert.equal(await bridge.listen(), false);
    assert.equal(bridge.status().mode, "down");
    const result = await bridge.call("page_snapshot", {});
    assert.equal(result.success, false);
    assert.match(result.content[0].text, /not a Codewhale for Chrome bridge/);
    assert.match(result.content[0].text, /CHROMEWHALE_BRIDGE_PORT/);
  } finally {
    await bridge.close();
    await new Promise((resolve) => squatter.close(resolve));
  }
});

test("a forwarded call for a tool that does not exist is refused by the owner", async () => {
  const bridge = await start();
  try {
    const answer = await raw(bridge.status().port, {
      method: "POST",
      path: "/invoke",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "page_teleport", args: {} }),
    });
    assert.equal(answer.status, 400);
  } finally {
    await bridge.close();
  }
});

// --- who may talk to the bridge (CW-9) -------------------------------------

test("a request carrying a web Origin is refused even with the right token", async () => {
  const bridge = await start();
  const port = bridge.status().port;
  try {
    const web = await raw(port, { headers: { Authorization: `Bearer ${TOKEN}`, Origin: "https://evil.test" } });
    assert.equal(web.status, 403);
    assert.equal(JSON.parse(web.body).error, "forbidden_origin");
    const nullOrigin = await raw(port, { headers: { Authorization: `Bearer ${TOKEN}`, Origin: "null" } });
    assert.equal(nullOrigin.status, 403, "a sandboxed page's null origin is still a web page");
    const extension = await raw(port, {
      headers: { Authorization: `Bearer ${TOKEN}`, Origin: `chrome-extension://${"a".repeat(32)}` },
    });
    assert.equal(extension.status, 200, "the extension itself is let through");
  } finally {
    await bridge.close();
  }
});

test("a Host header that is not our loopback address and port is refused (DNS rebinding)", async () => {
  const bridge = await start();
  const port = bridge.status().port;
  try {
    for (const host of [`evil.test:${port}`, "127.0.0.1:1", `10.0.0.1:${port}`, "127.0.0.1"]) {
      const answer = await raw(port, { headers: { Authorization: `Bearer ${TOKEN}`, Host: host } });
      assert.equal(answer.status, 403, `Host ${host} must be refused`);
    }
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
      const answer = await raw(port, { headers: { Authorization: `Bearer ${TOKEN}`, Host: host } });
      assert.equal(answer.status, 200, `Host ${host} is ours`);
    }
  } finally {
    await bridge.close();
  }
});

test("the ready frame and health carry the plugin version", async () => {
  const bridge = createBridge({ token: TOKEN, host: "127.0.0.1", port: 0, version: "9.9.9" });
  await bridge.listen();
  const port = bridge.status().port;
  try {
    const health = JSON.parse((await raw(port, { headers: { Authorization: `Bearer ${TOKEN}` } })).body);
    assert.equal(health.version, "9.9.9");
    assert.equal(health.pid, process.pid);
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/calls`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: controller.signal,
    });
    const reader = response.body.getReader();
    const { value } = await reader.read();
    controller.abort();
    assert.match(new TextDecoder().decode(value), /"type":"ready".*"version":"9\.9\.9"/);
  } finally {
    await bridge.close();
  }
});

/** A port that was free a moment ago. */
test("a signed request gets a proven reply, and its nonce cannot be used twice", async () => {
  const bridge = await start();
  const base = baseUrlOf(bridge);
  try {
    const { nonce } = await (await fetch(`${base}/challenge`)).json();
    const cnonce = newNonce();
    const authorization = signedAuthorization(TOKEN, "GET", "/health", nonce, cnonce);
    const first = await fetch(`${base}/health`, { headers: { Authorization: authorization } });
    assert.equal(first.status, 200);
    const { proof, ...body } = await first.json();
    assert.equal(proof, mac(TOKEN, bridgeMessage(nonce, cnonce, JSON.stringify(body))), "the reply proves the token");
    const replayed = await fetch(`${base}/health`, { headers: { Authorization: authorization } });
    assert.equal(replayed.status, 401, "a nonce is single-use");
    const { nonce: other } = await (await fetch(`${base}/challenge`)).json();
    const forged = signedAuthorization("f".repeat(64), "GET", "/health", other, newNonce());
    assert.equal((await fetch(`${base}/health`, { headers: { Authorization: forged } })).status, 401);
  } finally {
    await bridge.close();
  }
});

test("every call carries a deadline, and a timeout tells the panel to drop it", async () => {
  // Longer than the 3 s margin the panel keeps before the bridge gives up.
  const bridge = await start({ timeoutMs: 3_500 });
  const panel = await attach(baseUrlOf(bridge));
  try {
    const started = Date.now();
    const pending = bridge.call("page_snapshot", {});
    const frame = await panel.next("call");
    assert.ok(frame.deadline > started && frame.deadline < started + 3_500, "the panel must stop before the bridge gives up");
    const cancel = await panel.next("cancel");
    assert.equal(cancel.id, frame.id);
    assert.match((await pending).content[0].text, /told not to act on it/);
  } finally {
    panel.close();
    await bridge.close();
  }
});

test("a host cancellation reaches the panel at once", async () => {
  const bridge = await start();
  const panel = await attach(baseUrlOf(bridge));
  try {
    const abort = new AbortController();
    const pending = bridge.call("page_click", { ref: "e1" }, { signal: abort.signal });
    const frame = await panel.next("call");
    abort.abort();
    assert.equal((await panel.next("cancel")).id, frame.id);
    const result = await pending;
    assert.equal(result.success, false);
    assert.match(result.content[0].text, /host cancelled/);
    assert.equal(bridge.status().pending, 0);
  } finally {
    panel.close();
    await bridge.close();
  }
});

test("a call sent to a panel that is then superseded fails at once", async () => {
  const bridge = await start();
  const base = baseUrlOf(bridge);
  const first = await attach(base);
  try {
    const started = Date.now();
    const pending = bridge.call("page_snapshot", {});
    await first.next("call");
    const second = await attach(base);
    const result = await pending;
    assert.match(result.content[0].text, /took over before page_snapshot finished/);
    assert.ok(Date.now() - started < 2_000, "not at the call timeout");
    second.close();
  } finally {
    first.close();
    await bridge.close();
  }
});

test("a port holder that claims to be a bridge but cannot prove the token gets no calls", async () => {
  const port = await freePort();
  let invoked = false;
  const impostor = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/challenge") {
      return res.end(JSON.stringify({ service: "chromewhale", nonce: newNonce() }));
    }
    if (req.url === "/invoke") {
      invoked = true;
    }
    res.end(JSON.stringify({ ok: true, service: "chromewhale", pid: 1, result: { success: true, content: [{ type: "text", text: "trust me" }] } }));
  });
  await new Promise((resolve) => impostor.listen(port, "127.0.0.1", resolve));
  const bridge = createBridge({ token: TOKEN, host: "127.0.0.1", port });
  try {
    assert.equal(await bridge.listen(), false);
    const result = await bridge.call("page_snapshot", {});
    assert.equal(result.success, false);
    assert.match(result.content[0].text, /could not prove/);
    assert.equal(invoked, false, "the call itself never went to the impostor");
  } finally {
    await bridge.close();
    await new Promise((resolve) => impostor.close(resolve));
  }
});

test("a forwarded call the owner received before vanishing is not run a second time", async () => {
  const port = await freePort();
  // A genuine owner (it holds the token and proves it) that dies mid-call.
  const owner = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/challenge") {
      return res.end(JSON.stringify({ service: "chromewhale", nonce: newNonce() }));
    }
    const header = /nonce=([0-9a-f]+),cnonce=([0-9a-f]+)/.exec(req.headers.authorization ?? "");
    if (req.url === "/health" && header) {
      const body = { ok: true, service: "chromewhale", version: "0", pid: 4242, paired: true, pending: 0 };
      return res.end(JSON.stringify({ ...body, proof: mac(TOKEN, bridgeMessage(header[1], header[2], JSON.stringify(body))) }));
    }
    if (req.url === "/invoke") {
      // Received the call, then the whole process went away.
      req.socket.destroy();
      owner.close();
      owner.closeAllConnections();
    }
  });
  await new Promise((resolve) => owner.listen(port, "127.0.0.1", resolve));
  const sibling = createBridge({ token: TOKEN, host: "127.0.0.1", port, takeoverGraceMs: 50 });
  try {
    assert.equal(await sibling.listen(), true, "the sibling adopts the proven owner");
    const result = await sibling.call("page_click", { ref: "e1" });
    assert.equal(result.success, false);
    assert.match(result.content[0].text, /Whether it acted is unknown/);
    assert.doesNotMatch(result.content[0].text, /No Codewhale for Chrome panel is attached/, "it was not re-run locally");
  } finally {
    await sibling.close();
  }
});

async function freePort() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = /** @type {import("node:net").AddressInfo} */ (probe.address());
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/**
 * @param {number} port
 * @param {string} id
 * @param {unknown[]} content
 */
async function postResult(port, id, content) {
  const response = await fetch(`http://127.0.0.1:${port}/results`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ id, success: true, content }),
  });
  assert.equal(response.status, 202);
}

/**
 * A request with full control of headers (fetch will not forge Host).
 *
 * @param {number} port
 * @param {{method?: string, path?: string, headers?: Record<string, string>, body?: string}} options
 * @returns {Promise<{status: number, body: string}>}
 */
function raw(port, { method = "GET", path = "/health", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        text += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
    });
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

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
