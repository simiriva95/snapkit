/** Offline license model (M6 stub — see main/license.ts for the validator). */

export const TRIAL_DAYS = 14

export type LicenseStatus =
  { kind: 'trial'; daysLeft: number } | { kind: 'expired' } | { kind: 'licensed'; key: string }

export interface LicenseActivateResult {
  ok: boolean
  error?: string
  status: LicenseStatus
}

/** SNAP-XXXX-XXXX-XXXX-XXXX (A-Z, 0-9). */
export const LICENSE_KEY_FORMAT = /^SNAP(-[A-Z0-9]{4}){4}$/
