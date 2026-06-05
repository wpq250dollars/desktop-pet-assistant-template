import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from 'react'
import idleImage from './assets/idle.png'
import hoverImage from './assets/hover.png'
import clickImage from './assets/click.png'
import unreadImage from './assets/unread.png'
import dragRightImage from './assets/drag_right.gif'
import { quotes, type QuoteItem } from './quotes'

type AssistantMood = 'idle' | 'hover' | 'click' | 'unread'
type DragDirection = 'left' | 'right'
type ImageMood = AssistantMood | 'dragLeft' | 'dragRight'
type BubbleKind = 'sleep' | 'remote' | 'quote'

type BubbleContent =
  | {
      kind: 'text'
      text: string
    }
  | {
      kind: 'quote'
      quote: QuoteItem
    }

type DragState = {
  startX: number
  startY: number
  lastX: number
  lastY: number
  isDragging: boolean
}

type InboxMessage = {
  localId: string
  remoteId?: number
  senderName: string
  content: string
  createdAt: string
  read: boolean
}

const DRAG_THRESHOLD = 5
const DRAG_DIRECTION_THRESHOLD = 6
const QUOTE_BUBBLE_DURATION_MS = 10000
const SLEEP_REMINDER_DURATION_MS = 10000
const SLEEP_REMINDER_MESSAGE = '该休息啦，已经第二天了'
const LAST_SLEEP_REMINDER_DATE_KEY = 'lastSleepReminderDate'
const REMOTE_MESSAGE_INBOX_KEY = 'remoteMessageInbox'
const MS_PER_DAY = 24 * 60 * 60 * 1000

const DEFAULT_RENDERER_SETTINGS: AppSettings = {
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

const DEFAULT_SETTINGS_SNAPSHOT: AppSettingsSnapshot = {
  settings: DEFAULT_RENDERER_SETTINGS,
  openAtLogin: false
}

const imageSources: Record<ImageMood, string> = {
  idle: idleImage,
  hover: hoverImage,
  click: clickImage,
  unread: unreadImage,
  dragLeft: dragRightImage,
  dragRight: dragRightImage
}

const moodLabels: Record<ImageMood, string> = {
  idle: 'idle',
  hover: 'hover',
  click: 'click',
  unread: 'unread',
  dragLeft: 'drag-left',
  dragRight: 'drag-right'
}

function getLocalDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getMillisecondsUntilNextMidnight(date: Date): number {
  const nextMidnight = new Date(date)
  nextMidnight.setHours(24, 0, 0, 0)

  return nextMidnight.getTime() - date.getTime()
}

function createLocalMessageId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeInboxMessage(value: unknown): InboxMessage | undefined {
  if (!isPlainRecord(value)) {
    return undefined
  }

  const content = typeof value.content === 'string' ? value.content.trim() : ''

  if (!content) {
    return undefined
  }

  const senderName =
    typeof value.senderName === 'string' && value.senderName.trim() ? value.senderName.trim() : 'TA'

  return {
    localId:
      typeof value.localId === 'string' && value.localId ? value.localId : createLocalMessageId(),
    remoteId: typeof value.remoteId === 'number' ? value.remoteId : undefined,
    senderName,
    content,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    read: value.read === true
  }
}

function readStoredInboxMessages(settings = DEFAULT_RENDERER_SETTINGS): InboxMessage[] {
  try {
    const rawValue = localStorage.getItem(REMOTE_MESSAGE_INBOX_KEY)

    if (!rawValue) {
      return []
    }

    const parsedValue = JSON.parse(rawValue) as unknown

    if (!Array.isArray(parsedValue)) {
      writeStoredInboxMessages([], settings)
      return []
    }

    const messages = parsedValue
      .map((item) => normalizeInboxMessage(item))
      .filter((item): item is InboxMessage => Boolean(item))
    const prunedMessages = pruneInboxMessages(messages, settings)

    writeStoredInboxMessages(prunedMessages, settings)
    return prunedMessages
  } catch {
    writeStoredInboxMessages([], settings)
    return []
  }
}

function writeStoredInboxMessages(
  messages: InboxMessage[],
  settings = DEFAULT_RENDERER_SETTINGS
): void {
  try {
    localStorage.setItem(
      REMOTE_MESSAGE_INBOX_KEY,
      JSON.stringify(pruneInboxMessages(messages, settings))
    )
  } catch {
    // Storage failure should not break the desktop pet UI.
  }
}

function pruneInboxMessages(
  messages: InboxMessage[],
  settings = DEFAULT_RENDERER_SETTINGS
): InboxMessage[] {
  const maxAgeMs = settings.messages.inboxRetentionDays * MS_PER_DAY
  const now = Date.now()

  return messages
    .filter((message) => {
      const createdAtTime = new Date(message.createdAt).getTime()

      if (Number.isNaN(createdAtTime)) {
        return true
      }

      return now - createdAtTime <= maxAgeMs
    })
    .sort((firstMessage, secondMessage) => {
      const firstTime = new Date(firstMessage.createdAt).getTime()
      const secondTime = new Date(secondMessage.createdAt).getTime()

      if (Number.isNaN(firstTime) && Number.isNaN(secondTime)) {
        return 0
      }

      if (Number.isNaN(firstTime)) {
        return 1
      }

      if (Number.isNaN(secondTime)) {
        return -1
      }

      return secondTime - firstTime
    })
    .slice(0, settings.messages.inboxMaxItems)
}

function getRemoteMessageId(message: RemotePetMessage): number | undefined {
  const candidate = message as RemotePetMessage & { remoteId?: number }

  if (typeof candidate.remoteId === 'number') {
    return candidate.remoteId
  }

  return typeof candidate.id === 'number' ? candidate.id : undefined
}

function createInboxMessageFromRemoteMessage(message: RemotePetMessage): InboxMessage | undefined {
  const content = message.content.trim()

  if (!content) {
    return undefined
  }

  const remoteId = getRemoteMessageId(message)

  return {
    localId: typeof remoteId === 'number' ? `remote-${remoteId}` : createLocalMessageId(),
    remoteId,
    senderName: message.senderName?.trim() || 'TA',
    content,
    createdAt: message.createdAt || new Date().toISOString(),
    read: false
  }
}

function mergeRemoteMessagesIntoInbox(
  remoteMessages: RemotePetMessage[],
  currentMessages: InboxMessage[],
  settings = DEFAULT_RENDERER_SETTINGS
): { nextMessages: InboxMessage[]; addedCount: number } {
  const knownRemoteIds = new Set(
    currentMessages
      .map((message) => message.remoteId)
      .filter((remoteId): remoteId is number => typeof remoteId === 'number')
  )
  const addedMessages: InboxMessage[] = []

  for (const remoteMessage of remoteMessages) {
    const inboxMessage = createInboxMessageFromRemoteMessage(remoteMessage)

    if (!inboxMessage) {
      continue
    }

    if (typeof inboxMessage.remoteId === 'number') {
      if (knownRemoteIds.has(inboxMessage.remoteId)) {
        continue
      }

      knownRemoteIds.add(inboxMessage.remoteId)
    }

    addedMessages.push(inboxMessage)
  }

  if (addedMessages.length === 0) {
    return {
      nextMessages: pruneInboxMessages(currentMessages, settings),
      addedCount: 0
    }
  }

  return {
    nextMessages: pruneInboxMessages([...addedMessages, ...currentMessages], settings),
    addedCount: addedMessages.length
  }
}

function formatInboxTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 GB'
  }

  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatUsageDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  if (hours > 0) {
    return `${hours}小时${minutes}分钟`
  }

  if (minutes > 0) {
    return `${minutes}分钟`
  }

  return `${totalSeconds}秒`
}

