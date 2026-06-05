import { app, BrowserWindow } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'

export type RemoteMessagePayload = {
  id?: number
  content: string
  senderName?: string
  createdAt?: string
}

type RecentPetMessageRow = {
  id?: number | string
  content?: string
  sender_name?: string
  senderName?: string
  created_at?: string
  createdAt?: string
}

type RemoteHistoryMergeResult = {
  fetchedCount: number
  addedCount: number
}

type RemoteMessageConfig = {
  supabaseUrl: string
  supabaseAnonKey: string
  realtimeTopic: string
}

type RemoteMessageListenerOptions = {
  getWindow: () => BrowserWindow | null
  showWindow: () => void
}

type RemoteMessageListener = {
  stop: () => Promise<void>
}

const REMOTE_MESSAGE_CONFIG_FILE_NAME = 'remote-message-config.json'
const REMOTE_MESSAGE_LOG_FILE_NAME = 'remote-message.log'
const REMOTE_MESSAGE_USER_DATA_DIRECTORY_NAME = 'desktop-q-assistant'
const REMOTE_MESSAGE_EVENT_NAME = 'pet_message'
const RECENT_MESSAGES_RPC_NAME = 'get_recent_pet_messages'
const RECONNECT_DELAY_MS = 5000

let reconnectTimer: NodeJS.Timeout | null = null

export function getRemoteMessageConfigFilePath(): string {
  return join(getRemoteMessageDataDirectoryPath(), REMOTE_MESSAGE_CONFIG_FILE_NAME)
}

function getRemoteMessageDataDirectoryPath(): string {
  return join(app.getPath('appData'), REMOTE_MESSAGE_USER_DATA_DIRECTORY_NAME)
}

function getRemoteMessageLogFilePath(): string {
  return join(getRemoteMessageDataDirectoryPath(), REMOTE_MESSAGE_LOG_FILE_NAME)
}

function getCandidateConfigFilePaths(): string[] {
  const configuredPath = getRemoteMessageConfigFilePath()
  const appUserDataPath = join(app.getPath('userData'), REMOTE_MESSAGE_CONFIG_FILE_NAME)

  return Array.from(new Set([configuredPath, appUserDataPath]))
}

function writeRemoteMessageLog(event: string, details: Record<string, unknown> = {}): void {
  try {
    mkdirSync(getRemoteMessageDataDirectoryPath(), { recursive: true })
    appendFileSync(
      getRemoteMessageLogFilePath(),
      `${JSON.stringify({
        at: new Date().toISOString(),
        event,
        ...details
      })}\n`,
      'utf-8'
    )
  } catch {
    // Logging must never block the desktop pet from starting.
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  try {
    return JSON.stringify(error)
  } catch {
    return 'unknown error'
  }
}

function logRuntimePaths(): void {
  writeRemoteMessageLog('runtime', {
    mode: app.isPackaged ? 'packaged' : 'development',
    userDataPath: app.getPath('userData'),
    appDataPath: app.getPath('appData'),
    remoteMessageDataPath: getRemoteMessageDataDirectoryPath(),
    configFilePath: getRemoteMessageConfigFilePath(),
    logFilePath: getRemoteMessageLogFilePath()
  })
}

function readRemoteMessageConfig(): RemoteMessageConfig | undefined {
  const configFromEnv = readRemoteMessageConfigFromEnv()

  if (configFromEnv) {
    writeRemoteMessageLog('config.env.loaded', {
      supabaseUrlPresent: true,
      supabaseAnonKeyPresent: true,
      realtimeTopicPresent: true
    })
    return configFromEnv
  }

  for (const configFilePath of getCandidateConfigFilePaths()) {
    const configExists = existsSync(configFilePath)

    writeRemoteMessageLog('config.file.check', {
      configFilePath,
      exists: configExists
    })

    if (!configExists) {
      continue
    }

    try {
      const config = JSON.parse(
        readFileSync(configFilePath, 'utf-8')
      ) as Partial<RemoteMessageConfig>
      const normalizedConfig = normalizeRemoteMessageConfig(config)

      writeRemoteMessageLog('config.file.loaded', {
        configFilePath,
        supabaseUrlPresent: Boolean(config.supabaseUrl),
        supabaseAnonKeyPresent: Boolean(config.supabaseAnonKey),
        realtimeTopicPresent: Boolean(config.realtimeTopic),
        complete: Boolean(normalizedConfig)
      })

      if (normalizedConfig) {
        return normalizedConfig
      }
    } catch (error) {
      console.warn('[remote-message] Failed to read config file.', error)
      writeRemoteMessageLog('config.file.error', {
        configFilePath,
        error: formatError(error)
      })
    }
  }

  console.info(`[remote-message] Config not found: ${getRemoteMessageConfigFilePath()}`)
  writeRemoteMessageLog('config.missing')
  return undefined
}

function readRemoteMessageConfigFromEnv(): RemoteMessageConfig | undefined {
  const envConfig = {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    realtimeTopic: process.env.SUPABASE_REALTIME_TOPIC
  }
  const normalizedConfig = normalizeRemoteMessageConfig(envConfig)

  writeRemoteMessageLog('config.env.check', {
    supabaseUrlPresent: Boolean(envConfig.supabaseUrl),
    supabaseAnonKeyPresent: Boolean(envConfig.supabaseAnonKey),
    realtimeTopicPresent: Boolean(envConfig.realtimeTopic),
    complete: Boolean(normalizedConfig)
  })

  return normalizedConfig
}

function normalizeRemoteMessageConfig(
  config: Partial<RemoteMessageConfig>
): RemoteMessageConfig | undefined {
  const supabaseUrl = config.supabaseUrl?.trim()
  const supabaseAnonKey = config.supabaseAnonKey?.trim()
  const realtimeTopic = config.realtimeTopic?.trim()

  if (!supabaseUrl || !supabaseAnonKey || !realtimeTopic) {
    return undefined
  }

  if (looksLikeForbiddenSecretKey(supabaseAnonKey)) {
    console.warn('[remote-message] Refusing to use a Supabase secret or service_role key.')
    writeRemoteMessageLog('config.rejected', {
      reason: 'forbidden_supabase_key'
    })
    return undefined
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    realtimeTopic
  }
}

function looksLikeForbiddenSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) {
    return true
  }

  const [, payload] = key.split('.')

  if (!payload) {
    return false
  }

  try {
    const decodedPayload = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    ) as { role?: string }

    return decodedPayload.role === 'service_role'
  } catch {
    return false
  }
}

