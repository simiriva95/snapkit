/**
 * Sensitive-data detection: pure functions, no I/O. OCR words go in,
 * proposed redaction regions come out. Unit-tested pattern by pattern.
 */

export interface RedactionPattern {
  id: string
  label: string
  regex: RegExp
}

/**
 * Ordered: first match wins per word. Prefix-based key patterns beat broad
 * heuristics — precision over recall, the user confirms anyway.
 */
export const REDACTION_PATTERNS: RedactionPattern[] = [
  {
    id: 'jwt',
    label: 'JWT',
    // three base64url segments; header always starts with eyJ ({"...)
    regex: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/
  },
  {
    id: 'aws-key',
    label: 'AWS access key',
    regex: /\bAKIA[0-9A-Z]{16}\b/
  },
  {
    id: 'google-key',
    label: 'Google API key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/
  },
  {
    id: 'github-token',
    label: 'GitHub token',
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/
  },
  {
    id: 'slack-token',
    label: 'Slack token',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/
  },
  {
    id: 'stripe-key',
    label: 'Stripe key',
    regex: /\b[sp]k_(?:live|test)_[A-Za-z0-9]{16,}\b/
  },
  {
    id: 'generic-secret',
    label: 'API key',
    // sk-... style tokens (OpenAI, Anthropic, many SaaS)
    regex: /\bsk-[A-Za-z0-9_-]{16,}\b/
  },
  {
    id: 'email',
    label: 'Email address',
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
  },
  {
    id: 'ipv4',
    label: 'IP address',
    // each octet 0-255; version strings like 1.2.3 don't match (needs 4 octets)
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/
  }
]

/** Returns the first matching pattern for a piece of text, or null. */
export function detectSensitive(text: string): RedactionPattern | null {
  for (const p of REDACTION_PATTERNS) {
    if (p.regex.test(text)) return p
  }
  return null
}

/** Minimal OCR word shape the engine needs (mirrors tesseract.js Word). */
export interface OcrWord {
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

export interface RedactionRegion {
  id: string
  x: number
  y: number
  width: number
  height: number
  label: string
  /** Toggled off by the user = don't blur. */
  active: boolean
}

const PAD = 4 // px of breathing room around the OCR bbox

/**
 * Word-level detection: the sensitive strings we target (emails, tokens,
 * keys, IPs) contain no spaces, so they land in a single OCR word.
 * Multi-word secrets are out of scope and declared as a known limit.
 */
export function proposeRedactions(
  words: OcrWord[],
  makeId: () => string = () => Math.random().toString(36).slice(2)
): RedactionRegion[] {
  const regions: RedactionRegion[] = []
  for (const w of words) {
    const hit = detectSensitive(w.text)
    if (!hit) continue
    regions.push({
      id: makeId(),
      x: w.bbox.x0 - PAD,
      y: w.bbox.y0 - PAD,
      width: w.bbox.x1 - w.bbox.x0 + PAD * 2,
      height: w.bbox.y1 - w.bbox.y0 + PAD * 2,
      label: hit.label,
      active: true
    })
  }
  return regions
}
