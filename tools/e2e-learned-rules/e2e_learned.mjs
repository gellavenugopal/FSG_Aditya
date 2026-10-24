// End-to-end test of the Learned Ledger Rules cycle through the REAL IPC
// handlers (Electron stubbed). Uses throw-away entities that are deleted at
// the end; the user's own entities are only read.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const ROOT = 'C:/Users/Aditya Maheshwari/Desktop/JE_Financial_App'
const { initDB, query } = await import(pathToFileURL(path.join(ROOT, 'src/main/db/client.js')).href)
const { registerTBHandlers } = await import(pathToFileURL(path.join(ROOT, 'src/main/ipc/tb.js')).href)
const { registerMappedTBHandlers } = await import(pathToFileURL(path.join(ROOT, 'src/main/ipc/mapped-tb.js')).href)
await initDB()
registerTBHandlers(); registerMappedTBHandlers()
const ipc = (name, ...args) => globalThis.__ipc[name](null, ...args)

let fails = 0
const check = (what, got, want) => { const ok = got === want; if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}: ${got}${ok ? '' : '  (expected ' + want + ')'}`) }

const SRC_NAME = 'Aditya Maheshwari & Co.'
const { rows: [src] } = await query(`SELECT id, constitution, constitution_display, business_type FROM entities WHERE name = $1`, [SRC_NAME])
const { rows: [rs] } = await query(`SELECT id FROM mapping_rule_sets WHERE is_default LIMIT 1`)
const { rows: [srcTb] } = await query(`SELECT id FROM trial_balances WHERE entity_id = $1 ORDER BY id DESC LIMIT 1`, [src.id])
const { rows: tbRows } = await query(`SELECT * FROM tb_rows WHERE tb_id = $1 ORDER BY id`, [srcTb.id])
// the source entity's custom rules = the thing that "gets lost"
const { rows: custom } = await query(`
  SELECT lr.ledger_name_key, lr.mapping1_resultant m1, lr.mapping2_resultant m2, lr.mapping3_resultant m3
  FROM learned_ledger_rules lr WHERE lr.entity_id = $1 AND lr.mapping2_resultant IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM level_format lf WHERE lf.rule_set_id = $2 AND lf.constitution = $3 AND lf.level1 = lr.mapping1_resultant AND lf.level2 = lr.mapping2_resultant)`,
  [src.id, rs.id, src.constitution])
const customOnTb = custom.filter(c => tbRows.some(r => (r.name || '').trim().toLowerCase() === c.ledger_name_key))
console.log(`Source: ${SRC_NAME} (c${src.constitution}), TB ${srcTb.id} with ${tbRows.length} ledgers; ${custom.length} custom Level-2 rules, ${customOnTb.length} of them on this TB`)

const mkEntity = async (name) => (await query(`INSERT INTO entities (name, constitution, constitution_display, business_type) VALUES ($1,$2,$3,$4) RETURNING id`, [name, src.constitution, src.constitution_display, src.business_type])).rows[0].id
const uploadTb = async (entityId, tag) => (await ipc('tb:uploadRealBooks', { entityId, period: '2025-26', fileName: `e2e_${tag}.xlsx`, tbRows, branchName: '', entityPeriodId: null })).tb.id
const compare = async (tbId, label) => {
  const { rows } = await query(`SELECT LOWER(TRIM(tr.name)) k, mt.mapping1_resultant m1, mt.mapping2_resultant m2, mt.status, mt.alie, mt.level_format_id FROM mapped_tb mt JOIN tb_rows tr ON tr.id = mt.tb_row_id WHERE mt.tb_id = $1`, [tbId])
  const by = new Map(rows.map(r => [r.k, r]))
  let agree = 0; const wrong = []
  for (const c of customOnTb) { const r = by.get(c.ledger_name_key); if (r && r.m1 === c.m1 && r.m2 === c.m2) agree++; else wrong.push(`${c.ledger_name_key}: expected "${c.m2}", got "${r?.m2 ?? '<no row>'}" [${r?.status}]`) }
  check(`${label}: custom lines intact`, agree, customOnTb.length)
  for (const w of wrong.slice(0, 5)) console.log('        ' + w)
  const noAlie = rows.filter(r => customOnTb.some(c => c.ledger_name_key === r.k) && !r.alie).length
  check(`${label}: custom rows carry an ALIE (visible in P&L)`, noAlie, 0)
  return rows
}

const ids = []
try {
  // ── Scenario 1: same company, "delete old TB and upload new TB" ─────────────
  const A = await mkEntity('ZZ E2E Source'); ids.push(A)
  await query(`INSERT INTO learned_ledger_rules (entity_id, ledger_name_key, ledger_name, mapping1_resultant, mapping2_resultant, mapping3_resultant, level4_value, level5_value, level6_value, level7_value, alie)
               SELECT $1, ledger_name_key, ledger_name, mapping1_resultant, mapping2_resultant, mapping3_resultant, level4_value, level5_value, level6_value, level7_value, alie FROM learned_ledger_rules WHERE entity_id = $2`, [A, src.id])
  const tbA1 = await uploadTb(A, 'A1')
  await ipc('mappedTB:run', tbA1, rs.id, {})
  await compare(tbA1, 'S1a first TB after Auto-Mapping (rules learned earlier)')
  await ipc('tb:delete', tbA1)
  const tbA2 = await uploadTb(A, 'A2')
  const runA2 = await ipc('mappedTB:run', tbA2, rs.id, {})
  console.log(`  (run: ${runA2.total} rows, carriedForward ${runA2.carriedForward})`)
  await compare(tbA2, 'S1b fresh TB after deleting the old one')

  // ── Scenario 2: download from A, upload into ANOTHER company (TB already mapped, default mapping bulk-approved) ──
  const { buffer, count } = await ipc('learnedRules:download', A)
  console.log(`  downloaded ${count} rules (${buffer.length} bytes)`)
  const B = await mkEntity('ZZ E2E Other Co'); ids.push(B)
  const tbB = await uploadTb(B, 'B')
  await ipc('mappedTB:run', tbB, rs.id, {})
  await query(`UPDATE mapped_tb SET status = 'user_approved' WHERE tb_id = $1`, [tbB])      // "approve all" of the engine's defaults
  const up = await ipc('learnedRules:upload', B, Array.from(new Uint8Array(buffer)))
  console.log(`  upload → applied ${up.applied}, skipped ${up.skipped}, tbsTouched ${up.tbsTouched}, unmatched ${up.unmatched.length}, custom captions ${up.customCaptions.length}`)
  await compare(tbB, 'S2a other company right after upload')
  const runB = await ipc('mappedTB:run', tbB, rs.id, {})
  console.log(`  (re-run: carriedForward ${runB.carriedForward})`)
  await compare(tbB, 'S2b other company after Auto-Mapping re-run (sibling-approved defaults present)')

  // ── Scenario 3: upload rules BEFORE the TB is mapped, then Auto-Mapping ──────
  const C = await mkEntity('ZZ E2E Third Co'); ids.push(C)
  const tbC = await uploadTb(C, 'C')
  const upC = await ipc('learnedRules:upload', C, Array.from(new Uint8Array(buffer)))
  console.log(`  upload (unmapped TB) → applied ${upC.applied}, tbsTouched ${upC.tbsTouched}`)
  await ipc('mappedTB:run', tbC, rs.id, {})
  await compare(tbC, 'S3 rules uploaded before first Auto-Mapping')

  // ── Scenario 4: two TBs, second one fresh; an OLDER sibling with approved defaults must not win ──
  const tbC2 = await uploadTb(C, 'C2')
  await query(`UPDATE mapped_tb SET status = 'user_approved', mapping2_resultant = 'Miscellaneous expenses' WHERE tb_id = $1 AND mapping1_resultant = 'Other expenses'`, [tbC])
  await ipc('mappedTB:run', tbC2, rs.id, {})
  await compare(tbC2, 'S4 fresh TB while a sibling TB carries approved default captions')
} finally {
  for (const id of ids) await query(`DELETE FROM entities WHERE id = $1`, [id])
  console.log(`\ncleanup: ${ids.length} throw-away entities deleted`)
}
console.log(fails ? `\n${fails} FAILURE(S)` : '\nAll scenarios passed')
process.exit(fails ? 1 : 0)