function normalizeTopic(topic: string): string {
  return topic.startsWith('pet:') ? topic : `pet:${topic}`
}

function normalizeRemoteMessagePayload(payload: unknown): RemoteMessagePayload | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined
  }

  const candidate = payload as Partial<RemoteMessagePayload>
  const content = candidate.content?.trim()

  if (!content) {
    return undefined
  }

  return {
    id: typeof candidate.id === 'number' ? candidate.id : undefined,
    content,
    senderName: typeof candidate.senderName === 'string' ? candidate.senderName : undefined,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : undefined
  }
}

function normalizeRemoteMessageId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsedValue = Number(value)

    return Number.isSafeInteger(parsedValue) ? parsedValue : undefined
  }

  return undefined
}

function normalizeRecentPetMessageRow(row: RecentPetMessageRow): RemoteMessagePayload | undefined {
  const content = row.content?.trim()

  if (!content) {
    return undefined
  }

  return {
    id: normalizeRemoteMessageId(row.id),
    content,
    senderName:
      typeof row.senderName === 'string'
        ? row.senderName
        : typeof row.sender_name === 'string'
          ? row.sender_name
          : undefined,
    createdAt:
      typeof row.createdAt === 'string'
        ? row.createdAt
        : typeof row.created_at === 'string'
          ? row.created_at
          : undefined
  }
}

function sendRendererEvent(
  window: BrowserWindow | null,
  channel: string,
  payload: RemoteMessagePayload | RemoteMessagePayload[]
): void {
  if (!window || window.isDestroyed()) {
    return
  }

  const send = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }

  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', send)
    return
  }

  send()
}

