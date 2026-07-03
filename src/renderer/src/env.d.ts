/// <reference types="vite/client" />
import type { SnapkitApi } from '@shared/ipc'

declare global {
  interface Window {
    api: SnapkitApi
  }
}
