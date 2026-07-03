import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, type SnapkitApi } from '@shared/ipc'

const api: SnapkitApi = {
  getVersion: () => ipcRenderer.invoke(IpcChannels.appVersion),
  hideWindow: () => ipcRenderer.send(IpcChannels.windowHide)
}

// contextIsolation is on: expose the API on an isolated `window.api`.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('[preload] failed to expose api:', error)
  }
} else {
  // Fallback (should not happen: contextIsolation is enforced in main).
  ;(window as unknown as { api: SnapkitApi }).api = api
}
