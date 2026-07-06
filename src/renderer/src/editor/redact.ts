import { dedupeRegions, proposeLineRedactions, proposeRedactions } from '@shared/redaction'
import { useEditorStore } from '@renderer/stores/editor'
import { usePrefsStore } from '@renderer/stores/prefs'
import { recognizePage } from './ocr'

/** Full auto-redaction pass: local OCR → pattern match → proposals to review. */
export async function runAutoRedaction(dataUrl: string): Promise<void> {
  const s = useEditorStore.getState()
  if (s.redactionStatus === 'running') return
  s.startRedaction()
  try {
    const langs = usePrefsStore.getState().prefs?.ocrLanguages ?? ['eng']
    const page = await recognizePage(dataUrl, langs, (p) =>
      useEditorStore.getState().setRedactionProgress(p)
    )
    const id = (): string => crypto.randomUUID()
    // Line-level first: on ties the wider multi-word region wins the dedupe.
    const proposals = dedupeRegions([
      ...proposeLineRedactions(page.lines, id),
      ...proposeRedactions(page.words, id)
    ])
    useEditorStore.getState().setProposals(proposals)
  } catch (err) {
    console.error('[redaction] OCR failed:', err)
    useEditorStore
      .getState()
      .setRedactionError('Local text scan failed — please try again (details in console).')
  }
}
