/**
 * Pre-release self-test (0.1.128): (1) a Busy Accounting Software Trial Balance is read correctly - its indentation quirks and
 * its group totals - and mapped by the real engine; (2) the Inventories note always carries Closing Stock (BS) with Raw
 * Materials, Work-in-Progress, Finished Goods, Stock-in-Trade and Stores and Spares under it.
 * Borrows the throw-away PostgreSQL harness of selftest-queue-membership (never the user's database).
 *   node tools/selftest-busy-inventories.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire, register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = process.env.FSG_SRC_ROOT ? path.resolve(process.env.FSG_SRC_ROOT) : root
const require = createRequire(path.join(root, 'package.json'))
const esbuild = require('esbuild')
const { Client } = require('pg')

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + String(detail).slice(0, 320)}`)
}

console.log(`\nDefault Recategorisation list: only ledgers that still need something${srcRoot !== root ? `  (source: ${srcRoot})` : ''}`)

// ── a PostgreSQL to borrow ───────────────────────────────────────────────────
function findPgBin() {
  const cands = []
  if (process.env.FSG_PGBIN) cands.push(process.env.FSG_PGBIN)
  for (const base of ['C:/Program Files/PostgreSQL', 'C:/Program Files (x86)/PostgreSQL']) {
    try { for (const v of fs.readdirSync(base).sort((a, b) => Number(b) - Number(a))) cands.push(path.join(base, v, 'bin')) } catch { /* none */ }
  }
  return cands.find(d => fs.existsSync(path.join(d, 'initdb.exe')) || fs.existsSync(path.join(d, 'initdb')))
}
const PGBIN = findPgBin()
if (!PGBIN) {
  console.log('  SKIPPED  no local PostgreSQL binaries (initdb / pg_ctl) found - this check could not run.')
  process.exit(0)
}
const exe = (n) => path.join(PGBIN, fs.existsSync(path.join(PGBIN, n + '.exe')) ? n + '.exe' : n)
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }); s.on('error', rej) })

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsgq-'))
const port = await freePort()
let started = false
const stopPg = () => {
  if (started) { try { execFileSync(exe('pg_ctl'), ['stop', '-D', dataDir, '-m', 'immediate'], { stdio: 'ignore', windowsHide: true }) } catch { /* already down */ } }
  for (let i = 0; i < 5; i++) { try { fs.rmSync(dataDir, { recursive: true, force: true }); break } catch { /* files still held */ } }
}
process.on('exit', stopPg)

