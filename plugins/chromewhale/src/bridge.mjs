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
// the port taken, confirms over `/health` that the holder is a Codewhale for Chrome
// bridge with the same pairing token, and *forwards* each call to it over
// `POST /invoke`. Before every forwarded call it re-attempts the bind, so when
// the owning session exits the next call takes the port over and the panel
// reattaches within its reconnect ceiling. When the port is held by something
// else, the refusal says what — including the owning PID when it is a
// Codewhale for Chrome bridge the token does not match.
//
// Requests are refused before the token is even looked at when they carry a
// web `Origin` (only the extension, or another local server, may talk here) or
// a `Host` header that is not this loopback address and port (DNS rebinding).
//
// **Both ends prove the token; neither sends it.** Clients sign each request
// against a single-use nonce from `GET /challenge`, and every reply carries the
// bridge's own HMAC proof (`src/pairing.mjs`). A program squatting on the port
// therefore never sees the token, cannot push calls a panel will run, and
// cannot answer a sibling with results the sibling will accept. A plain
// `Bearer` token is still accepted *from* clients so an older panel keeps
// working until it is reloaded; nothing here ever sends one.
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
//   page that has since changed would be worse than failing. A forwarded call
//   whose owner vanished is re-run locally only when the owner provably never
//   received it (the connection was refused before the call was sent).
// - **Deadlines.** Every call frame carries the time after which the panel must
//   not act, and a `cancel` frame follows a timeout or a host cancellation, so
//   a late user click can never act on a call the model was told had failed.

import http from "node:http";
import crypto from "node:crypto";

import {
  bearerOf,
  bridgeMessage,
  clientMessage,
  isLoopbackHost,
  mac,
  macMatches,
  newNonce,
  parseSignedAuthorization,
  signedAuthorization,
  tokenMatches,
} from "./pairing.mjs";
import { CALL_TIMEOUT_MS, SNAPSHOT_CHAR_BUDGET, describeCall, isTool } from "./tools.mjs";

/** Largest result body the extension may POST back (screenshots dominate). */
const MAX_RESULT_BYTES = 12 * 1024 * 1024;
/** Largest forwarded call body: a tool name and its small arguments. */
const MAX_INVOKE_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 20_000;
const PROBE_TIMEOUT_MS = 2_000;
/** How long a call waits for the panel right after this process took the port over. */
const TAKEOVER_GRACE_MS = 6_000;
/** A challenge nonce is good for one request within this window. */
const CHALLENGE_TTL_MS = 30_000;
const MAX_CHALLENGES = 512;
/**
 * The panel must stop acting this long before the bridge gives up on a call, so
 * a result that is still in flight at the deadline reaches the model in time.
 */
