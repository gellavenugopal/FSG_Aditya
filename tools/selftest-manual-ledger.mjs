/**
 * Pre-release self-test: a ledger added at the end of the Mapped TB (0.1.105).
 * Mapped TB > Add Ledger: a ledger that is not in the imported Trial Balance - name, mapping at every level, Adjustment (Debit) / (Credit) -
 * whose Revised Closing Balance, Balance Sheet, Profit and Loss, Notes and Annexures follow like any other ledger; kept by a re-run of the mapping;
 * refused (with a message, leaving nothing behind) when the name is empty or used, the mapping incomplete, the adjustment bad, or the year locked.
 * The Journal Entry sub menu is unchanged.
 *
 * Runs the REAL main-process code and the REAL renderer builders (statements, PDF) on a throw-away PostgreSQL cluster in the temp folder, deleted
 * afterwards - the live database is never touched. FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 *   node tools/selftest-manual-ledger.mjs
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
register(pathToFileURL(path.join(root, 'tools', 'e2e-learned-rules', 'hooks.mjs')).href)
const xlsxShim = path.join(os.tmpdir(), `fsg-selftest-xlsx-fy-${process.pid}.mjs`)
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

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + detail}`)
}
const finish = () => { console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n') }
const near = (a, b, tol = 0.005) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tol

// ── Throw-away PostgreSQL ───────────────────────────────────────────────────
const pgRoot = 'C:\\Program Files\\PostgreSQL'
const ver = fs.existsSync(pgRoot) ? fs.readdirSync(pgRoot).filter(d => fs.existsSync(path.join(pgRoot, d, 'bin', 'initdb.exe'))).sort((a, b) => parseFloat(b) - parseFloat(a))[0] : null
if (!ver) { ok('PostgreSQL binaries found (C:\\Program Files\\PostgreSQL\\<ver>\\bin)', false); finish(); process.exit(1) }
const bin = (x) => path.join(pgRoot, ver, 'bin', x)
const port = await new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) }) })
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-selftest-pg-fy-'))
const run = (exe, args, quiet = false) => spawnSync(bin(exe), args, quiet ? { stdio: 'ignore', timeout: 60000 } : { encoding: 'utf8', timeout: 120000 })
let started = false
const cleanup = () => {
  if (started) run('pg_ctl.exe', ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], true)
  fs.rmSync(dataDir, { recursive: true, force: true })
}

// The renderer's own builders: the statements, the PDF document and the Excel workbook.
async function loadBuilders() {
  const rd = (...p) => JSON.stringify(path.join(srcRoot, 'src', 'renderer', 'src', ...p))
  const built = await esbuild.build({
    stdin: { contents: `export { fetchFinancialsData, displayAmt } from ${rd('hooks', 'useFinancials.js')}\nexport { buildFinancialsHTML } from ${rd('components', 'GenerateFinancials', 'buildHTML.js')}\nexport { buildFinancialsWorkbook } from ${rd('components', 'GenerateFinancials', 'buildExcel.js')}\n`, resolveDir: srcRoot, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' }, nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [{ name: 'shims', setup(b) {
      b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
      b.onLoad({ filter: /^react$/, namespace: 'shim' }, () => ({ contents: 'const R={createElement:()=>null};export default R;export const useState=()=>[];export const useEffect=()=>{};export const useRef=()=>({});export const useMemo=(f)=>f();export const useCallback=(f)=>f;', loader: 'js' }))
    } }],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-fy-builders-${process.pid}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try { return await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
}

try {
  let r = run('initdb.exe', ['-D', dataDir, '-U', 'selftest', '-A', 'trust', '-E', 'UTF8'])
  if (r.status !== 0) throw new Error('initdb failed: ' + (r.stderr || r.stdout))
  r = run('pg_ctl.exe', ['-D', dataDir, '-o', `-p ${port}`, '-l', path.join(dataDir, 'log.txt'), '-w', 'start'], true)
  if (r.status !== 0) throw new Error('pg_ctl start failed (status ' + r.status + ')')
  started = true

  process.chdir(srcRoot)
  const imp = (rel) => import(pathToFileURL(path.join(srcRoot, 'src', 'main', ...rel.split('/'))).href)
  const { initDB, query } = await imp('db/client.js')
  const { ensureSchema } = await imp('db/schema.js')
  const { seedDefaultMapping, ensureStockCategories } = await imp('services/excel.js')
  const mig = await imp('db/mapping-v3-migration.js')
  const { applyMappingPatches, registerMappingHandlers } = await imp('ipc/mapping.js')
  const { registerTBHandlers } = await imp('ipc/tb.js')
  const { registerMappedTBHandlers } = await imp('ipc/mapped-tb.js')
  const { registerFinancialHandlers } = await imp('ipc/financials.js')
  const { registerMastersHandlers } = await imp('ipc/masters.js')
  const { registerFinancialPeriodHandlers } = await imp('ipc/financial-periods.js')
  const B = await loadBuilders()
  await initDB({ host: 'localhost', port, database: 'postgres', user: 'selftest', password: '' })
  await ensureSchema(); await seedDefaultMapping(); await ensureStockCategories()
  await mig.migrateMappingV3Captions(); await mig.migrateMappingV3CaptionsPass2(); await applyMappingPatches()
  registerTBHandlers(); registerMappedTBHandlers(); registerFinancialHandlers(); registerMastersHandlers(); registerFinancialPeriodHandlers(); registerMappingHandlers()
  const ipc = (name, ...args) => globalThis.__ipc[name](null, ...args)
  const one = async (sql, p) => (await query(sql, p)).rows[0]

  // window.api exactly as the preload builds it (name -> channel).
  const preloadText = fs.readFileSync(path.join(srcRoot, 'src', 'preload', 'index.js'), 'utf8')
  const api = {}
  for (const m of preloadText.matchAll(/(\w+):\s*\(([^)]*)\)\s*=>\s*(?:ipcRenderer\.invoke|inv)\('([^']+)'/g)) {
    const [, name, , channel] = m
    api[name] = (...args) => globalThis.__ipc[channel] ? globalThis.__ipc[channel](null, ...args) : Promise.resolve(/^list|Rows$|^get(Level|Rule)/.test(name) ? [] : null)
  }
  globalThis.window = { api }

  const rs = (await one(`SELECT id FROM mapping_rule_sets WHERE is_default LIMIT 1`)).id
  const mkEntity = async (name) => (await one(`INSERT INTO entities (name, constitution, constitution_display, business_type) VALUES ($1, 3, 'Company', 'Trader') RETURNING *`, [name]))
  const mkPeriod = async (ent, label, from, till) => {
    const fp = (await one(`SELECT id FROM financial_periods WHERE date_from = $1 AND date_till = $2`, [from, till]))?.id
      || (await one(`INSERT INTO financial_periods (year_label, date_from, date_till) VALUES ($1,$2,$3) RETURNING id`, [label, from, till])).id
    return (await one(`INSERT INTO entity_periods (entity_id, financial_period_id) VALUES ($1,$2) RETURNING id`, [ent, fp])).id
  }
  const L = (name, parent, gp, closing, opening, deemed) => ({
    period: '', branch: '', ledger_code: '', name, opening_balance: opening, debit: 0, credit: 0, closing_balance: closing,
    is_revenue: null, is_deemed_positive: deemed, trail_balance: 0, parent, group_parent: gp,
    group_parent_1: '', group_parent_2: '', group_parent_3: '', group_parent_4: '', group_parent_5: '', group_parent_6: '', group_parent_7: gp,
  })
  const upload = async (ent, ep, label, rows, file) => {
    const up = await ipc('tb:uploadRealBooks', { entityId: ent.id, period: label, fileName: file, tbRows: rows, branchName: '', entityPeriodId: ep })
    await ipc('mappedTB:run', up.tb.id, rs, { excludeZero: true })
    return (await one(`SELECT * FROM trial_balances WHERE id = $1`, [up.tb.id]))
  }
  const books = (extra = []) => {
    const rows = [
      L('Equity Share Capital', 'Capital Account', 'Capital Account', 600000, 600000, false),
      L('Sundry Creditors Co', 'Sundry Creditors', 'Current Liabilities', 100000, 100000, false),
      L('Sales - Goods', 'Sales Accounts', 'Sales Accounts', 500000, 0, false),
      L('Purchases', 'Purchase Accounts', 'Purchase Accounts', -300000, 0, true),
      ...extra,
    ]
    let cr = 0, dr = 0
    for (const r of rows) { if (r.closing_balance > 0) cr += r.closing_balance; else dr -= r.closing_balance }
    rows.push(L('HDFC Bank', 'Bank Accounts', 'Current Assets', -(cr - dr), -(cr - dr), true))
    return rows
  }
  const mappedOf = async (tbId) => (await query(`SELECT r.name, r.upload_nature, r.closing_balance, r.imported_closing_balance, r.adj_debit, r.adj_credit, m.id AS mid, m.alie, m.mapping1_resultant, m.mapping2_resultant, m.mapping3_resultant, m.status, m.override_note, m.level4_value, m.level7_value
    FROM mapped_tb m JOIN tb_rows r ON r.id = m.tb_row_id WHERE m.tb_id=$1 ORDER BY m.id`, [tbId])).rows
  const lineOf = (sections, rx) => (sections || []).flatMap(s => s.lines || []).find(l => rx.test(l.level2 || ''))
  const noteOf = (data, rx) => Object.values(data.notes || {}).find(n => !!n && rx.test(n.title || ''))
  const fails_ = async (fn) => { try { await fn(); return null } catch (e) { return String((e && e.message) || e) } }

  const entA = await mkEntity('ZZ Manual Co'), epA = await mkPeriod(entA.id, '2025-26', '2025-04-01', '2026-03-31')
  const tbA = await upload(entA, epA, '2025-26', books(), 'a.xlsx')
  const lfRows = (await query(`SELECT * FROM level_format WHERE rule_set_id=$1 AND constitution=3 ORDER BY id`, [rs])).rows
  const expLF = lfRows.find(r => r.level1 === 'Other expenses' && r.level2), liabLF = lfRows.find(r => r.level1 === 'Current liabilities' && r.level2 === 'Other current liabilities' && r.level3 === 'Expenses payable (accrued expenses)')
  const expMap = { mapping1_resultant: expLF.level1, mapping2_resultant: expLF.level2, mapping3_resultant: expLF.level3 }
  const liabMap = { mapping1_resultant: liabLF.level1, mapping2_resultant: liabLF.level2, mapping3_resultant: liabLF.level3 }
  const before = await B.fetchFinancialsData(tbA, null, entA, rs)

  console.log('\n1. A ledger added on the Mapped TB: name, mapping at every level, adjustment')
  const addP = await ipc('mappedTB:addManualLedger', tbA.id, { ledger_name: '  Provision for   audit fees ', ledger_code: 'MAN-01', ...liabMap, level_format_id: liabLF.id, adj_credit: '10,000' })
  const addE = await ipc('mappedTB:addManualLedger', tbA.id, { ledger_name: 'Audit fees', ...expMap, adj_debit: 10000, override_note: 'Provision for the year' })
  const m = await mappedOf(tbA.id)
  const mp = m.find(x => x.name === 'Provision for audit fees'), me = m.find(x => x.name === 'Audit fees')
  ok('the ledgers are in the Trial Balance with their tidied names, as ledgers added here, imported balance nil', mp && me && mp.upload_nature === 'Manual Ledger' && me.upload_nature === 'Manual Ledger' && Number(mp.imported_closing_balance) === 0, JSON.stringify([mp, me]))
  ok('the adjustment makes the Revised Closing Balance: credit +10,000 on the liability, debit -10,000 on the expense', Number(mp.closing_balance) === 10000 && Number(mp.adj_credit) === 10000 && Number(me.closing_balance) === -10000 && Number(me.adj_debit) === 10000, JSON.stringify([mp.closing_balance, me.closing_balance]))
  ok('each is mapped at every level, on the right side, by the Override button\'s own save (status user_override)', mp.alie === 'EQUITY AND LIABILITIES' && mp.mapping1_resultant === liabLF.level1 && mp.mapping2_resultant === liabLF.level2 && mp.mapping3_resultant === liabLF.level3 && me.alie === 'Expenses' && me.mapping3_resultant === expLF.level3 && mp.status === 'user_override' && me.status === 'user_override', JSON.stringify([mp, me]))
  const rowsApi = await ipc('mappedTB:rows', tbA.id)
  ok('the Mapped TB lists them with the imported (nil) and Revised figures, like any adjusted ledger', rowsApi.some(r => r.name === 'Audit fees' && Number(r.imported_closing_balance) === 0 && Number(r.closing_balance) === -10000 && r.upload_nature === 'Manual Ledger'))
  const sum = await ipc('mappedTB:adjustmentSummary', tbA.id)
  ok('the Adjustments summary counts them, and the revised Trial Balance still balances', sum.rows_adjusted === 2 && Math.abs(sum.total_debit - 10000) < 0.01 && Math.abs(sum.total_credit - 10000) < 0.01 && sum.revised_balanced === true, JSON.stringify(sum))
  const trCount = (await one(`SELECT row_count FROM trial_balances WHERE id=$1`, [tbA.id])).row_count
  ok('the Trial Balance\'s row count follows', trCount === m.length, `${trCount} vs ${m.length}`)

  console.log('\n2. The Balance Sheet, Profit and Loss, Notes and Annexures follow')
  const after = await B.fetchFinancialsData(tbA, null, entA, rs)
  const provLine = lineOf(after.elSections, /other current liabilit/i), oeLine = lineOf(after.expenseSections, /other expenses|payments to auditors/i)
  const oeSec = (after.expenseSections || []).find(s => /^other expenses$/i.test((s.level1 || '').trim()))
  ok('the liability reaches Other current liabilities, the expense reaches Other expenses, and the profit falls by the expense', provLine && Math.abs(provLine.total - 10000) < 0.5 && oeSec && Math.abs(oeSec.total - 10000) < 0.5 && Math.abs((before.netProfit - after.netProfit) - 10000) < 0.5, JSON.stringify([provLine && provLine.total, oeSec && oeSec.total, before.netProfit, after.netProfit]))
  ok('the Balance Sheet still balances', Math.abs(after.totalEL - after.totalAssets) < 0.5, `${after.totalEL} vs ${after.totalAssets}`)
  const provNote = noteOf(after, /^other current liabilities$/i), oeNote = noteOf(after, /^other expenses$/i)
  ok('the notes carry the ledgers (Other current liabilities, Other expenses), so the Annexures list them too', provNote && provNote.rows.some(r => r.name === 'Provision for audit fees') && oeNote && oeNote.rows.some(r => r.name === 'Audit fees'), JSON.stringify([provNote && provNote.rows.map(r => r.name), oeNote && oeNote.rows.map(r => r.name)]))
  const pdf = B.buildFinancialsHTML({ entity: entA, activeTB: tbA, prevTB: null, data: after, auditor: null, signatories: [], signPlace: 'X', signDate: '2026-09-30' }).replace(/<template[\s\S]*?<\/template>/g, '')
  ok('the PDF prints them (Annexures list the ledgers by name)', /Provision for audit fees/.test(pdf) && /Audit fees/.test(pdf))
  // the same figures as a Trial Balance that was imported with these two ledgers
  const entB = await mkEntity('ZZ Manual Imported'), epB = await mkPeriod(entB.id, '2025-26', '2025-04-01', '2026-03-31')
  const tbB = await upload(entB, epB, '2025-26', books([L('Provision for audit fees', 'Provisions', 'Current Liabilities', 10000, 0, false), L('Audit fees', 'Indirect Expenses', 'Indirect Expenses', -10000, 0, true)]), 'b.xlsx')
  for (const [n, mp2] of [['Provision for audit fees', liabMap], ['Audit fees', expMap]]) {
    const row = (await mappedOf(tbB.id)).find(x => x.name === n)
    await ipc('mappedTB:override', row.mid, { ...mp2, level_format_id: null, level4_value: null, level5_value: null, level6_value: null, level7_value: null, override_note: 'parity' })
  }
  const dB = await B.fetchFinancialsData(tbB, null, entB, rs)
  ok('the statements equal those of a Trial Balance imported with the same two ledgers (profit, total liabilities, total assets, income, expenses)', Math.abs(after.netProfit - dB.netProfit) < 0.5 && Math.abs(after.totalEL - dB.totalEL) < 0.5 && Math.abs(after.totalAssets - dB.totalAssets) < 0.5 && Math.abs(after.totalIncome - dB.totalIncome) < 0.5 && Math.abs(after.totalExpenses - dB.totalExpenses) < 0.5, JSON.stringify([after.netProfit, dB.netProfit, after.totalEL, dB.totalEL]))

  console.log('\n3. Precautions')
  const cnt = async () => (await one(`SELECT count(*)::int AS n FROM tb_rows WHERE tb_id=$1`, [tbA.id])).n
  const n0 = await cnt()
  const errs = {
    empty: await fails_(() => ipc('mappedTB:addManualLedger', tbA.id, { ledger_name: '   ', ...liabMap })),
    dupNew: await fails_(() => ipc('mappedTB:addManualLedger', tbA.id, { ledger_name: 'provision FOR audit fees', ...liabMap })),
    dupImported: await fails_(() => ipc('mappedTB:addManualLedger', tbA.id, { ledger_name: ' sales - goods ', ...liabMap })),
    noMap: await fails_(() => ipc('mappedTB:addManualLedger', tbA.id, { ledger_name: 'X1' })),
    badMap: await fails_(() => ipc('mappedTB:addManualLedger', tbA.id, { ledger_name: 'X2', mapping1_resultant: 'Not a real head' })),
    noL2: await fails_(() => ipc('mappedTB:addManualLedger', tbA.id, { ledger_name: 'X3', mapping1_resultant: liabLF.level1 })),
    noL3: await fails_(() => ipc('mappedTB:addManualLedger', tbA.id, { ledger_name: 'X4', mapping1_resultant: liabLF.level1, mapping2_resultant: liabLF.level2 })),
    negative: await fails_(() => ipc('mappedTB:addManualLedger', tbA.id, { ledger_name: 'X5', ...liabMap, adj_credit: -5 })),
    text: await fails_(() => ipc('mappedTB:addManualLedger', tbA.id, { ledger_name: 'X6', ...liabMap, adj_debit: 'abc' })),
    consolidated: await fails_(() => ipc('mappedTB:addManualLedger', '__consolidated__', { ledger_name: 'X7', ...liabMap })),
  }
  ok('refused, each with a message: no name, a name already used (new or imported, any capitals or spaces), no / unknown / incomplete mapping, a negative or non-numeric adjustment, the Consolidated view', Object.values(errs).every(Boolean), JSON.stringify(errs))
  ok('...and a refusal leaves nothing behind (no ledger, no mapping row)', (await cnt()) === n0 && (await one(`SELECT count(*)::int AS n FROM mapped_tb WHERE tb_id=$1`, [tbA.id])).n === (await mappedOf(tbA.id)).length)
  const kept = await one(`SELECT count(*)::int AS n FROM tb_rows WHERE tb_id=$1 AND name LIKE 'X%'`, [tbA.id])
  ok('no half-made ledger (X1-X7) exists', kept.n === 0)
  await query(`UPDATE entity_periods SET locked=TRUE WHERE id=$1`, [epA])
  const lockedErr = await fails_(() => ipc('mappedTB:addManualLedger', tbA.id, { ledger_name: 'In locked year', ...liabMap, adj_credit: 5 }))
  const lockedDel = await fails_(() => ipc('mappedTB:deleteManualLedger', mp.mid))
  ok('a locked Financial Year refuses adding and removing', /locked/i.test(lockedErr || '') && /locked/i.test(lockedDel || ''), `${lockedErr} | ${lockedDel}`)
  await query(`UPDATE entity_periods SET locked=FALSE WHERE id=$1`, [epA])

  console.log('\n4. A re-run of the mapping, an adjustment edited, a ledger removed')
  const addZero = await ipc('mappedTB:addManualLedger', tbA.id, { ledger_name: 'Spare ledger (nil for now)', ...liabMap })
  const runRes = await ipc('mappedTB:run', tbA.id, rs, { excludeZero: true })
  const m2 = await mappedOf(tbA.id)
  const p2 = m2.find(x => x.name === 'Provision for audit fees'), e2 = m2.find(x => x.name === 'Audit fees'), z2 = m2.find(x => x.name === 'Spare ledger (nil for now)')
  ok('mapping the Trial Balance again keeps every added ledger, its mapping and its adjustment - even one still at nil', p2 && e2 && z2 && p2.mapping2_resultant === liabLF.level2 && e2.mapping2_resultant === expLF.level2 && Number(p2.closing_balance) === 10000 && Number(e2.closing_balance) === -10000 && z2.mapping2_resultant === liabLF.level2, JSON.stringify([p2, e2, z2]))
  await ipc('mappedTB:setAdjustment', z2.mid, { credit: 2500 })
  await ipc('mappedTB:setAdjustment', p2.mid, { credit: 12000 })
  const m3 = await mappedOf(tbA.id)
  ok('the Adjustments columns work on an added ledger (credit 2,500; 10,000 changed to 12,000)', Number(m3.find(x => x.name === 'Spare ledger (nil for now)').closing_balance) === 2500 && Number(m3.find(x => x.name === 'Provision for audit fees').closing_balance) === 12000)
  const sum3 = await ipc('mappedTB:adjustmentSummary', tbA.id)
  ok('...and the summary says the revised Trial Balance is out of balance by the difference (14,500 Cr v 10,000 Dr)', sum3.revised_balanced === false && Math.abs(sum3.revised_sum - 4500) < 0.01, JSON.stringify(sum3))
  const delImported = await fails_(() => ipc('mappedTB:deleteManualLedger', m3.find(x => x.name === 'Sales - Goods').mid))
  ok('a ledger from the imported Trial Balance cannot be removed this way', /Only a ledger added/i.test(delImported || ''), delImported)
  await ipc('mappedTB:deleteManualLedger', z2.mid)
  await ipc('mappedTB:deleteManualLedger', m3.find(x => x.name === 'Provision for audit fees').mid)
  await ipc('mappedTB:deleteManualLedger', m3.find(x => x.name === 'Audit fees').mid)
  const m4 = await mappedOf(tbA.id)
  const afterDel = await B.fetchFinancialsData(tbA, null, entA, rs)
  ok('removing the added ledgers takes them out of the Trial Balance and the statements (back to the imported figures)', !m4.some(x => x.upload_nature === 'Manual Ledger') && Math.abs(afterDel.netProfit - before.netProfit) < 0.5 && Math.abs(afterDel.totalEL - before.totalEL) < 0.5)
  const log = (await ipc('mappedTB:adjustmentLog', tbA.id)).filter(x => /ledger removed/.test(x.ledger_name || ''))
  ok('the removals are in the adjustment log', log.length === 3, String(log.length))

  console.log('\n5. The Journal Entry sub menu is unchanged')
  const je = await ipc('tb:saveJournalEntry', { tbId: tbA.id, date: '2026-03-31', entries: [{ type: 'Dr', ledgerName: 'JE Dr ledger', amount: 100, isNew: true, mapping1: expLF.level1, mapping2: expLF.level2, mapping3: expLF.level3 }, { type: 'Cr', ledgerName: 'JE Cr ledger', amount: 100, isNew: true, mapping1: liabLF.level1, mapping2: liabLF.level2, mapping3: liabLF.level3 }] })
  ok('a Journal Entry still saves its two ledgers', je && je.inserted === 2 && (await one(`SELECT count(*)::int AS n FROM tb_rows WHERE tb_id=$1 AND upload_nature='Journal Passed Manually'`, [tbA.id])).n === 2)

  console.log('\n6. The screens')
  const cmp = fs.readFileSync(path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'MappedTB', 'index.jsx'), 'utf8')
  const ovr = fs.readFileSync(path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'MappedTB', 'OverrideModal.jsx'), 'utf8')
  const pre = fs.readFileSync(path.join(srcRoot, 'src', 'preload', 'index.js'), 'utf8')
  ok('the Mapped TB has an Add Ledger bar at the end of the Trial Balance, a dialog with every mapping level, and a Remove for added ledgers', /Add Ledger/.test(cmp) && /askLedger/.test(cmp) && /handleRemoveManualLedger/.test(cmp) && /askLedger/.test(ovr) && /Level 7 \(Nature\)/.test(ovr) && /Adjustments \(Debit\)/.test(ovr))
  ok('the preload exposes addManualLedger and deleteManualLedger', /addManualLedger:.*mappedTB:addManualLedger/.test(pre) && /deleteManualLedger:.*mappedTB:deleteManualLedger/.test(pre))

  console.log('\n7. A Level 3 holding alternates is chosen one at a time; an added ledger is always in the Rectification list')
  await query(`INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3) VALUES ($1, 3, 'ASSETS', 'Current assets', 'Trade receivables', 'Secured, considered good / Unsecured, considered good / Doubtful')`, [rs])
  const altMap = { mapping1_resultant: 'Current assets', mapping2_resultant: 'Trade receivables', mapping3_resultant: 'Unsecured, considered good' }
  await ipc('mappedTB:addManualLedger', tbA.id, { ledger_name: 'Debtor added here', ...altMap, adj_debit: 5000 })
  const altRow = (await mappedOf(tbA.id)).find(x => x.name === 'Debtor added here')
  ok('one alternate (Unsecured, considered good) is accepted as Mapping 3 and saved as chosen', altRow && altRow.mapping3_resultant === 'Unsecured, considered good' && altRow.alie === 'ASSETS', JSON.stringify(altRow))
  let rejected = ''
  try { await ipc('mappedTB:addManualLedger', tbA.id, { ledger_name: 'Debtor wrong', ...altMap, mapping3_resultant: 'Something else', adj_debit: 1 }) } catch (e) { rejected = String(e.message || e) }
  ok('a Mapping 3 that is none of the alternates is refused', /Mapping 3/.test(rejected), rejected)
  const queue = await ipc('mappedTB:findByFilter', tbA.id, { uncategorised: true })
  ok('the Rectification list (uncategorised view) includes ledgers added on the Mapped TB, even when fully mapped', queue.some(x => x.name === 'Debtor added here'), String(queue.length))
  const queue2 = await ipc('mappedTB:findByFilter', tbA.id, { uncategorised: true, perLedger: true })
  ok('...by the per-ledger strategy too', queue2.some(x => x.name === 'Debtor added here'))
  const jeAlt = await ipc('tb:saveJournalEntry', { tbId: tbA.id, date: '2026-03-31', entries: [{ type: 'Dr', ledgerName: 'JE debtor', amount: 50, isNew: true, ...{ mapping1: altMap.mapping1_resultant, mapping2: altMap.mapping2_resultant, mapping3: altMap.mapping3_resultant } }, { type: 'Cr', ledgerName: 'JE other', amount: 50, isNew: true, mapping1: liabLF.level1, mapping2: liabLF.level2, mapping3: liabLF.level3 }] })
  const jeRow = (await mappedOf(tbA.id)).find(x => x.name === 'JE debtor')
  const jeLf = jeRow && (await one(`SELECT level_format_id FROM mapped_tb WHERE id=$1`, [jeRow.mid])).level_format_id
  ok('Journal Entry: Mapping 3 (one alternate) is saved and finds its Level Format row', jeAlt && jeRow && jeRow.mapping3_resultant === 'Unsecured, considered good' && jeLf, JSON.stringify([jeRow, jeLf]))
  const jsx = fs.readFileSync(path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'TrialBalance', 'JournalEntryPage.jsx'), 'utf8')
  ok('Journal Entry has a Level 3 column offering each alternate', /Level 3<\/th>/.test(jsx) && /m3ByM1M2/.test(jsx) && /requires Level 3/.test(jsx))
  const ovr2 = fs.readFileSync(path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'MappedTB', 'OverrideModal.jsx'), 'utf8')
  ok('the dialog offers each alternate as its own Mapping 3 choice', /flatMap\(r => alts\(r\.level3\)\)/.test(ovr2))

} catch (e) {
  ok('harness ran', false, e.stack || e.message)
} finally {
  process.chdir(root)
  cleanup()
  fs.rmSync(xlsxShim, { force: true })
}
finish()
process.exit(fails ? 1 : 0)
