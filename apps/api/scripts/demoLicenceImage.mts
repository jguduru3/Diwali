// Draws a simple "licence document" PNG for demo data (no image libraries needed).
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

type RGB = [number, number, number];

export function demoLicencePng(seed = 1): Buffer {
  const W = 640;
  const H = 440;
  const px = Buffer.alloc(W * H * 3);
  const set = (x: number, y: number, [r, g, b]: RGB) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  };
  const rect = (x0: number, y0: number, w: number, h: number, c: RGB) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, c);
  };
  const ivory: RGB = [251, 247, 241];
  const plum: RGB = [42, 23, 69];
  const gold: RGB = [226, 178, 79];
  const line: RGB = [205, 196, 214];
  const ink: RGB = [120, 110, 140];

  rect(0, 0, W, H, ivory);
  rect(0, 0, W, 70, plum);
  rect(24, 26, 220, 14, gold); // title bar
  rect(0, H - 10, W, 10, gold);
  // body text lines, varied by seed
  for (let i = 0; i < 8; i++) {
    const w = 260 + ((i * 53 + seed * 37) % 220);
    rect(40, 110 + i * 34, w, 10, i % 3 === 0 ? ink : line);
  }
  // signature
  for (let x = 0; x < 140; x++) set(430 + x, 370 + Math.round(6 * Math.sin(x / 9)), plum);
  // seal
  const cx = 520;
  const cy = 180;
  for (let y = -60; y <= 60; y++)
    for (let x = -60; x <= 60; x++) {
      const d = Math.hypot(x, y);
      if (d <= 58) set(cx + x, cy + y, d > 50 ? gold : d > 44 ? ivory : [240, 214, 150]);
    }

  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
