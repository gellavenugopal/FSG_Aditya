/**
 * Pre-release self-test: the Other-expenses head asked for on the Stock tab, Raw Materials with no Cost of materials consumed line,
 * and the Other expenses note itself.
 *
 * What was wrong (0.1.92 and before), found while the CA asked where each Stock category is adjusted:
 *   - Stores & Spares / Loose Tools / Others stock was adjusted in three fixed "Opening Value / Less: Closing Value / Change in Stores &
 *     Spares, Loose Tools and Others" rows - there was no way to say WHICH line of Other expenses it belongs to (the CA wants it inside
 *     e.g. "Consumption of stores and spare parts").
 *   - Those three rows were put in a SECOND note whenever the entity also had ordinary Other-expense ledgers (Rent, ...): the P&L face
 *     showed the full Other expenses figure but pointed at a note holding only the stock rows, and the real note became a stray extra note.
 *   - Raw Materials stock was applied only when a "Cost of materials consumed" line existed; for a Service Provider (or a Manufacturer with
 *     no purchase ledger mapped there) it was left out of the P&L, so profit and the Balance Sheet were both out by the year's movement.
 *
 * What is proven:
 *  1. The statements (the app's real processRows, every constitution x Trader / Manufacturer / Service Provider):
 *     a named head is added into its own line of the one Other expenses note (a new line when the note has none), the face, the note and
 *     the Balance Sheet agree, the line's ledgers add up to the line (drill-down and Annexures), a head matches whatever the capitals or
 *     spacing, two categories can share a head, stock with no head keeps the three fixed rows (now inside the real note), Raw Materials
 *     with no Cost of materials consumed line go to Changes in inventories, with one still go there as before, and the Previous Year
 *     (a separate TB, with or without its own heads) comes out right.
 *  2. The Stock tab's helpers and its Excel round-trip (the heads travel in the last column; an older file without it still loads).
 *  3. The Stock screen's markup: the "Adjusted in (P&L)" column, plain text on the five fixed rows, a box on the other three that turns
 *     red once the row has an amount and no head.
 *  4. The real handlers on a throw-away PostgreSQL: the stock_head column is added to an existing database, saving keeps the head on the
 *     stock rows, re-mapping and a Fill Details upload (which names none) leave it alone, the statements' own queries return it, the pick
 *     list is built, and the whole way from the database to the Other expenses note comes out right.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source (to prove they fail on 0.1.92).
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-stock-heads.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import { register, createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = process.env.FSG_SRC_ROOT ? path.resolve(process.env.FSG_SRC_ROOT) : root
const oldSource = srcRoot !== root
register(pathToFileURL(path.join(root, 'tools', 'e2e-learned-rules', 'hooks.mjs')).href)
const xlsxShim = path.join(os.tmpdir(), `fsg-selftest-xlsx-heads-${process.pid}.mjs`)
fs.writeFileSync(xlsxShim, `import { createRequire } from 'node:module'
const X = createRequire(${JSON.stringify(pathToFileURL(path.join(root, 'package.json')).href)})('xlsx')
export const { read, readFile, utils, write, writeFile } = X
export default X
`)
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === 'xlsx') return { url: ${JSON.stringify(pathToFileURL(xlsxShim).href)}, shortCircuit: true }
  return next(specifier, context)
}`))
const require = createRequire(import.meta.url)
const esbuild = require(path.join(root, 'node_modules', 'esbuild'))
const React = require(path.join(root, 'node_modules', 'react'))
const { renderToString } = require(path.join(root, 'node_modules', 'react-dom', 'server'))
const XLSX = require(path.join(root, 'node_modules', 'xlsx-js-style'))

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + String(detail).slice(0, 400)}`)
}
const finish = () => { console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n') }
const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.5
const money = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN')
console.log(`\nOther-expenses heads on the Stock tab${oldSource ? `  (source: ${srcRoot})` : ''}`)

const src = (...p) => JSON.stringify(path.join(srcRoot, 'src', 'renderer', 'src', ...p))
const bundle = async (entry, tag, extraPlugins = []) => {
  const out = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', loader: { '.js': 'jsx', '.jsx': 'jsx' }, nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: extraPlugins,
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-heads-${tag}-${process.pid}.mjs`)
  fs.writeFileSync(tmp, out.outputFiles[0].text)
  try { return await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
}

// ═════ 1. the statements ═════
console.log('\n1. Statements (the real processRows)')
const reactShim = {
  name: 'react-shim',
  setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
    b.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({
      contents: 'const React = { createElement: () => null }; export default React; export const useState = () => []; export const useEffect = () => {}; export const useRef = () => ({}); export const useMemo = (f) => f(); export const useCallback = (f) => f; export const useContext = () => ({}); export const createContext = () => ({});', loader: 'js',
    }))
    // buildPrevMap is module-private; expose it to this test only.
    b.onLoad({ filter: /useFinancials\.js$/ }, (args) => ({ contents: fs.readFileSync(args.path, 'utf8') + '\nexport { buildPrevMap }\n', loader: 'jsx', resolveDir: path.dirname(args.path) }))
  },
}
const fin = await bundle(`
export { processRows, buildPrevMap, displayAmt } from ${src('hooks', 'useFinancials.js')}
export { getSubnoteGroups, subnoteGroupFigures } from ${src('utils', 'annexureGrouping.js')}
`, 'fin', [reactShim])
const { processRows, buildPrevMap, displayAmt, getSubnoteGroups, subnoteGroupFigures } = fin

function row(alie, level1, level2, closing, extra = {}) {
  const name = extra.name || `${level2 || level1} ledger`
  return {
    alie, level1, mapping1_resultant: level1, level2: level2 || null, mapping2_resultant: level2 || null,
    level3: extra.level3 || null, mapping3_resultant: extra.level3 || null,
    name, ledger_name: name, ledger_code: '', closing_balance: String(closing), opening_balance: String(extra.opening || 0),
    upload_nature: extra.upload_nature || null, level5_value: extra.level5_value || null, stock_head: extra.stock_head ?? null,
    sort_order: extra.sort_order ?? 9999, status: 'auto_high', is_deemed_positive: closing < 0,
  }
}
const purchaseL1 = { Trader: 'Purchases of Stock-in-Trade', Manufacturer: 'Cost of materials consumed', 'Service Provider': 'Uncategorised Purchase Accounts' }
// A balanced Trial Balance as the Stock tab leaves it: sales 10,00,000; rent 1,00,000; optional "Stores consumed" 2,00,000 under Other expenses >
// Consumption of stores and spare parts; optional purchases 6,00,000; then the stock rows (Opening Dr, Closing Cr in the P&L and Dr on the Balance
// Sheet). Capital is the balancing figure. Dr negative / Cr positive, as stored.
function tb(C, bt, { stores = true, rent = true, purchases = true, stock = [], extraExpenses = [], prefix = '' } = {}) {
  const rows = [row('Income', 'Revenue from operations', 'Sale of products', 1000000, { name: prefix + 'Sales' })]
  let dr = 0, cr = 1000000
  if (rent) { rows.push(row('Expenses', 'Other expenses', 'Rent', -100000, { name: prefix + 'Rent' })); dr += 100000 }
  if (stores) { rows.push(row('Expenses', 'Other expenses', 'Consumption of stores and spare parts', -200000, { name: prefix + 'Stores consumed' })); dr += 200000 }
  for (const x of extraExpenses) { rows.push(row('Expenses', 'Other expenses', x.l2, -x.amount, { name: prefix + x.l2 })); dr += x.amount }
  if (purchases) { rows.push(row('Expenses', purchaseL1[bt], null, -600000, { name: prefix + 'Purchases' })); dr += 600000 }
  for (const st of stock) {
    const S = { upload_nature: 'Stock Entry', level5_value: st.cat, stock_head: st.head ?? null }
    rows.push(row('Expenses', 'Opening Stock (PL)', 'Opening Stock', -st.open, { ...S, level3: 'Opening Stock', name: `${prefix}Opening Stock - ${st.cat}`, opening: -st.open }))
    rows.push(row('Income', 'Closing Stock (PL)', 'Closing Stock', st.close, { ...S, level3: 'Closing Stock', name: `${prefix}Closing Stock - PL - ${st.cat}` }))
    rows.push(row('ASSETS', 'Current assets', 'Inventories', -st.close, { ...S, level3: 'Closing Stock (BS)', opening: -st.open, name: `${prefix}Closing Stock - BS - ${st.cat}` }))
    dr += st.open + st.close; cr += st.close
  }
  // Capital is fixed (a non-corporate entity with a nil capital line has no equity note for the year's profit to land in); the bank balances it.
  rows.push(row('EQUITY AND LIABILITIES', "Owners' Funds", C === 3 ? 'Equity share capital' : "Owners' Capital Account", 400000, { name: prefix + 'Capital' })); cr += 400000
  rows.push(row('ASSETS', 'Current assets', 'Cash and bank balances', -(cr - dr), { name: prefix + 'Bank' }))
  return rows
}
const run = (C, bt, opts, prev = null, lfRows = []) => processRows(tb(C, bt, opts), prev, C, [], bt, false, false, null, lfRows, null)
const otherSec = (out) => (out.expenseSections || []).find(s => /^other expenses$/i.test((s.level1 || '').trim()))
const otherNotes = (out) => Object.values(out.notes || {}).filter(n => n.isPL && /^other expenses$/i.test((n.title || '').trim()))
const lineOf = (n, rx) => (n && n.lines || []).find(l => rx.test(l.level2 || ''))
const tallies = (out) => Math.abs(Number(out.totalAssets) - Number(out.totalEL)) < 1
const changesSec = (out) => (out.expenseSections || []).find(s => /changes in inventor/i.test(s.level1 || ''))
const materialsSec = (out) => (out.expenseSections || []).find(s => /^cost of materials consumed/i.test(s.level1 || ''))
const BTS = ['Manufacturer', 'Trader', 'Service Provider']
// Runs fn over every constitution x business type; null from fn = fine, a string = what went wrong there.
const everywhere = (fn) => {
  for (const C of [3, 2, 1]) for (const bt of BTS) {
    let r
    try { r = fn(C, bt) } catch (e) { r = 'threw: ' + (e && e.message) }
    if (r) return `[constitution ${C}, ${bt}] ${r}`
  }
  return ''
}
const HEAD = 'Consumption of stores and spare parts'
const SS = (head, open = 50000, close = 80000) => ({ cat: 'Stores & Spares', head, open, close })

// (a) a head the note already has a line for
{
  const bad = everywhere((C, bt) => {
    const out = run(C, bt, { stock: [SS(HEAD)] })
    const sec = otherSec(out), notes = otherNotes(out), note = notes[0]
    if (notes.length !== 1) return `${notes.length} notes titled Other expenses: ${notes.map(n => n.num + '=' + money(n.total)).join(', ')}`
    if (!sec || out.notes[sec.noteNum] !== note) return 'the P&L face does not point at the Other expenses note'
    if (!near(sec.total, 270000) || !near(note.total, 270000)) return `face ${money(sec && sec.total)} / note ${money(note.total)} (want 2,70,000)`
    const head = lineOf(note, /consumption of stores/i)
    if (!head || !near(head.total, 170000)) return `the head line is ${money(head && head.total)} (want 2,00,000 + 50,000 - 80,000 = 1,70,000)`
    if ((note.lines || []).some(l => /opening value of|closing value of|change in stores/i.test(l.level2 || ''))) return 'separate stock lines are still there'
    if (!tallies(out)) return `Balance Sheet out by ${money(Number(out.totalAssets) - Number(out.totalEL))}`
    if (!near(out.netProfit, 1000000 - 600000 - 100000 - 200000 - 50000 + 80000)) return `profit ${money(out.netProfit)}`
    return null
  })
  ok('a named head is added into its own line of the ONE Other expenses note; face, note, profit and Balance Sheet agree - 3 constitutions x 3 business types', !bad, bad)
}
// (b) the line's ledgers add up to the line - the drill-down and the Annexure group
{
  const bad = everywhere((C, bt) => {
    const out = run(C, bt, { stock: [SS(HEAD)] })
    const note = otherNotes(out)[0]
    const line = lineOf(note, /consumption of stores/i)
    const sum = (line.rows || []).reduce((s, r) => s + displayAmt(r, 'closing_balance'), 0)
    if (!near(sum, line.total)) return `the line's ledgers add up to ${money(sum)}, the line says ${money(line.total)}`
    const group = getSubnoteGroups(note, []).find(g => /consumption of stores/i.test(g.label))
    const fig = group && subnoteGroupFigures(note, group, { amount: displayAmt })
    if (!fig || !near(fig.cy, line.total)) return `the Annexure group shows ${money(fig && fig.cy)}`
    return null
  })
  ok('the head line\'s ledgers (the real ones, Opening stock, Closing stock as a credit) add up to the line - note drill-down and Annexure group agree', !bad, bad)
}
// (c) a head of the CA's own
{
  const bad = everywhere((C, bt) => {
    const out = run(C, bt, { stock: [{ cat: 'Loose Tools', head: 'Tools consumed', open: 20000, close: 25000 }] })
    const note = otherNotes(out)[0], sec = otherSec(out)
    if (otherNotes(out).length !== 1 || out.notes[sec.noteNum] !== note) return 'not one note, or the face points elsewhere'
    const line = lineOf(note, /^tools consumed$/i)
    if (!line || !near(line.total, -5000)) return `the new line is ${money(line && line.total)} (want 20,000 - 25,000 = -5,000)`
    const at = note.lines.indexOf(line)
    if (note.lines.slice(at + 1).some(l => !/uncategori/i.test(l.level2 || ''))) return 'the CA\'s own head is not after the standard lines'
    if (!near(note.total, sec.total) || !near(note.total, 300000 - 5000)) return `note ${money(note.total)} face ${money(sec.total)}`
    return tallies(out) ? null : 'Balance Sheet out'
  })
  ok('a head that is not in the note yet becomes a new line, after the standard ones', !bad, bad)
}
// (d) matching ignores capitals and spacing; two categories can share a head or keep their own
{
  const bad = everywhere((C, bt) => {
    let out = run(C, bt, { stock: [SS('  consumption of   STORES and spare parts '), { cat: 'Loose Tools', head: HEAD, open: 10000, close: 4000 }] })
    let note = otherNotes(out)[0]
    const same = (note.lines || []).filter(l => /consumption of stores/i.test(l.level2 || ''))
    if (same.length !== 1 || !near(same[0].total, 200000 - 30000 + 6000)) return `shared head: ${same.length} line(s), ${money(same[0] && same[0].total)} (want one of 1,76,000)`
    out = run(C, bt, { stock: [SS(HEAD), { cat: 'Loose Tools', head: 'Tools consumed', open: 10000, close: 4000 }] })
    note = otherNotes(out)[0]
    if (!near((lineOf(note, /consumption of stores/i) || {}).total, 170000) || !near((lineOf(note, /^tools consumed$/i) || {}).total, 6000)) return 'two heads: wrong lines'
    return tallies(out) ? null : 'Balance Sheet out'
  })
  ok('a head matches an existing line whatever the capitals or spacing; two categories add into one head or keep their own', !bad, bad)
}
// (e) no head named: the three fixed rows, now inside the one real note
{
  const bad = everywhere((C, bt) => {
    const out = run(C, bt, { stock: [SS(null)] })
    const note = otherNotes(out)[0], sec = otherSec(out)
    if (otherNotes(out).length !== 1 || out.notes[sec.noteNum] !== note) return `${otherNotes(out).length} notes titled Other expenses; face -> note ${sec && sec.noteNum}`
    if ((note.lines || []).filter(l => /stores & spares, loose tools and others/i.test(l.level2 || '')).length !== 3) return 'the three fixed rows are not there'
    if (!near(note.total, 270000) || !near(sec.total, 270000)) return `note ${money(note.total)} face ${money(sec.total)} (want 2,70,000)`
    if (!(note.lines || []).some(l => /rent/i.test(l.level2 || ''))) return 'the ordinary lines (Rent) are not in the note the face points at'
    return tallies(out) ? null : 'Balance Sheet out'
  })
  ok('stock with no head named keeps the three fixed rows - and they are now in the real Other expenses note, which the face points at', !bad, bad)
}
// (f) one head named, one not
{
  const bad = everywhere((C, bt) => {
    const out = run(C, bt, { stock: [SS(HEAD), { cat: 'Others', head: null, open: 10000, close: 4000 }] })
    const note = otherNotes(out)[0], sec = otherSec(out)
    if (!near(sec.total, 300000 - 30000 + 6000) || !near(note.total, sec.total)) return `face ${money(sec.total)} note ${money(note.total)}`
    if (!near((lineOf(note, /consumption of stores/i) || {}).total, 170000)) return 'the named head is wrong'
    if ((note.lines || []).filter(l => /opening value of|closing value of|change in stores/i.test(l.level2 || '')).length !== 3) return 'the unnamed stock has no fixed rows'
    return tallies(out) ? null : 'Balance Sheet out'
  })
  ok('a named category and an unnamed one side by side: each as it should be, totals agree', !bad, bad)
}
// (g) no ordinary Other-expenses ledger at all
{
  const bad = everywhere((C, bt) => {
    const out = run(C, bt, { rent: false, stores: false, stock: [SS(HEAD)] })
    const sec = otherSec(out), notes = otherNotes(out)
    if (!sec || notes.length !== 1 || out.notes[sec.noteNum] !== notes[0]) return 'no single Other expenses note the face points at'
    if (!near(notes[0].total, -30000) || !near(sec.total, -30000) || !near((lineOf(notes[0], /consumption of stores/i) || {}).total, -30000)) return `note ${money(notes[0].total)}`
    return tallies(out) ? null : 'Balance Sheet out'
  })
  ok('an entity with no other Other-expense ledger still gets its head line and one note', !bad, bad)
}
// (h) the Balance Sheet does not depend on how the stock is named
{
  const a = run(3, 'Manufacturer', { stock: [SS(HEAD)] }), b = run(3, 'Manufacturer', { stock: [SS(null)] })
  ok('the Balance Sheet (Inventories) is the same named or not', near(a.totalAssets, b.totalAssets) && near(a.totalEL, b.totalEL) && near(a.netProfit, b.netProfit))
}
// (i) Raw Materials
{
  const RM = { cat: 'Raw Materials', open: 50000, close: 80000 }
  let bad = everywhere((C, bt) => {
    if (bt === 'Manufacturer') return null
    const out = run(C, bt, { purchases: false, stock: [RM] })
    const ch = changesSec(out)
    if (!ch || !near(ch.total, -30000)) return `Changes in inventories ${money(ch && ch.total)} (want -30,000)`
    if (!/raw materials/i.test((ch.lines[0] || {}).level2 || '')) return `the lines do not say Raw Materials: ${ch.lines.map(l => l.level2).join(' | ')}`
    if (!tallies(out)) return `Balance Sheet out by ${money(Number(out.totalAssets) - Number(out.totalEL))}`
    if (!near(out.netProfit, 1000000 - 100000 - 200000 - 50000 + 80000)) return `profit ${money(out.netProfit)}`
    return null
  })
  ok('Raw Materials stock with no Cost of materials consumed line (Service Provider, Trader): adjusted in Changes in inventories, profit and Balance Sheet right', !bad, bad)
  bad = everywhere((C) => {
    const out = run(C, 'Manufacturer', { purchases: false, stock: [RM] })
    const ch = changesSec(out)
    if (!ch || !near(ch.total, -30000) || !tallies(out)) return `a Manufacturer with no purchase ledger: Changes in inventories ${money(ch && ch.total)}`
    return null
  })
  ok('...a Manufacturer with no purchase ledger mapped to Cost of materials consumed: the same', !bad, bad)
  bad = everywhere((C) => {
    const out = run(C, 'Manufacturer', { stock: [RM] })
    const cm = materialsSec(out), ch = changesSec(out)
    if (!cm || !near(cm.total, 570000)) return `Cost of materials consumed ${money(cm && cm.total)} (want 6,00,000 + 50,000 - 80,000)`
    if (ch && Math.abs(ch.total) > 0.5) return 'Raw Materials also in Changes in inventories'
    return tallies(out) ? null : 'Balance Sheet out'
  })
  ok('...with a Cost of materials consumed line, Raw Materials stock is still adjusted there (unchanged)', !bad, bad)
  const mixed = run(3, 'Service Provider', { purchases: false, stock: [RM, { cat: 'Finished Goods', open: 10000, close: 15000 }] })
  const mch = changesSec(mixed)
  ok('...together with Finished Goods: one Changes in inventories figure (-30,000 - 5,000)', mch && near(mch.total, -35000) && tallies(mixed), money(mch && mch.total))
  const trader = run(3, 'Trader', { stock: [{ cat: 'Stock-in-Trade', open: 10000, close: 15000 }] })
  ok('a Trader\'s Changes in inventories does not mention Raw Materials', !/raw materials/i.test((changesSec(trader).lines[0] || {}).level2 || ''))
}
// (j) Previous Year from a separate Trial Balance
{
  const PYX = [{ l2: HEAD, amount: 150000 }]
  const mk = (cyStock, pyStock, pyOpts = {}) => {
    const cy = tb(3, 'Manufacturer', { stock: cyStock })
    const py = tb(3, 'Manufacturer', { stock: pyStock, stores: false, extraExpenses: PYX, ...pyOpts, prefix: 'PY ' })
    return processRows(cy, buildPrevMap(py), 3, [], 'Manufacturer', false, false, null, [], null)
  }
  // last year: ordinary "Consumption of stores" 1,50,000 + Stores & Spares 30,000 -> 45,000 named the same head
  let out = mk([SS(HEAD)], [{ cat: 'Stores & Spares', head: HEAD, open: 30000, close: 45000 }])
  let note = otherNotes(out)[0], sec = otherSec(out)
  const line = lineOf(note, /consumption of stores/i)
  ok('Previous Year (its own TB, same head): the head line\'s PY = 1,50,000 + 30,000 - 45,000 = 1,35,000', line && near(line.prevTotal, 135000), money(line && line.prevTotal))
  ok('...the note\'s and the face\'s PY agree and nothing is counted twice (PY Rent 1,00,000 + 1,35,000)', near(note.prevTotal, 235000) && near(sec.prevTotal, 235000) && otherNotes(out).length === 1, `${money(note.prevTotal)} / ${money(sec.prevTotal)}`)
  ok('...and the Balance Sheet and Previous Year profit follow', tallies(out) && near(out.prevNetProfit, 1000000 - 600000 - 100000 - 135000), money(out.prevNetProfit))
  // last year's TB did not name the head (saved before the Stock tab asked): this year's head is used for it
  out = mk([SS(HEAD)], [{ cat: 'Stores & Spares', head: null, open: 30000, close: 45000 }])
  note = otherNotes(out)[0]
  ok('Previous Year TB with no head of its own: it is adjusted in this year\'s head (a comparative sits on its own line)', near((lineOf(note, /consumption of stores/i) || {}).prevTotal, 135000) && !(note.lines || []).some(l => /opening value of/i.test(l.level2 || '')), money((lineOf(note, /consumption of stores/i) || {}).prevTotal))
  // this year names a head the note had no line for, last year had ordinary ledgers under that caption but no stock
  out = processRows(tb(3, 'Manufacturer', { stores: false, stock: [SS(HEAD)] }), buildPrevMap(tb(3, 'Manufacturer', { stores: false, extraExpenses: PYX, prefix: 'PY ' })), 3, [], 'Manufacturer', false, false, null, [], null)
  note = otherNotes(out)[0]
  const carried = lineOf(note, /consumption of stores/i)
  ok('a new head line carries last year\'s ordinary figure for that caption (1,50,000 + nothing) - not lost to the Previous Year reconciliation', carried && near(carried.prevTotal, 150000) && near(note.prevTotal, 250000), `${money(carried && carried.prevTotal)} / ${money(note.prevTotal)}`)
  ok('...and counted once: the face\'s PY is the note\'s', near(otherSec(out).prevTotal, note.prevTotal), `${money(otherSec(out).prevTotal)} / ${money(note.prevTotal)}`)
}
// (k) consolidated: two branches' rows together
{
  const A = tb(3, 'Manufacturer', { stock: [SS(HEAD)], prefix: 'A ' }), B = tb(3, 'Manufacturer', { stock: [SS(null, 10000, 4000)], prefix: 'B ' })
  const out = processRows([...A, ...B], null, 3, [], 'Manufacturer', false, false, null, [], null)
  const note = otherNotes(out)[0]
  ok('two branches, one naming the head and one not: the category uses the named head in the consolidated statements, one note', otherNotes(out).length === 1 && near((lineOf(note, /consumption of stores/i) || {}).total, 400000 - 30000 + 6000) && near(note.total, otherSec(out).total) && tallies(out), money((lineOf(note, /consumption of stores/i) || {}).total))
}

// ═════ 1b. what the PDF and the Excel print ═════
console.log('\n1b. PDF and Excel')
try {
  const XLSXR = require(path.join(root, 'node_modules', 'xlsx'))
  const load = async (rel) => bundle(`export * from ${JSON.stringify(path.join(srcRoot, ...rel.split('/')))}`, 'x' + Math.random().toString(36).slice(2, 6), [{
    name: 'react-shim-2',
    setup(b) {
      b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
      b.onLoad({ filter: /^react$/, namespace: 'shim' }, () => ({ contents: 'const R={createElement:()=>null,useCallback:(f)=>f,useRef:()=>({})};export default R;export const useState=()=>[];export const useEffect=()=>{};export const useRef=()=>({});export const useMemo=(f)=>f();export const useContext=()=>({});export const createContext=()=>({});', loader: 'js' }))
    },
  }])
  const wbLF = XLSXR.readFile(path.join(srcRoot, 'Mapping_v2.xlsx'))
  const LF = XLSXR.utils.sheet_to_json(wbLF.Sheets.LevelFormat, { defval: null }).map((r, i) => ({
    id: i + 1, constitution: parseInt(r['Constitution']), alie: r['ALIE'], level1: r['Level 1'], level2: r['Level 2'], level3: r['Level 3'],
    level4: r['Level 4'], level5: r['Level 5'], level6: r['Level 6'], level7: r['Level 7'], sort_order: i,
  })).filter(r => r.constitution === 3)
  const lfRow = (l1, l2, l3 = null) => LF.find(r => r.level1 === l1 && (r.level2 || null) === (l2 || null) && ((r.level3 || null) === (l3 || null))) || {}
  const mk = (name, alie, l1, l2, l3, closing, opening = 0, extra = {}) => ({
    name, ledger_name: name, ledger_code: '', alie, level1: l1, mapping1_resultant: l1, level2: l2, mapping2_resultant: l2, level3: l3, mapping3_resultant: l3,
    level4_value: null, level5_value: extra.level5_value || null, level6_value: null, level7_value: null, closing_balance: String(closing), opening_balance: String(opening),
    status: 'user_approved', upload_nature: extra.upload_nature || null, stock_head: extra.stock_head ?? null, sort_order: lfRow(l1, l2, l3).sort_order ?? 9999, is_deemed_positive: closing < 0,
  })
  const stockOf = (cat, head, open, close, pfx) => ['Stores & Spares'].map(() => [
    mk(pfx + 'Opening Stock - ' + cat, 'Expenses', 'Opening Stock (PL)', 'Opening Stock', 'Opening Stock', -open, -open, { upload_nature: 'Stock Entry', level5_value: cat, stock_head: head }),
    mk(pfx + 'Closing Stock - PL - ' + cat, 'Income', 'Closing Stock (PL)', 'Closing Stock', 'Closing Stock', close, 0, { upload_nature: 'Stock Entry', level5_value: cat, stock_head: head }),
    mk(pfx + 'Closing Stock - BS - ' + cat, 'ASSETS', 'Current assets', 'Inventories', 'Closing Stock (BS)', -close, -open, { upload_nature: 'Stock Entry', level5_value: cat, stock_head: head }),
  ])[0]
  const books = (head, pfx, v) => [
    mk(pfx + 'Sales', 'Income', 'Revenue from operations', 'Sale of products', null, v.sales),
    mk(pfx + 'Purchases', 'Expenses', 'Cost of materials consumed', null, null, -v.purchases),
    mk(pfx + 'Rent', 'Expenses', 'Other expenses', 'Rent', null, -v.rent),
    mk(pfx + 'Stores consumed', 'Expenses', 'Other expenses', HEAD, null, -v.stores),
    ...stockOf('Stores & Spares', head, v.open, v.close, pfx),
    mk(pfx + 'Capital', 'EQUITY AND LIABILITIES', "Shareholders' funds", 'Share capital', null, 400000),
    mk(pfx + 'Bank', 'ASSETS', 'Current assets', 'Cash and bank balances', null, -(400000 + v.sales + v.close - v.purchases - v.rent - v.stores - v.open - v.close)),
  ]
  const CYV = { sales: 1000000, purchases: 600000, rent: 100000, stores: 200000, open: 50000, close: 80000 }, PYV = { sales: 800000, purchases: 500000, rent: 90000, stores: 150000, open: 30000, close: 50000 }
  const fin2 = await load('src/renderer/src/hooks/useFinancials.js')
  const htmlM = await load('src/renderer/src/components/GenerateFinancials/buildHTML.js')
  const xl = await load('src/renderer/src/components/GenerateFinancials/buildExcel.js')
  const entity = { id: 1, name: 'Heads Test Pvt Ltd', constitution: 3, constitution_display: 'Company', business_type: 'Manufacturer' }
  const activeTB = { id: 1, period: '2025-04-01 To 2026-03-31' }, prevTB = { id: 2, period: '2024-04-01 To 2025-03-31' }
  const exportsFor = async (head) => {
    globalThis.window = { api: {
      getFinancialData: async (id) => (id === 1 ? books(head, '', CYV) : id === 2 ? books(head, 'PY ', PYV) : []), getLevelFormat: async () => LF.map(r => ({ ...r })),
      listNoteDetails: async () => [], depGet: async () => null, depITGet: async () => null, depCompGet: async () => null,
      getManualPY: async () => false, listManualPyEntries: async () => [], getPlClosedToCapital: async () => false, getGeneralNotes: async () => null, getEps: async () => null,
    } }
    const data = await fin2.fetchFinancialsData(activeTB, prevTB, entity, null)
    const pdf = htmlM.buildFinancialsHTML({ entity, activeTB, prevTB, data, auditor: null, signatories: [], signPlace: 'X', signDate: '2026-10-05' }).replace(/<template[\s\S]*?<\/template>/g, '')
    const wb = xl.buildFinancialsWorkbook({ entity, activeTB, prevTB, data, levelFormat: LF, auditor: null, signatories: [], signPlace: 'X', signDate: '2026-10-05' })
    return { data, pdf, wb, text: pdf.replace(/<[^>]+>/g, '\n').split('\n').map(s => s.trim()).filter(Boolean) }
  }
  const named = await exportsFor(HEAD)
  const nn = Object.values(named.data.notes).filter(n => n.isPL && /^other expenses$/i.test(n.title))
  ok('the data behind the exports: one Other expenses note, the head line 1,70,000 / 1,30,000, Balance Sheet tallies', nn.length === 1 && near((lineOf(nn[0], /consumption of stores/i) || {}).total, 170000) && near((lineOf(nn[0], /consumption of stores/i) || {}).prevTotal, 130000) && tallies(named.data), nn.map(n => n.num + '=' + money(n.total)).join(', '))
  const at = named.text.findIndex(s => /^Consumption of stores and spare parts$/i.test(s))
  ok('PDF: the note prints the head line with its Current and Previous Year figures', at >= 0 && named.text[at + 1] === '1,70,000.00' && named.text[at + 2] === '1,30,000.00', JSON.stringify(named.text.slice(Math.max(0, at - 1), at + 4)))
  ok('PDF: no separate "Opening Value of / Closing Value of Stores & Spares" lines', !/Opening Value of Stores|Closing Value of Stores/i.test(named.pdf))
  ok('Excel: its own link check against the app\'s figures finds nothing to repair', Array.isArray(named.wb.linkRepairs) && named.wb.linkRepairs.length === 0, JSON.stringify(named.wb.linkRepairs))
  const grid = XLSX.utils.sheet_to_json(named.wb.Sheets['Annexures'], { header: 1, defval: '' })
  const start = grid.findIndex(r => /^Note \d+: Other expenses$/.test(String(r[0])))
  const block = []
  for (let i = start + 1; start >= 0 && i < grid.length && !/^Note \d+: /.test(String(grid[i][0])); i++) block.push(grid[i])
  const headRows = block.filter(r => String(r[1]).trim() === HEAD)
  ok('Excel Annexure: the head\'s ledgers - Stores consumed 2,00,000, Opening stock 50,000, Closing stock (80,000) - are listed and add up to the line (1,70,000)', headRows.length === 3 && near(headRows.reduce((s, r) => s + (Number(r[3]) || 0), 0), 170000) && headRows.some(r => /closing stock/i.test(String(r[0])) && Number(r[3]) < 0), JSON.stringify(headRows))
  const legacy = await exportsFor(null)
  ok('stock with no head: the PDF still prints the three fixed rows, and the Excel check is clean', /Opening Value of Stores & Spares, Loose Tools and Others/i.test(legacy.pdf.replace(/&amp;/g, '&')) && Array.isArray(legacy.wb.linkRepairs) && legacy.wb.linkRepairs.length === 0, JSON.stringify(legacy.wb.linkRepairs))
} catch (e) {
  ok('the PDF / Excel checks ran', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e))
}

// ═════ 2. the Stock tab's helpers and its Excel round-trip ═════
console.log('\n2. Stock tab helpers and Excel')
let helpers = null, wbMod = null
try { helpers = await bundle(`export * from ${src('components', 'Stock', 'stockHeads.js')}`, 'helpers') } catch (e) { helpers = null }
try { wbMod = await bundle(`export * from ${src('components', 'Stock', 'stockWorkbook.js')}`, 'workbook') } catch (e) { wbMod = null }
ok('the Stock tab helpers exist (components/Stock/stockHeads.js)', !!helpers, 'not found in this source')
ok('the Stock tab Excel round-trip loads (components/Stock/stockWorkbook.js)', !!wbMod && typeof wbMod.parseStockWorkbook === 'function')
if (helpers) {
  const H = helpers
  ok('three categories ask for a head', JSON.stringify(H.HEAD_TYPES) === JSON.stringify(['Stores & Spares', 'Loose Tools', 'Others']))
  ok('a head is cleaned (spaces, length) and compared without regard to capitals', H.cleanHead('  Power   and\tfuel ') === 'Power and fuel' && H.headKey(' POWER and  Fuel') === 'power and fuel' && H.cleanHead('x'.repeat(300)).length === 120)
  const maps = { opening: { 'Stores & Spares': '50000', 'Raw Materials': '1000' }, closing: { 'Loose Tools': '5' }, pyOpening: {}, pyClosing: { Others: '7' } }
  ok('the rows that still need a head: every one of the three that has any figure (Current or Previous Year) and none named', JSON.stringify(H.typesNeedingHead(maps, {})) === JSON.stringify(['Stores & Spares', 'Loose Tools', 'Others']))
  ok('...none once they are named; Raw Materials never asks', H.typesNeedingHead(maps, { 'Stores & Spares': 'A', 'Loose Tools': 'B', Others: 'C' }).length === 0 && !H.typesNeedingHead({ opening: { 'Raw Materials': '5' } }, {}).length)
  ok('a figure of nil is not a figure', H.typesNeedingHead({ opening: { 'Stores & Spares': '0', Others: '' } }, {}).length === 0)
  ok('what is saved: the heads of the categories that have a figure, nothing for the others', JSON.stringify(H.headsToSave(maps, { 'Stores & Spares': ' A ', 'Loose Tools': '', Others: 'C', 'Raw Materials': 'Z' })) === JSON.stringify({ 'Stores & Spares': 'A', Others: 'C' }))
  ok('where each fixed category lands, by business type', H.stockDestination('Raw Materials', 'Manufacturer') === 'Cost of materials consumed' && H.stockDestination('Raw Materials', 'Trader') === 'Changes in inventories' && H.stockDestination('Finished Goods', 'Trader') === 'Changes in inventories' && H.stockDestination('Uncategorised Stock', 'Service Provider') === 'Changes in inventories' && H.stockDestination('Loose Tools', 'Trader') === null)
  const opts = H.headOptions({ lastYear: 'Power and fuel', inTB: [{ name: 'Rent', total: 1 }, { name: 'power AND fuel', total: 2 }], standard: ['Rent', 'Insurance', ' '] })
  ok('the pick-list: last year first, then this Trial Balance, then the standard captions, each once', JSON.stringify(opts.map(o => [o.name, o.group])) === JSON.stringify([['Power and fuel', 'Last year'], ['Rent', 'In this Trial Balance'], ['Insurance', 'Standard heads']]), JSON.stringify(opts))
  ok('typing narrows the list; what is typed snaps to the listed spelling', H.filterHeadOptions(opts, 'INSUR').length === 1 && H.snapHead(' rent ', opts) === 'Rent' && H.snapHead('Tools consumed', opts) === 'Tools consumed')
}
if (wbMod) try {
  const W = wbMod
  const filled = W.buildStockFilledWorkbook({ 'Stores & Spares': 50000, 'Raw Materials': 7 }, { 'Stores & Spares': 80000 }, { Others: 3 }, {}, true, { 'Stores & Spares': 'Consumption of stores and spare parts', Others: 'Packing material', 'Raw Materials': 'ignored' })
  const aoa = XLSX.utils.sheet_to_json(filled.Sheets[filled.SheetNames[0]], { header: 1, defval: '' })
  ok('the Excel file has the head column (last), filled for the three categories only', /other expenses head/i.test(String(aoa[0][5])) && aoa.find(r => r[0] === 'Stores & Spares')[5] === 'Consumption of stores and spare parts' && aoa.find(r => r[0] === 'Raw Materials')[5] === '', JSON.stringify(aoa[0]))
  const back = W.parseStockWorkbook(filled)
  const backHeads = back.heads || {}
  ok('...and it reads back: amounts and heads', back.opening['Stores & Spares'] === '50000' && back.closing['Stores & Spares'] === '80000' && back.pyOpening.Others === '3' && backHeads['Stores & Spares'] === 'Consumption of stores and spare parts' && backHeads.Others === 'Packing material' && !backHeads['Raw Materials'], JSON.stringify(back))
  ok('...without reporting its own note lines as unknown categories', back.unrecognised.length === 0, JSON.stringify(back.unrecognised))
  const old = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(old, XLSX.utils.aoa_to_sheet([['Type of Inventory', 'Opening (Current Year)', 'Closing (Current Year)', 'Opening (Previous Year)', 'Closing (Previous Year)'], ['Stores & Spares', 10, 20, '', ''], ['Raw Materials', 1, 2, '', '']]), 'Stock Filled')
  const oldBack = W.parseStockWorkbook(old)
  ok('an older file (no head column) still loads - it names no heads', oldBack.opening['Stores & Spares'] === '10' && Object.keys(oldBack.heads || {}).length === 0 && oldBack.unrecognised.length === 0)
  const blank = W.buildStockBlankTemplate()
  const blankRows = XLSX.utils.sheet_to_json(blank.Sheets[blank.SheetNames[0]], { header: 1, defval: '' })
  ok('the blank template has the column too, and its note parses as no category', /other expenses head/i.test(String(blankRows[0][5])) && W.parseStockWorkbook(blank).unrecognised.length === 0)
} catch (e) {
  ok('the Excel round-trip checks ran', false, e && e.message)
}

// ═════ 3. the Stock screen ═════
console.log('\n3. Stock screen')
{
  globalThis.window = { api: {} }
  let Page = null
  try {
    const built = await esbuild.build({
      entryPoints: [path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'Stock', 'StockPage.jsx')], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
      loader: { '.js': 'jsx', '.jsx': 'jsx' }, jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')],
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
      plugins: [{ name: 'one-react', setup(b) { b.onResolve({ filter: /^react(\/jsx-runtime|\/jsx-dev-runtime)?$/ }, (a) => { const p = require.resolve(a.path, { paths: [root] }); return { path: a.kind === 'require-call' ? p : pathToFileURL(p).href, external: true } }) } }],
    })
    const tmp = path.join(os.tmpdir(), `fsg-selftest-heads-screen-${process.pid}.mjs`)
    fs.writeFileSync(tmp, built.outputFiles[0].text)
    try { Page = await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
  } catch (e) { Page = null }
  ok('the Stock screen exposes its table and head box', !!(Page && Page.StockTable && Page.HeadPicker), 'StockTable / HeadPicker not exported by this source')
  if (Page && Page.StockTable) {
    const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ')
    const base = { opening: {}, closing: {}, pyOpening: {}, pyClosing: {}, heads: {}, pyHeads: {}, headChoices: { inTB: [{ name: 'Rent', total: 1 }], standard: [HEAD] }, businessType: 'Manufacturer', pyLoading: false, onValue() {}, onHead() {}, footer: null }
    const render = (p) => renderToString(React.createElement(Page.StockTable, { ...base, ...p })).replace(/<!-- -->/g, '')
    const rowHtml = (h, label) => (h.split('</tr>').find(r => new RegExp(`<td[^>]*>${label.replace(/[&]/g, '(?:&amp;|&)')}</td>`).test(r)) || '')
    const empty = render({})
    ok('the table has the "Adjusted in (P&L)" column', /Adjusted in \(P&amp;L\)/.test(empty))
    ok('Manufacturer: Raw Materials -> Cost of materials consumed (with the fallback said); the other four fixed rows -> Changes in inventories',
      /Cost of materials consumed/.test(text(rowHtml(empty, 'Raw Materials'))) && /no such line/.test(text(rowHtml(empty, 'Raw Materials'))) &&
      ['Work in Progress', 'Finished Goods', 'Stock-in-Trade', 'Uncategorised Stock'].every(t => /Changes in inventories/.test(text(rowHtml(empty, t)))), text(rowHtml(empty, 'Raw Materials')))
    ok('Trader: Raw Materials -> Changes in inventories, no fallback hint', /Changes in inventories/.test(text(rowHtml(render({ businessType: 'Trader' }), 'Raw Materials'))) && !/no such line/.test(text(rowHtml(render({ businessType: 'Trader' }), 'Raw Materials'))))
    ok('the three categories have a head box, the five others do not', ['Stores & Spares', 'Loose Tools', 'Others'].every(t => /data-head-picker/.test(rowHtml(empty, t))) && ['Raw Materials', 'Work in Progress', 'Finished Goods', 'Stock-in-Trade', 'Uncategorised Stock'].every(t => !/data-head-picker/.test(rowHtml(empty, t))))
    ok('no amount: the head box is quiet (not red)', !/border-red-400/.test(empty) && !/Needed:/.test(empty))
    const withAmount = render({ opening: { 'Stores & Spares': '50000' }, pyClosing: { Others: '9' } })
    ok('an amount (Current or Previous Year) and no head: that row\'s box is red and says what is needed; Loose Tools, with none, stays quiet',
      /border-red-400/.test(rowHtml(withAmount, 'Stores & Spares')) && /Needed: the Other expenses line/.test(text(rowHtml(withAmount, 'Stores & Spares'))) && /border-red-400/.test(rowHtml(withAmount, 'Others')) && !/border-red-400/.test(rowHtml(withAmount, 'Loose Tools')))
    const named = render({ opening: { 'Stores & Spares': '50000' }, heads: { 'Stores & Spares': HEAD } })
    ok('with a head named: it is shown, and the box is not red', new RegExp(`value="${HEAD}"`).test(rowHtml(named, 'Stores & Spares')) && !/border-red-400/.test(rowHtml(named, 'Stores & Spares')))
    const lastYear = render({ opening: { 'Loose Tools': '5' }, pyHeads: { 'Loose Tools': 'Tools consumed' } })
    ok('last year\'s head is offered with one click while the row still needs one', /Use last year's: Tools consumed/.test(text(rowHtml(lastYear, 'Loose Tools'))))
  }
}

// ═════ 4. the real handlers on a throw-away PostgreSQL ═════
console.log('\n4. The database (the real handlers, on a throw-away PostgreSQL)')
const preloadText = fs.readFileSync(path.join(srcRoot, 'src', 'preload', 'index.js'), 'utf8')
ok('the Stock screen can ask for the heads (preload getOtherExpenseHeads -> tb:getOtherExpenseHeads)', /getOtherExpenseHeads:\s*\(tbId\)\s*=>\s*(?:ipcRenderer\.invoke|inv)\('tb:getOtherExpenseHeads'/.test(preloadText))

const pgRoot = 'C:\\Program Files\\PostgreSQL'
const ver = fs.existsSync(pgRoot) ? fs.readdirSync(pgRoot).filter(d => fs.existsSync(path.join(pgRoot, d, 'bin', 'initdb.exe'))).sort((a, b) => parseFloat(b) - parseFloat(a))[0] : null
if (!ver) { ok('PostgreSQL binaries found (C:\\Program Files\\PostgreSQL\\<ver>\\bin)', false); fs.rmSync(xlsxShim, { force: true }); finish(); process.exit(1) }
const pgBin = (x) => path.join(pgRoot, ver, 'bin', x)
const port = await new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) }) })
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-selftest-pg-heads-'))
const pg = (exe, args, quiet = false) => spawnSync(pgBin(exe), args, quiet ? { stdio: 'ignore', timeout: 60000 } : { encoding: 'utf8', timeout: 120000 })
let started = false
const cleanup = () => {
  if (started) pg('pg_ctl.exe', ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], true)
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.rmSync(xlsxShim, { force: true })
}
try {
  // -N: no fsync of the throw-away cluster (an initdb that stalls on the disk's sync once aborted a release; a test database needs no durability)
  let r = pg('initdb.exe', ['-D', dataDir, '-U', 'selftest', '-A', 'trust', '-E', 'UTF8', '-N'])
  if (r.status !== 0) throw new Error('initdb failed: ' + (r.stderr || r.stdout))
  r = pg('pg_ctl.exe', ['-D', dataDir, '-o', `-p ${port}`, '-l', path.join(dataDir, 'log.txt'), '-w', 'start'], true)
  if (r.status !== 0) throw new Error('pg_ctl start failed (status ' + r.status + ')')
  started = true
  process.chdir(srcRoot)
  const imp = (rel) => import(pathToFileURL(path.join(srcRoot, 'src', 'main', ...rel.split('/'))).href)
  const { initDB, query } = await imp('db/client.js')
  const { ensureSchema } = await imp('db/schema.js')
  const { seedDefaultMapping, ensureStockCategories } = await imp('services/excel.js')
  const mig = await imp('db/mapping-v3-migration.js')
  const { applyMappingPatches } = await imp('ipc/mapping.js')
  const { registerTBHandlers } = await imp('ipc/tb.js')
  const { registerMappedTBHandlers } = await imp('ipc/mapped-tb.js')
  const { registerFinancialHandlers } = await imp('ipc/financials.js')
  await initDB({ host: 'localhost', port, database: 'postgres', user: 'selftest', password: '' })
  await ensureSchema(); await seedDefaultMapping(); await ensureStockCategories()
  await mig.migrateMappingV3Captions(); await mig.migrateMappingV3CaptionsPass2(); await applyMappingPatches()
  registerTBHandlers(); registerMappedTBHandlers(); registerFinancialHandlers()
  const ipc = (name, ...args) => globalThis.__ipc[name](null, ...args)
  const one = async (sql, p) => (await query(sql, p)).rows[0]
  const count = async (sql, p) => Number((await one(sql, p)).c)

  // A Company (Manufacturer) with this year's and last year's Trial Balance, imported the way a Real Books upload is.
  const rs = (await one(`SELECT id FROM mapping_rule_sets WHERE is_default LIMIT 1`)).id
  const ent = (await one(`INSERT INTO entities (name, constitution, constitution_display, business_type) VALUES ('Stock Heads Co', 3, 'Company', 'Manufacturer') RETURNING id`)).id
  const period = async (label, from, till) => {
    const fp = (await one(`INSERT INTO financial_periods (year_label, date_from, date_till) VALUES ($1,$2,$3) RETURNING id`, [label, from, till])).id
    return (await one(`INSERT INTO entity_periods (entity_id, financial_period_id) VALUES ($1,$2) RETURNING id`, [ent, fp])).id
  }
  const epCY = await period('2025-26', '2025-04-01', '2026-03-31')
  const epPY = await period('2024-25', '2024-04-01', '2025-03-31')
  const led = (name, parent, group, closing, deemed, opening = 0) => ({
    period: '', branch: 'B', ledger_code: '', name, opening_balance: opening, debit: 0, credit: 0, closing_balance: closing, is_revenue: null, is_deemed_positive: deemed, trail_balance: 0,
    parent, group_parent: group, group_parent_1: '', group_parent_2: '', group_parent_3: '', group_parent_4: '', group_parent_5: '', group_parent_6: '', group_parent_7: group,
  })
  // The bank balances the books once the stock rows (Opening Dr, Closing Dr and Cr) the Stock tab adds are counted; opening balances net to nil, so
  // the Stock tab adds no reconciling Opening Stock row of its own.
  const books = ({ sales, purchases, rent, stores, stockOpen }) => {
    const capital = 400000
    const bank = capital + sales - purchases - rent - stores - stockOpen
    return [
      led('Sales', 'Sales Accounts', 'Sales Accounts', sales, false),
      led('Purchases', 'Purchase Accounts', 'Purchase Accounts', -purchases, true),
      led('Rent', 'Indirect Expenses', 'Indirect Expenses', -rent, true),
      led('Stores consumed', 'Indirect Expenses', 'Indirect Expenses', -stores, true),
      led('Capital', 'Capital Account', 'Capital Account', capital, false, capital),
      led('Bank', 'Bank Accounts', 'Current Assets', -bank, true, -capital),
    ]
  }
  const upCY = await ipc('tb:uploadRealBooks', { entityId: ent, period: '2025-26', fileName: 'cy.xlsx', tbRows: books({ sales: 1000000, purchases: 600000, rent: 100000, stores: 200000, stockOpen: 80000 }), branchName: 'B', entityPeriodId: epCY })
  const upPY = await ipc('tb:uploadRealBooks', { entityId: ent, period: '2024-25', fileName: 'py.xlsx', tbRows: books({ sales: 800000, purchases: 500000, rent: 90000, stores: 150000, stockOpen: 40000 }), branchName: 'B', entityPeriodId: epPY })
  const cy = upCY.tb.id, py = upPY.tb.id
  // "Rent" and "Stores consumed" are put under their Other-expenses captions as a CA's Recategorisation would (so the test does not depend on the
  // mapping engine's name matching); everything else is left as the engine maps it.
  const recaption = async (tbId, ledger, l1, l2) => {
    const lf = await one(`SELECT id, alie FROM level_format WHERE rule_set_id = $1 AND constitution = 3 AND level1 = $2 AND level2 = $3 AND (level3 IS NULL OR level3 = '') LIMIT 1`, [rs, l1, l2])
    await query(`UPDATE mapped_tb SET mapping1_resultant = $2, mapping2_resultant = $3, mapping3_resultant = NULL, alie = $4, level_format_id = $5, status = 'user_override'
                 WHERE tb_row_id = (SELECT id FROM tb_rows WHERE tb_id = $1 AND name = $6)`, [tbId, l1, l2, lf ? lf.alie : 'Expenses', lf ? lf.id : null, ledger])
    return !!lf
  }
  const mapAll = async () => {
    for (const t of [cy, py]) {
      await ipc('mappedTB:run', t, rs, { excludeZero: true })
      await recaption(t, 'Rent', 'Other expenses', 'Rent')
      await recaption(t, 'Stores consumed', 'Other expenses', HEAD)
    }
  }
  await mapAll()
  ok('the Level Format has the Other-expenses captions the test puts ledgers under', await recaption(cy, 'Rent', 'Other expenses', 'Rent') && await recaption(cy, 'Stores consumed', 'Other expenses', HEAD))

  // ── 4a. an existing database gains the column ──
  const hasCol = async () => (await count(`SELECT count(*) AS c FROM information_schema.columns WHERE table_name = 'tb_rows' AND column_name = 'stock_head'`)) === 1
  ok('a new database has tb_rows.stock_head', await hasCol())
  const rowsBefore = await count(`SELECT count(*) AS c FROM tb_rows`)
  await query(`ALTER TABLE tb_rows DROP COLUMN IF EXISTS stock_head`)
  ok('(a 0.1.92 database has no such column)', !(await hasCol()))
  await ensureSchema()
  ok('the new build adds it on its first start', await hasCol())
  ok('...without touching a row: same rows, every stock_head empty', (await count(`SELECT count(*) AS c FROM tb_rows`)) === rowsBefore && (await hasCol()) && (await count(`SELECT count(*) AS c FROM tb_rows WHERE stock_head IS NOT NULL`)) === 0)
  await ensureSchema()
  ok('...and starting it again changes nothing', await hasCol() && (await count(`SELECT count(*) AS c FROM tb_rows`)) === rowsBefore)

  // ── 4b. saving the stock ──
  const STOCK_CY = { opening: { 'Raw Materials': 20000, 'Stores & Spares': 50000, 'Loose Tools': 10000 }, closing: { 'Raw Materials': 35000, 'Stores & Spares': 80000, 'Loose Tools': 4000 } }
  const STOCK_PY = { opening: { 'Raw Materials': 10000, 'Stores & Spares': 30000 }, closing: { 'Raw Materials': 20000, 'Stores & Spares': 50000 } }
  await ipc('tb:saveStock', { tbId: cy, stockData: { ...STOCK_CY, pyOpening: { 'Loose Tools': 3000 }, pyClosing: { 'Loose Tools': 1000 }, heads: { 'Stores & Spares': HEAD, 'Loose Tools': '  Tools   consumed ', 'Raw Materials': 'not a head category' } } })
  await ipc('tb:saveStock', { tbId: py, stockData: { ...STOCK_PY, heads: { 'Stores & Spares': HEAD } } })
  let stock = await ipc('tb:getStockRows', cy)
  const named = (cat, head) => ['Opening Stock - ', 'Closing Stock - PL - ', 'Closing Stock - BS - '].every(p => { const x = stock.find(s => s.name === p + cat); return x && x.stock_head === head })
  ok('every stock row of Stores & Spares carries its head (Opening, Closing in the P&L, Closing on the Balance Sheet)', named('Stores & Spares', HEAD), JSON.stringify(stock.map(s => [s.name, s.stock_head])))
  ok('...Loose Tools too, the name cleaned of stray spaces', named('Loose Tools', 'Tools consumed'))
  ok('...the typed-in Previous Year rows of the same Trial Balance as well', ['PY Opening Stock - Loose Tools', 'PY Closing Stock - Loose Tools'].every(n => (stock.find(s => s.name === n) || {}).stock_head === 'Tools consumed'))
  ok('...Raw Materials, which does not ask, carries none', stock.filter(s => /Raw Materials/.test(s.name)).length === 3 && stock.filter(s => /Raw Materials/.test(s.name)).every(s => s.stock_head == null))
  ok('...and no ordinary ledger got one', (await count(`SELECT count(*) AS c FROM tb_rows WHERE stock_head IS NOT NULL AND (upload_nature IS NULL OR upload_nature NOT IN ('Stock Entry', 'Stock Entry PY'))`)) === 0)

  // ── 4c. the statements' own queries return it ──
  const cyRows = await ipc('financials:getData', cy)
  const stockOut = cyRows.filter(x => x.upload_nature === 'Stock Entry')
  ok('financials:getData returns the head on the nine stock rows (three each of Raw Materials, Stores & Spares, Loose Tools)', stockOut.length === 9 && stockOut.filter(x => x.stock_head === HEAD).length === 3 && stockOut.filter(x => x.stock_head === 'Tools consumed').length === 3 && stockOut.filter(x => x.stock_head == null).length === 3, `${stockOut.length} rows: ${stockOut.map(x => x.name + '=' + x.stock_head).join('; ')}`)
  const cons = await ipc('financials:getConsolidatedData', ent)
  ok('...the consolidated query too (both years\' Trial Balances: Stores & Spares named in both)', cons.filter(x => x.upload_nature === 'Stock Entry' && x.stock_head === HEAD).length === 6, String(cons.filter(x => x.stock_head).length))
  const branches = await ipc('financials:getBranchTBsData', ent)
  const cyBranch = (branches.find(b => b.tbId === cy) || { rows: [] }).rows
  ok('...and the per-branch query', cyBranch.filter(x => x.upload_nature === 'Stock Entry' && x.stock_head).length === 6, String(cyBranch.length))

  // ── 4d. re-mapping leaves it alone ──
  await mapAll()
  const remapped = await ipc('financials:getData', cy)
  ok('re-running mapping keeps the heads (they are on the stock rows, not on the rows mapping rebuilds)', remapped.filter(x => x.upload_nature === 'Stock Entry').length === 9 && remapped.filter(x => x.upload_nature === 'Stock Entry' && x.stock_head).length === 6)

  // ── 4e. from the database to the Other expenses note ──
  const lfRows = (await query(`SELECT * FROM level_format WHERE rule_set_id = $1 AND constitution = 3 ORDER BY sort_order`, [rs])).rows
  const cyData = await ipc('financials:getData', cy), pyData = await ipc('financials:getData', py)
  const out = processRows(cyData, buildPrevMap(pyData), 3, [], 'Manufacturer', false, false, null, lfRows, null)
  const note = otherNotes(out)[0], sec = otherSec(out)
  ok('every ledger of both Trial Balances is mapped (nothing lost to the statements)', cyData.length === 6 + 9 && pyData.length === 6 + 6, `${cyData.length} / ${pyData.length}`)
  ok('the Balance Sheet tallies, both years\' profit as the books say (1,39,000 and 90,000)', tallies(out) && near(out.netProfit, 139000) && near(out.prevNetProfit, 90000), `BS out ${money(Number(out.totalAssets) - Number(out.totalEL))}, profit ${money(out.netProfit)} / ${money(out.prevNetProfit)}`)
  ok('there is ONE Other expenses note and the P&L face points at it', otherNotes(out).length === 1 && !!sec && out.notes[sec.noteNum] === note, otherNotes(out).map(n => n.num + '=' + money(n.total)).join(', '))
  const l = (rx) => lineOf(note, rx) || {}
  ok('this year: Rent 1,00,000; Consumption of stores and spare parts 2,00,000 + 50,000 - 80,000 = 1,70,000; Tools consumed 10,000 - 4,000 = 6,000; total 2,76,000',
    near(l(/^rent$/i).total, 100000) && near(l(/consumption of stores/i).total, 170000) && near(l(/^tools consumed$/i).total, 6000) && near(note.total, 276000) && near(sec.total, 276000), (note.lines || []).map(x => `${x.level2}=${money(x.total)}`).join('; '))
  ok('last year: Rent 90,000; Consumption 1,50,000 + 30,000 - 50,000 = 1,30,000; total 2,20,000, the same on the face', near(l(/^rent$/i).prevTotal, 90000) && near(l(/consumption of stores/i).prevTotal, 130000) && near(note.prevTotal, 220000) && near(sec.prevTotal, 220000), (note.lines || []).map(x => `${x.level2}=${money(x.prevTotal)}`).join('; '))
  const cm = materialsSec(out)
  ok('Raw Materials stay in Cost of materials consumed here (6,00,000 + 20,000 - 35,000 = 5,85,000; last year 4,90,000)', cm && near(cm.total, 585000) && near(cm.prevTotal, 490000), `${money(cm && cm.total)} / ${money(cm && cm.prevTotal)}`)
  ok('no separate stock lines are left in the note', !(note.lines || []).some(x => /opening value of|closing value of|change in stores/i.test(x.level2 || '')))

  // ── 4f. the pick-list ──
  const choices = await ipc('tb:getOtherExpenseHeads', cy)
  const inTB = Object.fromEntries((choices.inTB || []).map(x => [x.name, x.total]))
  ok('the lines this Trial Balance already has under Other expenses are offered, with the expense each carries', near(inTB['Rent'], 100000) && near(inTB[HEAD], 200000), JSON.stringify(choices.inTB))
  ok('...and the standard Other-expenses captions of its mapping, none of them "Uncategorised"', (choices.standard || []).includes(HEAD) && (choices.standard || []).includes('Power and fuel') && (choices.standard || []).length > 10 && !(choices.standard || []).some(x => /uncategori/i.test(x)), JSON.stringify((choices.standard || []).slice(0, 5)))
  const none = await ipc('tb:getOtherExpenseHeads', 999999)
  ok('a Trial Balance that does not exist, none selected, or the Consolidated view (not a number) offers nothing - and no database error', Array.isArray(none.inTB) && none.inTB.length === 0 && none.standard.length === 0 && (await ipc('tb:getOtherExpenseHeads', null)).standard.length === 0 && (await ipc('tb:getOtherExpenseHeads', '__consolidated__')).standard.length === 0)

  // ── 4g. later saves ──
  const keeps = (rows) => rows.filter(x => x.stock_head === HEAD).length === 3 && rows.filter(x => x.stock_head === 'Tools consumed').length >= 3
  await ipc('tb:saveStock', { tbId: cy, stockData: { ...STOCK_CY } })
  ok('a save that names no heads (the Fill Details upload) leaves the Trial Balance\'s heads as they are', keeps(await ipc('tb:getStockRows', cy)))
  await ipc('tb:saveStock', { tbId: cy, stockData: { ...STOCK_CY, heads: {} } })
  ok('...so does one that sends an empty list', keeps(await ipc('tb:getStockRows', cy)))
  await ipc('tb:saveStock', { tbId: cy, stockData: { ...STOCK_CY, heads: { 'Loose Tools': 'Repairs and maintenance - others' } } })
  stock = await ipc('tb:getStockRows', cy)
  ok('naming a head again replaces the old one and only that one', ['Opening Stock - ', 'Closing Stock - PL - ', 'Closing Stock - BS - '].every(p => (stock.find(s => s.name === p + 'Loose Tools') || {}).stock_head === 'Repairs and maintenance - others') && named('Stores & Spares', HEAD))
  await ipc('tb:saveStock', { tbId: cy, stockData: { opening: { 'Raw Materials': 1 }, closing: {}, heads: { 'Stores & Spares': 'No stock for it' } } })
  stock = await ipc('tb:getStockRows', cy)
  ok('stock taken off the form takes its head with it; a head with no stock is kept nowhere', stock.length > 0 && stock.every(s => s.stock_head == null) && (await count(`SELECT count(*) AS c FROM tb_rows WHERE tb_id = $1 AND stock_head IS NOT NULL`, [cy])) === 0)
} catch (e) {
  ok('the database checks ran', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e))
} finally {
  process.chdir(root)
  cleanup()
}
finish()
process.exit(fails ? 1 : 0)
