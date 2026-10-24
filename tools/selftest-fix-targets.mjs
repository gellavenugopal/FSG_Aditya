/**
 * Pre-release self-test: the "Fix" button (Notes / Balance Sheet / P&L) must open the ACTUAL
 * ledgers behind the flagged line in Rectification / Recategorisation.
 *
 * Reported live: Fix sometimes opened an empty screen - mostly Loans & advances "Unclassified"
 * (Secured / Unsecured / Doubtful) and PPE. Traced end to end: Fix sent a FILTER OF CAPTIONS built
 * from what Notes / BS compute IN MEMORY (level-format-first, GST-netted, Previous Year aware,
 * "not one of the options" = Unclassified) and mappedTB:findByFilter looked them up with exact `=`
 * on the raw columns (and "Unclassified" as *blank* Level 5 only). Any disagreement found nothing,
 * and the screen said "No exceptions". The rows carried no ledger id.
 *
 * Now the ledger rows carry mapped_id, every Fix carries mappedIds / pyMappedIds, the SQL opens
 * exactly those, and a Previous-Year-only flag opens the Previous Year.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 *
 *   node tools/selftest-fix-targets.mjs
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

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + String(detail).slice(0, 320)}`)
}
const sameSet = (a, b) => JSON.stringify([...(a || [])].sort((x, y) => x - y)) === JSON.stringify([...(b || [])].sort((x, y) => x - y))

const REACT_SHIM = 'const React = { createElement: () => null, useCallback: (f) => f }; export default React; export const useState = () => []; export const useEffect = () => {}; export const useRef = () => ({}); export const useMemo = (f) => f(); export const useCallback = (f) => f;'
const BANNER = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }
async function bundle(rel, plugins = []) {
  const file = path.join(srcRoot, ...rel.split('/'))
  if (!fs.existsSync(file)) return { __missing: `${rel} does not exist` }
  const built = await esbuild.build({
    stdin: { contents: `export * from ${JSON.stringify(file)}\n`, resolveDir: srcRoot, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' }, nodePaths: [path.join(root, 'node_modules')], banner: BANNER, plugins,
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-fix-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try { return await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
}
const reactShim = { name: 'react-shim', setup(b) {
  b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
  b.onLoad({ filter: /^react$/, namespace: 'shim' }, () => ({ contents: REACT_SHIM, loader: 'js' }))
} }
// main-process modules: electron + the db client are replaced by recorders
const mainShims = { name: 'main-shims', setup(b) {
  b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'shim' }))
  b.onLoad({ filter: /^electron$/, namespace: 'shim' }, () => ({ contents: 'export const ipcMain = { handle: (c, f) => (globalThis.__handlers[c] = f) }; export const dialog = {}; export const app = { getPath: () => "" }; export class BrowserWindow {}; export const safeStorage = {}', loader: 'js' }))
  b.onResolve({ filter: /client\.js$/ }, () => ({ path: 'db-client', namespace: 'shim' }))
  b.onLoad({ filter: /.*/, namespace: 'db-client-ns' }, () => null)
  b.onLoad({ filter: /^db-client$/, namespace: 'shim' }, () => ({ contents: 'export const query = (...a) => globalThis.__query(...a); export const runInTransaction = async (f) => f()', loader: 'js' }))
} }

console.log(`\nFix button opens the actual ledgers${srcRoot !== root ? `  (source: ${srcRoot})` : ''}`)

