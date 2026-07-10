/// <reference types="vite/client" />
import type { ControlApi, OverlayApi, PickerApi, RecorderApi, SnapkitApi } from '@shared/ipc'

declare global {
  interface Window {
    api: SnapkitApi
    overlayApi: OverlayApi
    pickerApi: PickerApi
    controlApi: ControlApi
    recorderApi: RecorderApi
  }
}
