/**
 * Pre-release self-test: two classifications (0.1.102).
 *  1. A debit balance under Trade Payables (an advance paid to a supplier) goes to SHORT-TERM LOANS AND ADVANCES, sub head Advance to Suppliers
 *     (it went to Other current assets).
 *  2. The Current maturities of long-term borrowings, worked out from the Long-term borrowings Fill Details, go to SHORT-TERM BORROWINGS under that
 *     sub head (they went to Other current liabilities).
 *
 * Runs the REAL main-process code and the REAL renderer builders (statements, PDF, Excel) on a throw-away PostgreSQL cluster in the temp folder,
 * deleted afterwards - the live database is never touched. FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-short-term-reclass.mjs
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
  // ledgers: Cr positive / Dr negative, as stored. Balanced: Cr 15,80,000 = Dr 15,80,000.
  const books = ({ cashCredit = true, advances = [20000], bank = null } = {}) => {
    const rows = [
      L('Equity Share Capital', 'Capital Account', 'Capital Account', 600000, 600000, false),
      L('Term Loan - HDFC', 'Secured Loans', 'Loans (Liability)', 300000, 300000, false),
      L('Supplier A', 'Sundry Creditors', 'Current Liabilities', 100000, 100000, false),
      L('Sales - Goods', 'Sales Accounts', 'Sales Accounts', 500000, 0, false),
      L('Purchases', 'Purchase Accounts', 'Purchase Accounts', -300000, 0, true),
    ]
    if (cashCredit) rows.push(L('Cash Credit - SBI', 'Bank OD A/c', 'Loans (Liability)', 80000, 80000, false))
    advances.forEach((a, i) => rows.push(L(`Supplier Adv ${i + 1} (advance paid)`, 'Sundry Creditors', 'Current Liabilities', -a, -a, true)))
    let cr = 0, dr = 0
    for (const r of rows) { if (r.closing_balance > 0) cr += r.closing_balance; else dr -= r.closing_balance }
    rows.push(L('HDFC Bank', 'Bank Accounts', 'Current Assets', -(cr - dr), -(cr - dr), true))
    return rows
  }
  const mappedOf = async (tbId) => (await query(`SELECT r.name, m.id, m.alie, m.mapping1_resultant, m.mapping2_resultant, m.mapping3_resultant, m.override_note, m.status FROM mapped_tb m JOIN tb_rows r ON r.id = m.tb_row_id WHERE m.tb_id=$1 ORDER BY m.id`, [tbId])).rows
  const setLTB = async (tbId) => query(`UPDATE mapped_tb SET mapping1_resultant='Non-current liabilities', mapping2_resultant='Long-term borrowings', mapping3_resultant='Term loans', level4_value=NULL, level5_value=NULL, level6_value=NULL, level7_value=NULL, status='user_approved'
    WHERE tb_id=$1 AND tb_row_id IN (SELECT id FROM tb_rows WHERE name='Term Loan - HDFC')`, [tbId])
  const lineOf = (sections, rx) => (sections || []).flatMap(s => s.lines || []).find(l => rx.test(l.level2 || ''))
  const noteOf = (data, rx) => Object.values(data.notes || {}).find(n => !n.isPL && rx.test(n.title || ''))

  console.log('\n1. A debit balance under Trade Payables (Advance to Suppliers) -> Short-term loans and advances')
  const entA = await mkEntity('ZZ Reclass A'), epA = await mkPeriod(entA.id, '2025-26', '2025-04-01', '2026-03-31')
  const tbA = await upload(entA, epA, '2025-26', books(), 'a.xlsx')
  const mA = await mappedOf(tbA.id)
  const adv = mA.find(m => /Supplier Adv 1/.test(m.name)), supA = mA.find(m => m.name === 'Supplier A')
  ok('the engine puts it under Short-term loans and advances, sub head Advance to Suppliers, on the Assets side', adv && adv.alie === 'ASSETS' && adv.mapping2_resultant === 'Short-term loans and advances' && adv.mapping3_resultant === 'Advance to Suppliers' && /Reclassified from Trade Payables/.test(adv.override_note || ''), JSON.stringify(adv))
  ok('...a credit balance stays under Trade payables', supA && supA.mapping2_resultant === 'Trade payables' && supA.alie === 'EQUITY AND LIABILITIES', JSON.stringify(supA))
  const lfCount = (await one(`SELECT count(DISTINCT constitution)::int AS n FROM level_format WHERE rule_set_id = $1 AND level2 = 'Short-term loans and advances' AND level3 = 'Advance to Suppliers'`, [rs])).n
  ok('every constitution (Proprietorship, Partnership / LLP, Company) has the sub head in the Level Format', lfCount === 3, String(lfCount))
  const dA = await B.fetchFinancialsData(tbA, null, entA, rs)
  const stl = lineOf(dA.assetSections, /short.term loans/i), oca = lineOf(dA.assetSections, /other current assets/i), tp = lineOf(dA.elSections, /trade payables/i)
  ok('Balance Sheet: Short-term loans and advances holds the 20,000; Other current assets does not; Trade payables is the 1,00,000 credit only', stl && Math.abs(stl.total - 20000) < 0.5 && (!oca || Math.abs(oca.total) < 0.5) && tp && Math.abs(tp.total - 100000) < 0.5, JSON.stringify([stl && stl.total, oca && oca.total, tp && tp.total]))
  const stlNote = noteOf(dA, /short.term loans/i)
  ok('its note lists the ledger under Advance to Suppliers', stlNote && stlNote.rows.some(r => /Supplier Adv 1/.test(r.name || '') && /advance to suppliers/i.test(r.mapping3_resultant || r.level3 || '')), JSON.stringify(stlNote && stlNote.rows.map(r => [r.name, r.mapping3_resultant])))
  ok('the Balance Sheet still balances', Math.abs(dA.totalEL - dA.totalAssets) < 0.5, `${dA.totalEL} vs ${dA.totalAssets}`)

  console.log('\n2. Current maturities of long-term borrowings -> Short-term borrowings (not Other current liabilities)')
  await setLTB(tbA.id)
  await ipc('noteDetails:save', { tbId: tbA.id, noteNum: 1, noteTitle: 'Long-term borrowings', data: { loans: [{ lender: 'HDFC', grossCY: 300000, grossPY: 300000, currentMaturityCY: 50000, currentMaturityPY: 30000 }] } })
  const dB = await B.fetchFinancialsData(tbA, null, entA, rs)
  const ltb = lineOf(dB.elSections, /long.term borrow/i), stb = lineOf(dB.elSections, /short.term borrow/i), ocl = lineOf(dB.elSections, /other current liabilit/i)
  ok('Long-term borrowings is net of the current maturities (3,00,000 - 50,000)', ltb && Math.abs(ltb.total - 250000) < 0.5, JSON.stringify(ltb && ltb.total))
  ok('Short-term borrowings = the 80,000 cash credit + 50,000 current maturities = 1,30,000 (Previous Year takes the 30,000)', stb && Math.abs(stb.total - 130000) < 0.5 && Math.abs(stb.prevTotal - (80000 + 30000)) < 0.5, JSON.stringify(stb && [stb.total, stb.prevTotal]))
  ok('Other current liabilities does not carry it any more', !ocl || Math.abs(ocl.total) < 0.5, JSON.stringify(ocl && ocl.total))
  const stbNote = noteOf(dB, /^short.term borrowings$/i)
  const cmRow = stbNote && stbNote.rows.find(r => r.injected === 'current-maturities')
  ok('the Short-term borrowings note has it as its own sub head, Current maturities of long-term borrowings, 50,000', cmRow && /current maturities of long-term borrowings/i.test(cmRow.mapping3_resultant || '') && Math.abs(cmRow.closing_balance - 50000) < 0.5 && stbNote && Math.abs(stbNote.total - 130000) < 0.5, JSON.stringify(cmRow))
  ok('...and no Other current liabilities note carries a Current maturities row', !Object.values(dB.notes || {}).some(n => !n.isPL && /other current liabilit/i.test(n.title || '') && (n.rows || []).some(r => r.injected === 'current-maturities')))
  ok('the Balance Sheet still balances', Math.abs(dB.totalEL - dB.totalAssets) < 0.5, `${dB.totalEL} vs ${dB.totalAssets}`)
  const ltbNote = noteOf(dB, /long.term borrow/i)
  const lessRow = ltbNote && (ltbNote.templateRows || []).find(r => r.isCmDeduction)
  ok('the Long-term borrowings note has a "Less: Current maturities" line (-50,000 / -30,000) so its lines add up to its total', lessRow && Math.abs(lessRow.cy + 50000) < 0.5 && Math.abs(lessRow.py + 30000) < 0.5, JSON.stringify(lessRow))
  const pdf = B.buildFinancialsHTML({ entity: entA, activeTB: tbA, prevTB: null, data: dB, auditor: null, signatories: [], signPlace: 'X', signDate: '2026-09-30' }).replace(/<template[\s\S]*?<\/template>/g, '')
  ok('PDF: the sub head prints under Short-term borrowings', /Current maturities of long-term borrowings/i.test(pdf))
  const wbX = B.buildFinancialsWorkbook({ entity: entA, activeTB: tbA, prevTB: null, data: dB, levelFormat: [], auditor: null, signatories: [], signPlace: 'X', signDate: '2026-09-30' })
  ok('Excel: its own link check finds nothing to repair (the Long-term borrowings note total now agrees with the Balance Sheet)', Array.isArray(wbX.linkRepairs) && wbX.linkRepairs.length === 0, JSON.stringify(wbX.linkRepairs))
  const bsWs = wbX.Sheets['Balance Sheet']
  const stbCell = Object.keys(bsWs).find(k => /^A\d+$/.test(k) && /^\s*\(?[a-z]?\)?\s*Short-term borrowings/i.test(String(bsWs[k].v || '')))
  const notesWs = wbX.Sheets['Notes'] || {}
  const stbNotesRow = Object.keys(notesWs).find(k => /^A\d+$/.test(k) && /^Note \d+: Short-term borrowings/i.test(String(notesWs[k].v || '')))
  const cmCell = Object.keys(notesWs).find(k => /^A\d+$/.test(k) && stbNotesRow && Number(k.slice(1)) > Number(stbNotesRow.slice(1)) && /^\s*current maturities of long-term borrowings/i.test(String(notesWs[k].v || '')))
  ok('Excel: the Short-term borrowings note lists Current maturities of long-term borrowings under the note (below its heading), and the Balance Sheet line links to the note', !!cmCell && !!stbNotesRow && !!(bsWs['C' + (stbCell || 'A0').slice(1)] || {}).f, JSON.stringify([cmCell, stbNotesRow]))

  const entC = await mkEntity('ZZ Reclass C'), epC = await mkPeriod(entC.id, '2025-26', '2025-04-01', '2026-03-31')
  const tbC = await upload(entC, epC, '2025-26', books({ cashCredit: false, advances: [] }), 'c.xlsx')
  await setLTB(tbC.id)
  await ipc('noteDetails:save', { tbId: tbC.id, noteNum: 1, noteTitle: 'Long-term borrowings', data: { loans: [{ lender: 'HDFC', grossCY: 300000, grossPY: 0, currentMaturityCY: 50000, currentMaturityPY: 0 }] } })
  const dC = await B.fetchFinancialsData(tbC, null, entC, rs)
  const stbC = lineOf(dC.elSections, /short.term borrow/i), noteC = noteOf(dC, /^short.term borrowings$/i)
  ok('no Short-term borrowings in the Trial Balance: a Short-term borrowings line and note are created for the 50,000, and the Balance Sheet balances', stbC && Math.abs(stbC.total - 50000) < 0.5 && noteC && Math.abs(noteC.total - 50000) < 0.5 && Math.abs(dC.totalEL - dC.totalAssets) < 0.5, JSON.stringify([stbC && stbC.total, noteC && noteC.total, dC.totalEL, dC.totalAssets]))
  const dNo = await B.fetchFinancialsData(tbC, null, entC, rs)
  void dNo

  console.log('\n3. Ledgers already mapped to the old place are moved once, except decisions and locked years')
  const entM = await mkEntity('ZZ Reclass M'), epM = await mkPeriod(entM.id, '2025-26', '2025-04-01', '2026-03-31')
  const entL = await mkEntity('ZZ Reclass L'), epL = await mkPeriod(entL.id, '2025-26', '2025-04-01', '2026-03-31')
  const tbM = await upload(entM, epM, '2025-26', books({ advances: [1000, 2000, 3000] }), 'm.xlsx')
  const tbL = await upload(entL, epL, '2025-26', books({ advances: [4000] }), 'l.xlsx')
  const old = (id) => query(`UPDATE mapped_tb SET mapping2_resultant='Other current assets', mapping3_resultant='Advance to Suppliers' WHERE id=$1`, [id])
  const mM = (await mappedOf(tbM.id)).filter(m => /Supplier Adv/.test(m.name)), mL = (await mappedOf(tbL.id)).filter(m => /Supplier Adv/.test(m.name))
  for (const m of [...mM, ...mL]) await old(m.id)
  await query(`UPDATE mapped_tb SET status='user_override' WHERE id=$1`, [mM[1].id])
  await query(`UPDATE mapped_tb SET hand_fixed=TRUE WHERE id=$1`, [mM[2].id])
  await query(`UPDATE entity_periods SET locked=TRUE WHERE id=$1`, [epL])
  await query(`DELETE FROM schema_migrations WHERE key='advance_to_suppliers_to_short_term_loans_once'`)
  await ensureSchema()
  const after = async (id) => (await one(`SELECT mapping2_resultant, mapping3_resultant, level_format_id FROM mapped_tb WHERE id=$1`, [id]))
  const a0 = await after(mM[0].id), a1 = await after(mM[1].id), a2 = await after(mM[2].id), aL = await after(mL[0].id)
  ok('the one the system had moved is moved to Short-term loans and advances, with its Level Format link', a0.mapping2_resultant === 'Short-term loans and advances' && a0.mapping3_resultant === 'Advance to Suppliers' && !!a0.level_format_id, JSON.stringify(a0))
  ok('a ledger the CA decided (user_override) stays where it is', a1.mapping2_resultant === 'Other current assets', JSON.stringify(a1))
  ok('a ledger fixed by hand stays where it is', a2.mapping2_resultant === 'Other current assets', JSON.stringify(a2))
  ok('a locked Financial Year is not touched', aL.mapping2_resultant === 'Other current assets', JSON.stringify(aL))
  await old(mM[0].id)
  await ensureSchema()
  ok('it runs once: a later start moves nothing', (await after(mM[0].id)).mapping2_resultant === 'Other current assets')

  console.log('\n4. The screens and wording')
  const ann = fs.readFileSync(path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'Annexures', 'index.jsx'), 'utf8')
  const ltbForm = fs.readFileSync(path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'Notes', 'LongTermBorrowingsForm.jsx'), 'utf8')
  ok('the Trade Payables reconciliation (Annexures) finds the reclassified ledgers in Short-term loans and advances', /stlNote/.test(ann) && /Short-term Loans and Advances \(Advance to Suppliers\)/.test(ann))
  // The Level Format is the order of the Balance Sheet face: a sub head added by a patch must not drag "Current assets" / "Current
  // liabilities" ahead of the Non-current ones (sort_order 0 did exactly that, on screen and in the PDF).
  const faceOrderOk = async () => {
    const bad = []
    for (const c of [1, 2, 3]) {
      const lf = (await query(`SELECT level1 FROM level_format WHERE rule_set_id = $1 AND constitution = $2 ORDER BY sort_order, id`, [rs, c])).rows.map(r => String(r.level1 || '').toLowerCase().replace(/[\s-]+/g, ' ').trim())
      const first = (re) => lf.findIndex(x => re.test(x))
      const nca = first(/^non current assets/), ca = first(/^current assets/), ncl = first(/^non current liabilities/), cl = first(/^current liabilities/)
      if (nca >= 0 && ca >= 0 && nca > ca) bad.push(`const ${c}: Current assets (${ca}) before Non-current assets (${nca})`)
      if (ncl >= 0 && cl >= 0 && ncl > cl) bad.push(`const ${c}: Current liabilities (${cl}) before Non-current liabilities (${ncl})`)
    }
    return bad
  }
  const badNow = await faceOrderOk()
  ok('Balance Sheet face: Non-current assets / liabilities come before Current ones in every constitution', badNow.length === 0, badNow.join('; '))
  const zero = (await one(`SELECT count(*)::int AS n FROM level_format WHERE level3 IN ('Advance to Suppliers','Advance from Customers') AND sort_order = 0`)).n
  ok('the sub heads added by patches carry their siblings\' position, not 0', zero === 0, String(zero))
  // a database patched by an earlier build has them at 0: the next start-up puts them right
  await query(`UPDATE level_format SET sort_order = 0 WHERE level3 IN ('Advance to Suppliers','Advance from Customers')`)
  const badBefore = await faceOrderOk()
  await ensureSchema()
  const badAfter = await faceOrderOk()
  ok('...and the order damaged by an earlier build is repaired at the next start-up', badBefore.length > 0 && badAfter.length === 0, JSON.stringify([badBefore, badAfter]))
  ok('the Long-term borrowings form says the current maturities go to Short-term borrowings', /→ Short-term Borrowings/.test(ltbForm) && !/→ Other Current Liabilities/.test(ltbForm))

} catch (e) {
  ok('harness ran', false, e.stack || e.message)
} finally {
  process.chdir(root)
  cleanup()
  fs.rmSync(xlsxShim, { force: true })
}
finish()
process.exit(fails ? 1 : 0)