try {
  execFileSync(exe('initdb'), ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'], { stdio: 'ignore', windowsHide: true })
  execFileSync(exe('pg_ctl'), ['start', '-D', dataDir, '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off -c full_page_writes=off`, '-l', path.join(dataDir, 'server.log'), '-w', '-t', '90'], { stdio: 'ignore', windowsHide: true })
  started = true
  const admin = new Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' })
  await admin.connect(); await admin.query('CREATE DATABASE scratch'); await admin.end()
} catch (e) { ok('a throw-away PostgreSQL starts', false, e.message); process.exit(1) }

// ── the app's own main-process modules, with electron and xlsx stood in for ──────
const STUB = `
export const app = { getPath: () => process.cwd(), getAppPath: () => process.cwd(), isPackaged: false }
export const safeStorage = { isEncryptionAvailable: () => false, decryptString: (b) => Buffer.from(b).toString('utf8'), encryptString: (s) => Buffer.from(s, 'utf8') }
globalThis.__ipc = globalThis.__ipc || {}
export const ipcMain = { handle: (n, f) => { globalThis.__ipc[n] = f }, on: () => {} }
export const dialog = {}
export class BrowserWindow {}
export default { app, safeStorage, ipcMain, dialog, BrowserWindow }
`
const XLSX_SHIM = `
import { createRequire } from 'node:module'
const X = createRequire(${JSON.stringify(path.join(root, 'package.json'))})('xlsx')
export const readFile = X.readFile, utils = X.utils, read = X.read, write = X.write, writeFile = X.writeFile
export default X
`
const HOOKS = `
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const rootRequire = createRequire(${JSON.stringify(path.join(root, 'package.json'))})
const STUB = 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(STUB)})
const XLSX = 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(XLSX_SHIM)})
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') return { url: STUB, shortCircuit: true }
  if (spec === 'xlsx') return { url: XLSX, shortCircuit: true }
  try { return await next(spec, ctx) } catch (e) {
    if (!/^[.\\/]|^[a-z]:|^file:|^node:|^data:/i.test(spec)) { try { return { url: pathToFileURL(rootRequire.resolve(spec)).href, shortCircuit: true } } catch { /* fall through */ } }
    throw e
  }
}
`
register('data:text/javascript,' + encodeURIComponent(HOOKS))
process.chdir(root)                                   // Mapping_v2.xlsx is looked up here
const imp = (rel) => import(pathToFileURL(path.join(srcRoot, ...rel.split('/'))).href)

const { initDB, query, withStartupLock } = await imp('src/main/db/client.js')
await initDB({ host: '127.0.0.1', port, database: 'scratch', user: 'postgres', password: '' })
{ const { rows: [s] } = await query('SELECT inet_server_port() AS p, current_database() AS d'); if (Number(s.p) !== port || s.d !== 'scratch') { console.error('REFUSING: not the throw-away database', s); process.exit(2) } }
const { ensureSchema } = await imp('src/main/db/schema.js')
const { seedDefaultMapping, ensureStockCategories } = await imp('src/main/services/excel.js')
const { migrateMappingV3Captions, migrateMappingV3CaptionsPass2 } = await imp('src/main/db/mapping-v3-migration.js')
const { registerTBHandlers } = await imp('src/main/ipc/tb.js')
const { registerMappingHandlers, applyMappingPatches } = await imp('src/main/ipc/mapping.js')
const { registerMappedTBHandlers } = await imp('src/main/ipc/mapped-tb.js')
const { registerMastersHandlers } = await imp('src/main/ipc/masters.js')
registerTBHandlers(); registerMappingHandlers(); registerMappedTBHandlers(); registerMastersHandlers()
const ipc = (name, ...args) => globalThis.__ipc[name](null, ...args)
const launch = () => withStartupLock(async () => {
  await ensureSchema(); await seedDefaultMapping(); await ensureStockCategories()
  await migrateMappingV3Captions(); await migrateMappingV3CaptionsPass2(); await applyMappingPatches()
})



// ── the two pure modules, bundled ────────────────────────────────────────────
const bundle = async (rel) => {
  const b = await esbuild.build({ entryPoints: [path.join(srcRoot, ...rel.split('/'))], bundle: true, write: false, format: 'esm', platform: 'node', external: ['xlsx'], logLevel: 'silent' })
  const f = path.join(os.tmpdir(), `fsgb-${process.pid}-${path.basename(rel)}.mjs`)
  fs.writeFileSync(f, b.outputFiles[0].text)
  try { return await import(pathToFileURL(f).href) } finally { fs.rmSync(f, { force: true }) }
}
const { parseBusyTB, buildTBRowsFromBusy } = await bundle('src/renderer/src/utils/busyParsers.js')
const inv = await bundle('src/renderer/src/utils/inventoriesNote.js')
const X = createRequire(path.join(root, 'package.json'))('xlsx')

// ── a Busy Trial Balance with Busy's own quirks ──────────────────────────────
// sub-groups are all printed at indent 4; a ledger at 4 + 2 x (depth of its group); a nil group can sit between a group and
// its ledgers; a sub-group of a sub-group looks like its parent
const L = (n, o, d = 0, c = 0) => ({ n, o, d, c })
const G = (n, kids) => ({ n, kids })
const tree = [
  G('Capital Account', [G('Reserves & Surplus', [L('General Reserve', -2712000)]), L('SHARE CAPITAL', -1000000)]),
  G('Current Assets', [
    G('Bank Accounts', [L('HDFC 5020', 400000)]),
    G('Cash-in-hand', [L('Cash', 20000)]),
    G('STAFF ADVANCE', [G('ADVANCE TO STAFF', [L('RAJU STAFF ADV', 5000)]), L('SITA STAFF ADV', 7000)]),
    G('Stock-in-hand', [L('Stock', 3000000)]),
    G('Sundry Debtors', [G('CUSTOMER', [G('EMPTY SUBGROUP', []), L('KAPPA CUSTOMER', 300000, 680000), L('LAMBDA CUSTOMER', 120000)])]),
    L('ADVANCE INCOME TAX', 100000),
  ]),
  G('Current Liabilities', [
    G('Duties & Taxes', [L('GST Payable', -40000)]),
    G('Sundry Creditors', [G('MUMBAI CREDITORS', [L('ALPHA TRADERS', -250000)]), L('BETA SUPPLIERS', -150000)]),
  ]),
  G('Fixed Assets', [G('PLANT & MACHINERY', [L('SEWING MACHINE', 700000)])]),
  G('Loans (Liability)', [G('Unsecured Loans', [L('FRIEND LOAN', -500000)])]),
  G('Revenue Accounts', [
    G('Expenses (Indirect/Admn.)', [L('RENT A/C', 0, 120000, 0)]),
    G('Purchase', [L('Purchase', 0, 1200000, 0)]),
    G('Sale', [L('Sales', 0, 0, 2000000)]),
  ]),
]
const sums = (n) => n.kids ? n.kids.map(sums).reduce((a, s) => [a[0] + s[0], a[1] + s[1], a[2] + s[2]], [0, 0, 0]) : [n.o, n.d, n.c]
const money = (v) => (Math.abs(v) < 0.005 ? '' : `${Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2 })} ${v >= 0 ? 'Dr' : 'Cr'}`)
const emitRows = (nodes) => {
  const out = []
  const pad = (n, s) => ' '.repeat(n) + s
  const line = (indent, n, o, d, c) => out.push([pad(indent, n), money(o) ? pad(4, money(o)) : null, d, c, money(o + d - c) ? pad(4, money(o + d - c)) : null])
  const walk = (node, depth, primary) => {
    const [o, d, c] = sums(node)
    line(primary ? 0 : 4, node.n, o, d, c)
    for (const k of node.kids.filter(k => k.kids)) walk(k, depth + 1, false)
    for (const k of node.kids.filter(k => !k.kids)) line(4 + 2 * depth, k.n, k.o, k.d, k.c)
  }
  nodes.forEach(n => walk(n, 0, true))
  return out
}
const wbOf = (patch) => {
  const aoa = [['Test Traders Pvt Ltd'], ['Siliguri'], [''], ['Trial Balance'], [null, null, 'From 1-4-2026 to 31-3-2027'], ['Account/Group Name', 'Opening Bal.', 'Debit', 'Credit', 'Closing Bal.'], ...emitRows(tree)]
  const all = tree.map(sums).reduce((a, s) => [a[0] + s[1], a[1] + s[2]], [0, 0])
  aoa.push(['Total', '0.00 Cr', all[0], all[1], '0.00 Cr'])
  if (patch) patch(aoa)
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), 'Sheet1')
  return X.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

console.log('\nBusy Trial Balance parser')
const parsed = parseBusyTB(wbOf())
const byName = new Map(parsed.rows.map(r => [r.name, r]))
ok('the entity and the period are read', parsed.entityName === 'Test Traders Pvt Ltd' && parsed.from === '2026-04-01' && parsed.to === '2027-03-31', `${parsed.entityName} ${parsed.from} ${parsed.to}`)
ok('every ledger with figures is read once - groups are not counted as ledgers (18 ledgers)', parsed.rows.length === 18 && !['CUSTOMER', 'STAFF ADVANCE', 'ADVANCE TO STAFF', 'Sundry Debtors', 'Current Assets'].some(n => byName.has(n)), parsed.rows.map(r => r.name).join(', '))
ok('it balances and no warning is raised', Math.abs(parsed.stats.sumClosing) < 0.01 && parsed.warnings.length === 0, JSON.stringify(parsed.warnings))
ok('a sub-group printed at its parent\'s indent is still a group (customers under CUSTOMER under Sundry Debtors)', byName.get('KAPPA CUSTOMER')?.groupTally === 'Sundry Debtors' && byName.get('KAPPA CUSTOMER')?.parents.join('>') === 'Current Assets>Sundry Debtors>CUSTOMER', byName.get('KAPPA CUSTOMER')?.parents.join('>'))
ok('a nil group between a group and its ledgers owns nothing', !byName.get('KAPPA CUSTOMER').parents.includes('EMPTY SUBGROUP'))
ok('a ledger of a group-in-a-group (RAJU under ADVANCE TO STAFF under STAFF ADVANCE) and the group\'s own ledger are both found', byName.get('RAJU STAFF ADV')?.parents.join('>') === 'Current Assets>STAFF ADVANCE>ADVANCE TO STAFF' && byName.get('SITA STAFF ADV')?.parents.join('>') === 'Current Assets>STAFF ADVANCE', `${byName.get('RAJU STAFF ADV')?.parents.join('>')} | ${byName.get('SITA STAFF ADV')?.parents.join('>')}`)
ok('a ledger directly in a primary group (ADVANCE INCOME TAX) belongs to it', byName.get('ADVANCE INCOME TAX')?.parents.join('>') === 'Current Assets')
ok('Busy\'s groups become the group names the mapping knows', byName.get('GST Payable')?.groupTally === 'Duties & Taxes' && byName.get('Stock')?.groupTally === 'Stock-in-Hand' && byName.get('HDFC 5020')?.groupTally === 'Bank Accounts' && byName.get('Cash')?.groupTally === 'Cash-in-Hand' && byName.get('FRIEND LOAN')?.groupTally === 'Unsecured Loans' && byName.get('Sales')?.groupTally === 'Sales Accounts' && byName.get('Purchase')?.groupTally === 'Purchase Accounts' && byName.get('RENT A/C')?.groupTally === 'Indirect Expenses')
ok('the side of a ledger comes from its primary group (Revenue Accounts split by Sale / Purchase)', byName.get('GST Payable')?.sectionType === 'Liabilities' && byName.get('Sales')?.sectionType === 'Income' && byName.get('Purchase')?.sectionType === 'Expenses' && byName.get('SEWING MACHINE')?.sectionType === 'Assets')
const flipped = buildTBRowsFromBusy(parsed, { constitution: 3 })
const fr = (n) => flipped.find(r => r.name === n)
ok('signs are flipped to the app\'s (Dr negative, Cr positive)', fr('Cash').closing_balance === -20000 && fr('Sales').closing_balance === 2000000 && fr('Sales').credit === 2000000 && fr('RENT A/C').debit === 120000)
ok('a Company\'s Capital Account becomes "Capital", other constitutions keep "Capital Account"', buildTBRowsFromBusy(parsed, { constitution: 3 }).find(r => r.name === 'SHARE CAPITAL').parent === 'Capital' && buildTBRowsFromBusy(parsed, { constitution: 1 }).find(r => r.name === 'SHARE CAPITAL').parent === 'Capital Account')
{
  let threw = false
  try {
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['hello']]), 'S')
    parseBusyTB(X.write(wb, { type: 'buffer', bookType: 'xlsx' }))
  } catch { threw = true }
  ok('a file that is not a Busy Trial Balance is refused', threw)
}
{
  const p2 = parseBusyTB(wbOf(aoa => { const r = aoa.find(x => String(x[0]).trim() === 'SITA STAFF ADV'); r[4] = '    9,000.00 Dr' }))
  ok('a figure that does not agree with its group is reported, never absorbed silently', p2.warnings.length > 0, 'no warning raised')
}

