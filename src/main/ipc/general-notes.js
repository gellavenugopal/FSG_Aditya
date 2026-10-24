import { ipcMain } from 'electron'
import { query } from '../db/client.js'

// General Notes — a single free-form narrative note ("Significant Accounting
// Policies" etc., always Note 1) made up of internally-numbered points, one
// per accounting policy topic. Stored shape: { title, points: [{ id, header,
// contentHtml }, ...] }. The `segments` DB column name predates this shape
// (kept as-is — it's an opaque JSONB blob either way) — see schema.js's
// general_notes table doc comment.
export function registerGeneralNotesHandlers() {
  ipcMain.handle('generalNotes:get', async (_, entityId, entityPeriodId) => getGeneralNotes(entityId, entityPeriodId))
  ipcMain.handle('generalNotes:save', async (_, entityId, entityPeriodId, noteData) => saveGeneralNotes(entityId, entityPeriodId, noteData))
}

export async function getGeneralNotes(entityId, entityPeriodId) {
  if (!entityId || !entityPeriodId) return null
  const { rows } = await query(
    `SELECT segments FROM general_notes WHERE entity_id = $1 AND entity_period_id = $2`,
    [entityId, entityPeriodId]
  )
  return rows[0] ? rows[0].segments : null
}

export async function saveGeneralNotes(entityId, entityPeriodId, noteData) {
  if (!entityId || !entityPeriodId) throw new Error('Missing entity/period')
  await query(
    `INSERT INTO general_notes (entity_id, entity_period_id, segments, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT(entity_id, entity_period_id) DO UPDATE SET
       segments = EXCLUDED.segments,
       updated_at = now()`,
    [entityId, entityPeriodId, JSON.stringify(noteData)]
  )
  return { ok: true }
}
