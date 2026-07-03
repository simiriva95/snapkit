import { proposeRedactions } from '@shared/redaction'
import { useEditorStore } from '@renderer/stores/editor'
import { recognizeWords } from './ocr'

/** Full auto-redaction pass: local OCR → pattern match → proposals to review. */
export async function runAutoRedaction(dataUrl: string): Promise<void> {
  const s = useEditorStore.getState()
  if (s.redactionStatus === 'running') return
  s.startRedaction()
  try {
    const words = await recognizeWords(dataUrl, (p) =>
      useEditorStore.getState().setRedactionProgress(p)
    )
    const proposals = proposeRedactions(words, () => crypto.randomUUID())
    useEditorStore.getState().setProposals(proposals)
  } catch (err) {
    console.error('[redaction] OCR failed:', err)
    useEditorStore
      .getState()
      .setRedactionError('Local text scan failed — please try again (details in console).')
  }
}
