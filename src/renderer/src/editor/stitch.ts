/**
 * Scrolling-capture stitching. The user scrolls the content themselves while
 * we grab region frames; consecutive frames overlap vertically. We find the
 * overlap by comparing per-row luminance hashes and append only new rows.
 * Pure logic (rowHashes/bestOverlap) is unit-tested; canvas composition isn't.
 *
 * Known limits (declared): sticky headers/footers can ghost; if the user
 * scrolls more than one frame height the gap shows as a hard seam.
 */

interface PixelSource {
  data: Uint8ClampedArray | number[]
  width: number
  height: number
}

/** Per-row luminance signature, sampling every `colStep` pixels. */
export function rowHashes(img: PixelSource, colStep = 4): Float64Array {
  const out = new Float64Array(img.height)
  for (let y = 0; y < img.height; y++) {
    let sum = 0
    let n = 0
    for (let x = 0; x < img.width; x += colStep) {
      const i = (y * img.width + x) * 4
      // integer luma approximation
      sum +=
        (img.data[i] as number) * 3 + (img.data[i + 1] as number) * 4 + (img.data[i + 2] as number)
      n++
    }
    out[y] = sum / n
  }
  return out
}

export interface OverlapResult {
  /** Rows of `next` that repeat the tail of `prev`. */
  overlap: number
  /** Mean abs difference of the matched hashes, normalized. Lower = better. */
  score: number
}

/**
 * Best vertical overlap between the tail of `prev` and the head of `next`.
 * Tries every overlap length ≥ minOverlap and keeps the lowest mismatch.
 */
export function bestOverlap(
  prev: Float64Array,
  next: Float64Array,
  minOverlap = 12
): OverlapResult {
  const maxO = Math.min(prev.length, next.length)
  let best: OverlapResult = { overlap: 0, score: Number.POSITIVE_INFINITY }

  for (let o = minOverlap; o <= maxO; o++) {
    let diff = 0
    let mag = 1e-6
    for (let i = 0; i < o; i++) {
      const a = prev[prev.length - o + i]
      const b = next[i]
      diff += Math.abs(a - b)
      mag += Math.abs(a) + Math.abs(b)
    }
    const score = diff / mag
    // Prefer larger overlaps on (near-)ties: scrolling less is more common
    // than scrolling almost a full frame.
    if (score < best.score - 1e-9 || (score <= best.score + 1e-9 && o > best.overlap)) {
      best = { overlap: o, score }
    }
  }
  return best
}

/** Accept threshold: above this the frames are treated as non-contiguous. */
export const OVERLAP_ACCEPT = 0.02
const MAX_HEIGHT = 20000

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('failed to load frame'))
    img.src = src
  })
}

/** Compose the frames into one tall image. */
export async function stitchFrames(
  frames: string[]
): Promise<{ dataUrl: string; width: number; height: number }> {
  if (frames.length === 0) throw new Error('no frames to stitch')
  const images = await Promise.all(frames.map(loadImage))
  const width = images[0].naturalWidth

  const work = document.createElement('canvas')
  const wctx = work.getContext('2d', { willReadFrequently: true })
  if (!wctx) throw new Error('canvas 2d context unavailable')

  const hashOf = (img: HTMLImageElement): Float64Array => {
    work.width = width
    work.height = img.naturalHeight
    wctx.drawImage(img, 0, 0)
    return rowHashes(wctx.getImageData(0, 0, width, img.naturalHeight))
  }

  // Segments: for each frame, which rows are NEW content.
  const segments: { img: HTMLImageElement; from: number }[] = [{ img: images[0], from: 0 }]
  let prevHashes = hashOf(images[0])

  for (let i = 1; i < images.length; i++) {
    const hashes = hashOf(images[i])
    const { overlap, score } = bestOverlap(prevHashes, hashes)
    if (score <= OVERLAP_ACCEPT && overlap >= hashes.length) {
      // full overlap → no scroll happened, drop the frame
      prevHashes = hashes
      continue
    }
    // Poor match → treat as non-contiguous and append the whole frame (seam).
    const from = score <= OVERLAP_ACCEPT ? overlap : 0
    if (from < images[i].naturalHeight) segments.push({ img: images[i], from })
    prevHashes = hashes
  }

  const totalHeight = Math.min(
    segments.reduce((h, s) => h + (s.img.naturalHeight - s.from), 0),
    MAX_HEIGHT
  )

  const out = document.createElement('canvas')
  out.width = width
  out.height = totalHeight
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')

  let y = 0
  for (const seg of segments) {
    const h = seg.img.naturalHeight - seg.from
    if (y + h > totalHeight) break
    ctx.drawImage(seg.img, 0, seg.from, width, h, 0, y, width, h)
    y += h
  }

  return { dataUrl: out.toDataURL('image/png'), width, height: totalHeight }
}
