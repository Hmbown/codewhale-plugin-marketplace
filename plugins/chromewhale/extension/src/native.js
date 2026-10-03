/**
 * The panel's end of Native Messaging pairing.
 *
 * `chrome.runtime.connectNative` starts the host `/chromewhale setup`
 * registered (`src/native.mjs` in the plugin). The host holds the pairing token
 * and the bridge connection; this side only runs the calls it relays, against
 * the tab, through the same `browserTools.execute` path as every other call.
 * Nothing here ever sees the token, and only this extension's ID is allowed to
 * start the host.
 *
 * Chrome keeps the host alive exactly as long as the port is open — the life
 * of this panel — which is also exactly as long as the tools may work.
 */

export const NATIVE_HOST = "net.codewhale.chrome";
const RETRY_FLOOR_MS = 1_000;
const RETRY_CEILING_MS = 8_000;

export class NativeClient {
  /**
   * @param {{onCall: (call: {id: string, tool: string, args: Record<string, unknown>, summary?: string,
   *                          budget?: number, deadline?: number, signal: AbortSignal}) =>
   *                          Promise<{success: boolean, content: unknown[]}>,
   *          onStatus: (status: {kind: string, detail: string}) => void,
   *          onMissing: (detail: string) => void,
   *          version?: string,
   *          connect?: (name: string) => chrome.runtime.Port}} options
   */
  constructor(options) {
    this.onCall = options.onCall;
    this.onStatus = options.onStatus;
    this.onMissing = options.onMissing;
    this.version = options.version;
    this.connectNative = options.connect ?? ((name) => chrome.runtime.connectNative(name));
    /** @type {chrome.runtime.Port | undefined} */
    this.port = undefined;
    /** @type {Map<string, AbortController>} */
    this.calls = new Map();
    this.stopped = true;
    this.retryMs = RETRY_FLOOR_MS;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.timer = undefined;
  }

  start() {
    this.stop();
    this.stopped = false;
    this.#connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.abortAll("disconnected");
    const port = this.port;
    this.port = undefined;
    port?.disconnect();
  }

  /** @param {string} [reason] */
  abortAll(reason = "stopped") {
    for (const controller of this.calls.values()) {
      controller.abort(reason);
    }
  }

  #connect() {
    let port;
    try {
      port = this.connectNative(NATIVE_HOST);
    } catch (error) {
      this.#gone(String(error));
      return;
    }
    this.port = port;
    let heard = false;
    port.onMessage.addListener((message) => {
      heard = true;
      this.retryMs = RETRY_FLOOR_MS;
      this.#handle(message);
    });
    port.onDisconnect.addListener(() => {
      const detail = chrome.runtime?.lastError?.message ?? "";
      if (this.port === port) {
        this.port = undefined;
      }
      this.abortAll("disconnected");
      if (this.stopped) {
        return;
      }
      // Chrome says "Specified native messaging host not found" (or "Access
      // to the specified native messaging host is forbidden") when setup has
      // not registered this extension. Retrying cannot fix that.
      if (!heard && /not found|forbidden/i.test(detail)) {
        this.onMissing(detail);
        return;
      }
      this.#gone(detail);
    });
  }

  /** @param {string} detail */
  #gone(detail) {
    this.onStatus({
      kind: "offline",
      detail: `The Codewhale for Chrome connector stopped${detail ? ` (${detail})` : ""}. Reconnecting…`,
    });
    this.timer = setTimeout(() => this.#connect(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, RETRY_CEILING_MS);
  }

  /** @param {any} message */
  #handle(message) {
    if (!message || typeof message !== "object") {
      return;
    }
    switch (message.type) {
      case "hello":
        if (typeof message.version === "string" && this.version && message.version !== this.version) {
          this.onStatus({
            kind: "attached",
            detail:
              `The plugin is ${message.version} and this extension is ${this.version}. Run /chromewhale setup, ` +
              "then reload the extension in chrome://extensions.",
          });
        }
        break;
      case "status":
        if (typeof message.kind === "string" && typeof message.detail === "string") {
          this.onStatus({ kind: message.kind, detail: message.detail });
        }
        break;
      case "call":
        void this.#run(message);
        break;
      case "cancel":
        if (typeof message.id === "string") {
          this.calls.get(message.id)?.abort("cancelled");
        }
        break;
      default:
        break;
    }
  }

  /** @param {any} message */
  async #run(message) {
    const id = typeof message.id === "string" ? message.id : "";
    if (!id || typeof message.tool !== "string") {
      return;
    }
    const controller = new AbortController();
    this.calls.set(id, controller);
    let result;
    try {
      result = await this.onCall({
        id,
        tool: message.tool,
        args: message.args && typeof message.args === "object" ? message.args : {},
        summary: typeof message.summary === "string" ? message.summary : undefined,
        budget: typeof message.budget === "number" ? message.budget : undefined,
        deadline: typeof message.deadline === "number" ? message.deadline : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      result = {
        success: false,
        content: [{ type: "text", text: `The Codewhale for Chrome panel failed to run ${message.tool}: ${String(error)}` }],
      };
    } finally {
      this.calls.delete(id);
    }
    try {
      this.port?.postMessage({ type: "result", id, success: result.success, content: result.content });
    } catch {
      // The host went away; the bridge times the call out and says so.
    }
  }
}
