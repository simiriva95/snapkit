// Copies tesseract.js worker + core WASM from node_modules into the renderer
// public dir so OCR runs fully offline (no CDN — privacy positioning).
// Language data (eng.traineddata.gz) is committed in the repo.
// Idempotent; wired into predev/prebuild.
import { copyFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('.', import.meta.url)))
const dest = join(root, 'src/renderer/public/ocr')

// Clean rebuild of the core dir so pruning rules actually apply.
rmSync(join(dest, 'core'), { recursive: true, force: true })
mkdirSync(join(dest, 'core'), { recursive: true })

copyFileSync(
  join(root, 'node_modules/tesseract.js/dist/worker.min.js'),
  join(dest, 'worker.min.js')
)

// We run OEM.LSTM_ONLY, so only the *-lstm core variants are ever loaded
// (simd/relaxedsimd/plain picked at runtime by CPU feature detection).
// Skipping the legacy-engine variants cuts the packaged app by ~35MB.
const coreSrc = join(root, 'node_modules/tesseract.js-core')
for (const f of readdirSync(coreSrc)) {
  if (
    f.startsWith('tesseract-core') &&
    f.includes('lstm') &&
    (f.endsWith('.js') || f.endsWith('.wasm'))
  ) {
    copyFileSync(join(coreSrc, f), join(dest, 'core', f))
  }
}

const lang = join(dest, 'lang/eng.traineddata.gz')
if (!existsSync(lang)) {
  console.error(
    '[setup-ocr] MISSING language data: src/renderer/public/ocr/lang/eng.traineddata.gz\n' +
      'It should be committed in the repo. Re-download from:\n' +
      'https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz'
  )
  process.exit(1)
}
console.log('[setup-ocr] ocr assets ready')
