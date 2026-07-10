import { extractSubject } from './subject'

/**
 * Paint-style free-form selection. The lasso path (image px) clips the
 * capture; outside the path is transparent. 'copy' puts the raw clipped
 * region on the clipboard, 'subject' runs local segmentation on the clipped
 * region first (smart cut) so only the subject survives.
 */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('failed to load capture'))
    img.src = src
  })
}

/** Clip the capture to the closed lasso path, cropped to its bounding box. */
export async function clipLasso(imageDataUrl: string, points: number[]): Promise<string> {
  if (points.length < 6) throw new Error('selection too small')
  const img = await loadImage(imageDataUrl)

  const xs = points.filter((_, i) => i % 2 === 0)
  const ys = points.filter((_, i) => i % 2 === 1)
  const x0 = Math.max(0, Math.floor(Math.min(...xs)))
  const y0 = Math.max(0, Math.floor(Math.min(...ys)))
  const x1 = Math.min(img.naturalWidth, Math.ceil(Math.max(...xs)))
  const y1 = Math.min(img.naturalHeight, Math.ceil(Math.max(...ys)))
  const w = x1 - x0
  const h = y1 - y0
  if (w < 4 || h < 4) throw new Error('selection too small')

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')

  ctx.beginPath()
  ctx.moveTo(points[0] - x0, points[1] - y0)
  for (let i = 2; i < points.length; i += 2) {
    ctx.lineTo(points[i] - x0, points[i + 1] - y0)
  }
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(img, -x0, -y0)

  return canvas.toDataURL('image/png')
}

/** Lasso action → transparent PNG on the clipboard. */
export async function copyLasso(
  imageDataUrl: string,
  points: number[],
  subject: boolean
): Promise<void> {
  let clipped = await clipLasso(imageDataUrl, points)
  if (subject) clipped = await extractSubject(clipped)
  await window.api.exportCopy(clipped)
}
