import { describe, it, expect } from 'vitest'
import {
  dedupeRegions,
  detectSensitive,
  proposeLineRedactions,
  proposeRedactions,
  type OcrLine,
  type OcrWord,
  type RedactionRegion
} from './redaction'

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

  // Fixture tokens are runtime-concatenated so GitHub's push-protection
  // scanner (static) doesn't flag them as real credentials — OUR regexes
  // still see the full string.
  it('detects GitHub tokens', () => {
    expect(id('ghp_' + '16C7e42F292c6912E7710c838347Ae178B4a')).toBe('github-token')
    expect(id('github_pat_' + '11ABCDEFG_abcdefghijklmnop123456')).toBe('github-token')
    expect(id('ghx_' + '16C7e42F292c6912E7710c838347Ae178B4a')).toBeUndefined()
  })

  it('detects Slack tokens', () => {
    expect(id('xoxb-' + '1234567890-abcdefghijklmn')).toBe('slack-token')
  })

  it('detects Stripe keys', () => {
    expect(id('sk_live_' + '4eC39HqLyjWDarjtT1zdp7dc')).toBe('stripe-key')
    expect(id('pk_test_' + 'TYooMQauvdEDq54NiTphI7jx')).toBe('stripe-key')
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

describe('proposeLineRedactions (multi-word secrets)', () => {
  const line = (...texts: string[]): OcrLine => ({
    // words laid out left to right, 100px each, 10px gaps
    words: texts.map((text, i) => ({
      text,
      bbox: { x0: i * 110, y0: 50, x1: i * 110 + 100, y1: 70 }
    }))
  })

  it('detects Bearer tokens split across words and unions the right bboxes', () => {
    const regions = proposeLineRedactions(
      [line('Authorization:', 'Bearer', 'abc123def456ghi789jkl')],
      () => 'r'
    )
    expect(regions).toHaveLength(1)
    expect(regions[0].label).toBe('Bearer token')
    // covers words 2 and 3 (110..320), padded by 4
    expect(regions[0].x).toBe(110 - 4)
    expect(regions[0].width).toBe(210 + 8)
  })

  it('detects password assignments', () => {
    const regions = proposeLineRedactions([line('password:', 'hunter22')], () => 'r')
    expect(regions).toHaveLength(1)
    expect(regions[0].label).toBe('Password')
  })

  it('detects PEM private key headers', () => {
    const regions = proposeLineRedactions(
      [line('-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----')],
      () => 'r'
    )
    expect(regions).toHaveLength(1)
    expect(regions[0].label).toBe('Private key')
  })

  it('ignores ordinary lines', () => {
    expect(proposeLineRedactions([line('just', 'some', 'boring', 'text')])).toEqual([])
  })
})

describe('dedupeRegions', () => {
  const region = (x: number, width: number, id: string): RedactionRegion => ({
    id,
    x,
    y: 0,
    width,
    height: 20,
    label: 'x',
    active: true
  })

  it('drops a smaller region mostly covered by a bigger one', () => {
    const kept = dedupeRegions([region(100, 50, 'small'), region(90, 200, 'big')])
    expect(kept.map((r) => r.id)).toEqual(['big'])
  })

  it('keeps non-overlapping regions', () => {
    const kept = dedupeRegions([region(0, 50, 'a'), region(100, 50, 'b')])
    expect(kept).toHaveLength(2)
  })
})
