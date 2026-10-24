/**
 * Pre-release self-test for the Manual Previous Year overlay
 * (applyManualPyOverrides in src/renderer/src/hooks/useFinancials.js).
 *
 * Runs the real function against the note-row shapes buildNoteTemplateRows
 * produces, and asserts the rules the CA relies on:
 *   - every leaf figure is editable (top-level L3 without sub-rows, option
 *     rows, MSME principal/interest, Reserves "Opening"/"Add: Surplus")
 *   - parents = sum of their sub-rows; fixed L4 labels mirror their L3
 *   - MSME "— Total" and Reserves "Closing Profit & Loss" are derived
 *   - the note total excludes derived/subtotal rows and the MSME schedule
 *   - the BS/PL line for the note follows the note total
 *   - a PY-only custom row is appended and visible without "show zero rows"
 *   - top-level storage keys are the bare label (older entries still apply)
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-manualpy.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const src = fs.readFileSync(path.join(root, 'src/renderer/src/hooks/useFinancials.js'), 'utf8')

// Pull a top-level function out by name. Source is CRLF; the closing brace of
// a top-level function is the first "}" at column 0 after the declaration.
function grab(name) {
  const m = new RegExp('(?:export )?function ' + name + '\\b').exec(src)
  if (!m) throw new Error('cannot find ' + name)
  const closeRe = /\r?\n\}(?=\r?\n)/g
  closeRe.lastIndex = m.index
  const c = closeRe.exec(src)
  if (!c) throw new Error('no closing brace for ' + name)
  return src.slice(m.index, c.index + c[0].length).replace(/^export /, '')
}

let fails = 0
const check = (what, got, want) => {
  const ok = Math.abs(got - want) < 1e-9
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}: ${got}${ok ? '' : '  (expected ' + want + ')'}`)
}
const edit = (what, row, want) => {
  const ok = !!row.manualPyEditable === want
  if (!ok) fails++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what} editable=${!!row.manualPyEditable}${ok ? '' : '  (expected ' + want + ')'}`)
}

console.log('\nManual PY self-test')
let fn
try {
  // applyManualPyOverrides references fallbackSubnoteLabel (imported from
  // utils/annexureGrouping.js in the real source) -- inject a matching shim
  // here rather than trying to grab() across a module boundary.
  const shim = "function fallbackSubnoteLabel(t) { return /cost of materials consumed|purchases of stock-in-trade/i.test(t || '') ? 'Purchases' : 'Unclassified' }\n"
  fn = new Function(
    shim +
    grab('filterZeroNoteRows') + '\n' + grab('applyManualPyOverrides') + '\nreturn applyManualPyOverrides'
  )()
} catch (e) {
  console.log('  FAIL  could not load applyManualPyOverrides: ' + e.message)
  process.exit(1)
}

const MS = 'Details of Amount relating to MSME as per MSME Act, 2006'
const rows = [
  { type: 'l3', label: 'Securities Premium', cy: 100, py: 1 },
  { type: 'l3', label: 'Opening Profit & Loss', cy: 0, py: 1, syntheticProfitLoss: true },
  { type: 'l3', label: 'Add: Surplus / (Deficit) during the year', cy: 0, py: 1, syntheticProfitLoss: true },
  { type: 'l3', label: 'Closing Profit & Loss', cy: 0, py: 1, syntheticProfitLoss: true, isSubtotal: true },
  { type: 'l3', label: 'General Reserve', cy: 50, py: 1 },
  { type: 'option', label: 'Secured, considered good', cy: 30, py: 1, parentL3: 'General Reserve', fieldKey: 'level5_value' },
  { type: 'option', label: 'Unclassified', cy: 20, py: 1, parentL3: 'General Reserve', fieldKey: 'level5_value', unclassified: true },
  { type: 'l4', label: 'Fixed L4 caption', cy: 50, py: 1 },
  { type: 'l3', label: MS, cy: 0, py: 0, isMSMEHeader: true, isSubtotal: true },
  { type: 'option', label: '(i) Principal — Principal', cy: 0, py: 1, isMSME: true, parentL3: MS },
  { type: 'option', label: '(i) Principal — Interest', cy: 0, py: 1, isMSME: true, parentL3: MS },
  { type: 'option', label: '(i) Principal — Total', cy: 0, py: 2, isMSME: true, isSubtotal: true, parentL3: MS },
]
const note = { num: 7, title: 'Reserves & Surplus', isPL: false, templateRowsAll: rows, templateRows: rows.slice(), prevTotal: 999 }
const processed = {
  notes: { 7: note },
  elSections: [{ level1: 'Shareholders funds', lines: [{ noteNum: 7, prevTotal: 999, total: 0 }], prevTotal: 999 }],
  assetSections: [], incomeSections: [], expenseSections: [],
}
const entries = [
  { note_num: 7, note_title: 'Reserves & Surplus', particular_label: 'Securities Premium', py_amount: 1000 },
  { note_num: 7, note_title: 'Reserves & Surplus', particular_label: 'Opening Profit & Loss', py_amount: 400 },
  { note_num: 7, note_title: 'Reserves & Surplus', particular_label: 'Add: Surplus / (Deficit) during the year', py_amount: 100 },
  { note_num: 7, note_title: 'Reserves & Surplus', particular_label: 'General Reserve > Secured, considered good', py_amount: 60 },
  { note_num: 7, note_title: 'Reserves & Surplus', particular_label: 'General Reserve > Unclassified', py_amount: 40 },
  { note_num: 7, note_title: 'Reserves & Surplus', particular_label: MS + ' > (i) Principal — Principal', py_amount: 7 },
  { note_num: 7, note_title: 'Reserves & Surplus', particular_label: MS + ' > (i) Principal — Interest', py_amount: 3 },
  { note_num: 7, note_title: 'Reserves & Surplus', particular_label: 'Capital Reserve (PY only)', py_amount: 25 },
]
fn(processed, true, entries)

const by = (l) => note.templateRowsAll.find(r => r.label === l)
check('leaf takes its entry', by('Securities Premium').py, 1000);                     edit('leaf', by('Securities Premium'), true)
check('parent = sum of option rows', by('General Reserve').py, 100);                  edit('parent', by('General Reserve'), false)
check('option row takes its entry', by('Secured, considered good').py, 60);           edit('option row', by('Secured, considered good'), true)
check('fixed L4 mirrors its L3', by('Fixed L4 caption').py, 100);                    edit('fixed L4', by('Fixed L4 caption'), false)
check('Closing P&L = Opening + Surplus', by('Closing Profit & Loss').py, 500);      edit('Closing P&L', by('Closing Profit & Loss'), false)
edit('Opening P&L', by('Opening Profit & Loss'), true)
check('MSME Total = Principal + Interest', by('(i) Principal — Total').py, 10);  edit('MSME Total', by('(i) Principal — Total'), false)
edit('MSME Principal', by('(i) Principal — Principal'), true)
check('note total excludes Closing subtotal and MSME', note.prevTotal, 1625)
check('BS line follows the note', processed.elSections[0].lines[0].prevTotal, 1625)
check('BS section recomputed', processed.elSections[0].prevTotal, 1625)
check('PY-only custom row appended', note.templateRowsAll.filter(r => r.label === 'Capital Reserve (PY only)').length, 1)
check('...and visible without show-zero', note.templateRows.filter(r => r.label === 'Capital Reserve (PY only)').length, 1)
if (by('Securities Premium').manualPyKey !== 'Securities Premium') { fails++; console.log('  FAIL  top-level key must stay the bare label (backward compatibility)') }
else console.log('  PASS  top-level key is the bare label (older saved entries still apply)')
if (by('Unclassified').manualPyKey !== 'General Reserve > Unclassified') { fails++; console.log('  FAIL  child key must be "<parent> > <label>"') }
else console.log('  PASS  child key is "<parent L3> > <label>"')

// ── PL note with an unlabelled-but-real line (e.g. Purchase Accounts under
// "Cost of materials consumed" — mapping-engine.js's
// applyPurchaseAccountsOverride deliberately leaves Level 2 blank there).
// Regression guard for 0.1.26/0.1.27's "not coming in this unclassified row"
// bug: this line used to be skipped by applyManualPyOverrides entirely
// (manualPyEditable never set) purely because its level2 was falsy, even
// though it carries real ledger rows and a real total.
{
  const plLines = [
    { level2: 'Opening Stock of Raw Materials', total: 1000, prevTotal: 800, rows: [{ name: 'Opening RM' }] },
    { level2: '', total: 5000, prevTotal: 4000, rows: [{ name: 'Purchase Ledger A' }, { name: 'Purchase Ledger B' }] },
    { level2: 'Less: Closing Stock of Raw Materials', total: -1200, prevTotal: -900, rows: [{ name: 'Closing RM' }] },
  ]
  const plNote = { num: 12, title: 'Cost of materials consumed', isPL: true, lines: plLines, prevTotal: 4700 }
  const plProcessed = {
    notes: { 12: plNote },
    elSections: [], assetSections: [],
    incomeSections: [], expenseSections: [{ level1: 'Cost of materials consumed', lines: [{ noteNum: 12, prevTotal: 4700, total: 0 }], prevTotal: 4700 }],
  }
  const plEntries = [
    { note_num: 12, note_title: 'Cost of materials consumed', particular_label: 'Opening Stock of Raw Materials', py_amount: 900 },
    { note_num: 12, note_title: 'Cost of materials consumed', particular_label: 'Purchases', py_amount: 4500 },
    { note_num: 12, note_title: 'Cost of materials consumed', particular_label: 'Less: Closing Stock of Raw Materials', py_amount: -1000 },
  ]
  fn(plProcessed, true, plEntries)
  const unclassifiedLine = plNote.lines.find(l => l.level2 === '')
  const ok1 = !!unclassifiedLine && unclassifiedLine.manualPyEditable === true
  if (!ok1) fails++
  console.log(`  ${ok1 ? 'PASS' : 'FAIL'}  unlabelled PL line (Purchase Accounts) is manualPyEditable`)
  const ok2 = unclassifiedLine && unclassifiedLine.prevTotal === 4500
  if (!ok2) fails++
  console.log(`  ${ok2 ? 'PASS' : 'FAIL'}  ...and takes its entry: ${unclassifiedLine?.prevTotal}${ok2 ? '' : ' (expected 4500)'}`)
  const dupeCount = plNote.lines.filter(l => l.level2 === 'Purchases').length
  const ok3 = dupeCount === 0
  if (!ok3) fails++
  console.log(`  ${ok3 ? 'PASS' : 'FAIL'}  no duplicate synthetic "Unclassified" line created: ${dupeCount} extra${ok3 ? '' : ' (expected 0)'}`)
  const ok4 = plNote.prevTotal === 900 + 4500 - 1000
  if (!ok4) fails++
  console.log(`  ${ok4 ? 'PASS' : 'FAIL'}  note total includes the unlabelled line's PY entry: ${plNote.prevTotal}${ok4 ? '' : ' (expected 4400)'}`)
}

// ── Regression guard for the actual bug reported in the field: two DIFFERENT
// notes sharing the SAME note_num (exactly what happens when Consolidated's
// dynamic renumbering shifts everything after some note flips zero/non-zero)
// must NOT show each other's entries. Employee benefits expense and Finance
// Costs both happened to be "note 21" at different moments; their entries
// must stay with their own title, not bleed onto whichever note currently
// holds that number.
{
  const noteA = { num: 21, title: 'Employee benefits expense', isPL: true,
    lines: [{ level2: 'Salaries and wages', total: 100, prevTotal: 0, rows: [{ name: 'x' }] }] }
  const noteB = { num: 21, title: 'Finance costs', isPL: true,
    lines: [{ level2: 'Interest expense', total: 200, prevTotal: 0, rows: [{ name: 'y' }] }] }
  const collisionProcessed = {
    notes: { 21: noteB },  // only noteB is "current" — noteA represents an EARLIER render's numbering
    elSections: [], assetSections: [], incomeSections: [],
    expenseSections: [{ level1: 'Finance costs', lines: [{ noteNum: 21, prevTotal: 200, total: 0 }], prevTotal: 200 }],
  }
  const collisionEntries = [
    // Saved earlier, when note_num 21 meant "Employee benefits expense".
    { note_num: 21, note_title: 'Employee benefits expense', particular_label: 'Salaries and wages', py_amount: 999999 },
    // Saved for the note that ACTUALLY holds note_num 21 right now.
    { note_num: 21, note_title: 'Finance costs', particular_label: 'Interest expense', py_amount: 50 },
  ]
  fn(collisionProcessed, true, collisionEntries)
  const interestLine = noteB.lines.find(l => l.level2 === 'Interest expense')
  const ok1 = interestLine && interestLine.prevTotal === 50
  if (!ok1) fails++
  console.log(`  ${ok1 ? 'PASS' : 'FAIL'}  note keeps only its own title's entry despite a note_num collision: ${interestLine?.prevTotal}`)
  const leaked = noteB.lines.some(l => l.level2 === 'Salaries and wages')
  const ok2 = !leaked
  if (!ok2) fails++
  console.log(`  ${ok2 ? 'PASS' : 'FAIL'}  the OTHER note's particular did not leak in as a synthetic row`)
}

// ── Regression guard for the actual bug reported in the field: a Manual PY
// entry for a plain "Purchases" note -- no Level 2 breakdown at all, every
// line's level2 blank, the common shape when the entity has no raw-material
// stock entries to synthesise Opening/Closing rows from -- saved correctly
// (note.prevTotal, checked above) but never reached the live P&L face. The
// face reads sec.prevTotal off incomeSections/expenseSections directly (see
// PL/index.jsx's buildExpenseBuckets); updateParent() used to require
// line.noteNum === note.num to update it, but PL lines never carry a
// per-line noteNum (only the whole section does) -- so that check silently
// never fired, and sec.prevTotal stayed at its stale pre-override value
// (structurally ~0 for a P&L nominal ledger) forever.
{
  const purchaseLine = { level2: '', total: 50000, prevTotal: 0, rows: [{ name: 'Purchase Ledger A' }, { name: 'Purchase Ledger B' }] }
  const purchasesSec = { level1: 'Purchases of Stock-in-Trade', lines: [purchaseLine], total: 50000, prevTotal: 0, noteNum: 15 }
  // Mirrors processRows(): note.lines = section.lines, same array reference.
  const purchasesNote = { num: 15, title: 'Purchases of Stock-in-Trade', isPL: true, lines: purchasesSec.lines, rows: [], total: 50000, prevTotal: 0 }
  const flatProcessed = {
    notes: { 15: purchasesNote },
    elSections: [], assetSections: [],
    incomeSections: [], expenseSections: [purchasesSec],
  }
  const flatEntries = [
    { note_num: 15, note_title: 'Purchases of Stock-in-Trade', particular_label: '', py_amount: 875000 },
  ]
  fn(flatProcessed, true, flatEntries)
  const ok1 = purchasesNote.prevTotal === 875000
  if (!ok1) fails++
  console.log(`  ${ok1 ? 'PASS' : 'FAIL'}  flat Purchases note itself takes the entry: ${purchasesNote.prevTotal}${ok1 ? '' : ' (expected 875000)'}`)
  const ok2 = purchasesSec.prevTotal === 875000
  if (!ok2) fails++
  console.log(`  ${ok2 ? 'PASS' : 'FAIL'}  ...and reaches the P&L face (sec.prevTotal): ${purchasesSec.prevTotal}${ok2 ? '' : ' (expected 875000 -- this is the reported "PL account showing 0" bug)'}`)
}

// ── Regression guard for the constitution=1 merge: "Cost of materials
// consumed" and "Purchases of Stock-in-Trade" are two separate FACE lines
// (and so two separate sections) sharing ONE combined note. A Manual PY fix
// for the flat case above must not overcorrect by dumping the note's full
// COMBINED total onto both sections -- each section needs only its own
// share, not the total duplicated twice (which would overstate Total
// Expenses by the smaller section's PY figure).
{
  const materialsLine = { level2: 'Opening Stock of Raw Materials', total: 1000, prevTotal: 800, rows: [{ name: 'Opening RM' }] }
  const purchasesLine2 = { level2: '', total: 5000, prevTotal: 4000, rows: [{ name: 'Purchase Ledger A' }] }
  const materialsSec = { level1: 'Cost of materials consumed', lines: [materialsLine], total: 1000, prevTotal: 800, noteNum: 40 }
  const purchasesSec2 = { level1: 'Purchases of Stock-in-Trade', lines: [purchasesLine2], total: 5000, prevTotal: 4000, noteNum: 40 }
  // Mirrors the constitution=1 merge in processRows(): note.lines becomes a
  // NEW combined array, but the individual line objects are the same
  // references as materialsSec.lines/purchasesSec2.lines.
  const mergedNote = {
    num: 40, title: 'Cost of materials consumed', isPL: true,
    lines: [...materialsSec.lines, ...purchasesSec2.lines],
    rows: [], total: 6000, prevTotal: 4800,
  }
  const mergedProcessed = {
    notes: { 40: mergedNote },
    elSections: [], assetSections: [],
    incomeSections: [], expenseSections: [materialsSec, purchasesSec2],
  }
  const mergedEntries = [
    { note_num: 40, note_title: 'Cost of materials consumed', particular_label: 'Opening Stock of Raw Materials', py_amount: 900 },
    { note_num: 40, note_title: 'Cost of materials consumed', particular_label: 'Purchases', py_amount: 4500 },
  ]
  fn(mergedProcessed, true, mergedEntries)
  const ok1 = mergedNote.prevTotal === 5400
  if (!ok1) fails++
  console.log(`  ${ok1 ? 'PASS' : 'FAIL'}  merged note's combined total: ${mergedNote.prevTotal}${ok1 ? '' : ' (expected 5400 = 900+4500)'}`)
  const ok2 = materialsSec.prevTotal === 900
  if (!ok2) fails++
  console.log(`  ${ok2 ? 'PASS' : 'FAIL'}  "Cost of materials consumed" face line gets only its own share: ${materialsSec.prevTotal}${ok2 ? '' : ' (expected 900, not the full 5400)'}`)
  const ok3 = purchasesSec2.prevTotal === 4500
  if (!ok3) fails++
  console.log(`  ${ok3 ? 'PASS' : 'FAIL'}  "Purchases of Stock-in-Trade" face line gets only its own share: ${purchasesSec2.prevTotal}${ok3 ? '' : ' (expected 4500, not the full 5400)'}`)
}

// ── Revenue from operations split into Sale of Goods / Sale of Services (0.1.78).
// A Previous Year typed against the old line "Sale" must still reach the P&L —
// it used to land on an orphan "Sale" line and leave Goods / Services blank.
{
  const mk = () => {
    const g = { level2: 'Sale of Goods', total: 900, prevTotal: 0, rows: [{ name: 'S1' }] }
    const s = { level2: 'Sale of Services', total: 100, prevTotal: 0, rows: [{ name: 'S2' }] }
    const n = { num: 11, title: 'Revenue from operations', isPL: true, lines: [g, s], prevTotal: 0 }
    const sec = { level1: 'Revenue from operations', noteNum: 11, lines: n.lines, total: 1000, prevTotal: 0 }
    return { g, s, n, sec, p: { notes: { 11: n }, elSections: [], assetSections: [], incomeSections: [sec], expenseSections: [] } }
  }
  const e = (label, amt) => ({ note_num: 11, note_title: 'Revenue from operations', particular_label: label, py_amount: amt })
  let t = mk()
  fn(t.p, true, [e('Sale', 5000)])
  check('old "Sale" Previous Year reaches the P&L face', t.sec.prevTotal, 5000)
  check('...on Sale of Goods', t.g.prevTotal, 5000)
  check('...with no orphan "Sale" line left', t.n.lines.filter(l => l.level2 === 'Sale').length, 0)
  t = mk()
  fn(t.p, true, [e('Sale', 5000), e('Sale of Goods', 7000)])
  check('a figure typed on Sale of Goods wins over the old "Sale" one', t.sec.prevTotal, 7000)
  t = mk()
  fn(t.p, true, [e('Sale', 5000), e('Sale of Goods', 3000)])
  check('...and the old one is not counted twice', t.n.lines.reduce((a, l) => a + l.prevTotal, 0), 3000)
}

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
