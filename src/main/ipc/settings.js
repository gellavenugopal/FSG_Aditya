import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { loadConfig, saveConfig, initDB, query, testConnectionWith, withStartupLock } from '../db/client.js'
import { ensureSchema } from '../db/schema.js'
import { seedDefaultMapping, ensureStockCategories } from '../services/excel.js'
import { exportTablesToFiles } from '../services/dbExport.js'
import { applyMappingPatches } from './mapping.js'

const tallyConfigPath = () => join(app.getPath('userData'), 'tally-config.json')

// Prescribed Format Reference — bundled static HTML, same dev/prod
// resolution pattern as excel.js's findMappingFile().
function findFormatReferenceFile() {
  const candidates = [
    join(process.resourcesPath || '', 'Prescribed_Format_Reference.html'), // packaged app
    join(process.cwd(), 'Prescribed_Format_Reference.html'),               // dev mode
    join(app?.getAppPath?.() || '', 'Prescribed_Format_Reference.html'),   // fallback
  ]
  return candidates.find(p => existsSync(p)) || candidates[1]
}

function readTallyConfig() {
  try {
    if (existsSync(tallyConfigPath())) {
      return JSON.parse(readFileSync(tallyConfigPath(), 'utf8'))
    }
  } catch (_) {}
  return { host: 'localhost', port: 9000 }
}

function writeTallyConfig(cfg) {
  writeFileSync(tallyConfigPath(), JSON.stringify(cfg, null, 2), 'utf8')
}

export function registerSettingsHandlers() {
  ipcMain.handle('settings:get', () => {
    return loadConfig()
  })

  ipcMain.handle('settings:save', async (_, cfg) => {
    try {
      await initDB(cfg)
      await withStartupLock(async () => {
        await ensureSchema()
        await seedDefaultMapping()
        await ensureStockCategories()
        await applyMappingPatches()
      })
      saveConfig(cfg)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('settings:testConnection', async (_, cfg) => {
    return testConnectionWith(cfg)
  })

  ipcMain.handle('dialog:openFile', async (_, opts) => {
    const result = await dialog.showOpenDialog(opts || {})
    return result
  })

  ipcMain.handle('dialog:saveFile', async (_, opts) => {
    const result = await dialog.showSaveDialog(opts || {})
    return result
  })

  ipcMain.handle('file:write', async (_, filePath, bufferArray) => {
    writeFileSync(filePath, Buffer.from(bufferArray))
    return true
  })

  ipcMain.handle('file:read', async (_, filePath) => {
    return Array.from(readFileSync(filePath))
  })

  // ── Export every DB table's raw data (one sheet per table) ─────────────────
  // Asks for the file, then reads the tables a page at a time and writes the workbook
  // right here — see services/dbExport.js for why the file never travels through IPC
  // as an array (that was "Export failed: Invalid array length" on a large database).
  ipcMain.handle('db:exportAllTablesToFile', async (event, { defaultPath } = {}) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const pick = await dialog.showSaveDialog(win, {
        defaultPath: defaultPath || 'FSG_Bharat_Database_Export.xlsx',
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      })
      if (pick.canceled || !pick.filePath) return { ok: true, canceled: true }
      const { rows: tables } = await query(
        `SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
      )
      const quote = (n) => `"${String(n).replace(/"/g, '""')}"`
      const result = await exportTablesToFiles({
        filePath: pick.filePath,
        tables: tables.map(t => t.name),
        fetchPage: async (table, offset, limit) =>
          (await query(`SELECT * FROM ${quote(table)} ORDER BY ctid LIMIT $1 OFFSET $2`, [limit, offset])).rows,
      })
      return { ok: true, ...result }
    } catch (err) {
      return { ok: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('format:getReference', () => {
    try {
      return { ok: true, html: readFileSync(findFormatReferenceFile(), 'utf8') }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('tally:getConfig', () => readTallyConfig())

  ipcMain.handle('tally:saveConfig', (_, cfg) => {
    writeTallyConfig({ host: cfg.host || 'localhost', port: cfg.port || 9000 })
    return { ok: true }
  })
}
