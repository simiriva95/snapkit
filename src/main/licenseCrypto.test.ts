import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { verifyLicenseKey } from './licenseCrypto'

function makeKey(
  privateKeyPem: string,
  payload: object = { email: 'a@b.co', orderId: 'ORD-1', iat: 1700000000 }
): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = sign(null, Buffer.from(b64, 'utf8'), privateKeyPem).toString('base64url')
  return `SNAPK1.${b64}.${sig}`
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

describe('verifyLicenseKey', () => {
  it('accepts a correctly signed key', () => {
    const res = verifyLicenseKey(makeKey(privPem), pubPem)
    expect(res.valid).toBe(true)
    if (res.valid) {
      expect(res.payload.email).toBe('a@b.co')
      expect(res.payload.orderId).toBe('ORD-1')
    }
  })

  it('rejects a tampered payload', () => {
    const key = makeKey(privPem)
    const [prefix, , sig] = key.split('.')
    const forged = Buffer.from(
      JSON.stringify({ email: 'evil@x.io', orderId: 'ORD-1', iat: 1700000000 })
    ).toString('base64url')
    const res = verifyLicenseKey(`${prefix}.${forged}.${sig}`, pubPem)
    expect(res.valid).toBe(false)
  })

  it('rejects a key signed by a different keypair', () => {
    const other = generateKeyPairSync('ed25519')
    const otherPriv = other.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
    const res = verifyLicenseKey(makeKey(otherPriv), pubPem)
    expect(res.valid).toBe(false)
  })

  it('rejects malformed inputs without throwing', () => {
    for (const bad of ['', 'SNAPK1', 'SNAPK1.x', 'SNAPK1.!!!.???', 'NOPE.a.b', 'SNAPK1.a.b.c']) {
      expect(verifyLicenseKey(bad, pubPem).valid).toBe(false)
    }
  })

  it('rejects a payload that is not a license object', () => {
    const b64 = Buffer.from(JSON.stringify(['not', 'an', 'object'])).toString('base64url')
    const sig = sign(null, Buffer.from(b64, 'utf8'), privPem).toString('base64url')
    expect(verifyLicenseKey(`SNAPK1.${b64}.${sig}`, pubPem).valid).toBe(false)
  })

  it('committed dev keypair round-trips (keygen script compatibility)', () => {
    const devPub = readFileSync(
      join(__dirname, '../../scripts/dev-license-keys/public.pem'),
      'utf8'
    )
    const devPriv = readFileSync(
      join(__dirname, '../../scripts/dev-license-keys/private.pem'),
      'utf8'
    )
    expect(verifyLicenseKey(makeKey(devPriv), devPub).valid).toBe(true)
  })
})
