/**
 * The panel's end of the Codewhale for Chrome bridge.
 *
 * It dials the plugin's MCP server over loopback, holds one SSE stream of
 * calls, runs each against the tab, and POSTs the result back. The extension
 * dials out because a Chrome extension cannot listen on a socket — see
 * `src/bridge.mjs` in the plugin for the other half.
 *
 * `manifest.json` holds `http://127.0.0.1/*` and `http://localhost/*` as
 * required host permissions. That is the only host access Codewhale for Chrome takes
 * without asking, because it is the user's own machine; every web origin is an
 * optional permission the user grants per site.
 *
 * **It never sends the pairing token.** Each request is signed against a
 * single-use nonce from `GET /challenge`, and nothing on the call stream runs
 * until the bridge's `ready` frame proves it holds the same token. A program
 * squatting on the bridge port therefore learns nothing and can drive nothing.
 * The MAC format matches `src/pairing.mjs` in the plugin.
 *
 * Calls run one at a time, in arrival order: two actions racing on one tab, or
 * two prompts stacked for the user, have no good outcome.
 *
 * Known limitations:
 * - **One panel wins.** The bridge serves the most recently attached panel and
 *   tells the previous one it was superseded. The superseded panel then stays
 *   detached until the user reconnects it, instead of taking the bridge back.
 * - **A dropped call is not retried.** Calls act on a live page; re-running one
 *   against a page that has since changed would be worse than failing.
 */

import { SseParser, bridgeFrame } from "./sse.js";

const RECONNECT_FLOOR_MS = 1_000;
// Short on purpose: when the Codewhale session that owned the bridge exits,
// another session's server takes the port over, and the panel should find it
// within a few seconds rather than a quarter-minute.
const RECONNECT_CEILING_MS = 4_000;

