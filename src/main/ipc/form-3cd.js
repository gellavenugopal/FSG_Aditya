import { ipcMain } from 'electron'
import { query } from '../db/client.js'

export function registerForm3CDHandlers() {
  ipcMain.handle('getForm3CD', async (_, entityId, entityPeriodId) => getForm3CD(entityId, entityPeriodId))
  ipcMain.handle('saveForm3CD', async (_, entityId, entityPeriodId, data) => saveForm3CD(entityId, entityPeriodId, data))
}

export async function getForm3CD(entityId, entityPeriodId) {
  const { rows } = await query(
    `SELECT * FROM form_3cd WHERE entity_id = $1 AND entity_period_id = $2`,
    [entityId, entityPeriodId]
  )
  return rows[0] || null
}

export async function saveForm3CD(entityId, entityPeriodId, data) {
  const {
    cy_turnover, cy_gross_profit, cy_net_profit, cy_stock_in_trade, cy_material_consumed, cy_finished_goods,
    py_turnover, py_gross_profit, py_net_profit, py_stock_in_trade, py_material_consumed, py_finished_goods
  } = data

  const { rows } = await query(
    `INSERT INTO form_3cd (
      entity_id, entity_period_id,
      cy_turnover, cy_gross_profit, cy_net_profit, cy_stock_in_trade, cy_material_consumed, cy_finished_goods,
      py_turnover, py_gross_profit, py_net_profit, py_stock_in_trade, py_material_consumed, py_finished_goods,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
    ON CONFLICT(entity_id, entity_period_id) DO UPDATE SET
      cy_turnover = EXCLUDED.cy_turnover,
      cy_gross_profit = EXCLUDED.cy_gross_profit,
      cy_net_profit = EXCLUDED.cy_net_profit,
      cy_stock_in_trade = EXCLUDED.cy_stock_in_trade,
      cy_material_consumed = EXCLUDED.cy_material_consumed,
      cy_finished_goods = EXCLUDED.cy_finished_goods,
      py_turnover = EXCLUDED.py_turnover,
      py_gross_profit = EXCLUDED.py_gross_profit,
      py_net_profit = EXCLUDED.py_net_profit,
      py_stock_in_trade = EXCLUDED.py_stock_in_trade,
      py_material_consumed = EXCLUDED.py_material_consumed,
      py_finished_goods = EXCLUDED.py_finished_goods,
      updated_at = now()
    RETURNING *`,
    [entityId, entityPeriodId, cy_turnover, cy_gross_profit, cy_net_profit, cy_stock_in_trade, cy_material_consumed, cy_finished_goods,
     py_turnover, py_gross_profit, py_net_profit, py_stock_in_trade, py_material_consumed, py_finished_goods]
  )
  return rows[0]
}
