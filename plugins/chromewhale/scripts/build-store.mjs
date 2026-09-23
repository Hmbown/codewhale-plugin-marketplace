#!/usr/bin/env node
// Build the Chrome Web Store upload: `dist/codewhale-for-chrome-<version>.zip`.
//
// - The manifest's `key` is removed. It fixes the extension ID for unpacked
//   development builds; the Web Store refuses a *first* upload that carries
//   one and assigns the listing its own key and ID. (Once that ID exists it
//   joins STORE_EXTENSION_IDS in src/install.mjs so the connector admits it.)
// - Only `extension/` is packaged, and the build refuses if the extension and
//   the plugin disagree on the version.
// - Entries are sorted and carry a fixed timestamp, so the same source always
//   yields the same bytes and SHA-256.
//
// Usage: node scripts/build-store.mjs [--out <dir>]

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import zlib from "node:zlib";
import crypto from "node:crypto";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const EXTENSION = path.join(ROOT, "extension");
/** 1980-01-01 00:00, the earliest time a zip entry can carry. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/**
 * @param {string[]} argv
 * @returns {{file: string, sha256: string, bytes: number, version: string, entries: string[]}}
 */
export function buildStoreZip(argv = []) {
  const at = argv.indexOf("--out");
  const outDir = path.resolve(at >= 0 ? argv[at + 1] : path.join(ROOT, "dist"));
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, "plugin.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION, "manifest.json"), "utf8"));
  if (manifest.version !== plugin.version) {
    throw new Error(`extension/manifest.json is ${manifest.version} but plugin.json is ${plugin.version}.`);
  }
  const { key: _key, ...storeManifest } = manifest;

  /** @type {Array<[string, Buffer]>} */
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const name = path.relative(EXTENSION, full).split(path.sep).join("/");
        files.push([name, name === "manifest.json" ? Buffer.from(`${JSON.stringify(storeManifest, null, 2)}\n`) : fs.readFileSync(full)]);
      }
    }
  };
  walk(EXTENSION);
  files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const zip = writeZip(files);
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `codewhale-for-chrome-${manifest.version}.zip`);
  fs.writeFileSync(file, zip);
  return {
    file,
    sha256: crypto.createHash("sha256").update(zip).digest("hex"),
    bytes: zip.length,
    version: manifest.version,
    entries: files.map(([name]) => name),
  };
}

/**
 * A plain zip: deflated entries, no extra fields, fixed timestamps.
 *
 * @param {Array<[string, Buffer]>} files
 */
function writeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  const built = buildStoreZip(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify({ file: built.file, version: built.version, bytes: built.bytes, sha256: built.sha256 }, null, 2)}\n`);
}