console.log('\nInventories note: the five categories under Closing Stock (BS)')
{
  const row = (name, l5, extra = {}) => ({ name, level5_value: l5, mapping3_resultant: 'Closing Stock (BS)', ...extra })
  const mk = (cy, py) => inv.buildInventoriesRows(cy.map(([r, a]) => ({ row: r, amt: a })), py.map(([r, a]) => ({ row: r, amt: a })), () => [])
  let rows = mk([[row('Closing Stock - BS - Raw Materials', 'Raw Materials'), 100], [row('Closing Stock - BS - Finished Goods', 'Finished Goods'), 250]],
                [[row('Closing Stock - BS - Raw Materials', 'Raw Materials'), 80]])
  ok('the head is "Closing Stock (BS)" and carries the total', rows[0].type === 'l3' && rows[0].label === 'Closing Stock (BS)' && rows[0].cy === 350 && rows[0].py === 80)
  ok('Raw Materials, Work-in-Progress, Finished Goods, Stock-in-Trade and Stores and Spares are ALWAYS there, in that order, even at nil', rows.slice(1, 6).map(r => r.label).join('|') === 'Raw Materials|Work-in-Progress|Finished Goods|Stock-in-Trade|Stores and Spares' && rows.slice(1, 6).every(r => r.keepZero), rows.map(r => r.label).join('|'))
  ok('each carries its own Current and Previous Year figure', rows[1].cy === 100 && rows[1].py === 80 && rows[3].cy === 250 && rows[3].py === 0 && rows[2].cy === 0)
  ok('the lines add up to the head (Current and Previous Year)', rows.slice(1).reduce((s, r) => s + r.cy, 0) === rows[0].cy && rows.slice(1).reduce((s, r) => s + r.py, 0) === rows[0].py)
  ok('Loose Tools / Others only appear when they carry a figure', !rows.some(r => /loose|others/i.test(r.label)))
  rows = mk([[row('Closing Stock - BS - Stores & Spares', 'Stores & Spares'), 40], [row('Closing Stock - BS - Loose Tools', 'Loose Tools'), 5], [row('Stock', null, { upload_nature: 'x' }), 900]], [])
  ok('the Stock tab\'s "Stores & Spares" is the "Stores and Spares" line (same words in any spelling)', rows.find(r => r.label === 'Stores and Spares').cy === 40)
  ok('a stock ledger with no category is shown as Unclassified - never dropped - so the total still ties', rows.find(r => r.unclassified)?.cy === 900 && rows[0].cy === 945 && rows.slice(1).reduce((s, r) => s + r.cy, 0) === 945)
  ok('Level 5 lists and Level 3 lines of the Level Format (Company / Partnership spellings) are understood', ['Raw materials', 'Work-in-Progress', 'Work-in-progress', 'Finished goods', 'Stock-in-trade', 'Stock-in-Trade', 'Stores and spares', 'Stores and Spares', 'Loose Tools', 'Others'].every(s => inv.inventoryCategoryId(s)))
  ok('a ledger placed on the Level 3 line "Raw materials" counts as Raw Materials', inv.categoryOfRow({ name: 'Yarn', mapping3_resultant: 'Raw materials' }) === 'rm')
}

