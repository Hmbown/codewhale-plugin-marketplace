#!/usr/bin/env node
// Regenerate every icon artifact from assets/icon-source.png. Zero
// dependencies and platform-independent: PNG, ICO and ICNS are all written by
// hand (ICNS/ICO accept PNG-compressed members on every OS we ship to).
//
//   assets/icon.png                       1024², full-bleed tile, transparent corners (Linux/Windows/web)
//   assets/icon-macos.png                 1024², tile scaled to Apple's 824px grid with transparent margin
//   assets/icon.icns                      macOS bundle icon (from the macOS canvas)
//   assets/icon.ico                       Windows icon (16..256, PNG members)
//   assets/icons/hicolor/<N>x<N>/apps/net.codewhale.computer-use.png   freedesktop icon theme
//
// Run: node scripts/build-icons.mjs
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { decodePng, encodePng, resize, roundedMask, pixel } from "./lib/png.mjs";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const ASSETS = path.join(ROOT, "assets");
export const ICON_NAME = "net.codewhale.computer-use";
const SOURCE = path.join(ASSETS, "icon-source.png");

// The source is a navy rounded square painted onto opaque black. Measured
// radius is ~14.7% of the edge; masking at 15.6% keeps every anti-aliased
// black fringe pixel outside the visible shape.
const CORNER_RADIUS_FRACTION = 0.156;
const MASTER = 1024;
const APPLE_GRID = 824; // macOS icon artwork size inside the 1024 canvas
const HICOLOR_SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const ICNS_TYPES = [
  ["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024],
  ["ic11", 32], ["ic12", 64], ["ic13", 256], ["ic14", 512],
];

function assertNoBlackFringe(img, label) {
  let bad = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] > 0 && Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) < 8) bad++;
  }
  if (bad) throw new Error(`${label}: ${bad} visible near-black pixels survived the corner mask`);
}

function placeOnCanvas(img, canvas, size) {
  const scaled = resize(img, size, size);
  const out = new Uint8Array(canvas * canvas * 4);
  const off = Math.round((canvas - size) / 2);
  for (let y = 0; y < size; y++) out.set(scaled.data.subarray(y * size * 4, (y + 1) * size * 4), ((off + y) * canvas + off) * 4);
  return { width: canvas, height: canvas, data: out };
}

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, png } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size; e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    entries.push(e); offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)]);
}

function icns(members) {
  const parts = [];
  for (const { type, png } of members) {
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, "latin1"); head.writeUInt32BE(8 + png.length, 4);
    parts.push(head, png);
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write("icns", 0, 4, "latin1"); head.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

export function buildIcons({ source = SOURCE, assets = ASSETS } = {}) {
  const src = decodePng(fs.readFileSync(source));
  if (src.width !== src.height) throw new Error(`icon source must be square, got ${src.width}x${src.height}`);
  const masked = roundedMask(src, src.width * CORNER_RADIUS_FRACTION);
  const master = resize(masked, MASTER, MASTER);
  assertNoBlackFringe(master, "master tile");
  const macCanvas = placeOnCanvas(masked, MASTER, APPLE_GRID);

  const written = [];
  const write = (rel, buf) => {
    const full = path.join(assets, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buf);
    written.push(rel);
  };
  const sized = new Map();
  const at = (img, n) => {
    const key = `${img === macCanvas ? "mac" : "tile"}:${n}`;
    if (!sized.has(key)) sized.set(key, encodePng(n === MASTER ? img : resize(img, n, n)));
    return sized.get(key);
  };

  write("icon.png", at(master, MASTER));
  write("icon-macos.png", at(macCanvas, MASTER));
  for (const n of HICOLOR_SIZES) write(`icons/hicolor/${n}x${n}/apps/${ICON_NAME}.png`, at(master, n));
  write("icon.ico", ico(ICO_SIZES.map((n) => ({ size: n, png: at(master, n) }))));
  write("icon.icns", icns(ICNS_TYPES.map(([type, n]) => ({ type, png: at(macCanvas, n) }))));
  return { written, corner: pixel(master, 0, 0), center: pixel(master, MASTER >> 1, MASTER >> 1) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  const r = buildIcons();
  for (const rel of r.written) console.log(`wrote assets/${rel}`);
  console.log(`corner rgba=${r.corner.join(",")} center rgba=${r.center.join(",")}`);
}
