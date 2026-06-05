import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
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

  interface Window {
    electron: ElectronAPI
    api: {
      quit: () => Promise<void>
      moveWindowBy: (deltaX: number, deltaY: number) => Promise<void>
      saveWindowPosition: () => Promise<void>
      showContextMenu: () => Promise<void>
      closeSystemStatusPanel: () => Promise<void>
      openSystemStatusPanel: () => Promise<void>
      openInboxPanel: () => Promise<void>
      closeInboxPanel: () => Promise<void>
      getSettingsSnapshot: () => Promise<AppSettingsSnapshot>
      updateSettings: (patch: AppSettingsPatch) => Promise<AppSettingsSnapshot>
      closeSettingsPanel: () => Promise<void>
      getOpenAtLogin: () => Promise<boolean>
      setOpenAtLogin: (enabled: boolean) => Promise<boolean>
      setAlwaysOnTop: (enabled: boolean) => Promise<boolean>
      resetAssistantPosition: () => Promise<void>
      markAllInboxRead: () => Promise<void>
      openLogsFolder: () => Promise<void>
      openRemoteMessageLog: () => Promise<void>
      openSystemStatusLog: () => Promise<void>
      openAppUsageFolder: () => Promise<void>
      reportRemoteHistoryMerge: (result: {
        fetchedCount: number
        addedCount: number
      }) => Promise<void>
      onSettingsChanged: (callback: (snapshot: AppSettingsSnapshot) => void) => () => void
      onInboxMarkAllRead: (callback: () => void) => () => void
      onRemoteMessage: (callback: (message: RemotePetMessage) => void) => () => void
      onRemoteMessageHistory: (callback: (messages: RemotePetMessage[]) => void) => () => void
      onSystemStatusUpdate: (callback: (snapshot: SystemStatusSnapshot) => void) => () => void
    }
  }
}
