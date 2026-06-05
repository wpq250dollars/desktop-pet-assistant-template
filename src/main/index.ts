import { app, shell, BrowserWindow, ipcMain, Menu, screen, Tray } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { logRemoteMessageHistoryMerge, startRemoteMessageListener } from './remoteMessages'
import {
  getAppDataDirectoryPath,
  readAppSettings,
  updateAppSettings,
  type AppSettingsPatch
} from './settings'
import { createSystemStatusService } from './systemStatus'

const WINDOW_WIDTH = 280
const WINDOW_HEIGHT = 330
const STATUS_PANEL_WIDTH = 320
const STATUS_PANEL_HEIGHT = 380
const STATUS_PANEL_MIN_WIDTH = 300
const STATUS_PANEL_MIN_HEIGHT = 320
const INBOX_PANEL_WIDTH = 360
const INBOX_PANEL_HEIGHT = 460
const INBOX_PANEL_MIN_WIDTH = 300
const INBOX_PANEL_MIN_HEIGHT = 340
const SETTINGS_PANEL_WIDTH = 520
const SETTINGS_PANEL_HEIGHT = 620
const SETTINGS_PANEL_MIN_WIDTH = 420
const SETTINGS_PANEL_MIN_HEIGHT = 480
const TRAY_ICON_FILE_NAME = 'icon.ico'

let mainWindow: BrowserWindow | null = null
let systemStatusWindow: BrowserWindow | null = null
let inboxWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let tray: Tray | null = null
let remoteMessageListener: ReturnType<typeof startRemoteMessageListener> = null
const systemStatusService = createSystemStatusService()

type SavedWindowPosition = {
  x: number
  y: number
}

function getSettingsSnapshot(): {
  settings: ReturnType<typeof readAppSettings>
  openAtLogin: boolean
} {
  return {
    settings: readAppSettings(),
    openAtLogin: isOpenAtLoginEnabled()
  }
}

function sendSettingsChanged(): void {
  const snapshot = getSettingsSnapshot()

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('settings:changed', snapshot)
    }
  }
}

function applyAlwaysOnTopSetting(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(readAppSettings().general.alwaysOnTop)
  }
}

function openPathOrFolder(path: string): void {
  if (existsSync(path)) {
    void shell.openPath(path)
    return
  }

  void shell.openPath(getAppDataDirectoryPath())
}

function getWindowPositionFilePath(): string {
  return join(app.getPath('userData'), 'window-position.json')
}

function readSavedWindowPosition(): SavedWindowPosition | undefined {
  const filePath = getWindowPositionFilePath()

  if (!existsSync(filePath)) {
    return undefined
  }

  try {
    const savedPosition = JSON.parse(
      readFileSync(filePath, 'utf-8')
    ) as Partial<SavedWindowPosition>

    if (typeof savedPosition.x === 'number' && typeof savedPosition.y === 'number') {
      return {
        x: Math.round(savedPosition.x),
        y: Math.round(savedPosition.y)
      }
    }
  } catch {
    return undefined
  }

  return undefined
}

function saveWindowPosition(window: BrowserWindow): void {
  const [x, y] = window.getPosition()
  writeFileSync(getWindowPositionFilePath(), JSON.stringify({ x, y }, null, 2), 'utf-8')
}

function getDefaultWindowPosition(): SavedWindowPosition {
  const { workArea } = screen.getPrimaryDisplay()

  return {
    x: workArea.x + workArea.width - WINDOW_WIDTH - 32,
    y: workArea.y + workArea.height - WINDOW_HEIGHT - 48
  }
}

function isWindowPositionVisible(position: SavedWindowPosition): boolean {
  const right = position.x + WINDOW_WIDTH
  const bottom = position.y + WINDOW_HEIGHT

  return screen.getAllDisplays().some(({ workArea }) => {
    const workAreaRight = workArea.x + workArea.width
    const workAreaBottom = workArea.y + workArea.height

    return (
      position.x >= workArea.x &&
      right <= workAreaRight &&
      position.y >= workArea.y &&
      bottom <= workAreaBottom
    )
  })
}

function getSafeWindowPosition(position: SavedWindowPosition | undefined): SavedWindowPosition {
  if (position && isWindowPositionVisible(position)) {
    return position
  }

  return getDefaultWindowPosition()
}

