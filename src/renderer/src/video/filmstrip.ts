/** Draw `count` evenly spaced frames of `src` as JPEG data URLs (hidden <video> + canvas). */
export async function buildFilmstrip(
  src: string,
  durationSec: number,
  count: number,
  thumbWidth: number,
  signal: AbortSignal
): Promise<string[]> {
  const video = document.createElement('video')
  video.src = src
  video.muted = true
  video.preload = 'auto'
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('filmstrip: cannot load video'))
  })
  const canvas = document.createElement('canvas')
  canvas.width = thumbWidth
  canvas.height = Math.max(1, Math.round((thumbWidth * video.videoHeight) / video.videoWidth))
  const ctx = canvas.getContext('2d')
  if (!ctx) return []

  const out: string[] = []
  try {
    for (let i = 0; i < count; i++) {
      if (signal.aborted) break
      const t = ((i + 0.5) / count) * durationSec
      const target = Math.min(t, Math.max(0, durationSec - 0.05))
      if (Math.abs(video.currentTime - target) > 1e-3) {
        await new Promise<void>((resolve) => {
          const done = (): void => {
            clearTimeout(timer)
            video.onseeked = null
            resolve()
          }
          // Safety net: a seek that never reports back must not freeze the strip.
          const timer = setTimeout(done, 2000)
          video.onseeked = done
          video.currentTime = target
        })
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      out.push(canvas.toDataURL('image/jpeg', 0.6))
    }
  } finally {
    video.removeAttribute('src')
    video.load()
  }
  return out
}
