/**
 * Pre-release self-test for four Notes changes the CA asked for on 30 Sep 2026,
 * checked on the real financials pipeline, the PDF and the Excel export:
 *
 *  1. Share Capital (Company): 1(e) is no longer a single "Rights, Preferences
 *     and Restrictions" box but the eight disclosures (e) Class of Shares ...
 *     (l) Forfeiture of Shares, justified, the (i) points as bullets; the
 *     Fill Details workbook carries them both ways.
 *  2. Cash and bank balances: the "Other Details ... included above" items
 *     printed twice (once inside the note table, once as the table below it).
 *     Now once — the table, with no note number of its own, indented under the
 *     note, captioned "... included above", and only when an amount is filled.
 *  3. Revenue from operations (every constitution): "Sale" prints as Sale of
 *     Goods / Sale of Services; a sale not yet split stays on its own "Sale"
 *     line and is flagged for bifurcation.
 *  4. The italic working note above the Financial Ratios table is gone from
 *     the printed accounts, saved notes included.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = process.env.FSG_SRC_ROOT ? path.resolve(process.env.FSG_SRC_ROOT) : root
const require = createRequire(pathToFileURL(path.join(root, 'package.json')).href)
const esbuild = require('esbuild')
const XLSX = require('xlsx')
const XLSXS = require('xlsx-js-style')

let fails = 0
const ok = (what, cond, detail = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + String(detail).slice(0, 400)}`) }
const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.01
const text = (h) => h.replace(/<template[\s\S]*?<\/template>/g, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')

async function load(rel) {
  const built = await esbuild.build({
    stdin: { contents: `export * from ${JSON.stringify(path.join(srcRoot, ...rel.split('/')))}\n`, resolveDir: srcRoot, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' }, nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [{ name: 's', setup(b) {
      b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
      b.onLoad({ filter: /^react$/, namespace: 'shim' }, () => ({ contents: 'const R={createElement:()=>null,useCallback:(f)=>f,useRef:()=>({})};export default R;export const useState=()=>[];export const useEffect=()=>{};export const useRef=()=>({});export const useMemo=(f)=>f();export const useCallback=(f)=>f;', loader: 'js' }))
    } }],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-nsc-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try { return await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
}

const wb0 = XLSX.readFile(path.join(root, 'Mapping_v2.xlsx'))
const LF_ALL = XLSX.utils.sheet_to_json(wb0.Sheets.LevelFormat, { defval: null }).map((r, i) => ({
  id: i + 1, constitution: parseInt(r['Constitution']), alie: r['ALIE'], level1: r['Level 1'], level2: r['Level 2'], level3: r['Level 3'],
  level4: r['Level 4'], level5: r['Level 5'], level6: r['Level 6'], level7: r['Level 7'], sort_order: i,
}))

const fin = await load('src/renderer/src/hooks/useFinancials.js')
const html = await load('src/renderer/src/components/GenerateFinancials/buildHTML.js')
const xl = await load('src/renderer/src/components/GenerateFinancials/buildExcel.js')
const saved = await load('src/renderer/src/utils/savedNoteData.js')
let rev = null, scWb = null
try { rev = await load('src/renderer/src/utils/revenueLines.js') } catch { /* not in this source */ }
try { scWb = await load('src/renderer/src/components/Notes/shareCapitalDetailsWorkbook.js') } catch { /* not in this source */ }

const activeTB = { id: 1, period: '2025-04-01 To 2026-03-31', entity_period_id: 11 }, prevTB = { id: 2, period: '2024-04-01 To 2025-03-31' }

