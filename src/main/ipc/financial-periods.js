import { ipcMain } from 'electron'
import { query } from '../db/client.js'

export function registerFinancialPeriodHandlers() {
  // ── Global Financial Period master (shared across all Auditees) ────────────
  ipcMain.handle('financialPeriod:list', async () => {
    const { rows } = await query(`SELECT * FROM financial_periods ORDER BY date_from DESC`)
    return rows
  })

  ipcMain.handle('financialPeriod:save', async (_, data) => {
    const { id, year_label, date_from, date_till } = data
    if (!year_label?.trim()) throw new Error('Year label is required.')
    if (!date_from || !date_till) throw new Error('Date From and Date Till are required.')
    if (date_from >= date_till) throw new Error('Date From must be before Date Till.')

    if (id) {
      const { rows } = await query(
        `UPDATE financial_periods SET year_label=$1, date_from=$2, date_till=$3 WHERE id=$4 RETURNING *`,
        [year_label.trim(), date_from, date_till, id]
      )
      return rows[0]
    }
    try {
      const { rows } = await query(
        `INSERT INTO financial_periods (year_label, date_from, date_till) VALUES ($1,$2,$3) RETURNING *`,
        [year_label.trim(), date_from, date_till]
      )
      return rows[0]
    } catch (e) {
      if (String(e.message || '').includes('UNIQUE')) {
        throw new Error('A Financial Period with this exact Date From/Date Till already exists.')
      }
      throw e
    }
  })

  ipcMain.handle('financialPeriod:delete', async (_, id) => {
    const { rows: [used] } = await query(
      `SELECT COUNT(*) AS cnt FROM entity_periods WHERE financial_period_id=$1`, [id]
    )
    if (Number(used?.cnt) > 0) {
      throw new Error('This Financial Period is attached to one or more Auditees and cannot be deleted.')
    }
    await query(`DELETE FROM financial_periods WHERE id=$1`, [id])
    return { ok: true }
  })

  // ── Entity ↔ Financial Period attachment (per-Auditee, with locking) ───────
  ipcMain.handle('entityPeriod:list', async (_, entityId) => {
    const { rows } = await query(
      `SELECT ep.id, ep.entity_id, ep.financial_period_id, ep.locked, ep.locked_at, ep.created_at,
              ep.prev_tb_id, ep.py_mode, ep.is_final, ep.final_sign_place, ep.final_sign_date, ep.finalised_at,
              fp.year_label, fp.date_from, fp.date_till
       FROM entity_periods ep
       JOIN financial_periods fp ON fp.id = ep.financial_period_id
       WHERE ep.entity_id = $1
       ORDER BY fp.date_from DESC`,
      [entityId]
    )
    return rows
  })

  ipcMain.handle('entityPeriod:get', async (_, id) => {
    const { rows } = await query(`SELECT * FROM entity_periods WHERE id=$1`, [id])
    return rows[0] || null
  })

  // Remembers the "Previous Year" comparative TB picked for this Auditee↔FY,
  // so re-selecting the same FY later (after switching away) restores it
  // instead of resetting to "— None —" every time.
  ipcMain.handle('entityPeriod:setPrevTB', async (_, id, tbId) => {
    const { rows } = await query(
      `UPDATE entity_periods SET prev_tb_id=$1 WHERE id=$2 RETURNING *`, [tbId || null, id]
    )
    return rows[0]
  })

  // Previous Year figures: 'required' | 'none_show' (not required, column kept with dashes) | 'none_hide'
  // (not required, column left out). Changes every statement of that Financial Year, so a locked one is refused.
  ipcMain.handle('entityPeriod:setPYMode', async (_, id, mode) => {
    if (!['required', 'none_show', 'none_hide'].includes(mode)) throw new Error('Unknown Previous Year option.')
    const { rows: [ep] } = await query(`SELECT locked FROM entity_periods WHERE id=$1`, [id])
    if (!ep) throw new Error('Financial Period not found.')
    if (ep.locked) throw new Error('This Financial Period is locked. Unlock it from the Master tab to make changes.')
    const { rows } = await query(`UPDATE entity_periods SET py_mode=$1 WHERE id=$2 RETURNING *`, [mode, id])
    return rows[0]
  })

  ipcMain.handle('entityPeriod:attach', async (_, entityId, financialPeriodId) => {
    try {
      const { rows } = await query(
        `INSERT INTO entity_periods (entity_id, financial_period_id) VALUES ($1,$2) RETURNING *`,
        [entityId, financialPeriodId]
      )
      return rows[0]
    } catch (e) {
      if (String(e.message || '').includes('UNIQUE')) {
        throw new Error('This Financial Period is already attached to this Auditee.')
      }
      throw e
    }
  })

  ipcMain.handle('entityPeriod:lock', async (_, id) => {
    const { rows } = await query(
      `UPDATE entity_periods SET locked=TRUE, locked_at=now() WHERE id=$1 RETURNING *`, [id]
    )
    return rows[0]
  })

  ipcMain.handle('entityPeriod:unlock', async (_, id) => {
    const { rows } = await query(
      `UPDATE entity_periods SET locked=FALSE, locked_at=NULL, is_final=FALSE, finalised_at=NULL WHERE id=$1 RETURNING *`, [id]
    )
    return rows[0]
  })

  // Mark the Financial Year Final: the Place and Date of Signing are saved and the year is locked, in one step.
  // Once final they cannot be changed - unlock the year (Master) first. Asking again with the same values is harmless.
  ipcMain.handle('entityPeriod:finalise', async (_, id, place, date) => {
    const p = String(place == null ? '' : place).trim()
    if (!p) throw new Error('Place of Signing is required to mark the Financial Year Final.')
    const d = String(date == null ? '' : date).trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw new Error('Date of Signing must be a valid date.')
    const { rows: [cur] } = await query(`SELECT is_final, final_sign_place, final_sign_date FROM entity_periods WHERE id=$1`, [id])
    if (!cur) throw new Error('Financial Period not found.')
    if (cur.is_final) {
      if (cur.final_sign_place === p && cur.final_sign_date === d) {
        const { rows } = await query(`SELECT * FROM entity_periods WHERE id=$1`, [id])
        return rows[0]
      }
      throw new Error('This Financial Year is already Final - its Place and Date of Signing are locked. Unlock the year from the Master tab to change them.')
    }
    const { rows } = await query(
      `UPDATE entity_periods SET is_final=TRUE, final_sign_place=$2, final_sign_date=$3, finalised_at=now(),
              locked=TRUE, locked_at=COALESCE(locked_at, now())
       WHERE id=$1 RETURNING *`, [id, p, d]
    )
    return rows[0]
  })

  ipcMain.handle('entityPeriod:delete', async (_, id) => {
    const { rows: [used] } = await query(
      `SELECT COUNT(*) AS cnt FROM trial_balances WHERE entity_period_id=$1`, [id]
    )
    if (Number(used?.cnt) > 0) {
      throw new Error('This Financial Period has Trial Balances uploaded against it and cannot be detached.')
    }
    await query(`DELETE FROM entity_periods WHERE id=$1`, [id])
    return { ok: true }
  })
}
