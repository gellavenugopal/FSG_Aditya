// ── The Stock tab's categories and its "Adjusted in (P&L)" column (0.1.93) ───────
// Pure helpers, no React: the Stock screen, its Excel round-trip and the self-test all use them.
//
// Five categories have a fixed place in the P&L (Raw Materials in Cost of materials consumed, the rest in Changes in inventories - see
// utils/inventorySplit.js). Stores & Spares, Loose Tools and Others are adjusted in a LINE of the Other expenses note, and which line is
// the CA's call: the Stock tab asks, and the answer is kept on the stock rows (tb_rows.stock_head, see src/main/ipc/tb.js saveStock).
import { cleanHead, headKey } from '../../utils/inventorySplit'

export { cleanHead, headKey }

export const INVENTORY_TYPES = [
  'Raw Materials',
  'Work in Progress',
  'Finished Goods',
  'Stock-in-Trade',
  'Stores & Spares',
  'Loose Tools',
  'Others',
  'Uncategorised Stock',
]

// The categories whose Opening / Closing stock is adjusted in a head of the Other expenses note.
export const HEAD_TYPES = ['Stores & Spares', 'Loose Tools', 'Others']

const num = (v) => parseFloat(v) || 0

/** Has this category any figure at all - Current or Previous Year, Opening or Closing? maps: { opening, closing, pyOpening, pyClosing } */
export function hasFigures(type, maps) {
  return [maps && maps.opening, maps && maps.closing, maps && maps.pyOpening, maps && maps.pyClosing]
    .some(m => Math.abs(num((m || {})[type])) > 0)
}

/** The categories that have a figure but no head named yet (what the Stock tab still has to ask). */
export function typesNeedingHead(maps, heads) {
  return HEAD_TYPES.filter(t => hasFigures(t, maps) && !cleanHead((heads || {})[t]))
}

/** { category: head } for the categories that have a figure and a head - what is sent to saveStock. */
export function headsToSave(maps, heads) {
  const out = {}
  for (const t of HEAD_TYPES) {
    const h = cleanHead((heads || {})[t])
    if (h && hasFigures(t, maps)) out[t] = h
  }
  return out
}

/**
 * Where a category with a fixed place is adjusted in the P&L, in the words of the Stock tab. null for the three that ask.
 * Raw Materials: Cost of materials consumed - or, when the entity has no such line, Changes in inventories (a Trader holds no raw
 * materials, so they are Stock-in-Trade to it).
 */
export function stockDestination(type, businessType) {
  if (HEAD_TYPES.includes(type)) return null
  if (type === 'Raw Materials') return businessType === 'Trader' ? 'Changes in inventories' : 'Cost of materials consumed'
  return 'Changes in inventories'
}
export const RAW_FALLBACK_HINT = 'Changes in inventories if there is no such line'

/**
 * The names the pick-list offers for one category, each once (first group wins), in this order:
 *   lastYear  - the head the previous year's Trial Balance carries for this category
 *   inTB      - lines the Other expenses note of this Trial Balance already has ({ name, total })
 *   standard  - the Other-expenses captions of the entity's mapping
 * Returns [{ name, group }].
 */
export function headOptions({ lastYear = '', inTB = [], standard = [] } = {}) {
  const seen = new Set()
  const out = []
  const add = (name, group) => {
    const n = cleanHead(name)
    const k = headKey(n)
    if (!n || seen.has(k)) return
    seen.add(k)
    out.push({ name: n, group })
  }
  add(lastYear, 'Last year')
  for (const x of inTB) add(x && x.name, 'In this Trial Balance')
  for (const x of standard) add(x, 'Standard heads')
  return out
}

/** What the CA typed, as the head it means: the option's own spelling when it matches one (capitals / spacing aside), else the typed text, cleaned. */
export function snapHead(text, options) {
  const k = headKey(text)
  const hit = k ? (options || []).find(o => headKey(o.name) === k) : null
  return hit ? hit.name : cleanHead(text)
}

/** The options that contain what has been typed (all of them when nothing is typed). */
export function filterHeadOptions(options, text) {
  const k = headKey(text)
  return k ? (options || []).filter(o => headKey(o.name).includes(k)) : (options || [])
}
