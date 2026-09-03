// Fetches the static ffmpeg binary for the HOST platform into
// resources/ffmpeg/<os>-<arch>/ so the app can spawn it for video
// post-processing (trim/concat/transcode/gif). Shipped via electron-builder
// extraResources — only the host's binary, never all four.
//
// Sources: Martin Riedl (macOS, <https://ffmpeg.martin-riedl.de/>) and BtbN
// (Windows/Linux, <https://github.com/BtbN/FFmpeg-Builds>), ffmpeg 9.0.1,
// GPLv3 builds (`--enable-gpl --enable-version3`) with NO `--enable-nonfree`
// component — so they are legally redistributable. Executed as a separate
// process, never linked. The SHA-256 of each ARCHIVE is pinned below.
//
// Idempotent: skips when the binary exists and the .sha256 marker next to it
// matches the pinned archive hash. Wired into predev/prebuild like
// setup-ocr.mjs / setup-bgr.mjs. Fatal on hash mismatch.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('.', import.meta.url)))

const BUILDS = {
  'mac-arm64': {
    url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1787073674_9.0.1/ffmpeg.zip',
    sha256: '8287a1b2229e05eb41859f073e18e6c52c60a778f2f5e6881070fe51b79407fe',
    entry: 'ffmpeg'
  },
  'mac-x64': {
    url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1787081194_9.0.1/ffmpeg.zip',
    sha256: '5bdead62ff504ab9b447cc72b212c4fb481e3f7de5877d427a51bee8136dda40',
    entry: 'ffmpeg'
  },
  'win-x64': {
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-02-13-13/ffmpeg-n9.0.1-11-ge47273f4d9-win64-gpl-9.0.zip',
    sha256: '232c44b96c3e553c5e57311fad22eb5f8feaee7246ebc68310c9ea53bcca4a52',
    entry: 'ffmpeg-n9.0.1-11-ge47273f4d9-win64-gpl-9.0/bin/ffmpeg.exe'
  },
  'linux-x64': {
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-02-13-13/ffmpeg-n9.0.1-11-ge47273f4d9-linux64-gpl-9.0.tar.xz',
    sha256: 'd48023b23ebce963c7ff2e68810dfd2cbf8dd6be9a2a7c17b3daef6d6c888507',
    entry: 'ffmpeg-n9.0.1-11-ge47273f4d9-linux64-gpl-9.0/bin/ffmpeg'
  }
}

// electron-builder's ${os} macro names, so extraResources can point at the folder.
const OS = { darwin: 'mac', win32: 'win', linux: 'linux' }
const key = `${OS[process.platform]}-${process.arch}`
const bin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
const dir = join(root, 'resources/ffmpeg', key)
const dest = join(dir, bin)
const marker = join(dir, '.sha256')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function main() {
  const build = BUILDS[key]
  if (!build) {
    console.warn(`[setup-ffmpeg] WARNING: no ffmpeg build for ${key} — video features disabled`)
    return
  }
  // The binary is extracted from the archive, so its own hash is not the pinned
  // one: the marker file records which archive it came from.
  if (
    existsSync(dest) &&
    existsSync(marker) &&
    readFileSync(marker, 'utf8').trim() === build.sha256
  ) {
    console.log('[setup-ffmpeg] binary already present')
    return
  }

  const archive = join(dir, basename(build.url))
  console.log(`[setup-ffmpeg] downloading ${basename(build.url)}…`)
  const res = await fetch(build.url)
  if (!res.ok) throw new Error(`${build.url}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const got = sha256(buf)
  if (got !== build.sha256) throw new Error(`${basename(build.url)}: SHA-256 mismatch (got ${got})`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(archive, buf)

  // `tar -xO` extracts one entry to stdout and auto-detects the format
  // everywhere we build: bsdtar (macOS, Windows 10+) reads zip, GNU tar
  // (Linux) reads xz.
  const fd = openSync(dest, 'w')
  try {
    const tar = spawnSync('tar', ['-xOf', archive, build.entry], {
      stdio: ['ignore', fd, 'inherit']
    })
    if (tar.error) throw tar.error
    if (tar.status !== 0)
      throw new Error(`tar -xOf ${basename(archive)} ${build.entry}: exit ${tar.status}`)
  } finally {
    closeSync(fd)
  }
  chmodSync(dest, 0o755)
  rmSync(archive, { force: true })
  writeFileSync(marker, `${build.sha256}\n`)

  // Sanity: an archive that extracted the wrong entry, or a truncated write,
  // would otherwise surface as a confusing runtime error in the video editor.
  const probe = spawnSync(dest, ['-version'], { encoding: 'utf8' })
  if (probe.status !== 0) {
    throw new Error(`${dest} -version failed: ${probe.error?.message ?? `exit ${probe.status}`}`)
  }
  console.log(`[setup-ffmpeg] ${probe.stdout.split('\n')[0]}`)
  console.log(
    `[setup-ffmpeg] ${(buf.length / 1e6).toFixed(0)}MB archive → resources/ffmpeg/${key}/${bin}`
  )
}

main().catch((err) => {
  // Fatal: a corrupt or missing binary would surface as a confusing runtime
  // error in the video editor. Better to fail the build here.
  console.error(`[setup-ffmpeg] ERROR: ${err.message}`)
  process.exit(1)
})