// ── the helper ───────────────────────────────────────────────────────────────
const util = await bundle('src/renderer/src/utils/fixTargets.js')
ok('the shared helper exists (utils/fixTargets.js)', !util.__missing && typeof util.fixFilterWith === 'function', util.__missing)
if (util.fixFilterWith) {
  ok('ledgerIdsOf: unique ids of ledger rows, ignoring rows without one', sameSet(util.ledgerIdsOf([{ mapped_id: 3 }, { mapped_id: '3' }, { mapped_id: 7 }, {}, null, { mapped_id: 'x' }]), [3, 7]))
  const f = util.fixFilterWith({ alie: 'ASSETS', uncategorised: true }, [{ mapped_id: 1 }, { mapped_id: 2 }], [{ mapped_id: 9 }])
  ok('fixFilterWith keeps the caption filter and adds the ids (CY and PY)', f.alie === 'ASSETS' && f.uncategorised === true && sameSet(f.mappedIds, [1, 2]) && sameSet(f.pyMappedIds, [9]), JSON.stringify(f))
  ok('no ledgers behind the line: the caption filter goes alone (nothing invented)', !('mappedIds' in util.fixFilterWith({ alie: 'X' }, [], [])) && !('pyMappedIds' in util.fixFilterWith({ alie: 'X' }, [{}], null)))
  const scope = util.fixFilterWith({ alie: 'ASSETS', mapping1_resultant: 'Current assets', level5_unclassified: true }, [{ mapped_id: 4 }, { mapped_id: 5 }], [{ mapped_id: 8 }])
  const cy = util.resolveFixScope(scope, false), py = util.resolveFixScope(scope, true)
  ok('the screen queries the ledger ids for the year shown (not the captions)', cy.idScoped && sameSet(cy.ids, [4, 5]) && cy.filter === null && py.idScoped && sameSet(py.ids, [8]))
  const pyOnly = util.fixFilterWith({ alie: 'ASSETS' }, [], [{ mapped_id: 8 }])
  const cyEmpty = util.resolveFixScope(util.fixFilterWith({ alie: 'ASSETS' }, [{ mapped_id: 4 }], []), true)
  ok('ids scope with nothing for the year shown = nothing to query (never "no filter" = everything)', cyEmpty.idScoped && cyEmpty.ids.length === 0)
  ok('a flag that exists only in the Previous Year opens the Previous Year (when there is one)', util.fixOpensPreviousYear(pyOnly, true) && !util.fixOpensPreviousYear(pyOnly, false) && !util.fixOpensPreviousYear(scope, true))
  const plain = util.resolveFixScope({ alie: 'ASSETS', mapping1_resultant: 'Current assets', uncategorised: true, title: 't', key: 1 }, false)
  ok('a Fix without ledgers still falls back to the caption filter', !plain.idScoped && plain.filter.alie === 'ASSETS' && plain.filter.uncategorised === true)
}

