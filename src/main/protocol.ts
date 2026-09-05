import { net, protocol } from 'electron'
import { join, normalize, sep } from 'path'
import { pathToFileURL } from 'url'
import { serveVideo } from './videoServe'

/**
 * Packaged builds serve the renderer over a custom app:// scheme instead of
 * file:// — fetch(), Web Workers and absolute paths (/ocr/...) then behave
 * exactly like in dev over http. Required by the local Tesseract assets.
 */

export const APP_SCHEME = 'app'
export const APP_URL = `${APP_SCHEME}://bundle`

/** MUST run before app.whenReady(). */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/**
 * Call after ready — in dev AND packaged. Dev pages come from Vite, but the
 * /video route must exist everywhere; packaged builds also get the bundle.
 */
export function serveApp(): void {
  const root = normalize(join(__dirname, '../renderer'))
  const dev = Boolean(process.env['ELECTRON_RENDERER_URL'])
  protocol.handle(APP_SCHEME, (request) => {
    const { pathname } = new URL(request.url)
    if (pathname === '/video') return serveVideo(request)
    if (dev) return new Response('not found', { status: 404 })
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
    const target = normalize(join(root, rel))
    // No path traversal outside the renderer bundle.
    if (target !== root && !target.startsWith(root + sep)) {
      return new Response('forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(target).toString())
  })
}
