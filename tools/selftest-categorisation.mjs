/**
 * Pre-release self-test for categorisation: a ledger's Level 1, Level 2 and
 * Level 3 must belong together, and the three renderings of a note — the Notes
 * screen, the PDF and the Excel export — must show the same lines adding up to
 * the same totals.
 *
 * Shaped like the live case (Santosh Kumar Gupta, 13 Sep 2026): Purchase
 * Accounts under "Purchases of Stock-in-Trade" with no Level 2, plus
 * "Purchase Gst 5%" whose Level 2 was still "Short-term loans and advances"
 * after it was moved there from the GST balance head; "IGST SALES" and
 * "SALE GST NIL" likewise under Revenue from operations. The Notes screen
 * showed a Balance Sheet heading inside P&L notes, the PDF printed the
 * Purchases note without its "Purchases" line, and Excel's P&L showed
 * Purchases of Stock-in-Trade as 1,86,000 instead of 10,59,79,887.
 *
 * 1. Mapped TB grid: changing Mapping 1 clears Mapping 2/3, the format row and
 *    Levels 4-7 (utils/mappingEdit.js) — it used to keep them.
 * 2. Auto-mapping: a ledger moved between Income and Expenses for an abnormal
 *    balance keeps no Level 2/3 of the head it left (mapping-engine.js).
 * 3. Statements: a Level 2 the Level Format places only on the OTHER statement
 *    is ignored, with its Level 3, and the ledger is listed for the Exception
 *    Report (useFinancials.js ignoreForeignLevel2); custom lines and captions
 *    used on both statements are kept. Previous Year alike.
 * 4. Every P&L note prints the same lines on the Notes screen, in the PDF and
 *    in Excel — a line with no Level 2 included, under its fallback label — and
 *    they add up to the note total. Excel's formulas, evaluated, give the P&L
 *    the same figures as the app.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that
 * source — e.g. an unzipped releases\fsg-bharat-0.1.33-source.zip — to prove
 * they fail where the bug was.
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-categorisation.mjs
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
        b.onResolve({ filter: /db[\\/]client(\.js)?$/ }, () => ({ path: 'db-client', namespace: 'shim' }))
        b.onLoad({ filter: /^react$/, namespace: 'shim' }, () => ({ contents: REACT_SHIM, loader: 'js' }))
        b.onLoad({ filter: /^db-client$/, namespace: 'shim' }, () => ({ contents: 'export const query = async () => ({ rows: [] }); export const runInTransaction = async (f) => f();', loader: 'js' }))
        // buildPrevMap is module-private; expose it to this test.
        b.onLoad({ filter: /useFinancials\.js$/ }, (args) => ({
          contents: fs.readFileSync(args.path, 'utf8') + '\nexport { buildPrevMap }\n', loader: 'jsx', resolveDir: path.dirname(args.path),
        }))
      },
    }],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-cat-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try { return await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
}

const GST_L3 = 'Balances with government authorities (GST input credit and other tax credits)'
const STLA = 'Short-term loans and advances'
const BS_HEADINGS = new Set(['short-term loans and advances', 'other current liabilities', 'other current assets', 'cash and bank balances', 'trade payables', "owners' capital account"])

console.log(`\nCategorisation self-test${srcRoot !== root ? `  (source: ${srcRoot})` : ''}`)

// ── 1. Mapped TB grid edit ───────────────────────────────────────────────────
console.log('\n1. Mapped TB grid: changing Mapping 1 clears what belonged to the old one')
{
  const mod = await load('src/renderer/src/utils/mappingEdit.js')
  const merge = mod.mergeMappingEdit
  ok('the grid saves an edit through mergeMappingEdit (utils/mappingEdit.js)', typeof merge === 'function', mod.__missing || 'mergeMappingEdit is not exported')
  if (typeof merge === 'function') {
    const row = { mapping1_resultant: 'Current assets', mapping2_resultant: STLA, mapping3_resultant: GST_L3, level_format_id: 41,
      level4_value: 'x', level5_value: 'Unsecured, considered good', level6_value: null, level7_value: null, override_note: 'Kept note' }
    const m = merge(row, { mapping1_resultant: 'Purchases of Stock-in-Trade', mapping2_resultant: null, mapping3_resultant: null,
      level_format_id: null, level4_value: null, level5_value: null, level6_value: null, level7_value: null })
    ok('Mapping 1 changed: Mapping 2, Mapping 3 and the format row are cleared',
      m.mapping1_resultant === 'Purchases of Stock-in-Trade' && m.mapping2_resultant === null && m.mapping3_resultant === null && m.level_format_id === null, JSON.stringify(m))
    ok('...and so are Levels 4-7', m.level4_value === null && m.level5_value === null, JSON.stringify(m))
    const k = merge(row, { mapping3_resultant: 'Other loans and advances' })
    ok('a field the edit leaves out is kept',
      k.mapping1_resultant === 'Current assets' && k.mapping2_resultant === STLA && k.level_format_id === 41 && k.mapping3_resultant === 'Other loans and advances' && k.override_note === 'Kept note', JSON.stringify(k))
  }
  const grid = readSrc('src/renderer/src/components/MappedTB/index.jsx')
  ok('the Mapped TB grid does not fall back to the old Mapping 2 when an edit clears it',
    /mergeMappingEdit\(rowData, updates\)/.test(grid) && !/updates\.mapping2_resultant \?\? rowData/.test(grid))
}

// ── 2. Auto-mapping: abnormal balances ───────────────────────────────────────
console.log('\n2. Auto-mapping: an abnormal balance moved between Income and Expenses')
{
  const mod = await load('src/main/services/mapping-engine.js')
  const reclassify = mod.reclassifyAbnormalBalances
  ok('the reclassification runs on its own (reclassifyAbnormalBalances)', typeof reclassify === 'function', mod.__missing || 'reclassifyAbnormalBalances is not exported')
  if (typeof reclassify === 'function') {
    const lf = [
      { id: 1, alie: 'Expenses', level1: 'Other expenses', level2: null, level3: null },
      { id: 2, alie: 'Income', level1: 'Other income', level2: null, level3: null },
      { id: 3, alie: 'ASSETS', level1: 'Current assets', level2: 'Other current assets', level3: null },
      { id: 4, alie: 'EQUITY AND LIABILITIES', level1: 'Current liabilities', level2: 'Other current liabilities', level3: null },
    ]
    // Stored signs: Income credit positive, Expenses debit negative — these two are the wrong way round.
    const tbRows = new Map([[10, { id: 10, name: 'Sales Return', closing_balance: '-5000' }], [11, { id: 11, name: 'Purchase Rebate', closing_balance: '7000' }]])
    const results = [
      { tb_row_id: 10, alie: 'Income', mapping1_resultant: 'Revenue from operations', mapping2_resultant: 'Sale', mapping3_resultant: 'Sale of goods', level_format_id: 99, level5_value: 'x' },
      { tb_row_id: 11, alie: 'Expenses', mapping1_resultant: 'Purchases of Stock-in-Trade', mapping2_resultant: STLA, mapping3_resultant: GST_L3, level_format_id: 98 },
    ]
    reclassify(results, tbRows, lf)
    const [inc, exp] = results
    ok('Income ledger with a debit balance: Other expenses, with no Level 2/3 of Revenue from operations',
      inc.mapping1_resultant === 'Other expenses' && inc.mapping2_resultant == null && inc.mapping3_resultant == null && inc.level_format_id === 1 && inc.level5_value == null, JSON.stringify(inc))
    ok('Expense ledger with a credit balance: Other income, with no Level 2/3 of the head it left',
      exp.mapping1_resultant === 'Other income' && exp.mapping2_resultant == null && exp.mapping3_resultant == null && exp.level_format_id === 2, JSON.stringify(exp))
  }
}

// ── Fixture: the Santosh Kumar Gupta shape ───────────────────────────────────
const LF = [
  { alie: 'ASSETS', level1: 'Current assets', level2: STLA, level3: GST_L3 },
  { alie: 'ASSETS', level1: 'Current assets', level2: 'Other current assets', level3: null },
  { alie: 'ASSETS', level1: 'Current assets', level2: 'Cash and bank balances', level3: null },
  { alie: 'ASSETS', level1: 'Non-current assets', level2: 'Others', level3: null },
  { alie: 'EQUITY AND LIABILITIES', level1: 'Current liabilities', level2: 'Other current liabilities', level3: 'Statutory dues payable' },
  { alie: 'EQUITY AND LIABILITIES', level1: 'Current liabilities', level2: 'Trade payables', level3: null },
  { alie: 'EQUITY AND LIABILITIES', level1: "Owners' Funds", level2: "Owners' Capital Account", level3: null },
  { alie: 'Income', level1: 'Revenue from operations', level2: 'Sale', level3: null },
  { alie: 'Income', level1: 'Other income', level2: 'Others', level3: null },
  { alie: 'Expenses', level1: 'Purchases of Stock-in-Trade', level2: null, level3: null },
  { alie: 'Expenses', level1: 'Other expenses', level2: 'Rent', level3: null },
]
// Sign convention as stored in tb_rows: Dr negative, Cr positive.
function row(name, alie, level1, level2, closing, extra = {}) {
  return {
    alie, level1, mapping1_resultant: level1, level2: level2 || null, mapping2_resultant: level2 || null,
    level3: extra.level3 || null, mapping3_resultant: extra.level3 || null,
    name, ledger_name: name, ledger_code: '', closing_balance: String(closing), opening_balance: String(extra.opening || 0),
    status: extra.status || 'user_override',
  }
}
const cyRows = () => [
  row('Capital Account', 'EQUITY AND LIABILITIES', "Owners' Funds", "Owners' Capital Account", 5361029.83),
  row('Sundry Creditors', 'EQUITY AND LIABILITIES', 'Current liabilities', 'Trade payables', 363727.88),
  row('Cash', 'ASSETS', 'Current assets', 'Cash and bank balances', -3448470.35),
  row('Sale proceeds receivable', 'ASSETS', 'Current assets', 'Sale', -10000),                // a P&L heading under a Balance Sheet head
  row('Security deposit', 'ASSETS', 'Non-current assets', 'Others', -20000),                   // "Others" is used on both statements
  row('PURCHSE IMPORT', 'Expenses', 'Purchases of Stock-in-Trade', null, -36363750),
  row('Purchase Unragistar', 'Expenses', 'Purchases of Stock-in-Trade', null, -64162),
  row('PURCHASE 5% ( Unragister)', 'Expenses', 'Purchases of Stock-in-Trade', null, -69365975),
  row('Purchase Gst 5%', 'Expenses', 'Purchases of Stock-in-Trade', STLA, -186000, { level3: GST_L3 }),
  row('Freight Inward', 'Expenses', 'Purchases of Stock-in-Trade', 'Freight Inward', -25000),  // a custom line the CA typed
  row('Sales 5%', 'Income', 'Revenue from operations', 'Sale', 106387500),
  row('IGST SALES', 'Income', 'Revenue from operations', STLA, 300000),
  row('SALE GST NIL', 'Income', 'Revenue from operations', STLA, 80415),
  row('Misc receipts', 'Income', 'Other income', 'Others', 5000),
  row('Rent', 'Expenses', 'Other expenses', 'Rent', -120000),
]
const pyRows = () => [
  row('Capital Account', 'EQUITY AND LIABILITIES', "Owners' Funds", "Owners' Capital Account", 11113429.81),
  row('Purchase Unragistar', 'Expenses', 'Purchases of Stock-in-Trade', null, -975026),
  row('PURCHASE 5% ( Unragister)', 'Expenses', 'Purchases of Stock-in-Trade', null, -141856),
  row('Sales 5%', 'Income', 'Revenue from operations', 'Sale', 1080000),
  row('SALE GST NIL', 'Income', 'Revenue from operations', STLA, 137675),
]

// ── 3. Statements: a Level 2 from the other statement ────────────────────────
console.log('\n3. Statements ignore a Level 2 heading that belongs to the other statement')
const fin = await load('src/renderer/src/hooks/useFinancials.js')
const guard = fin.ignoreForeignLevel2
ok('the financials pipeline checks Level 2 against Level 1 (ignoreForeignLevel2)', typeof guard === 'function', fin.__missing || 'ignoreForeignLevel2 is not exported')
const cyG = typeof guard === 'function' ? guard(cyRows(), LF) : { rows: cyRows(), flagged: [] }
const pyG = typeof guard === 'function' ? guard(pyRows(), LF) : { rows: pyRows(), flagged: [] }
{
  const names = (list) => list.map(f => f.ledger).sort().join(', ')
  ok('flagged: Purchase Gst 5%, IGST SALES, SALE GST NIL (P&L heads) and Sale proceeds receivable (BS head)',
    names(cyG.flagged) === 'IGST SALES, Purchase Gst 5%, SALE GST NIL, Sale proceeds receivable', names(cyG.flagged) || 'nothing flagged')
  const pg = cyG.rows.find(r => r.name === 'Purchase Gst 5%')
  ok('Purchase Gst 5% keeps Purchases of Stock-in-Trade, without the Balance Sheet Level 2 or the Level 3 under it',
    pg && pg.level1 === 'Purchases of Stock-in-Trade' && !pg.level2 && !pg.mapping2_resultant && !pg.level3 && !pg.mapping3_resultant, JSON.stringify(pg))
  ok('a custom line the CA typed (Freight Inward) is kept', cyG.rows.find(r => r.name === 'Freight Inward')?.level2 === 'Freight Inward')
  ok('a caption the format uses on both statements ("Others") is kept',
    cyG.rows.find(r => r.name === 'Misc receipts')?.level2 === 'Others' && cyG.rows.find(r => r.name === 'Security deposit')?.level2 === 'Others')
  ok('Previous Year rows get the same treatment (SALE GST NIL)', names(pyG.flagged) === 'SALE GST NIL', names(pyG.flagged) || 'nothing flagged')
  const exc = readSrc('src/renderer/src/components/ExceptionReport/index.jsx')
  ok('the Exception Report lists the flagged ledgers', /data\.foreignLevel2/.test(exc))
  const mtb = readSrc('src/main/ipc/mapped-tb.js')
  ok('the Rectification queue lists them too, and a save never keeps a format row naming another Level 1/2',
    /foreignLevel2/.test(mtb) && /CLIENT_LF_SQL\(4, 1, 2\)/.test(mtb))
}

// ── 4. Notes screen, PDF and Excel agree ─────────────────────────────────────
console.log('\n4. Every P&L note: the same lines on screen, in the PDF and in Excel, adding up to its total')
{
  const ag = await load('src/renderer/src/utils/annexureGrouping.js')
  const html = await load('src/renderer/src/components/GenerateFinancials/buildHTML.js')
  const xl = await load('src/renderer/src/components/GenerateFinancials/buildExcel.js')
  ok('the Notes screen, the PDF and the Excel export share one definition of a note\'s lines (plNoteLines)', typeof ag.plNoteLines === 'function', ag.__missing || 'plNoteLines is not exported')

  const data = fin.processRows(cyG.rows, fin.buildPrevMap(pyG.rows), 1, [], 'Trader', false, false, null)
  data.levelFormat = LF
  data.manualTaxLines = []
  const plNotes = Object.values(data.notes).filter(n => n.isPL && !n.isEmpty)
  const noteByTitle = (t) => plNotes.find(n => (n.title || '').toLowerCase() === t.toLowerCase())

  // What the Notes screen shows (same helper the screen uses).
  const screenLines = (note) => typeof ag.plNoteLines === 'function'
    ? ag.plNoteLines(note).map(({ line, label }) => ({ label, cy: line.total, py: line.prevTotal }))
    : (note.lines || []).filter(l => l.level2).map(l => ({ label: l.level2, cy: l.total, py: l.prevTotal }))

  const bsInPl = plNotes.flatMap(n => screenLines(n).filter(l => BS_HEADINGS.has(String(l.label).toLowerCase())).map(l => `${n.title} > ${l.label}`))
  ok('no P&L note shows a Balance Sheet heading as a line', bsInPl.length === 0, bsInPl.join('; '))
  const purchases = noteByTitle('Purchases of Stock-in-Trade')
  ok('Purchases of Stock-in-Trade on screen: "Purchases" and "Freight Inward", totalling 10,60,04,887.00 (PY 11,16,882.00)',
    !!purchases && screenLines(purchases).map(l => l.label).sort().join('|') === 'Freight Inward|Purchases' && near(purchases.total, 106004887) && near(purchases.prevTotal, 1116882),
    purchases ? `${screenLines(purchases).map(l => `${l.label} ${l.cy}`).join(', ')}; total ${purchases.total} / ${purchases.prevTotal}` : 'note missing')
  const revenue = noteByTitle('Revenue from operations')
  const revUnclassified = revenue && screenLines(revenue).find(l => l.label === 'Unclassified')
  ok('Revenue from operations on screen: "Sale" and "Unclassified" 3,80,415.00 (PY 1,37,675.00)',
    !!revUnclassified && near(revUnclassified.cy, 380415) && near(revUnclassified.py, 137675), revenue ? screenLines(revenue).map(l => `${l.label} ${l.cy}/${l.py}`).join(', ') : 'note missing')

  // ── the PDF ──
  let pdfHtml = ''
  try {
    pdfHtml = html.buildFinancialsHTML({
      entity: { name: 'Selftest Proprietor', constitution: 1, constitution_display: 'Proprietorship' },
      activeTB: { id: 1, period: '2025-04-01 To 2026-03-31' }, prevTB: { id: 2, period: '2024-04-01 To 2025-03-31' }, data,
      auditor: null, signatories: [], signPlace: 'Siliguri', signDate: '2026-09-13',
    })
  } catch (e) { ok('the PDF document builds', false, e.stack) }
  const parseINR = (s) => {
    const t = String(s || '').replace(/&nbsp;/g, '').trim()
    if (!t || t === '—' || t === '-') return 0
    const neg = /^\(.*\)$/.test(t)
    const n = parseFloat(t.replace(/[(),]/g, '')) || 0
    return neg ? -n : n
  }
  const pdfNote = (note) => {
    const clean = pdfHtml.replace(/<template[\s\S]*?<\/template>/g, '')
    const at = clean.indexOf(`>Note ${note.num}: ${note.title}<`)
    if (at < 0) return null
    const table = clean.slice(at, clean.indexOf('</table>', at))
    const rows = [...table.matchAll(/<tr[^>]*>\s*<td class="indent-\d[^"]*"[^>]*>([^<]*)<\/td>\s*<td><\/td>\s*<td class="right"[^>]*>([^<]*)<\/td>\s*<td class="right"[^>]*>([^<]*)<\/td>/g)]
      .map(m => ({ label: m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim(), cy: parseINR(m[2]), py: parseINR(m[3]) }))
    const t = /<tr class="total-row">\s*<td>Total<\/td>\s*<td><\/td>\s*<td class="right">([^<]*)<\/td>\s*<td class="right">([^<]*)<\/td>/.exec(table)
    return { rows, total: t ? { cy: parseINR(t[1]), py: parseINR(t[2]) } : null }
  }

  // ── Excel, with its formulas evaluated ──
  let wb = null
  try {
    wb = xl.buildFinancialsWorkbook({
      entity: { name: 'Selftest Proprietor', constitution: 1, constitution_display: 'Proprietorship' },
      activeTB: { id: 1, period: '2025-04-01 To 2026-03-31' }, prevTB: { id: 2, period: '2024-04-01 To 2025-03-31' },
      data, levelFormat: LF, auditor: null, signatories: [],
    })
  } catch (e) { ok('the Excel workbook builds', false, e.stack) }
  const evaluate = workbookEvaluator(wb)
  const excelNote = (note) => {
    const ws = wb?.Sheets?.Notes
    if (!ws) return null
    const range = XLSX.utils.decode_range(ws['!ref'])
    const a = (r) => String(ws[XLSX.utils.encode_cell({ c: 0, r })]?.v ?? '')
    let r = range.s.r
    while (r <= range.e.r && a(r) !== `Note ${note.num}: ${note.title}`) r++
    if (r > range.e.r) return null
    const rows = []
    for (r++; r <= range.e.r && !/^Note \d+: /.test(a(r)); r++) {
      const label = a(r).trim()
      if (!label) continue
      const cy = evaluate('Notes', XLSX.utils.encode_cell({ c: 2, r })), py = evaluate('Notes', XLSX.utils.encode_cell({ c: 3, r }))
      if (label === 'Total') return { rows, total: { cy, py } }
      rows.push({ label, cy, py })
    }
    return { rows, total: null }
  }

  const same = (x, y) => x.length === y.length && x.every((l, i) => l.label === y[i].label && near(l.cy, y[i].cy) && near(l.py, y[i].py))
  const show = (list) => list.map(l => `${l.label} ${l.cy}/${l.py}`).join(', ')
  for (const note of plNotes) {
    const screen = screenLines(note)
    const pdf = pdfNote(note)
    const excel = excelNote(note)
    const sum = (list, k) => list.reduce((s, l) => s + (Number(l[k]) || 0), 0)
    const tag = `Note ${note.num} ${note.title}`
    ok(`${tag}: the PDF prints the lines the Notes screen shows`, !!pdf && same(pdf.rows, screen), pdf ? `PDF [${show(pdf.rows)}] vs screen [${show(screen)}]` : 'not found in the PDF')
    ok(`${tag}: the Excel Notes sheet has the same lines`, !!excel && same(excel.rows, screen), excel ? `Excel [${show(excel.rows)}] vs screen [${show(screen)}]` : 'not found in Excel')
    if (screen.length) {
      ok(`${tag}: its lines add up to the note total (CY ${note.total}, PY ${note.prevTotal})`,
        near(sum(screen, 'cy'), note.total) && near(sum(screen, 'py'), note.prevTotal), `${sum(screen, 'cy')} / ${sum(screen, 'py')}`)
    }
    ok(`${tag}: PDF and Excel totals equal the app's`, !!pdf?.total && !!excel?.total && near(pdf.total.cy, note.total) && near(excel.total.cy, note.total) && near(pdf.total.py, note.prevTotal) && near(excel.total.py, note.prevTotal),
      `PDF ${pdf?.total?.cy}/${pdf?.total?.py}, Excel ${excel?.total?.cy}/${excel?.total?.py}, app ${note.total}/${note.prevTotal}`)
  }

  const plWs = wb?.Sheets?.['Profit & Loss']
  const faceValue = (rx) => {
    if (!plWs) return null
    const range = XLSX.utils.decode_range(plWs['!ref'])
    for (let r = range.s.r; r <= range.e.r; r++) {
      if (rx.test(String(plWs[XLSX.utils.encode_cell({ c: 0, r })]?.v ?? ''))) return evaluate('Profit & Loss', XLSX.utils.encode_cell({ c: 2, r }))
    }
    return null
  }
  const purchasesSec = data.expenseSections.find(s => /purchases of stock-in-trade/i.test(s.level1 || ''))
  const revenueSec = data.incomeSections.find(s => /revenue from operations/i.test(s.level1 || ''))
  ok('Excel P&L: Purchases of Stock-in-Trade shows the app\'s 10,60,04,887.00', near(faceValue(/Purchases of Stock-in-Trade/i), purchasesSec?.total), `${faceValue(/Purchases of Stock-in-Trade/i)} vs ${purchasesSec?.total}`)
  ok('Excel P&L: Revenue from operations shows the app\'s 10,67,67,915.00', near(faceValue(/Revenue from operations/i), revenueSec?.total), `${faceValue(/Revenue from operations/i)} vs ${revenueSec?.total}`)
}

console.log(fails ? `\n${fails} check(s) FAILED\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)

// Evaluates the few formula shapes buildExcel.js writes (cell and cross-sheet
// references, ranges, SUM, + - * /, unary minus), the way Excel would.
function workbookEvaluator(wb) {
  const memo = new Map()
  const value = (sheet, addr) => {
    const key = `${sheet}!${addr}`
    if (memo.has(key)) return memo.get(key)
    memo.set(key, 0)
    const cell = wb?.Sheets?.[sheet]?.[addr]
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