// ── the SQL ──────────────────────────────────────────────────────────────────
globalThis.__handlers = {}
let SQLS = []
globalThis.__query = async (sql, params) => { SQLS.push({ sql: String(sql), params }); return { rows: [] } }
const mapped = await bundle('src/main/ipc/mapped-tb.js', [mainShims])
if (mapped.registerMappedTBHandlers) {
  mapped.registerMappedTBHandlers()
  const find = globalThis.__handlers['mappedTB:findByFilter']
  SQLS = []; await find(null, 5, { alie: 'ASSETS', mapping1_resultant: 'Current assets', mappedIds: [3, '4', 7.5, 'x'] })
  const q = SQLS[SQLS.length - 1]
  ok('mappedTB:findByFilter opens exactly the ledger ids it is given (integers only), ignoring the caption conditions', !!q && /mt\.id = ANY\(\$1::int\[\]\)/.test(q.sql) && !/mt\.alie = /.test(q.sql) && !/mt\.tb_id = /.test(q.sql) && JSON.stringify(q.params) === JSON.stringify([[3, 4]]), q && JSON.stringify(q.params) + ' ' + q.sql.replace(/\s+/g, ' ').slice(-260))
  SQLS = []; await find(null, 5, { alie: 'ASSETS', mapping1_resultant: 'Current assets' })
  const q2 = SQLS[SQLS.length - 1]
  ok('without ids it still filters by Trial Balance and captions, as before', !!q2 && /mt\.tb_id = \$1/.test(q2.sql) && /mt\.alie = \$2/.test(q2.sql) && !/ANY\(/.test(q2.sql), q2 && q2.sql.replace(/\s+/g, ' ').slice(-200))
} else ok('mapped-tb.js loads', false, mapped.__missing || 'no registrar')

const fin = await bundle('src/main/ipc/financials.js', [mainShims])
if (fin.registerFinancialHandlers) {
  globalThis.__handlers = {}
  fin.registerFinancialHandlers()
  for (const [chan, args] of [['financials:getData', [1]], ['financials:getConsolidatedData', [1]], ['financials:getBranchTBsData', [1]]]) {
    SQLS = []
    globalThis.__query = async (sql, params) => { SQLS.push({ sql: String(sql) }); return { rows: /trial_balances/.test(String(sql)) ? [{ id: 1, branch_name: 'B', period: 'p' }] : [] } }
    await globalThis.__handlers[chan](null, ...args)
    const withRows = SQLS.filter(s => /FROM mapped_tb/i.test(s.sql))
    ok(`${chan}: ledger rows carry their mapped-row id (mapped_id)`, withRows.length > 0 && withRows.every(s => /mt\.id\s+AS mapped_id/i.test(s.sql)), withRows.length + ' query(ies)')
  }
} else ok('financials.js loads', false, fin.__missing || 'no registrar')

// ── the data: what each flagged line says it is made of ──────────────────────
const E = 'EQUITY AND LIABILITIES', A = 'ASSETS'
const L5 = 'Secured, considered good / Unsecured, considered good / Doubtful'
const GST_L3 = 'Balances with government authorities (GST input credit and other tax credits)'
const STLA = 'Short-term loans and advances'
const PPE2 = 'Property, Plant and Equipment and Intangible assets'
const LF = [
  { alie: E, level1: 'Current liabilities', level2: 'Trade payables', level3: 'Due to Creditors other than MSME' },
  { alie: E, level1: 'Current liabilities', level2: 'Uncategorised Current liabilities', level3: null },
  { alie: A, level1: 'Current assets', level2: STLA, level3: 'Other loans and advances', level5: L5 },
  { alie: A, level1: 'Current assets', level2: STLA, level3: GST_L3, level5: L5 },
  { alie: A, level1: 'Non-current assets', level2: PPE2, level3: 'Property, plant and equipment', level5: 'Land / Buildings / Plant and Equipment' },
  { alie: 'Income', level1: 'Revenue from operations', level2: 'Sale', level3: null },
  { alie: 'Expenses', level1: 'Other expenses', level2: 'Rent', level3: null },
  { alie: 'Expenses', level1: 'Other expenses', level2: 'Uncategorised Other expenses', level3: null },
]
function row(id, name, alie, level1, level2, level3, closing, opening = 0, l5 = null) {
  return {
    mapped_id: id, tb_row_id: id + 5000, tb_id: 1,
    name, ledger_name: name, ledger_code: '', alie,
    level1, mapping1_resultant: level1, level2: level2 || null, mapping2_resultant: level2 || null,
    level3: level3 || null, mapping3_resultant: level3 || null,
    level4_value: null, level5_value: l5, level6_value: null, level7_value: null,
    closing_balance: String(closing), opening_balance: String(opening),
    status: 'auto_medium', upload_nature: null, sort_order: null,
  }
}
const cyRows = () => [
  row(101, 'Loan to Staff A', A, 'Current assets', STLA, 'Other loans and advances', -50000, 0, null),                 // blank nature
  row(102, 'Loan to Party B', A, 'Current assets', STLA, 'Other loans and advances', -30000, 0, 'Unsecured'),          // OLD wording: flagged in memory, not blank
  row(103, 'Loan to Party C', A, 'Current assets', STLA, 'Other loans and advances', -20000, 0, 'Unsecured, considered good'),   // classified
  row(104, 'Input CGST', A, 'Current assets', 'Other current assets', null, -10000, 0, null),                          // GST: netted into Short-term loans and advances in memory
  row(105, 'Plant and Machinery', A, 'Non-current assets', PPE2, 'Property, plant and equipment', -70000, 0, null),    // PPE class not set
  row(106, 'Mystery Creditor', E, 'Current liabilities', 'Uncategorised Current liabilities', null, 25000, 0),
  row(107, 'Misc Expense', 'Expenses', 'Other expenses', 'Uncategorised Other expenses', null, -8000, 0),
  row(108, 'Sales', 'Income', 'Revenue from operations', 'Sale', null, 900000, 0),
  row(109, 'Rent', 'Expenses', 'Other expenses', 'Rent', null, -20000, 0),
]
const pyRows = () => [
  { ...row(201, 'Old Advance (PY only)', A, 'Current assets', STLA, 'Other loans and advances', -5000, 0, null), tb_id: 2 },
]
const activeTB = { id: 1, period: '2025-04-01 To 2026-03-31' }
const prevTB = { id: 2, period: '2024-04-01 To 2025-03-31' }
const entity = { id: 7, name: 'Fix Test Pvt Ltd', constitution: 3, constitution_display: 'Company', business_type: 'Trader' }
globalThis.window = {
  api: {
    getFinancialData: async (id) => (id === 1 ? cyRows() : id === 2 ? pyRows() : []),
    getLevelFormat: async () => LF.map(r => ({ ...r })),
    listNoteDetails: async () => [],
    depGet: async () => null, depITGet: async () => null, depCompGet: async () => null,
    getManualPY: async () => false, listManualPyEntries: async () => [],
    getPlClosedToCapital: async () => false, getGeneralNotes: async () => null,
  },
}
const fh = await bundle('src/renderer/src/hooks/useFinancials.js', [reactShim])
const data = await fh.fetchFinancialsData(activeTB, prevTB, entity, null)
const notes = Object.values(data.notes || {})
const noteOf = (rx) => notes.find(n => rx.test(n.title || ''))

ok('the ledger rows survive processing with their mapped_id (netting, level-format re-siding, comparative rows)', notes.some(n => (n.rows || []).some(r => r.mapped_id === 104)), '')

const stla = noteOf(/short-term loans and advances/i)
ok('the Short-term loans and advances note exists', !!stla)
const tpl = (stla?.templateRowsAll || [])
const unclassified = tpl.filter(r => r.unclassified)
const other = unclassified.find(r => r.parentL3 === 'Other loans and advances')
const gst = unclassified.find(r => r.parentL3 === GST_L3)
ok('"Unclassified" under Other loans and advances is made of the ledgers with a blank OR outdated nature (101, 102) - not the classified one (103)', !!other && sameSet(other.ledgerIds, [101, 102]), other && JSON.stringify(other.ledgerIds))
ok('...and the Previous Year ledger that flags it (201) is carried separately', !!other && sameSet(other.pyLedgerIds, [201]), other && JSON.stringify(other.pyLedgerIds))
// GST netting gives a netted ledger its home's own Level 5 (0.1.72), so it is
// no longer flagged there; its Level 3 line still carries it for Fix / Annexure.
const gstL3 = tpl.find(r => r.type === 'l3' && r.label === GST_L3)
ok('the GST ledger netted into this note in memory (104) is not flagged Unclassified, and its line carries it - the raw database captions differ from what the note shows', !gst && !!gstL3 && sameSet(gstL3.ledgerIds, [104]), JSON.stringify([unclassified.map(r => [r.parentL3, r.ledgerIds]), gstL3 && gstL3.ledgerIds]))
const l3row = tpl.find(r => r.type === 'l3' && r.label === 'Other loans and advances')
ok('the Level 3 line itself carries all its ledgers (101, 102, 103)', !!l3row && sameSet(l3row.ledgerIds, [101, 102, 103]), l3row && JSON.stringify(l3row.ledgerIds))

const ppe = noteOf(/property, plant and equipment/i)
const ppeUnc = (ppe?.templateRowsAll || []).find(r => r.unclassified)
ok('PPE: the "Unclassified" class row carries its ledger (105)', !!ppeUnc && sameSet(ppeUnc.ledgerIds, [105]), JSON.stringify((ppe?.templateRowsAll || []).map(r => [r.label, r.unclassified, r.ledgerIds])))

const elLine = (data.elSections || []).flatMap(s => s.lines).find(l => /uncategorised current liabilities/i.test(l.level2 || ''))
ok('Balance Sheet: the "Uncategorised Current liabilities" line carries its ledger (106)', !!elLine && sameSet((elLine.rows || []).map(r => r.mapped_id), [106]), elLine && JSON.stringify((elLine.rows || []).map(r => r.mapped_id)))

const oe = noteOf(/other expenses/i)
const oeLine = (oe?.lines || []).find(l => /uncategorised/i.test(l.level2 || ''))
ok('P&L note: the "Uncategorised ..." line carries its ledger (107)', !!oeLine && sameSet((oeLine.rows || []).map(r => r.mapped_id), [107]), oeLine && JSON.stringify((oeLine.rows || []).map(r => r.mapped_id)))

// what the OLD Fix would have asked the database for, against the raw rows: the reported failure
const oldFilter = { alie: stla?.alie, mapping1_resultant: stla?.level1, mapping2_resultant: stla?.title, mapping3_resultant: 'Other loans and advances', level5_unclassified: true }
const oldSqlMatches = (r) => r.alie === oldFilter.alie && r.mapping1_resultant === oldFilter.mapping1_resultant && r.mapping2_resultant === oldFilter.mapping2_resultant &&
  r.mapping3_resultant === oldFilter.mapping3_resultant && (!r.level5_value || !String(r.level5_value).trim())
const found = cyRows().filter(oldSqlMatches).map(r => r.mapped_id)
ok('(for the record: the OLD caption search finds 101 only - it missed the ledger whose nature is outdated wording (102), and the netted GST ledger)', sameSet(found, [101]), JSON.stringify(found))

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