console.log('\nWired in')
{
  const fin = fs.readFileSync(path.join(srcRoot, 'src/renderer/src/hooks/useFinancials.js'), 'utf8')
  ok('the Inventories note is built by buildInventoriesRows, for every constitution', fin.includes("import { buildInventoriesRows } from '../utils/inventoriesNote'") && fin.includes('return buildInventoriesRows('))
  ok('a nil mandatory line survives the zero filter (keepZero)', fin.includes('if (r.keepZero) return true'))
  const html = fs.readFileSync(path.join(srcRoot, 'src/renderer/src/components/GenerateFinancials/buildHTML.js'), 'utf8')
  ok('the PDF sentence on current maturities uses the Previous Year maturities, not the Current Year figure', html.includes('totCmPY += g.cmPY') && html.includes('${fmtN(totCmPY)} (${pyLabel})') && !html.includes('totNetPY ? totCmCY : 0'))
  const up = fs.readFileSync(path.join(srcRoot, 'src/renderer/src/components/TrialBalance/UploadTB.jsx'), 'utf8')
  ok('Upload TB offers the Busy format and uploads it through its own IPC', up.includes("onChoose('busy')") && up.includes("api: 'uploadBusyTB'") && fs.readFileSync(path.join(srcRoot, 'src/main/ipc/tb.js'), 'utf8').includes("'tb:uploadBusy'") && fs.readFileSync(path.join(srcRoot, 'src/preload/index.js'), 'utf8').includes('uploadBusyTB'))
}

