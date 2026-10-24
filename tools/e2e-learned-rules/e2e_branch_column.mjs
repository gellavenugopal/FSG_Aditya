// Targeted check: recordLearnedRules() stamps source_branch_name from the TB's
// branch_name, and learnedRules:download surfaces it as a 'Branch' column.
// Uses throw-away "ZZ E2E Branch" entities, deleted at the end.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import XLSXpkg from 'xlsx-js-style'
const XLSX = XLSXpkg.default || XLSXpkg
const ROOT = 'C:/Users/Aditya Maheshwari/Desktop/JE_Financial_App'
const { initDB, query } = await import(pathToFileURL(path.join(ROOT, 'src/main/db/client.js')).href)
const { registerTBHandlers } = await import(pathToFileURL(path.join(ROOT, 'src/main/ipc/tb.js')).href)
const { registerMappedTBHandlers } = await import(pathToFileURL(path.join(ROOT, 'src/main/ipc/mapped-tb.js')).href)
await initDB()
registerTBHandlers(); registerMappedTBHandlers()
const ipc = (name, ...args) => globalThis.__ipc[name](null, ...args)

let fails = 0
const check = (what, got, want) => { const ok = got === want; if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}: ${JSON.stringify(got)}${ok ? '' : '  (expected ' + JSON.stringify(want) + ')'}`) }

const { rows: [src] } = await query(`SELECT id, constitution, constitution_display, business_type FROM entities WHERE name = $1`, ['Aditya Maheshwari & Co.'])
const { rows: [rs] } = await query(`SELECT id FROM mapping_rule_sets WHERE is_default LIMIT 1`)

const A = (await query(`INSERT INTO entities (name, constitution, constitution_display, business_type, has_branches) VALUES ($1,$2,$3,$4,TRUE) RETURNING id`,
  ['ZZ E2E Branch', src.constitution, src.constitution_display, src.business_type])).rows[0].id

try {
  const tbRows = [
    { period: '', branch: '', ledger_code: '', name: 'Test Branch Ledger XYZ', opening_balance: 0, debit: 0, credit: 1000, closing_balance: 1000, is_revenue: false, is_deemed_positive: false, trail_balance: 1000, parent: '', group_parent: '', group_parent_1: '', group_parent_2: '', group_parent_3: '', group_parent_4: '', group_parent_5: '', group_parent_6: '', group_parent_7: '' },
  ]
  const up = await ipc('tb:uploadRealBooks', { entityId: A, period: '2025-26', fileName: 'e2e_branch.xlsx', tbRows, branchName: 'Delhi Branch', entityPeriodId: null })
  const tbId = up.tb.id
  check('trial_balances.branch_name stored', up.tb.branch_name, 'Delhi Branch')

  await ipc('mappedTB:run', tbId, rs.id, {})
  const { rows: [mt] } = await query(
    `SELECT mt.id FROM mapped_tb mt JOIN tb_rows tr ON tr.id = mt.tb_row_id WHERE mt.tb_id = $1 AND tr.name = $2`,
    [tbId, 'Test Branch Ledger XYZ'])
  // Force a manual save through the same path recordLearnedRules is called from
  // (bulkSetLevel5, but any single mapping1/2 update handler does) — simplest is
  // to call the internal recordLearnedRules indirectly via mappedTB:setMapping-
  // style handler if present; fall back to mappedTB:run's own recordLearnedRules
  // call for freshly-run (user_approved) rows. Since 'run' auto-approves? Check.
  const { rows: learned } = await query(
    `SELECT source_branch_name FROM learned_ledger_rules WHERE entity_id = $1 AND ledger_name_key = $2`,
    [A, 'test branch ledger xyz'])
  console.log(`  (learned_ledger_rules rows for this ledger: ${learned.length})`)

  // If mappedTB:run alone didn't create a learned row (only saved decisions
  // do), force one the same way a user's save would: approving a row funnels
  // through recordLearnedRules like every other write path.
  if (learned.length === 0 && mt) {
    await ipc('mappedTB:approve', mt.id)
  }
  const { rows: learned2 } = await query(
    `SELECT source_branch_name FROM learned_ledger_rules WHERE entity_id = $1 AND ledger_name_key = $2`,
    [A, 'test branch ledger xyz'])
  check('learned_ledger_rules.source_branch_name recorded', learned2[0]?.source_branch_name, 'Delhi Branch')

  const dl = await ipc('learnedRules:download', A)
  const wb = XLSX.read(dl.buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(ws)
  const row = data.find(r => (r['Ledger Name'] || '').toLowerCase() === 'test branch ledger xyz')
  check('download file has a Branch column with the value', row?.Branch, 'Delhi Branch')

  // Mapped TB Excel download carries the TB's Branch Name on every row too.
  const mtbBuf = await ipc('mappedTB:downloadExcel', tbId)
  const wb2 = XLSX.read(mtbBuf, { type: 'buffer' })
  const ws2 = wb2.Sheets[wb2.SheetNames[0]]
  const data2 = XLSX.utils.sheet_to_json(ws2)
  check('Mapped TB download has Branch Name column', data2[0]?.['Branch Name'], 'Delhi Branch')
} finally {
  await query(`DELETE FROM entities WHERE id = $1`, [A])
  console.log('\ncleanup: 1 throw-away entity deleted')
}
console.log(fails ? `\n${fails} FAILURE(S)` : '\nAll checks passed')
process.exit(fails ? 1 : 0)
