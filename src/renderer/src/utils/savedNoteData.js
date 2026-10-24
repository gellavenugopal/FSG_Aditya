// Saved per-note data (Fill Details forms, Disclosure Notes) belongs to a note
// by its TITLE. The note_num stored with it is only where the note sat when it
// was saved — numbers shift whenever the set of notes with figures changes —
// so matching by number alone can hand one note's saved data to another.
// Mirrors src/main/db/noteStore.js, which applies the same rule on reads and
// writes. No imports, so it can be used from anywhere without a cycle.

// Case, spacing and punctuation don't make a different note.
export const noteTitleKey = (title) => String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

const savedAt = (row) => {
  const t = row?.updated_at ? new Date(row.updated_at).getTime() : 0
  return Number.isFinite(t) ? t : 0
}

/**
 * Returns lookup(note) → the saved value for that live note, or undefined.
 * A row with the note's title wins (the most recently saved one, if an older
 * version left duplicates); a row saved at the note's number is used only when
 * it carries no title at all.
 *
 * @param {Array<{note_num, note_title, updated_at?}>} rows  saved rows (e.g. listNoteDetails())
 * @param {(row) => any} valueOf  the value to return for a row; null/undefined skips the row
 */
export function indexSavedNoteRows(rows, valueOf) {
  const byTitle = new Map()
  const untitledByNum = new Map()
  for (const row of rows || []) {
    const value = valueOf(row)
    if (value === undefined || value === null) continue
    const key = noteTitleKey(row.note_title)
    if (!key) {
      if (row.note_num !== undefined && row.note_num !== null) untitledByNum.set(Number(row.note_num), value)
      continue
    }
    const prev = byTitle.get(key)
    if (!prev || savedAt(row) >= prev.at) byTitle.set(key, { value, at: savedAt(row) })
  }
  return (note) => {
    if (!note) return undefined
    const hit = byTitle.get(noteTitleKey(note.title))
    if (hit) return hit.value
    return untitledByNum.get(Number(note.num))
  }
}

/** { [live note number]: value } over `notes`, for code that indexes by note.num. */
export function mapSavedRowsToLiveNotes(rows, notes, valueOf) {
  const lookup = indexSavedNoteRows(rows, valueOf)
  const out = {}
  for (const note of notes || []) {
    const value = lookup(note)
    if (value !== undefined) out[note.num] = value
  }
  return out
}

/** Parses a saved row's `data` column, which arrives as JSON text or already parsed. */
export function parsedNoteData(row) {
  const d = row?.data
  if (typeof d !== 'string') return d
  try { return JSON.parse(d) } catch (_) { return undefined }
}
