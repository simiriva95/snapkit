import { describe, it, expect } from 'vitest'
import { stepNumber, normalizeRect, type Annotation } from './annotations'

const annos: Annotation[] = [
  { id: 'r1', type: 'rect', x: 0, y: 0, width: 10, height: 10, color: '#f00', strokeWidth: 4 },
  { id: 's1', type: 'step', x: 5, y: 5, size: 14, color: '#f00' },
  { id: 't1', type: 'text', x: 1, y: 1, text: 'hi', fontSize: 24, color: '#f00' },
  { id: 's2', type: 'step', x: 9, y: 9, size: 14, color: '#f00' },
  {
    id: 'a1',
    type: 'arrow',
    points: [0, 0, 5, 5],
    color: '#f00',
    strokeWidth: 4
  },
  { id: 'b1', type: 'blur', x: 2, y: 2, width: 4, height: 4, pixelSize: 12, color: '#f00' },
  { id: 'h1', type: 'highlight', points: [3, 3, 6, 2, 9, 4], strokeWidth: 16, color: '#ff0' }
]

describe('annotation model', () => {
  it('is JSON round-trip safe (serializable history requirement)', () => {
    const restored = JSON.parse(JSON.stringify(annos)) as Annotation[]
    expect(restored).toEqual(annos)
  })

  it('step numbers derive from creation order', () => {
    expect(stepNumber(annos, 's1')).toBe(1)
    expect(stepNumber(annos, 's2')).toBe(2)
  })

  it('step numbers renumber automatically after a delete', () => {
    const without = annos.filter((a) => a.id !== 's1')
    expect(stepNumber(without, 's2')).toBe(1)
  })

  it('normalizeRect handles drags in any direction', () => {
    expect(normalizeRect(10, 10, 2, 4)).toEqual({ x: 2, y: 4, width: 8, height: 6 })
    expect(normalizeRect(0, 0, 5, 5)).toEqual({ x: 0, y: 0, width: 5, height: 5 })
  })
})
