// Genera icon-192.png e icon-512.png sin dependencias (encoder PNG mínimo).
// Ícono: fondo rojo carnicería + un "ticket de pedido" blanco con tres renglones.
// Correlo con:  node scripts/gen-icons.mjs
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";

const BG = [192, 39, 31];      // rojo (#c0271f)
const FG = [255, 255, 255];    // blanco

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function icono(size) {
  const px = (x, y) => {
    // ticket: rectángulo blanco centrado con esquinas redondeadas simples
    const m = Math.round(size * 0.2);        // margen
    const w = size - m * 2;                   // ancho del ticket
    const r = Math.round(size * 0.06);        // radio de esquina
    const inX = x >= m && x < m + w;
    const inY = y >= m && y < m + w;
    if (!inX || !inY) return BG;
    // recorte de esquinas (círculos)
    const corners = [[m + r, m + r], [m + w - r, m + r], [m + r, m + w - r], [m + w - r, m + w - r]];
    for (const [cx, cy] of corners) {
      const nearX = (x < m + r && cx === m + r) || (x >= m + w - r && cx === m + w - r);
      const nearY = (y < m + r && cy === m + r) || (y >= m + w - r && cy === m + w - r);
      if (nearX && nearY && (x - cx) ** 2 + (y - cy) ** 2 > r * r) return BG;
    }
    // tres renglones rojos (las "líneas" del pedido)
    const pad = Math.round(size * 0.06);
    for (let i = 0; i < 3; i++) {
      const ly = m + Math.round(w * (0.28 + i * 0.22));
      const lh = Math.max(2, Math.round(size * 0.045));
      const lw = i === 2 ? Math.round(w * 0.45) : w - pad * 2; // el último más corto
      if (y >= ly && y < ly + lh && x >= m + pad && x < m + pad + lw) return BG;
    }
    return FG;
  };

  const raw = Buffer.alloc((size * 3 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filtro "none"
    for (let x = 0; x < size; x++) {
      const [r, g, b] = px(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, color type 2 (RGB)
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

for (const size of [192, 512]) {
  const out = new URL(`../icon-${size}.png`, import.meta.url);
  writeFileSync(out, icono(size));
  console.log("escrito icon-" + size + ".png");
}
