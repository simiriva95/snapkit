// Generates the menu-bar tray icon: resources/tray-iconTemplate.png (16px)
// + tray-iconTemplate@2x.png (32px). Electron auto-picks the @2x variant on
// HiDPI. macOS treats *Template.png as a monochrome alpha mask that adapts
// to light/dark menu bars.
// Rendered with 8x supersampling for clean edges at menu-bar size.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Aperture glyph alpha at a point, in a unit square [0..1]x[0..1]. */
function glyphAlpha(u, v) {
  const d = Math.hypot(u - 0.5, v - 0.5) // 0..~0.707
  // ring band + center dot, in unit-space radii
  const RING_OUT = 0.42
  const RING_IN = 0.29
  const DOT = 0.15
  if (d <= DOT) return 1
  if (d >= RING_IN && d <= RING_OUT) return 1
  return 0
}

/** Render size x size RGBA (black + alpha mask) with 8x supersampling. */
function render(size) {
  const SS = 8
  const px = Buffer.alloc(size * size * 4, 0)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size
          const v = (y + (sy + 0.5) / SS) / size
          acc += glyphAlpha(u, v)
        }
      }
      const a = Math.round((acc / (SS * SS)) * 255)
      if (a > 0) px[(y * size + x) * 4 + 3] = a // RGB stays 0 (black mask)
    }
  }
  return px
}

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

function encodePng(px, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const outDir = fileURLToPath(new URL('../resources', import.meta.url))
mkdirSync(outDir, { recursive: true })
writeFileSync(`${outDir}/tray-iconTemplate.png`, encodePng(render(16), 16))
writeFileSync(`${outDir}/tray-iconTemplate@2x.png`, encodePng(render(32), 32))
console.log('wrote tray-iconTemplate.png (16) + @2x (32)')