// One Trial Balance world per call: rows for CY / PY, saved note details, General Notes.
// noExcel: the Excel General Notes sheet parses HTML with the browser DOM, absent under Node.
async function build({ constitution, cy, py, noteDetails = [], generalNotes = null, noExcel = false, denomination = 'as_is' }) {
  const LF = LF_ALL.filter(r => r.constitution === constitution)
  globalThis.window = { api: {
    getFinancialData: async (id) => (id === 1 ? cy(LF) : id === 2 ? py(LF) : []), getLevelFormat: async () => LF.map(r => ({ ...r })),
    listNoteDetails: async () => noteDetails, listEntityNoteDetails: async () => noteDetails, depGet: async () => null, depITGet: async () => null, depCompGet: async () => null,
    getManualPY: async () => false, listManualPyEntries: async () => [], getPlClosedToCapital: async () => false, getGeneralNotes: async () => generalNotes, getEps: async () => null,
  } }
  const entity = { id: 1, name: 'Notes Test', constitution, constitution_display: ['', 'Proprietorship', 'LLP', 'Company'][constitution], business_type: 'Trader' }
  const data = await fin.fetchFinancialsData(activeTB, prevTB, entity, null)
  const noteDetailsMap = saved.mapSavedRowsToLiveNotes(noteDetails, Object.values(data.notes || {}), saved.parsedNoteData)
  const pdf = html.buildFinancialsHTML({ entity, activeTB, prevTB, data, auditor: null, signatories: [], noteDetailsMap, signPlace: 'X', signDate: '2026-09-30', denomination })
  const wb = noExcel ? null : xl.buildFinancialsWorkbook({ entity, activeTB, prevTB, data, levelFormat: LF, auditor: null, signatories: [], noteDetailsMap, signPlace: 'X', signDate: '2026-09-30', denomination })
  return { LF, data, pdf, wb }
}
const lfOf = (LF, l1rx, l2rx) => LF.find(r => l1rx.test(r.level1 || '') && l2rx.test(r.level2 || ''))
const row = (name, lf, l3, closing, opening = 0) => ({ name, ledger_name: name, ledger_code: '', alie: lf.alie, level1: lf.level1, mapping1_resultant: lf.level1,
  level2: lf.level2, mapping2_resultant: lf.level2, level3: l3, mapping3_resultant: l3, level4_value: null, level5_value: null, level6_value: null, level7_value: null,
  closing_balance: String(closing), opening_balance: String(opening), status: 'user_approved', upload_nature: null, sort_order: lf.sort_order })
const capLf = (LF) => LF.find(r => r.alie === 'EQUITY AND LIABILITIES' && /share capital|capital account/i.test(r.level2 || ''))
const cashLf = (LF) => lfOf(LF, /current assets/i, /^cash and bank balances$/i)
const saleLf = (LF) => lfOf(LF, /revenue from operations/i, /^sale$/i)
const expLf = (LF) => LF.find(r => r.alie === 'Expenses' && /purchases of stock|cost of materials/i.test(r.level1 || ''))
const notesSheet = (wb) => XLSXS.utils.sheet_to_json(wb.Sheets['Notes'], { header: 1, defval: '' })
const noteOf = (data, rx) => Object.values(data.notes || {}).find(n => rx.test(n.title || ''))
// A note's HTML: from its title to the next note's title.
const noteHtml = (pdf, title) => {
  const parts = pdf.replace(/<template[\s\S]*?<\/template>/g, '').split('<div class="note-title"')
  // A Company's Cash note prints as the face caption "Cash and cash equivalents"; its stored title is unchanged.
  const shown = /^cash and bank/i.test(title) ? '(?:Cash and bank balances|Cash and cash equivalents)' : title
  return parts.find(p => new RegExp(`^[^>]*>Note \\d+: ${shown}`, 'i').test(p)) || ''
}
// An Excel cell's figure — its value, or (a formula linking Annexures) the linked cell's.
// Follows a link (Annexures!E12) and evaluates a plain SUM(E10:E11,E14).
const cellFigure = (wb, sheet, r, c) => evalAddr(wb, sheet, XLSXS.utils.encode_cell({ c, r }))
function evalAddr(wb, sheet, addr) {
  const cell = wb.Sheets[sheet][addr]
  if (!cell) return 0
  if (!cell.f) return typeof cell.v === 'number' ? cell.v : (parseFloat(cell.v) || 0)
  let f = String(cell.f).trim(), sign = 1
  if (f.startsWith('-')) { sign = -1; f = f.slice(1) }
  const link = f.match(/^(\w+)!([A-Z]+\d+)$/)
  if (link) return sign * evalAddr(wb, link[1], link[2])
  const sum = f.match(/^SUM\((.*)\)$/i)
  if (!sum) return NaN
  let total = 0
  for (const part of sum[1].split(',')) {
    const rg = XLSXS.utils.decode_range(part.trim())
    for (let rr = rg.s.r; rr <= rg.e.r; rr++) for (let cc = rg.s.c; cc <= rg.e.c; cc++) total += evalAddr(wb, sheet, XLSXS.utils.encode_cell({ r: rr, c: cc }))
  }
  return sign * total
}

