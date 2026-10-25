import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron'
import { join } from 'path'
import { initDB, loadConfig, flushDB, withStartupLock } from './db/client.js'
import { ensureSchema } from './db/schema.js'
import { seedDefaultMapping, ensureStockCategories } from './services/excel.js'
import { migrateMappingV3Captions, migrateMappingV3CaptionsPass2 } from './db/mapping-v3-migration.js'
import { registerTBHandlers } from './ipc/tb.js'
import { registerMappingHandlers, applyMappingPatches } from './ipc/mapping.js'
import { registerMappedTBHandlers } from './ipc/mapped-tb.js'
import { registerSettingsHandlers } from './ipc/settings.js'
import { registerFinancialHandlers } from './ipc/financials.js'
import { registerMastersHandlers } from './ipc/masters.js'
import { registerDepreciationHandlers } from './ipc/depreciation.js'
import { registerNotesHandlers } from './ipc/notes.js'
import { registerFinancialPeriodHandlers } from './ipc/financial-periods.js'
import { registerForm3CDHandlers } from './ipc/form-3cd.js'
import { registerPPEHandlers } from './ipc/ppe.js'
import { registerRatioHandlers } from './ipc/ratio.js'
import { registerGeneralNotesHandlers } from './ipc/general-notes.js'
import { registerCfsHandlers } from './ipc/cfs.js'
import { registerFsSnapshotHandlers } from './ipc/fs-snapshot.js'
import { registerEngagementClientHandlers } from './ipc/engagement-client.js'
import { startLocalEngagementService } from '../server/dev-engagement-service.js'
import { guardScreen } from './screen-guard.js'

let mainWindow
let localEngagementService = null
let closingLocalEngagementService = false
const engagementClientOptions = {}
const appWindows = new Set()   // every open window of the app (more than one is allowed)

// More than one window: every window is the whole app, on the same database. A window opened with "New window" is told (in the page
// address) the client, Financial Year, Trial Balance and tab it was opened from - see App.jsx (POPOUT).
async function createWindow(popoutPayload = null, fromWindow = null) {
  let pos = {}
  if (fromWindow && !fromWindow.isDestroyed()) {
    const b = fromWindow.getBounds()
    pos = { x: b.x + 32, y: b.y + 32, width: b.width, height: b.height }
  }
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    ...pos,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'FSG Bharat — Financial Statement Generator',
    backgroundColor: '#ffffff'
  })

  // A screen that dies or hangs is announced and reloaded, never left as a blank white window (screen-guard.js).
  guardScreen(win, { dialog, logFile: join(app.getPath('userData'), 'screen-problems.log') })
  if (!popoutPayload) mainWindow = win
  appWindows.add(win)
  win.on('closed', () => appWindows.delete(win))

  // Always reset zoom to 1.0 so Ctrl+- from a previous session doesn't persist
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(1.0)
  })

  const hash = popoutPayload ? `popout=${encodeURIComponent(JSON.stringify(popoutPayload))}` : ''
  if (process.env.NODE_ENV === 'development') {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + (hash ? `#${hash}` : ''))
    // win.webContents.openDevTools()
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
  return win
}

