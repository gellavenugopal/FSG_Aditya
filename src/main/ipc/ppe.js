import { ipcMain } from 'electron'
import { query } from '../db/client.js'
import { fetchFixedAssetsWithDetails } from '../services/tally-ppe.js'

export function registerPPEHandlers() {
  ipcMain.handle('getPPELedgers', async (_, entityId, entityPeriodId) => getPPELedgers(entityId, entityPeriodId))
  ipcMain.handle('savePPELedgers', async (_, entityId, entityPeriodId, ledgers) => savePPELedgers(entityId, entityPeriodId, ledgers))
  ipcMain.handle('deletePPELedger', async (_, id) => deletePPELedger(id))
  ipcMain.handle('importPPEFromTally', async (_, company, host, port) => importPPEFromTally(company, host, port))
}

export async function getPPELedgers(entityId, entityPeriodId) {
  const { rows } = await query(
    `SELECT * FROM ppe_ledgers WHERE entity_id = $1 AND entity_period_id = $2 ORDER BY ledger_group, ledger_name`,
    [entityId, entityPeriodId]
  )
  return rows
}

export async function savePPELedgers(entityId, entityPeriodId, ledgers) {
  if (!Array.isArray(ledgers) || ledgers.length === 0) {
    return []
  }

  const savedLedgers = []

  for (const ledger of ledgers) {
    const { ledger_name, ledger_group, opening_balance, additions_debit, credits, closing_balance } = ledger

    const { rows } = await query(
      `INSERT INTO ppe_ledgers (entity_id, entity_period_id, ledger_name, ledger_group, opening_balance, additions_debit, credits, closing_balance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT(entity_id, entity_period_id, ledger_name) DO UPDATE SET
         ledger_group = EXCLUDED.ledger_group,
         opening_balance = EXCLUDED.opening_balance,
         additions_debit = EXCLUDED.additions_debit,
         credits = EXCLUDED.credits,
         closing_balance = EXCLUDED.closing_balance,
         updated_at = now()
       RETURNING *`,
      [entityId, entityPeriodId, ledger_name, ledger_group, opening_balance || 0, additions_debit || 0, credits || 0, closing_balance || 0]
    )

    if (rows.length > 0) {
      savedLedgers.push(rows[0])
    }
  }

  return savedLedgers
}

export async function deletePPELedger(id) {
  await query(`DELETE FROM ppe_ledgers WHERE id = $1`, [id])
  return true
}

export async function importPPEFromTally(company, host = 'localhost', port = 9000) {
  try {
    const ledgers = await fetchFixedAssetsWithDetails(company, host, port)
    return {
      success: true,
      ledgers: ledgers,
      count: ledgers.length,
    }
  } catch (err) {
    return {
      success: false,
      error: err.message,
      ledgers: [],
    }
  }
}