const DEADLINE_MARGIN_MS = 3_000;

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
  /** @type {Map<string, {resolve: Function, timer: NodeJS.Timeout, name: string, panel: string}>} */
  const pending = new Map();
  /** Outstanding challenge nonces and when each expires. @type {Map<string, number>} */
  const challenges = new Map();
  /** @type {Set<() => void>} */
  const panelWaiters = new Set();
  /** @type {NodeJS.Timeout | undefined} */
  let heartbeat;
  /** @type {import("node:http").Server | undefined} */
  let server;
  /**
   * `owner`: this process holds the port and the panel. `forwarding`: another
   * Codewhale for Chrome bridge holds it and takes our calls. `down`: nothing usable.
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
    // this origin and is not subject to CORS, and sibling Codewhale for Chrome servers,
    // which send no Origin at all. A web page is refused here before the token
    // is consulted, and by the browser before it can read anything.
    const origin = req.headers.origin;
    if (origin !== undefined && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
      return send(res, 403, {
        error: "forbidden_origin",
        detail: "Codewhale for Chrome's bridge answers only its own extension and local Codewhale for Chrome servers.",
      });
    }
    if (!hostHeaderIsOurs(req.headers.host)) {
      return send(res, 403, {
        error: "forbidden_host",
        detail: `Codewhale for Chrome's bridge answers only on loopback port ${boundPort}.`,
      });
    }
    const url = new URL(req.url ?? "/", `http://${host}:${boundPort}`);
    if (req.method === "GET" && url.pathname === "/challenge") {
      // Unauthenticated by necessity, and harmless: a nonce grants nothing
      // until it is signed with the token.
      return send(res, 200, { service: "chromewhale", nonce: issueChallenge() });
    }
    const auth = authenticate(req.headers.authorization, req.method ?? "GET", url.pathname);
    if (!auth) {
      // `service` and `pid` let a sibling server with a different token say
      // *which* process holds the port. Nothing else is disclosed, and no web
      // page can read this body.
      return send(res, 401, {
        error: "unauthorized",
        service: "chromewhale",
        pid: process.pid,
        detail: "Codewhale for Chrome's bridge needs its pairing token. Run /chromewhale token in Codewhale to print it, then paste it into the side panel's Settings.",
      });
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return reply(res, 200, auth, {
        ok: true,
        service: "chromewhale",
        version,
        pid: process.pid,
        paired: Boolean(panel),
        pending: pending.size,
      });
    }
    if (req.method === "GET" && url.pathname === "/calls") {
      return subscribe(res, auth);
    }
    if (req.method === "POST" && url.pathname === "/results") {
      return receiveResult(req, res, auth);
    }
    if (req.method === "POST" && url.pathname === "/invoke") {
      return receiveInvoke(req, res, auth);
    }
    return send(res, 404, { error: "not_found", detail: `No bridge route for ${req.method} ${url.pathname}.` });
  }

  function issueChallenge() {
    const now = Date.now();
    for (const [nonce, expires] of challenges) {
      if (expires <= now || challenges.size >= MAX_CHALLENGES) {
        challenges.delete(nonce);
      } else {
        break;
      }
    }
    const nonce = newNonce();
    challenges.set(nonce, now + CHALLENGE_TTL_MS);
    return nonce;
  }

  /**
   * Who is asking: a signed request (its nonces, for the reply proof), a
   * legacy bearer, or nobody.
   *
   * @param {unknown} header
   * @param {string} method
   * @param {string} path
   * @returns {{nonce: string, cnonce: string} | {legacy: true} | undefined}
   */
  function authenticate(header, method, path) {
    const signed = parseSignedAuthorization(header);
    if (signed) {
      const expires = challenges.get(signed.nonce);
      // Single use: consumed whether or not the MAC checks out.
      challenges.delete(signed.nonce);
      if (!expires || expires < Date.now()) {
        return undefined;
      }
      const expected = mac(token, clientMessage(method, path, signed.nonce, signed.cnonce));
      return macMatches(signed.mac, expected) ? { nonce: signed.nonce, cnonce: signed.cnonce } : undefined;
    }
    return tokenMatches(bearerOf(header), token) ? { legacy: true } : undefined;
  }

  /**
   * A JSON reply, signed when the request was.
   *
   * @param {import("node:http").ServerResponse} res
   * @param {number} status
   * @param {{nonce: string, cnonce: string} | {legacy: true}} auth
   * @param {Record<string, unknown>} body
   */
  function reply(res, status, auth, body) {
    if ("nonce" in auth) {
      return send(res, status, { ...body, proof: mac(token, bridgeMessage(auth.nonce, auth.cnonce, JSON.stringify(body))) });
    }
    return send(res, status, body);
  }

  /** @param {unknown} header */
  function hostHeaderIsOurs(header) {
    if (typeof header !== "string") {
      return false;
    }
    const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(header.trim());
    return Boolean(match) && isLoopbackHost(match[1]) && Number(match[2]) === boundPort;
  }

  /**
   * @param {import("node:http").ServerResponse} res
   * @param {{nonce: string, cnonce: string} | {legacy: true}} auth
   */
  function subscribe(res, auth) {
    const previous = panel;
    const id = crypto.randomUUID();
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    panel = { res, id, since: Date.now() };
    // The panel runs nothing until this proof checks out against the nonces
    // it signed with: it is what tells a real bridge from a port squatter.
    write(res, {
      type: "ready",
      panel: id,
      version,
      ...("nonce" in auth ? { proof: mac(token, bridgeMessage(auth.nonce, auth.cnonce, `ready|${id}`)) } : {}),
    });
    log(`panel ${id.slice(0, 8)} attached`);
    for (const wake of [...panelWaiters]) {
      wake();
    }

    if (previous) {
      write(previous.res, {
        type: "superseded",
        detail: "Another Codewhale for Chrome panel attached to this bridge. Only the newest panel receives calls.",
      });
      previous.res.end();
      log(`panel ${previous.id.slice(0, 8)} superseded`);
      // Calls already sent to the superseded panel will never be answered by
      // the new one; fail them now instead of at the timeout.
      for (const [callId, entry] of [...pending]) {
        if (entry.panel === previous.id) {
          settle(callId, refusal(`Another Codewhale for Chrome panel took over before ${entry.name} finished. Nothing more will happen for this call.`));
        }
      }
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
            content: [{ type: "text", text: `The Codewhale for Chrome panel closed before ${entry.name} finished. Ask the user to reopen it.` }],
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
   * @param {{nonce: string, cnonce: string} | {legacy: true}} auth
   */
  function receiveResult(req, res, auth) {
    readJson(req, res, MAX_RESULT_BYTES, (body) => {
      const callId = typeof body?.id === "string" ? body.id : "";
      if (!pending.has(callId)) {
        // Already settled, timed out, or never ours. Not an error worth
        // escalating — the model has been told something either way.
        return reply(res, 404, auth, { error: "unknown_call", detail: `Call ${callId || "(missing id)"} is not pending.` });
      }
      settle(callId, {
        success: body?.success === true,
        content: Array.isArray(body?.content) ? body.content : [],
      });
      return reply(res, 202, auth, { accepted: true });
    });
  }

  /**
   * A call forwarded by a sibling server that could not bind the port.
   *
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {{nonce: string, cnonce: string} | {legacy: true}} auth
   */
  function receiveInvoke(req, res, auth) {
    readJson(req, res, MAX_INVOKE_BYTES, (body) => {
      const name = body?.tool;
      if (!isTool(name)) {
        return reply(res, 400, auth, { error: "unknown_tool", detail: `No Codewhale for Chrome tool named "${String(name ?? "")}".` });
      }
      const args = body?.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args : {};
      // The sibling hanging up (its host cancelled, or it exited) cancels the
      // call here too, so the panel stops waiting on the user for nothing.
      const abort = new AbortController();
      let answered = false;
      res.on("close", () => {
        if (!answered) {
          abort.abort();
        }
      });
      void callLocal(name, args, abort.signal).then((result) => {
        answered = true;
        if (!res.destroyed) {
          // A signed sibling gets the result inside the proven envelope; an
          // older bearer-token sibling gets the shape it has always read.
          if ("nonce" in auth) {
            reply(res, 200, auth, { result });
          } else {
            send(res, 200, result);
          }
        }
      });
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
      listenError = `Codewhale for Chrome's bridge could not listen on ${host}:${port} (${error.message}).`;
      log(listenError);
      return false;
    }
    const probe = await request("GET", "/health", undefined, PROBE_TIMEOUT_MS);
    if (probe.status === 200 && probe.verified && probe.body?.service === "chromewhale") {
      const pid = Number.isInteger(probe.body.pid) ? probe.body.pid : undefined;
      if (mode !== "forwarding" || owner?.pid !== pid) {
        log(`${host}:${port} is owned by the Codewhale for Chrome bridge in pid ${pid ?? "?"}; forwarding calls to it`);
      }
      mode = "forwarding";
      owner = { pid, version: probe.body.version };
      listenError = undefined;
      return true;
    }
    mode = "down";
    owner = undefined;
    if (probe.status === 200 && !probe.verified && probe.chromewhale) {
      listenError =
        `${host}:${port} answers like a Codewhale for Chrome bridge but could not prove it holds this session's ` +
        "pairing token, so no calls are sent to it. Free that port or set CHROMEWHALE_BRIDGE_PORT (and the " +
        "panel's bridge port) to another one, then restart Codewhale.";
    } else if (probe.status === 401 && probe.body?.service === "chromewhale") {
      listenError =
        `${host}:${port} is held by another Codewhale for Chrome bridge (pid ${probe.body.pid ?? "?"}) that uses a ` +
        "different pairing token, so this session cannot use it. Unset CHROMEWHALE_BRIDGE_TOKEN in one of " +
        "them, or give this session its own CHROMEWHALE_BRIDGE_PORT.";
    } else {
      listenError =
        `${host}:${port} is in use by a program that is not a Codewhale for Chrome bridge. Free that port or set ` +
        "CHROMEWHALE_BRIDGE_PORT (and the panel's bridge port) to another one, then restart Codewhale.";
    }
    log(listenError);
    return false;
  }

  /**
   * One plain HTTP exchange with whoever holds the port.
   *
   * @param {string} method
   * @param {string} path
   * @param {Record<string, string>} headers
   * @param {string | undefined} payload
   * @param {number} timeout
   * @param {AbortSignal} [signal]
   * @returns {Promise<{status: number, body?: any, error?: string, code?: string}>}
   */
  function exchange(method, path, headers, payload, timeout, signal) {
    return new Promise((resolve) => {
      const req = http.request(
        {
          host,
          port,
          path,
          method,
          timeout,
          signal,
          headers: {
            ...headers,
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
      req.on("error", (/** @type {NodeJS.ErrnoException} */ error) =>
        resolve({ status: 0, error: error.message, code: error.code ?? error.name }),
      );
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  /**
   * One signed request to whoever holds the port, with its reply verified.
   *
   * `delivered: false` means the request itself was never sent — the
   * challenge could not even be fetched — which is the only case in which a
   * forwarded call may safely be run somewhere else instead.
   *
   * @param {string} method
   * @param {string} path
   * @param {unknown} body
   * @param {number} timeout
   * @param {AbortSignal} [signal]
   * @returns {Promise<{status: number, body?: any, verified: boolean, delivered: boolean,
   *                    chromewhale: boolean, error?: string}>}
   */
  async function request(method, path, body, timeout, signal) {
    const challenge = await exchange("GET", "/challenge", {}, undefined, PROBE_TIMEOUT_MS, signal);
    if (challenge.status === 0) {
      return { status: 0, verified: false, delivered: false, chromewhale: false, error: challenge.error };
    }
    const nonce = challenge.body?.nonce;
    if (challenge.status !== 200 || challenge.body?.service !== "chromewhale" || typeof nonce !== "string") {
      // An older Codewhale for Chrome bridge has no /challenge; its 401 names itself.
      return {
        status: challenge.status,
        body: challenge.body,
        verified: false,
        delivered: false,
        chromewhale: challenge.body?.service === "chromewhale",
      };
    }
    const cnonce = newNonce();
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const answer = await exchange(
      method,
      path,
      { Authorization: signedAuthorization(token, method, path, nonce, cnonce) },
      payload,
      timeout,
      signal,
    );
    if (answer.status === 0) {
      return { status: 0, verified: false, delivered: true, chromewhale: true, error: answer.error };
    }
    const parsed = answer.body && typeof answer.body === "object" ? answer.body : undefined;
    let verified = false;
    let rest = parsed;
    if (parsed && typeof parsed.proof === "string") {
      const { proof, ...others } = parsed;
      rest = others;
      verified = macMatches(proof, mac(token, bridgeMessage(nonce, cnonce, JSON.stringify(others))));
    }
    return { status: answer.status, body: rest, verified, delivered: true, chromewhale: parsed?.service === "chromewhale" || verified };
  }

  /**
   * Hand a call to the owning bridge.
   *
   * @param {string} name
   * @param {Record<string, unknown>} args
   * @param {AbortSignal} [signal]
   * @returns {Promise<{success: boolean, content: Array<Record<string, unknown>>} | {undelivered: true}>}
   */
  async function forward(name, args, signal) {
    const answer = await request("POST", "/invoke", { tool: name, args }, timeoutMs + 5_000, signal);
    if (!answer.delivered) {
      return { undelivered: true };
    }
    if (signal?.aborted) {
      return refusal(`The host cancelled ${name}.`);
    }
    if (answer.status === 0) {
      // The owner received the call and then went away: it may have acted.
      return refusal(
        `The Codewhale for Chrome bridge in pid ${owner?.pid ?? "?"} stopped answering during ${name}, after it ` +
          "had received the call. Whether it acted is unknown — snapshot the page before trying again.",
      );
    }
    if (answer.status === 200 && !answer.verified) {
      return refusal(
        `The program holding ${host}:${port} answered ${name} without proving it holds the pairing token, so the ` +
          "answer was discarded. Something other than Codewhale for Chrome may be listening on that port.",
      );
    }
    const result = answer.body?.result;
    if (answer.status === 200 && result && typeof result === "object") {
      return {
        success: result.success === true,
        content: Array.isArray(result.content) ? result.content : [],
      };
    }
    return refusal(
      `The Codewhale for Chrome bridge in pid ${owner?.pid ?? "?"} owns ${host}:${port} but refused ${name} ` +
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
   * @param {AbortSignal} [signal] the host (or a forwarding sibling) gave up
   * @returns {Promise<{success: boolean, content: Array<Record<string, unknown>>}>}
   */
  async function callLocal(name, args, signal) {
    if (signal?.aborted) {
      return refusal(`The host cancelled ${name} before it reached the panel.`);
    }
    if (!panel && tookOverAt) {
      // Just took the port over from an exited owner: the panel is known to
      // be reconnecting, so give it a moment instead of refusing instantly.
      await waitForPanel(tookOverAt + takeoverGraceMs - Date.now());
    }
    if (!panel) {
      return refusal(
        "No Codewhale for Chrome panel is attached. Ask the user to open the Codewhale for Chrome side panel in Chrome " +
          "(toolbar button) and check that its bridge token matches — /chromewhale token prints it.",
      );
    }
    const callId = crypto.randomUUID();
    const target = panel;
    /** Tell the panel to drop the call, if that panel is still the one attached. */
    const cancel = () => {
      if (panel?.id === target.id) {
        write(target.res, { type: "cancel", id: callId });
      }
    };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cancel();
        settle(callId, refusal(
          `The Codewhale for Chrome panel did not answer ${name} within ${Math.round(timeoutMs / 1000)}s, and ` +
          "has been told not to act on it. It may have been waiting on the user to allow this site.",
        ));
      }, timeoutMs);
      timer.unref?.();
      signal?.addEventListener(
        "abort",
        () => {
          if (pending.has(callId)) {
            cancel();
            settle(callId, refusal(`The host cancelled ${name}; the panel has been told not to act on it.`));
          }
        },
        { once: true },
      );
      const summary = describeCall(name, args);
      pending.set(callId, { resolve, timer, name, panel: target.id });
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
        // Absolute epoch ms. The panel refuses to act after it, whatever the
        // user clicks, so a result the model was told had failed never lands.
        deadline: Date.now() + timeoutMs - DEADLINE_MARGIN_MS,
      });
    });
  }

  return {
    /**
     * Bind the port, or find the Codewhale for Chrome bridge that already holds it.
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
          content: [{ type: "text", text: "Codewhale for Chrome's bridge shut down before this call finished." }],
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
     * @param {{signal?: AbortSignal}} [options]
     * @returns {Promise<{success: boolean, content: Array<Record<string, unknown>>}>}
     */
    async call(name, args, options = {}) {
      const { signal } = options;
      if (closed) {
        return refusal("Codewhale for Chrome's bridge is shut down.");
      }
      if (mode !== "owner") {
        // Re-attempt the bind on every call: the owner may have exited, and
        // then this process should take the port over rather than keep
        // forwarding into nothing.
        const bound = await tryBind();
        if (!bound.ok) {
          if (!(await adoptOwner(bound.error))) {
            return refusal(listenError ?? `Codewhale for Chrome's bridge could not reach ${host}:${port}.`);
          }
          const forwarded = await forward(name, args, signal);
          if (!("undelivered" in forwarded)) {
            return forwarded;
          }
          // The owner vanished between the probe and the call, and provably
          // never received it (the connection was refused before anything was
          // sent). Only then is it safe to take over and run the call here.
          const retry = await tryBind();
          if (!retry.ok) {
            return refusal(
              `The Codewhale for Chrome bridge in pid ${owner?.pid ?? "?"} owns ${host}:${port} but stopped answering ` +
                `during ${name}. Try again; if it persists, restart the Codewhale session that owns it.`,
            );
          }
        }
      }
      return callLocal(name, args, signal);
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
