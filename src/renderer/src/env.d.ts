/// <reference types="vite/client" />
import type { OverlayApi, PickerApi, SnapkitApi } from '@shared/ipc'

declare global {
  interface Window {
    api: SnapkitApi
    overlayApi: OverlayApi
    pickerApi: PickerApi
  }
}