function ensureWindowInVisibleWorkArea(window: BrowserWindow): void {
  const [x, y] = window.getPosition()

  if (!isWindowPositionVisible({ x, y })) {
    resetWindowPosition(window)
  }
}

function resetWindowPosition(window: BrowserWindow): void {
  const position = getDefaultWindowPosition()
  window.setPosition(position.x, position.y)
  saveWindowPosition(window)
}

function getSafePanelPosition(
  anchorWindow: BrowserWindow,
  panelWidth: number,
  panelHeight: number
): SavedWindowPosition {
  const anchorBounds = anchorWindow.getBounds()
  const { workArea } = screen.getDisplayMatching(anchorBounds)
  let x = anchorBounds.x + anchorBounds.width + 8
  let y = anchorBounds.y

  if (x + panelWidth > workArea.x + workArea.width) {
    x = anchorBounds.x - panelWidth - 8
  }

  if (x < workArea.x) {
    x = workArea.x + workArea.width - panelWidth - 16
  }

  if (y + panelHeight > workArea.y + workArea.height) {
    y = workArea.y + workArea.height - panelHeight - 16
  }

  if (y < workArea.y) {
    y = workArea.y + 16
  }

  return {
    x: Math.round(x),
    y: Math.round(y)
  }
}

function getLoginItemOptions(): Electron.LoginItemSettingsOptions {
  if (process.defaultApp) {
    return {
      path: process.execPath,
      args: [app.getAppPath()]
    }
  }

  return {}
}

function isOpenAtLoginEnabled(): boolean {
  return app.getLoginItemSettings(getLoginItemOptions()).openAtLogin
}

function setOpenAtLogin(enabled: boolean): void {
  app.setLoginItemSettings({
    ...getLoginItemOptions(),
    openAtLogin: enabled
  })
}

function showAssistantWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }

  ensureWindowInVisibleWorkArea(mainWindow)
  mainWindow.show()
  applyAlwaysOnTopSetting()
  mainWindow.focus()
}

function hideAssistantWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide()
  }
}

function toggleAssistantWindow(): void {
  if (mainWindow?.isVisible()) {
    hideAssistantWindow()
  } else {
    showAssistantWindow()
  }
}

function getTrayIconPath(): string {
  const packagedIconPath = join(process.resourcesPath, TRAY_ICON_FILE_NAME)
  const developmentIconPath = join(process.cwd(), 'build', TRAY_ICON_FILE_NAME)

  if (!is.dev && existsSync(packagedIconPath)) {
    return packagedIconPath
  }

  if (existsSync(developmentIconPath)) {
    return developmentIconPath
  }

  return icon
}

function buildTrayMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    {
      label: '显示桌宠',
      click: () => showAssistantWindow()
    },
    {
      label: '隐藏桌宠',
      click: () => hideAssistantWindow()
    },
    {
      label: '重置位置',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          createWindow()
          return
        }

        resetWindowPosition(mainWindow)
        showAssistantWindow()
      }
    },
    {
      type: 'separator'
    },
    {
      label: '退出',
      click: () => app.quit()
    }
  ])
}

function createTray(): void {
  if (tray) {
    return
  }

  tray = new Tray(getTrayIconPath())
  tray.setToolTip('桌面小助手')
  tray.setContextMenu(buildTrayMenu())
  tray.on('right-click', () => {
    tray?.popUpContextMenu(buildTrayMenu())
  })
  tray.on('double-click', () => toggleAssistantWindow())
}

function showAssistantMenu(window: BrowserWindow): void {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '设置',
      click: () => showSettingsWindow(window)
    },
    {
      label: '打开收件箱',
      click: () => showInboxWindow(window)
    },
    {
      label: '电脑状态',
      click: () => showSystemStatusWindow(window)
    },
    {
      type: 'separator'
    },
    {
      label: '退出',
      click: () => app.quit()
    }
  ])

  contextMenu.popup({ window })
}

