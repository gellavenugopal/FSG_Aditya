/**
 * Pre-release self-test: the Notes screen, the PDF and the Excel export show
 * the same figures, with a separate Previous Year Trial Balance selected — the
 * Balance Sheet and P&L lines, every note line and total, and every annexure
 * sub-total. Excel's formulas are worked out the way Excel works them out.
 *
 * Shaped like Santosh Kumar Gupta's server data (13 Sep 2026; exported with
 * 0.1.34, and 0.1.35 did the same):
 *  - Purchases of Stock-in-Trade holds Purchase Accounts only, with no Level 2,
 *    and last year had a purchase ledger this year does not. Excel showed last
 *    year's Purchases as 0.00; the PDF showed 11,16,882.00.
 *  - Changes in inventories: Excel added last year's closing stock instead of
 *    subtracting it, 16,33,385.84 against the PDF's (1,51,103.54).
 *  - Last year a creditor was in debit (that year's Trial Balance put it under
 *    Advance to Suppliers) and two customers were in credit (Advance from
 *    Customers). The Notes screen and the PDF took each line's Previous Year
 *    from this year's opening balances, so the lines did not add up to their
 *    totals — Trade payables 92,785.00 (total 2,76,416.00), Trade receivables
 *    1,05,745.00 (total 1,49,985.50), Advance to Suppliers nil (Other current
 *    assets 1,82,712.10) — while Excel showed last year's own figures.
 *
 * Also: a Balance Sheet note whose ledgers carry no Level 3 prints the same
 * lines on all three, and the Excel export writes a link that would not give
 * the app's figure as that figure (checked on a workbook with a wrong link).
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that
 * source — e.g. an unzipped releases\fsg-bharat-0.1.35-source.zip — to prove
 * they fail where the bugs were.
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-figures-agree.mjs
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = process.env.FSG_SRC_ROOT ? path.resolve(process.env.FSG_SRC_ROOT) : root
const require = createRequire(import.meta.url)
const esbuild = require(path.join(root, 'node_modules', 'esbuild'))
const XLSX = require(path.join(root, 'node_modules', 'xlsx-js-style'))

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + detail}`)
}
const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.01
const readSrc = (rel) => { try { return fs.readFileSync(path.join(srcRoot, ...rel.split('/')), 'utf8') } catch { return '' } }
const inr = (n) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Each module bundled on its own, so an older source missing one export fails
// only the checks that need it.
const REACT_SHIM = 'const React = { createElement: () => null, useCallback: (f) => f }; export default React; export const useState = () => []; export const useEffect = () => {}; export const useRef = () => ({}); export const useMemo = (f) => f(); export const useCallback = (f) => f;'
async function load(rel) {
  const file = path.join(srcRoot, ...rel.split('/'))
  if (!fs.existsSync(file)) return { __missing: `${rel} does not exist` }
  const built = await esbuild.build({
    stdin: { contents: `export * from ${JSON.stringify(file)}\n`, resolveDir: srcRoot, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [{
      name: 'selftest-shims',
      setup(b) {
        b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
        b.onLoad({ filter: /^react$/, namespace: 'shim' }, () => ({ contents: REACT_SHIM, loader: 'js' }))
      },
    }],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-agree-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try { return await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
}

// ── Fixture: Santosh Kumar Gupta, Proprietorship, Trader ─────────────────────
const E = 'EQUITY AND LIABILITIES', A = 'ASSETS'
const TP = 'Trade payables', TR = 'Trade receivables', OCA = 'Other current assets', OCL = 'Other current liabilities'
const SDP_L4 = 'GST payable / TDS payable / TCS payable / Provident fund and ESI payable / Professional tax payable / Others'
const GST_L3 = 'Balances with Government Authorities (GST Input credit and other tax credit)'
const LF = [
  { alie: E, level1: 'Current liabilities', level2: 'Short-term borrowings', level3: 'Loans repayable on demand', level5: 'Secured / Unsecured' },
  { alie: E, level1: 'Current liabilities', level2: TP, level3: 'Due to Micro and Small Enterprises' },
  { alie: E, level1: 'Current liabilities', level2: TP, level3: 'Due to Creditors other than MSME' },
  { alie: E, level1: 'Current liabilities', level2: OCL, level3: 'Advance from Customers' },
  // Level 4 as Mapping_v2.xlsx defines it; the ledgers below also still carry an
  // older Level 5 (EPF / GST / TDS Payable) — a second breakdown of the same figure.
  { alie: E, level1: 'Current liabilities', level2: OCL, level3: 'Statutory dues payable', level4: SDP_L4 },
  { alie: E, level1: 'Current liabilities', level2: 'Short-term provisions', level3: 'Audit Fees Payable' },
  { alie: A, level1: 'Non-current assets', level2: 'Long-term loans and advances', level3: 'Other loans and advances', level5: 'Unsecured, considered good / Doubtful' },
  { alie: A, level1: 'Current assets', level2: 'Inventories', level3: 'Stock-in-Trade' },
  { alie: A, level1: 'Current assets', level2: TR, level3: 'Unsecured, considered good' },
  { alie: A, level1: 'Current assets', level2: TR, level3: 'Doubtful' },
  { alie: A, level1: 'Current assets', level2: 'Cash and bank balances', level3: 'Balances with banks' },
  { alie: A, level1: 'Current assets', level2: 'Cash and bank balances', level3: 'Cash on hand' },
  { alie: A, level1: 'Current assets', level2: OCA, level3: 'Advance to Suppliers' },
  { alie: A, level1: 'Current assets', level2: OCA, level3: GST_L3 },
  { alie: 'Income', level1: 'Revenue from operations', level2: 'Sale', level3: null },
  { alie: 'Income', level1: 'Closing Stock (PL)', level2: null, level3: null },
  { alie: 'Expenses', level1: 'Purchases of Stock-in-Trade', level2: null, level3: null },
  { alie: 'Expenses', level1: 'Opening Stock (PL)', level2: null, level3: null },
  { alie: 'Expenses', level1: 'Employee benefits expense', level2: 'Salaries and wages', level3: null },
  { alie: 'Expenses', level1: 'Finance costs', level2: 'Interest expense', level3: null },
  { alie: 'Expenses', level1: 'Other expenses', level2: 'Rent', level3: null },
  { alie: 'Expenses', level1: 'Other expenses', level2: 'Audit Fees', level3: null },
]
// As stored in tb_rows: Dr negative, Cr positive.
function row(name, alie, level1, level2, level3, closing, opening = 0, extra = {}) {
  return {
    name, ledger_name: name, ledger_code: '', alie,
    level1, mapping1_resultant: level1, level2: level2 || null, mapping2_resultant: level2 || null,
    level3: level3 || null, mapping3_resultant: level3 || null,
    level4_value: extra.level4 || null, level5_value: extra.level5 || null, level6_value: null, level7_value: null,
    closing_balance: String(closing), opening_balance: String(opening),
    status: extra.status || 'user_approved', upload_nature: extra.nature || null, sort_order: null,
  }
}
const STOCK = { nature: 'Stock Entry', level5: 'Stock-in-Trade' }
// Siliguri Merchantile's Statutory dues payable (25 Sep 2026): Level 4 + a stale Level 5.
const SD = 'Statutory dues payable'
const TDS = { level4: 'TDS payable', level5: 'TDS Payable' }, EPF = { level4: 'Provident fund and ESI payable', level5: 'EPF Payable' }, GSTP = { level4: 'GST payable', level5: 'GST Payable' }
const cyRows = () => [
  row('Santosh Kumar Gupta', E, "Owners' Funds", "Owners' Capital Account", null, 201116.40, 415783.76),
  row('STATE BANK LON (4819274)', E, 'Current liabilities', 'Short-term borrowings', 'Loans repayable on demand', 759207, 1238866, { level5: 'Unsecured' }),
  row('Nirmal Export & Import', E, 'Current liabilities', TP, 'Due to Creditors other than MSME', 20388600, 276416),
  row('PURNA KAMI', E, 'Current liabilities', TP, 'Due to Creditors other than MSME', 50000, -183631),   // in debit last year
  row('Audit Fees Payable', E, 'Current liabilities', 'Short-term provisions', 'Audit Fees Payable', 8000),
  row('TDS (Salary)', E, 'Current liabilities', OCL, SD, 144000, 337930, TDS),
  row('TDS ON RENT', E, 'Current liabilities', OCL, SD, 12000, 24000, TDS),
  row('TDS (Contractor)', E, 'Current liabilities', OCL, SD, 11607.5, 4964.4, TDS),
  row('EPF Payable', E, 'Current liabilities', OCL, SD, 0, 30027, EPF),
  row('RCM Output IGST (Payable)', E, 'Current liabilities', OCL, SD, 0, 3900, GSTP),
  row('Security Deposit', A, 'Non-current assets', 'Other non-current assets', null, -20000, -20000),  // no Level 3 at all
  row('NIRMA GUPTA', A, 'Non-current assets', 'Long-term loans and advances', 'Other loans and advances', -200000, -200000, { level5: 'Unsecured, considered good' }),
  row('Closing Stock - BS - Stock-in-Trade', A, 'Current assets', 'Inventories', 'Closing Stock (BS)', -1537303.92, -892244.69, STOCK),
  row('GEETANJALI TRADERS', A, 'Current assets', TR, 'Unsecured, considered good', -16578637, -149985.5),
  row('Puspa Enterprise', A, 'Current assets', TR, 'Unsecured, considered good', -315275),
  row('Sachin Sharma (Slg)', A, 'Current assets', TR, 'Unsecured, considered good', 0, 9240.5),        // in credit last year
  row('Sachin Sharma (Bindu)', A, 'Current assets', TR, 'Unsecured, considered good', 0, 35000),
  row('STATE BANK OF INDIA (1170166)', A, 'Current assets', 'Cash and bank balances', 'Balances with banks', -3098806.05, -328526.61),
  row('Cash', A, 'Current assets', 'Cash and bank balances', 'Cash on hand', -349664.30, -379626.20),
  row('MANISH GUPTA', A, 'Current assets', OCA, 'Advance to Suppliers', -7000),
  row('GST NETT', A, 'Current assets', OCA, GST_L3, -123622.5, 918.9, { status: 'user_override' }),
  row('IGST on Import', A, 'Current assets', OCA, GST_L3, 2307, 0, { status: 'user_override' }),
  row('Sales 5%', 'Income', 'Revenue from operations', 'Sale', null, 106387500),
  row('SALE GST NIL', 'Income', 'Revenue from operations', 'Sale', null, 80415),
  row('IGST SALES', 'Income', 'Revenue from operations', 'Sale', null, 300000),
  row('Closing Stock - PL - Stock-in-Trade', 'Income', 'Closing Stock (PL)', null, null, 1537303.92, 0, STOCK),
  row('Opening Stock - Stock-in-Trade', 'Expenses', 'Opening Stock (PL)', null, null, -892244.69, 0, STOCK),
  row('Purchase Gst 5%', 'Expenses', 'Purchases of Stock-in-Trade', null, null, -186000),
  row('Purchase Unragistar', 'Expenses', 'Purchases of Stock-in-Trade', null, null, -64162),
  row('PURCHASE 5% ( Unragister)', 'Expenses', 'Purchases of Stock-in-Trade', null, null, -69365975),
  row('PURCHSE IMPORT', 'Expenses', 'Purchases of Stock-in-Trade', null, null, -36363750),
  row('SALARY', 'Expenses', 'Employee benefits expense', 'Salaries and wages', null, -180000),
  row('Interest on loan', 'Expenses', 'Finance costs', 'Interest expense', null, -96805),
  row('Rent', 'Expenses', 'Other expenses', 'Rent', null, -300000),
  row('Audit Fees', 'Expenses', 'Other expenses', 'Audit Fees', null, -8000),
]
const pyRows = () => [
  row('Santosh Kumar Gupta', E, "Owners' Funds", "Owners' Capital Account", null, 415783.76),
  row('STATE BANK LON (4819274)', E, 'Current liabilities', 'Short-term borrowings', 'Loans repayable on demand', 1238866, 0, { level5: 'Unsecured' }),
  row('Nirmal Export & Import', E, 'Current liabilities', TP, 'Due to Creditors other than MSME', 276416),
  row('PURNA KAMI', A, 'Current assets', OCA, 'Advance to Suppliers', -183631),
  row('Sachin Sharma (Slg)', E, 'Current liabilities', OCL, 'Advance from Customers', 9240.5),
  row('Sachin Sharma (Bindu)', E, 'Current liabilities', OCL, 'Advance from Customers', 35000),
  row('TDS (Salary)', E, 'Current liabilities', OCL, SD, 337930, 0, TDS),
  row('TDS ON RENT', E, 'Current liabilities', OCL, SD, 24000, 0, TDS),
  row('TDS (Contractor)', E, 'Current liabilities', OCL, SD, 4964.4, 0, TDS),
  row('EPF Payable', E, 'Current liabilities', OCL, SD, 30027, 0, EPF),
  row('RCM Output IGST (Payable)', E, 'Current liabilities', OCL, SD, 3900, 0, GSTP),
  row('Security Deposit', A, 'Non-current assets', 'Other non-current assets', null, -20000),
  row('NIRMA GUPTA', A, 'Non-current assets', 'Long-term loans and advances', 'Other loans and advances', -200000, 0, { level5: 'Unsecured, considered good' }),
  row('Closing Stock - BS - Stock-in-Trade', A, 'Current assets', 'Inventories', 'Closing Stock (BS)', -892244.69, 0, STOCK),
  row('GEETANJALI TRADERS', A, 'Current assets', TR, 'Unsecured, considered good', -149985.5),
  row('STATE BANK OF INDIA (1170166)', A, 'Current assets', 'Cash and bank balances', 'Balances with banks', -328526.61),
  row('Cash', A, 'Current assets', 'Cash and bank balances', 'Cash on hand', -379626.20),
  row('GST NETT', A, 'Current assets', OCA, GST_L3, 918.9, 0, { status: 'user_override' }),
  row('Sales 5%', 'Income', 'Revenue from operations', 'Sale', null, 1080000),
  row('SALE GST NIL', 'Income', 'Revenue from operations', 'Sale', null, 137675),
  row('Closing Stock - PL - Stock-in-Trade', 'Income', 'Closing Stock (PL)', null, null, 892244.69, 0, STOCK),
  row('Opening Stock - Stock-in-Trade', 'Expenses', 'Opening Stock (PL)', null, null, -741141.15, 0, STOCK),
  row('Purchase Unragistar', 'Expenses', 'Purchases of Stock-in-Trade', null, null, -975026),
  row('PURCHASE 12%', 'Expenses', 'Purchases of Stock-in-Trade', null, null, -141856),               // last year only
  row('Interest on loan', 'Expenses', 'Finance costs', 'Interest expense', null, -159438),
  row('Rent', 'Expenses', 'Other expenses', 'Rent', null, -30000),
  row('Audit Fees', 'Expenses', 'Other expenses', 'Audit Fees', null, -10220.70),
]

const entity = { id: 7, name: 'Santosh Kumar Gupta', constitution: 1, constitution_display: 'Proprietorship', business_type: 'Trader' }
const activeTB = { id: 1, period: '2025-04-01 To 2026-03-31' }
const prevTB = { id: 2, period: '2024-04-01 To 2025-03-31' }
globalThis.window = {
  api: {
    getFinancialData: async (id) => (id === 1 ? cyRows() : id === 2 ? pyRows() : []),
    getLevelFormat: async () => LF.map(r => ({ ...r })),
    listNoteDetails: async () => [],
    depGet: async () => null, depITGet: async () => null, depCompGet: async () => null,
    getManualPY: async () => false, listManualPyEntries: async () => [],
    getPlClosedToCapital: async () => false,
    getGeneralNotes: async () => null,
  },
}

console.log(`\nFigures self-test: Notes screen = PDF = Excel${srcRoot !== root ? `  (source: ${srcRoot})` : ''}`)

const fin = await load('src/renderer/src/hooks/useFinancials.js')
const ag = await load('src/renderer/src/utils/annexureGrouping.js')
const html = await load('src/renderer/src/components/GenerateFinancials/buildHTML.js')
const xl = await load('src/renderer/src/components/GenerateFinancials/buildExcel.js')
// PDF / Excel note layout (0.1.71): a Level 3 whose breakdown adds up to it is a
// blank header, and a repeat breakdown of the same figure is not printed.
const nh = await load('src/renderer/src/utils/noteRowHeaders.js')

const data = await fin.fetchFinancialsData(activeTB, prevTB, entity, null)
data.manualTaxLines = []
const notes = (data.activeNotes || Object.values(data.notes)).filter(n => !n.isEmpty)
const noteNamed = (t) => notes.find(n => String(n.title).toLowerCase() === t.toLowerCase())

// ── What the Notes screen shows ─────────────────────────────────────────────
const notesScreen = readSrc('src/renderer/src/components/Notes/index.jsx')
function screenLines(note) {
  if (note.isPL) {
    return typeof ag.plNoteLines === 'function'
      ? ag.plNoteLines(note).map(({ line, label }) => ({ label, cy: line.total, py: line.prevTotal, subtotal: !!line.isSubtotal }))
      : (note.lines || []).filter(l => l.level2).map(l => ({ label: l.level2, cy: l.total, py: l.prevTotal, subtotal: !!l.isSubtotal }))
  }
  const rows = (note.templateRows || []).filter(r => !r.isMSME && !r.isMSMEHeader && !r.isCashBank && !r.isCashBankHeader)
  if (rows.length) return rows.map(r => ({ label: r.unclassified ? 'Unclassified' : r.label, cy: r.cy, py: r.py, type: r.type, subtotal: !!r.isSubtotal, raw: r }))
  if (typeof ag.bsNoteFallbackLines === 'function') {
    return ag.bsNoteFallbackLines(note, fin.displayAmt).map(l => ({ label: l.label, cy: l.cy, py: l.py, type: 'l3', subtotal: !!l.isSubtotal }))
  }
  // This source's own screen: its ledgers by Level 3, a ledger with no Level 3 forming no line.
  const byL3 = new Map()
  for (const r of note.rows || []) {
    const l3 = r.mapping3_resultant || r.level3 || ''
    if (!byL3.has(l3)) byL3.set(l3, [])
    byL3.get(l3).push(r)
  }
  return [...byL3.entries()].filter(([l3]) => l3).map(([l3, rows]) => ({
    label: l3, type: 'l3', subtotal: rows.some(r => r.isSubtotal),
    cy: rows.reduce((s, r) => s + fin.displayAmt(r, 'closing_balance'), 0),
    py: rows.reduce((s, r) => s + fin.displayAmt(r, 'opening_balance'), 0),
  }))
}

// What the PDF and Excel print for a note: the screen's lines, laid out by
// printNoteRows where this source has it — a header's cells are blank (0 here).
function printLines(note) {
  const screen = screenLines(note)
  if (typeof nh.printNoteRows !== 'function' || !screen.some(l => l.raw)) return screen
  return nh.printNoteRows(screen.map(l => l.raw)).map(r => ({
    label: r.unclassified ? 'Unclassified' : r.label,
    cy: r.header ? 0 : r.cy, py: r.header ? 0 : r.py, type: r.type, subtotal: !!r.isSubtotal,
  }))
}

// ── The PDF ─────────────────────────────────────────────────────────────────
let pdfHtml = ''
try {
  pdfHtml = html.buildFinancialsHTML({ entity, activeTB, prevTB, data, auditor: null, signatories: [], signPlace: 'Siliguri', signDate: '2026-09-13' })
    .replace(/<template[\s\S]*?<\/template>/g, '')
} catch (e) { ok('the PDF document builds', false, e.stack) }
const decode = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
const parseINR = (s) => {
  const t = decode(s)
  if (!t || t === '—' || t === '-') return 0
  const n = parseFloat(t.replace(/[(),]/g, '')) || 0
  return /^\(.*\)$/.test(t) ? -n : n
}
const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const htmlTitle = (t) => escRx(String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'))
const cellsOf = (tr) => [...tr.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map(m => ({ attrs: m[1], html: m[2] }))
function pdfNote(note) {
  const m = new RegExp(`>Note ${note.num}: ${htmlTitle(note.title)}</div>\\s*<table class="fs-table" data-flow-table>([\\s\\S]*?)</table>`).exec(pdfHtml)
  if (!m) return null
  const rows = []
  let total = null
  for (const tr of m[1].matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)) {
    const cells = cellsOf(tr[2])
    if (cells.length !== 4) continue
    if (/total-row/.test(tr[1])) { total = { cy: parseINR(cells[2].html), py: parseINR(cells[3].html) }; continue }
    rows.push({ label: decode(cells[0].html), cy: parseINR(cells[2].html), py: parseINR(cells[3].html) })
  }
  return { rows, total }
}
function pdfAnnexure(note) {
  const m = new RegExp(`>Note ${note.num}: ${htmlTitle(note.title)}</div>\\s*<table class="fs-table annex-table" data-flow-table>([\\s\\S]*?)</table>`).exec(pdfHtml)
  if (!m) return null
  const groups = []
  let total = null
  for (const tr of m[1].matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)) {
    const cells = cellsOf(tr[2])
    if (/total-row/.test(tr[1])) { const r = cells.filter(c => /class="right"/.test(c.attrs)); total = { cy: parseINR(r[0]?.html), py: parseINR(r[1]?.html) }; continue }
    if (cells.length < 7) continue
    const [, groupCY, , groupPY] = cells.slice(-4)
    if (!decode(groupCY.html)) continue
    groups.push({ cy: parseINR(groupCY.html), py: parseINR(groupPY.html) })
  }
  return { groups, total }
}
function pdfFace(title) {
  const m = new RegExp(`<div class="statement-title">${escRx(title)}</div>[\\s\\S]*?<table class="fs-table compact-table">([\\s\\S]*?)</table>`).exec(pdfHtml)
  if (!m) return null
  const rows = []
  for (const tr of m[1].matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)) {
    const cells = cellsOf(tr[2])
    const right = cells.filter(c => /class="right/.test(c.attrs))
    if (right.length !== 2) continue
    rows.push({ label: decode(cells[0].html), cy: parseINR(right[0].html), py: parseINR(right[1].html) })
  }
  return rows
}

// ── Excel, formulas worked out ──────────────────────────────────────────────
let wb = null
try {
  wb = xl.buildFinancialsWorkbook({ entity, activeTB, prevTB, data, levelFormat: LF, auditor: null, signatories: [], signPlace: 'Siliguri', signDate: '2026-09-13' })
} catch (e) { ok('the Excel workbook builds', false, e.stack) }
const evaluate = workbookEvaluator(wb)
const cellText = (ws, r, c) => String(ws?.[XLSX.utils.encode_cell({ c, r })]?.v ?? '')
function sheetBlock(sheetName, note) {
  const ws = wb?.Sheets?.[sheetName]
  if (!ws) return null
  const range = XLSX.utils.decode_range(ws['!ref'])
  let r = range.s.r
  while (r <= range.e.r && cellText(ws, r, 0) !== `Note ${note.num}: ${note.title}`) r++
  if (r > range.e.r) return null
  const out = []
  for (r++; r <= range.e.r && !/^Note \d+: /.test(cellText(ws, r, 0)); r++) out.push(r)
  return { ws, rows: out }
}
function excelNote(note) {
  const b = sheetBlock('Notes', note)
  if (!b) return null
  const rows = []
  for (const r of b.rows) {
    const label = cellText(b.ws, r, 0).trim()
    if (!label) continue
    const cy = evaluate('Notes', XLSX.utils.encode_cell({ c: 2, r })), py = evaluate('Notes', XLSX.utils.encode_cell({ c: 3, r }))
    if (label === 'Total') return { rows, total: { cy, py } }
    rows.push({ label, cy, py })
  }
  return { rows, total: null }
}
function excelAnnexure(note) {
  const b = sheetBlock('Annexures', note)
  if (!b) return null
  const groups = []
  for (const r of b.rows) {
    const label = cellText(b.ws, r, 0).trim()
    const at = (c) => evaluate('Annexures', XLSX.utils.encode_cell({ c, r }))
    if (label === 'Total') return { groups, total: { cy: at(4), py: at(6) } }
    // A sub-total row: its CY (E) or — for a line only last year had — its PY (G) cell holds a figure.
    const isFig = (x) => !!x && (!!x.f || typeof x.v === 'number')
    if (!isFig(b.ws[XLSX.utils.encode_cell({ c: 4, r })]) && !isFig(b.ws[XLSX.utils.encode_cell({ c: 6, r })])) continue
    groups.push({ cy: at(4), py: at(6) })
  }
  return { groups, total: null }
}
function excelFace(sheetName) {
  const ws = wb?.Sheets?.[sheetName]
  if (!ws) return null
  const range = XLSX.utils.decode_range(ws['!ref'])
  const rows = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const c = ws[XLSX.utils.encode_cell({ c: 2, r })], d = ws[XLSX.utils.encode_cell({ c: 3, r })]
    const isFigure = (x) => x && (x.f || typeof x.v === 'number')
    if (!isFigure(c) && !isFigure(d)) continue
    rows.push({ label: cellText(ws, r, 0).trim(), cy: evaluate(sheetName, XLSX.utils.encode_cell({ c: 2, r })), py: evaluate(sheetName, XLSX.utils.encode_cell({ c: 3, r })) })
  }
  return rows
}

const show = (list) => list.map(l => `${l.label} ${inr(l.cy)} / ${inr(l.py)}`).join('; ')
const sameLines = (x, y) => x.length === y.length && x.every((l, i) => l.label === y[i].label && near(l.cy, y[i].cy) && near(l.py, y[i].py))
const lineOf = (list, label) => (list || []).find(l => l.label === label)

// ── 1. The Santosh figures ──────────────────────────────────────────────────
console.log('\n1. The figures that differed')
{
  const purchases = noteNamed('Purchases of Stock-in-Trade')
  ok('app: Purchases of Stock-in-Trade 10,59,79,887.00 / 11,16,882.00', !!purchases && near(purchases.total, 105979887) && near(purchases.prevTotal, 1116882),
    purchases ? `${inr(purchases.total)} / ${inr(purchases.prevTotal)}` : 'note missing')
  const xPurchases = purchases && excelNote(purchases)
  ok('Excel Notes: Purchases of Stock-in-Trade total 10,59,79,887.00 / 11,16,882.00', !!xPurchases?.total && near(xPurchases.total.cy, 105979887) && near(xPurchases.total.py, 1116882),
    xPurchases?.total ? `${inr(xPurchases.total.cy)} / ${inr(xPurchases.total.py)}` : 'not found')
  const xPL = excelFace('Profit & Loss') || []
  const xPurchLine = xPL.find(l => /Purchases of Stock-in-Trade/i.test(l.label))
  ok('Excel P&L: Purchases of Stock-in-Trade 10,59,79,887.00 / 11,16,882.00', !!xPurchLine && near(xPurchLine.cy, 105979887) && near(xPurchLine.py, 1116882),
    xPurchLine ? `${inr(xPurchLine.cy)} / ${inr(xPurchLine.py)}` : 'not found')

  const changes = notes.find(n => /changes in inventor/i.test(n.title))
  const xChanges = changes && excelNote(changes)
  ok('Excel Notes: Changes in inventories total (6,45,059.23) / (1,51,103.54)', !!xChanges?.total && near(xChanges.total.cy, -645059.23) && near(xChanges.total.py, -151103.54),
    xChanges?.total ? `${inr(xChanges.total.cy)} / ${inr(xChanges.total.py)}` : 'not found')
  const xChangeLine = xPL.find(l => /Changes in inventories/i.test(l.label))
  ok('Excel P&L: Changes in inventories (6,45,059.23) / (1,51,103.54)', !!xChangeLine && near(xChangeLine.cy, -645059.23) && near(xChangeLine.py, -151103.54),
    xChangeLine ? `${inr(xChangeLine.cy)} / ${inr(xChangeLine.py)}` : 'not found')

  const expectLine = (title, label, py, why) => {
    const note = noteNamed(title)
    const screen = note ? screenLines(note) : []
    const pdf = note ? pdfNote(note) : null
    const excel = note ? excelNote(note) : null
    const s = lineOf(screen, label), p = lineOf(pdf?.rows, label), x = lineOf(excel?.rows, label)
    ok(`${title} > ${label}: Previous Year ${inr(py)} on the screen, in the PDF and in Excel (${why})`,
      !!s && !!p && !!x && near(s.py, py) && near(p.py, py) && near(x.py, py),
      `screen ${s ? inr(s.py) : 'missing'}, PDF ${p ? inr(p.py) : 'missing'}, Excel ${x ? inr(x.py) : 'missing'}`)
  }
  expectLine(TP, 'Due to Creditors other than MSME', 276416, 'not 92,785.00 from this year\'s opening balances')
  expectLine(TR, 'Unsecured, considered good', 149985.5, 'not 1,05,745.00')
  expectLine(OCA, 'Advance to Suppliers', 183631, 'not nil')
  expectLine(OCA, GST_L3, -918.9, 'unchanged')
  expectLine(OCL, 'Advance from Customers', 44240.5, 'a note only last year had')
}

// ── 1b. No subtotal inside a note in the PDF / Excel (Siliguri, 25 Sep 2026) ─
console.log('\n1b. PDF / Excel: a Level 3 with a breakdown is a header; no breakdown printed twice')
{
  const note = noteNamed(OCL)
  const pdf = note ? pdfNote(note) : null, excel = note ? excelNote(note) : null
  const screen = note ? screenLines(note) : []
  const s3 = lineOf(screen, SD)
  ok(`Notes screen still shows "${SD}" with its figure 1,67,607.50 / 4,00,821.40`, !!s3 && near(s3.cy, 167607.5) && near(s3.py, 400821.4), s3 ? `${inr(s3.cy)} / ${inr(s3.py)}` : 'missing')
  for (const [where, got] of [['PDF', pdf], ['Excel', excel]]) {
    const labels = (got?.rows || []).map(l => l.label)
    const hdr = lineOf(got?.rows, SD)
    ok(`${where}: "${SD}" is a header with no amount`, !!hdr && near(hdr.cy, 0) && near(hdr.py, 0), hdr ? `${inr(hdr.cy)} / ${inr(hdr.py)}` : 'missing')
    const tds = lineOf(got?.rows, 'TDS payable'), pf = lineOf(got?.rows, 'Provident fund and ESI payable'), gst = lineOf(got?.rows, 'GST payable')
    ok(`${where}: its lines carry the figures — TDS 1,67,607.50 / 3,66,894.40, PF and ESI — / 30,027.00, GST — / 3,900.00`,
      !!tds && !!pf && !!gst && near(tds.cy, 167607.5) && near(tds.py, 366894.4) && near(pf.cy, 0) && near(pf.py, 30027) && near(gst.cy, 0) && near(gst.py, 3900),
      [tds, pf, gst].map(l => l ? `${l.label} ${inr(l.cy)} / ${inr(l.py)}` : 'missing').join('; '))
    ok(`${where}: the repeat Level 5 breakdown (EPF / GST / TDS Payable) is not printed`,
      !labels.includes('EPF Payable') && !labels.includes('GST Payable') && !labels.includes('TDS Payable'), labels.join(' | '))
    const sum = (k) => (got?.rows || []).reduce((t, l) => t + (Number(l[k]) || 0), 0)
    ok(`${where}: the printed lines add up to the note Total ${inr(note?.total)} / ${inr(note?.prevTotal)}`,
      !!got?.total && near(sum('cy'), note.total) && near(sum('py'), note.prevTotal) && near(got.total.cy, note.total) && near(got.total.py, note.prevTotal),
      `lines ${inr(sum('cy'))} / ${inr(sum('py'))}, Total ${inr(got?.total?.cy)} / ${inr(got?.total?.py)}`)
  }
  const face = pdfFace('Balance Sheet') || []
  const faceLine = face.find(l => l.label.trim().toLowerCase().endsWith(OCL.toLowerCase()))   // label carries a '(c)' prefix
  ok('Balance Sheet face: Other current liabilities unchanged (= the note total)', !!faceLine && near(faceLine.cy, note?.total) && near(faceLine.py, note?.prevTotal),
    faceLine ? `${inr(faceLine.cy)} / ${inr(faceLine.py)}` : 'not found')
}

// ── 2. Every note: same lines, same totals, lines adding up ────────────────
console.log('\n2. Every note: the same lines and total on the screen, in the PDF and in Excel')
{
  // Balance Sheet notes whose every ledger, both years, has a Level 3 — their
  // lines must add up to the note's total.
  const additiveBS = new Set([TP, TR, OCA, OCL, 'Short-term borrowings', 'Short-term provisions', 'Cash and bank balances', 'Inventories', 'Long-term loans and advances'].map(t => t.toLowerCase()))
  for (const note of notes) {
    const tag = `Note ${note.num} ${note.title}`
    const screen = screenLines(note)
    const printed = printLines(note)
    const pdf = pdfNote(note)
    const excel = excelNote(note)
    ok(`${tag}: PDF lines = screen lines (print layout)`, !!pdf && sameLines(pdf.rows, printed), pdf ? `PDF [${show(pdf.rows)}] vs expected [${show(printed)}]` : 'not found in the PDF')
    ok(`${tag}: Excel lines = screen lines (print layout)`, !!excel && sameLines(excel.rows, printed), excel ? `Excel [${show(excel.rows)}] vs expected [${show(printed)}]` : 'not found in Excel')
    ok(`${tag}: PDF and Excel totals = the app's ${inr(note.total)} / ${inr(note.prevTotal)}`,
      !!pdf?.total && !!excel?.total && near(pdf.total.cy, note.total) && near(pdf.total.py, note.prevTotal) && near(excel.total.cy, note.total) && near(excel.total.py, note.prevTotal),
      `PDF ${inr(pdf?.total?.cy)} / ${inr(pdf?.total?.py)}, Excel ${inr(excel?.total?.cy)} / ${inr(excel?.total?.py)}`)
    const adds = note.isPL ? screen.length > 0 : additiveBS.has(String(note.title).toLowerCase())
    if (adds) {
      const leaves = screen.filter(l => !l.subtotal && (note.isPL || l.type === 'l3'))
      const cy = leaves.reduce((s, l) => s + (Number(l.cy) || 0), 0), py = leaves.reduce((s, l) => s + (Number(l.py) || 0), 0)
      ok(`${tag}: its lines add up to its total`, near(cy, note.total) && near(py, note.prevTotal), `lines ${inr(cy)} / ${inr(py)}, total ${inr(note.total)} / ${inr(note.prevTotal)}`)
    }
  }
  ok('the Notes screen shows a note with no template lines through the shared definition (bsNoteFallbackLines)',
    typeof ag.bsNoteFallbackLines === 'function' && /bsNoteFallbackLines\(note/.test(notesScreen), ag.__missing || 'not used by Notes/index.jsx')
}

// ── 3. Balance Sheet and P&L ────────────────────────────────────────────────
console.log('\n3. Balance Sheet and P&L: every line in the PDF = the same line in Excel')
{
  const norm = (s) => String(s || '').replace(/^\s*(\([a-z0-9]{1,4}\)|[IVXL]+\.)\s*/i, '').replace(/\s+/g, ' ').trim().toLowerCase()
  for (const [title, sheet] of [['Balance Sheet', 'Balance Sheet'], ['Profit and Loss Account', 'Profit & Loss']]) {
    const pdf = pdfFace(title)
    const excel = excelFace(sheet)
    ok(`${sheet}: found in the PDF and in Excel`, !!pdf?.length && !!excel?.length)
    if (!pdf || !excel) continue
    const pool = excel.map(l => ({ ...l, key: norm(l.label), used: false }))
    const differ = []
    let compared = 0
    for (const p of pdf) {
      const x = pool.find(l => !l.used && l.key === norm(p.label))
      if (!x) continue
      x.used = true
      compared++
      if (!near(x.cy, p.cy) || !near(x.py, p.py)) differ.push(`${p.label}: PDF ${inr(p.cy)} / ${inr(p.py)}, Excel ${inr(x.cy)} / ${inr(x.py)}`)
    }
    ok(`${sheet}: ${compared} lines compared, every one the same`, compared >= 8 && differ.length === 0, differ.join('; ') || `only ${compared} compared`)
  }
}

