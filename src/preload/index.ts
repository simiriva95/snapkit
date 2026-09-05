import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import {
  IpcChannels,
  type CaptureMode,
  type CapturePayload,
  type ControlApi,
  type ControlMode,
  type HistoryApi,
  type OcrApi,
  type OcrJob,
  type OverlayApi,
  type PickerApi,
  type RecordJob,
  type RecorderApi,
  type Rect,
  type ReplayApi,
  type ReplayJob,
  type ScrollFramesPayload,
  type SnapkitApi,
  type VideoApi,
  type VideoOpenPayload,
  type WindowSource
} from '@shared/ipc'

/** Subscribe helper: ipcRenderer.on with unsubscribe. */
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: SnapkitApi = {
  getVersion: () => ipcRenderer.invoke(IpcChannels.appVersion),
  hideWindow: () => ipcRenderer.send(IpcChannels.windowHide),
  startCapture: (mode?: CaptureMode) => ipcRenderer.send(IpcChannels.captureStart, mode),
  onCapture: (cb) => {
    const listener = (_e: IpcRendererEvent, payload: CapturePayload): void => cb(payload)
    ipcRenderer.on(IpcChannels.captureCaptured, listener)
    return () => ipcRenderer.removeListener(IpcChannels.captureCaptured, listener)
  },
  exportSave: (dataUrl) => ipcRenderer.invoke(IpcChannels.exportSave, dataUrl),
  exportCopy: (dataUrl) => ipcRenderer.invoke(IpcChannels.exportCopy, dataUrl),
  getPrefs: () => ipcRenderer.invoke(IpcChannels.prefsGet),
  setPrefs: (patch) => ipcRenderer.invoke(IpcChannels.prefsSet, patch),
  pickExportDir: () => ipcRenderer.invoke(IpcChannels.prefsPickDir),
  getLicense: () => ipcRenderer.invoke(IpcChannels.licenseGet),
  activateLicense: (key) => ipcRenderer.invoke(IpcChannels.licenseActivate, key),
  onScrollFrames: (cb) => on<ScrollFramesPayload>(IpcChannels.scrollFrames, cb)
}

const controlApi: ControlApi = {
  onInit: (cb) => on<{ mode: ControlMode }>(IpcChannels.controlInit, cb),
  onStatus: (cb) => on<{ text: string }>(IpcChannels.controlStatus, cb),
  action: (action) => ipcRenderer.send(IpcChannels.controlAction, action)
}

const recorderApi: RecorderApi = {
  onStart: (cb) => on<RecordJob>(IpcChannels.recordStart, cb),
  onStop: (cb) => on<void>(IpcChannels.recordStop, () => cb()),
  sendResult: (data, ext, error) => ipcRenderer.send(IpcChannels.recordResult, data, ext, error)
}

const replayApi: ReplayApi = {
  onStart: (cb) => on<ReplayJob>(IpcChannels.replayStart, cb),
  onStop: (cb) => on<void>(IpcChannels.replayStop, () => cb()),
  onFlush: (cb) => on<number>(IpcChannels.replayFlush, cb),
  sendSegment: (data, durationMs, ext, flushId) =>
    ipcRenderer.send(IpcChannels.replaySegment, data, durationMs, ext, flushId),
  sendError: (message) => ipcRenderer.send(IpcChannels.replayError, message)
}

const historyApi: HistoryApi = {
  list: () => ipcRenderer.invoke(IpcChannels.historyList),
  copy: (id) => ipcRenderer.send(IpcChannels.historyCopy, id),
  pin: (id) => ipcRenderer.send(IpcChannels.historyPin, id),
  remove: (id) => ipcRenderer.send(IpcChannels.historyDelete, id),
  clear: () => ipcRenderer.send(IpcChannels.historyClear),
  onChanged: (cb) => on<void>(IpcChannels.historyChanged, () => cb()),
  cancel: () => ipcRenderer.send(IpcChannels.historyCancel)
}

const ocrApi: OcrApi = {
  onRun: (cb) => on<OcrJob>(IpcChannels.ocrRun, cb),
  sendResult: (id, text) => ipcRenderer.send(IpcChannels.ocrResult, id, text)
}

const overlayApi: OverlayApi = {
  onInit: (cb) => {
    const listener = (_e: IpcRendererEvent, payload: { dataUrl: string }): void => cb(payload)
    ipcRenderer.on(IpcChannels.overlayInit, listener)
    return () => ipcRenderer.removeListener(IpcChannels.overlayInit, listener)
  },
  select: (rect: Rect) => ipcRenderer.send(IpcChannels.overlaySelect, rect),
  cancel: () => ipcRenderer.send(IpcChannels.overlayCancel)
}

const pickerApi: PickerApi = {
  onInit: (cb) => {
    const listener = (_e: IpcRendererEvent, payload: { sources: WindowSource[] }): void =>
      cb(payload)
    ipcRenderer.on(IpcChannels.pickerInit, listener)
    return () => ipcRenderer.removeListener(IpcChannels.pickerInit, listener)
  },
  select: (id: string) => ipcRenderer.send(IpcChannels.pickerSelect, id),
  cancel: () => ipcRenderer.send(IpcChannels.pickerCancel)
}

const videoApi: VideoApi = {
  onOpen: (cb) => on<VideoOpenPayload>(IpcChannels.videoOpen, cb),
  export: (req) => ipcRenderer.invoke(IpcChannels.videoExport, req),
  onProgress: (cb) => on<number>(IpcChannels.videoProgress, cb),
  cancel: () => ipcRenderer.send(IpcChannels.videoCancel),
  pickFile: () => ipcRenderer.invoke(IpcChannels.videoPickFile),
  // Sandboxed renderers have no File.path; the preload resolves it.
  openDropped: (file) => ipcRenderer.send(IpcChannels.videoOpenPath, webUtils.getPathForFile(file))
}

// contextIsolation is on: expose the APIs on isolated globals.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('overlayApi', overlayApi)
    contextBridge.exposeInMainWorld('pickerApi', pickerApi)
    contextBridge.exposeInMainWorld('historyApi', historyApi)
    contextBridge.exposeInMainWorld('ocrApi', ocrApi)
    contextBridge.exposeInMainWorld('controlApi', controlApi)
    contextBridge.exposeInMainWorld('recorderApi', recorderApi)
    contextBridge.exposeInMainWorld('videoApi', videoApi)
    contextBridge.exposeInMainWorld('replayApi', replayApi)
  } catch (error) {
    console.error('[preload] failed to expose api:', error)
  }
} else {
  // Fallback (should not happen: contextIsolation is enforced in main).
  const w = window as unknown as {
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
  w.api = api
  w.overlayApi = overlayApi
  w.pickerApi = pickerApi
  w.controlApi = controlApi
  w.recorderApi = recorderApi
  w.historyApi = historyApi
  w.ocrApi = ocrApi
  w.videoApi = videoApi
  w.replayApi = replayApi
}
