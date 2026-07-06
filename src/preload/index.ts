import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IpcChannels,
  type CaptureMode,
  type CapturePayload,
  type OverlayApi,
  type PickerApi,
  type Rect,
  type SnapkitApi,
  type WindowSource
} from '@shared/ipc'

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
  activateLicense: (key) => ipcRenderer.invoke(IpcChannels.licenseActivate, key)
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

// contextIsolation is on: expose the APIs on isolated globals.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('overlayApi', overlayApi)
    contextBridge.exposeInMainWorld('pickerApi', pickerApi)
  } catch (error) {
    console.error('[preload] failed to expose api:', error)
  }
} else {
  // Fallback (should not happen: contextIsolation is enforced in main).
  const w = window as unknown as { api: SnapkitApi; overlayApi: OverlayApi; pickerApi: PickerApi }
  w.api = api
  w.overlayApi = overlayApi
  w.pickerApi = pickerApi
}