// ── 4. Annexures ────────────────────────────────────────────────────────────
console.log('\n4. Annexures: every sub-total the same on the screen, in the PDF and in Excel')
{
  ok('the Annexures screen, the PDF and Excel share one definition of a sub-note\'s figures (subnoteGroupFigures)',
    typeof ag.subnoteGroupFigures === 'function' &&
    /subnoteGroupFigures\(/.test(readSrc('src/renderer/src/components/Annexures/index.jsx')) &&
    /subnoteGroupFigures\(/.test(readSrc('src/renderer/src/components/GenerateFinancials/buildHTML.js')) &&
    /subnoteGroupFigures\(/.test(readSrc('src/renderer/src/components/GenerateFinancials/buildExcel.js')), ag.__missing || 'not shared')
  const isZeroRow = (r) => Math.abs(fin.displayAmt(r, 'closing_balance')) < 0.005 && Math.abs(fin.displayAmt(r, 'opening_balance')) < 0.005
  for (const note of notes) {
    const tag = `Note ${note.num} ${note.title}`
    const pdf = pdfAnnexure(note)
    const excel = excelAnnexure(note)
    if (!pdf && !excel) continue
    const groups = ag.getSubnoteGroups(note, data.levelFormat).map(g => ({ ...g, rows: g.rows.filter(r => !isZeroRow(r)) })).filter(g => g.rows.length)
    const screen = typeof ag.subnoteGroupFigures === 'function'
      ? [...groups.map(g => ag.subnoteGroupFigures(note, g, { amount: fin.displayAmt, hasSeparatePYTB: true, prevMapL3: data.prevMapL3 })),
         // a sub-note only last year had: its own line (0.1.71)
         ...(typeof ag.pyOnlySubnoteLines === 'function' ? ag.pyOnlySubnoteLines(note, groups, data.levelFormat).map(l => ({ cy: 0, py: l.py })) : [])]
      : null
    const pair = (list) => (list || []).map(g => `${inr(g.cy)} / ${g.py == null ? '—' : inr(g.py)}`).join('; ')
    const same = (x, y) => !!x && !!y && x.length === y.length && x.every((g, i) => near(g.cy, y[i].cy) && near(g.py, y[i].py))
    ok(`${tag}: PDF sub-totals = Excel sub-totals`, same(pdf?.groups, excel?.groups), `PDF [${pair(pdf?.groups)}] vs Excel [${pair(excel?.groups)}]`)
    if (screen) ok(`${tag}: screen sub-totals = PDF sub-totals`, same(screen, pdf?.groups), `screen [${pair(screen)}] vs PDF [${pair(pdf?.groups)}]`)
    ok(`${tag}: annexure totals = the app's ${inr(note.total)} / ${inr(note.prevTotal)} in the PDF and in Excel`,
      !!pdf?.total && !!excel?.total && near(pdf.total.cy, note.total) && near(pdf.total.py, note.prevTotal) && near(excel.total.cy, note.total) && near(excel.total.py, note.prevTotal),
      `PDF ${inr(pdf?.total?.cy)} / ${inr(pdf?.total?.py)}, Excel ${inr(excel?.total?.cy)} / ${inr(excel?.total?.py)}`)
  }
  const changes = notes.find(n => /changes in inventor/i.test(n.title))
  const closing = changes && excelAnnexure(changes)?.groups?.[1]
  ok('Less: Closing stock sub-total shows the stock itself both years (15,37,303.92 / 8,92,244.69), as its ledgers do',
    !!closing && near(closing.cy, 1537303.92) && near(closing.py, 892244.69), closing ? `${inr(closing.cy)} / ${inr(closing.py)}` : 'not found')
}

// ── 5. Excel keeps a link only where it gives the app's figure ─────────────
console.log('\n5. Excel: a link is kept only where it gives the app\'s figure')
{
  const repairs = wb && wb.linkRepairs
  ok('the export checks its links against the app\'s figures (linkRepairs)', Array.isArray(repairs), 'buildFinancialsWorkbook reports no link check')
  ok('...and for this data every link already gives them (nothing had to be written as a figure)', Array.isArray(repairs) && repairs.length === 0,
    Array.isArray(repairs) ? repairs.map(r => `${r.sheet}!${r.cell} ${r.formula} gave ${inr(r.gave)}, app ${inr(r.figure)}`).join('; ') : '')
  const pl = wb?.Sheets?.['Profit & Loss']
  const purchasesRow = pl && Object.keys(pl).find(k => /^A\d+$/.test(k) && /Purchases of Stock-in-Trade/i.test(String(pl[k].v)))
  const pyCell = purchasesRow && pl[`D${purchasesRow.slice(1)}`]
  ok('Excel P&L Purchases of Stock-in-Trade (Previous Year) is still a live link to its note', !!pyCell?.f, pyCell ? JSON.stringify(pyCell) : 'not found')

  if (typeof xl.expectFigure === 'function' && typeof xl.keepLinksTrue === 'function') {
    const w = XLSX.utils.book_new()
    const s1 = XLSX.utils.aoa_to_sheet([['a', 5], ['b', 7], ['Total', 0]])
    s1.B3 = { t: 'n', f: 'SUM(B1:B2)' }; xl.expectFigure(s1, 'B3', 12)           // right
    s1.C1 = { t: 'n', f: 'B1+B2*2' }; xl.expectFigure(s1, 'C1', 12)             // wrong: gives 19
    const s2 = XLSX.utils.aoa_to_sheet([[0]])
    s2.A1 = { t: 'n', f: "'Sheet One'!C1" }; xl.expectFigure(s2, 'A1', 12)      // right once C1 holds the figure
    XLSX.utils.book_append_sheet(w, s2, 'Face')
    XLSX.utils.book_append_sheet(w, s1, 'Sheet One')
    const fixed = xl.keepLinksTrue(w, 0.005)
    ok('a link giving the app\'s figure is kept', s1.B3?.f === 'SUM(B1:B2)', JSON.stringify(s1.B3))
    ok('a link giving another figure is written as the app\'s figure', !s1.C1?.f && s1.C1?.v === 12 && fixed.some(f => f.cell === 'C1'), JSON.stringify({ C1: s1.C1, fixed }))
    // Only the value matters here — a link reachable solely THROUGH another
    // link that needed fixing may end up static too; both are numerically
    // right, and Excel never shows the wrong figure either way.
    const a1Value = s2.A1?.f ? s1.C1?.v : s2.A1?.v
    ok('a link to it, now right, reads correctly either way', a1Value === 12, JSON.stringify(s2.A1))
  } else {
    ok('buildExcel.js exports its link check (expectFigure, keepLinksTrue)', false, xl.__missing || 'not exported')
  }
}

console.log(fails ? `\n${fails} check(s) FAILED\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)

// Evaluates the formula shapes buildExcel.js writes (cell and cross-sheet
// references, ranges, SUM, + - * /, unary minus), the way Excel would.
function workbookEvaluator(book) {
  const memo = new Map()
  const value = (sheet, addr) => {
    const key = `${sheet}!${addr}`
    if (memo.has(key)) return memo.get(key)
    memo.set(key, 0)
    const cell = book?.Sheets?.[sheet]?.[addr]
    const v = !cell ? 0 : cell.f ? evalFormula(cell.f, sheet) : (typeof cell.v === 'number' ? cell.v : 0)
    memo.set(key, v)
    return v
  }
  const tokenize = (src) => {
    const out = []
    let i = 0
    while (i < src.length) {
      const rest = src.slice(i)
      let m
      if (rest[0] === ' ') { i++; continue }
      if ('+-*/(),:'.includes(rest[0])) { out.push({ t: rest[0] }); i++; continue }
      if ((m = /^'([^']+)'!\$?([A-Z]{1,3})\$?(\d+)/.exec(rest)) || (m = /^([A-Za-z_][A-Za-z0-9_]*)!\$?([A-Z]{1,3})\$?(\d+)/.exec(rest))) {
        out.push({ t: 'ref', sheet: m[1], col: m[2], row: Number(m[3]) }); i += m[0].length; continue
      }
      if ((m = /^([A-Z]+)\(/.exec(rest))) { out.push({ t: 'fn', name: m[1] }); i += m[1].length; continue }
      if ((m = /^\$?([A-Z]{1,3})\$?(\d+)/.exec(rest))) { out.push({ t: 'ref', sheet: null, col: m[1], row: Number(m[2]) }); i += m[0].length; continue }
      if ((m = /^\d+(\.\d+)?/.exec(rest))) { out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue }
      throw new Error(`cannot read formula "${src}" at "${rest}"`)
    }
    return out
  }
  function evalFormula(formula, sheet) {
    const tokens = tokenize(String(formula).replace(/^=/, ''))
    let p = 0
    const peek = () => tokens[p]
    const next = () => tokens[p++]
    const rangeSum = (a, b) => {
      let s = 0
      const c0 = XLSX.utils.decode_col(a.col), c1 = XLSX.utils.decode_col(b.col)
      for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
        for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) s += value(a.sheet || sheet, `${XLSX.utils.encode_col(c)}${r}`)
      }
      return s
    }
    const factor = () => {
      const tk = next()
      if (!tk) throw new Error(`unexpected end of "${formula}"`)
      if (tk.t === '-') return -factor()
      if (tk.t === '+') return factor()
      if (tk.t === 'num') return tk.v
      if (tk.t === '(') { const v = expr(); next(); return v }
      if (tk.t === 'ref') {
        if (peek()?.t === ':') { next(); return rangeSum(tk, next()) }
        return value(tk.sheet || sheet, `${tk.col}${tk.row}`)
      }
      if (tk.t === 'fn') {
        if (tk.name !== 'SUM') throw new Error(`unsupported function ${tk.name} in "${formula}"`)
        next()
        let total = 0
        if (peek()?.t !== ')') {
          for (;;) {
            total += expr()
            if (peek()?.t === ',') { next(); continue }
            break
          }
        }
        next()
        return total
      }
      throw new Error(`unexpected "${tk.t}" in "${formula}"`)
    }
    const term = () => { let v = factor(); while (peek() && (peek().t === '*' || peek().t === '/')) { const op = next().t; const r = factor(); v = op === '*' ? v * r : v / r } return v }
    const expr = () => { let v = term(); while (peek() && (peek().t === '+' || peek().t === '-')) { const op = next().t; const r = term(); v = op === '+' ? v + r : v - r } return v }
    return expr()
  }
  return value
}
