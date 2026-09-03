// Fetches the static ffmpeg binary for the HOST platform into
// resources/ffmpeg/<os>-<arch>/ so the app can spawn it for video
// post-processing (trim/concat/transcode/gif). Shipped via electron-builder
// extraResources — only the host's binary, never all four.
//
// Idempotent: skips when the file exists and its SHA-256 matches. Wired into
// predev/prebuild like setup-ocr.mjs / setup-bgr.mjs. Fatal on hash mismatch.
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('.', import.meta.url)))

// GPL static builds (ffmpeg 6.0). Executed as a separate process, never linked.
const RELEASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/'
const BUILDS = {
  'mac-arm64': {
    asset: 'ffmpeg-darwin-arm64',
    sha256: 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584'
  },
  'mac-x64': {
    asset: 'ffmpeg-darwin-x64',
    sha256: 'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894'
  },
  'linux-x64': {
    asset: 'ffmpeg-linux-x64',
    sha256: 'e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99'
  },
  'win-x64': {
    asset: 'ffmpeg-win32-x64',
    sha256: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00'
  }
}

// electron-builder's ${os} macro names, so extraResources can point at the folder.
const OS = { darwin: 'mac', win32: 'win', linux: 'linux' }
const key = `${OS[process.platform]}-${process.arch}`
const bin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
const dest = join(root, 'resources/ffmpeg', key, bin)

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function main() {
  const build = BUILDS[key]
  if (!build) {
    console.warn(`[setup-ffmpeg] WARNING: no ffmpeg build for ${key} — video features disabled`)
    return
  }
  if (existsSync(dest) && sha256(readFileSync(dest)) === build.sha256) {
    console.log('[setup-ffmpeg] binary already present')
    return
  }
  const url = RELEASE + build.asset
  console.log(`[setup-ffmpeg] downloading ${build.asset}…`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const got = sha256(buf)
  if (got !== build.sha256) throw new Error(`${build.asset}: SHA-256 mismatch (got ${got})`)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, buf)
  chmodSync(dest, 0o755)
  console.log(`[setup-ffmpeg] ${(buf.length / 1e6).toFixed(0)}MB → resources/ffmpeg/${key}/${bin}`)
}

main().catch((err) => {
  // Fatal: a corrupt or missing binary would surface as a confusing runtime
  // error in the video editor. Better to fail the build here.
  console.error(`[setup-ffmpeg] ERROR: ${err.message}`)
  process.exit(1)
})
