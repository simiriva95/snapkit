/** Offline license model — Ed25519-signed keys, validated in main/license.ts. */

export const TRIAL_DAYS = 14

export type LicenseStatus =
  { kind: 'trial'; daysLeft: number } | { kind: 'expired' } | { kind: 'licensed'; key: string }

export interface LicenseActivateResult {
  ok: boolean
  error?: string
  status: LicenseStatus
}
