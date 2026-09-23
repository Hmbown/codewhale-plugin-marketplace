import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { buildStoreZip } from "../scripts/build-store.mjs";

/** Read one stored entry back out of a zip written by build-store. */
function entry(zip, name) {
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const method = zip.readUInt16LE(at + 8);
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const entryName = zip.subarray(at + 30, at + 30 + nameLength).toString("utf8");
    const body = zip.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    if (entryName === name) {
      return method === 8 ? zlib.inflateRawSync(body) : body;
    }
    at += 30 + nameLength + size;
  }
  return undefined;
}

test("the store build drops the development key, keeps the version, and is reproducible", () => {
  const first = buildStoreZip(["--out", fs.mkdtempSync(path.join(os.tmpdir(), "cw-store-"))]);
  const second = buildStoreZip(["--out", fs.mkdtempSync(path.join(os.tmpdir(), "cw-store-"))]);
  assert.equal(first.sha256, second.sha256, "same source, same bytes");
  const manifest = JSON.parse(entry(fs.readFileSync(first.file), "manifest.json").toString("utf8"));
  assert.equal(manifest.key, undefined, "the Web Store refuses a first upload that carries a key");
  assert.equal(manifest.name, "Codewhale for Chrome");
  assert.equal(manifest.version, first.version);
  for (const size of ["16", "32", "48", "128"]) {
    assert.ok(first.entries.includes(manifest.icons[size]), `icon ${size} is packaged`);
  }
  assert.ok(first.entries.every((name) => !name.startsWith("../") && !name.startsWith("/")));
});
