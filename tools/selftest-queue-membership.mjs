/**
 * Pre-release self-test: WHO the default Rectification / Recategorisation list shows.
 *
 * Reported live: Trade Payables that were complete (the "To fix" column said so) were listed in the
 * default view, without "Show all mapped rows". Reproduced on a real PostgreSQL (a throw-away
 * cluster started by this test - never the user's database) by running the app's own start-up
 * (ensureSchema + seed + migrations), uploading a Trial Balance per constitution, running the real
 * Auto-Mapping and asking mappedTB:findByFilter({ uncategorised: true }) - the query behind the list:
 *   1. its "Level 4 / Level 5 still blank" test looked at Level Format rows of EVERY constitution
 *      (Company's Trade payables / receivables were listed while Partnership's / LLP's rows still
 *      carried a Level 5 option list - the state right after every default-mapping reseed);
 *   2. ...and at every Level 3 under the same Level 2 (Advance from Customers was listed because
 *      Statutory dues payable has a Level 4 list; Sale of Products because another Sale line has a
 *      Level 5 list).
 * Now a ledger is listed only for what ITS OWN Level Format row still needs, and the screen holds
 * back (and counts) any listed ledger that is complete anyway.
 *
 * Needs a local PostgreSQL install (initdb / pg_ctl); says SKIPPED loudly when there is none.
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 *
 *   node tools/selftest-queue-membership.mjs
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
registerTBHandlers(); registerMappingHandlers(); registerMappedTBHandlers()
const ipc = (name, ...args) => globalThis.__ipc[name](null, ...args)
const launch = () => withStartupLock(async () => {
  await ensureSchema(); await seedDefaultMapping(); await ensureStockCategories()
  await migrateMappingV3Captions(); await migrateMappingV3CaptionsPass2(); await applyMappingPatches()
})

// the client's own definition of "nothing left to fix"
const built = await esbuild.build({ entryPoints: [path.join(srcRoot, 'src/renderer/src/utils/fixTargets.js')], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' })
const tmpU = path.join(os.tmpdir(), `fsgq-util-${process.pid}.mjs`); fs.writeFileSync(tmpU, built.outputFiles[0].text)
const util = await import(pathToFileURL(tmpU).href); fs.rmSync(tmpU, { force: true })
const needsOf = (lf, r) => (util.ledgerNeeds ? util.ledgerNeeds(lf, r) : [])
const completeOf = (lf, r) => (util.isComplete ? util.isComplete(lf, r) : (needsOf(lf, r).length === 0 && !/uncategori[sz]ed/i.test([r.mapping1_resultant, r.mapping2_resultant, r.mapping3_resultant].join(' '))))

// ── the books ────────────────────────────────────────────────────────────────
const mk = (name, chain, closing, type, dr) => {
  const r = { period: '2025-26', branch: '', ledger_code: '', name, opening_balance: closing, debit: 0, credit: 0, closing_balance: closing, is_revenue: null, is_deemed_positive: dr, trail_balance: 0, trial_balance_type: type, parent: chain[0] || '' }
  for (let i = 1; i < chain.length; i++) r[i === 1 ? 'group_parent' : 'group_parent_' + (i - 1)] = chain[i]
  return r
}
const CL = 'Current Liabilities', CA = 'Current Assets'
const books = (cons) => [
  mk('Alpha Traders', ['Sundry Creditors', CL, 'Primary'], 250000, 'Liabilities', false),
  mk('Beta Suppliers', ['Sundry Creditors', CL, 'Primary'], 150000, 'Liabilities', false),
  mk('MSME Vendor Delta', ['Sundry Creditors', CL, 'Primary'], 80000, 'Liabilities', false),
  mk('Gamma Debit Creditor', ['Sundry Creditors', CL, 'Primary'], -20000, 'Liabilities', false),
  mk('GST Payable', ['Duties & Taxes', CL, 'Primary'], 40000, 'Liabilities', false),
  mk('TDS Payable', ['Duties & Taxes', CL, 'Primary'], 15000, 'Liabilities', false),
  mk('HDFC Term Loan', ['Secured Loans', 'Loans (Liability)', 'Primary'], 500000, 'Liabilities', false),
  mk('Friend Loan', ['Unsecured Loans', 'Loans (Liability)', 'Primary'], 100000, 'Liabilities', false),
  mk(cons === 3 ? 'Share Capital' : 'Capital Account', ['Capital Account', 'Primary'], 1000000, 'Liabilities', false),
  mk('Kappa Customer', ['Sundry Debtors', CA, 'Primary'], -300000, 'Assets', true),
  mk('Lambda Customer', ['Sundry Debtors', CA, 'Primary'], -120000, 'Assets', true),
  mk('Credit Debtor', ['Sundry Debtors', CA, 'Primary'], 10000, 'Assets', true),
  mk('HDFC Bank', ['Bank Accounts', CA, 'Primary'], -400000, 'Assets', true),
  mk('Cash', ['Cash-in-Hand', CA, 'Primary'], -20000, 'Assets', true),
  mk('Plant and Machinery', ['Fixed Assets', 'Primary'], -700000, 'Assets', true),
  mk('Loan to Party B', ['Loans & Advances (Asset)', CA, 'Primary'], -30000, 'Assets', true),
  mk('Advance to Supplier X', ['Loans & Advances (Asset)', CA, 'Primary'], -12000, 'Assets', true),
  mk('Sales', ['Sales Accounts', 'Primary'], 2000000, 'Income', false),
  mk('Purchases', ['Purchase Accounts', 'Primary'], -1200000, 'Expenses', true),
  mk('Salary', ['Indirect Expenses', 'Primary'], -300000, 'Expenses', true),
  mk('Rent', ['Indirect Expenses', 'Primary'], -120000, 'Expenses', true),
]
const NAME = { 1: 'Partnership', 2: 'LLP', 3: 'Company' }

async function scenario(label) {
  console.log(`\n  -- ${label} --`)
  const { rows: [rs] } = await query('SELECT id FROM mapping_rule_sets WHERE is_default LIMIT 1')
  for (const c of [1, 2, 3]) {
    const tag = `${NAME[c]}, ${label.replace(/ \(.*/, '')}`
    let entityId
    { const { rows: [e] } = await query(`INSERT INTO entities (name, constitution, constitution_display, business_type) VALUES ($1,$2,$3,'Trader') RETURNING id`, [`Q ${NAME[c]} ${label}`, c, NAME[c]]); entityId = e.id }
    const up = await ipc('tb:uploadRealBooks', { entityId, period: '2025-26', fileName: `q_${c}.xlsx`, tbRows: books(c), branchName: '', entityPeriodId: null })
    const tbId = up.tb.id
    await ipc('mappedTB:run', tbId, rs.id, {})
    const lf = (await query('SELECT * FROM level_format WHERE rule_set_id = $1 AND constitution = $2', [rs.id, c])).rows
    const byName = async () => { const all = await ipc('mappedTB:findByFilter', tbId, {}); return new Map(all.map(r => [r.name, r])) }
    const queueNames = async () => new Set((await ipc('mappedTB:findByFilter', tbId, { uncategorised: true })).map(r => r.name))

    let q = await queueNames()
    const trade = [...(await byName()).values()].filter(r => /^trade (payables|receivables)$/i.test(r.mapping2_resultant || '') && r.mapping3_resultant)
    ok(`[${tag}] no classified Trade payables / receivables ledger is listed (${trade.length} of them exist)`, q.size > 0 && !trade.some(r => q.has(r.name)), trade.filter(r => q.has(r.name)).map(r => r.name).join(', '))
    ok(`[${tag}] ledgers on their own finished line are not listed: Credit Debtor (Advance from Customers), Sales (Sale of Products), Cash, HDFC Bank`, !['Credit Debtor', 'Sales', 'Cash', 'HDFC Bank'].some(n => q.has(n)), ['Credit Debtor', 'Sales', 'Cash', 'HDFC Bank'].filter(n => q.has(n)).join(', '))
    ok(`[${tag}] ledgers that really need work ARE listed: Mapping 2 (Friend Loan, HDFC Term Loan), Mapping 3 (Plant and Machinery), Level 4 (GST / TDS Payable)`, ['Friend Loan', 'HDFC Term Loan', 'Plant and Machinery', 'GST Payable', 'TDS Payable'].every(n => q.has(n)), ['Friend Loan', 'HDFC Term Loan', 'Plant and Machinery', 'GST Payable', 'TDS Payable'].filter(n => !q.has(n)).join(', '))

    // Level 5 blank: listed exactly when the ledger's OWN line has a Level 5 list (Partnership and Company: Others has
    // one; LLP's "Others" has none, and a sibling line's list must not queue it); a CA's own Save exempts it
    const adv = (await byName()).get('Advance to Supplier X')
    if (adv && /short-term loans and advances/i.test(adv.mapping2_resultant || '')) {
      await query(`UPDATE mapped_tb SET level5_value = NULL, status = 'auto_high' WHERE id = $1`, [adv.id])
      const needsL5 = needsOf(lf, { ...adv, level5_value: null, status: 'auto_high' }).some(n => n.what === 'Level 5')
      q = await queueNames()
      ok(`[${tag}] a ledger with a blank Level 5 is listed exactly when its own line has a Level 5 list (${needsL5 ? 'it does' : 'it has none here'})`, util.ledgerNeeds ? q.has('Advance to Supplier X') === needsL5 && needsL5 === (c !== 2) : q.has('Advance to Supplier X') === (c !== 2), `listed=${q.has('Advance to Supplier X')} line has a list=${needsL5}`)
      if (needsL5) {
        await query(`UPDATE mapped_tb SET status = 'user_override' WHERE id = $1`, [adv.id])
        ok(`[${tag}] ...and is not listed once the CA has reviewed and saved it`, !(await queueNames()).has('Advance to Supplier X'))
      }
      await query(`UPDATE mapped_tb SET level5_value = 'Unsecured, considered good', status = 'auto_high' WHERE id = $1`, [adv.id])
    }
    // the engine's own flag stays a reason to list a ledger
    const cash = (await byName()).get('Cash')
    await query(`UPDATE mapped_tb SET status = 'discrepancy' WHERE id = $1`, [cash.id])
    ok(`[${tag}] a ledger the engine flagged as a discrepancy is listed`, (await queueNames()).has('Cash'))
    await query(`UPDATE mapped_tb SET status = 'auto_high' WHERE id = $1`, [cash.id])

    // the property the CA asked for: whatever is listed has something left to do
    const listed = await ipc('mappedTB:findByFilter', tbId, { uncategorised: true })
    const idle = listed.filter(r => completeOf(lf, r))
    ok(`[${tag}] every listed ledger has something left to fix (${listed.length} listed)`, idle.length === 0, idle.map(r => `${r.name} [${r.mapping1_resultant} | ${r.mapping2_resultant} | ${r.mapping3_resultant}]`).join('; '))
  }
}

try {
  await launch()                                              // the seed runs AFTER ensureSchema: Partnership / LLP still hold Level 5 lists for Trade payables
  await scenario('right after a mapping reseed (Level 5 lists not yet migrated)')
  await launch()                                              // the next launch migrates Level 5 -> Level 3
  await scenario('after the next launch')
} catch (e) { ok('the scenario runs', false, e.stack || e.message) }

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
