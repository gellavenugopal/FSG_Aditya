// ── Blank format: the statements as the tool lays them out, with no figures ───
// Features -> Format -> Proprietorship / Partnership / LLP / Company (1 Oct 2026).
// A CA asked for the Balance Sheet, Statement of Profit and Loss and every note,
// Fill Details tables included, as empty formats — to see how the tool lays out
// each constitution and to spot errors in the layout itself.
//
// Nothing here is a hand-drawn mock-up. Every mapping line of the constitution
// (the same level_format rows the real statements are built from) becomes one
// ledger of nil value, and those go through the same processRows /
// attachNoteExtras / buildFinancialsHTML / buildFinancialsWorkbook the real
// statements use — so a wrong caption, order, note number or missing line shows
// up here exactly as it would in a client's financials.
import { processRows, attachNoteExtras } from '../hooks/useFinancials'
import { TP_AGEING_ROWS } from '../components/Notes/TradePayablesDisclosureForm'
import { TR_AGEING_ROWS } from '../components/Notes/TradeReceivablesAgingForm'

// Proprietorship and Partnership share one rule set (constitution 1); they
// differ in wording only, via the entity's constitution_display.
export const FORMAT_KINDS = {
  Proprietorship: { constitution: 1, display: 'Proprietorship', label: 'Proprietorship' },
  Partnership:    { constitution: 1, display: 'Partnership',    label: 'Partnership' },
  LLP:            { constitution: 2, display: 'LLP',            label: 'LLP' },
  Company:        { constitution: 3, display: 'Company',        label: 'Company' },
}

export const FORMAT_PERIOD = '2025-04-01 To 2026-03-31'
export const FORMAT_PREV_PERIOD = '2024-04-01 To 2025-03-31'

export function blankFormatEntity(kind) {
  const k = FORMAT_KINDS[kind]
  return {
    id: 0, name: '(Name of the Entity)', constitution: k.constitution, constitution_display: k.display,
    business_type: 'Trader', address: '(Address of the Entity)',
  }
}

// One nil ledger for a mapping line. forceInclude keeps it on the face and in its
// note although it carries no figure (the same flag a "Previous Year only" line uses).
const nilRow = (lf) => ({
  name: '', ledger_name: '', ledger_code: '', alie: lf.alie,
  level1: lf.level1, mapping1_resultant: lf.level1, level2: lf.level2, mapping2_resultant: lf.level2,
  level3: lf.level3, mapping3_resultant: lf.level3,
  level4_value: null, level5_value: null, level6_value: null, level7_value: null,
  closing_balance: '0', opening_balance: '0', status: 'user_approved', upload_nature: null,
  sort_order: lf.sort_order, forceInclude: true,
})

// ── Fill Details, empty ───────────────────────────────────────────────────────
// What each Fill Details form holds before anything is typed, with the flag that
// makes the PDF / Excel print its (empty) table. Keyed by the note's title, as
// the real saved Fill Details are.
const BLANK_LOAN = (nature, extra = {}) => ({
  id: 'blank', tbLedger: '', lenderPrintName: '(Name of lender)', nature, securedUnsecured: 'Secured',
  grossCY: '', grossPY: '', currentMaturityCY: '', currentMaturityPY: '',
  roi: '', emi: '', frequency: 'Monthly', remainingInstalments: '', finalMaturityDate: '', repaymentRemarks: '',
  repaymentFormat: 'tabular', repaymentParagraph: '', natureOfSecurity: '', guarantee: '', chargeRanking: '',
  securityFormat: 'tabular', securityParagraph: '', ...extra,
})
const partyFields = () => ({ sharePct: '', opening: '', introduced: '', remuneration: '', interest: '', withdrawals: '', shareOfProfit: '' })
const periodOf = (rows, buckets) => Object.fromEntries(rows.filter(r => !r.computed).map(r => [r.key, Object.fromEntries(buckets.map(b => [b, '']))]))
const TP_BUCKETS = ['less1y', '1y2y', '2y3y', 'more3y']
const TR_BUCKETS = ['less6m', '6m1y', '1y2y', '2y3y', 'more3y']

/**
 * The Fill Details of every note that has a form, empty: `noteDetailsMap`
 * (by note number, what the PDF / Excel print from) and `ndList` (what
 * attachNoteExtras reads, for the MSME and Cash & Bank lines inside a note).
 */
