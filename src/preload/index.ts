import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

type RemotePetMessage = {
  content: string
  senderName?: string
  id?: number
  createdAt?: string
}

type SystemStatusSnapshot = {
  cpuUsagePercent: number | null
  memory: {
    totalBytes: number
    usedBytes: number
    freeBytes: number
    usedPercent: number
  }
  gpu: {
    model: string
    usagePercent: number | null
  }
  appUsageAvailable: boolean
  todayUsage: Array<{
    appKey: string
    appName: string
    processName: string
    seconds: number
    lastSeenAt: string
  }>
}

type AppSettings = {
  version: 1
  general: {
    alwaysOnTop: boolean
  }
  messages: {
    remoteBubbleDurationMs: number
    inboxRetentionDays: number
    inboxMaxItems: number
  }
  appearance: {
    quoteBubbleEnabled: boolean
    unreadBadgeEnabled: boolean
  }
}

type AppSettingsPatch = {
  general?: Partial<AppSettings['general']>
  messages?: Partial<AppSettings['messages']>
  appearance?: Partial<AppSettings['appearance']>
}

type AppSettingsSnapshot = {
  settings: AppSettings
  openAtLogin: boolean
}

const api = {
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),
  moveWindowBy: (deltaX: number, deltaY: number): Promise<void> =>
    ipcRenderer.invoke('window:move-by', deltaX, deltaY),
  saveWindowPosition: (): Promise<void> => ipcRenderer.invoke('window:save-position'),
  showContextMenu: (): Promise<void> => ipcRenderer.invoke('window:show-context-menu'),
  closeSystemStatusPanel: (): Promise<void> => ipcRenderer.invoke('system-status:close-panel'),
  openSystemStatusPanel: (): Promise<void> => ipcRenderer.invoke('system-status:open-panel'),
  openInboxPanel: (): Promise<void> => ipcRenderer.invoke('inbox:open-panel'),
  closeInboxPanel: (): Promise<void> => ipcRenderer.invoke('inbox:close-panel'),
  getSettingsSnapshot: (): Promise<AppSettingsSnapshot> =>
    ipcRenderer.invoke('settings:get-snapshot'),
  updateSettings: (patch: AppSettingsPatch): Promise<AppSettingsSnapshot> =>
    ipcRenderer.invoke('settings:update', patch),
  closeSettingsPanel: (): Promise<void> => ipcRenderer.invoke('settings:close-panel'),
  getOpenAtLogin: (): Promise<boolean> => ipcRenderer.invoke('settings:get-open-at-login'),
  setOpenAtLogin: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('settings:set-open-at-login', enabled),
  setAlwaysOnTop: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('settings:set-always-on-top', enabled),
  resetAssistantPosition: (): Promise<void> =>
    ipcRenderer.invoke('settings:reset-assistant-position'),
  markAllInboxRead: (): Promise<void> => ipcRenderer.invoke('settings:mark-all-inbox-read'),
  openLogsFolder: (): Promise<void> => ipcRenderer.invoke('settings:open-logs-folder'),
  openRemoteMessageLog: (): Promise<void> => ipcRenderer.invoke('settings:open-remote-message-log'),
  openSystemStatusLog: (): Promise<void> => ipcRenderer.invoke('settings:open-system-status-log'),
  openAppUsageFolder: (): Promise<void> => ipcRenderer.invoke('settings:open-app-usage-folder'),
  reportRemoteHistoryMerge: (result: { fetchedCount: number; addedCount: number }): Promise<void> =>
    ipcRenderer.invoke('remote-message:history-merge-result', result),
  onSettingsChanged: (callback: (snapshot: AppSettingsSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSettingsSnapshot): void => {
      callback(snapshot)
    }

    ipcRenderer.on('settings:changed', listener)

    return () => {
      ipcRenderer.removeListener('settings:changed', listener)
    }
  },
  onInboxMarkAllRead: (callback: () => void): (() => void) => {
    const listener = (): void => {
      callback()
    }

    ipcRenderer.on('inbox:mark-all-read', listener)

    return () => {
      ipcRenderer.removeListener('inbox:mark-all-read', listener)
    }
  },
  onRemoteMessage: (callback: (message: RemotePetMessage) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: RemotePetMessage): void => {
      callback(message)
    }

    ipcRenderer.on('remote-message:new', listener)

    return () => {
      ipcRenderer.removeListener('remote-message:new', listener)
    }
  },
  onRemoteMessageHistory: (callback: (messages: RemotePetMessage[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, messages: RemotePetMessage[]): void => {
      callback(messages)
    }

    ipcRenderer.on('remote-message:history', listener)

    return () => {
      ipcRenderer.removeListener('remote-message:history', listener)
    }
  },
  onSystemStatusUpdate: (callback: (snapshot: SystemStatusSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: SystemStatusSnapshot): void => {
      callback(snapshot)
    }

    ipcRenderer.on('system-status:update', listener)

    return () => {
      ipcRenderer.removeListener('system-status:update', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
