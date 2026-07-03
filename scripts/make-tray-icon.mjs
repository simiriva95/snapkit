// Generates resources/tray-iconTemplate.png — a 32x32 black "aperture" glyph
// with an alpha mask. macOS treats a *Template.png as a monochrome mask that
// adapts to light/dark menu bars. No image deps: hand-rolled PNG encoder.
// ponytail: placeholder art; swap in per-OS designed icons at M5 if desired.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const W = 32
const H = 32
const px = Buffer.alloc(W * H * 4, 0)
const cx = 15.5
const cy = 15.5

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - cx, y - cy)
    let a = 0
    if (d <= 3) a = 255 // center dot
    else if (d >= 6 && d <= 11) a = 255 // outer ring
    else if ((d > 3 && d < 4) || (d > 5 && d < 6) || (d > 11 && d < 12)) a = 140 // 1px feather
    if (a) {
      const i = (y * W + x) * 4
      px[i + 3] = a // RGB stays 0 (black); only alpha carries the shape
    }
  }
}

// Raw image: each scanline prefixed with filter byte 0.
const raw = Buffer.alloc(H * (W * 4 + 1))
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4)
}
const idat = deflateSync(raw)

const crcTable = (() => {
  const t = new Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type: RGBA
const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0))
])

const out = fileURLToPath(new URL('../resources/tray-iconTemplate.png', import.meta.url))
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log('wrote', out, png.length, 'bytes')
