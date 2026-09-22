import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_PORT,
  bearerOf,
  isLoopbackHost,
  pairingPath,
  readPairing,
  recordEndpoint,
  resolveEndpoint,
  tokenMatches,
} from "../src/pairing.mjs";

function tempEnv(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chromewhale-"));
  return { CHROMEWHALE_STATE_DIR: dir, ...extra };
}

test("the first run mints a token and persists it privately", () => {
  const env = tempEnv();
  const first = resolveEndpoint(env);
  assert.equal(first.source, "created");
  assert.match(first.token, /^[0-9a-f]{64}$/, "64 hex chars is 32 bytes of entropy");
  assert.equal(first.port, DEFAULT_PORT);

  const file = pairingPath(env);
  assert.equal(fs.existsSync(file), true);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, "the token must not be world-readable");
  }
});

test("later runs reuse the stored token, so a paired panel stays paired", () => {
  const env = tempEnv();
  const first = resolveEndpoint(env);
  const second = resolveEndpoint(env);
  assert.equal(second.source, "file");
  assert.equal(second.token, first.token);
});

test("an env token wins and is never written to disk", () => {
  const env = tempEnv({ CHROMEWHALE_BRIDGE_TOKEN: "from-the-shell" });
  const endpoint = resolveEndpoint(env);
  assert.equal(endpoint.source, "env");
  assert.equal(endpoint.token, "from-the-shell");
  assert.equal(fs.existsSync(pairingPath(env)), false);
});

test("a bad port fails loud instead of serving where nothing will look", () => {
  for (const bad of ["0", "-1", "70000", "eight thousand"]) {
    assert.throws(
      () => resolveEndpoint(tempEnv({ CHROMEWHALE_BRIDGE_PORT: bad })),
      /CHROMEWHALE_BRIDGE_PORT/,
      `port "${bad}" must be refused`,
    );
  }
});

test("token comparison rejects the near misses a string compare would leak", () => {
  const token = "a".repeat(64);
  assert.equal(tokenMatches(token, token), true);
  assert.equal(tokenMatches(`${"a".repeat(63)}b`, token), false);
  assert.equal(tokenMatches("a".repeat(63), token), false, "a prefix is not a match");
  assert.equal(tokenMatches(`${token}extra`, token), false);
  assert.equal(tokenMatches(undefined, token), false);
  assert.equal(tokenMatches(token, ""), false, "an empty expected token matches nothing");
});

test("only a well-formed bearer header yields a credential", () => {
  assert.equal(bearerOf("Bearer abc123"), "abc123");
  assert.equal(bearerOf("bearer abc123"), "abc123");
  assert.equal(bearerOf("  Bearer\tabc123  "), "abc123");
  assert.equal(bearerOf("Basic abc123"), undefined);
  assert.equal(bearerOf("abc123"), undefined);
  assert.equal(bearerOf("Bearer"), undefined);
  assert.equal(bearerOf("Bearer a b"), undefined);
  assert.equal(bearerOf(undefined), undefined);
});

test("a non-loopback bridge host is refused at startup", () => {
  for (const bad of ["0.0.0.0", "192.168.1.5", "example.com", "::", "128.0.0.1"]) {
    assert.throws(
      () => resolveEndpoint(tempEnv({ CHROMEWHALE_BRIDGE_HOST: bad })),
      /loopback/,
      `host "${bad}" must be refused: the token travels in clear HTTP`,
    );
  }
  for (const good of ["127.0.0.1", "127.1.2.3", "localhost", "::1", "[::1]"]) {
    assert.equal(isLoopbackHost(good), true, good);
  }
});

test("a server that loses the first-run race adopts the winner's token", () => {
  // Two sessions starting together both find no pairing file and both mint a
  // token. Before the fix each wrote its own and the loser served a token no
  // one could read. Deterministically make this process the loser: another
  // writer lands the file between our check and our write.
  const env = tempEnv();
  const file = pairingPath(env);
  const original = fs.linkSync;
  fs.linkSync = (from, to) => {
    fs.writeFileSync(to, JSON.stringify({ token: "winner-token", port: DEFAULT_PORT }));
    return original(from, to);
  };
  let endpoint;
  try {
    endpoint = resolveEndpoint(env);
  } finally {
    fs.linkSync = original;
  }
  assert.equal(endpoint.token, "winner-token", "the loser serves the token on disk");
  assert.equal(endpoint.source, "file");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).token, "winner-token", "the winner's file is untouched");
  const leftovers = fs.readdirSync(path.dirname(file)).filter((name) => name.endsWith(".tmp"));
  assert.deepEqual(leftovers, [], "no temp files are left behind");
});

test("the owning bridge records where it bound, and status reads it back", () => {
  const env = tempEnv({ CHROMEWHALE_BRIDGE_PORT: "9001" });
  const endpoint = resolveEndpoint(env);
  assert.equal(readPairing(env).port, 9001, "before any server binds, the requested port");
  assert.equal(recordEndpoint({ host: "127.0.0.1", port: 45678, token: endpoint.token, pid: 4242, version: "0.1.0" }, env), true);
  const read = readPairing(env);
  assert.equal(read.port, 45678, "the recorded port wins over the environment");
  assert.equal(read.pid, 4242);
  assert.equal(read.token, endpoint.token);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(pairingPath(env)).mode & 0o777, 0o600, "rewriting keeps the file private");
  }
});

test("a bridge serving a different token never overwrites the pairing record", () => {
  const env = tempEnv();
  const endpoint = resolveEndpoint(env);
  assert.equal(recordEndpoint({ host: "127.0.0.1", port: 1234, token: "not-the-file-token" }, env), false);
  const read = readPairing(env);
  assert.equal(read.port, DEFAULT_PORT);
  assert.equal(read.token, endpoint.token);
});
