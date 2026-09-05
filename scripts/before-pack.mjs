// Fails the build when the ffmpeg binary for the target platform/arch is missing —
// electron-builder only warns on a missing extraResources source and would ship
// an installer with no ffmpeg (e.g. `npm run package:winmac` on a mac host).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const { Arch } = createRequire(import.meta.url)('builder-util')

export default async function beforePack(context) {
  const os = context.packager.platform.buildConfigurationKey // mac | win | linux
  const arch = Arch[context.arch] // x64 | arm64
  const bin = os === 'win' ? 'ffmpeg.exe' : 'ffmpeg'
  const path = join(context.packager.projectDir, 'resources', 'ffmpeg', `${os}-${arch}`, bin)
  if (!existsSync(path)) {
    throw new Error(
      `[before-pack] missing ${path} — run scripts/setup-ffmpeg.mjs on a ${os}-${arch} host`
    )
  }
}
