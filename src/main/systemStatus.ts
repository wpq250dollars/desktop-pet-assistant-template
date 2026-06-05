import { app, type BrowserWindow } from 'electron'
import { spawn, execFile } from 'child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { cpus, freemem, totalmem } from 'os'

export type SystemStatusSnapshot = {
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

type AppUsageEntry = {
  appKey: string
  appName: string
  processName: string
  seconds: number
  lastSeenAt: string
}

type AppUsageDay = {
  date: string
  apps: Record<string, AppUsageEntry>
}

type AppUsageFile = {
  version: 1
  days: Record<string, AppUsageDay>
}

type ForegroundAppInfo = {
  processName: string
  appName?: string
}

type CpuTimes = {
  idle: number
  total: number
}

const DATA_DIRECTORY_NAME = 'desktop-q-assistant'
const APP_USAGE_FILE_NAME = 'app-usage.json'
const SYSTEM_STATUS_LOG_FILE_NAME = 'system-status.log'
const USAGE_SAMPLE_INTERVAL_MS = 1000
const STATUS_PUSH_INTERVAL_MS = 1000
const APP_USAGE_SAVE_INTERVAL_MS = 10000
const GPU_USAGE_SAMPLE_INTERVAL_MS = 5000
const USAGE_HISTORY_DAYS = 7
const HELPER_RESTART_DELAY_MS = 3000
const MAX_HELPER_RESTARTS = 3
const UNKNOWN_GPU_MODEL = '未知 GPU'

const FOREGROUND_HELPER_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ForegroundWindowApi {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

while ($true) {
  try {
    $handle = [ForegroundWindowApi]::GetForegroundWindow()
    $processId = 0
    [void][ForegroundWindowApi]::GetWindowThreadProcessId($handle, [ref]$processId)
    if ($processId -gt 0) {
      $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
      if ($process) {
        [pscustomobject]@{
          processName = $process.ProcessName
          appName = $process.ProcessName
        } | ConvertTo-Json -Compress
      }
    }
  } catch {
    [pscustomobject]@{
      error = $_.Exception.Message
    } | ConvertTo-Json -Compress
  }
  Start-Sleep -Milliseconds 1000
}
`

function getDataDirectoryPath(): string {
  return join(app.getPath('appData'), DATA_DIRECTORY_NAME)
}

function getAppUsageFilePath(): string {
  return join(getDataDirectoryPath(), APP_USAGE_FILE_NAME)
}

function getSystemStatusLogFilePath(): string {
  return join(getDataDirectoryPath(), SYSTEM_STATUS_LOG_FILE_NAME)
}

function writeSystemStatusLog(event: string, details: Record<string, unknown> = {}): void {
  try {
    mkdirSync(getDataDirectoryPath(), { recursive: true })
    appendFileSync(
      getSystemStatusLogFilePath(),
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

function getLocalDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function createEmptyUsageFile(): AppUsageFile {
  return {
    version: 1,
    days: {}
  }
}

function normalizeUsageFile(value: unknown): AppUsageFile | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = value as Partial<AppUsageFile>

  if (candidate.version !== 1 || !candidate.days || typeof candidate.days !== 'object') {
    return undefined
  }

  const usageFile = createEmptyUsageFile()

  for (const [date, day] of Object.entries(candidate.days)) {
    if (!day || typeof day !== 'object') {
      continue
    }

    const dayCandidate = day as Partial<AppUsageDay>

    if (!dayCandidate.apps || typeof dayCandidate.apps !== 'object') {
      continue
    }

    usageFile.days[date] = {
      date,
      apps: {}
    }

    for (const [appKey, entry] of Object.entries(dayCandidate.apps)) {
      if (!entry || typeof entry !== 'object') {
        continue
      }

      const entryCandidate = entry as Partial<AppUsageEntry>
      const seconds = typeof entryCandidate.seconds === 'number' ? entryCandidate.seconds : 0
      const processName =
        typeof entryCandidate.processName === 'string' && entryCandidate.processName.trim()
          ? entryCandidate.processName.trim()
          : appKey
      const appName =
        typeof entryCandidate.appName === 'string' && entryCandidate.appName.trim()
          ? entryCandidate.appName.trim()
          : processName

      usageFile.days[date].apps[appKey] = {
        appKey,
        appName,
        processName,
        seconds: Math.max(0, seconds),
        lastSeenAt:
          typeof entryCandidate.lastSeenAt === 'string'
            ? entryCandidate.lastSeenAt
            : new Date().toISOString()
      }
    }
  }

  return pruneUsageFile(usageFile)
}

function pruneUsageFile(usageFile: AppUsageFile): AppUsageFile {
  const cutoffTime = Date.now() - (USAGE_HISTORY_DAYS - 1) * 24 * 60 * 60 * 1000
  const nextUsageFile = createEmptyUsageFile()

  for (const [date, day] of Object.entries(usageFile.days)) {
    const dateTime = new Date(`${date}T00:00:00`).getTime()

    if (Number.isNaN(dateTime) || dateTime < cutoffTime) {
      continue
    }

    nextUsageFile.days[date] = day
  }

  return nextUsageFile
}

function readUsageFile(): AppUsageFile {
  const filePath = getAppUsageFilePath()

  if (!existsSync(filePath)) {
    return createEmptyUsageFile()
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
    const normalized = normalizeUsageFile(parsed)

    if (normalized) {
      return normalized
    }

    writeSystemStatusLog('usage.file.invalid')
  } catch (error) {
    writeSystemStatusLog('usage.file.read_error', {
      error: formatError(error)
    })
  }

  return createEmptyUsageFile()
}

function writeUsageFile(usageFile: AppUsageFile): void {
  try {
    mkdirSync(getDataDirectoryPath(), { recursive: true })
    writeFileSync(
      getAppUsageFilePath(),
      JSON.stringify(pruneUsageFile(usageFile), null, 2),
      'utf-8'
    )
  } catch (error) {
    writeSystemStatusLog('usage.file.write_error', {
      error: formatError(error)
    })
  }
}

function getCpuTimes(): CpuTimes {
  return cpus().reduce<CpuTimes>(
    (result, cpu) => {
      const total = Object.values(cpu.times).reduce((sum, time) => sum + time, 0)

      return {
        idle: result.idle + cpu.times.idle,
        total: result.total + total
      }
    },
    { idle: 0, total: 0 }
  )
}

function calculateCpuUsage(previous: CpuTimes | null, current: CpuTimes): number | null {
  if (!previous) {
    return null
  }

  const idleDelta = current.idle - previous.idle
  const totalDelta = current.total - previous.total

  if (totalDelta <= 0) {
    return null
  }

  return Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 1000) / 10))
}

function runPowerShell(command: string, timeoutMs = 6000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message))
          return
        }

        resolve(stdout.trim())
      }
    )

    child.on('error', reject)
  })
}

async function readGpuModel(): Promise<string> {
  try {
    const output = await runPowerShell(
      '(Get-CimInstance Win32_VideoController | Where-Object { $_.Name } | Select-Object -ExpandProperty Name -First 1)',
      8000
    )

    return output || UNKNOWN_GPU_MODEL
  } catch (error) {
    writeSystemStatusLog('gpu.model.error', {
      error: formatError(error)
    })
    return UNKNOWN_GPU_MODEL
  }
}

async function readGpuUsagePercent(): Promise<number | null> {
  try {
    const output = await runPowerShell(
      "$values = (Get-Counter '\\GPU Engine(*)\\Utilization Percentage').CounterSamples | Select-Object -ExpandProperty CookedValue; if ($values) { [math]::Round(($values | Measure-Object -Sum).Sum, 1) }",
      6000
    )
    const parsedValue = Number(output)

    if (!Number.isFinite(parsedValue)) {
      return null
    }

    return Math.max(0, Math.min(100, parsedValue))
  } catch (error) {
    writeSystemStatusLog('gpu.usage.error', {
      error: formatError(error)
    })
    return null
  }
}

function normalizeForegroundAppInfo(value: unknown): ForegroundAppInfo | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = value as Partial<ForegroundAppInfo>
  const processName = candidate.processName?.trim()

  if (!processName) {
    return undefined
  }

  return {
    processName,
    appName: candidate.appName?.trim() || processName
  }
}

export function createSystemStatusService(): {
  start: () => void
  stop: () => void
  showPanelUpdatesIn: (window: BrowserWindow | null) => void
} {
  const ignoredProcessNames = new Set([
    basename(process.execPath, '.exe').toLowerCase(),
    'electron',
    '桌面小助手'
  ])
  let usageFile = readUsageFile()
  let foregroundApp: ForegroundAppInfo | null = null
  let foregroundHelper: ReturnType<typeof spawn> | null = null
  let helperRestarts = 0
  let helperBuffer = ''
  let usageTimer: NodeJS.Timeout | null = null
  let statusTimer: NodeJS.Timeout | null = null
  let saveTimer: NodeJS.Timeout | null = null
  let gpuUsageTimer: NodeJS.Timeout | null = null
  let panelWindow: BrowserWindow | null = null
  let previousCpuTimes: CpuTimes | null = null
  let lastUsageSampleTime = Date.now()
  let gpuModel = UNKNOWN_GPU_MODEL
  let gpuUsagePercent: number | null = null
  let appUsageAvailable = true
  let stopped = false

  const saveUsage = (): void => {
    usageFile = pruneUsageFile(usageFile)
    writeUsageFile(usageFile)
  }

  const startForegroundHelper = (): void => {
    if (foregroundHelper) {
      return
    }

    try {
      foregroundHelper = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', FOREGROUND_HELPER_SCRIPT],
        {
          windowsHide: true
        }
      )
      const helper = foregroundHelper
      appUsageAvailable = true
      writeSystemStatusLog('foreground.helper.start')

      helper.stdout?.setEncoding('utf-8')
      helper.stdout?.on('data', (chunk: string) => {
        helperBuffer += chunk
        const lines = helperBuffer.split(/\r?\n/)
        helperBuffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmedLine = line.trim()

          if (!trimmedLine) {
            continue
          }

          try {
            const parsedValue = JSON.parse(trimmedLine) as unknown
            const nextForegroundApp = normalizeForegroundAppInfo(parsedValue)

            if (nextForegroundApp) {
              foregroundApp = nextForegroundApp
            } else {
              writeSystemStatusLog('foreground.helper.invalid_json')
            }
          } catch (error) {
            writeSystemStatusLog('foreground.helper.invalid_json', {
              error: formatError(error)
            })
          }
        }
      })

      helper.stderr?.on('data', (chunk: Buffer) => {
        writeSystemStatusLog('foreground.helper.stderr', {
          error: chunk.toString('utf-8').trim()
        })
      })

      helper.on('error', (error) => {
        writeSystemStatusLog('foreground.helper.error', {
          error: formatError(error)
        })
        appUsageAvailable = false
      })

      helper.on('exit', (code) => {
        writeSystemStatusLog('foreground.helper.exit', {
          code
        })
        foregroundHelper = null
        foregroundApp = null
        appUsageAvailable = false

        if (!stopped && helperRestarts < MAX_HELPER_RESTARTS) {
          helperRestarts += 1
          setTimeout(startForegroundHelper, HELPER_RESTART_DELAY_MS)
        }
      })
    } catch (error) {
      writeSystemStatusLog('foreground.helper.start_error', {
        error: formatError(error)
      })
      appUsageAvailable = false
    }
  }

  const recordUsageSample = (): void => {
    const now = Date.now()
    const elapsedSeconds = Math.max(0, (now - lastUsageSampleTime) / 1000)
    lastUsageSampleTime = now

    if (!foregroundApp || elapsedSeconds <= 0) {
      return
    }

    const processName = foregroundApp.processName.trim()
    const appName = foregroundApp.appName?.trim() || processName
    const appKey = processName.toLowerCase()

    if (!appKey || ignoredProcessNames.has(appKey)) {
      return
    }

    const today = getLocalDateKey(new Date())
    const todayUsage = usageFile.days[today] ?? {
      date: today,
      apps: {}
    }
    const entry = todayUsage.apps[appKey] ?? {
      appKey,
      appName,
      processName,
      seconds: 0,
      lastSeenAt: new Date(now).toISOString()
    }

    entry.appName = appName
    entry.processName = processName
    entry.seconds += elapsedSeconds
    entry.lastSeenAt = new Date(now).toISOString()
    todayUsage.apps[appKey] = entry
    usageFile.days[today] = todayUsage
    usageFile = pruneUsageFile(usageFile)
  }

  const getTodayUsage = (): SystemStatusSnapshot['todayUsage'] => {
    const today = getLocalDateKey(new Date())

    return Object.values(usageFile.days[today]?.apps ?? {})
      .sort((first, second) => second.seconds - first.seconds)
      .slice(0, 10)
      .map((entry) => ({
        ...entry,
        seconds: Math.round(entry.seconds)
      }))
  }

  const createSnapshot = (): SystemStatusSnapshot => {
    const currentCpuTimes = getCpuTimes()
    const cpuUsagePercent = calculateCpuUsage(previousCpuTimes, currentCpuTimes)
    previousCpuTimes = currentCpuTimes
    const freeMemory = freemem()
    const totalMemory = totalmem()
    const usedMemory = Math.max(0, totalMemory - freeMemory)

    return {
      cpuUsagePercent,
      memory: {
        totalBytes: totalMemory,
        usedBytes: usedMemory,
        freeBytes: freeMemory,
        usedPercent: totalMemory > 0 ? Math.round((usedMemory / totalMemory) * 1000) / 10 : 0
      },
      gpu: {
        model: gpuModel,
        usagePercent: gpuUsagePercent
      },
      appUsageAvailable,
      todayUsage: getTodayUsage()
    }
  }

  const pushSnapshot = (): void => {
    if (!panelWindow || panelWindow.isDestroyed()) {
      return
    }

    panelWindow.webContents.send('system-status:update', createSnapshot())
  }

  const startStatusPush = (): void => {
    if (statusTimer) {
      return
    }

    previousCpuTimes = getCpuTimes()
    sampleGpuUsage()
    gpuUsageTimer = setInterval(sampleGpuUsage, GPU_USAGE_SAMPLE_INTERVAL_MS)
    pushSnapshot()
    statusTimer = setInterval(pushSnapshot, STATUS_PUSH_INTERVAL_MS)
  }

  const stopStatusPush = (): void => {
    if (statusTimer) {
      clearInterval(statusTimer)
      statusTimer = null
    }

    if (gpuUsageTimer) {
      clearInterval(gpuUsageTimer)
      gpuUsageTimer = null
    }
  }

  const sampleGpuUsage = (): void => {
    void readGpuUsagePercent().then((usagePercent) => {
      gpuUsagePercent = usagePercent
    })
  }

  return {
    start: () => {
      stopped = false
      startForegroundHelper()
      void readGpuModel().then((model) => {
        gpuModel = model
      })

      if (!usageTimer) {
        usageTimer = setInterval(recordUsageSample, USAGE_SAMPLE_INTERVAL_MS)
      }

      if (!saveTimer) {
        saveTimer = setInterval(saveUsage, APP_USAGE_SAVE_INTERVAL_MS)
      }
    },
    stop: () => {
      stopped = true
      stopStatusPush()

      if (usageTimer) {
        clearInterval(usageTimer)
        usageTimer = null
      }

      if (saveTimer) {
        clearInterval(saveTimer)
        saveTimer = null
      }

      foregroundHelper?.kill()
      foregroundHelper = null
      saveUsage()
    },
    showPanelUpdatesIn: (window) => {
      panelWindow = window

      if (panelWindow) {
        startStatusPush()
        panelWindow.on('closed', () => {
          if (panelWindow === window) {
            panelWindow = null
            stopStatusPush()
          }
        })
        return
      }

      stopStatusPush()
    }
  }
}
