/*
 * Reads src/assets/brand/cube-logo-light.png, color-keys the background
 * (alpha=0 for pixels close to the corner color) and writes the result
 * to public/ as favicon-16x16.png, favicon-32x32.png, apple-touch-icon.png,
 * android-chrome-192x192.png, android-chrome-512x512.png, mstile-150x150.png.
 *
 * Pure node — no native deps. Decodes raw PNG with zlib + paeth filter
 * and re-encodes with filter=None scanlines + chunk CRCs.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = path.resolve(__dirname, '..', 'src/assets/brand/cube-logo-dark.png');
const OUT_DIR = path.resolve(__dirname, '..', 'public');
const TARGETS = [
  'favicon-16x16.png',
  'favicon-32x32.png',
  'apple-touch-icon.png',
  'android-chrome-192x192.png',
  'android-chrome-512x512.png',
  'mstile-150x150.png',
];

function decodePng(buf) {
  const sig = '89504e470d0a1a0a';
  if (buf.slice(0, 8).toString('hex') !== sig) {
    throw new Error('not a PNG');
  }
  let pos = 8;
  let ihdr = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
    if (type === 'IEND') break;
  }
  if (!ihdr) throw new Error('missing IHDR');
  const w = ihdr.readUInt32BE(0);
  const h = ihdr.readUInt32BE(4);
  const depth = ihdr.readUInt8(8);
  const colorType = ihdr.readUInt8(9);
  if (depth !== 8 || colorType !== 6) {
    throw new Error(`unsupported PNG bit-depth/color-type: ${depth}/${colorType}`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const rowBytes = w * bpp;
  const stride = 1 + rowBytes;
  const out = Buffer.alloc(rowBytes * h);

  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  for (let y = 0; y < h; y++) {
    const filter = raw[y * stride];
    const src = y * stride + 1;
    const dst = y * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const cur = raw[src + x];
      const left = x >= bpp ? out[dst + x - bpp] : 0;
      const up = y > 0 ? out[dst - rowBytes + x] : 0;
      const ul = x >= bpp && y > 0 ? out[dst - rowBytes + x - bpp] : 0;
      let v;
      if (filter === 0) v = cur;
      else if (filter === 1) v = cur + left;
      else if (filter === 2) v = cur + up;
      else if (filter === 3) v = cur + ((left + up) >> 1);
      else if (filter === 4) v = cur + paeth(left, up, ul);
      else throw new Error(`bad filter ${filter}`);
      out[dst + x] = v & 0xff;
    }
  }

  return { w, h, pixels: out };
}

function encodePng(w, h, pixels) {
  const bpp = 4;
  const rowBytes = w * bpp;
  const raw = Buffer.alloc((1 + rowBytes) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (1 + rowBytes)] = 0; // filter None
    pixels.copy(raw, y * (1 + rowBytes) + 1, y * rowBytes, y * rowBytes + rowBytes);
  }
  const idat = zlib.deflateSync(raw);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcInput = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(crcInput) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  const sig = Buffer.from('89504e470d0a1a0a', 'hex');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Bilinear resize (good enough quality for small favicon targets)
function resize(srcW, srcH, srcPx, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 4);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(srcH - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sy - y0));
    for (let x = 0; x < dstW; x++) {
      const sx = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      for (let c = 0; c < 4; c++) {
        const p00 = srcPx[(y0 * srcW + x0) * 4 + c];
        const p01 = srcPx[(y0 * srcW + x1) * 4 + c];
        const p10 = srcPx[(y1 * srcW + x0) * 4 + c];
        const p11 = srcPx[(y1 * srcW + x1) * 4 + c];
        const top = p00 * (1 - fx) + p01 * fx;
        const bot = p10 * (1 - fx) + p11 * fx;
        out[(y * dstW + x) * 4 + c] = Math.round(top * (1 - fy) + bot * fy);
      }
    }
  }
  return out;
}

function keyOutBackground(w, h, px, tolerance, softWidth) {
  // Sample the 4 corners + 4 mid-edges to vote for the background color.
  const samples = [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
    [Math.floor(w / 2), 0], [Math.floor(w / 2), h - 1],
    [0, Math.floor(h / 2)], [w - 1, Math.floor(h / 2)],
  ];
  let sr = 0, sg = 0, sb = 0;
  for (const [x, y] of samples) {
    const i = (y * w + x) * 4;
    sr += px[i];
    sg += px[i + 1];
    sb += px[i + 2];
  }
  const bg = [sr / samples.length, sg / samples.length, sb / samples.length];

  for (let i = 0; i < px.length; i += 4) {
    const dr = px[i] - bg[0];
    const dg = px[i + 1] - bg[1];
    const db = px[i + 2] - bg[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist <= tolerance) {
      px[i + 3] = 0;
    } else if (dist <= tolerance + softWidth) {
      // narrow anti-alias band so edges don't look jagged
      const t = (dist - tolerance) / softWidth;
      px[i + 3] = Math.round(px[i + 3] * t);
    }
    // beyond tolerance + softWidth: keep original alpha (logo body)
  }
  return bg;
}

function computeOpaqueBbox(w, h, px, alphaThreshold = 32) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function cropAndSquare(w, h, px, bbox, paddingRatio) {
  // Square canvas around the bbox with a small symmetrical padding so the
  // logo doesn't bleed into the favicon edges. paddingRatio is relative to
  // the longer bbox side (e.g. 0.06 = 6% padding).
  const longer = Math.max(bbox.w, bbox.h);
  const pad = Math.round(longer * paddingRatio);
  const sq = longer + pad * 2;
  const out = Buffer.alloc(sq * sq * 4, 0); // alpha=0 default
  const offX = Math.floor((sq - bbox.w) / 2);
  const offY = Math.floor((sq - bbox.h) / 2);
  for (let y = 0; y < bbox.h; y++) {
    for (let x = 0; x < bbox.w; x++) {
      const s = ((bbox.y + y) * w + (bbox.x + x)) * 4;
      const d = ((offY + y) * sq + (offX + x)) * 4;
      out[d] = px[s];
      out[d + 1] = px[s + 1];
      out[d + 2] = px[s + 2];
      out[d + 3] = px[s + 3];
    }
  }
  return { side: sq, pixels: out };
}

function main() {
  const srcBuf = fs.readFileSync(SRC);
  const { w: sw, h: sh, pixels: srcPx } = decodePng(srcBuf);
  const bgUsed = keyOutBackground(sw, sh, srcPx, 70, 20);
  console.log(`Source: ${sw}x${sh}, background sampled ≈ rgb(${bgUsed.map((v) => v.toFixed(0)).join(',')})`);

  const bbox = computeOpaqueBbox(sw, sh, srcPx);
  if (!bbox) throw new Error('no opaque pixels remain after background key');
  console.log(`Cube bbox: x=${bbox.x}, y=${bbox.y}, w=${bbox.w}, h=${bbox.h}`);

  // Crop to bbox + 6% padding, then square — cube now fills ~88% of the canvas.
  const { side: sq, pixels: square } = cropAndSquare(sw, sh, srcPx, bbox, 0.06);
  console.log(`Squared canvas: ${sq}x${sq}`);

  const sizeMap = {
    'favicon-16x16.png': 16,
    'favicon-32x32.png': 32,
    'apple-touch-icon.png': 180,
    'android-chrome-192x192.png': 192,
    'android-chrome-512x512.png': 512,
    'mstile-150x150.png': 150,
  };

  for (const file of TARGETS) {
    const target = sizeMap[file];
    const resized = resize(sq, sq, square, target, target);
    const out = encodePng(target, target, resized);
    fs.writeFileSync(path.join(OUT_DIR, file), out);
    console.log(`Wrote ${file} (${target}x${target}, ${out.length} bytes)`);
  }
}

main();
