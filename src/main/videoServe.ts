import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { extname } from 'path'
import { Readable } from 'stream'
import { APP_URL } from './protocol'

/**
 * Streams a video file to the editor renderer over app://bundle/video?path=…
 * with HTTP Range support (needed for seeking). Only paths main explicitly
 * allow-listed via allowVideoPath() are served — the renderer never gets to
 * pick arbitrary files.
 */

export type Range = { start: number; end: number }

const allowed = new Set<string>()

export function allowVideoPath(path: string): void {
  allowed.add(path)
}
export function isVideoPathAllowed(path: string): boolean {
  return allowed.has(path)
}
export function videoUrl(path: string): string {
  return `${APP_URL}/video?path=${encodeURIComponent(path)}`
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska'
}

/** RFC 7233 single range. null = no Range header; 'invalid' = 416. */
export function parseRange(header: string | null, size: number): Range | null | 'invalid' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid'
  if (m[1] === '') {
    const suffix = Number(m[2])
    if (suffix === 0) return 'invalid'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(m[1])
  if (start >= size) return 'invalid'
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  if (end < start) return 'invalid'
  return { start, end }
}

export async function serveVideo(request: Request): Promise<Response> {
  const path = new URL(request.url).searchParams.get('path')
  if (!path || !allowed.has(path)) return new Response('forbidden', { status: 403 })
  const info = await stat(path).catch(() => null)
  if (!info || !info.isFile()) return new Response('not found', { status: 404 })

  const range = parseRange(request.headers.get('range'), info.size)
  if (range === 'invalid') {
    return new Response('range not satisfiable', {
      status: 416,
      headers: { 'Content-Range': `bytes */${info.size}` }
    })
  }
  const { start, end } = range ?? { start: 0, end: info.size - 1 }
  const headers: Record<string, string> = {
    'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1)
  }
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
  return new Response(body, { status: range ? 206 : 200, headers })
}
