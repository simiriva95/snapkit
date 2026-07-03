/**
 * Typed IPC contract shared between main and renderer.
 * Single source of truth for channel names and the API surface the preload
 * exposes on `window.api`. No magic strings scattered across the codebase.
 */

export const IpcChannels = {
  appVersion: 'app:version',
  windowHide: 'window:hide'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

/** The API bridged into the renderer via contextBridge (see preload). */
export interface SnapkitApi {
  /** App version string, read from the main process. */
  getVersion: () => Promise<string>
  /** Hide the main window (app keeps running in the tray). */
  hideWindow: () => void
}
