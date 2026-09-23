/**
 * `text/event-stream` framing, shared by the two streams this panel holds: the
 * Codewhale runtime's `/v1/threads/{id}/events` (chat) and the Codewhale for Chrome
 * bridge's `/calls` (tool calls).
 *
 * Split in two deliberately. `SseParser` knows only about frames and yields the
 * raw `data` payloads; `runtimeEvent` maps one of those payloads onto the
 * runtime's own envelope. The bridge speaks plain JSON objects with no `seq`,
 * so a parser that insisted on the runtime envelope would silently drop every
 * bridge frame — which is exactly what the first version of this file did.
 *
 * The framing is a port of `extensions/vscode/src/sse.ts` in the Codewhale
 * repository, which reads the same runtime contract over `node:http`. The two
 * are not shared because this one reads a `fetch` stream in a browser and
 * sharing would mean adding a build step to an extension that needs none.
 */

export class SseParser {
  #buffer = "";

  /**
   * Feed one raw chunk; returns the `data` payload of each frame it finished.
   *
   * @param {string} chunk
   * @returns {string[]}
   */
  push(chunk) {
    this.#buffer += chunk;
    const payloads = [];
    let boundary = this.#nextBoundary();
    while (boundary !== undefined) {
      const frame = this.#buffer.slice(0, boundary.index);
      this.#buffer = this.#buffer.slice(boundary.index + boundary.length);
      const data = frameData(frame);
      if (data) {
        payloads.push(data);
      }
      boundary = this.#nextBoundary();
    }
    return payloads;
  }

  #nextBoundary() {
    const lf = this.#buffer.indexOf("\n\n");
    const crlf = this.#buffer.indexOf("\r\n\r\n");
    if (lf === -1 && crlf === -1) {
      return undefined;
    }
    if (crlf === -1 || (lf !== -1 && lf < crlf)) {
      return { index: lf, length: 2 };
    }
    return { index: crlf, length: 4 };
  }
}

/**
 * Concatenate the `data:` lines of one frame. Comments (`:` heartbeats) and
 * blank lines yield nothing.
 *
 * `event`, `id`, and `retry` are ignored on purpose: the runtime carries its
 * event name inside the JSON envelope, and the bridge carries a `type` field,
 * so neither stream depends on the SSE-level event name.
 *
 * @param {string} frame
 * @returns {string | undefined}
 */
export function frameData(frame) {
  let data = "";
  for (const rawLine of frame.split(/\r?\n/)) {
    if (rawLine === "" || rawLine.startsWith(":")) {
      continue;
    }
    const colon = rawLine.indexOf(":");
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? "" : rawLine.slice(colon + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    if (field === "data") {
      data += (data ? "\n" : "") + value;
    }
  }
  return data || undefined;
}

/**
 * Parse one payload as a Codewhale runtime event envelope.
 *
 * @param {string} data
 * @returns {{seq: number, previousSeq?: number, event: string, threadId?: string,
 *   turnId?: string, itemId?: string, payload: unknown} | undefined}
 */
export function runtimeEvent(data) {
  const body = parseJson(data);
  if (!body) {
    return undefined;
  }
  const seq = readNumber(body.seq);
  const event = readString(body.event);
  if (seq === undefined || !event) {
    return undefined;
  }
  return {
    seq,
    previousSeq: readNumber(body.previous_seq),
    event,
    threadId: readString(body.thread_id),
    turnId: readString(body.turn_id),
    itemId: readString(body.item_id),
    payload: body.payload,
  };
}

/**
 * Parse one payload as a bridge frame.
 *
 * @param {string} data
 * @returns {{type: string, [key: string]: unknown} | undefined}
 */
export function bridgeFrame(data) {
  const body = parseJson(data);
  return body && typeof body.type === "string" ? body : undefined;
}

/** @param {string} data */
function parseJson(data) {
  let body;
  try {
    body = JSON.parse(data);
  } catch {
    return undefined;
  }
  return body && typeof body === "object" ? body : undefined;
}

/** @param {unknown} value */
function readString(value) {
  return typeof value === "string" ? value : undefined;
}

/** @param {unknown} value */
function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
