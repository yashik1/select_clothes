/**
 * Generates the app's icons.
 *
 * A committed binary nobody can read or review is a small liability, so the
 * icons are generated from the same mark the header draws — a rounded square in
 * the ink colour with a white F — and the script is the source of truth. Run
 * `npm run icons` after changing either.
 *
 * PNG is written by hand rather than with a dependency. An icon is a few
 * thousand identical pixels, deflate is in Node's standard library, and the
 * alternative is pulling an image toolchain into the tree to draw four
 * rectangles.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const INK = [0x32, 0x30, 0x2f]; // --color-ink
const WHITE = [0xff, 0xff, 0xff];

/* ------------------------------------------------------------------ png -- */

/** CRC-32, as PNG specifies it. Table built once. */
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
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** `pixels` is RGBA, row-major, `size × size`. */
function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10–12: compression, filter and interlace methods, all zero.

  // One filter byte per scanline, filter type 0 (none). Rows of flat colour
  // deflate to almost nothing either way.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const from = y * size * 4;
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, from, from + size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ----------------------------------------------------------------- mark -- */

/**
 * Draws the icon.
 *
 * `inset` is the fraction of the canvas left empty around the tile. Android
 * masks a maskable icon down to a circle inscribed in the middle 80%, so a
 * maskable variant needs the mark pulled well inside that or the F loses its
 * corners.
 */
function draw(size, { inset = 0, radius = 0.22, background = null } = {}) {
  const px = Buffer.alloc(size * size * 4);

  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };

  // A full-bleed background for the maskable icon: the mask may cut anywhere
  // inside the canvas, and a transparent corner would show the launcher through.
  if (background) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, background);
  }

  const pad = Math.round(size * inset);
  const tile = size - pad * 2;
  const r = tile * radius;

  /*
   * The rounded square, supersampled 3×3 per pixel. A hard test would leave
   * visibly stepped corners at 192px; averaging nine samples gives an edge that
   * reads as smooth at every size this is used at.
   */
  const inside = (x, y) => {
    const dx = Math.max(r - (x - pad), 0, x - pad - (tile - r));
    const dy = Math.max(r - (y - pad), 0, y - pad - (tile - r));
    if (x < pad || y < pad || x >= pad + tile || y >= pad + tile) return 0;
    return dx * dx + dy * dy <= r * r ? 1 : 0;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          hits += inside(x + (sx + 0.5) / 3 - 0.5, y + (sy + 0.5) / 3 - 0.5);
        }
      }
      if (hits === 0) continue;
      const alpha = Math.round((hits / 9) * 255);
      if (background) {
        // Composite over the background rather than replacing it, so the
        // anti-aliased edge blends instead of cutting a translucent notch.
        const t = alpha / 255;
        set(x, y, [
          Math.round(INK[0] * t + background[0] * (1 - t)),
          Math.round(INK[1] * t + background[1] * (1 - t)),
          Math.round(INK[2] * t + background[2] * (1 - t)),
        ]);
      } else {
        set(x, y, INK, alpha);
      }
    }
  }

  /*
   * The F: three rectangles. Proportions taken from the header wordmark —
   * stem on the left, a full-width top bar, a shorter middle bar at the
   * optical centre, which sits slightly above the true one.
   */
  const u = tile / 100;
  const left = pad + 30 * u;
  const top = pad + 24 * u;
  const stemW = 13 * u;
  const barH = 13 * u;
  const rect = (x0, y0, w, h) => {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++) {
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++) set(x, y, WHITE);
    }
  };
  rect(left, top, stemW, 52 * u); // stem
  rect(left, top, 40 * u, barH); // top bar
  rect(left, top + 20 * u, 31 * u, barH); // middle bar

  return png(size, px);
}

/* ---------------------------------------------------------------- write -- */

mkdirSync(OUT, { recursive: true });

const files = [
  ["icon-192.png", draw(192)],
  ["icon-512.png", draw(512)],
  // 20% inset and an opaque field: the Android mask crops to a circle and
  // anything in the outer fifth may be cut.
  ["icon-maskable-512.png", draw(512, { inset: 0.2, background: [0xfa, 0xf8, 0xf5] })],
  // iOS does not round or mask, and shows transparency as black.
  ["apple-touch-icon.png", draw(180, { inset: 0.06, background: [0xfa, 0xf8, 0xf5] })],
  // No favicon here on purpose: `src/app/icon.svg` is the tab icon, and Next
  // serves it by file convention.
];

for (const [name, bytes] of files) {
  writeFileSync(join(OUT, name), bytes);
  console.log(`${name}  ${bytes.length} bytes`);
}