function formatGpuModel(model?: string): string {
  const rawModel = model?.trim()

  if (!rawModel) {
    return '未知 GPU'
  }

  const knownModelPatterns = [
    /\bRTX\s*\d{3,4}(?:\s*Ti)?\b/i,
    /\bGTX\s*\d{3,4}(?:\s*Ti)?\b/i,
    /\bRX\s*\d{3,4}(?:\s*XT)?\b/i,
    /\bArc\s+[A-Z]?\d{3,4}\b/i
  ]

  for (const pattern of knownModelPatterns) {
    const match = rawModel.match(pattern)

    if (match) {
      return match[0].replace(/\s+/g, ' ').toUpperCase()
    }
  }

  return (
    rawModel
      .replace(/\bNVIDIA\b/gi, '')
      .replace(/\bGeForce\b/gi, '')
      .replace(/\bLaptop GPU\b/gi, '')
      .replace(/\bGPU\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || rawModel
  )
}

function pickRandomQuote(lastIndex: number | null): { quote: QuoteItem; index: number } {
  if (quotes.length === 1) {
    return { quote: quotes[0], index: 0 }
  }

  let nextIndex = Math.floor(Math.random() * quotes.length)

  if (nextIndex === lastIndex) {
    nextIndex = (nextIndex + 1) % quotes.length
  }

  return { quote: quotes[nextIndex], index: nextIndex }
}

function useSettingsSnapshot(): AppSettingsSnapshot {
  const [snapshot, setSnapshot] = useState<AppSettingsSnapshot>(DEFAULT_SETTINGS_SNAPSHOT)

  useEffect(() => {
    let cancelled = false

    void window.api.getSettingsSnapshot().then((nextSnapshot) => {
      if (!cancelled) {
        setSnapshot(nextSnapshot)
      }
    })

    const removeSettingsListener = window.api.onSettingsChanged((nextSnapshot) => {
      setSnapshot(nextSnapshot)
    })

    return () => {
      cancelled = true
      removeSettingsListener()
    }
  }, [])

  return snapshot
}

function SystemStatusPanel(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<SystemStatusSnapshot | null>(null)

  useEffect(() => {
    return window.api.onSystemStatusUpdate(setSnapshot)
  }, [])

  const cpuUsageLabel =
    snapshot?.cpuUsagePercent === null || snapshot?.cpuUsagePercent === undefined
      ? '计算中'
      : `${snapshot.cpuUsagePercent.toFixed(1)}%`
  const gpuUsageLabel =
    snapshot?.gpu.usagePercent === null || snapshot?.gpu.usagePercent === undefined
      ? '暂不可用'
      : `${snapshot.gpu.usagePercent.toFixed(1)}%`
  const totalUsageSeconds =
    snapshot?.todayUsage.reduce((total, item) => total + item.seconds, 0) ?? 0
  const maxUsageSeconds = Math.max(...(snapshot?.todayUsage.map((item) => item.seconds) ?? [0]), 1)
  const fullGpuModel = snapshot?.gpu.model?.trim() || '未知 GPU'
  const shortGpuModel = formatGpuModel(fullGpuModel)

  return (
    <main className="system-status-panel">
      <header className="system-status-header">
        <div>
          <p>LOCAL DEVICE STATUS</p>
          <h1>电脑状态</h1>
        </div>
        <button type="button" onClick={() => window.api.closeSystemStatusPanel()}>
          关闭
        </button>
      </header>

      <section className="system-status-metrics" aria-label="电脑当前状态">
        <article>
          <span>CPU LOAD</span>
          <strong>{cpuUsageLabel}</strong>
          <small>实时处理器占用</small>
        </article>
        <article>
          <span>MEMORY</span>
          <strong>{snapshot ? `${snapshot.memory.usedPercent.toFixed(1)}%` : '计算中'}</strong>
          <small>
            {snapshot
              ? `${formatBytes(snapshot.memory.usedBytes)} / ${formatBytes(snapshot.memory.totalBytes)}`
              : '正在读取'}
          </small>
        </article>
        <article title={fullGpuModel}>
          <span>GPU UNIT</span>
          <strong>{shortGpuModel}</strong>
          <small>占用：{gpuUsageLabel}</small>
        </article>
        <article>
          <span>APP TIME</span>
          <strong>{formatUsageDuration(totalUsageSeconds)}</strong>
          <small>{snapshot ? `${snapshot.todayUsage.length} 个应用` : '正在读取'}</small>
        </article>
      </section>

      <section className="system-status-usage" aria-label="今日应用使用时间">
        <div className="system-status-section-header">
          <h2>今日使用时间</h2>
          <span>FOREGROUND ACTIVITY</span>
        </div>
        {!snapshot?.appUsageAvailable ? (
          <p className="system-status-empty">应用统计暂不可用</p>
        ) : snapshot.todayUsage.length === 0 ? (
          <p className="system-status-empty">暂无统计，切换几个应用后会显示</p>
        ) : (
          <div className="system-status-usage-list">
            {snapshot.todayUsage.map((item) => (
              <article key={item.appKey}>
                <div>
                  <strong>{item.appName}</strong>
                  <span>{item.processName}</span>
                </div>
                <time>{formatUsageDuration(item.seconds)}</time>
                <span className="system-status-usage-bar" aria-hidden="true">
                  <span
                    style={{ width: `${Math.max(6, (item.seconds / maxUsageSeconds) * 100)}%` }}
                  />
                </span>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function InboxPanelWindow(): React.JSX.Element {
  const { settings } = useSettingsSnapshot()
  const [messages, setMessages] = useState<InboxMessage[]>(() => readStoredInboxMessages())
  const visibleMessages = useMemo(
    () => pruneInboxMessages(messages, settings),
    [messages, settings]
  )
  const unreadCount = useMemo(
    () => visibleMessages.filter((message) => !message.read).length,
    [visibleMessages]
  )

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent): void => {
      if (event.key === REMOTE_MESSAGE_INBOX_KEY) {
        setMessages(readStoredInboxMessages(settings))
      }
    }

    window.addEventListener('storage', handleStorageChange)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [settings])

  const markAllRead = useCallback((): void => {
    const nextMessages = visibleMessages.map((message) => ({
      ...message,
      read: true
    }))

    setMessages(nextMessages)
    writeStoredInboxMessages(nextMessages, settings)
  }, [settings, visibleMessages])

  useEffect(() => {
    return window.api.onInboxMarkAllRead(markAllRead)
  }, [markAllRead])

  return (
    <main className="inbox-window-shell">
      <section className="inbox-panel inbox-panel-window" aria-label="远程消息收件箱">
        <header className="inbox-panel-header">
          <h1>收件箱</h1>
          <button type="button" onClick={() => window.api.closeInboxPanel()}>
            关闭
          </button>
        </header>

        <div className="inbox-message-list">
          {visibleMessages.length === 0 ? (
            <p className="inbox-empty">还没有远程消息</p>
          ) : (
            visibleMessages.map((message) => (
              <article
                className={`inbox-message${message.read ? '' : ' inbox-message-unread'}`}
                key={message.localId}
              >
                <div className="inbox-message-meta">
                  <span>{message.senderName}</span>
                  <time>{formatInboxTime(message.createdAt)}</time>
                </div>
                <p>{message.content}</p>
                {!message.read && <span className="inbox-unread-label">未读</span>}
              </article>
            ))
          )}
        </div>

        <footer className="inbox-panel-footer">
          <button type="button" disabled={unreadCount === 0} onClick={markAllRead}>
            全部已读
          </button>
        </footer>
      </section>
    </main>
  )
}

type SettingsSection = 'basic' | 'messages' | 'appearance' | 'system' | 'advanced'

const settingsSections: Array<{ id: SettingsSection; label: string; subtitle: string }> = [
  { id: 'basic', label: '基础', subtitle: '窗口与启动' },
  { id: 'messages', label: '消息', subtitle: '气泡与收件箱' },
  { id: 'appearance', label: '外观', subtitle: '提示与红点' },
  { id: 'system', label: '电脑状态', subtitle: '本机面板' },
  { id: 'advanced', label: '高级', subtitle: '日志与诊断' }
]

function SettingsToggle({
  checked,
  label,
  description,
  onChange
}: {
  checked: boolean
  label: string
  description: string
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label className="settings-row settings-row-toggle">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

function SettingsAction({
  label,
  description,
  buttonLabel,
  onClick,
  disabled = false
}: {
  label: string
  description: string
  buttonLabel: string
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="settings-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <button type="button" disabled={disabled} onClick={onClick}>
        {buttonLabel}
      </button>
    </div>
  )
}

function SettingsPanel(): React.JSX.Element {
  const { settings, openAtLogin } = useSettingsSnapshot()
  const [activeSection, setActiveSection] = useState<SettingsSection>('basic')

  const updateSettings = (patch: AppSettingsPatch): void => {
    void window.api.updateSettings(patch)
  }

  const renderSection = (): React.JSX.Element => {
    if (activeSection === 'basic') {
      return (
        <>
          <SettingsToggle
            checked={openAtLogin}
            label="开机自启"
            description="使用 Windows 登录项，不写入 app-settings.json。"
            onChange={(checked) => void window.api.setOpenAtLogin(checked)}
          />
          <SettingsToggle
            checked={settings.general.alwaysOnTop}
            label="总是置顶"
            description="立即应用到桌宠主窗口，并保存到本地设置。"
            onChange={(checked) => void window.api.setAlwaysOnTop(checked)}
          />
          <SettingsAction
            label="重置桌宠位置"
            description="把桌宠移动回主屏幕右下角附近。"
            buttonLabel="重置"
            onClick={() => void window.api.resetAssistantPosition()}
          />
        </>
      )
    }

    if (activeSection === 'messages') {
      return (
        <>
          <div className="settings-row settings-row-stack">
            <span>
              <strong>远程消息气泡停留时间</strong>
              <small>当前：{Math.round(settings.messages.remoteBubbleDurationMs / 1000)} 秒</small>
            </span>
            <div className="settings-segmented">
              {[10000, 25000, 40000].map((duration) => (
                <button
                  type="button"
                  className={
                    settings.messages.remoteBubbleDurationMs === duration ? 'settings-active' : ''
                  }
                  key={duration}
                  onClick={() =>
                    updateSettings({
                      messages: {
                        remoteBubbleDurationMs: duration
                      }
                    })
                  }
                >
                  {duration / 1000} 秒
                </button>
              ))}
            </div>
          </div>
          <div className="settings-row settings-row-stack">
            <span>
              <strong>收件箱保留天数</strong>
              <small>范围 1-30 天，下一次清理或收消息时生效。</small>
            </span>
            <input
              type="range"
              min="1"
              max="30"
              value={settings.messages.inboxRetentionDays}
              onChange={(event) =>
                updateSettings({
                  messages: {
                    inboxRetentionDays: Number(event.target.value)
                  }
                })
              }
            />
            <em>{settings.messages.inboxRetentionDays} 天</em>
          </div>
          <div className="settings-row settings-row-stack">
            <span>
              <strong>最大消息数</strong>
              <small>范围 20-200 条，超过后保留最新消息。</small>
            </span>
            <input
              type="range"
              min="20"
              max="200"
              step="10"
              value={settings.messages.inboxMaxItems}
              onChange={(event) =>
                updateSettings({
                  messages: {
                    inboxMaxItems: Number(event.target.value)
                  }
                })
              }
            />
            <em>{settings.messages.inboxMaxItems} 条</em>
          </div>
          <SettingsAction
            label="打开收件箱"
            description="查看本地保存的远程消息。"
            buttonLabel="打开"
            onClick={() => void window.api.openInboxPanel()}
          />
          <SettingsAction
            label="全部已读"
            description="清空未读计数，不删除消息。"
            buttonLabel="标记"
            onClick={() => void window.api.markAllInboxRead()}
          />
        </>
      )
    }

    if (activeSection === 'appearance') {
      return (
        <>
          <SettingsToggle
            checked={settings.appearance.quoteBubbleEnabled}
            label="名言气泡"
            description="关闭后点击桌宠不显示名言，不影响远程消息和睡觉提醒。"
            onChange={(checked) =>
              updateSettings({
                appearance: {
                  quoteBubbleEnabled: checked
                }
              })
            }
          />
          <SettingsToggle
            checked={settings.appearance.unreadBadgeEnabled}
            label="未读红点"
            description="只隐藏红点，不删除收件箱和 unread.png 未读状态。"
            onChange={(checked) =>
              updateSettings({
                appearance: {
                  unreadBadgeEnabled: checked
                }
              })
            }
          />
          <SettingsAction
            label="桌宠缩放比例"
            description="V1 暂不接入，避免影响拖拽和素材尺寸。"
            buttonLabel="后续加入"
            disabled
            onClick={() => undefined}
          />
          <SettingsAction
            label="名言气泡字号"
            description="V1 暂不接入，保持现有 quote bubble 样式。"
            buttonLabel="后续加入"
            disabled
            onClick={() => undefined}
          />
        </>
      )
    }

    if (activeSection === 'system') {
      return (
        <>
          <SettingsAction
            label="打开电脑状态面板"
            description="查看 CPU、内存、GPU 和今日应用使用时间。"
            buttonLabel="打开"
            onClick={() => void window.api.openSystemStatusPanel()}
          />
          <SettingsAction
            label="打开使用时间数据文件夹"
            description="定位 app-usage.json 所在的本机目录。"
            buttonLabel="打开"
            onClick={() => void window.api.openAppUsageFolder()}
          />
          <SettingsAction
            label="应用使用时间统计开关"
            description="V1 仅展示，不改电脑状态采集逻辑。"
            buttonLabel="后续加入"
            disabled
            onClick={() => undefined}
          />
        </>
      )
    }

    return (
      <>
        <SettingsAction
          label="打开日志文件夹"
          description="打开 desktop-q-assistant 本机数据目录。"
          buttonLabel="打开"
          onClick={() => void window.api.openLogsFolder()}
        />
        <SettingsAction
          label="查看 remote-message.log"
          description="查看远程消息、离线补收和连接诊断日志。"
          buttonLabel="查看"
          onClick={() => void window.api.openRemoteMessageLog()}
        />
        <SettingsAction
          label="查看 system-status.log"
          description="查看电脑状态 helper 和 GPU 读取日志。"
          buttonLabel="查看"
          onClick={() => void window.api.openSystemStatusLog()}
        />
        <SettingsAction
          label="重置窗口位置"
          description="和基础设置中的重置位置相同。"
          buttonLabel="重置"
          onClick={() => void window.api.resetAssistantPosition()}
        />
        <SettingsAction
          label="诊断连接"
          description="V1 暂不接入远程诊断流程。"
          buttonLabel="后续加入"
          disabled
          onClick={() => undefined}
        />
        <SettingsAction
          label="重置本地收件箱"
          description="V1 暂不提供删除消息能力。"
          buttonLabel="后续加入"
          disabled
          onClick={() => undefined}
        />
      </>
    )
  }

  return (
    <main className="settings-panel">
      <aside className="settings-sidebar">
        <div className="settings-brand">
          <p>DESKTOP PET</p>
          <h1>设置中心</h1>
        </div>
        <nav aria-label="设置分类">
          {settingsSections.map((section) => (
            <button
              type="button"
              className={section.id === activeSection ? 'settings-nav-active' : ''}
              key={section.id}
              onClick={() => setActiveSection(section.id)}
            >
              <strong>{section.label}</strong>
              <span>{section.subtitle}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="settings-content">
        <header>
          <div>
            <span>
              {settingsSections.find((section) => section.id === activeSection)?.subtitle}
            </span>
            <h2>{settingsSections.find((section) => section.id === activeSection)?.label}</h2>
          </div>
          <button type="button" onClick={() => window.api.closeSettingsPanel()}>
            关闭
          </button>
        </header>
        <div className="settings-card-list">{renderSection()}</div>
      </section>
    </main>
  )
}

function PetAssistant(): React.JSX.Element {
  const { settings } = useSettingsSnapshot()
  const [mood, setMood] = useState<AssistantMood>('idle')
  const [showBubble, setShowBubble] = useState(false)
  const [bubbleContent, setBubbleContent] = useState<BubbleContent | null>(null)
  const [failedImages, setFailedImages] = useState<Partial<Record<ImageMood, boolean>>>({})
  const [clickReplayKey, setClickReplayKey] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [dragDirection, setDragDirection] = useState<DragDirection | null>(null)
  const [inboxMessages, setInboxMessages] = useState<InboxMessage[]>(() =>
    readStoredInboxMessages()
  )
  const [isInboxOpen, setIsInboxOpen] = useState(false)
  const hoverRef = useRef(false)
  const sleepReminderActiveRef = useRef(false)
  const activeBubbleKindRef = useRef<BubbleKind | null>(null)
  const lastQuoteIndexRef = useRef<number | null>(null)
  const bubbleTimerRef = useRef<number | null>(null)
  const sleepReminderTimerRef = useRef<number | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const inboxMessagesRef = useRef(inboxMessages)
  const visibleInboxMessages = useMemo(
    () => pruneInboxMessages(inboxMessages, settings),
    [inboxMessages, settings]
  )
  const unreadCount = useMemo(
    () => visibleInboxMessages.filter((message) => !message.read).length,
    [visibleInboxMessages]
  )
  const unreadBadgeLabel = unreadCount > 99 ? '99+' : String(unreadCount)

  useEffect(() => {
    inboxMessagesRef.current = inboxMessages
    writeStoredInboxMessages(inboxMessages, settings)
  }, [inboxMessages, settings])

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent): void => {
      if (event.key !== REMOTE_MESSAGE_INBOX_KEY) {
        return
      }

      const nextMessages = readStoredInboxMessages(settings)

      inboxMessagesRef.current = nextMessages
      setInboxMessages(nextMessages)
    }

    window.addEventListener('storage', handleStorageChange)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [settings])

  const clearBubbleTimer = useCallback((): void => {
    if (bubbleTimerRef.current !== null) {
      window.clearTimeout(bubbleTimerRef.current)
      bubbleTimerRef.current = null
    }
  }, [])

  const hideBubbleAfter = useCallback(
    (duration: number, bubbleKind: BubbleKind): void => {
      clearBubbleTimer()

      bubbleTimerRef.current = window.setTimeout(() => {
        if (activeBubbleKindRef.current !== bubbleKind) {
          return
        }

        setShowBubble(false)
        setBubbleContent(null)
        setMood(hoverRef.current ? 'hover' : 'idle')
        if (bubbleKind === 'sleep') {
          sleepReminderActiveRef.current = false
        }
        activeBubbleKindRef.current = null
        bubbleTimerRef.current = null
      }, duration)
    },
    [clearBubbleTimer]
  )

  const showSleepReminder = useCallback((): void => {
    const today = getLocalDateKey(new Date())

    if (activeBubbleKindRef.current === 'remote') {
      return
    }

    if (localStorage.getItem(LAST_SLEEP_REMINDER_DATE_KEY) === today) {
      return
    }

    localStorage.setItem(LAST_SLEEP_REMINDER_DATE_KEY, today)
    sleepReminderActiveRef.current = true
    activeBubbleKindRef.current = 'sleep'
    setMood('click')
    setBubbleContent({ kind: 'text', text: SLEEP_REMINDER_MESSAGE })
    setShowBubble(true)
    setClickReplayKey((current) => current + 1)
    hideBubbleAfter(SLEEP_REMINDER_DURATION_MS, 'sleep')
  }, [hideBubbleAfter])

  const showRemoteMessage = useCallback(
    (message: RemotePetMessage): void => {
      const { nextMessages, addedCount } = mergeRemoteMessagesIntoInbox(
        [message],
        inboxMessagesRef.current,
        settings
      )

      if (addedCount === 0) {
        return
      }

      const content = message.content.trim()

      inboxMessagesRef.current = nextMessages
      setInboxMessages(nextMessages)

      sleepReminderActiveRef.current = false
      activeBubbleKindRef.current = 'remote'
      setMood('click')
      setBubbleContent({ kind: 'text', text: content })
      setShowBubble(true)
      setClickReplayKey((current) => current + 1)
      hideBubbleAfter(settings.messages.remoteBubbleDurationMs, 'remote')
    },
    [hideBubbleAfter, settings]
  )

  const mergeRemoteMessageHistory = useCallback(
    (messages: RemotePetMessage[]): void => {
      const { nextMessages, addedCount } = mergeRemoteMessagesIntoInbox(
        messages,
        inboxMessagesRef.current,
        settings
      )

      inboxMessagesRef.current = nextMessages
      setInboxMessages(nextMessages)
      void window.api.reportRemoteHistoryMerge({
        fetchedCount: messages.length,
        addedCount
      })
    },
    [settings]
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        window.api.quit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      clearBubbleTimer()
      if (sleepReminderTimerRef.current !== null) {
        window.clearTimeout(sleepReminderTimerRef.current)
      }
      dragCleanupRef.current?.()
    }
  }, [clearBubbleTimer])

  useEffect(() => {
    const scheduleNextSleepReminder = (): void => {
      if (sleepReminderTimerRef.current !== null) {
        window.clearTimeout(sleepReminderTimerRef.current)
      }

      sleepReminderTimerRef.current = window.setTimeout(() => {
        showSleepReminder()
        scheduleNextSleepReminder()
      }, getMillisecondsUntilNextMidnight(new Date()))
    }

    scheduleNextSleepReminder()

    return () => {
      if (sleepReminderTimerRef.current !== null) {
        window.clearTimeout(sleepReminderTimerRef.current)
        sleepReminderTimerRef.current = null
      }
    }
  }, [showSleepReminder])

  useEffect(() => {
    return window.api.onRemoteMessage(showRemoteMessage)
  }, [showRemoteMessage])

  useEffect(() => {
    return window.api.onRemoteMessageHistory(mergeRemoteMessageHistory)
  }, [mergeRemoteMessageHistory])

  const handleMouseEnter = (): void => {
    hoverRef.current = true
    if (mood !== 'click') {
      setMood('hover')
    }
  }

  const handleMouseLeave = (): void => {
    hoverRef.current = false
    if (!dragStateRef.current) {
      setMood('idle')
      if (!activeBubbleKindRef.current) {
        setShowBubble(false)
      }
    }
  }

  const showClickBubble = (): void => {
    if (!settings.appearance.quoteBubbleEnabled) {
      return
    }

    if (activeBubbleKindRef.current === 'sleep' || activeBubbleKindRef.current === 'remote') {
      return
    }

    const { quote, index } = pickRandomQuote(lastQuoteIndexRef.current)

    lastQuoteIndexRef.current = index
    activeBubbleKindRef.current = 'quote'
    setMood('click')
    setBubbleContent({ kind: 'quote', quote })
    setShowBubble(true)
    setClickReplayKey((current) => current + 1)
    hideBubbleAfter(QUOTE_BUBBLE_DURATION_MS, 'quote')
  }

  const stopAssistantControlEvent = (event: ReactMouseEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
  }

  const openInbox = (event: ReactMouseEvent<HTMLElement>): void => {
    stopAssistantControlEvent(event)
    void window.api.openInboxPanel()
  }

  const closeInbox = (event: ReactMouseEvent<HTMLElement>): void => {
    stopAssistantControlEvent(event)
    setIsInboxOpen(false)
  }

  const markAllInboxMessagesRead = (event: ReactMouseEvent<HTMLElement>): void => {
    stopAssistantControlEvent(event)
    const nextMessages = visibleInboxMessages.map((message) => ({
      ...message,
      read: true
    }))

    inboxMessagesRef.current = nextMessages
    setInboxMessages(nextMessages)
    setMood(hoverRef.current ? 'hover' : 'idle')
  }

  useEffect(() => {
    return window.api.onInboxMarkAllRead(() => {
      const nextMessages = pruneInboxMessages(inboxMessagesRef.current, settings).map(
        (message) => ({
          ...message,
          read: true
        })
      )

      inboxMessagesRef.current = nextMessages
      setInboxMessages(nextMessages)
      setMood(hoverRef.current ? 'hover' : 'idle')
    })
  }, [settings])

  const handleMouseDown = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    dragCleanupRef.current?.()
    setDragDirection(null)

    dragStateRef.current = {
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      isDragging: false
    }

    const handleWindowMouseMove = (moveEvent: MouseEvent): void => {
      const dragState = dragStateRef.current

      if (!dragState) {
        return
      }

      const totalDeltaX = moveEvent.screenX - dragState.startX
      const totalDeltaY = moveEvent.screenY - dragState.startY
      const movedDistance = Math.hypot(totalDeltaX, totalDeltaY)

      if (!dragState.isDragging && movedDistance <= DRAG_THRESHOLD) {
        return
      }

      const deltaX = moveEvent.screenX - dragState.lastX
      const deltaY = moveEvent.screenY - dragState.lastY

      if (!dragState.isDragging) {
        setIsDragging(true)
      }

      dragState.isDragging = true
      if (!sleepReminderActiveRef.current) {
        clearBubbleTimer()
        setShowBubble(false)
        setBubbleContent(null)
        activeBubbleKindRef.current = null
      }

      if (Math.abs(deltaX) >= DRAG_DIRECTION_THRESHOLD && Math.abs(deltaX) >= Math.abs(deltaY)) {
        setDragDirection(deltaX < 0 ? 'left' : 'right')
      }

      if (deltaX !== 0 || deltaY !== 0) {
        window.api.moveWindowBy(deltaX, deltaY)
      }

      dragState.lastX = moveEvent.screenX
      dragState.lastY = moveEvent.screenY
    }

    const handleWindowMouseUp = (): void => {
      const dragState = dragStateRef.current

      dragCleanupRef.current?.()
      dragStateRef.current = null
      setIsDragging(false)
      setDragDirection(null)

      if (!dragState) {
        return
      }

      if (dragState.isDragging) {
        if (!sleepReminderActiveRef.current) {
          clearBubbleTimer()
          setShowBubble(false)
          setBubbleContent(null)
          activeBubbleKindRef.current = null
        }
        setMood(hoverRef.current ? 'hover' : 'idle')
        window.api.saveWindowPosition()
        return
      }

      showClickBubble()
    }

    dragCleanupRef.current = (): void => {
      window.removeEventListener('mousemove', handleWindowMouseMove, true)
      window.removeEventListener('mouseup', handleWindowMouseUp, true)
      dragCleanupRef.current = null
    }

    window.addEventListener('mousemove', handleWindowMouseMove, true)
    window.addEventListener('mouseup', handleWindowMouseUp, true)
  }

  const handleContextMenu = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    window.api.showContextMenu()
  }

  const handleImageError = (failedMood: ImageMood): void => {
    setFailedImages((current) => ({
      ...current,
      [failedMood]: true
    }))
  }

  const dragImageMood: ImageMood | null =
    isDragging && dragDirection ? (dragDirection === 'left' ? 'dragLeft' : 'dragRight') : null
  const normalImageMood: ImageMood = unreadCount > 0 && mood === 'idle' ? 'unread' : mood
  const imageMood = dragImageMood ?? normalImageMood
  const shouldMirrorImage = imageMood === 'dragLeft'
  const imageSource =
    imageMood === 'click'
      ? `${imageSources.click}?replay=${clickReplayKey}`
      : imageSources[imageMood]
  const shouldShowPlaceholder = failedImages[imageMood]

  return (
    <main className="assistant-shell" aria-label="桌面小助手">
      {isInboxOpen && (
        <section
          className="inbox-panel"
          aria-label="远程消息收件箱"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={stopAssistantControlEvent}
          onContextMenu={stopAssistantControlEvent}
        >
          <header className="inbox-panel-header">
            <h2>收件箱</h2>
            <button type="button" onClick={closeInbox}>
              关闭
            </button>
          </header>

          <div className="inbox-message-list">
            {visibleInboxMessages.length === 0 ? (
              <p className="inbox-empty">还没有远程消息</p>
            ) : (
              visibleInboxMessages.map((message) => (
                <article
                  className={`inbox-message${message.read ? '' : ' inbox-message-unread'}`}
                  key={message.localId}
                >
                  <div className="inbox-message-meta">
                    <span>{message.senderName}</span>
                    <time>{formatInboxTime(message.createdAt)}</time>
                  </div>
                  <p>{message.content}</p>
                  {!message.read && <span className="inbox-unread-label">未读</span>}
                </article>
              ))
            )}
          </div>

          <footer className="inbox-panel-footer">
            <button type="button" disabled={unreadCount === 0} onClick={markAllInboxMessagesRead}>
              全部已读
            </button>
          </footer>
        </section>
      )}

      <button
        className={`assistant-avatar assistant-avatar-${mood}${isDragging ? ' assistant-avatar-dragging' : ''}`}
        type="button"
        aria-label="Q版人物小助手"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
      >
        {showBubble && bubbleContent && (
          <span
            className={`speech-bubble${bubbleContent.kind === 'quote' ? ' speech-bubble-quote' : ''}`}
          >
            {bubbleContent.kind === 'quote' ? (
              <>
                <span className="quote-text">{bubbleContent.quote.text}</span>
                <span className="quote-meaning">{bubbleContent.quote.meaning}</span>
                {bubbleContent.quote.author && (
                  <span className="quote-author">- {bubbleContent.quote.author}</span>
                )}
              </>
            ) : (
              bubbleContent.text
            )}
          </span>
        )}
        {settings.appearance.unreadBadgeEnabled && unreadCount > 0 && (
          <span className="unread-badge-anchor">
            <span
              className="unread-badge"
              role="button"
              tabIndex={0}
              aria-label={`未读消息 ${unreadBadgeLabel} 条`}
              onClick={openInbox}
              onMouseDown={stopAssistantControlEvent}
              onContextMenu={stopAssistantControlEvent}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setIsInboxOpen(true)
                }
              }}
            >
              {unreadBadgeLabel}
            </span>
          </span>
        )}
        <span className="pet-breath">
          <span className={`pet-image-frame${shouldMirrorImage ? ' pet-image-frame-mirror' : ''}`}>
            {shouldShowPlaceholder ? (
              <span className={`pet-image avatar-placeholder avatar-placeholder-${imageMood}`}>
                {moodLabels[imageMood]}
              </span>
            ) : (
              <img
                className="pet-image"
                key={`${imageMood}-${clickReplayKey}`}
                src={imageSource}
                alt="Q版人物"
                draggable={false}
                onError={() => handleImageError(imageMood)}
              />
            )}
          </span>
        </span>
      </button>
    </main>
  )
}

function App(): React.JSX.Element {
  const panel = new URLSearchParams(window.location.search).get('panel')

  if (panel === 'system-status') {
    return <SystemStatusPanel />
  }

  if (panel === 'inbox') {
    return <InboxPanelWindow />
  }

  if (panel === 'settings') {
    return <SettingsPanel />
  }

  return <PetAssistant />
}

export default App
