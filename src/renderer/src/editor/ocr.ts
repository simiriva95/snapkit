import { createWorker, OEM, type Worker } from 'tesseract.js'
import type { OcrWord } from '@shared/redaction'

/**
 * Local OCR: worker, WASM core and language data are all served from the
 * app itself (src/renderer/public/ocr, see scripts/setup-ocr.mjs).
 * Nothing leaves the device — this is the product's core promise.
 */

let workerPromise: Promise<Worker> | null = null
let onProgress: ((p: number) => void) | null = null

function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/core',
    langPath: '/ocr/lang',
    gzip: true,
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress)
    }
  })
  return workerPromise
}

/** Run OCR on an image and return flattened words with pixel bboxes. */
export async function recognizeWords(
  dataUrl: string,
  progress?: (p: number) => void
): Promise<OcrWord[]> {
  onProgress = progress ?? null
  try {
    const worker = await getWorker()
    const { data } = await worker.recognize(dataUrl, {}, { blocks: true })
    const words: OcrWord[] = []
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          for (const w of line.words) {
            words.push({ text: w.text, bbox: w.bbox })
          }
        }
      }
    }
    return words
  } finally {
    onProgress = null
  }
}
