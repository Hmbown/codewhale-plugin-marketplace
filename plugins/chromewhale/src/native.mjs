// The Native Messaging host: Chrome's side of pairing, with nothing to paste.
//
// `/chromewhale setup` registers this host with Chrome (and Chromium, Edge,
// Brave) under `net.codewhale.chrome`, allowing only the Codewhale for Chrome
// extension ID. When the side panel opens it calls
// `chrome.runtime.connectNative`; Chrome starts this process and talks to it
// over stdio in Native Messaging framing (a 32-bit native-endian length, then
// that many bytes of UTF-8 JSON). The host then does exactly what a panel
// with a pasted token used to do — it reads the pairing token from the 0600
// file the MCP server wrote, attaches to the loopback bridge with the signed
// challenge-response protocol, and relays calls to the panel and results back.
//
// So the token never enters the browser at all, and only the extension Chrome
// lets through `allowed_origins` can reach the bridge. Chrome ends this process
// when the panel closes (stdin reaches EOF), which is also when the tools must
// stop working.
//
// The bridge client is the extension's own (`extension/src/bridge.js`): it is
// runtime-agnostic (fetch, WebCrypto) and keeps one implementation of the
// signed protocol, its reconnects and its call queue.

import fs from "node:fs";
import path from "node:path";

import { BridgeClient } from "../extension/src/bridge.js";
import { readPairing } from "./pairing.mjs";

export const HOST_NAME = "net.codewhale.chrome";

/** Chrome refuses host-to-extension messages over 1 MiB. */
const MAX_TO_CHROME = 1024 * 1024;
/** A result can carry a screenshot; Chrome allows far more than this. */
const MAX_FROM_CHROME = 64 * 1024 * 1024;
const PAIRING_POLL_MS = 3_000;

/**
 * Frame one message for Chrome.
 *
 * @param {unknown} message
 */
export function encodeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length > MAX_TO_CHROME) {
    throw new Error(`A message to Chrome is capped at ${MAX_TO_CHROME} bytes (this one is ${body.length}).`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * Incremental decoder for Chrome's framing.
 */
export class MessageReader {
  constructor() {
    /** @type {Buffer} */
    this.buffer = Buffer.alloc(0);
  }

  /**
   * @param {Buffer} chunk
   * @returns {unknown[]} complete messages
   */
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages = [];
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32LE(0);
      if (size > MAX_FROM_CHROME) {
        throw new Error(`Chrome sent a ${size}-byte message; the cap is ${MAX_FROM_CHROME}.`);
      }
      if (this.buffer.length < 4 + size) {
        break;
      }
      messages.push(JSON.parse(this.buffer.subarray(4, 4 + size).toString("utf8")));
      this.buffer = this.buffer.subarray(4 + size);
    }
    return messages;
  }
}

/**
 * Run the host until Chrome closes stdin.
 *
 * @param {{stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, env?: NodeJS.ProcessEnv,
 *          root: string, log?: (line: string) => void}} io
 * @returns {Promise<void>} resolves when Chrome disconnects
 */
export function runNativeHost(io) {
  const env = io.env ?? process.env;
  const log = io.log ?? ((line) => process.stderr.write(`[codewhale-for-chrome host] ${line}\n`));
  const version = readVersion(io.root);

  /** @param {unknown} message */
  const send = (message) => {
    try {
      io.stdout.write(encodeMessage(message));
    } catch (error) {
      log(`dropped a message to Chrome: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /** Results the panel has not sent yet, by call id. @type {Map<string, (result: any) => void>} */
  const waiting = new Map();
  /** @type {BridgeClient | undefined} */
  let client;
  /** @type {NodeJS.Timeout | undefined} */
  let poll;
  let pairedWith = "";

  function attach() {
    const pairing = readPairing(env);
    if (!pairing.token) {
      send({
        type: "status",
        kind: "offline",
        detail:
          "No Codewhale session has started Codewhale for Chrome yet. Enable the plugin in Codewhale; this panel " +
          "connects as soon as it runs.",
      });
      return false;
    }
    const key = `${pairing.host}:${pairing.port}:${pairing.token}`;
    if (key === pairedWith) {
      return true;
    }
    pairedWith = key;
    client?.stop();
    const host = pairing.host.includes(":") ? `[${pairing.host}]` : pairing.host;
    client = new BridgeClient({
      baseUrl: `http://${host}:${pairing.port}`,
      token: pairing.token,
      version,
      onStatus: (status) => send({ type: "status", ...status }),
      onCall: (call) =>
        new Promise((resolve) => {
          const { signal, ...rest } = call;
          waiting.set(call.id, resolve);
          signal.addEventListener(
            "abort",
            () => {
              // The bridge has already told the model; the panel must drop it.
              send({ type: "cancel", id: call.id });
            },
            { once: true },
          );
          send({ type: "call", ...rest });
        }),
    });
    client.start();
    log(`attaching to the bridge on ${pairing.host}:${pairing.port}`);
    return true;
  }

  send({ type: "hello", version, host: HOST_NAME });
  // The pairing file may not exist yet, or may change owner port: keep
  // checking it, which is cheap, rather than asking the user to reopen.
  attach();
  poll = setInterval(attach, PAIRING_POLL_MS);
  poll.unref?.();

  const reader = new MessageReader();
  return new Promise((resolve) => {
    const finish = () => {
      clearInterval(poll);
      client?.stop();
      for (const done of waiting.values()) {
        done({ success: false, content: [{ type: "text", text: "The Codewhale for Chrome panel closed before this call finished." }] });
      }
      waiting.clear();
      resolve(undefined);
    };
    io.stdin.on("data", (chunk) => {
      let messages;
      try {
        messages = reader.push(/** @type {Buffer} */ (chunk));
      } catch (error) {
        log(error instanceof Error ? error.message : String(error));
        finish();
        return;
      }
      for (const message of messages) {
        if (message && typeof message === "object" && message.type === "result" && typeof message.id === "string") {
          const done = waiting.get(message.id);
          waiting.delete(message.id);
          done?.({ success: message.success === true, content: Array.isArray(message.content) ? message.content : [] });
        }
      }
    });
    io.stdin.on("end", finish);
    io.stdin.on("error", finish);
  });
}

/** @param {string} root */
function readVersion(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