app.whenReady().then(async () => {
  let legacyDatabaseReady = false
  try {
    await initDB()
    legacyDatabaseReady = true
    // Serialize one-time/shared schema+seed setup across every Electron
    // client connected to this Postgres DB — otherwise 15 PCs launching
    // around the same time would race each other through table creation
    // and the default-mapping reseed. See db/client.js's withStartupLock().
    await withStartupLock(async () => {
      await ensureSchema()
      await seedDefaultMapping()
      await ensureStockCategories()
      await migrateMappingV3Captions()
      await migrateMappingV3CaptionsPass2()
      await applyMappingPatches()
    })
  } catch (err) {
    console.error('DB init error:', err.message)
    // Allow app to open even if DB not configured/reachable yet — the
    // renderer's own getSettings()/testConnection() check (App.jsx) will
    // show the Settings modal for the user to enter connection details.
  }

  if (!process.env.ENGAGEMENT_SERVICE_URL && !app.isPackaged && process.env.NODE_ENV === 'development') {
    try {
      localEngagementService = await startLocalEngagementService(loadConfig())
      Object.assign(engagementClientOptions, localEngagementService.clientOptions)
      console.info('Local development engagement service started on localhost.')
    } catch (err) {
      const databaseHint = legacyDatabaseReady ? '' : ' Check that the local PostgreSQL connection is configured in Settings.'
      engagementClientOptions.startupError = `Could not start the local engagement service: ${err.message}${databaseHint}`
      engagementClientOptions.localDevelopment = true
      console.error(engagementClientOptions.startupError)
    }
  }

  registerTBHandlers()
  registerMappingHandlers()
  registerMappedTBHandlers()
  registerSettingsHandlers()
  ipcMain.handle('engagementService:localSetupAvailable', () => (
    !process.env.ENGAGEMENT_SERVICE_URL && !app.isPackaged && process.env.NODE_ENV === 'development'
  ))
  ipcMain.handle('engagementService:restartLocal', async () => {
    if (process.env.ENGAGEMENT_SERVICE_URL || app.isPackaged || process.env.NODE_ENV !== 'development') {
      throw new Error('Local engagement service setup is only available in an unconfigured development build.')
    }
    if (localEngagementService) {
      await localEngagementService.close()
      localEngagementService = null
    }
    try {
      localEngagementService = await startLocalEngagementService(loadConfig())
      Object.assign(engagementClientOptions, localEngagementService.clientOptions)
      delete engagementClientOptions.startupError
      console.info('Local development engagement service started on localhost.')
      return true
    } catch (error) {
      engagementClientOptions.startupError = `Could not start the local engagement service: ${error.message}`
      throw error
    }
  })
  registerFinancialHandlers()
  registerMastersHandlers()
  registerDepreciationHandlers()
  registerNotesHandlers()
  registerFinancialPeriodHandlers()
  registerForm3CDHandlers()
  registerPPEHandlers()
  registerRatioHandlers()
  registerGeneralNotesHandlers()
  registerCfsHandlers()
  registerFsSnapshotHandlers()
  registerEngagementClientHandlers(ipcMain, engagementClientOptions)
  // The running exe's own version (package.json at build time), shown beside
  // the app name so it's obvious which build a server or client PC is on.
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:quit', () => app.quit())

  // "New window": another window of the app, opened where this one is (client, Financial Year, Trial Balance, tab)
  ipcMain.handle('window:openNew', async (e, payload) => {
    const clean = {}
    for (const k of ['tab', 'entityId', 'entityPeriodId', 'tbId', 'prevTbId', 'fsMode', 'selectedBranchTBId', 'rsId']) {
      const v = payload && payload[k]
      if (typeof v === 'string' || typeof v === 'number' || v === null) clean[k] = v
    }
    await createWindow(clean, BrowserWindow.fromWebContents(e.sender))
    return true
  })
  // Something was saved in one window: tell the others, so they can offer a refresh (App.jsx)
  ipcMain.on('data:changed', (e, info) => {
    for (const w of appWindows) {
      if (w.isDestroyed() || w.webContents.id === e.sender.id) continue
      w.webContents.send('data:changed', { channel: String((info && info.channel) || '') })
    }
  })

  await createWindow()

  // Remove default application menu (File, Edit, View, etc.)
  Menu.setApplicationMenu(null)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (event) => {
  flushDB()
  if (!localEngagementService || closingLocalEngagementService) return
  event.preventDefault()
  closingLocalEngagementService = true
  const service = localEngagementService
  localEngagementService = null
  service.close().catch(err => {
    console.error('Local engagement service shutdown failed:', err)
  }).finally(() => app.quit())
})

// Belt-and-suspenders durability: flush on window-all-closed (fires before
// 'before-quit' on most platforms) and on graceful termination signals, so
// an abrupt dev-server restart or forced close doesn't lose the last write.
// Can't defend against a hard SIGKILL, but covers the far more common cases.
app.on('window-all-closed', () => {
  flushDB()
  if (process.platform !== 'darwin') app.quit()
})

process.on('SIGINT', () => { flushDB(); process.exit(0) })
process.on('SIGTERM', () => { flushDB(); process.exit(0) })
