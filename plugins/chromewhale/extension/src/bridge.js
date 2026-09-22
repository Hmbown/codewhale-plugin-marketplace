/**
 * The panel's end of the Chromewhale bridge.
 *
 * It dials the plugin's MCP server over loopback, holds one SSE stream of
 * calls, runs each against the tab, and POSTs the result back. The extension
 * dials out because a Chrome extension cannot listen on a socket — see
 * `src/bridge.mjs` in the plugin for the other half.
 *
 * `manifest.json` holds `http://127.0.0.1/*` and `http://localhost/*` as
 * required host permissions. That is the only host access Chromewhale takes
 * without asking, because it is the user's own machine; every web origin is an
 * optional permission the user grants per site.
 *
 * Known limitations:
 * - **One panel wins.** The bridge serves the most recently attached panel and
 *   tells the previous one it was superseded. Opening the panel in a second
 *   Chrome window takes the bridge with it.
 * - **A dropped call is not retried.** Calls act on a live page; re-running one
 *   against a page that has since changed would be worse than failing.
 */

import { SseParser, bridgeFrame } from "./sse.js";

const RECONNECT_FLOOR_MS = 1_000;
const RECONNECT_CEILING_MS = 15_000;

export class BridgeClient {
  /**
   * @param {{baseUrl: string, token: string,
   *          onCall: (call: {id: string, tool: string, args: Record<string, unknown>,
   *                          summary?: string, budget?: number}) => Promise<{success: boolean, content: unknown[]}>,
   *          onStatus: (status: {kind: "attached"|"offline"|"unauthorized"|"superseded", detail: string}) => void}} options
   */
  constructor(options) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.onCall = options.onCall;
    this.onStatus = options.onStatus;
    /** @type {AbortController | undefined} */
    this.controller = undefined;
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
        this.onStatus({
          kind: "offline",
          detail:
            `No Chromewhale bridge at ${this.baseUrl}. Install and enable the Chromewhale plugin in ` +
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

  /** @param {AbortSignal} signal */
  async #attach(signal) {
    const response = await fetch(`${this.baseUrl}/calls`, {
      headers: { Accept: "text/event-stream", Authorization: `Bearer ${this.token}` },
      signal,
    });
    if (response.status === 401) {
      throw new BridgeAuthError(
        "The bridge rejected this panel's token. Run /chromewhale in Codewhale and paste the token it prints.",
      );
    }
    if (!response.ok || !response.body) {
      throw new Error(`Bridge returned HTTP ${response.status}.`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        for (const data of parser.push(decoder.decode(value, { stream: true }))) {
          const frame = bridgeFrame(data);
          if (frame) {
            this.#handle(frame);
          }
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
        this.onStatus({ kind: "attached", detail: "Attached to the Chromewhale bridge." });
        break;
      case "superseded":
        this.onStatus({
          kind: "superseded",
          detail: typeof frame.detail === "string" ? frame.detail : "Another Chromewhale panel took the bridge.",
        });
        break;
      case "call":
        void this.#runCall(frame);
        break;
      case "heartbeat":
      default:
        break;
    }
  }

  /** @param {Record<string, unknown>} frame */
  async #runCall(frame) {
    const id = typeof frame.id === "string" ? frame.id : "";
    const tool = typeof frame.tool === "string" ? frame.tool : "";
    if (!id || !tool) {
      return;
    }
    let result;
    try {
      result = await this.onCall({
        id,
        tool,
        args: frame.args && typeof frame.args === "object" ? frame.args : {},
        summary: typeof frame.summary === "string" ? frame.summary : undefined,
        budget: typeof frame.budget === "number" ? frame.budget : undefined,
      });
    } catch (error) {
      result = {
        success: false,
        content: [{ type: "text", text: `The Chromewhale panel failed to run ${tool}: ${String(error)}` }],
      };
    }
    await this.#post(id, result);
  }

  /**
   * @param {string} id
   * @param {{success: boolean, content: unknown[]}} result
   */
  async #post(id, result) {
    try {
      await fetch(`${this.baseUrl}/results`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ id, success: result.success, content: result.content }),
      });
    } catch {
      // The server times the call out on its own and tells the model why, so a
      // failed delivery needs no second error path here.
    }
  }
}

export class BridgeAuthError extends Error {}
