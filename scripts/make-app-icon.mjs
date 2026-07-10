// Generates build/icon.png (1024x1024) — rounded-square gradient tile with
// the Snapkit aperture glyph. electron-builder derives icns/ico from it.
// Dependency-free: analytic distance fields + the same PNG encoder approach
// as make-tray-icon.mjs. Rerun with: npm run gen:appicon
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const S = 1024
const MARGIN = 64 // transparent border, macOS-style breathing room
const RADIUS = 200 // corner radius of the tile
const CX = S / 2
const CY = S / 2

// Precision-instrument brand: cool graphite tile, emerald glyph.
const G0 = [0x27, 0x2c, 0x29] // graphite top-left
const G1 = [0x12, 0x17, 0x14] // near-black bottom-right

const smooth = (d, feather = 1.5) => Math.min(1, Math.max(0, 0.5 - d / feather))

// Signed distance to the rounded-square tile (negative = inside).
function tileDist(x, y) {
  const half = S / 2 - MARGIN - RADIUS
  const dx = Math.abs(x - CX) - half
  const dy = Math.abs(y - CY) - half
  const ax = Math.max(dx, 0)
  const ay = Math.max(dy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - RADIUS
}

const px = Buffer.alloc(S * S * 4, 0)
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const tile = smooth(tileDist(x, y))
    if (tile <= 0) continue

    const t = (x + y) / (2 * S)
    let r = G0[0] + (G1[0] - G0[0]) * t
    let g = G0[1] + (G1[1] - G0[1]) * t
    let b = G0[2] + (G1[2] - G0[2]) * t

    // Aperture glyph: ring + center dot, emerald.
    const A = [0x17, 0xc8, 0x8a] // emerald
    const d = Math.hypot(x - CX, y - CY)
    const ring = Math.min(smooth(d - 300), smooth(216 - d)) // 216..300 band
    const dot = smooth(d - 120)
    const glyph = Math.max(Math.max(0, ring), Math.max(0, dot))
    if (glyph > 0) {
      r = r + (A[0] - r) * glyph
      g = g + (A[1] - g) * glyph
      b = b + (A[2] - b) * glyph
    }

    const i = (y * S + x) * 4
    px[i] = Math.round(r)
    px[i + 1] = Math.round(g)
    px[i + 2] = Math.round(b)
    px[i + 3] = Math.round(255 * tile)
  }
}

// PNG encode (same as make-tray-icon.mjs).
const raw = Buffer.alloc(S * (S * 4 + 1))
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4)
}
const idat = deflateSync(raw, { level: 9 })

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
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0))
])

const out = fileURLToPath(new URL('../build/icon.png', import.meta.url))
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log('wrote', out, `${(png.length / 1024).toFixed(0)}KB`)
