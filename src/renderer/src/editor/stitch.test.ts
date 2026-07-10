import { describe, it, expect } from 'vitest'
import { rowHashes, bestOverlap, OVERLAP_ACCEPT } from './stitch'

/** Synthetic "content" — a distinctive value per absolute row. */
const content = (row: number): number => Math.sin(row * 0.37) * 100 + row * 0.9

/** A frame of `height` rows starting at absolute scroll position `top`. */
const frame = (top: number, height: number): Float64Array =>
  Float64Array.from({ length: height }, (_, i) => content(top + i))

describe('bestOverlap', () => {
  it('finds the exact overlap after a scroll', () => {
    const prev = frame(0, 100)
    const next = frame(30, 100) // scrolled down 30 rows → 70 rows overlap
    const { overlap, score } = bestOverlap(prev, next)
    expect(overlap).toBe(70)
    expect(score).toBeLessThan(OVERLAP_ACCEPT)
  })

  it('detects full overlap when nothing scrolled', () => {
    const prev = frame(50, 80)
    const next = frame(50, 80)
    const { overlap, score } = bestOverlap(prev, next)
    expect(overlap).toBe(80)
    expect(score).toBeLessThan(OVERLAP_ACCEPT)
  })

  it('reports a bad score for unrelated frames', () => {
    const prev = frame(0, 100)
    const next = Float64Array.from({ length: 100 }, (_, i) => ((i * 7919) % 997) - 400)
    const { score } = bestOverlap(prev, next)
    expect(score).toBeGreaterThan(OVERLAP_ACCEPT)
  })

  it('survives small noise (compression artifacts)', () => {
    const prev = frame(0, 100)
    const next = frame(45, 100).map((v, i) => v + Math.sin(i * 13.7) * 0.4)
    const { overlap, score } = bestOverlap(prev, Float64Array.from(next))
    expect(overlap).toBe(55)
    expect(score).toBeLessThan(OVERLAP_ACCEPT)
  })
})

describe('rowHashes', () => {
  it('produces one hash per row, sensitive to row content', () => {
    const width = 8
    const height = 3
    const data = new Uint8ClampedArray(width * height * 4)
    // row 1 brighter than row 0, row 2 darker
    for (let x = 0; x < width; x++) {
      data.set([100, 100, 100, 255], (width + x) * 4) // row 1
    }
    const hashes = rowHashes({ data, width, height }, 1)
    expect(hashes.length).toBe(3)
    expect(hashes[1]).toBeGreaterThan(hashes[0])
    expect(hashes[0]).toBe(hashes[2])
  })
})
