// Generates the menu-bar tray icon: resources/tray-iconTemplate.png (16px)
// + tray-iconTemplate@2x.png (32px). Electron auto-picks the @2x variant on
// HiDPI. macOS treats *Template.png as a monochrome alpha mask that adapts
// to light/dark menu bars.
// Rendered with 8x supersampling for clean edges at menu-bar size.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Viewfinder crop-marks + dot alpha at a point in a unit square (brand glyph). */
function glyphAlpha(u, v) {
  const H = 0.42 // half-size of the capture frame
  const R = 0.1 // corner radius
  const T = 0.15 // stroke thickness (bold — it must survive 16px)
  const ARM = 0.26 // corner arm length
  const DOT = 0.13 // capture dot radius

  const ax = Math.abs(u - 0.5)
  const ay = Math.abs(v - 0.5)

  if (Math.hypot(ax, ay) <= DOT) return 1

  const dx = ax - (H - R)
  const dy = ay - (H - R)
  const outline = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - R
  const onBand = Math.abs(outline) <= T / 2
  const inCorner = Math.min(ax, ay) >= H - ARM
  return onBand && inCorner ? 1 : 0
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

/** Recording variant: grey glyph + red dot, full-colour (macOS must NOT treat it as a template). */
function renderRec(size) {
  const px = render(size) // alpha mask in channel 3, RGB 0
  for (let i = 0; i < size * size; i++) {
    if (px[i * 4 + 3] > 0) {
      px[i * 4] = 0x8e
      px[i * 4 + 1] = 0x8e
      px[i * 4 + 2] = 0x93
    }
  }
  // Red dot, supersampled, alpha-blended over whatever is there.
  const SS = 8
  const cx = 0.8
  const cy = 0.8
  const R = 0.17
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size
          const v = (y + (sy + 0.5) / SS) / size
          if (Math.hypot(u - cx, v - cy) <= R) acc++
        }
      }
      const a = acc / (SS * SS)
      if (a === 0) continue
      const o = (y * size + x) * 4
      const prevA = px[o + 3] / 255
      const outA = a + prevA * (1 - a)
      const mix = (c, prev) => Math.round((c * a + prev * prevA * (1 - a)) / (outA || 1))
      px[o] = mix(0xff, px[o])
      px[o + 1] = mix(0x3b, px[o + 1])
      px[o + 2] = mix(0x30, px[o + 2])
      px[o + 3] = Math.round(outA * 255)
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
writeFileSync(`${outDir}/tray-icon-rec.png`, encodePng(renderRec(16), 16))
writeFileSync(`${outDir}/tray-icon-rec@2x.png`, encodePng(renderRec(32), 32))
console.log('wrote tray-iconTemplate.png (16) + @2x (32), tray-icon-rec.png (16) + @2x (32)')
