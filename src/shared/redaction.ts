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

/** An OCR text line: the words that compose it, in reading order. */
export interface OcrLine {
  words: OcrWord[]
}

/**
 * Patterns for secrets that SPAN MULTIPLE words (OCR splits on spaces), matched
 * against the whole line text and mapped back to word bounding boxes.
 */
export const LINE_PATTERNS: RedactionPattern[] = [
  {
    id: 'bearer',
    label: 'Bearer token',
    regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{15,}/i
  },
  {
    id: 'private-key',
    label: 'Private key',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/
  },
  {
    id: 'password-assignment',
    label: 'Password',
    regex: /\b(?:password|passwd|pwd)\s*[:=]\s*\S{4,}/i
  },
  {
    id: 'secret-assignment',
    label: 'Secret',
    regex:
      /\b(?:secret(?:_access)?_key|client_secret|api[_-]?key|access[_-]?token)\s*[:=]\s*\S{8,}/i
  }
]

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
 * Word-level detection: single-token secrets (emails, keys, IPs) land in one
 * OCR word. Multi-word secrets are handled by proposeLineRedactions.
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

/**
 * Line-level detection for secrets spanning multiple OCR words: rebuild the
 * line text (single spaces, so char offsets align with the word array), run
 * LINE_PATTERNS, then map the matched char range back to the union bbox of
 * the covered words.
 */
export function proposeLineRedactions(
  lines: OcrLine[],
  makeId: () => string = () => Math.random().toString(36).slice(2)
): RedactionRegion[] {
  const regions: RedactionRegion[] = []
  for (const line of lines) {
    if (line.words.length === 0) continue
    let joined = ''
    const spans: { start: number; end: number }[] = []
    for (const w of line.words) {
      if (joined) joined += ' '
      spans.push({ start: joined.length, end: joined.length + w.text.length })
      joined += w.text
    }

    for (const p of LINE_PATTERNS) {
      const m = p.regex.exec(joined)
      if (!m) continue
      const mStart = m.index
      const mEnd = m.index + m[0].length
      const covered = line.words.filter((_, i) => spans[i].end > mStart && spans[i].start < mEnd)
      if (covered.length === 0) continue
      const x0 = Math.min(...covered.map((w) => w.bbox.x0))
      const y0 = Math.min(...covered.map((w) => w.bbox.y0))
      const x1 = Math.max(...covered.map((w) => w.bbox.x1))
      const y1 = Math.max(...covered.map((w) => w.bbox.y1))
      regions.push({
        id: makeId(),
        x: x0 - PAD,
        y: y0 - PAD,
        width: x1 - x0 + PAD * 2,
        height: y1 - y0 + PAD * 2,
        label: p.label,
        active: true
      })
    }
  }
  return regions
}

/**
 * Drop near-duplicate proposals (a word-level hit inside a line-level one):
 * larger regions win; a region overlapping a kept one by >60% of its own
 * area is discarded.
 */
export function dedupeRegions(regions: RedactionRegion[]): RedactionRegion[] {
  const area = (r: RedactionRegion): number => Math.max(0, r.width) * Math.max(0, r.height)
  const overlap = (a: RedactionRegion, b: RedactionRegion): number => {
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
    const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
    return w > 0 && h > 0 ? w * h : 0
  }
  const kept: RedactionRegion[] = []
  for (const r of [...regions].sort((a, b) => area(b) - area(a))) {
    if (!kept.some((k) => overlap(k, r) > 0.6 * area(r))) kept.push(r)
  }
  return kept
}
