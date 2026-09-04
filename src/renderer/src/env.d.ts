/// <reference types="vite/client" />
import type {
  ControlApi,
  HistoryApi,
  OcrApi,
  OverlayApi,
  PickerApi,
  RecorderApi,
  SnapkitApi,
  VideoApi,
  ReplayApi
} from '@shared/ipc'

declare global {
  interface Window {
    api: SnapkitApi
    overlayApi: OverlayApi
    pickerApi: PickerApi
    controlApi: ControlApi
    recorderApi: RecorderApi
    historyApi: HistoryApi
    ocrApi: OcrApi
    videoApi: VideoApi
    replayApi: ReplayApi
  }
}
