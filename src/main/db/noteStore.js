import { query as dbQuery } from './client.js'

// Saved per-note data — Fill Details forms (note_details, and
// entity_note_details for forms shared across a branch entity's Trial
// Balances) and Disclosure Notes (note_disclosures) — belongs to a note by its
// TITLE. A note's number is only its position among the notes that currently
// have figures; it shifts whenever that set changes (a ledger recategorised, a
// Previous-Year-only balance, Manual PY switched on). Reading or writing by
// number alone let one note's saved figures appear under, or overwrite,
// another note's. The tables keep their (scope, note_num) unique key; on every
// save note_num is re-pinned to the note's current number.

const TABLES = {
  note_details:        { scope: 'tb_id',     value: 'data' },
  entity_note_details: { scope: 'entity_id', value: 'data' },
  note_disclosures:    { scope: 'tb_id',     value: 'text' },
  entity_note_disclosures: { scope: 'entity_id', value: 'text' },
}

// Case, spacing and punctuation don't make a different note
// ("Long-term borrowings" and "Long term Borrowings" are the same note).
export const noteTitleKey = (title) => String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const TITLE_KEY_SQL = `regexp_replace(lower(coalesce(note_title, '')), '[^a-z0-9]+', '', 'g')`

// Where a row belonging to a DIFFERENT note, still sitting on the number being
// saved to, is moved. Real notes are positive and depStore.js reserves -101 /
// -102 for the consolidated depreciation schedules, so parking stays far below.
const PARK_BASE = -1000000

export function createNoteStore(query = dbQuery) {
  async function find(table, scopeId, noteNum, noteTitle) {
    const { scope, value } = TABLES[table]
    const key = noteTitleKey(noteTitle)
    if (key) {
      const { rows } = await query(
        `SELECT id, note_num, note_title, ${value} AS value FROM ${table}
         WHERE ${scope} = $1 AND ${TITLE_KEY_SQL} = $2
         ORDER BY (note_num = $3) DESC, updated_at DESC NULLS LAST, id DESC
         LIMIT 1`,
        [scopeId, key, Number(noteNum) || 0]
      )
      if (rows[0]) return rows[0]
    }
    if (noteNum == null) return null
    // A row found only by number is trusted when nothing says it belongs to
    // another note: the caller gave no title, or the row itself has none.
    const { rows } = await query(
      `SELECT id, note_num, note_title, ${value} AS value FROM ${table}
       WHERE ${scope} = $1 AND note_num = $2 AND ($3::text = '' OR ${TITLE_KEY_SQL} = '')
       LIMIT 1`,
      [scopeId, noteNum, key]
    )
    return rows[0] || null
  }

  // `existing` — the row find() already returned for this note, when the
  // caller looked it up first (e.g. to merge into it); omit to look it up here.
  async function save(table, scopeId, noteNum, noteTitle, valueToStore, existing) {
    const { scope, value } = TABLES[table]
    const title = String(noteTitle ?? '').trim()
    const key = noteTitleKey(title)
    const row = existing === undefined ? await find(table, scopeId, noteNum, title) : existing
    if (key && Number(noteNum) > 0) {
      await query(
        `UPDATE ${table} SET note_num = ${PARK_BASE} - id
         WHERE ${scope} = $1 AND note_num = $2 AND id <> $3 AND ${TITLE_KEY_SQL} <> $4`,
        [scopeId, noteNum, row ? row.id : 0, key]
      )
    }
    if (row) {
      await query(
        `UPDATE ${table} SET note_num = $1, note_title = COALESCE(NULLIF($2, ''), note_title),
           ${value} = $3, updated_at = now()
         WHERE id = $4`,
        [noteNum, title, valueToStore, row.id]
      )
      return
    }
    await query(
      `INSERT INTO ${table} (${scope}, note_num, note_title, ${value}, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (${scope}, note_num) DO UPDATE SET
         note_title = EXCLUDED.note_title,
         ${value} = EXCLUDED.${value},
         updated_at = now()`,
      [scopeId, noteNum, title, valueToStore]
    )
  }

  return { find, save }
}

export const noteStore = createNoteStore()