export function blankNoteDetails(kind, notes) {
  const k = FORMAT_KINDS[kind]
  const noteDetailsMap = {}
  const ndList = []
  for (const note of notes || []) {
    const t = (note.title || '').toLowerCase()
    let details = null
    if (t.includes('share capital') && k.constitution === 3) {
      details = {
        classes: [{ name: 'Equity Shares', type: 'Equity', faceValue: 10,
          cy: { authorised: '', issued: '', subscribed: '', paidUp: '', openingShares: '', issuedDuringYear: '', deletedDuringYear: '' },
          py: { authorised: '', issued: '', subscribed: '', paidUp: '', openingShares: '', issuedDuringYear: '', deletedDuringYear: '' } }],
        shareholders5pctEquity: [], shareholders5pctPreference: [], promoters: [], footnotes: Array(10).fill(''),
      }
    } else if (/long.term borrow/.test(t)) {
      details = { loans: [BLANK_LOAN('Term Loans from Banks')] }
    } else if (/short.term borrow/.test(t)) {
      details = { loans: [BLANK_LOAN('Cash Credit / Overdraft from Banks')] }
    } else if (t.includes('cash') && t.includes('bank')) {
      details = { items: { a: { amount: '', amountPY: '', remarks: '' }, b: { amount: '', amountPY: '', remarks: '' }, c: { amount: '', amountPY: '', remarks: '' } }, blankFormat: true }
    } else if (t.includes('trade payable')) {
      details = {
        ageing: { cy: periodOf(TP_AGEING_ROWS, TP_BUCKETS), py: periodOf(TP_AGEING_ROWS, TP_BUCKETS), tbCY: { msme: '', others: '' }, tbPY: { msme: '', others: '' }, includeInOutput: true },
        msme: { cy: { a: { principal: '', interest: '' }, b: '', c: '', d: '', e: '' }, py: { a: { principal: '', interest: '' }, b: '', c: '', d: '', e: '' }, includeInOutput: true },
      }
    } else if (t.includes('trade receivable') && k.constitution === 3) {
      details = { cy: periodOf(TR_AGEING_ROWS, TR_BUCKETS), py: periodOf(TR_AGEING_ROWS, TR_BUCKETS), includeInOutput: true }
    } else if (/owners.? capital|partners.? capital/.test(t)) {
      details = k.constitution === 2
        ? { variant: 'llp', rows: [1, 2].map(() => ({ name: '(Name of partner)', agreedContribution: '', contrib: partyFields(), current: partyFields() })), pyContrib: partyFields(), pyCurrent: partyFields() }
        : k.display === 'Proprietorship'
          ? { variant: 'single', isSingleOwner: true, partyLabel: 'Owner', rows: [{ name: '(Name of proprietor)', ...partyFields() }], py: partyFields() }
          : { variant: 'single', partyLabel: 'Partner', rows: [1, 2].map(() => ({ name: '(Name of partner)', ...partyFields() })), py: partyFields() }
    }
    if (!details) continue
    noteDetailsMap[note.num] = details
    ndList.push({ note_num: note.num, note_title: note.title, data: details })
  }
  return { noteDetailsMap, ndList }
}

// Lines that exist for the engine's own bookkeeping, not for the reader: the
// catch-all "Uncategorised ..." lines (they appear in a client's statements only
// when a ledger really is uncategorised) and the internal Opening / Closing Stock
// (PL) heads (folded into other lines, so they take a note number only here).
const isEngineLine = (lf) =>
  [lf.level1, lf.level2, lf.level3].some(v => /^uncategorised\b/i.test(String(v || '').trim())) ||
  /^(opening|closing) stock \(pl\)$/i.test(String(lf.level1 || '').trim())

/** The processed financials of an entity that has every mapping line and no amounts. */
export function blankFormatData(allLfRows, kind) {
  const k = FORMAT_KINDS[kind]
  const keep = (allLfRows || []).filter(lf => !isEngineLine(lf))
  // A Level 2 that has Level 3 lines also has one bare header row (no Level 3): it is
  // the group's own row, not a line a reader sees ("Sale", "Other current assets").
  const groupKey = (lf) => `${lf.level1}|${lf.level2}`
  const hasL3 = new Set(keep.filter(lf => String(lf.level3 || '').trim()).map(groupKey))
  const lfRows = keep
    .filter(lf => String(lf.level3 || '').trim() || !hasL3.has(groupKey(lf)))
    // Only a Partnership has a Partners' Remuneration line: a Proprietorship has no partners, and an
    // LLP's face has no such line (its partners share the profit).
    .filter(lf => !((kind === 'Proprietorship' || kind === 'LLP') && /^partners'? remuneration$/i.test(String(lf.level1 || '').trim())))
  const rows = lfRows.map(nilRow)
  const first = processRows(rows, null, k.constitution, [], 'Trader', false, false, null, lfRows || [], null)
  const { ndList } = blankNoteDetails(kind, Object.values(first.notes || {}))
  const data = first
  data.levelFormat = lfRows || []
  data.generalNotes = { title: '', points: [] }
  attachNoteExtras(data, ndList, lfRows || [], null, k.constitution, null, null, null)
  // Notes with no figure are normally left out and their nil lines hidden —
  // here every note and every line is the point.
  for (const note of Object.values(data.notes || {})) {
    if (note.templateRowsAll) note.templateRows = note.templateRowsAll.filter(r => !r.unclassified)
  }
  data.activeNotes = Object.values(data.notes || {})
    .filter(n => !/uncategorised/i.test(n.title || ''))
    .sort((a, b) => a.num - b.num)
  return data
}
