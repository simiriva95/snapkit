// Self-hosts the @imgly/background-removal assets (ONNX model + onnxruntime
// WASM) under src/renderer/public/bgr so subject extraction runs fully
// offline in the app — no CDN at runtime, consistent with the privacy stance.
//
// Downloads ONCE from the version-matched CDN bundle at setup time (files are
// too big to commit); idempotent afterwards. Wired into predev/prebuild.
// Only the small quantized model (isnet_quint8, ~40MB) is shipped.
import { mkdirSync, existsSync, writeFileSync, statSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('.', import.meta.url)))
// exports map blocks require('.../package.json') — read it straight off disk.
const libVersion = JSON.parse(
  readFileSync(join(root, 'node_modules/@imgly/background-removal/package.json'), 'utf8')
).version
const CDN = `https://staticimgly.com/@imgly/background-removal-data/${libVersion}/dist/`
const dest = join(root, 'src/renderer/public/bgr')
const manifestPath = join(dest, 'resources.json')

const KEEP = (key) => key === '/models/isnet_quint8' || key.startsWith('/onnxruntime-web/')

async function main() {
  mkdirSync(dest, { recursive: true })

  const res = await fetch(`${CDN}resources.json`)
  if (!res.ok) throw new Error(`CDN resources.json: HTTP ${res.status}`)
  const all = await res.json()

  const kept = Object.fromEntries(Object.entries(all).filter(([k]) => KEEP(k)))
  const chunks = Object.values(kept).flatMap((e) => e.chunks)

  let downloaded = 0
  for (const chunk of chunks) {
    const size = chunk.offsets[1] - chunk.offsets[0]
    const file = join(dest, chunk.name)
    if (existsSync(file) && statSync(file).size === size) continue
    const r = await fetch(new URL(chunk.name, CDN))
    if (!r.ok) throw new Error(`chunk ${chunk.name}: HTTP ${r.status}`)
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length !== size) throw new Error(`chunk ${chunk.name}: size mismatch`)
    writeFileSync(file, buf)
    downloaded += size
    console.log(`[setup-bgr] ${chunk.name} (${(size / 1e6).toFixed(1)}MB)`)
  }

  writeFileSync(manifestPath, JSON.stringify(kept))
  console.log(
    downloaded > 0
      ? `[setup-bgr] downloaded ${(downloaded / 1e6).toFixed(0)}MB → public/bgr`
      : '[setup-bgr] assets already present'
  )
}

main().catch((err) => {
  // Non-fatal: the app works without subject extraction; the feature will
  // error with a clear message if assets are missing.
  console.warn(`[setup-bgr] WARNING: ${err.message} — subject extraction assets not installed`)
})