// ── 3. Revenue from operations: Sale of Goods / Sale of Services ───────────
console.log('\nRevenue from operations: Sale of Goods / Sale of Services (every constitution)')
for (const c of [1, 2, 3]) {
  const tag = ['', 'Proprietorship', 'LLP', 'Company'][c]
  for (const withUnsplit of [false, true]) {
    const cy = (LF) => [
      row('Capital', capLf(LF), null, 400000),
      row('Bank', cashLf(LF), 'Balances with banks', -(1100000 + (withUnsplit ? 50000 : 0))),
      row('Sales A/c', saleLf(LF), 'Sale of Products', 500000),
      row('Service Charges', saleLf(LF), 'Sale of Services', 200000),
      ...(withUnsplit ? [row('Misc Sales', saleLf(LF), 'Uncategorised Sale', 50000)] : []),
    ]
    const py = (LF) => [
      row('Capital', capLf(LF), null, 400000),
      row('Bank', cashLf(LF), 'Balances with banks', -900000),
      row('Sales A/c', saleLf(LF), 'Sale of Products', 400000),
      row('Service Charges', saleLf(LF), 'Sale of Services', 100000),
    ]
    const { data, pdf, wb } = await build({ constitution: c, cy, py })
    const note = noteOf(data, /revenue from operations/i)
    const lines = (note?.lines || []).map(l => [l.level2, l.total, l.prevTotal])
    const want = [['Sale of Goods', 500000, 400000], ['Sale of Services', 200000, 100000], ...(withUnsplit ? [['Sale', 50000, 0]] : [])]
    const label = `${tag}${withUnsplit ? ' (one sale not yet split)' : ''}`
    ok(`${label}: note lines are ${want.map(w => w[0]).join(', ')} with both years' figures, in that order`,
      lines.length === want.length && want.every((w, i) => lines[i][0] === w[0] && near(lines[i][1], w[1]) && near(lines[i][2], w[2])), JSON.stringify(lines))
    ok(`${label}: Revenue total unchanged (${withUnsplit ? '7,50,000' : '7,00,000'} / 5,00,000)`, !!note && near(note.total, withUnsplit ? 750000 : 700000) && near(note.prevTotal, 500000), note && `${note.total} / ${note.prevTotal}`)
    ok(`${label}: flagged for bifurcation ${withUnsplit ? 'yes' : 'no'}`, !!rev && !!rev.unsplitSaleLine(note) === withUnsplit)
    const nh = text(noteHtml(pdf, 'Revenue from operations'))
    ok(`${label}: PDF prints Sale of Goods 5,00,000.00 and Sale of Services 2,00,000.00`, /Sale of Goods 5,00,000\.00 4,00,000\.00/.test(nh) && /Sale of Services 2,00,000\.00 1,00,000\.00/.test(nh), nh.slice(0, 300))
    const grid = notesSheet(wb)
    const gi = grid.findIndex(r => String(r[0]).trim() === 'Sale of Goods'), si = grid.findIndex(r => String(r[0]).trim() === 'Sale of Services')
    const fig = (r) => [cellFigure(wb, 'Notes', r, 2), cellFigure(wb, 'Notes', r, 3)]
    const xg = gi >= 0 ? fig(gi) : null, xs = si >= 0 ? fig(si) : null
    ok(`${label}: Excel Notes prints the same two lines (linked to their Annexures groups)`, !!xg && !!xs && near(xg[0], 500000) && near(xg[1], 400000) && near(xs[0], 200000) && near(xs[1], 100000), JSON.stringify([xg, xs]))
    const ag = XLSXS.utils.sheet_to_json(wb.Sheets['Annexures'], { header: 1, defval: '' })
    ok(`${label}: Excel Annexures groups the ledgers under the same two lines`, ag.some(r => r.some(v => String(v).trim() === 'Sale of Goods')) && ag.some(r => r.some(v => String(v).trim() === 'Sale of Services')))
  }
}

