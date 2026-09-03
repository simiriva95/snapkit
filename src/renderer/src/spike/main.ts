// src/renderer/src/spike/main.ts — TEMPORARY
const out = document.getElementById('out') as HTMLPreElement
const log = (s: string): void => {
  out.textContent += `\n${s}`
  console.log('[spike]', s)
}
out.textContent = `Electron ${navigator.userAgent.match(/Electron\/[\d.]+/)?.[0]} · ${navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0]}`

async function main(): Promise<void> {
  // Check 1: which MediaRecorder mime types exist here?
  for (const t of [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9,opus'
  ]) {
    log(`[1] isTypeSupported(${t}) = ${MediaRecorder.isTypeSupported(t)}`)
  }

  // Checks 2 + 3: system audio track present? does the track honor max width/height?
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 60, width: { max: 1920 }, height: { max: 1080 } },
    audio: true
  })
  const v = stream.getVideoTracks()[0]
  const a = stream.getAudioTracks()[0]
  const s = v.getSettings()
  log(`[3] screen ${screen.width}x${screen.height} @dpr ${devicePixelRatio} → track ${s.width}x${s.height} @${s.frameRate}fps`)
  log(`[2] audio tracks: ${stream.getAudioTracks().length}${a ? ` (${a.label}, ${JSON.stringify(a.getSettings())})` : ''}`)

  // Check 1b: record 3 s as mp4 (if supported) and make sure the blob decodes.
  const mime =
    ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus'].find(
      (t) => MediaRecorder.isTypeSupported(t)
    ) ?? 'video/webm'
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()))
  rec.start(1000)
  await new Promise((r) => setTimeout(r, 3000))
  rec.stop()
  await stopped
  stream.getTracks().forEach((t) => t.stop())
  const blob = new Blob(chunks, { type: mime })
  log(`[1b] recorded ${mime} → ${(blob.size / 1e6).toFixed(2)} MB`)

  const video = document.createElement('video')
  video.src = URL.createObjectURL(blob)
  await new Promise<void>((r, j) => {
    video.onloadedmetadata = () => r()
    video.onerror = () => j(new Error('blob does not decode'))
  })
  log(`[1b] decodes: ${video.videoWidth}x${video.videoHeight}, duration ${video.duration.toFixed(2)}s`)
  log('DONE')
}

main().catch((e) => log(`ERROR ${e instanceof Error ? e.message : String(e)}`))
