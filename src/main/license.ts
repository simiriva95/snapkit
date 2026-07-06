import { ipcMain } from 'electron'
import Store from 'electron-store'
import { IpcChannels } from '@shared/ipc'
import {
  LICENSE_KEY_FORMAT,
  TRIAL_DAYS,
  type LicenseActivateResult,
  type LicenseStatus
} from '@shared/license'

/**
 * Pluggable license validation. The MVP ships StubLicenseValidator: a 14-day
 * trial keyed on first run + format-only key validation (any well-formed
 * SNAP-XXXX-... key activates).
 *
 * Swapping in real validation later (Gumroad / Lemon Squeezy) means one new
 * implementation of this interface: offline Ed25519 — embed the public key
 * here, the store backend signs {email, orderId} into the key at purchase,
 * activate() verifies the signature locally. No server roundtrip needed.
 */
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

class StubLicenseValidator implements LicenseValidator {
  status(): LicenseStatus {
    const key = store.get('licenseKey')
    if (key) return { kind: 'licensed', key }

    const elapsedDays = (Date.now() - store.get('firstRunAt')) / 86_400_000
    const daysLeft = Math.ceil(TRIAL_DAYS - elapsedDays)
    return daysLeft > 0 ? { kind: 'trial', daysLeft } : { kind: 'expired' }
  }

  activate(key: string): LicenseActivateResult {
    const normalized = key.trim().toUpperCase()
    if (!LICENSE_KEY_FORMAT.test(normalized)) {
      return {
        ok: false,
        error: 'Invalid key — expected format: SNAP-XXXX-XXXX-XXXX-XXXX',
        status: this.status()
      }
    }
    // Stub: format check only. Real impl verifies an offline signature here.
    store.set('licenseKey', normalized)
    return { ok: true, status: this.status() }
  }
}

export const licenseValidator: LicenseValidator = new StubLicenseValidator()

export function registerLicenseIpc(): void {
  ipcMain.handle(IpcChannels.licenseGet, () => licenseValidator.status())
  ipcMain.handle(IpcChannels.licenseActivate, (_event, key: string) =>
    licenseValidator.activate(key)
  )
}
