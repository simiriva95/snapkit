import { describe, it, expect } from 'vitest'
import { detectSensitive, proposeRedactions, type OcrWord } from './redaction'

const id = (text: string): string | undefined => detectSensitive(text)?.id

describe('redaction patterns', () => {
  it('detects emails', () => {
    expect(id('mario.rossi@example.com')).toBe('email')
    expect(id('a+tag@sub.domain.io,')).toBe('email') // trailing punctuation from OCR
    expect(id('not-an-email@nowhere')).toBeUndefined() // no TLD
    expect(id('user @domain.com')).toBeUndefined() // OCR split — separate words
  })

  it('detects JWTs', () => {
    expect(
      id(
        'jwt-test-fixture'
      )
    ).toBe('jwt')
    expect(id('eyJonly.two')).toBeUndefined()
  })

  it('detects AWS access keys', () => {
    expect(id('AKIA-test-fixture')).toBe('aws-key')
    expect(id('AKIA123')).toBeUndefined() // too short
  })

  it('detects Google API keys', () => {
    // real keys are AIza + exactly 35 chars
    expect(id('AIza-test-fixture')).toBe('google-key')
    expect(id('AIzaTooShort')).toBeUndefined()
  })

  it('detects GitHub tokens', () => {
    expect(id('ghp_16C7e42F292c6912E7710c838347Ae178B4a')).toBe('github-token')
    expect(id('github_pat_11ABCDEFG_abcdefghijklmnop123456')).toBe('github-token')
    expect(id('ghx_16C7e42F292c6912E7710c838347Ae178B4a')).toBeUndefined()
  })

  it('detects Slack tokens', () => {
    expect(id('xoxb-fixture')).toBe('slack-token')
  })

  it('detects Stripe keys', () => {
    expect(id('sk_live_fixture')).toBe('stripe-key')
    expect(id('pk_test_fixture')).toBe('stripe-key')
  })

  it('detects sk- style API keys', () => {
    expect(id('sk-test-fixture')).toBe('generic-secret')
    expect(id('sk-short')).toBeUndefined()
  })

  it('detects IPv4, rejects version-like strings', () => {
    expect(id('192.168.1.100')).toBe('ipv4')
    expect(id('10.0.0.1:8080')).toBe('ipv4')
    expect(id('1.2.3')).toBeUndefined() // semver, only 3 octets
    expect(id('999.999.999.999')).toBeUndefined() // octets out of range
  })

  it('ignores ordinary text', () => {
    for (const t of ['hello', 'v1.2.3', 'user@', 'password:', 'const x = 42']) {
      expect(id(t)).toBeUndefined()
    }
  })
})

describe('proposeRedactions', () => {
  const word = (text: string, x0 = 10, y0 = 20, x1 = 110, y1 = 40): OcrWord => ({
    text,
    bbox: { x0, y0, x1, y1 }
  })

  it('maps matching words to padded regions', () => {
    const regions = proposeRedactions(
      [word('boring'), word('dev@corp.io'), word('AKIA-test-fixture')],
      () => 'fixed'
    )
    expect(regions).toHaveLength(2)
    expect(regions[0]).toMatchObject({
      x: 6, // 10 - 4 pad
      y: 16,
      width: 108, // 100 + 2*4 pad
      height: 28,
      label: 'Email address',
      active: true
    })
    expect(regions[1].label).toBe('AWS access key')
  })

  it('returns empty for clean screenshots', () => {
    expect(proposeRedactions([word('nothing'), word('sensitive')])).toEqual([])
  })
})
