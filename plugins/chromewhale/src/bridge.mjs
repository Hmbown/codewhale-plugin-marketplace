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
// **One port, many servers.** Every Codewhale session that enables the plugin
// starts its own `mcp/server.mjs`, but the panel dials one port. The first
// server to bind it is the *owner* and holds the panel. Any later server finds
// the port taken, confirms over `/health` that the holder is a Chromewhale
// bridge with the same pairing token, and *forwards* each call to it over
// `POST /invoke`. Before every forwarded call it re-attempts the bind, so when
// the owning session exits the next call takes the port over and the panel
// reattaches within its reconnect ceiling. When the port is held by something
// else, the refusal says what — including the owning PID when it is a
// Chromewhale bridge the token does not match.
//
// Requests are refused before the token is even looked at when they carry a
// web `Origin` (only the extension, or another local server, may talk here) or
// a `Host` header that is not this loopback address and port (DNS rebinding).
//
// Known limitations:
// - **One panel at a time.** A second subscriber supersedes the first, which is
//   then told why and disconnected. Two panels driving one tab is a race with no
//   good outcome, so the bridge picks the most recent and says so out loud.
// - **No queue.** A call raised while nothing is subscribed fails immediately
//   with an explanation rather than waiting for a panel that may never open.
//   The model gets a sentence it can act on instead of a stalled turn. The one
//   exception is right after a takeover, when the panel is known to be
//   reconnecting: the call waits a few seconds for it.
// - **No replay.** If the panel disconnects mid-call, that call fails. Calls are
//   side-effecting actions on a live page; silently re-running one against a
//   page that has since changed would be worse than failing.

import http from "node:http";
import crypto from "node:crypto";

import { bearerOf, isLoopbackHost, tokenMatches } from "./pairing.mjs";
import { CALL_TIMEOUT_MS, SNAPSHOT_CHAR_BUDGET, describeCall, isTool } from "./tools.mjs";

/** Largest result body the extension may POST back (screenshots dominate). */
const MAX_RESULT_BYTES = 12 * 1024 * 1024;
/** Largest forwarded call body: a tool name and its small arguments. */
const MAX_INVOKE_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 20_000;
const PROBE_TIMEOUT_MS = 2_000;
/** How long a call waits for the panel right after this process took the port over. */
const TAKEOVER_GRACE_MS = 6_000;

/**
 * @param {{token: string, host: string, port: number, version?: string,
 *          timeoutMs?: number, takeoverGraceMs?: number,
 *          onLog?: (line: string) => void,
 *          onOwner?: (live: {host: string, port: number}) => void}} options
 */
