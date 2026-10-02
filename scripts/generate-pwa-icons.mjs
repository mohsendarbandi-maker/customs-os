import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = process.cwd();
const output = path.join(root, 'public', 'pwa');
fs.mkdirSync(output, { recursive: true });

const PRIMARY = [15, 76, 129, 255];
const CYAN = [24, 182, 201, 255];
const WHITE = [255, 255, 255, 255];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, check]);
}

function createPng(size, maskable, monochrome) {
  const pixels = Buffer.alloc(size * size * 4);
  const fill = (r, g, b, a) => {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = (y * size + x) * 4;
        pixels[i] = r;
        pixels[i + 1] = g;
        pixels[i + 2] = b;
        pixels[i + 3] = a;
      }
    }
  };
  fill(PRIMARY[0], PRIMARY[1], PRIMARY[2], PRIMARY[3]);

  const scale = size / 1024;
  const stroke = Math.max(2, Math.round(30 * scale));
  const accent = monochrome ? WHITE : CYAN;
  const margin = (maskable ? 96 : 32) * scale;
  const radius = (maskable ? 150 : 220) * scale;

  const setPixel = (x, y, color) => {
    const px = clamp(Math.round(x), 0, size - 1);
    const py = clamp(Math.round(y), 0, size - 1);
    const i = (py * size + px) * 4;
    pixels[i] = color[0];
    pixels[i + 1] = color[1];
    pixels[i + 2] = color[2];
    pixels[i + 3] = color[3];
  };

  const drawLine = (x1, y1, x2, y2, color) => {
    const sx = x1 * scale;
    const sy = y1 * scale;
    const ex = x2 * scale;
    const ey = y2 * scale;
    const dx = ex - sx;
    const dy = ey - sy;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    const radiusPx = Math.max(0, Math.floor(stroke / 2));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const x = sx + dx * t;
      const y = sy + dy * t;
      for (let ox = -radiusPx; ox <= radiusPx; ox += 1) {
        for (let oy = -radiusPx; oy <= radiusPx; oy += 1) {
          if (ox * ox + oy * oy <= radiusPx * radiusPx + 1) setPixel(x + ox, y + oy, color);
        }
      }
    }
  };

  const clearOutsideRounded = () => {
    const left = margin;
    const top = margin;
    const right = size - margin;
    const bottom = size - margin;
    const r = radius;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = Math.max(left + r - x, 0, x - (right - r));
        const dy = Math.max(top + r - y, 0, y - (bottom - r));
        if (dx * dx + dy * dy > r * r && (x < left || x > right || y < top || y > bottom)) {
          const i = (y * size + x) * 4;
          pixels[i + 3] = 0;
        }
      }
    }
  };

  drawLine(190, 760, 190, 300, WHITE);
  drawLine(190, 300, 512, 155, WHITE);
  drawLine(512, 155, 834, 300, WHITE);
  drawLine(834, 300, 834, 760, WHITE);
  drawLine(190, 300, 834, 300, WHITE);

  [405, 510, 615, 720].forEach((y) => drawLine(300, y, 724, y, WHITE));
  drawLine(342, 300, 342, 242, WHITE);
  drawLine(342, 242, 512, 166, WHITE);
  drawLine(512, 166, 682, 242, WHITE);
  drawLine(682, 242, 682, 300, WHITE);
  drawLine(512, 166, 512, 105, WHITE);

  drawLine(145, 824, 879, 824, accent);
  drawLine(365, 760, 365, 655, accent);
  drawLine(512, 760, 512, 570, accent);
  drawLine(659, 760, 659, 655, accent);

  if (maskable) clearOutsideRounded();
  return pngFromRgba(size, size, pixels);
}

function pngFromRgba(width, height, rgba) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width * 4 + 1)] = 0;
    rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(rows, { level: 9 });
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

function write(name, size, maskable, monochrome) {
  fs.writeFileSync(path.join(output, name), createPng(size, maskable, monochrome));
}

write('icon-192.png', 192, false, false);
write('icon-512.png', 512, false, false);
write('icon-192-maskable.png', 192, true, false);
write('icon-512-maskable.png', 512, true, false);
write('monochrome-96.png', 96, false, true);
write('apple-touch-icon-180.png', 180, false, false);
write('badge-96.png', 96, false, true);

console.log('PWA icons generated in ' + output);