// ── 2. Cash and bank balances: Other Details, once ─────────────────────────
console.log('\nCash and bank balances: Other Details relating to Cash and Bank Balances included above')
const cashWorld = (items) => ({
  constitution: 3,
  cy: (LF) => [row('Capital', capLf(LF), null, 150000), row('Cash', cashLf(LF), 'Cash on hand', -50000), row('SBI', cashLf(LF), 'Balances with banks', -100000)],
  py: (LF) => [row('Capital', capLf(LF), null, 120000), row('Cash', cashLf(LF), 'Cash on hand', -40000), row('SBI', cashLf(LF), 'Balances with banks', -80000)],
  noteDetails: [{ note_num: 0, note_title: 'Cash and bank balances', data: JSON.stringify(items) }],
})
{
  const filled = { items: { a: { amount: '25000', amountPY: '15000', remarks: 'FD lien' }, b: { amount: '' }, c: { amount: '' } }, includeInOutput: false }
  const { data, pdf, wb } = await build(cashWorld(filled))
  const nh = noteHtml(pdf, 'Cash and bank balances')
  const t = text(nh)
  ok('PDF: each item printed once (the copy inside the note table is gone)', (t.match(/Earmarked balances with banks/g) || []).length === 1, `${(t.match(/Earmarked balances with banks/g) || []).length}x`)
  ok('PDF: captioned "Other Details relating to Cash and Bank Balances included above", no note number of its own',
    /Other Details relating to Cash and Bank Balances included above/.test(t) && !/\d+\.\s*Other Details relating to Cash/.test(t), t.slice(0, 400))
  ok('PDF: the table is indented under the note', /margin-left:14pt[^>]*>\s*<p[^>]*>Other Details relating to Cash and Bank Balances included above/.test(nh))
  ok('PDF: Cash on hand / Balances with banks lines and the note total unchanged', /Cash on hand 50,000\.00 40,000\.00/.test(t) && /Balances with banks 1,00,000\.00 80,000\.00/.test(t), t.slice(0, 400))
  const grid = notesSheet(wb)
  const hits = grid.filter(r => r.some(v => /Earmarked balances with banks/.test(String(v))))
  const cap = grid.find(r => /Other Details relating to Cash/.test(String(r[0])))
  ok('Excel: each item printed once', hits.length === 1, `${hits.length}x`)
  ok('Excel: caption "... included above" without a note number', !!cap && /^\s*Other Details relating to Cash and Bank Balances included above$/.test(String(cap[0])), JSON.stringify(cap))
  const note = noteOf(data, /cash and bank/i)
  ok('Notes screen: the details (CY 25,000 / PY 15,000) still reach its own table', (note?.templateRows || []).some(r => r.isCashBank && near(r.cy, 25000) && near(r.py, 15000)))
}
{
  const nil = { items: { a: { amount: '' }, b: { amount: '0' }, c: { amount: '' } }, includeInOutput: true }
  const { data, pdf, wb } = await build(cashWorld(nil))
  ok('Nothing filled in (even with the old "Always include" tick): no table in the PDF', !/Other Details relating to Cash/.test(text(pdf)))
  ok('... none in Excel', !notesSheet(wb).some(r => r.some(v => /Other Details relating to Cash|Earmarked balances/.test(String(v)))))
  ok('... none on the Notes screen', !(noteOf(data, /cash and bank/i)?.templateRows || []).some(r => r.isCashBank || r.isCashBankHeader))
}

// ── 1. Share Capital (Company): 1(e) ... 1(l) ─────────────────────────────
console.log('\nShare Capital (Company): disclosures (e) to (l)')
const HEADS = [['e', 'Class of Shares'], ['f', 'Rights, Preferences and Restrictions'], ['g', 'Shares held by Holding / Ultimate Holding / Subsidiaries or Associates'],
  ['h', 'ESOP or other Commitments'], ['i', 'Bonus, Buy Back and Issue of shares other than Cash'], ['j', 'Convertible Securities'], ['k', 'Unpaid Calls'], ['l', 'Forfeiture of Shares']]