export function createBridge(options) {
  const { token, host, port } = options;
  const timeoutMs = options.timeoutMs ?? CALL_TIMEOUT_MS;
  const takeoverGraceMs = options.takeoverGraceMs ?? TAKEOVER_GRACE_MS;
  const version = options.version ?? "0.0.0";
  const log = options.onLog ?? (() => {});
  const onOwner = options.onOwner ?? (() => {});

  /** @type {{res: import("node:http").ServerResponse, id: string, since: number} | undefined} */
  let panel;
  /** @type {Map<string, {resolve: Function, timer: NodeJS.Timeout, name: string}>} */
  const pending = new Map();
  /** @type {Set<() => void>} */
  const panelWaiters = new Set();
  /** @type {NodeJS.Timeout | undefined} */
  let heartbeat;
  /** @type {import("node:http").Server | undefined} */
  let server;
  /**
   * `owner`: this process holds the port and the panel. `forwarding`: another
   * Chromewhale bridge holds it and takes our calls. `down`: nothing usable.
   * @type {"idle" | "owner" | "forwarding" | "down"}
   */
  let mode = "idle";
  /** @type {{pid?: number, version?: string} | undefined} */
  let owner;
  /** @type {string | undefined} */
  let listenError;
  let tookOverAt = 0;
  let closed = false;
  /**
   * The port actually bound, which is not always the one requested: port 0
   * asks the OS to choose. Reported by `status()` so `/chromewhale status` can
   * tell the user where to point the panel rather than repeating the request.
   */
  let boundPort = port;

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  function handle(req, res) {
    // No CORS headers are ever sent and OPTIONS is never answered: the only
    // legitimate clients are the extension, which holds a host permission for
    // this origin and is not subject to CORS, and sibling Chromewhale servers,
    // which send no Origin at all. A web page is refused here before the token
    // is consulted, and by the browser before it can read anything.
    const origin = req.headers.origin;
    if (origin !== undefined && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
      return send(res, 403, {
        error: "forbidden_origin",
        detail: "Chromewhale's bridge answers only its own extension and local Chromewhale servers.",
      });
    }
    if (!hostHeaderIsOurs(req.headers.host)) {
      return send(res, 403, {
        error: "forbidden_host",
        detail: `Chromewhale's bridge answers only on loopback port ${boundPort}.`,
      });
    }
    if (!tokenMatches(bearerOf(req.headers.authorization), token)) {
      // `service` and `pid` let a sibling server with a different token say
      // *which* process holds the port. Nothing else is disclosed, and no web
      // page can read this body.
      return send(res, 401, {
        error: "unauthorized",
        service: "chromewhale",
        pid: process.pid,
        detail: "Chromewhale's bridge needs its pairing token. Run /chromewhale token in Codewhale to print it, then paste it into the side panel's Settings.",
      });
    }
    const url = new URL(req.url ?? "/", `http://${host}:${boundPort}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        ok: true,
        service: "chromewhale",
        version,
        pid: process.pid,
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
    if (req.method === "POST" && url.pathname === "/invoke") {
      return receiveInvoke(req, res);
    }
    return send(res, 404, { error: "not_found", detail: `No bridge route for ${req.method} ${url.pathname}.` });
  }

  /** @param {unknown} header */
  function hostHeaderIsOurs(header) {
    if (typeof header !== "string") {
      return false;
    }
    const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(header.trim());
    return Boolean(match) && isLoopbackHost(match[1]) && Number(match[2]) === boundPort;
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
    write(res, { type: "ready", panel: id, version });
    log(`panel ${id.slice(0, 8)} attached`);
    for (const wake of [...panelWaiters]) {
      wake();
    }

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
   * Read a JSON body up to `limit` bytes.
   *
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {number} limit
   * @param {(body: any) => void} onBody
   */
  function readJson(req, res, limit, onBody) {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    let aborted = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        aborted = true;
        send(res, 413, { error: "too_large", detail: `Bodies here are capped at ${limit} bytes.` });
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
      onBody(body);
    });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  function receiveResult(req, res) {
    readJson(req, res, MAX_RESULT_BYTES, (body) => {
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
   * A call forwarded by a sibling server that could not bind the port.
   *
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  function receiveInvoke(req, res) {
    readJson(req, res, MAX_INVOKE_BYTES, (body) => {
      const name = body?.tool;
      if (!isTool(name)) {
        return send(res, 400, { error: "unknown_tool", detail: `No Chromewhale tool named "${String(name ?? "")}".` });
      }
      const args = body?.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args : {};
      void callLocal(name, args).then((result) => send(res, 200, result));
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

  /**
   * Try to become the owner of the port.
   *
   * @returns {Promise<{ok: true} | {ok: false, error: NodeJS.ErrnoException}>}
   */
  function tryBind() {
    return new Promise((resolve) => {
      const candidate = http.createServer(handle);
      /** @param {NodeJS.ErrnoException} error */
      const onError = (error) => {
        candidate.close(() => {});
        resolve({ ok: false, error });
      };
      candidate.once("error", onError);
      candidate.once("listening", () => {
        candidate.off("error", onError);
        candidate.on("error", (error) => log(`bridge error on ${host}:${boundPort} — ${error.message}`));
        server = candidate;
        const address = candidate.address();
        if (address && typeof address === "object") {
          boundPort = address.port;
        }
        const wasForwarding = mode === "forwarding" || mode === "down";
        mode = "owner";
        owner = undefined;
        listenError = undefined;
        if (wasForwarding) {
          tookOverAt = Date.now();
        }
        clearInterval(heartbeat);
        heartbeat = setInterval(() => {
          if (panel) {
            write(panel.res, { type: "heartbeat" });
          }
        }, HEARTBEAT_MS);
        heartbeat.unref?.();
        log(`bridge listening on ${host}:${boundPort}${wasForwarding ? " (took over from the previous owner)" : ""}`);
        try {
          onOwner({ host, port: boundPort });
        } catch {
          // Recording the endpoint is a convenience for `status`; never fatal.
        }
        resolve({ ok: true });
      });
      candidate.listen(port, host);
    });
  }

  /**
   * The port is taken. Find out by whom, and forward to it if it is ours.
   *
   * @param {NodeJS.ErrnoException} error
   */
  async function adoptOwner(error) {
    if (error.code !== "EADDRINUSE") {
      mode = "down";
      listenError = `Chromewhale's bridge could not listen on ${host}:${port} (${error.message}).`;
      log(listenError);
      return false;
    }
    const probe = await request("GET", "/health", undefined, PROBE_TIMEOUT_MS);
    if (probe.status === 200 && probe.body?.service === "chromewhale") {
      const pid = Number.isInteger(probe.body.pid) ? probe.body.pid : undefined;
      if (mode !== "forwarding" || owner?.pid !== pid) {
        log(`${host}:${port} is owned by the Chromewhale bridge in pid ${pid ?? "?"}; forwarding calls to it`);
      }
      mode = "forwarding";
      owner = { pid, version: probe.body.version };
      listenError = undefined;
      return true;
    }
    mode = "down";
    owner = undefined;
    if (probe.status === 401 && probe.body?.service === "chromewhale") {
      listenError =
        `${host}:${port} is held by another Chromewhale bridge (pid ${probe.body.pid ?? "?"}) that uses a ` +
        "different pairing token, so this session cannot use it. Unset CHROMEWHALE_BRIDGE_TOKEN in one of " +
        "them, or give this session its own CHROMEWHALE_BRIDGE_PORT.";
    } else {
      listenError =
        `${host}:${port} is in use by a program that is not a Chromewhale bridge. Free that port or set ` +
        "CHROMEWHALE_BRIDGE_PORT (and the panel's bridge port) to another one, then restart Codewhale.";
    }
    log(listenError);
    return false;
  }

  /**
   * One authenticated request to whoever holds the port.
   *
   * @param {string} method
   * @param {string} path
   * @param {unknown} body
   * @param {number} timeout
   * @returns {Promise<{status: number, body?: any, error?: string}>}
   */
  function request(method, path, body, timeout) {
    return new Promise((resolve) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          host,
          port,
          path,
          method,
          timeout,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          /** @type {Buffer[]} */
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            let parsed;
            try {
              parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              parsed = undefined;
            }
            resolve({ status: res.statusCode ?? 0, body: parsed });
          });
          res.on("error", (error) => resolve({ status: 0, error: error.message }));
        },
      );
      req.on("timeout", () => req.destroy(new Error("timed out")));
      req.on("error", (error) => resolve({ status: 0, error: error.message }));
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  /**
   * Hand a call to the owning bridge.
   *
   * @param {string} name
   * @param {Record<string, unknown>} args
   * @returns {Promise<{success: boolean, content: Array<Record<string, unknown>>} | undefined>}
   *   `undefined` when the owner could not be reached at all.
   */
  async function forward(name, args) {
    const answer = await request("POST", "/invoke", { tool: name, args }, timeoutMs + 5_000);
    if (answer.status === 0) {
      return undefined;
    }
    if (answer.status === 200 && answer.body && typeof answer.body === "object") {
      return {
        success: answer.body.success === true,
        content: Array.isArray(answer.body.content) ? answer.body.content : [],
      };
    }
    return refusal(
      `The Chromewhale bridge in pid ${owner?.pid ?? "?"} owns ${host}:${port} but refused ${name} ` +
        `(HTTP ${answer.status}${answer.body?.detail ? `: ${answer.body.detail}` : ""}).`,
    );
  }

  /** @param {number} ms */
  function waitForPanel(ms) {
    if (panel || ms <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        panelWaiters.delete(done);
        resolve(undefined);
      };
      const timer = setTimeout(done, ms);
      timer.unref?.();
      panelWaiters.add(done);
    });
  }

  /**
   * Run a call against the panel attached to *this* process.
   *
   * @param {string} name
   * @param {Record<string, unknown>} args
   * @returns {Promise<{success: boolean, content: Array<Record<string, unknown>>}>}
   */
  async function callLocal(name, args) {
    if (!panel && tookOverAt) {
      // Just took the port over from an exited owner: the panel is known to
      // be reconnecting, so give it a moment instead of refusing instantly.
      await waitForPanel(tookOverAt + takeoverGraceMs - Date.now());
    }
    if (!panel) {
      return refusal(
        "No Chromewhale panel is attached. Ask the user to open the Chromewhale side panel in Chrome " +
          "(toolbar button) and check that its bridge token matches — /chromewhale token prints it.",
      );
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
  }

  return {
    /**
     * Bind the port, or find the Chromewhale bridge that already holds it.
     * Resolves `true` when calls have somewhere to go, `false` otherwise;
     * `status()` says which and why. Never rejects.
     */
    async listen() {
      const bound = await tryBind();
      return bound.ok ? true : adoptOwner(bound.error);
    },

    close() {
      closed = true;
      clearInterval(heartbeat);
      panel?.res.end();
      panel = undefined;
      for (const [callId] of [...pending]) {
        settle(callId, {
          success: false,
          content: [{ type: "text", text: "Chromewhale's bridge shut down before this call finished." }],
        });
      }
      const current = server;
      server = undefined;
      mode = "idle";
      if (!current) {
        return Promise.resolve(undefined);
      }
      current.closeAllConnections?.();
      return new Promise((resolve) => current.close(() => resolve(undefined)));
    },

    status() {
      return {
        listening: mode === "owner",
        mode,
        ownerPid: mode === "owner" ? process.pid : owner?.pid,
        paired: Boolean(panel),
        pending: pending.size,
        host,
        port: boundPort,
        baseUrl: `http://${host}:${boundPort}`,
        error: listenError,
      };
    },

    /**
     * Send one call to the attached panel — ours, or the owning bridge's —
     * and wait for its answer.
     *
     * @param {string} name
     * @param {Record<string, unknown>} args
     * @returns {Promise<{success: boolean, content: Array<Record<string, unknown>>}>}
     */
    async call(name, args) {
      if (closed) {
        return refusal("Chromewhale's bridge is shut down.");
      }
      if (mode !== "owner") {
        // Re-attempt the bind on every call: the owner may have exited, and
        // then this process should take the port over rather than keep
        // forwarding into nothing.
        const bound = await tryBind();
        if (!bound.ok) {
          if (!(await adoptOwner(bound.error))) {
            return refusal(listenError ?? `Chromewhale's bridge could not reach ${host}:${port}.`);
          }
          const forwarded = await forward(name, args);
          if (forwarded) {
            return forwarded;
          }
          // The owner vanished between the probe and the call. One more try
          // at taking over; a call is never silently re-sent to a new owner
          // once the old one may have started it.
          const retry = await tryBind();
          if (!retry.ok) {
            return refusal(
              `The Chromewhale bridge in pid ${owner?.pid ?? "?"} owns ${host}:${port} but stopped answering ` +
                `during ${name}. Try again; if it persists, restart the Codewhale session that owns it.`,
            );
          }
        }
      }
      return callLocal(name, args);
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
