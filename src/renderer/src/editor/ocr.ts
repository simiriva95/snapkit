import { createWorker, OEM, type Worker } from 'tesseract.js'
import type { OcrLine, OcrWord } from '@shared/redaction'

/**
 * Local OCR: worker, WASM core and language data are all served from the
 * app itself (src/renderer/public/ocr, see scripts/setup-ocr.mjs).
 * Nothing leaves the device — this is the product's core promise.
 */

let workerPromise: Promise<Worker> | null = null
let workerLangs = ''
let onProgress: ((p: number) => void) | null = null

function getWorker(langs: string[]): Promise<Worker> {
  const key = langs.join('+') || 'eng'
  if (workerPromise && workerLangs === key) return workerPromise

  // Language set changed: drop the old worker and spin up a fresh one.
  const stale = workerPromise
  if (stale) void stale.then((w) => w.terminate()).catch(() => undefined)

  workerLangs = key
  workerPromise = createWorker(langs.length > 0 ? langs : ['eng'], OEM.LSTM_ONLY, {
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

export interface OcrPage {
  words: OcrWord[]
  lines: OcrLine[]
}

/** Plain-text OCR — used to make clipboard-history screenshots searchable. */
export async function recognizeText(dataUrl: string, langs: string[]): Promise<string> {
  const worker = await getWorker(langs)
  const { data } = await worker.recognize(dataUrl)
  return (data.text ?? '').trim()
}

/** Run OCR on an image; returns flattened words + lines with pixel bboxes. */
export async function recognizePage(
  dataUrl: string,
  langs: string[],
  progress?: (p: number) => void
): Promise<OcrPage> {
  onProgress = progress ?? null
  try {
    const worker = await getWorker(langs)
    const { data } = await worker.recognize(dataUrl, {}, { blocks: true })
    const words: OcrWord[] = []
    const lines: OcrLine[] = []
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          const lineWords = line.words.map((w) => ({ text: w.text, bbox: w.bbox }))
          words.push(...lineWords)
          lines.push({ words: lineWords })
        }
      }
    }
    return { words, lines }
  } finally {
    onProgress = null
  }
}
