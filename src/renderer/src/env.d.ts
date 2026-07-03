/// <reference types="vite/client" />
import type { OverlayApi, SnapkitApi } from '@shared/ipc'

declare global {
  interface Window {
    api: SnapkitApi
    overlayApi: OverlayApi
  }
}
