import { describe, it, expect } from 'vitest'
import { createHistory, commit, undo, redo, canUndo, canRedo } from './history'

describe('history', () => {
  it('starts empty', () => {
    const h = createHistory([])
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
  })

  it('commit → undo → redo round-trips', () => {
    let h = createHistory<string[]>([])
    h = commit(h, ['a'])
    h = commit(h, ['a', 'b'])
    expect(h.present).toEqual(['a', 'b'])

    h = undo(h)
    expect(h.present).toEqual(['a'])
    expect(canRedo(h)).toBe(true)

    h = redo(h)
    expect(h.present).toEqual(['a', 'b'])
    expect(canRedo(h)).toBe(false)
  })

  it('undo at the bottom is a no-op', () => {
    const h = createHistory(['x'])
    expect(undo(h)).toBe(h)
  })

  it('redo with no future is a no-op', () => {
    const h = commit(createHistory(['x']), ['y'])
    expect(redo(h)).toBe(h)
  })

  it('a new commit clears the redo branch', () => {
    let h = createHistory<string[]>([])
    h = commit(h, ['a'])
    h = undo(h)
    h = commit(h, ['b'])
    expect(canRedo(h)).toBe(false)
    expect(h.present).toEqual(['b'])
    // undo goes back to the initial state, not to the abandoned branch
    expect(undo(h).present).toEqual([])
  })

  it('caps the past stack', () => {
    let h = createHistory(0)
    for (let i = 1; i <= 150; i++) h = commit(h, i, 100)
    expect(h.past.length).toBe(100)
    expect(h.present).toBe(150)
    // oldest surviving state is 50
    let walked = h
    while (canUndo(walked)) walked = undo(walked)
    expect(walked.present).toBe(50)
  })

  it('multiple undos walk the full stack in order', () => {
    let h = createHistory<number[]>([])
    h = commit(h, [1])
    h = commit(h, [1, 2])
    h = commit(h, [1, 2, 3])
    h = undo(h)
    h = undo(h)
    expect(h.present).toEqual([1])
    h = undo(h)
    expect(h.present).toEqual([])
  })
})