async function fetchRecentMessageHistory(
  supabase: SupabaseClient,
  realtimeTopic: string,
  options: RemoteMessageListenerOptions
): Promise<boolean> {
  writeRemoteMessageLog('history.fetch.start', {
    realtimeTopicPresent: Boolean(realtimeTopic)
  })

  try {
    const { data, error } = await supabase.rpc(RECENT_MESSAGES_RPC_NAME, {
      realtime_topic_input: realtimeTopic
    })

    if (error) {
      writeRemoteMessageLog('history.fetch.error', {
        error: error.message
      })
      return false
    }

    const messages = Array.isArray(data)
      ? data
          .map((row) => normalizeRecentPetMessageRow(row as RecentPetMessageRow))
          .filter((message): message is RemoteMessagePayload => Boolean(message))
      : []

    writeRemoteMessageLog('history.fetch.success', {
      fetchedCount: messages.length
    })

    sendRendererEvent(options.getWindow(), 'remote-message:history', messages)
    return true
  } catch (error) {
    writeRemoteMessageLog('history.fetch.error', {
      error: formatError(error)
    })
    return false
  }
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

async function authenticateForPrivateRealtime(
  supabase: SupabaseClient,
  fallbackKey: string
): Promise<boolean> {
  const { data, error } = await supabase.auth.signInAnonymously()

  if (data.session?.access_token) {
    supabase.realtime.setAuth(data.session.access_token)
    writeRemoteMessageLog('auth.anonymous.success', {
      accessTokenPresent: true
    })
    return true
  }

  if (error) {
    console.warn(
      '[remote-message] Anonymous auth failed. Enable anonymous sign-ins for private Realtime.',
      error.message
    )
    writeRemoteMessageLog('auth.anonymous.error', {
      error: error.message
    })
  }

  supabase.realtime.setAuth(fallbackKey)
  writeRemoteMessageLog('auth.anonymous.fallback', {
    fallbackAnonKeyPresent: Boolean(fallbackKey)
  })
  return false
}

export function startRemoteMessageListener(
  options: RemoteMessageListenerOptions
): RemoteMessageListener | null {
  logRuntimePaths()

  const config = readRemoteMessageConfig()

  if (!config) {
    writeRemoteMessageLog('listener.skipped', {
      reason: 'missing_config'
    })
    return null
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: false
    }
  })
  const channelTopic = normalizeTopic(config.realtimeTopic)
  let stopped = false
  let channel: RealtimeChannel | null = null
  let historyFetched = false

  writeRemoteMessageLog('listener.start', {
    supabaseUrlPresent: true,
    supabaseAnonKeyPresent: true,
    realtimeTopicPresent: true,
    channelTopic
  })

  const subscribe = async (): Promise<void> => {
    clearReconnectTimer()

    if (stopped) {
      return
    }

    try {
      const authenticated = await authenticateForPrivateRealtime(supabase, config.supabaseAnonKey)

      if (!historyFetched) {
        if (authenticated) {
          historyFetched = await fetchRecentMessageHistory(supabase, config.realtimeTopic, options)
        } else {
          writeRemoteMessageLog('history.fetch.error', {
            error: 'anonymous_auth_failed'
          })
        }
      }
    } catch (error) {
      console.warn('[remote-message] Anonymous auth failed.', error)
      writeRemoteMessageLog('auth.anonymous.exception', {
        error: formatError(error)
      })
      if (!historyFetched) {
        writeRemoteMessageLog('history.fetch.error', {
          error: formatError(error)
        })
      }
    }

    if (channel) {
      await supabase.removeChannel(channel)
    }

    channel = supabase.channel(channelTopic, {
      config: {
        private: true
      }
    })

    channel
      .on('broadcast', { event: REMOTE_MESSAGE_EVENT_NAME }, ({ payload }) => {
        writeRemoteMessageLog('message.received', {
          payload
        })

        const message = normalizeRemoteMessagePayload(payload)

        if (!message) {
          writeRemoteMessageLog('message.ignored', {
            reason: 'invalid_payload'
          })
          return
        }

        options.showWindow()
        sendRendererEvent(options.getWindow(), 'remote-message:new', message)
        writeRemoteMessageLog('message.forwarded', {
          id: message.id,
          contentPresent: Boolean(message.content),
          senderName: message.senderName,
          createdAt: message.createdAt
        })
      })
      .subscribe((status, error) => {
        writeRemoteMessageLog('channel.status', {
          channelTopic,
          status,
          error: error ? formatError(error) : undefined
        })

        if (status === 'SUBSCRIBED') {
          console.info(`[remote-message] Subscribed to ${channelTopic}`)
          return
        }

        if (error) {
          console.warn('[remote-message] Subscription error.', error)
        }

        if (!stopped && ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          clearReconnectTimer()
          writeRemoteMessageLog('channel.reconnect_scheduled', {
            delayMs: RECONNECT_DELAY_MS
          })
          reconnectTimer = setTimeout(() => {
            void subscribe()
          }, RECONNECT_DELAY_MS)
        }
      })
  }

  void subscribe()

  return {
    stop: async (): Promise<void> => {
      stopped = true
      clearReconnectTimer()
      writeRemoteMessageLog('listener.stop')

      if (channel) {
        await supabase.removeChannel(channel)
        channel = null
      }
    }
  }
}

export function logRemoteMessageHistoryMerge(result: Partial<RemoteHistoryMergeResult>): void {
  writeRemoteMessageLog('history.merge.result', {
    fetchedCount: typeof result.fetchedCount === 'number' ? result.fetchedCount : 0,
    addedCount: typeof result.addedCount === 'number' ? result.addedCount : 0
  })
}
