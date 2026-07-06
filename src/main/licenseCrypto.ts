import { createPublicKey, verify as cryptoVerify } from 'crypto'

/**
 * Offline license keys: `SNAPK1.<payload>.<signature>` where payload is
 * base64url JSON {email, orderId, iat} and signature is Ed25519 over the
 * payload string, verified against the public key embedded in the app.
 * Pure functions — unit-tested, no electron imports.
 */

export interface LicensePayload {
  email: string
  orderId: string
  /** Unix seconds at issue time. */
  iat: number
}

export type VerifyResult =
  { valid: true; payload: LicensePayload } | { valid: false; reason: string }

export function verifyLicenseKey(key: string, publicKeyPem: string): VerifyResult {
  const parts = key.trim().split('.')
  if (parts.length !== 3 || parts[0] !== 'SNAPK1') {
    return { valid: false, reason: 'Invalid key format — expected SNAPK1.<payload>.<signature>' }
  }
  const [, payloadB64, sigB64] = parts

  let payload: LicensePayload
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as LicensePayload).email !== 'string' ||
      typeof (parsed as LicensePayload).orderId !== 'string'
    ) {
      return { valid: false, reason: 'Malformed license payload' }
    }
    payload = parsed as LicensePayload
  } catch {
    return { valid: false, reason: 'Malformed license payload' }
  }

  try {
    const ok = cryptoVerify(
      null, // Ed25519: algorithm derived from the key
      Buffer.from(payloadB64, 'utf8'),
      createPublicKey(publicKeyPem),
      Buffer.from(sigB64, 'base64url')
    )
    return ok ? { valid: true, payload } : { valid: false, reason: 'Invalid signature' }
  } catch {
    return { valid: false, reason: 'Invalid signature' }
  }
}
