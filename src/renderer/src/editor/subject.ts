import { removeBackground } from '@imgly/background-removal'

/**
 * iPhone-style subject extraction: lift the subject from the capture and
 * return it as a transparent PNG (sticker). Runs fully locally — model and
 * WASM are served from the app itself (see scripts/setup-bgr.mjs).
 */
export async function extractSubject(
  dataUrl: string,
  onProgress?: (p: number) => void
): Promise<string> {
  const blob = await removeBackground(dataUrl, {
    publicPath: new URL('/bgr/', location.href).toString(),
    model: 'isnet_quint8', // small quantized model — the one we ship
    device: 'cpu',
    progress: (_key, current, total) => {
      if (total > 0) onProgress?.(current / total)
    }
  })

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('failed to read subject image'))
    reader.readAsDataURL(blob)
  })
}