console.log('\nDep (Comp) net block, EPS, consolidated General Notes (0.1.130)')
{
  const dn = await bundle('src/renderer/src/utils/depCompNet.js')
  const r = dn.withNet({ category: 'Plant', grossOpen: '1000', additions: '200', grossClose: '1200', depOpen: '300', depClose: '450', netBlockOpen: '999', netBlockClose: '999' })
  ok('Net Block opening / closing = Gross Block less Depreciation, whatever was typed', r.netBlockOpen === '700' && r.netBlockClose === '900', JSON.stringify(r))   // closing figures here are typed, so net closing = 1200 - 450
  ok('Gross Closing = Opening + Additions - Deductions; Depreciation Closing = Opening + For Year - On Disposal', (() => { const q = dn.withNet({ grossOpen: '1000', additions: '200', deductions: '50', depOpen: '300', depForYear: '120', depOnDisposal: '20', grossClose: '1', depClose: '1' }); return q.grossClose === '1150' && q.depClose === '400' && q.netBlockOpen === '700' && q.netBlockClose === '750' })())
  ok('a row with no Gross Block / Depreciation keeps its typed Net Block', dn.withNet({ netBlockOpen: '55', netBlockClose: '60' }).netBlockOpen === '55')
  const dti = fs.readFileSync(path.join(srcRoot, 'src/renderer/src/utils/deferredTaxIO.js'), 'utf8')
  ok('Deferred Tax (Approach 2): book WDV is re-derived from the Dep (Comp) rows and leaves out land / capital work-in-progress', dti.includes('withNet(r0)') && dti.includes('NON_DEPRECIABLE_RX.test') && (() => { const m = /export const NON_DEPRECIABLE_RX = (\/.*\/i)/.exec(dti); if (!m) return false; const rx = eval(m[1]); return rx.test('Freehold Land') && rx.test('Land') && rx.test('Capital Work-in-Progress') && !rx.test('Leasehold Land') && !rx.test('Plant & Machinery — General') && !rx.test('Land and Building') })())
  const gh = fs.readFileSync(path.join(srcRoot, 'src/renderer/src/components/GenerateFinancials/buildHTML.js'), 'utf8')
  const ge = fs.readFileSync(path.join(srcRoot, 'src/renderer/src/components/GenerateFinancials/buildExcel.js'), 'utf8')
  const gi = fs.readFileSync(path.join(srcRoot, 'src/renderer/src/components/GenerateFinancials/index.jsx'), 'utf8')
  ok('branch-wise (columnar) PDF and Excel carry the General Notes (Significant Accounting Policies)', gh.includes('${buildColumnarGeneralNotes()}') && ge.includes("buildGeneralNotesSheet(generalData") && gi.includes('generalNotes: gdata?.generalNotes') && gi.includes('generalData: gdata'))
  ok('every Consolidated export reads the General Notes of the current Financial Year, not of whichever branch TB is selected', !/entity_period_id: singleTBForExport\?\.entity_period_id \?\? activeTB/.test(gi) && gi.includes('consCtx?.entityPeriodId ?? activeTB?.entity_period_id ?? null, consCtx?.consKey'))
  ok('"Carried forward" does not add the MSME disclosure rows to the running total of a note', gh.includes('!r.breakdown && !r.isSubtotal && !r.isMSME') && gh.includes('isMSME: !!(r.isMSME || r.isMSMEHeader)'))
  const pc = await bundle('src/renderer/src/utils/plStructureCorp.js')
  const sec = (level1, total, prevTotal = 0) => ({ level1, total, prevTotal })
  const np = pc.corpFaceNetProfit({
    incomeSections: [sec('Revenue from operations', 1000, 800), sec('Other income', 50, 40), sec('Closing Stock (PL)', 300, 200)],
    expenseSections: [sec('Opening Stock (PL)', 250, 150), sec('Changes in inventories of finished goods, WIP and Stock-in-Trade', -50, -50), sec('Employee benefits expense', 200, 150),
      sec('Other expenses', 100, 90), sec('Tax expense:', 100, 60)],
  })
  ok('EPS profit is the face profit: income (without Closing Stock) less expenses, stock movement and tax - 1050 - (-50+200+100) - 100 = 700', np.cy === 700 && np.py === 840 - (-50 + 150 + 90) - 60, JSON.stringify(np))
  const dc = fs.readFileSync(path.join(srcRoot, 'src/renderer/src/components/DepreciationComp/index.jsx'), 'utf8')
  ok('Dep (Comp): totals and the saved schedule use the formula; the Previous Year row is kept without pressing Save', dc.includes('categoryRows.map(withNet).reduce') && dc.includes('pyTotals: withNet(pyTotals)') && dc.includes('flushUnsaved') && dc.includes('setTimeout(flushUnsaved, 1200)'))
  const fin = fs.readFileSync(path.join(srcRoot, 'src/renderer/src/hooks/useFinancials.js'), 'utf8')
  ok('Previous Year profit is re-derived from the sections once Manual PY is applied (EPS, ratios, Exception Report)', fin.includes('processed.prevNetProfit = sumPrev(processed.incomeSections) - sumPrev(processed.expenseSections)'))
  ok('the Consolidated statements carry the General Notes and the Cash Flow figures (both consolidated paths)', (fin.match(/generalNotesModeC/g) || []).length >= 4 && (fin.match(/processed\.cfsSaved = cfsSavedC/g) || []).length === 2)
}