function showSystemStatusWindow(anchorWindow: BrowserWindow): void {
  if (systemStatusWindow && !systemStatusWindow.isDestroyed()) {
    const position = getSafePanelPosition(anchorWindow, STATUS_PANEL_WIDTH, STATUS_PANEL_HEIGHT)

    systemStatusWindow.setPosition(position.x, position.y)
    systemStatusWindow.show()
    systemStatusWindow.focus()
    return
  }

  const position = getSafePanelPosition(anchorWindow, STATUS_PANEL_WIDTH, STATUS_PANEL_HEIGHT)
  systemStatusWindow = new BrowserWindow({
    width: STATUS_PANEL_WIDTH,
    height: STATUS_PANEL_HEIGHT,
    minWidth: STATUS_PANEL_MIN_WIDTH,
    minHeight: STATUS_PANEL_MIN_HEIGHT,
    ...position,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  systemStatusWindow.on('ready-to-show', () => {
    if (!systemStatusWindow || systemStatusWindow.isDestroyed()) {
      return
    }

    systemStatusWindow.show()
    systemStatusWindow.focus()
  })

  systemStatusWindow.on('closed', () => {
    systemStatusService.showPanelUpdatesIn(null)
    systemStatusWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    systemStatusWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?panel=system-status`)
  } else {
    systemStatusWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: {
        panel: 'system-status'
      }
    })
  }

  systemStatusService.showPanelUpdatesIn(systemStatusWindow)
}

function showInboxWindow(anchorWindow: BrowserWindow): void {
  if (inboxWindow && !inboxWindow.isDestroyed()) {
    const position = getSafePanelPosition(anchorWindow, INBOX_PANEL_WIDTH, INBOX_PANEL_HEIGHT)

    inboxWindow.setPosition(position.x, position.y)
    inboxWindow.show()
    inboxWindow.focus()
    return
  }

  const position = getSafePanelPosition(anchorWindow, INBOX_PANEL_WIDTH, INBOX_PANEL_HEIGHT)
  inboxWindow = new BrowserWindow({
    width: INBOX_PANEL_WIDTH,
    height: INBOX_PANEL_HEIGHT,
    minWidth: INBOX_PANEL_MIN_WIDTH,
    minHeight: INBOX_PANEL_MIN_HEIGHT,
    ...position,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  inboxWindow.on('ready-to-show', () => {
    if (!inboxWindow || inboxWindow.isDestroyed()) {
      return
    }

    inboxWindow.show()
    inboxWindow.focus()
  })

  inboxWindow.on('closed', () => {
    inboxWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    inboxWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?panel=inbox`)
  } else {
    inboxWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: {
        panel: 'inbox'
      }
    })
  }
}

