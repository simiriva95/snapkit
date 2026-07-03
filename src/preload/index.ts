import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IpcChannels,
  type CapturePayload,
  type OverlayApi,
  type Rect,
  type SnapkitApi
} from '@shared/ipc'

const api: SnapkitApi = {
  getVersion: () => ipcRenderer.invoke(IpcChannels.appVersion),
  hideWindow: () => ipcRenderer.send(IpcChannels.windowHide),
  startCapture: () => ipcRenderer.send(IpcChannels.captureStart),
  onCapture: (cb) => {
    const listener = (_e: IpcRendererEvent, payload: CapturePayload): void => cb(payload)
    ipcRenderer.on(IpcChannels.captureCaptured, listener)
    return () => ipcRenderer.removeListener(IpcChannels.captureCaptured, listener)
  }
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

// contextIsolation is on: expose the APIs on isolated globals.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('overlayApi', overlayApi)
  } catch (error) {
    console.error('[preload] failed to expose api:', error)
  }
} else {
  // Fallback (should not happen: contextIsolation is enforced in main).
  const w = window as unknown as { api: SnapkitApi; overlayApi: OverlayApi }
  w.api = api
  w.overlayApi = overlayApi
}
