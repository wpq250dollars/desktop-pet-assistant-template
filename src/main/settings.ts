import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export type AppSettings = {
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

export type AppSettingsPatch = {
  general?: Partial<AppSettings['general']>
  messages?: Partial<AppSettings['messages']>
  appearance?: Partial<AppSettings['appearance']>
}

const SETTINGS_DIRECTORY_NAME = 'desktop-q-assistant'
const SETTINGS_FILE_NAME = 'app-settings.json'

export const DEFAULT_APP_SETTINGS: AppSettings = {
  version: 1,
  general: {
    alwaysOnTop: true
  },
  messages: {
    remoteBubbleDurationMs: 25000,
    inboxRetentionDays: 5,
    inboxMaxItems: 50
  },
  appearance: {
    quoteBubbleEnabled: true,
    unreadBadgeEnabled: true
  }
}

export function getAppDataDirectoryPath(): string {
  return join(app.getPath('appData'), SETTINGS_DIRECTORY_NAME)
}

export function getAppSettingsFilePath(): string {
  return join(getAppDataDirectoryPath(), SETTINGS_FILE_NAME)
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.round(value)))
}

function normalizeSettings(value: unknown): AppSettings {
  const candidate = value && typeof value === 'object' ? (value as Partial<AppSettings>) : {}

  return {
    version: 1,
    general: {
      alwaysOnTop:
        typeof candidate.general?.alwaysOnTop === 'boolean'
          ? candidate.general.alwaysOnTop
          : DEFAULT_APP_SETTINGS.general.alwaysOnTop
    },
    messages: {
      remoteBubbleDurationMs: clampNumber(
        candidate.messages?.remoteBubbleDurationMs,
        10000,
        40000,
        DEFAULT_APP_SETTINGS.messages.remoteBubbleDurationMs
      ),
      inboxRetentionDays: clampNumber(
        candidate.messages?.inboxRetentionDays,
        1,
        30,
        DEFAULT_APP_SETTINGS.messages.inboxRetentionDays
      ),
      inboxMaxItems: clampNumber(
        candidate.messages?.inboxMaxItems,
        20,
        200,
        DEFAULT_APP_SETTINGS.messages.inboxMaxItems
      )
    },
    appearance: {
      quoteBubbleEnabled:
        typeof candidate.appearance?.quoteBubbleEnabled === 'boolean'
          ? candidate.appearance.quoteBubbleEnabled
          : DEFAULT_APP_SETTINGS.appearance.quoteBubbleEnabled,
      unreadBadgeEnabled:
        typeof candidate.appearance?.unreadBadgeEnabled === 'boolean'
          ? candidate.appearance.unreadBadgeEnabled
          : DEFAULT_APP_SETTINGS.appearance.unreadBadgeEnabled
    }
  }
}

export function readAppSettings(): AppSettings {
  const filePath = getAppSettingsFilePath()

  if (!existsSync(filePath)) {
    writeAppSettings(DEFAULT_APP_SETTINGS)
    return DEFAULT_APP_SETTINGS
  }

  try {
    const parsedValue = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
    const settings = normalizeSettings(parsedValue)

    writeAppSettings(settings)
    return settings
  } catch {
    writeAppSettings(DEFAULT_APP_SETTINGS)
    return DEFAULT_APP_SETTINGS
  }
}

export function writeAppSettings(settings: AppSettings): void {
  mkdirSync(getAppDataDirectoryPath(), { recursive: true })
  writeFileSync(getAppSettingsFilePath(), JSON.stringify(normalizeSettings(settings), null, 2), {
    encoding: 'utf-8'
  })
}

export function updateAppSettings(patch: AppSettingsPatch): AppSettings {
  const currentSettings = readAppSettings()
  const nextSettings = normalizeSettings({
    version: 1,
    general: {
      ...currentSettings.general,
      ...patch.general
    },
    messages: {
      ...currentSettings.messages,
      ...patch.messages
    },
    appearance: {
      ...currentSettings.appearance,
      ...patch.appearance
    }
  })

  writeAppSettings(nextSettings)
  return nextSettings
}
