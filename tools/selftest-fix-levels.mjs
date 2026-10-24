/**
 * Pre-release self-test: "Fix" must be clear for EVERY level a ledger can lack (Level 4 to Level 7),
 * and for the Previous Year as much as the Current Year.
 *
 * Asked for live: Fix showed only the Level 5 nature (Secured / Unsecured / Doubtful, PPE class);
 * a ledger that lacked a Level 4 sub-head (Statutory dues payable -> GST payable / TDS payable...)
 * or a Level 6 (Term loans, Loans repayable on demand -> Secured / Unsecured) had no editor in
 * Recategorisation and no flag on the Notes screen. The Previous Year view needed to read the same.
 *
 * Checked here, on the REAL Level Format (Mapping_v2.xlsx):
 *   A. which of Level 4-7 a ledger needs, what it still lacks, and how outdated wording is seen;
 *   B. the Notes template rows: Level 4 / Level 6 "Unclassified" carry their ledger ids (Current and
 *      Previous Year), and Level 5 still does;
 *   C. Level 4 / Level 6 flags are for the screen only - the real PDF and Excel builders never print them;
 *   D. the Recategorisation screen: Level 4-7 columns where needed, "To fix" chips, the count, the
 *      Current Year (n) / Previous Year (m) switch, the level the Fix was about.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 *
 *   node tools/selftest-fix-levels.mjs
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
const React = require(path.join(root, 'node_modules', 'react'))
const { renderToString } = require(path.join(root, 'node_modules', 'react-dom', 'server'))

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
  const tmp = path.join(os.tmpdir(), `fsg-selftest-lv-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try { return await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
}
const reactShim = { name: 'react-shim', setup(b) {
  b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
  b.onLoad({ filter: /^react$/, namespace: 'shim' }, () => ({ contents: REACT_SHIM, loader: 'js' }))
} }

console.log(`\nFix clarity for Level 4-7 and the Previous Year${srcRoot !== root ? `  (source: ${srcRoot})` : ''}`)

// ── the real Level Format ────────────────────────────────────────────────────
const wb = XLSX.readFile(path.join(root, 'Mapping_v2.xlsx'))
const lfAll = XLSX.utils.sheet_to_json(wb.Sheets.LevelFormat, { defval: null }).map((r, i) => ({
  id: i + 1, constitution: parseInt(r.Constitution), alie: r.ALIE,
  level1: r['Level 1'], level2: r['Level 2'], level3: r['Level 3'], level4: r['Level 4'], level5: r['Level 5'], level6: r['Level 6'], level7: r['Level 7'],
}))
const lf = (c) => lfAll.filter(r => r.constitution === c)
const LF3 = lf(3), LF1 = lf(1)
const alieOf = (c, l3) => lf(c).find(r => r.level3 === l3)?.alie

// ── A. what a ledger needs ───────────────────────────────────────────────────
console.log('\n  -- A. Level 4-7 from the Level Format --')
const util = await bundle('src/renderer/src/utils/fixTargets.js')
const haveLogic = !util.__missing && typeof util.natureLevelsFor === 'function' && typeof util.ledgerNeeds === 'function'
ok('the helper knows Levels 4-7 (natureLevelsFor / ledgerNeeds in utils/fixTargets.js)', haveLogic, util.__missing || 'not exported')
if (haveLogic) {
  const L = (rows, row, level) => util.natureLevelsFor(rows, row).find(n => n.level === level)
  const need = (rows, row) => util.ledgerNeeds(rows, row).map(n => n.what)
  const base3 = { mapping1_resultant: 'Current liabilities', mapping2_resultant: 'Other current liabilities', mapping3_resultant: 'Statutory dues payable' }
  const stat = L(LF3, base3, 4)
  ok('Level 4: Statutory dues payable asks for a sub-head (GST payable / TDS payable / ...)', !!stat && stat.required && stat.options.includes('GST payable') && stat.options.includes('TDS payable') && !stat.ok, JSON.stringify(stat))
  ok('...it is missing until chosen, and complete once one of the options is held', need(LF3, base3).includes('Level 4') && !need(LF3, { ...base3, level4_value: 'GST payable' }).length)
  const term = { mapping1_resultant: 'Non-current liabilities', mapping2_resultant: 'Long-term borrowings', mapping3_resultant: 'Term loans' }
  ok('Level 5 AND Level 6 for Term loans (from banks / from other parties, then Secured / Unsecured)', !!L(LF3, term, 5)?.required && !!L(LF3, term, 6)?.required && sameSet([need(LF3, term).length], [2]), JSON.stringify(need(LF3, term)))
  ok('...having only Level 5 leaves exactly Level 6 to fix', JSON.stringify(need(LF3, { ...term, level5_value: L(LF3, term, 5)?.options[0] })) === JSON.stringify(['Level 6']))
  const dem = { mapping1_resultant: 'Current liabilities', mapping2_resultant: 'Short-term borrowings', mapping3_resultant: 'Loans repayable on demand' }
  ok('Loans repayable on demand - one Level Format row per Level 5 value - still yields Level 5 and Level 6 options', !!L(LF3, dem, 5)?.required && !!L(LF3, dem, 6)?.required, JSON.stringify(util.natureLevelsFor(LF3, dem).map(n => [n.level, n.options])))
  const oth = { mapping1_resultant: 'Current liabilities', mapping2_resultant: 'Other current liabilities', mapping3_resultant: 'Other payables' }
  const l7 = L(LF3, oth, 7)
  ok('Level 7 "Specify nature" is free text, never a required drop-down', !!l7 && l7.freeText && !l7.required && !need(LF3, oth).length, JSON.stringify(l7))
  const nc = { mapping1_resultant: 'Non-current liabilities', mapping2_resultant: 'Long-term provisions', mapping3_resultant: 'Other Provisions' }
  ok('Level 4 works for constitution 1 (non-corporate) the same way', !!L(LF1, nc, 4)?.required && need(LF1, nc).includes('Level 4'), JSON.stringify(util.natureLevelsFor(LF1, nc).map(n => n.level)))
  const stla = { mapping1_resultant: 'Current assets', mapping2_resultant: 'Short-term loans and advances', mapping3_resultant: 'Others' }
  const outdated = L(LF3, { ...stla, level5_value: 'Unsecured' }, 5)
  ok('an outdated value ("Unsecured") is seen as not one of the options, with wording that says so', !!outdated && outdated.outdated && !outdated.ok && util.ledgerNeeds(LF3, { ...stla, level5_value: 'Unsecured' }).some(n => /not an option/.test(n.hint || '')), JSON.stringify(outdated))
  const stlaId = LF3.find(r => r.level3 === 'Others' && r.level2 === 'Short-term loans and advances')?.id
  ok('captions that lead nowhere fall back to the ledger\'s own level_format_id', !!L(LF3, { mapping1_resultant: 'Current assets', mapping2_resultant: 'Loans and advances (old caption)', level_format_id: stlaId }, 5)?.required)
  ok('a ledger still uncategorised is told to get Mapping 1 / Mapping 2 first', JSON.stringify(need(LF3, { mapping1_resultant: 'Current liabilities', mapping2_resultant: 'Uncategorised Current liabilities' })) === JSON.stringify(['Mapping 2']) && JSON.stringify(need(LF3, {})) === JSON.stringify(['Mapping 1']))
  const tp = { mapping1_resultant: 'Current liabilities', mapping2_resultant: 'Trade payables', mapping3_resultant: 'Due to Creditors other than MSME', alie: alieOf(3, 'Statutory dues payable') }
  ok('a classified Trade payable has nothing left to fix', typeof util.isComplete === 'function' && util.isComplete(LF3, tp) && !need(LF3, tp).length, JSON.stringify(need(LF3, tp)))
  ok('...an engine flag (discrepancy / conflict) is something left to do', typeof util.isComplete === 'function' && !util.isComplete(LF3, { ...tp, status: 'discrepancy' }) && need(LF3, { ...tp, status: 'conflict' }).includes('Engine review'))
  ok('...so is a Level 2 the format puts on the other statement (a Balance Sheet heading under a P&L line)', need(LF3, { mapping1_resultant: 'Purchases of Stock-in-Trade', mapping2_resultant: 'Short-term loans and advances', alie: 'Expenses' }).includes('Mapping 2'))
  ok('...and an "Uncategorised ..." caption is never complete', typeof util.isComplete === 'function' && !util.isComplete(LF3, { ...tp, mapping3_resultant: 'Uncategorised Trade payables' }))
}

// ── B. the Notes template rows ───────────────────────────────────────────────
console.log('\n  -- B. Notes: Level 4 / Level 6 "Unclassified" carry their ledgers --')
const E = alieOf(3, 'Statutory dues payable'), A = alieOf(3, 'Others')
function row(id, name, alie, l1, l2, l3, closing, l = {}, tb = 1) {
  return {
    mapped_id: id, tb_row_id: id + 5000, tb_id: tb, name, ledger_name: name, ledger_code: '', alie,
    level1: l1, mapping1_resultant: l1, level2: l2, mapping2_resultant: l2, level3: l3, mapping3_resultant: l3,
    level4_value: l.l4 || null, level5_value: l.l5 || null, level6_value: l.l6 || null, level7_value: l.l7 || null,
    closing_balance: String(closing), opening_balance: '0', status: 'auto_medium', upload_nature: null, sort_order: null,
  }
}
const OCL = ['Current liabilities', 'Other current liabilities'], TL = ['Non-current liabilities', 'Long-term borrowings'], SL = ['Current assets', 'Short-term loans and advances']
// filled = true : every Level 4 / Level 6 is set (the same ledgers, nothing to fix at those levels)
const cyRows = (filled) => [
  // Not GST-named: GST ledgers take their Level 4 from GST netting (0.1.72).
  row(301, 'Professional Tax Payable', E, ...OCL, 'Statutory dues payable', 40000, { l4: filled ? 'Professional tax payable' : null }),
  row(302, 'TDS Payable', E, ...OCL, 'Statutory dues payable', 15000, { l4: 'TDS payable' }),
  row(303, 'HDFC Term Loan', E, ...TL, 'Term loans', 500000, { l5: 'from banks', l6: filled ? 'Secured' : null }),
  row(304, 'Friend Loan', E, ...TL, 'Term loans', 100000, { l5: null, l6: 'Unsecured' }),
  row(305, 'Advance to Vendor', A, ...SL, 'Others', -30000, {}),
]
const pyRows = () => [row(401, 'Old PF Payable (PY only)', E, ...OCL, 'Statutory dues payable', 9000, {}, 2)]
const activeTB = { id: 1, period: '2025-04-01 To 2026-03-31' }
const prevTB = { id: 2, period: '2024-04-01 To 2025-03-31' }
const entity = { id: 7, name: 'Level Test Pvt Ltd', constitution: 3, constitution_display: 'Company', business_type: 'Trader' }
let FILLED = false
globalThis.window = {
  api: {
    getFinancialData: async (id) => (id === 1 ? cyRows(FILLED) : id === 2 ? pyRows() : []),
    getLevelFormat: async () => LF3.map(r => ({ ...r })),
    listNoteDetails: async () => [],
    depGet: async () => null, depITGet: async () => null, depCompGet: async () => null,
    getManualPY: async () => false, listManualPyEntries: async () => [],
    getPlClosedToCapital: async () => false, getGeneralNotes: async () => null,
  },
}
const fh = await bundle('src/renderer/src/hooks/useFinancials.js', [reactShim])
const dataOf = async (filled) => { FILLED = filled; return fh.fetchFinancialsData(activeTB, prevTB, entity, null) }
const data = await dataOf(false)
const notesOf = (d) => Object.values(d.notes || {})
const tplOf = (d, rx) => (notesOf(d).find(n => rx.test(n.title || ''))?.templateRowsAll || [])
const unc = (d, rx, parent, level) => tplOf(d, rx).find(r => r.unclassified && r.parentL3 === parent && (r.natureLevel || 5) === level)

const l4 = unc(data, /other current liabilities/i, 'Statutory dues payable', 4)
ok('Level 4: "Unclassified" under Statutory dues payable carries the ledger without a sub-head (301) - not the classified one (302)', !!l4 && sameSet(l4.ledgerIds, [301]), JSON.stringify(tplOf(data, /other current liabilities/i).filter(r => r.unclassified).map(r => [r.parentL3, r.natureLevel, r.ledgerIds])))
ok('...and the Previous Year ledger that lacks it (401) is carried apart, so the Previous Year opens it', !!l4 && sameSet(l4.pyLedgerIds, [401]), l4 && JSON.stringify(l4.pyLedgerIds))
const l6 = unc(data, /borrowings/i, 'Term loans', 6)
ok('Level 6: "Unclassified" under Term loans carries the ledger without Secured / Unsecured (303)', !!l6 && sameSet(l6.ledgerIds, [303]), JSON.stringify(tplOf(data, /borrowings/i).filter(r => r.unclassified).map(r => [r.parentL3, r.natureLevel, r.ledgerIds])))
const l5t = unc(data, /borrowings/i, 'Term loans', 5)
ok('Level 5 under Term loans is its own line, with its own ledger (304)', !!l5t && sameSet(l5t.ledgerIds, [304]), l5t && JSON.stringify(l5t.ledgerIds))
const l5o = unc(data, /short-term loans and advances/i, 'Others', 5)
ok('Level 5 elsewhere is unchanged (Short-term loans and advances / Others -> 305)', !!l5o && sameSet(l5o.ledgerIds, [305]), l5o && JSON.stringify(l5o.ledgerIds))
ok('Level 4 / Level 6 lines are marked screen-only; Level 5 lines are not', !!l4 && l4.screenOnly === true && !!l6 && l6.screenOnly === true && !!l5t && !l5t.screenOnly && !!l5o && !l5o.screenOnly)
const dataFilled = await dataOf(true)
const l4f = unc(dataFilled, /other current liabilities/i, 'Statutory dues payable', 4)
ok('once this year\'s Level 4 and Level 6 are set, no Current Year ledger is flagged there any more (the Previous Year ledger, 401, still is)', (!l4f || ((l4f.ledgerIds || []).length === 0 && sameSet(l4f.pyLedgerIds, [401]))) && !unc(dataFilled, /borrowings/i, 'Term loans', 6), JSON.stringify(l4f && [l4f.ledgerIds, l4f.pyLedgerIds]))

// ── C. never printed ─────────────────────────────────────────────────────────
console.log('\n  -- C. the real PDF and Excel builders do not print the screen-only lines --')
const htmlMod = await bundle('src/renderer/src/components/GenerateFinancials/buildHTML.js', [reactShim])
const xl = await bundle('src/renderer/src/components/GenerateFinancials/buildExcel.js', [reactShim])
const decode = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
const count = (text, rx) => (text.match(rx) || []).length
const printed = (d) => {
  const opts = { entity, activeTB, prevTB, data: d, auditor: null, signatories: [], noteDetailsMap: {}, noteDisclosureMap: {}, signPlace: '', signDate: '' }
  const pdf = decode(htmlMod.buildFinancialsHTML(opts))
  const book = xl.buildFinancialsWorkbook({ entity, activeTB, prevTB, data: d, levelFormat: LF3, auditor: null, signatories: [], noteDetailsMap: {}, signPlace: '', signDate: '' })
  let cells = 0
  for (const name of book.SheetNames) for (const r of XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '' })) for (const c of r) if (/^\s*Unclassified\s*$/.test(String(c))) cells++
  return { pdf: count(pdf, /\bUnclassified\b/g), xlsx: cells }
}
try {
  const withGaps = printed(data), withoutGaps = printed(dataFilled)
  ok('Level 5 "Unclassified" is still printed (the Level 5 gaps are real disclosure gaps): PDF and Excel', withGaps.pdf >= 1 && withGaps.xlsx >= 1, JSON.stringify(withGaps))
  ok('the SAME ledgers with Level 4 / Level 6 left blank print exactly as much "Unclassified" as with them set - PDF', withGaps.pdf === withoutGaps.pdf, `${withGaps.pdf} vs ${withoutGaps.pdf}`)
  ok('...and in the Excel', withGaps.xlsx === withoutGaps.xlsx, `${withGaps.xlsx} vs ${withoutGaps.xlsx}`)
} catch (e) { ok('the builders run on this data', false, e.message) }

// ── D. the Recategorisation screen ───────────────────────────────────────────
console.log('\n  -- D. Recategorisation screen --')
globalThis.__ledgers = []
globalThis.__lf = []
globalThis.__py = false
const screenFile = path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'Exceptions', 'index.jsx')
const built = await esbuild.build({
  entryPoints: [screenFile], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  loader: { '.js': 'jsx', '.jsx': 'jsx' }, jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')], banner: BANNER,
  plugins: [{
    name: 'inject',
    setup(b) {
      b.onResolve({ filter: /^react(\/jsx-runtime|\/jsx-dev-runtime)?$/ }, (a) => { const p = require.resolve(a.path, { paths: [root] }); return { path: a.kind === 'require-call' ? p : pathToFileURL(p).href, external: true } })
      b.onLoad({ filter: /Exceptions[\\/]index\.jsx$/ }, (args) => ({
        contents: fs.readFileSync(args.path, 'utf8')
          .replace('const [ledgers, setLedgers] = useState([])', 'const [ledgers, setLedgers] = useState(globalThis.__ledgers)')
          .replace('const [levelFormat, setLevelFormat] = useState([])', 'const [levelFormat, setLevelFormat] = useState(globalThis.__lf)')
          .replace('const [categorisePY, setCategorisePY] = useState(false)', 'const [categorisePY, setCategorisePY] = useState(globalThis.__py)')
          .replace('const [hiddenComplete, setHiddenComplete] = useState(new Set())', 'const [hiddenComplete, setHiddenComplete] = useState(globalThis.__hidden || new Set())')
          .replace('const [showHidden, setShowHidden] = useState(false)', 'const [showHidden, setShowHidden] = useState(!!globalThis.__showHidden)'),
        loader: 'jsx', resolveDir: path.dirname(args.path),
      }))
    },
  }],
})
const tmp = path.join(os.tmpdir(), `fsg-selftest-lv-ui-${process.pid}.mjs`)
fs.writeFileSync(tmp, built.outputFiles[0].text)
const Screen = (await import(pathToFileURL(tmp).href)).default
fs.rmSync(tmp, { force: true })
globalThis.window = { api: {} }
const render = (props) => renderToString(React.createElement(Screen, { entity: { id: 1, constitution: 3 }, activeTB: { id: 1 }, prevTB: { id: 2, period: '2024-04-01 To 2025-03-31' }, activeRsId: 1, ...props })).replace(/<!-- -->/g, '')
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const ledger = (id, name, alie, l1, l2, l3, closing, l = {}) => ({
  id, name, alie, mapping1_resultant: l1, mapping2_resultant: l2, mapping3_resultant: l3,
  level4_value: l.l4 || null, level5_value: l.l5 || null, level6_value: l.l6 || null, level7_value: l.l7 || null,
  status: 'auto_medium', closing_balance: String(closing), opening_balance: '0',
})
globalThis.__lf = LF3
globalThis.__ledgers = [
  ledger(1, 'HDFC Term Loan', E, ...TL, 'Term loans', 500000, { l5: 'from banks' }),                              // Level 6 missing
  ledger(2, 'GST Payable', E, ...OCL, 'Statutory dues payable', 40000),                                           // Level 4 missing
  ledger(3, 'TDS Payable', E, ...OCL, 'Statutory dues payable', 15000, { l4: 'TDS payable' }),                    // complete
  ledger(4, 'Advance to Vendor', A, ...SL, 'Others', -30000, { l5: 'Unsecured' }),                               // Level 5 holds outdated wording
]
const grid = render({})
const t = text(grid)
ok('the grid has a "To fix" column, and every level it needs: Level 4, Level 5, Level 6', /To fix/.test(t) && /Level 4 \(sub-head\)/.test(t) && /Level 5 \(nature\)/.test(t) && /Level 6 \(Secured \/ Unsecured\)/.test(t), t.slice(0, 400))
ok('...but not Level 7 (no ledger here needs it)', !/Level 7 \(specify nature\)/.test(t))
ok('Level 4 has its own drop-down (GST payable, TDS payable...); the held value is selected', /<option value="GST payable"/.test(grid) && /<option value="TDS payable" selected/.test(grid))
ok('Level 6 has its own drop-down (Secured / Unsecured)', /<option value="Secured"/.test(grid) && /<option value="Unsecured"/.test(grid))
ok('each ledger says what it lacks - Level 6 for the term loan, Level 4 for the GST ledger', /Level 6 · choose Secured \/ Unsecured/.test(t) && /Level 4 · choose GST payable/.test(t), t.replace(/.*To fix/, '').slice(0, 500))
ok('outdated wording is named as such (Level 5 “Unsecured” is not an option) and stays visible to replace', /“Unsecured” is not an option/.test(t) && /\(not an option\)/.test(t))
ok('the complete ledger says so', /✓ complete/.test(t))
ok('the count of ledgers still needing a fix is shown (3 of 4)', /3 still need fixing/.test(t), t.match(/\d+ still need fixing|every ledger shown is complete/)?.[0])
globalThis.__ledgers = [ledger(1, 'HDFC Term Loan', E, ...TL, 'Term loans', 500000, { l5: 'from banks', l6: 'Secured' }), ledger(3, 'TDS Payable', E, ...OCL, 'Statutory dues payable', 15000, { l4: 'TDS payable' })]
const done = text(render({}))
ok('when every ledger is complete it says so, and the count is gone', /every ledger shown is complete/.test(done) && !/still need fixing/.test(done))
globalThis.__ledgers = [ledger(1, 'HDFC Term Loan', E, ...TL, 'Term loans', 500000, { l5: 'from banks' })]
ok('a screen with no ledger needing Level 4 has no Level 4 column', !/Level 4 \(sub-head\)/.test(text(render({}))))

// the scope banner: Current Year (n) / Previous Year (m) and the level the Fix was about
const scope = { alie: E, mapping1_resultant: 'Current liabilities', title: 'Fix Unclassified (Level 4) — Statutory dues payable', key: 1, mappedIds: [2], pyMappedIds: [401, 402], focusLevel: 4 }
globalThis.__ledgers = [ledger(2, 'GST Payable', E, ...OCL, 'Statutory dues payable', 40000)]
const scoped = render({ initialFilter: scope })
const st = text(scoped)
ok('a Fix names its scope with both years: "Current Year (1)" and "Previous Year (2)"', /Current Year \(1\)/.test(st) && /Previous Year \(2\)/.test(st), st.slice(0, 500))
ok('the Fix says which level it is about, and that column is highlighted', /Fix is about Level 4/.test(st) && /<th[^>]*ring-amber-400[^>]*>\s*Level 4 \(sub-head\)/.test(scoped), (scoped.match(/<th[^>]*>[^<]*Level 4[^<]*/) || [])[0])
globalThis.__py = true
globalThis.__ledgers = [{ ...ledger(401, 'Old GST Payable (PY only)', E, ...OCL, 'Statutory dues payable', 9000) }]
const pyView = render({ initialFilter: scope })
const pt = text(pyView)
ok('the Previous Year reads the same: badge, both years in the banner, the ledger with its Level 4 drop-down and "To fix" chip', /PREVIOUS YEAR/.test(pt) && /Current Year \(1\)/.test(pt) && /Previous Year \(2\)/.test(pt) && /Old GST Payable/.test(pt) && /<option value="GST payable"/.test(pyView) && /Level 4 · choose GST payable/.test(pt), pt.slice(0, 400))
globalThis.__py = false

