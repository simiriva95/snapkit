import { ipcMain } from 'electron'
import Store from 'electron-store'
import { IpcChannels } from '@shared/ipc'
import { TRIAL_DAYS, type LicenseActivateResult, type LicenseStatus } from '@shared/license'
import { verifyLicenseKey } from './licenseCrypto'

/**
 * Offline Ed25519 license validation. Keys are signed by the store backend
 * at purchase time (see scripts/license-keygen.mjs and docs/selling.md);
 * the app only needs the public key — no server roundtrip, ever.
 *
 * The public key is injected at BUILD time via the SNAPKIT_LICENSE_PUBKEY
 * env var (see electron.vite.config.ts). Without it, builds fall back to the
 * committed DEV key — fine for development, forgeable in production. CI must
 * set the real key for release builds.
 */
const DEV_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA7JY74z1mYr6nVLG/aBHkmxTyMwRGLMdGIxKOAF3oSF0=
-----END PUBLIC KEY-----`

const PUBLIC_KEY_PEM =
  typeof __SNAPKIT_LICENSE_PUBKEY__ !== 'undefined' && __SNAPKIT_LICENSE_PUBKEY__ !== ''
    ? __SNAPKIT_LICENSE_PUBKEY__
    : DEV_PUBLIC_KEY_PEM

export interface LicenseValidator {
  status: () => LicenseStatus
  activate: (key: string) => LicenseActivateResult
}

interface LicenseData {
  firstRunAt: number
  licenseKey: string | null
}

const store = new Store<LicenseData>({
  name: 'license',
  defaults: { firstRunAt: Date.now(), licenseKey: null }
})

class Ed25519LicenseValidator implements LicenseValidator {
  status(): LicenseStatus {
    const key = store.get('licenseKey')
    // Re-verify on every read: the store file is user-editable.
    if (key && verifyLicenseKey(key, PUBLIC_KEY_PEM).valid) {
      return { kind: 'licensed', key }
    }

    const elapsedDays = (Date.now() - store.get('firstRunAt')) / 86_400_000
    const daysLeft = Math.ceil(TRIAL_DAYS - elapsedDays)
    return daysLeft > 0 ? { kind: 'trial', daysLeft } : { kind: 'expired' }
  }

  activate(key: string): LicenseActivateResult {
    const normalized = key.trim()
    const result = verifyLicenseKey(normalized, PUBLIC_KEY_PEM)
    if (!result.valid) {
      return { ok: false, error: result.reason, status: this.status() }
    }
    store.set('licenseKey', normalized)
    return { ok: true, status: this.status() }
  }
}

export const licenseValidator: LicenseValidator = new Ed25519LicenseValidator()

export function registerLicenseIpc(): void {
  ipcMain.handle(IpcChannels.licenseGet, () => licenseValidator.status())
  ipcMain.handle(IpcChannels.licenseActivate, (_event, key: string) =>
    licenseValidator.activate(key)
  )
}
