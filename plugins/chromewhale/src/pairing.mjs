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
// - The bridge is loopback-only. `CHROMEWHALE_BRIDGE_HOST` may name another
//   loopback address, never a routable one: the token travels in clear HTTP.

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
  if (!isLoopbackHost(host)) {
    throw new Error(
      `CHROMEWHALE_BRIDGE_HOST must be a loopback address (127.x.x.x, ::1, localhost), got "${host}"`,
    );
  }
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
  // Two Codewhale sessions can start this server at the same instant. Writing
  // the file in place would let each mint its own token and the loser keep
  // serving a token nobody can read. Instead the file is written whole to a
  // private temp name and hard-linked into place, which fails if it already
  // exists — the loser then adopts the winner's token.
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ token, port, host }, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.linkSync(temp, file);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") {
      throw error;
    }
    const winner = readToken(file);
    if (!winner) {
      throw new Error(`${file} exists but holds no pairing token; delete it and restart`);
    }
    return { host, port, token: winner, source: "file" };
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return { host, port, token, source: "created" };
}

/**
 * Record where the bridge that owns the port is actually listening, so
 * `bin/chromewhale.mjs status` asks the right place instead of assuming 8899.
 *
 * Only the pairing file this process read its token from is updated, and only
 * while it still holds that token. The write is a whole-file rename, so a
 * concurrent reader sees the old record or the new one, never half of each.
 *
 * @param {{host: string, port: number, token: string, pid?: number, version?: string}} live
 * @param {NodeJS.ProcessEnv} [env]
 */
export function recordEndpoint(live, env = process.env) {
  const file = pairingPath(env);
  let current;
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return false;
  }
  if (current?.token !== live.token) {
    return false;
  }
  const next = {
    ...current,
    host: live.host,
    port: live.port,
    pid: live.pid ?? process.pid,
    version: live.version,
    updatedAt: new Date().toISOString(),
  };
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
    return true;
  } catch {
    fs.rmSync(temp, { force: true });
    return false;
  }
}

/**
 * Read the pairing record for `status`: the recorded endpoint wins over the
 * environment, because it is where the owning bridge actually bound.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{host: string, port: number, token?: string, pid?: number, version?: string, file: string}}
 */
export function readPairing(env = process.env) {
  const file = pairingPath(env);
  let record = {};
  try {
    record = JSON.parse(fs.readFileSync(file, "utf8")) ?? {};
  } catch {
    record = {};
  }
  const host = typeof record.host === "string" && record.host ? record.host : env.CHROMEWHALE_BRIDGE_HOST || DEFAULT_HOST;
  const port = Number.isInteger(record.port) ? record.port : readPort(env.CHROMEWHALE_BRIDGE_PORT);
  const token = env.CHROMEWHALE_BRIDGE_TOKEN || (typeof record.token === "string" ? record.token : undefined);
  return {
    host,
    port,
    token,
    pid: Number.isInteger(record.pid) ? record.pid : undefined,
    version: typeof record.version === "string" ? record.version : undefined,
    file,
  };
}

/**
 * Is this a loopback host? Names only, no DNS: `localhost` is accepted by
 * name, everything else must be a literal loopback address.
 *
 * @param {unknown} host
 */
export function isLoopbackHost(host) {
  if (typeof host !== "string") {
    return false;
  }
  const bare = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (bare === "localhost" || bare === "::1") {
    return true;
  }
  const octets = bare.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
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
