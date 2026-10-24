// Trade Receivables ageing table for the NON-CORPORATE constitutions:
// Proprietorship / Partnership (1) and LLP (2). Company (3) keeps its own
// Schedule III ageing schedule (components/Notes/TradeReceivablesAgingForm.jsx),
// untouched.
//
// One table — two ageing blocks x three categories, one Amount column — shown
// beneath the Trade receivables note on screen, in the PDF and in the Excel:
//
//   Ageing of Trade Receivables | Category                   | Amount
//   ... less than 6 months ...  | Secured, considered good   |
//                               | Unsecured, considered good |   <- everything defaults here
//                               | Doubtful                   |
//   ... more than 6 months ...  | Secured, considered good   |
//                               | Unsecured, considered good |
//                               | Doubtful                   |
//   Total                                                    |   <- must equal the Trial Balance figure
//
// Until the preparer edits it (Fill Details on the note), the whole Trade
// receivables figure is taken as "less than 6 months / Unsecured, considered
// good". The total is cross-checked against the Trial Balance figure in the
// form and in the Exception Report.
//
// Saved inside the note's existing note_details JSON under `ncAgeing`:
//   { ncAgeing: { lt6: { secured, unsecured, doubtful }, gt6: { ... } } }
// (a separate key from Company's { cy, py }, so neither shape can be mistaken
// for the other).

export const NC_AGEING_TITLE = 'Ageing of Trade Receivables'

export const NC_AGEING_BLOCKS = [
  { key: 'lt6', label: 'Trade Receivables outstanding for less than 6 months from the date due for receipts' },
  { key: 'gt6', label: 'Trade Receivables outstanding for more than 6 months from the date due for receipts' },
]

export const NC_AGEING_CATEGORIES = [
  { key: 'secured',   label: 'Secured, considered good' },
  { key: 'unsecured', label: 'Unsecured, considered good' },
  { key: 'doubtful',  label: 'Doubtful' },
]

// Where the whole Trade receivables figure sits until the preparer edits it.
const DEFAULT_BLOCK = 'lt6'
const DEFAULT_CATEGORY = 'unsecured'

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }

/** Does the Trade receivables ageing table above apply to this entity / note? */
export const isNonCorpTradeReceivables = (constitution, noteTitle) =>
  [1, 2].includes(parseInt(constitution)) && /trade.*receivable/i.test(noteTitle || '')

export const ncAgeingTotal = (values) =>
  NC_AGEING_BLOCKS.reduce((s, b) => s + NC_AGEING_CATEGORIES.reduce((t, c) => t + num(values?.[b.key]?.[c.key]), 0), 0)

/**
 * The six figures to show, and whether they are the untouched default.
 * @param saved     note_details.ncAgeing, or null/undefined if never saved
 * @param noteTotal the Trade receivables figure per the Trial Balance
 * @returns {{ values: { lt6: {secured, unsecured, doubtful}, gt6: {...} }, isDefault: boolean, total: number }}
 */
export function ncAgeingResolve(saved, noteTotal) {
  const isDefault = !saved || typeof saved !== 'object' || !NC_AGEING_BLOCKS.some(b => saved[b.key] && typeof saved[b.key] === 'object')
  const values = {}
  for (const b of NC_AGEING_BLOCKS) {
    values[b.key] = {}
    for (const c of NC_AGEING_CATEGORIES) values[b.key][c.key] = isDefault ? 0 : num(saved[b.key]?.[c.key])
  }
  if (isDefault) values[DEFAULT_BLOCK][DEFAULT_CATEGORY] = num(noteTotal)
  return { values, isDefault, total: ncAgeingTotal(values) }
}