// ── the real engine on a throw-away database ─────────────────────────────────
console.log('\nMapping of a Busy Trial Balance by the real engine')
const EXPLORE = !!process.env.FSG_BUSY_EXPLORE
const NAME = { 1: 'Proprietorship', 2: 'Partnership', 3: 'Company' }
const EXPECT = {
  'KAPPA CUSTOMER':  /trade receivables/i,
  'ALPHA TRADERS':   /trade payables/i,
  'BETA SUPPLIERS':  /trade payables/i,
  'Stock':           /inventories/i,
  'HDFC 5020':       /cash and bank/i,
  'Cash':            /cash and bank/i,
  'SEWING MACHINE':  /property, plant|fixed|tangible/i,
  'FRIEND LOAN':     /non-current liabilities|borrowings/i,     // the engine's standard result for a loan ledger: Mapping 2 is the CA's to choose
  'GST Payable':     /other current liabilities/i,
  'Sales':           /revenue from operations|sale/i,
}
try {
  await launch()
  const { rows: [rs] } = await query('SELECT id FROM mapping_rule_sets WHERE is_default LIMIT 1')
  for (const c of [1, 2, 3]) {
    const tag = NAME[c]
    const { rows: [e] } = await query(`INSERT INTO entities (name, constitution, constitution_display, business_type) VALUES ($1,$2,$3,'Trader') RETURNING id`, [`Busy ${tag}`, c, tag])
    const up = await ipc('tb:uploadBusy', { entityId: e.id, period: '2026-27', fileName: 'busy.xlsx', tbRows: buildTBRowsFromBusy(parsed, { constitution: c }), branchName: '', entityPeriodId: null })
    await ipc('mappedTB:run', up.tb.id, rs.id, {})
    const all = await ipc('mappedTB:findByFilter', up.tb.id, {})
    const m = new Map(all.map(r => [r.name, r]))
    if (EXPLORE) for (const r of all) console.log(`    [${tag}] ${r.name} -> ${r.alie} | ${r.mapping1_resultant} | ${r.mapping2_resultant} | ${r.mapping3_resultant}`)
    ok(`[${tag}] all ${parsed.rows.length} ledgers were stored and mapped`, all.length === parsed.rows.length, `${all.length}`)
    for (const [n, rx] of Object.entries(EXPECT)) {
      const r = m.get(n)
      const line = r ? [r.mapping1_resultant, r.mapping2_resultant, r.mapping3_resultant].join(' | ') : '(missing)'
      ok(`[${tag}] ${n} -> ${line}`, !!r && rx.test(line), line)
    }
  }
} catch (e) { ok('the engine run', false, e.stack || e.message) }