function showSettingsWindow(anchorWindow: BrowserWindow): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    const position = getSafePanelPosition(anchorWindow, SETTINGS_PANEL_WIDTH, SETTINGS_PANEL_HEIGHT)

    settingsWindow.setPosition(position.x, position.y)
    settingsWindow.show()
    settingsWindow.focus()
    sendSettingsChanged()
    return
  }

  const position = getSafePanelPosition(anchorWindow, SETTINGS_PANEL_WIDTH, SETTINGS_PANEL_HEIGHT)
  settingsWindow = new BrowserWindow({
    width: SETTINGS_PANEL_WIDTH,
    height: SETTINGS_PANEL_HEIGHT,
    minWidth: SETTINGS_PANEL_MIN_WIDTH,
    minHeight: SETTINGS_PANEL_MIN_HEIGHT,
    ...position,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  settingsWindow.on('ready-to-show', () => {
    if (!settingsWindow || settingsWindow.isDestroyed()) {
      return
    }

    settingsWindow.show()
    settingsWindow.focus()
    sendSettingsChanged()
  })

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    settingsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?panel=settings`)
  } else {
    settingsWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: {
        panel: 'settings'
      }
    })
  }
}

function createWindow(): void {
  const savedPosition = getSafeWindowPosition(readSavedWindowPosition())
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    ...savedPosition,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: readAppSettings().general.alwaysOnTop,
    resizable: false,
    hasShadow: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      ensureWindowInVisibleWorkArea(mainWindow)
      applyAlwaysOnTopSetting()
      mainWindow.show()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createTray()
  createWindow()
  systemStatusService.start()
  remoteMessageListener = startRemoteMessageListener({
    getWindow: () => mainWindow,
    showWindow: showAssistantWindow
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  void remoteMessageListener?.stop()
  remoteMessageListener = null
  systemStatusService.stop()
  tray?.destroy()
  tray = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.handle('app:quit', () => {
  app.quit()
})

ipcMain.handle('window:move-by', (event, deltaX: number, deltaY: number) => {
  const currentWindow = BrowserWindow.fromWebContents(event.sender)

  if (!currentWindow) {
    return
  }

  const [windowX, windowY] = currentWindow.getPosition()
  currentWindow.setPosition(windowX + Math.round(deltaX), windowY + Math.round(deltaY))
})

ipcMain.handle('window:save-position', (event) => {
  const currentWindow = BrowserWindow.fromWebContents(event.sender)

  if (!currentWindow) {
    return
  }

  saveWindowPosition(currentWindow)
})

ipcMain.handle('window:show-context-menu', (event) => {
  const currentWindow = BrowserWindow.fromWebContents(event.sender)

  if (!currentWindow) {
    return
  }

  showAssistantMenu(currentWindow)
})

ipcMain.handle('system-status:close-panel', (event) => {
  const currentWindow = BrowserWindow.fromWebContents(event.sender)

  if (currentWindow && currentWindow === systemStatusWindow) {
    currentWindow.close()
  }
})

ipcMain.handle('system-status:open-panel', (event) => {
  const currentWindow = BrowserWindow.fromWebContents(event.sender)

  if (currentWindow) {
    showSystemStatusWindow(currentWindow)
  }
})

ipcMain.handle('inbox:open-panel', (event) => {
  const currentWindow = BrowserWindow.fromWebContents(event.sender)

  if (currentWindow) {
    showInboxWindow(currentWindow)
  }
})

ipcMain.handle('inbox:close-panel', (event) => {
  const currentWindow = BrowserWindow.fromWebContents(event.sender)

  if (currentWindow && currentWindow === inboxWindow) {
    currentWindow.close()
  }
})

ipcMain.handle('settings:get-snapshot', () => getSettingsSnapshot())

ipcMain.handle('settings:update', (_event, patch: AppSettingsPatch) => {
  const settings = updateAppSettings(patch)

  applyAlwaysOnTopSetting()
  sendSettingsChanged()
  return {
    settings,
    openAtLogin: isOpenAtLoginEnabled()
  }
})

ipcMain.handle('settings:close-panel', (event) => {
  const currentWindow = BrowserWindow.fromWebContents(event.sender)

  if (currentWindow && currentWindow === settingsWindow) {
    currentWindow.close()
  }
})

ipcMain.handle('settings:get-open-at-login', () => isOpenAtLoginEnabled())

ipcMain.handle('settings:set-open-at-login', (_event, enabled: boolean) => {
  setOpenAtLogin(Boolean(enabled))
  sendSettingsChanged()
  return isOpenAtLoginEnabled()
})

ipcMain.handle('settings:set-always-on-top', (_event, enabled: boolean) => {
  const settings = updateAppSettings({
    general: {
      alwaysOnTop: Boolean(enabled)
    }
  })

  applyAlwaysOnTopSetting()
  sendSettingsChanged()
  return settings.general.alwaysOnTop
})

ipcMain.handle('settings:reset-assistant-position', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }

  resetWindowPosition(mainWindow)
  showAssistantWindow()
})

ipcMain.handle('settings:mark-all-inbox-read', () => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('inbox:mark-all-read')
    }
  }
})

ipcMain.handle('settings:open-logs-folder', () => {
  openPathOrFolder(getAppDataDirectoryPath())
})

ipcMain.handle('settings:open-remote-message-log', () => {
  openPathOrFolder(join(getAppDataDirectoryPath(), 'remote-message.log'))
})

ipcMain.handle('settings:open-system-status-log', () => {
  openPathOrFolder(join(getAppDataDirectoryPath(), 'system-status.log'))
})

ipcMain.handle('settings:open-app-usage-folder', () => {
  openPathOrFolder(getAppDataDirectoryPath())
})

ipcMain.handle(
  'remote-message:history-merge-result',
  (_event, result: { fetchedCount?: number; addedCount?: number }) => {
    logRemoteMessageHistoryMerge(result)
  }
)
