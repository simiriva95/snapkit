import { forwardRef } from 'react'
import { useVideoStore } from './store'

export const Player = forwardRef<HTMLVideoElement, { src: string }>(function Player({ src }, ref) {
  const setMedia = useVideoStore((s) => s.setMedia)
  const setPlayhead = useVideoStore((s) => s.setPlayhead)
  const setSourceError = useVideoStore((s) => s.setSourceError)
  return (
    <video
      ref={ref}
      src={src}
      controls
      playsInline
      className="max-h-full max-w-full rounded-md bg-black"
      onLoadedMetadata={(e) => {
        const v = e.currentTarget
        setSourceError(null)
        setMedia({ durationSec: v.duration, width: v.videoWidth, height: v.videoHeight })
      }}
      onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime)}
      onError={() => setSourceError('File moved, deleted or not decodable.')}
    />
  )
})
