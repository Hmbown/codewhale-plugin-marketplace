#!/usr/bin/env node
// chromewhale MCP server — zero-dependency JSON-RPC 2.0 over stdio.
//
// It owns no browser of its own. Every tool call is handed to the Codewhale for Chrome
// side panel over the loopback bridge (`src/bridge.mjs`), and the panel decides
// whether it may touch the page at all: pause, active tab, scheme, the user's
// per-origin decision, and Chrome's own host permission. This process is the
// part that makes those tools visible to Codewhale; it is not the part that
// makes them safe.
//
// Putting the tools here rather than in the extension is the whole point of the
// plugin shape. Tools that arrive over MCP go through Codewhale's normal tool
// path — permission profiles, approval prompts, `tool_search`, policy
// filtering — and the plugin's own trust review covers the authority the bundle
// declares. An extension that registered its tools directly with the runtime
// would bypass all of that, because runtime dynamic tools register as
// `ApprovalRequirement::Auto` and never reach the approval gate.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import { createBridge } from "../src/bridge.mjs";
import { normalizeContent } from "../src/content.mjs";
import { recordEndpoint, resolveEndpoint } from "../src/pairing.mjs";
import { SERVER_NAME, TOOLS, annotationsFor, isTool } from "../src/tools.mjs";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const VERSION = readVersion();

/** stderr only: stdout is the JSON-RPC transport and must stay clean. */
const log = (line) => process.stderr.write(`[chromewhale] ${line}\n`);

let endpoint;
try {
  endpoint = resolveEndpoint();
} catch (error) {
  // Misconfiguration fails loud, at load: a bad port is self-contained and
  // there is nothing useful this process can do with one.
  log(String(error instanceof Error ? error.message : error));
  process.exit(2);
}

const bridge = createBridge({
  token: endpoint.token,
  host: endpoint.host,
  port: endpoint.port,
  version: VERSION,
  onLog: log,
  // Whichever server owns the port records where, so `/chromewhale status`
  // reads the real endpoint instead of assuming the default.
  onOwner: (live) => recordEndpoint({ ...live, token: endpoint.token, version: VERSION }),
});
// A second Codewhale session does not fail here: it forwards to the owner.
await bridge.listen();
if (endpoint.source === "created") {
  log("a new pairing token was generated; run /chromewhale token to print it for the side panel");
}

// ---------- JSON-RPC ----------

const HANDLERS = {
  /** @param {{protocolVersion?: string}} [params] */
  initialize(params) {
    return {
      protocolVersion: params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: VERSION },
    };
  },

  "tools/list"() {
    return {
      tools: TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: annotationsFor(tool),
      })),
    };
  },

  /**
   * @param {{name?: string, arguments?: Record<string, unknown>}} [params]
   * @param {AbortSignal} [signal] aborted by `notifications/cancelled`
   */
  async "tools/call"(params, signal) {
    const name = params?.name;
    if (!isTool(name)) {
      return errorResult(`chromewhale has no tool named "${String(name ?? "")}".`);
    }
    const args = params?.arguments && typeof params.arguments === "object" ? params.arguments : {};
    const answer = await bridge.call(name, args, { signal });
    const content = normalizeContent(answer?.content);
    return {
      content: content.length ? content : [{ type: "text", text: answer?.success ? "(no output)" : "The panel returned no detail." }],
      isError: answer?.success !== true,
    };
  },

  ping() {
    return {};
  },

  "notifications/initialized"() {
    return {};
  },

  /**
   * The host gave up on a request. For a tool call that means the panel must
   * not act on it any more, even if the user is about to click Allow.
   *
   * @param {{requestId?: string | number}} [params]
   */
  "notifications/cancelled"(params) {
    inflight.get(params?.requestId)?.abort();
    return {};
  },
};

/** Tool calls in progress, by JSON-RPC id, so a cancellation can reach them. */
const inflight = new Map();
HANDLERS.initialized = HANDLERS["notifications/initialized"];

/** @param {string} text */
function errorResult(text) {
  return { content: [{ type: "text", text }], isError: true };
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

/** @param {string} line */
async function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return respondError(null, -32700, "parse error");
  }
  const { id, method, params } = message ?? {};
  // Own properties only: a method named "toString" must not reach the prototype.
  const handler = typeof method === "string" && Object.hasOwn(HANDLERS, method) ? HANDLERS[method] : undefined;
  if (!handler) {
    // A notification (no id) that we do not implement is simply ignored;
    // answering one would itself be a protocol error.
    if (id == null) {
      return undefined;
    }
    return respondError(id, -32601, `method "${method}" is not implemented`);
  }
  const controller = id != null ? new AbortController() : undefined;
  if (controller) {
    inflight.set(id, controller);
  }
  try {
    const result = await handler(params, controller?.signal);
    if (id != null) {
      respond(id, result);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (id != null) {
      respondError(id, -32603, detail);
    } else {
      log(`notification ${method} failed: ${detail}`);
    }
  } finally {
    if (id != null) {
      inflight.delete(id);
    }
  }
  return undefined;
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) {
      void handleLine(line);
    }
  }
});

const shutdown = async () => {
  await bridge.close();
  process.exit(0);
};
process.stdin.on("end", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "plugin.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
