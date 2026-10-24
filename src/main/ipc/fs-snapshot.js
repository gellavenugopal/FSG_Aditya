import { ipcMain, app } from 'electron'
import os from 'node:os'
import { query } from '../db/client.js'

// Snapshots of the finalised statements for Cloudtail MCA (DR and MCA forms). Cloudtail reads only this table for figures and
// never recalculates them; FSG Bharat is the only writer. One row per publish, versioned per Financial Year (entity_period_id):
// Cloudtail uses the highest version and tells the CA when a newer one replaces the one a filing was pinned to.
// The document (payload) is built in the renderer from the statements as printed - src/renderer/src/utils/fsSnapshot.js,
// layout: Cloudtail_MCA/docs/PLAN.md section 7.
export function registerFsSnapshotHandlers() {
  ipcMain.handle('fsSnapshot:publish', async (_, entityId, entityPeriodId, payload) => publishFsSnapshot(entityId, entityPeriodId, payload))
  ipcMain.handle('fsSnapshot:list', async (_, entityPeriodId) => listFsSnapshots(entityPeriodId))
}

export function validatePayload(p) {
  if (!p || typeof p !== 'object') throw new Error('Nothing to publish.')
  if (p.schema_version !== 1) throw new Error('Unknown snapshot layout version.')
  for (const k of ['entity', 'period', 'balance_sheet', 'profit_and_loss', 'notes', 'key_figures', 'auditor_as_printed']) {
    if (p[k] === undefined || p[k] === null) throw new Error(`The snapshot has no ${k}.`)
  }
  if (!Array.isArray(p.balance_sheet) || !p.balance_sheet.length) throw new Error('The snapshot has no Balance Sheet lines.')
  if (!Array.isArray(p.profit_and_loss) || !p.profit_and_loss.length) throw new Error('The snapshot has no Profit and Loss lines.')
  if (!p.period.date_from || !p.period.date_till) throw new Error('The snapshot has no financial year dates.')
}

export async function publishFsSnapshot(entityId, entityPeriodId, payload) {
  if (!entityId || !entityPeriodId) throw new Error('This Trial Balance is not tied to a Financial Year, so it cannot be published.')
  validatePayload(payload)
  const appVersion = (() => { try { return app.getVersion() } catch (_) { return payload.app_version || null } })()
  let who = null
  try { who = os.userInfo().username } catch (_) { who = null }
  const body = { ...payload, app_version: appVersion }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { rows: [row] } = await query(
        `INSERT INTO fs_snapshots (entity_id, entity_period_id, version, app_version, created_by, payload)
         SELECT $1, $2, COALESCE(MAX(version), 0) + 1, $3, $4, $5 FROM fs_snapshots WHERE entity_period_id = $2
         RETURNING version, created_at`,
        [entityId, entityPeriodId, appVersion, who, JSON.stringify(body)]
      )
      return { version: row.version, created_at: row.created_at, app_version: appVersion }
    } catch (e) {
      if (e && e.code === '23505' && attempt < 2) continue   // two machines published at the same moment: take the next number
      throw e
    }
  }
}

export async function listFsSnapshots(entityPeriodId) {
  if (!entityPeriodId) return []
  const { rows } = await query(
    `SELECT version, created_at, app_version, created_by FROM fs_snapshots WHERE entity_period_id = $1 ORDER BY version DESC`,
    [entityPeriodId]
  )
  return rows
}
