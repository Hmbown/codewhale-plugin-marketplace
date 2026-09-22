import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_PORT, bearerOf, pairingPath, resolveEndpoint, tokenMatches } from "../src/pairing.mjs";

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
