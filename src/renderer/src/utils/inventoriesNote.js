// The Inventories note (Balance Sheet) - every constitution.
//
// Schedule III / the CA's rule: the balance of Inventories always shows the Closing Stock of Raw Materials, Work-in-Progress,
// Finished Goods, Stock-in-Trade and Stores and Spares, each with its figure, under the head "Closing Stock (BS)". The figures
// are those of the Stock menu (Closing Stock - BS - <category> rows, category kept in level5_value); a stock ledger the CA
// has placed in a category by hand (Level 5 on Company / Proprietorship, the Level 3 line on Partnership / LLP) counts too.
// Anything that belongs to no category is shown as Unclassified - never dropped - so the lines always add up to the note total.
// Pure function (tested by tools/selftest-inventories-split.mjs).

export const INVENTORY_HEAD = 'Closing Stock (BS)'

// canonical id -> printed label, in the order they are shown
export const INVENTORY_CATEGORIES = [
  { id: 'rm',     label: 'Raw Materials',        mandatory: true },
  { id: 'wip',    label: 'Work-in-Progress',     mandatory: true },
  { id: 'fg',     label: 'Finished Goods',       mandatory: true },
  { id: 'sit',    label: 'Stock-in-Trade',       mandatory: true },
  { id: 'stores', label: 'Stores and Spares',    mandatory: true },
  { id: 'tools',  label: 'Loose Tools',          mandatory: false },
  { id: 'other',  label: 'Others',               mandatory: false },
]

const KEYS = {
  rawmaterials: 'rm', rawmaterial: 'rm', rm: 'rm',
  workinprogress: 'wip', workinprocess: 'wip', wip: 'wip',
  finishedgoods: 'fg', finishedgood: 'fg', fg: 'fg',
  stockintrade: 'sit', stockintrades: 'sit', tradinggoods: 'sit', stockintradegoods: 'sit',
  storesandspares: 'stores', storesspares: 'stores', storesandspare: 'stores', stores: 'stores',
  loosetools: 'tools', loosetool: 'tools',
  others: 'other', other: 'other',
}
const squash = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '')

/** 'Raw materials' / 'Stores & Spares' / 'Work in Progress' ... -> 'rm' / 'stores' / 'wip'; anything else (or blank) -> null */
export function inventoryCategoryId(label) {
  const k = squash(label)
  return k && KEYS[k] ? KEYS[k] : null
}

/** The category a ledger row belongs to (null = none): the Stock tab's category, else Level 5 / Level 4, else its Level 3 line. */
export function categoryOfRow(row) {
  if (!row) return null
  const m = /^\s*closing stock\s*-\s*bs\s*-\s*(.+)$/i.exec(row.name || '')
  return inventoryCategoryId(row.level5_value) || (m ? inventoryCategoryId(m[1]) : null) ||
    inventoryCategoryId(row.level4_value) || inventoryCategoryId(row.mapping3_resultant || row.level3)
}

/**
 * @param {Array<{row:object, amt:number}>} cyEntries  ledgers of the note, Current Year amount (display sign)
 * @param {Array<{row:object, amt:number}>} pyEntries  the same for the Previous Year
 * @param {(rows:object[])=>any} ledgerIdsOf
 * @returns template rows: the head line, then its categories
 */
export function buildInventoriesRows(cyEntries, pyEntries, ledgerIdsOf = () => []) {
  const bucket = () => ({ cy: 0, py: 0, cyRows: [], pyRows: [] })
  const by = new Map(INVENTORY_CATEGORIES.map(c => [c.id, bucket()]))
  const un = bucket()
  let cyTotal = 0, pyTotal = 0
  const add = (entries, key, listKey) => {
    for (const e of entries || []) {
      const id = categoryOfRow(e.row)
      const b = id ? by.get(id) : un
      const amt = Number(e.amt) || 0
      b[key] += amt; b[listKey].push(e.row)
      if (key === 'cy') cyTotal += amt; else pyTotal += amt
    }
  }
  add(cyEntries, 'cy', 'cyRows')
  add(pyEntries, 'py', 'pyRows')

  const rows = [{ type: 'l3', label: INVENTORY_HEAD, cy: cyTotal, py: pyTotal, keepZero: true,
    ledgerIds: ledgerIdsOf([...un.cyRows, ...INVENTORY_CATEGORIES.flatMap(c => by.get(c.id).cyRows)]),
    pyLedgerIds: ledgerIdsOf([...un.pyRows, ...INVENTORY_CATEGORIES.flatMap(c => by.get(c.id).pyRows)]) }]
  const nonZero = (b) => Math.abs(b.cy) >= 0.005 || Math.abs(b.py) >= 0.005
  for (const c of INVENTORY_CATEGORIES) {
    const b = by.get(c.id)
    if (!c.mandatory && !nonZero(b)) continue
    rows.push({ type: 'option', label: c.label, cy: b.cy, py: b.py, fieldKey: 'level5_value', parentL3: INVENTORY_HEAD,
      keepZero: c.mandatory, inventoryCategory: c.id })
  }
  if (nonZero(un)) {
    rows.push({ type: 'option', label: 'Unclassified', cy: un.cy, py: un.py, fieldKey: 'level5_value', parentL3: INVENTORY_HEAD,
      unclassified: true, natureLevel: 5, inventoryCategory: 'unclassified',
      ledgerIds: ledgerIdsOf(un.cyRows), pyLedgerIds: ledgerIdsOf(un.pyRows) })
  }
  return rows
}