const scDetails = (extra = {}) => ({
  classes: [{ name: 'Equity Shares', type: 'Equity', faceValue: 100,
    cy: { authorised: '5000', issued: '1500', subscribed: '1500', paidUp: '1500', openingShares: '1500', issuedDuringYear: '', deletedDuringYear: '' },
    py: { authorised: '5000', issued: '1500', subscribed: '1500', paidUp: '1500', openingShares: '1500', issuedDuringYear: '', deletedDuringYear: '' } }],
  shareholders5pctEquity: [], shareholders5pctPreference: [], promoters: [],
  rights: 'The Company has one class of equity shares having a par value of ₹10 per share. Each holder is eligible for one vote per share held.',
  footnotes: Array(10).fill(''), ...extra,
})
const scWorld = (details) => ({
  constitution: 3,
  cy: (LF) => [row('Equity Share Capital', capLf(LF), null, 150000), row('SBI', cashLf(LF), 'Balances with banks', -150000)],
  py: (LF) => [row('Equity Share Capital', capLf(LF), null, 150000), row('SBI', cashLf(LF), 'Balances with banks', -150000)],
  noteDetails: [{ note_num: 0, note_title: 'Share capital', data: JSON.stringify(details) }],
})
{
  const { data, pdf, wb } = await build(scWorld(scDetails()))
  const n = noteOf(data, /share capital/i)?.num
  const nh = noteHtml(pdf, 'Share capital')
  const t = text(nh)
  const pos = HEADS.map(([k, h]) => t.indexOf(`${n}(${k}) ${h}`))
  ok(`PDF: ${n}(e) Class of Shares ... ${n}(l) Forfeiture of Shares, all eight, in order`, pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1])), JSON.stringify(pos))
  ok('PDF: the old single "(e) Rights, Preferences and Restrictions" box is gone (Rights is now (f))', !new RegExp(`${n}\\(e\\) Rights`).test(t))
  ok('PDF: (e) uses the company\'s face value (₹100)', /par value of ₹100 per share and each holder of equity shares is entitled to one vote/.test(t))
  const paras = [...nh.matchAll(/<p style="([^"]*)">([^<]*)<\/p>/g)].filter(m => !/font-weight:bold/.test(m[1]))
  ok('PDF: every disclosure paragraph is justified', paras.length >= 10 && paras.every(m => /text-align:justify/.test(m[1])), `${paras.length} paragraphs`)
  const bullets = paras.filter(m => /^•/.test(m[2]))
  ok('PDF: (i) has its three points as bullets with a hanging indent', bullets.length === 3 && bullets.every(m => /text-indent:-10pt/.test(m[1])), `${bullets.length}`)

  const ws = wb.Sheets['Notes']
  const grid = notesSheet(wb)
  const rIdx = HEADS.map(([k, h]) => grid.findIndex(r => String(r[0]).trim() === `${n}(${k})  ${h}`))
  ok('Excel: the eight headings, in order', rIdx.every((r, i) => r >= 0 && (i === 0 || r > rIdx[i - 1])), JSON.stringify(rIdx))
  const paraR = []
  for (let i = 0; i < rIdx.length; i++) for (let r = rIdx[i] + 1; r < (rIdx[i + 1] ?? rIdx[i] + 2); r++) if (String(grid[r]?.[0] || '').trim()) paraR.push(r)
  const merged = (r) => (ws['!merges'] || []).some(m => m.s.r === r && m.e.r === r && m.s.c === 0 && m.e.c === 4)
  const just = (r) => ws[XLSXS.utils.encode_cell({ c: 0, r })]?.s?.alignment?.horizontal === 'justify' && ws[XLSXS.utils.encode_cell({ c: 0, r })]?.s?.alignment?.wrapText
  ok('Excel: every paragraph is merged across A:E, wrapped and justified', paraR.length >= 10 && paraR.every(r => merged(r) && just(r)), JSON.stringify(paraR.filter(r => !(merged(r) && just(r)))))
  ok('Excel: paragraph rows are tall enough for their text', paraR.every(r => (ws['!rows']?.[r]?.hpt || 0) >= 15 * Math.ceil(String(grid[r][0]).length / 110)))
}
{
  // A CA's own old Rights text carries into (e); a cleared section is left out; an edited one prints as typed.
  const own = 'The Company has two classes of shares: equity shares of ₹100 each and preference shares of ₹1,000 each.'
  const { data, pdf, wb } = await build(scWorld(scDetails({ rights: own })))
  const n = noteOf(data, /share capital/i)?.num
  ok('A customised old Rights text (saved before this change) prints as (e)', text(noteHtml(pdf, 'Share capital')).includes(`${n}(e) Class of Shares ${own}`))
  const b = await build(scWorld(scDetails({ disclosures: { h: '', k: 'Calls in arrears: ₹5,000 from one shareholder.' } })))
  const t2 = text(noteHtml(b.pdf, 'Share capital'))
  ok('A section cleared to blank is left out; an edited one prints as typed', !/ESOP or other Commitments/.test(t2) && /\(k\) Unpaid Calls Calls in arrears: ₹5,000 from one shareholder\./.test(t2))
}
{
  const wbF = XLSXS.utils.book_new()
  let parsed = null
  if (scWb) {
    scWb.appendShareCapitalDetailsSheet(wbF, 1, scDetails({ disclosures: { j: 'Custom convertible text.' } }), new Set())
    parsed = scWb.parseShareCapitalDetailsSheet(XLSXS.read(XLSXS.write(wbF, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' }), 1500, 1500)
  }
  ok('Fill Details workbook: (e)-(l) go out and an edited one comes back; standard text is not frozen', !!parsed && parsed.data.disclosures?.j === 'Custom convertible text.' && Object.keys(parsed.data.disclosures || {}).length === 1, JSON.stringify(parsed?.data?.disclosures))
}

// ── 4. Financial Ratios: no working note above the table ───────────────────
console.log('\nSignificant Accounting Policies: Financial Ratios without the working note')
{
  const intro = '<p><em>Current Year, Previous Year and Variance % were pulled from the Balance Sheet and Statement of Profit and Loss when this note was created. Schedule III requires an explanation.</em></p>'
  const gn = { title: 'Significant Accounting Policies', position: 'first', points: [
    { id: 'a', header: 'Basis of Preparation', contentHtml: '<p>Prepared under AS-1.</p>' },
    { id: 'b', header: 'Financial Ratios', contentHtml: intro + '<table><tbody><tr><th>Particulars</th></tr><tr><td>Current Ratio</td></tr></tbody></table>' },
  ] }
  const { data, pdf } = await build({ ...scWorld(scDetails()), generalNotes: gn, noExcel: true })
  ok('A note saved with it: the PDF prints the ratios table without the working note', /Current Ratio/.test(text(pdf)) && !/were pulled from the Balance Sheet/.test(text(pdf)))
  ok('... and the financials handed to Excel carry no working note', !JSON.stringify(data.generalNotes).includes('were pulled from'))
}

// ── 5. Financial Ratios follow the Balance Sheet, not the day the note was made ─
console.log('\nFinancial Ratios table brought up to date from the financial statements')
{
  let bs = null
  try { bs = await load('src/renderer/src/utils/bsStructure.js') } catch { /* */ }
  const TP = (LF) => lfOf(LF, /current liabilities/i, /^trade payables$/i)
  const PROV = (LF) => lfOf(LF, /current liabilities/i, /short-term provisions/i)
  const TR = (LF) => lfOf(LF, /current assets/i, /^trade receivables$/i)
  const INV = (LF) => lfOf(LF, /current assets/i, /^inventories$/i)
  const world = {
    constitution: 3,
    cy: (LF) => [row('Equity Share Capital', capLf(LF), null, 300000), row('Creditor', TP(LF), 'Due to Creditors other than MSME', 120000),
      row('Audit Fee Payable', PROV(LF), null, 30000), row('Debtor', TR(LF), null, -200000), row('Stock', INV(LF), null, -100000), row('SBI', cashLf(LF), 'Balances with banks', -150000)],
    py: (LF) => [row('Equity Share Capital', capLf(LF), null, 300000), row('Creditor', TP(LF), 'Due to Creditors other than MSME', 100000),
      row('Debtor', TR(LF), null, -250000), row('SBI', cashLf(LF), 'Balances with banks', -150000)],
  }
  // Saved long ago: Current Ratio 1.00 (1,00,000 / 1,00,000), the snapshot says the tool wrote exactly that.
  const stale = (num, den) => `<table><tbody><tr><th><p><strong>Particulars</strong></p></th><th>N</th><th>NV</th><th>D</th><th>DV</th><th>CY</th><th>PY</th><th>V</th></tr>` +
    `<tr><td><p>Current Ratio</p></td><td><p>Current Assets</p></td><td><p>${num}</p></td><td><p>Current Liabilities</p></td><td><p>${den}</p></td><td><p>1.00</p></td><td><p></p></td><td><p></p></td></tr></tbody></table>`
  const gn = (num, den) => ({ title: 'Significant Accounting Policies', position: 'first', ratioAutoSnapshot: { current: { numeratorValue: 100000, denominatorValue: 100000 } }, points: [
    { id: 'a', header: 'Basis of Preparation', contentHtml: '<p>Prepared under AS-1, as the CA wrote it.</p>' },
    { id: 'b', header: 'Financial Ratios', contentHtml: '<p>Explanation typed by the CA.</p>' + stale(num, den) },
  ] })
  const { data, pdf } = await build({ ...world, generalNotes: gn('1,00,000.00', '1,00,000.00'), noExcel: true })
  const layout = bs?.computeCompanyBSLayout(data)
  const grp = (side, rx) => (layout?.[side]?.groups || []).find(g => rx.test(g.label || ''))
  const ca = grp('assets', /^current assets$/i), cl = grp('el', /^current liabilities$/i)
  const fr = data.generalNotes?.points?.find(p => p.header === 'Financial Ratios')?.contentHtml || ''
  const r1 = (fr.match(/<tr><td><p>Current Ratio<\/p><\/td>([\s\S]*?)<\/tr>/) || [])[1] || ''
  const cells = [...r1.matchAll(/<td[^>]*><p>([^<]*)<\/p><\/td>/g)].map(m => m[1])
  ok('Balance Sheet: Current assets (2) 4,50,000 and Current liabilities (4) 1,50,000', !!ca && !!cl && near(ca.total, 450000) && near(cl.total, 150000), `${ca?.total} / ${cl?.total}`)
  ok('A note saved with old ratios: Current Assets / Current Liabilities now equal the Balance Sheet (2) and (4) totals, ratio 3.00',
    cells[1] === '4,50,000.00' && cells[3] === '1,50,000.00' && cells[4] === '3.00', JSON.stringify(cells))
  ok('... and the previous year too (4,00,000 / 1,00,000 = 4.00)', cells[5] === '4.00', JSON.stringify(cells))
  ok('... in the PDF as well', /Current Ratio Current Assets 4,50,000\.00 Current Liabilities 1,50,000\.00 3\.00 4\.00/.test(text(pdf)), (text(pdf).match(/Current Ratio.{0,120}/) || [''])[0])
  ok('Every other point, and the CA\'s text around the table, is left exactly as written',
    data.generalNotes.points[0].contentHtml === '<p>Prepared under AS-1, as the CA wrote it.</p>' && fr.startsWith('<p>Explanation typed by the CA.</p><table>'))
  const typed = await build({ ...world, generalNotes: gn('5,00,000.00', '1,00,000.00'), noExcel: true })
  const fr2 = typed.data.generalNotes.points.find(p => p.header === 'Financial Ratios').contentHtml
  const c2 = [...((fr2.match(/<tr><td><p>Current Ratio<\/p><\/td>([\s\S]*?)<\/tr>/) || [])[1] || '').matchAll(/<td[^>]*><p>([^<]*)<\/p><\/td>/g)].map(m => m[1])
  ok('A Numerator the CA typed over (5,00,000) is kept and marked violet; the Denominator still follows the Balance Sheet (1,50,000); ratio 3.33',
    c2[1] === '5,00,000.00' && c2[3] === '1,50,000.00' && c2[4] === '3.33' && /f5f3ff/.test(fr2), JSON.stringify(c2))

  // 1 Oct 2026: typed Current Year / Previous Year ratios survive the refresh and reach the PDF.
  const refreshed = (await build({ ...world, generalNotes: gn('1,00,000.00', '1,00,000.00'), noExcel: true })).data.generalNotes
  const typedHtml = refreshed.points[1].contentHtml
    .replace(/(<tr><td><p>Current Ratio<\/p><\/td>(?:<td[^>]*><p>[^<]*<\/p><\/td>){4}<td[^>]*><p>)[^<]*(<\/p>)/, '$12.75$2')
    .replace(/(<tr><td><p>Return on Equity Ratio<\/p><\/td>(?:<td[^>]*><p>[^<]*<\/p><\/td>){5}<td[^>]*><p>)[^<]*(<\/p>)/, '$112.50%$2')
  const again = await build({ ...world, generalNotes: { ...refreshed, points: refreshed.points.map((p, i) => (i === 1 ? { ...p, contentHtml: typedHtml } : p)) }, noExcel: true })
  const fr3 = again.data.generalNotes.points[1].contentHtml
  const rowCells = (h, name) => [...((h.match(new RegExp(`<tr><td><p>${name}<\\/p><\\/td>([\\s\\S]*?)<\\/tr>`)) || [])[1] || '').matchAll(/<td[^>]*><p>([^<]*)<\/p><\/td>/g)].map(m => m[1])
  const cr = rowCells(fr3, 'Current Ratio'), roe = rowCells(fr3, 'Return on Equity Ratio')
  ok('A Current Year ratio typed over (2.75) is kept by the refresh, its variance worked from it (-31.25%)', cr[4] === '2.75' && cr[6] === '-31.25%', JSON.stringify(cr))
  ok('A Previous Year ratio typed in (12.50% where the tool has none) is kept by the refresh', roe[5] === '12.50%', JSON.stringify(roe))
  ok('... and both print in the PDF', /Current Ratio Current Assets 4,50,000\.00 Current Liabilities 1,50,000\.00 2\.75 4\.00 -31\.25%/.test(text(again.pdf)) && /Return on Equity Ratio .{0,120}12\.50%/.test(text(again.pdf)),
    (text(again.pdf).match(/Current Ratio Current Assets.{0,90}/) || [''])[0])

  // Comments on Ratios: the CA's paragraphs print below the table, untouched by the refresh.
  const withComments = gn('1,00,000.00', '1,00,000.00')
  withComments.points[1].comments = [
    { id: 'c1', html: '<ul><li><p>Current ratio improved as trade receivables fell.</p></li></ul>' },
    { id: 'c2', html: '<p></p>' },
    { id: 'c3', html: '<p style="text-align: justify">Debt-equity is nil as the company has no borrowings.</p>' },
  ]
  const cm = await build({ ...world, generalNotes: withComments, noExcel: true })
  const t3 = text(cm.pdf), tableAt = t3.indexOf('Current Ratio Current Assets 4,50,000.00')
  const c1At = t3.indexOf('Current ratio improved as trade receivables fell.'), c3At = t3.indexOf('Debt-equity is nil as the company has no borrowings.')
  ok('Comments on Ratios print below the refreshed table, in order', tableAt >= 0 && c1At > tableAt && c3At > c1At, `${tableAt} ${c1At} ${c3At}`)
  ok('... keeping their bullet and justification', /<li><p>Current ratio improved/.test(cm.pdf) && /text-align: justify">Debt-equity is nil/.test(cm.pdf))
  ok('... and the refresh leaves them exactly as written', JSON.stringify(cm.data.generalNotes.points[1].comments) === JSON.stringify(withComments.points[1].comments))
}

// ── 7. Reserves and surplus (Company): Closing Profit & Loss = Opening + Surplus ──
// Balances arrive from PostgreSQL as TEXT; the closing row added them to the year's
// profit as text ("12639573.594417880.66"), so Closing printed as the Opening figure
// while Total was right (1 Oct 2026).
console.log('\nReserves and surplus: Closing Profit & Loss (Company)')
{
  const resLf = (LF) => lfOf(LF, /shareholders/i, /^reserves and surplus$/i)
  const cy = (LF) => [
    row('Share Capital', capLf(LF), null, 100000),
    row('Retained Earnings', resLf(LF), 'Opening Profit & Loss', 12639573.59, 12639573.59),
    row('Sales A/c', saleLf(LF), 'Sale of Products', 1000000),
    row('Purchases', expLf(LF), null, -600000),
    row('Bank', cashLf(LF), 'Balances with banks', -13139573.59),
  ]
  const w = await build({ constitution: 3, cy, py: () => [], noExcel: true })
  const rs = noteOf(w.data, /reserves/i)
  const tpl = (rs?.templateRows || []).filter(r => r.syntheticProfitLoss || /profit/i.test(r.label || ''))
  const closing = tpl.find(r => /^closing profit/i.test(r.label || ''))
  ok('Closing Profit & Loss = Opening + Surplus (as a number)', closing && near(closing.cy, 12639573.59 + 400000), closing && closing.cy)
  ok('... and equals the note Total', closing && near(closing.cy, rs.total), `${closing && closing.cy} vs ${rs.total}`)
  ok('... and prints in the PDF', /1,30,39,573\.59/.test(text(noteHtml(w.pdf, 'Reserves'))), text(noteHtml(w.pdf, 'Reserves')).slice(0, 300))
}

// ── 8. Financial Ratios amounts follow the statements' denomination ───────────
// "Figures in Hundreds" in the heading, whole rupees in the ratio table (1 Oct 2026).
console.log('\nFinancial Ratios: Numerator / Denominator Value in the printed denomination')
{
  const rt = await load('src/renderer/src/utils/ratioTable.js')
  const fmt = (n) => { const s = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return n < 0 ? '(' + s + ')' : s }
  const tbl = '<table><tbody><tr><th><p>Particulars</p></th><th>N</th><th>NV</th><th>D</th><th>DV</th><th>CY</th><th>PY</th><th>V</th></tr>' +
    '<tr><td><p>Current Ratio</p></td><td><p>Current Assets</p></td><td><p>1,23,456.00</p></td><td><p>Current Liabilities</p></td><td><p>(2,46,912.00)</p></td><td><p>0.50</p></td><td><p></p></td><td><p></p></td></tr>' +
    '<tr><td><p>Debt-Equity</p></td><td><p>Debt</p></td><td style="background-color:#f5f3ff"><p>5,00,000.00</p></td><td><p>Equity</p></td><td><p>3,00,000.00</p></td><td><p>1.67</p></td><td><p></p></td><td><p></p></td></tr></tbody></table>'
  const note = { title: 'Significant Accounting Policies', points: [{ id: 'b', header: 'Financial Ratios', contentHtml: tbl }] }
  const sc = (d, dec = 2) => rt.scaleRatioAmounts(note, d, dec).points[0].contentHtml
  const h = sc(100), l = sc(100000), nd = sc(1, 0)
  ok('In Hundreds: 1,23,456.00 -> 1,234.56 and (2,46,912.00) -> (2,469.12)', h.includes('<p>1,234.56</p>') && h.includes('<p>(2,469.12)</p>'), h)
  ok('... a figure the CA typed (violet) is left exactly as typed', h.includes('<p>5,00,000.00</p>') && h.includes('<p>3,000.00</p>'))
  ok('... the ratios themselves (0.50, 1.67) are untouched', h.includes('<p>0.50</p>') && h.includes('<p>1.67</p>'))
  ok('In Lakhs: 1.23 and (2.47)', l.includes('<p>1.23</p>') && l.includes('<p>(2.47)</p>'))
  ok('No Decimals: 123,456 stays whole rupees without decimals', nd.includes('<p>1,23,456</p>'), nd)
  ok('As Is leaves the note alone', rt.scaleRatioAmounts(note, 1, 2) === note)
  // the real print path: PDF in Hundreds carries the scaled figure of the refreshed table
  const w = { ...scWorld(scDetails()), generalNotes: { title: 'Significant Accounting Policies', position: 'first', points: [{ id: 'b', header: 'Financial Ratios', contentHtml: '<p>x</p>' }] } }
  const base = await build({ ...w, noExcel: true })
  const rows = rt.parseRatiosTableFromHtml(base.data.generalNotes.points[0].contentHtml) || []
  const sample = rows.map(r => r.numeratorValue).find(v => v) || rows.map(r => r.denominatorValue).find(v => v)
  const hun = text((await build({ ...w, denomination: 'hundreds', noExcel: true })).pdf)
  ok('PDF in Hundreds prints the ratio table amounts divided by 100', !!sample && hun.includes(fmt(sample / 100)) && !text(base.pdf).includes(fmt(sample / 100)), String(sample))
  ok('... while the saved note keeps whole rupees', rows.some(r => r.numeratorValue === sample))
}

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
