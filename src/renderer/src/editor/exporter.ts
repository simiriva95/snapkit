/**
 * Post-processing for exports. The flattened annotated image comes from the
 * Konva stage; here we optionally compose it on a padded gradient backdrop
 * with rounded corners and a soft shadow (CleanShot-style "styled copy").
 */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('failed to load image for export'))
    img.src = src
  })
}

export interface StyledOptions {
  padding?: number
  radius?: number
  gradient?: [string, string]
}

/**
 * Branded backdrop presets for "styled copy" (pref: styledTemplate).
 * Unknown stored ids fall back to the first entry, so renames self-migrate.
 */
export const STYLED_TEMPLATES = [
  { id: 'ember', label: 'Ember', gradient: ['#f59e0b', '#c2410c'] },
  { id: 'graphite', label: 'Graphite', gradient: ['#3f3c38', '#191713'] },
  { id: 'steel', label: 'Steel', gradient: ['#64748b', '#1e293b'] },
  { id: 'paper', label: 'Paper', gradient: ['#faf6ef', '#e7dfd2'] }
] as const

export type StyledTemplateId = (typeof STYLED_TEMPLATES)[number]['id']

export function templateGradient(id: string): [string, string] {
  const t = STYLED_TEMPLATES.find((t) => t.id === id) ?? STYLED_TEMPLATES[0]
  return [t.gradient[0], t.gradient[1]]
}

export async function composeWithBackground(
  dataUrl: string,
  { padding = 64, radius = 12, gradient = ['#6366f1', '#a855f7'] }: StyledOptions = {}
): Promise<string> {
  const img = await loadImage(dataUrl)
  const w = img.naturalWidth + padding * 2
  const h = img.naturalHeight + padding * 2

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')

  // Diagonal gradient backdrop.
  const grad = ctx.createLinearGradient(0, 0, w, h)
  grad.addColorStop(0, gradient[0])
  grad.addColorStop(1, gradient[1])
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  // Soft shadow under the rounded screenshot.
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
  ctx.shadowBlur = padding / 2
  ctx.shadowOffsetY = padding / 6
  ctx.beginPath()
  ctx.roundRect(padding, padding, img.naturalWidth, img.naturalHeight, radius)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.restore()

  // Clip to the rounded rect and draw the screenshot itself.
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(padding, padding, img.naturalWidth, img.naturalHeight, radius)
  ctx.clip()
  ctx.drawImage(img, padding, padding)
  ctx.restore()

  return canvas.toDataURL('image/png')
}
