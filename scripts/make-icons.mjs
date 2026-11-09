/**
 * Generates the PNG app icons (192, 512, maskable, apple-touch).
 *
 * Written by hand instead of pulling in an image library: the artwork is a few
 * shapes, and zlib already ships with Node. Run with `npm run icons`.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'public/icons';

// ---- PNG encoding ---------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- artwork --------------------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

const ACCENT = [46, 230, 168];
const SKY = [70, 184, 245];
const PAPER = [233, 240, 247];

const BG_TOP = [10, 14, 19];
const BG_BOTTOM = [18, 28, 38];

const CX = 0.5;
const CY = 0.6;
const RADIUS = 0.255;
const THICK = 0.078;

function roundRectSdf(x, y, r) {
  const cx = Math.abs(x - 0.5) - (0.5 - r);
  const cy = Math.abs(y - 0.5) - (0.5 - r);
  return Math.hypot(Math.max(cx, 0), Math.max(cy, 0)) - r;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

function shade(x, y, opts) {
  if (opts.rounded && roundRectSdf(x, y, 0.23) > 0) return [0, 0, 0, 0];

  let color = mix(BG_TOP, BG_BOTTOM, y);
  let alpha = 255;

  // Content is inset on maskable/apple icons so platform masks never clip it.
  const s = opts.contentScale;
  const ux = (x - 0.5) / s + 0.5;
  const uy = (y - 0.5) / s + 0.5;

  const dist = Math.hypot(ux - CX, uy - CY);
  const angle = (Math.atan2(CY - uy, ux - CX) * 180) / Math.PI;
  const deg = (angle + 360) % 360;
  const onArc = deg >= 135 || deg <= 45;

  if (onArc && Math.abs(dist - RADIUS) <= THICK / 2) {
    const t = (((deg - 135 + 360) % 360) / 270) % 1;
    color = mix(ACCENT, SKY, t);
  }

  // Needle pointing up and to the right, plus its hub.
  const tipX = CX + 0.185 * Math.cos(Math.PI / 4);
  const tipY = CY - 0.185 * Math.sin(Math.PI / 4);
  const needle = distanceToSegment(ux, uy, CX, CY, tipX, tipY);
  if (needle <= 0.019) color = PAPER;

  const hub = dist <= 0.055;
  if (hub) {
    color = dist <= 0.032 ? ACCENT : mix(BG_TOP, BG_BOTTOM, uy);
  }

  return [color[0], color[1], color[2], alpha];
}

function render(size, opts) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = (x + (sx + 0.5) / samples) / size;
          const py = (y + (sy + 0.5) / samples) / size;
          const [cr, cg, cb, ca] = shade(px, py, opts);
          const w = ca / 255;
          r += cr * w;
          g += cg * w;
          b += cb * w;
          a += ca;
        }
      }
      const n = samples * samples;
      const alpha = a / n;
      const i = (y * size + x) * 4;
      const weight = alpha / 255 || 1;
      rgba[i] = Math.round(r / n / weight);
      rgba[i + 1] = Math.round(g / n / weight);
      rgba[i + 2] = Math.round(b / n / weight);
      rgba[i + 3] = Math.round(alpha);
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(OUT, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, opts: { rounded: true, contentScale: 0.94 } },
  { file: 'icon-512.png', size: 512, opts: { rounded: true, contentScale: 0.94 } },
  // Maskable icons are cropped to a circle by Android — keep everything inside 80%.
  { file: 'maskable-512.png', size: 512, opts: { rounded: false, contentScale: 0.8 } },
  // iOS applies its own rounded mask, so this one ships as a full square.
  { file: 'apple-touch-icon.png', size: 180, opts: { rounded: false, contentScale: 0.84 } },
];

for (const { file, size, opts } of targets) {
  const png = render(size, opts);
  writeFileSync(`${OUT}/${file}`, png);
  console.log(`${OUT}/${file}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}
