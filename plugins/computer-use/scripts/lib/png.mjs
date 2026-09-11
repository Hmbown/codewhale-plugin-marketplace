// Minimal PNG codec + raster helpers. Zero dependencies (node:zlib only).
// Enough for icon work: decode 8-bit non-interlaced PNGs (gray, gray+alpha,
// RGB, RGBA, palette), encode RGBA, area-average downscale, rounded-corner
// alpha mask. Not a general image library — every input outside that envelope
// fails closed with a named error.
import zlib from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** @returns {{width:number,height:number,data:Uint8Array}} RGBA, 8 bits per channel */
export function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let pos = 8;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  let palette = null;
  let transparency = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") transparency = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth} (only 8)`);
  if (interlace !== 0) throw new Error("interlaced PNGs are not supported");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    for (let i = 0; i < stride; i++) {
      const x = raw[p++];
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) v = x + paeth(a, b, c);
      else throw new Error(`bad PNG filter ${filter}`);
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * channels;
      if (colorType === 6) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = cur[s + 3]; }
      else if (colorType === 2) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = 255; }
      else if (colorType === 0) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = 255; }
      else if (colorType === 4) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = cur[s + 1]; }
      else { // palette
        const idx = cur[s];
        out[o] = palette[idx * 3]; out[o + 1] = palette[idx * 3 + 1]; out[o + 2] = palette[idx * 3 + 2];
        out[o + 3] = transparency && idx < transparency.length ? transparency[idx] : 255;
      }
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

/** Encode RGBA (8-bit) as PNG. Uses the Paeth filter on every row. */
export function encodePng({ width, height, data }) {
  if (data.length !== width * height * 4) throw new Error("encodePng expects RGBA data");
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 4;
    for (let i = 0; i < stride; i++) {
      const o = y * stride + i;
      const a = i >= 4 ? data[o - 4] : 0;
      const b = y > 0 ? data[o - stride] : 0;
      const c = y > 0 && i >= 4 ? data[o - stride - 4] : 0;
      raw[p++] = (data[o] - paeth(a, b, c)) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Crop a rectangle out of an RGBA raster. */
export function crop(img, x0, y0, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * img.width + x0) * 4;
    out.set(img.data.subarray(src, src + w * 4), y * w * 4);
  }
  return { width: w, height: h, data: out };
}

/**
 * Area-averaging resample (premultiplied alpha), correct for any downscale
 * ratio and acceptable for mild upscale. Icons only ever go down.
 */
export function resize(img, w, h) {
  const out = new Uint8Array(w * h * 4);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy, y1 = (y + 1) * sy;
    for (let x = 0; x < w; x++) {
      const x0 = x * sx, x1 = (x + 1) * sx;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.min(Math.ceil(y1), img.height); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        if (wy <= 0) continue;
        for (let xx = Math.floor(x0); xx < Math.min(Math.ceil(x1), img.width); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          if (wx <= 0) continue;
          const wgt = wx * wy;
          const o = (yy * img.width + xx) * 4;
          const al = img.data[o + 3] / 255;
          r += img.data[o] * al * wgt; g += img.data[o + 1] * al * wgt; b += img.data[o + 2] * al * wgt;
          a += al * wgt; wsum += wgt;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a);
        out[o + 3] = Math.round((a / wsum) * 255);
      }
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * Multiply alpha by an anti-aliased rounded-rectangle coverage mask.
 * `radius` is in pixels of this raster; `inset` shrinks the rectangle.
 */
export function roundedMask(img, radius, inset = 0) {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(data);
  const left = inset, top = inset, right = w - inset, bottom = h - inset;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5, py = y + 0.5;
      // signed distance to the rounded rectangle (negative inside)
      const cx = Math.min(Math.max(px, left + radius), right - radius);
      const cy = Math.min(Math.max(py, top + radius), bottom - radius);
      const dx = px - cx, dy = py - cy;
      const d = Math.sqrt(dx * dx + dy * dy) - radius;
      const cov = Math.min(1, Math.max(0, 0.5 - d));
      const o = (y * w + x) * 4;
      out[o + 3] = Math.round(data[o + 3] * cov);
    }
  }
  return { width: w, height: h, data: out };
}

export function pixel(img, x, y) {
  const o = (y * img.width + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
}