// ── global Auditor master: the optional PAN / address / e-mail ───────────────
console.log('\nAuditor master: optional PAN, address, e-mail')
try {
  const firm = await ipc('auditorFirm:save', { firm_name: 'ABC & Co.', frn: '123456W' })
  ok('a firm can still be saved with none of the new details', firm.id && firm.pan === null && firm.address === null && firm.email === null)
  const f2 = await ipc('auditorFirm:save', { id: firm.id, firm_name: 'ABC & Co.', frn: '123456W', pan: ' aaafa1234b ', address: ' 1 Park Street, Kolkata ', email: 'office@abc.in' })
  ok('PAN (upper-cased), address and e-mail of the firm are kept', f2.pan === 'AAAFA1234B' && f2.address === '1 Park Street, Kolkata' && f2.email === 'office@abc.in', JSON.stringify(f2))
  let bad = 0
  for (const d of [{ pan: 'ABC123' }, { email: 'not-an-email' }]) { try { await ipc('auditorFirm:save', { id: firm.id, firm_name: 'ABC & Co.', ...d }) } catch { bad++ } }
  ok('a PAN or an e-mail that is not well formed is refused', bad === 2)
  const sg = await ipc('globalSignatory:save', { firm_id: firm.id, name: 'CA Partner', membership_number: '123456', address: 'Flat 4, Siliguri', email: 'partner@abc.in' })
  ok('address and e-mail of the signing partner are kept', sg.address === 'Flat 4, Siliguri' && sg.email === 'partner@abc.in')
  const sg2 = await ipc('globalSignatory:save', { firm_id: firm.id, name: 'CA Two', membership_number: '654321' })
  ok('a signing partner can still be saved with neither', sg2.address === null && sg2.email === null)
  const sg3 = await ipc('globalSignatory:save', { firm_id: firm.id, name: 'CA Fellow', membership_number: '111111', membership_category: 'Fellow' })
  const sg4 = await ipc('globalSignatory:save', { firm_id: firm.id, name: 'CA Bad', membership_number: '222222', membership_category: 'Master' })
  ok('the category of membership (Associate / Fellow) is kept; anything else is not stored', sg3.membership_category === 'Fellow' && sg4.membership_category === null && sg2.membership_category === null, JSON.stringify([sg3.membership_category, sg4.membership_category]))
  const aud = await ipc('auditor:save', { entity_id: (await query('SELECT id FROM entities LIMIT 1')).rows[0].id, name: 'CA Assoc', membership_number: '333333', membership_category: 'Associate' })
  ok('the per-auditee auditor keeps it too, and the Generate Financials list carries it', aud.membership_category === 'Associate' && (await ipc('auditor:listGlobal')).find(r => r.name === 'CA Fellow')?.membership_category === 'Fellow')
  const list = await ipc('auditor:listGlobal')
  const row = list.find(r => r.name === 'CA Partner')
  ok('the Generate Financials list carries them (firm_pan / firm_address / firm_email / signer_address / signer_email)', row && row.firm_pan === 'AAAFA1234B' && row.firm_address === '1 Park Street, Kolkata' && row.firm_email === 'office@abc.in' && row.signer_address === 'Flat 4, Siliguri' && row.signer_email === 'partner@abc.in', JSON.stringify(row))
} catch (e) { ok('the Auditor master run', false, e.stack || e.message) }

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
