// The loopback bridge between the MCP server and the Chrome side panel.
//
// Direction of travel matters here: the MCP server needs to *push* a call to
// the extension and get an answer back, but a Chrome extension cannot listen on
// a socket. So the extension dials in and holds one SSE stream (`GET /calls`),
// the server writes calls onto it, and the extension answers with `POST
// /results`. That is the same shape the Codewhale runtime uses for its own
// event stream, which is why the extension can reuse its SSE parser and this
// file needs nothing but `node:http`.
//
// Deliberately not a WebSocket: Node ships a WebSocket *client*, not a server,
// so a WS bridge would mean hand-rolling RFC 6455 framing or taking a
// dependency — for a channel that only ever pushes small JSON objects one way
// and takes answers back over plain POST.
//
// Known limitations:
// - **One panel at a time.** A second subscriber supersedes the first, which is
//   then told why and disconnected. Two panels driving one tab is a race with no
//   good outcome, so the bridge picks the most recent and says so out loud.
// - **No queue.** A call raised while nothing is subscribed fails immediately
//   with an explanation rather than waiting for a panel that may never open.
//   The model gets a sentence it can act on instead of a stalled turn.
// - **No replay.** If the panel disconnects mid-call, that call fails. Calls are
//   side-effecting actions on a live page; silently re-running one against a
//   page that has since changed would be worse than failing.

import http from "node:http";
import crypto from "node:crypto";

import { bearerOf, tokenMatches } from "./pairing.mjs";
import { CALL_TIMEOUT_MS, SNAPSHOT_CHAR_BUDGET, describeCall } from "./tools.mjs";

/** Largest result body the extension may POST back (screenshots dominate). */
const MAX_RESULT_BYTES = 12 * 1024 * 1024;
const HEARTBEAT_MS = 20_000;

/**
 * @param {{token: string, host: string, port: number,
 *          timeoutMs?: number, onLog?: (line: string) => void}} options
 */
