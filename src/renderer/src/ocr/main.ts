import { recognizeText } from '../editor/ocr'

/**
 * Hidden window that OCRs clipboard-history screenshots so they become
 * searchable. Runs off the main window; jobs arrive one at a time from main.
 */
window.ocrApi.onRun(async (job) => {
  let text = ''
  try {
    text = await recognizeText(job.dataUrl, job.langs)
  } catch {
    // OCR failure just means this image stays unsearchable — not fatal.
  }
  window.ocrApi.sendResult(job.id, text)
})