export class BridgeClient {
  /**
   * @param {{baseUrl: string, token: string, version?: string,
   *          onCall: (call: {id: string, tool: string, args: Record<string, unknown>,
   *                          summary?: string, budget?: number, deadline?: number,
   *                          signal: AbortSignal}) => Promise<{success: boolean, content: unknown[]}>,
   *          onStatus: (status: {kind: "attached"|"offline"|"unauthorized"|"superseded", detail: string}) => void,
   *          fetch?: typeof fetch}} options
   */
  constructor(options) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.version = options.version;
    this.onCall = options.onCall;
    this.onStatus = options.onStatus;
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    /** @type {AbortController | undefined} */
    this.controller = undefined;
    /** Per-call abort handles, for `cancel` frames and Pause. @type {Map<string, AbortController>} */
    this.calls = new Map();
    /** Calls run strictly one after another. @type {Promise<unknown>} */
    this.queue = Promise.resolve();
  }

  /**
   * Abort every call in progress or queued — Pause, or the panel shutting
   * down. Prompts waiting on the user close as refusals.
   *
   * @param {string} [reason]
   */
  abortAll(reason = "stopped") {
    for (const controller of this.calls.values()) {
      controller.abort(reason);
    }
  }

  /** Attach and keep reattaching until `stop()`. */
  start() {
    this.stop();
    const controller = new AbortController();
    this.controller = controller;
    void this.#pump(controller);
  }

  stop() {
    this.controller?.abort();
    this.controller = undefined;
    this.abortAll("disconnected");
  }

  /** @param {AbortController} controller */
  async #pump(controller) {
    let backoffMs = RECONNECT_FLOOR_MS;
    while (!controller.signal.aborted) {
      try {
        await this.#attach(controller.signal);
        backoffMs = RECONNECT_FLOOR_MS;
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        if (error instanceof BridgeAuthError) {
          // Retrying a bad token just burns the connection; the user has to fix
          // it in Settings, and the status line is how they learn that.
          this.onStatus({ kind: "unauthorized", detail: error.message });
          return;
        }
        if (error instanceof BridgeSupersededError) {
          // Reconnecting would take the bridge straight back from the panel
          // that just attached, and the two would trade it every second.
          this.onStatus({ kind: "superseded", detail: error.message });
          return;
        }
        if (error instanceof BridgeImpostorError) {
          this.onStatus({ kind: "offline", detail: error.message });
          await new Promise((resolve) => setTimeout(resolve, RECONNECT_CEILING_MS));
          continue;
        }
        this.onStatus({
          kind: "offline",
          detail:
            `No Codewhale for Chrome bridge at ${this.baseUrl}. Install and enable the Codewhale for Chrome plugin in ` +
            "Codewhale, then check the port and token in Settings.",
        });
      }
      if (controller.signal.aborted) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs * 2, RECONNECT_CEILING_MS);
    }
  }

  /**
   * Fetch a challenge and sign one request against it.
   *
   * @param {string} method
   * @param {string} path
   * @param {AbortSignal} [signal]
   * @returns {Promise<{authorization: string, nonce: string, cnonce: string}>}
   */
  async #sign(method, path, signal) {
    const response = await this.fetch(`${this.baseUrl}/challenge`, { signal });
    let body;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    if (!response.ok || body?.service !== "chromewhale" || typeof body?.nonce !== "string") {
      if (response.status === 401 && body?.service === "chromewhale") {
        throw new BridgeAuthError(
          "The Codewhale for Chrome plugin is older than this extension. Update the plugin, run " +
            "/chromewhale setup, then reload the extension.",
        );
      }
      throw new BridgeImpostorError(
        `Something other than the Codewhale for Chrome bridge is answering on ${this.baseUrl}. ` +
          "Check the bridge port in Settings.",
      );
    }
    const cnonce = randomHex(16);
    const mac = await hmacHex(this.token, `client|${method}|${path}|${body.nonce}|${cnonce}`);
    return { authorization: `Chromewhale nonce=${body.nonce},cnonce=${cnonce},mac=${mac}`, nonce: body.nonce, cnonce };
  }

  /** @param {AbortSignal} signal */
  async #attach(signal) {
    const signed = await this.#sign("GET", "/calls", signal);
    const response = await this.fetch(`${this.baseUrl}/calls`, {
      headers: { Accept: "text/event-stream", Authorization: signed.authorization },
      signal,
    });
    if (response.status === 401) {
      throw new BridgeAuthError(
        "The bridge rejected this panel's token. Run /chromewhale token in Codewhale and paste the token it prints.",
      );
    }
    if (!response.ok || !response.body) {
      throw new Error(`Bridge returned HTTP ${response.status}.`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    let verified = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        for (const data of parser.push(decoder.decode(value, { stream: true }))) {
          const frame = bridgeFrame(data);
          if (!frame) {
            continue;
          }
          if (!verified) {
            // Nothing is acted on until the bridge proves it holds the token.
            const expected =
              frame.type === "ready" && typeof frame.panel === "string"
                ? await hmacHex(this.token, `bridge|${signed.nonce}|${signed.cnonce}|ready|${frame.panel}`)
                : undefined;
            if (!expected || frame.proof !== expected) {
              throw new BridgeImpostorError(
                `The program on ${this.baseUrl} could not prove it is your Codewhale for Chrome bridge, so this ` +
                  "panel is not taking instructions from it.",
              );
            }
            verified = true;
          }
          if (frame.type === "superseded") {
            throw new BridgeSupersededError(
              "Another Codewhale for Chrome panel took the bridge. Press Save and reconnect in Settings to use this one.",
            );
          }
          this.#handle(frame);
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  /** @param {{type: string, [key: string]: unknown}} frame */
  #handle(frame) {
    switch (frame.type) {
      case "ready":
        this.onStatus(readyStatus(frame.version, this.version));
        break;
      case "call":
        this.#enqueue(frame);
        break;
      case "cancel":
        if (typeof frame.id === "string") {
          this.calls.get(frame.id)?.abort("cancelled");
        }
        break;
      case "heartbeat":
      default:
        break;
    }
  }

  /** @param {Record<string, unknown>} frame */
  #enqueue(frame) {
    const id = typeof frame.id === "string" ? frame.id : "";
    if (!id || typeof frame.tool !== "string" || !frame.tool) {
      return;
    }
    // Registered now, not when it starts, so a cancel can reach a queued call.
    const controller = new AbortController();
    this.calls.set(id, controller);
    this.queue = this.queue.then(() => this.#runCall(frame, controller)).catch(() => {});
  }

  /**
   * @param {Record<string, unknown>} frame
   * @param {AbortController} controller
   */
  async #runCall(frame, controller) {
    const id = /** @type {string} */ (frame.id);
    const tool = /** @type {string} */ (frame.tool);
    let result;
    try {
      result = await this.onCall({
        id,
        tool,
        args: frame.args && typeof frame.args === "object" ? frame.args : {},
        summary: typeof frame.summary === "string" ? frame.summary : undefined,
        budget: typeof frame.budget === "number" ? frame.budget : undefined,
        deadline: typeof frame.deadline === "number" ? frame.deadline : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      result = {
        success: false,
        content: [{ type: "text", text: `The Codewhale for Chrome panel failed to run ${tool}: ${String(error)}` }],
      };
    } finally {
      this.calls.delete(id);
    }
    await this.#post(id, result);
  }

  /**
   * @param {string} id
   * @param {{success: boolean, content: unknown[]}} result
   */
  async #post(id, result) {
    try {
      const signed = await this.#sign("POST", "/results");
      await this.fetch(`${this.baseUrl}/results`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: signed.authorization },
        body: JSON.stringify({ id, success: result.success, content: result.content }),
      });
    } catch {
      // The server times the call out on its own and tells the model why, so a
      // failed delivery needs no second error path here.
    }
  }
}

/**
 * Lowercase hex HMAC-SHA256, identical to `mac()` in the plugin's pairing.mjs.
 *
 * @param {string} key
 * @param {string} message
 */
export async function hmacHex(key, message) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {number} bytes */
function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class BridgeAuthError extends Error {}
/** Something answered on the bridge port without proving it holds the token. */
export class BridgeImpostorError extends Error {}
/** Another panel took the bridge; this one must not take it back on its own. */
export class BridgeSupersededError extends Error {}

/**
 * Status for a `ready` frame. The plugin and the extension ship together, but
 * the extension is loaded from a copy (`/chromewhale setup`), so after a plugin
 * update the two can differ until the user re-runs setup and reloads.
 *
 * @param {unknown} bridgeVersion
 * @param {string | undefined} extensionVersion
 * @returns {{kind: "attached", detail: string}}
 */
export function readyStatus(bridgeVersion, extensionVersion) {
  if (typeof bridgeVersion === "string" && extensionVersion && bridgeVersion !== extensionVersion) {
    return {
      kind: "attached",
      detail:
        `Attached, but the plugin is ${bridgeVersion} and this extension is ${extensionVersion}. ` +
        "Run /chromewhale setup, then reload the extension in chrome://extensions.",
    };
  }
  return { kind: "attached", detail: "Attached to the Codewhale for Chrome bridge." };
}
