// Where the bridge's endpoint and pairing token live.
//
// The token is the only thing standing between a web page and the command
// channel: any page the user visits can issue a cross-origin POST at
// 127.0.0.1, and a bridge that trusted "it came from loopback" would take
// orders from whatever tab happened to be open. Requiring `Authorization:
// Bearer` does double duty — it authenticates the extension, and because a
// simple no-cors request cannot set that header, it also forces a preflight
// this server never answers.
//
// Known limitations:
// - The token is stored in a 0600 file under the user's state directory. It is
//   readable by anything already running as that user, which is the same trust
//   level the Codewhale runtime token sits at. This is not a defense against a
//   local attacker who is already you.
// - There is one token per machine, not per browser profile. Two Chrome
//   profiles paired to the same bridge are indistinguishable to it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const DEFAULT_PORT = 8899;
export const DEFAULT_HOST = "127.0.0.1";

/** Directory holding the pairing file. `CHROMEWHALE_STATE_DIR` overrides. */
export function stateDir(env = process.env) {
  if (env.CHROMEWHALE_STATE_DIR) {
    return env.CHROMEWHALE_STATE_DIR;
  }
  const home = env.CODEWHALE_HOME || path.join(os.homedir(), ".codewhale");
  return path.join(home, "chromewhale");
}

/** @param {NodeJS.ProcessEnv} [env] */
export function pairingPath(env = process.env) {
  return path.join(stateDir(env), "bridge.json");
}

/**
 * Resolve the bridge endpoint, generating and persisting a token on first run.
 *
 * `CHROMEWHALE_BRIDGE_TOKEN` wins over the file and is never written to disk,
 * so a user who wants the token to live only in their shell can have that.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{host: string, port: number, token: string, source: "env" | "file" | "created"}}
 */
export function resolveEndpoint(env = process.env) {
  const host = env.CHROMEWHALE_BRIDGE_HOST || DEFAULT_HOST;
  const port = readPort(env.CHROMEWHALE_BRIDGE_PORT);

  if (env.CHROMEWHALE_BRIDGE_TOKEN) {
    return { host, port, token: env.CHROMEWHALE_BRIDGE_TOKEN, source: "env" };
  }

  const file = pairingPath(env);
  const existing = readToken(file);
  if (existing) {
    return { host, port, token: existing, source: "file" };
  }

  const token = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify({ token, port, host }, null, 2)}\n`, { mode: 0o600 });
  return { host, port, token, source: "created" };
}

/**
 * Compare a presented credential against the expected one without leaking
 * length or position through timing.
 *
 * @param {unknown} presented
 * @param {string} expected
 */
export function tokenMatches(presented, expected) {
  if (typeof presented !== "string" || typeof expected !== "string" || expected === "") {
    return false;
  }
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Pull the bearer credential out of an Authorization header.
 *
 * @param {unknown} header
 * @returns {string | undefined}
 */
export function bearerOf(header) {
  if (typeof header !== "string") {
    return undefined;
  }
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
  return match ? match[1] : undefined;
}

/** @param {string} file */
function readToken(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof parsed?.token === "string" && parsed.token ? parsed.token : undefined;
  } catch {
    return undefined;
  }
}

/** @param {string | undefined} raw */
function readPort(raw) {
  if (raw === undefined || raw === "") {
    return DEFAULT_PORT;
  }
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    // Fails loud rather than silently serving somewhere the extension will
    // never look for it.
    throw new Error(`CHROMEWHALE_BRIDGE_PORT must be 1-65535, got "${raw}"`);
  }
  return port;
}