export function createBridge(options) {
  const { token, host, port } = options;
  const timeoutMs = options.timeoutMs ?? CALL_TIMEOUT_MS;
  const log = options.onLog ?? (() => {});

  /** @type {{res: import("node:http").ServerResponse, id: string, since: number} | undefined} */
  let panel;
  /** @type {Map<string, {resolve: Function, timer: NodeJS.Timeout, name: string}>} */
  const pending = new Map();
  /** @type {NodeJS.Timeout | undefined} */
  let heartbeat;
  /** @type {Error | undefined} */
  let listenError;
  /**
   * The port actually bound, which is not always the one requested: port 0
   * asks the OS to choose. Reported by `status()` so `/chromewhale status` can
   * tell the user where to point the panel rather than repeating the request.
   */
  let boundPort = port;

  const server = http.createServer(handle);
  server.on("error", (error) => {
    listenError = error;
    log(`bridge cannot listen on ${host}:${port} — ${error.message}`);
  });

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  function handle(req, res) {
    // No CORS headers are ever sent and OPTIONS is never answered: the only
    // legitimate client is the extension, which holds a host permission for
    // this origin and is not subject to CORS. A web page that tries is refused
    // by the browser before it can read anything, and by the token before it
    // can write anything.
    if (!tokenMatches(bearerOf(req.headers.authorization), token)) {
      return send(res, 401, {
        error: "unauthorized",
        detail: "Chromewhale's bridge needs its pairing token. Run /chromewhale in Codewhale to print it, then paste it into the side panel's Settings.",
      });
    }
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        ok: true,
        service: "chromewhale",
        paired: Boolean(panel),
        pending: pending.size,
      });
    }
    if (req.method === "GET" && url.pathname === "/calls") {
      return subscribe(res);
    }
    if (req.method === "POST" && url.pathname === "/results") {
      return receiveResult(req, res);
    }
    return send(res, 404, { error: "not_found", detail: `No bridge route for ${req.method} ${url.pathname}.` });
  }

  /** @param {import("node:http").ServerResponse} res */
  function subscribe(res) {
    const previous = panel;
    const id = crypto.randomUUID();
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    panel = { res, id, since: Date.now() };
    write(res, { type: "ready", panel: id });
    log(`panel ${id.slice(0, 8)} attached`);

    if (previous) {
      write(previous.res, {
        type: "superseded",
        detail: "Another Chromewhale panel attached to this bridge. Only the newest panel receives calls.",
      });
      previous.res.end();
      log(`panel ${previous.id.slice(0, 8)} superseded`);
    }

    res.on("close", () => {
      if (panel?.id === id) {
        panel = undefined;
        log(`panel ${id.slice(0, 8)} detached`);
        // Every call in flight was aimed at that panel; nothing else can
        // answer them, so fail them now rather than at the timeout.
        for (const [callId, entry] of [...pending]) {
          settle(callId, {
            success: false,
            content: [{ type: "text", text: `The Chromewhale panel closed before ${entry.name} finished. Ask the user to reopen it.` }],
          });
        }
      }
    });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  function receiveResult(req, res) {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    let aborted = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_RESULT_BYTES) {
        aborted = true;
        send(res, 413, { error: "too_large", detail: `Results are capped at ${MAX_RESULT_BYTES} bytes.` });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) {
        return;
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (error) {
        return send(res, 400, { error: "bad_json", detail: String(error) });
      }
      const callId = typeof body?.id === "string" ? body.id : "";
      if (!pending.has(callId)) {
        // Already settled, timed out, or never ours. Not an error worth
        // escalating — the model has been told something either way.
        return send(res, 404, { error: "unknown_call", detail: `Call ${callId || "(missing id)"} is not pending.` });
      }
      settle(callId, {
        success: body?.success === true,
        content: Array.isArray(body?.content) ? body.content : [],
      });
      return send(res, 202, { accepted: true });
    });
  }

  /**
   * @param {string} callId
   * @param {{success: boolean, content: Array<Record<string, unknown>>}} result
   */
  function settle(callId, result) {
    const entry = pending.get(callId);
    if (!entry) {
      return;
    }
    pending.delete(callId);
    clearTimeout(entry.timer);
    entry.resolve(result);
  }

  return {
    /** Start listening. Resolves even on failure; `status()` reports it. */
    listen() {
      return new Promise((resolve) => {
        server.once("listening", () => {
          const address = server.address();
          if (address && typeof address === "object") {
            boundPort = address.port;
          }
          heartbeat = setInterval(() => {
            if (panel) {
              write(panel.res, { type: "heartbeat" });
            }
          }, HEARTBEAT_MS);
          heartbeat.unref?.();
          log(`bridge listening on ${host}:${boundPort}`);
          resolve(true);
        });
        server.once("error", () => resolve(false));
        server.listen(port, host);
      });
    },

    close() {
      clearInterval(heartbeat);
      panel?.res.end();
      panel = undefined;
      for (const [callId] of [...pending]) {
        settle(callId, {
          success: false,
          content: [{ type: "text", text: "Chromewhale's bridge shut down before this call finished." }],
        });
      }
      return new Promise((resolve) => server.close(() => resolve(undefined)));
    },

    status() {
      return {
        listening: server.listening,
        paired: Boolean(panel),
        pending: pending.size,
        host,
        port: boundPort,
        baseUrl: `http://${host}:${boundPort}`,
        error: listenError ? listenError.message : undefined,
      };
    },

    /**
     * Send one call to the attached panel and wait for its answer.
     *
     * @param {string} name
     * @param {Record<string, unknown>} args
     * @returns {Promise<{success: boolean, content: Array<Record<string, unknown>>}>}
     */
    call(name, args) {
      if (listenError) {
        return Promise.resolve(refusal(
          `Chromewhale's bridge could not listen on ${host}:${port} (${listenError.message}). ` +
          "Free that port or set CHROMEWHALE_BRIDGE_PORT, then restart Codewhale.",
        ));
      }
      if (!panel) {
        return Promise.resolve(refusal(
          "No Chromewhale panel is attached. Ask the user to open the Chromewhale side panel in Chrome " +
          "(toolbar button) and check that its bridge token matches — /chromewhale prints it.",
        ));
      }
      const callId = crypto.randomUUID();
      const target = panel;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          settle(callId, refusal(
            `The Chromewhale panel did not answer ${name} within ${Math.round(timeoutMs / 1000)}s. ` +
            "It may be waiting on the user to allow this site.",
          ));
        }, timeoutMs);
        timer.unref?.();
        const summary = describeCall(name, args);
        pending.set(callId, { resolve, timer, name });
        log(`→ ${name}: ${summary}`);
        // `summary` and `budget` travel with the call so the panel needs no
        // copy of the tool catalog: the server owns what the tools are, the
        // panel owns whether they may touch the page.
        write(target.res, {
          type: "call",
          id: callId,
          tool: name,
          args,
          summary,
          budget: SNAPSHOT_CHAR_BUDGET,
        });
      });
    },
  };
}

/** @param {string} text */
function refusal(text) {
  return { success: false, content: [{ type: "text", text }] };
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {unknown} payload
 */
function write(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}