// ledgers the database query listed although nothing is left on them: held back, counted, one click away
globalThis.__py = false
globalThis.__ledgers = [
  ledger(1, 'HDFC Term Loan', E, ...TL, 'Term loans', 500000, { l5: 'from banks' }),
  ledger(10, 'Alpha Traders', E, 'Current liabilities', 'Trade payables', 'Due to Creditors other than MSME', 250000),
  ledger(11, 'Kappa Customer', A, 'Current assets', 'Trade receivables', 'Unsecured, considered good', -300000),
]
globalThis.__hidden = new Set([10, 11])
const heldHtml = render({}), held = text(heldHtml)
ok('complete ledgers the query listed (Trade payables / receivables) are held back - not in the grid - while the one that needs work stays', /HDFC Term Loan/.test(held) && !/Alpha Traders/.test(held) && !/Kappa Customer/.test(held), held.slice(0, 300))
ok('...and it says so: "2 listed ledgers are already complete and held back - show them"', /2 listed ledgers are already complete and held back/.test(held) && /show them/.test(held) && /Showing 1 of 1 rows/.test(held), (held.match(/Showing.{0,200}/) || [])[0])
globalThis.__showHidden = true
const shownHtml = text(render({}))
ok('one click brings them back ("hide them" offered)', /Alpha Traders/.test(shownHtml) && /Kappa Customer/.test(shownHtml) && /hide them/.test(shownHtml))
globalThis.__showHidden = false
globalThis.__ledgers = globalThis.__ledgers.slice(1)
ok('when nothing but complete ledgers were listed the screen says so, not "no rows match"', /Every ledger in this list is already complete/.test(text(render({}))))
globalThis.__hidden = new Set()

// every reason a ledger can be listed has a chip: an engine flag, and a Level 2 of the other statement
globalThis.__ledgers = [
  { ...ledger(20, 'Cash', A, 'Current assets', 'Cash and bank balances', 'Cash on hand', -20000), status: 'discrepancy' },
  { ...ledger(21, 'Purchase Gst 5%', 'Expenses', 'Purchases of Stock-in-Trade', 'Short-term loans and advances', null, -5000) },
]
const why = text(render({}))
ok('an engine-flagged ledger says "Engine review" instead of "complete"', /Engine review · more than one possible match/.test(why), why.slice(0, 200))
ok('a ledger under a Level 2 of the other statement says so', /Mapping 2 · belongs to the other statement/.test(why))

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
