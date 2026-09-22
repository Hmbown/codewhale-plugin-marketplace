import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawn } from "node:child_process";

import { TOOL_NAMES } from "../src/tools.mjs";

const SERVER = url.fileURLToPath(new URL("../mcp/server.mjs", import.meta.url));

/**
 * Spawn the real server and speak newline-delimited JSON-RPC to it.
 *
 * This is the only suite that proves the thing Codewhale actually launches
 * starts, binds, and answers — the unit suites all reach past it.
 */
function startServer(extraEnv = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "chromewhale-mcp-"));
  // A high random port keeps parallel runs (and a real bridge on 8899) out of
  // the way. Nothing connects to it in these tests; the point is that binding
  // succeeds and tool calls refuse cleanly with no panel attached.
  const port = String(20_000 + Math.floor(Math.random() * 20_000));
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, CHROMEWHALE_STATE_DIR: stateDir, CHROMEWHALE_BRIDGE_PORT: port },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = "";
  const queue = [];
  /** @type {Array<{id: number, resolve: (value: any) => void}>} */
  const waiters = [];
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) {
        continue;
      }
      const message = JSON.parse(line);
      const waiter = waiters.findIndex((w) => w.id === message.id);
      if (waiter !== -1) {
        waiters.splice(waiter, 1)[0].resolve(message);
      } else {
        queue.push(message);
      }
    }
  });

  let nextId = 1;
  /**
   * @param {string} method
   * @param {unknown} [params]
   */
  function request(method, params) {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    const found = queue.findIndex((message) => message.id === id);
    if (found !== -1) {
      return Promise.resolve(queue.splice(found, 1)[0]);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer to ${method}\nstderr:\n${stderr}`)), 10_000);
      waiters.push({
        id,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  }

  return {
    request,
    notify: (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`),
    stderr: () => stderr,
    stop: () => new Promise((resolve) => {
      child.once("exit", resolve);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }),
  };
}

test("the server initializes and advertises exactly the page_* surface", async () => {
  const server = startServer();
  try {
    const initialized = await server.request("initialize", { protocolVersion: "2025-06-18" });
    assert.equal(initialized.result.serverInfo.name, "chromewhale");
    assert.equal(initialized.result.protocolVersion, "2025-06-18");
    assert.deepEqual(initialized.result.capabilities.tools, { listChanged: false });

    const listed = await server.request("tools/list");
    const names = listed.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, [...TOOL_NAMES]);
    for (const tool of listed.result.tools) {
      assert.equal(typeof tool.description, "string");
      assert.equal(tool.inputSchema.type, "object");
      assert.equal(tool.annotations.openWorldHint, true, "these tools reach the open web");
    }
    const snapshot = listed.result.tools.find((tool) => tool.name === "page_snapshot");
    assert.equal(snapshot.annotations.readOnlyHint, true);
    assert.equal(
      listed.result.tools.find((tool) => tool.name === "page_click").annotations.readOnlyHint,
      false,
    );
  } finally {
    await server.stop();
  }
});

test("a tool call with no panel attached returns an error result, not a protocol error", async () => {
  const server = startServer();
  try {
    await server.request("initialize", {});
    const called = await server.request("tools/call", { name: "page_snapshot", arguments: {} });
    assert.equal(called.error, undefined, "a refusal is a result the model reads, not a JSON-RPC failure");
    assert.equal(called.result.isError, true);
    assert.match(called.result.content[0].text, /No Chromewhale panel is attached/);
  } finally {
    await server.stop();
  }
});

test("an unknown tool name is refused by name", async () => {
  const server = startServer();
  try {
    await server.request("initialize", {});
    const called = await server.request("tools/call", { name: "page_teleport", arguments: {} });
    assert.equal(called.result.isError, true);
    assert.match(called.result.content[0].text, /no tool named "page_teleport"/);
  } finally {
    await server.stop();
  }
});

test("an unknown method answers with method-not-found, and an unknown notification is ignored", async () => {
  const server = startServer();
  try {
    await server.request("initialize", {});
    const unknown = await server.request("resources/list");
    assert.equal(unknown.error.code, -32601);

    // A notification carries no id; answering one would itself be a protocol
    // error. The next request still gets through, which is how we know the
    // loop did not wedge.
    server.notify("notifications/somethingElse");
    const ping = await server.request("ping");
    assert.deepEqual(ping.result, {});
  } finally {
    await server.stop();
  }
});

test("stdout carries only JSON-RPC; diagnostics go to stderr", async () => {
  const server = startServer();
  try {
    await server.request("initialize", {});
    // Any stray console.log in the server would have broken the parser above,
    // so reaching here proves stdout is clean. Assert the other half: the
    // bridge's startup line is on stderr where a host will not choke on it.
    assert.match(server.stderr(), /\[chromewhale\] bridge listening on 127\.0\.0\.1:\d+/);
  } finally {
    await server.stop();
  }
});

test("a malformed port stops the server at load rather than serving nowhere", async () => {
  const server = startServer();
  await server.stop();

  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, CHROMEWHALE_BRIDGE_PORT: "not-a-port" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(code, 2, "misconfiguration exits, it does not limp along");
  assert.match(stderr, /CHROMEWHALE_BRIDGE_PORT/);
});
