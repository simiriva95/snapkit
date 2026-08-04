import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, open, readFile, readdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { swapBundle } from './updater'

// swapBundle shells out to ditto, which only exists on macOS.
const darwin = process.platform === 'darwin'

/** Minimal stand-in for a .app: a nested dir with a file in it. */
async function makeBundle(path: string, marker: string): Promise<void> {
  await mkdir(join(path, 'Contents', 'MacOS'), { recursive: true })
  await writeFile(join(path, 'Contents', 'MacOS', 'app'), marker)
}

describe.skipIf(!darwin)('swapBundle', () => {
  it('replaces a bundle whose files are still open', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'swap-test-'))
    const current = join(dir, 'Snapkit.app')
    const next = join(dir, 'new', 'Snapkit.app')
    await makeBundle(current, 'old')
    await makeBundle(next, 'new')

    // A running app holds its own executable open — this is what made the old
    // rm -rf implementation fail half-way and leave nothing installed.
    const held = await open(join(current, 'Contents', 'MacOS', 'app'), 'r')
    try {
      await swapBundle(next, current)
    } finally {
      await held.close()
    }

    expect(await readFile(join(current, 'Contents', 'MacOS', 'app'), 'utf8')).toBe('new')
    // The old bundle is parked, not deleted; startup sweeps it later.
    const parked = (await readdir(dir)).filter((n) => n.startsWith('Snapkit.app.old-'))
    expect(parked).toHaveLength(1)
  })

  it('restores the old bundle when the copy fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'swap-test-'))
    const current = join(dir, 'Snapkit.app')
    await makeBundle(current, 'old')

    await expect(swapBundle(join(dir, 'does-not-exist.app'), current)).rejects.toThrow()

    expect(await readFile(join(current, 'Contents', 'MacOS', 'app'), 'utf8')).toBe('old')
    expect((await readdir(dir)).filter((n) => n.includes('.old-'))).toHaveLength(0)
  })
})
