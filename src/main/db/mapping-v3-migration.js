import { query, runInTransaction } from './client.js'
import { tryClaimMigration } from './schema.js'

// ── Carry-over of existing categorisations to the revised Mapping_v2.xlsx ────
// The 8 Sep 2026 workbook review renamed captions (one spelling per concept,
// Sch III wording, the 2021 amendment) and removed the terminal rows of Level 1s
// that had also become parents. Rows already categorised under the OLD text
// would otherwise show as uncategorised until re-saved. Generic renames are
// exact-text, per constitution, applied in order (some chain).
//   [constitution, field, old, new]
export const GENERIC_RENAMES = [
  [1, "mapping3_resultant", "Long term/current maturitites of finance lease obligation", "Long-term maturities of finance lease obligations"],
  [2, "mapping3_resultant", "Long term/current maturitites of finance lease obligation", "Long-term maturities of finance lease obligations"],
  [2, "mapping3_resultant", "Capital work in progess", "Capital work-in-progress"],
  [1, "mapping3_resultant", "Capital work-in-Progress", "Capital work-in-progress"],
  [3, "mapping3_resultant", "Capital work-in-Progress", "Capital work-in-progress"],
  [2, "mapping3_resultant", "Intangible asset under development", "Intangible assets under development"],
  [1, "mapping2_resultant", "Uncategorised Non-Curent Assets", "Uncategorised Non-current assets"],
  [1, "mapping3_resultant", "Provision for employee benefits.", "Provision for employee benefits"],
  [2, "mapping3_resultant", "Other loans advances", "Other loans and advances"],
  [2, "mapping3_resultant", "Investments property", "Investment property"],
  [2, "mapping3_resultant", "Investments in partnership firm", "Investments in partnership firms"],
  [3, "mapping3_resultant", "Loans and advances to related parties (giving details thereof)", "Loans and advances to related parties"],
  [2, "mapping3_resultant", "Loans advances to partners or relative of partners", "Loans and advances to partners and their relatives"],
  [2, "mapping2_resultant", "Rent, Rates and taxes, excluding, taxes on income", "Rates and taxes, excluding, taxes on income"],
  [1, "mapping1_resultant", "Non-Current liabilities", "Non-current liabilities"],
  [1, "mapping2_resultant", "Uncategorised Non-Current liabilities", "Uncategorised Non-current liabilities"],
  [1, "mapping1_resultant", "Non-Current Assets", "Non-current assets"],
  [1, "mapping2_resultant", "Other long term liabilities", "Other long-term liabilities"],
  [1, "mapping3_resultant", "Uncategorised Other long term liabilities", "Uncategorised Other long-term liabilities"],
  [1, "mapping2_resultant", "Other non-current Assets", "Other non-current assets"],
  [1, "mapping3_resultant", "Uncategorised Other non-current Assets", "Uncategorised Other non-current assets"],
  [1, "mapping2_resultant", "Property, Plant & Equipment and Intangible Assets", "Property, Plant and Equipment and Intangible assets"],
  [1, "mapping3_resultant", "Uncategorised Property, Plant & Equipment and Intangible Assets", "Uncategorised Property, Plant and Equipment and Intangible assets"],
  [1, "mapping1_resultant", "Depreciation & Amortisation Expenses", "Depreciation and amortization expense"],
  [1, "mapping3_resultant", "Property, Plant & Equipment", "Property, plant and equipment"],
  [1, "mapping2_resultant", "Salary & Wages", "Salaries and wages"],
  [3, "mapping1_resultant", "Non-Current liabilities", "Non-current liabilities"],
  [3, "mapping2_resultant", "Uncategorised Non-Current liabilities", "Uncategorised Non-current liabilities"],
  [3, "mapping1_resultant", "Non-Current Assets", "Non-current assets"],
  [3, "mapping2_resultant", "Uncategorised Non-Current Assets", "Uncategorised Non-current assets"],
  [3, "mapping2_resultant", "Other long term liabilities", "Other long-term liabilities"],
  [3, "mapping3_resultant", "Uncategorised Other long term liabilities", "Uncategorised Other long-term liabilities"],
  [3, "mapping2_resultant", "Other non-current Assets", "Other non-current assets"],
  [3, "mapping3_resultant", "Uncategorised Other non-current Assets", "Uncategorised Other non-current assets"],
  [3, "mapping2_resultant", "Property, Plant & Equipment and Intangible Assets", "Property, Plant and Equipment and Intangible assets"],
  [3, "mapping3_resultant", "Uncategorised Property, Plant & Equipment and Intangible Assets", "Uncategorised Property, Plant and Equipment and Intangible assets"],
  [3, "mapping1_resultant", "Depreciation & Amortisation Expenses", "Depreciation and amortization expense"],
  [3, "mapping2_resultant", "Salary & Wages", "Salaries and wages"],
  [3, "mapping1_resultant", "Uncategorised assets", "Uncategorised Assets"],
  [3, "mapping2_resultant", "Uncategorised Income", "Uncategorised Other income"],
  [3, "mapping2_resultant", "Uncategorised Expenses", "Uncategorised Other expenses"],
  [1, "mapping2_resultant", "Uncategorised Other Expenses", "Uncategorised Other expenses"],
  [1, "mapping2_resultant", "Uncategorised Revenue from Operations", "Uncategorised Revenue from operations"],
  [2, "mapping2_resultant", "Uncategorised current assets", "Uncategorised Current assets"],
  [1, "mapping3_resultant", "Uncategorised Non Current Investments", "Uncategorised Non-current investments"],
  [2, "mapping2_resultant", "Long Term Loans and Advances", "Long-term loans and advances"],
  [2, "mapping3_resultant", "Uncategorised Long Term Loans and Advances", "Uncategorised Long-term loans and advances"],
  [2, "mapping2_resultant", "Short Term Loans and Advances", "Short-term loans and advances"],
  [2, "mapping3_resultant", "Uncategorised Short Term Loans and Advances", "Uncategorised Short-term loans and advances"],
  [2, "mapping1_resultant", "Other Income", "Other income"],
  [2, "mapping2_resultant", "Uncategorised Other Income", "Uncategorised Other income"],
  [2, "mapping2_resultant", "Interest income", "Interest Income"],
  [2, "mapping2_resultant", "Dividend income", "Dividend Income"],
  [2, "mapping1_resultant", "Finance costs", "Finance Costs"],
  [2, "mapping2_resultant", "Uncategorised Finance costs", "Uncategorised Finance Costs"],
  [2, "mapping1_resultant", "Cost of goods sold", "Cost of materials consumed"],
  [2, "mapping1_resultant", "Purchases of stock-in-trade", "Purchases of Stock-in-Trade"],
  [2, "mapping1_resultant", "Changes in inventories of finished goods, work in progress and stock-in trade", "Changes in inventories of finished goods, Work-in-progress and Stock-in-Trade"],
  [2, "mapping2_resultant", "Uncategorised Changes in inventories of finished goods, work in progress and stock-in trade", "Uncategorised Changes in inventories of finished goods, Work-in-progress and Stock-in-Trade"],
  [1, "mapping1_resultant", "Changes in inventories of finished goods, Work-in-progress and Stock in Trade", "Changes in inventories of finished goods, Work-in-progress and Stock-in-Trade"],
  [2, "mapping2_resultant", "Other non-operating income (Please specify)", "Other non-operating income"],
  [2, "mapping2_resultant", "Net gain on sale of investments", "Net gain/loss on sale of investments"],
  [2, "mapping2_resultant", "Other operating revenue", "Other operating revenues"],
  [2, "mapping2_resultant", "Uncategorised Partner's Fund", "Uncategorised Partners' Funds"],
  [1, "mapping3_resultant", "Uncategorised Reserves & Surplus", "Uncategorised Reserves and surplus"],
  [2, "mapping3_resultant", "Uncategorised Reserves & Surplus", "Uncategorised Reserves and surplus"],
  [3, "mapping3_resultant", "Uncategorised Reserves & Surplus", "Uncategorised Reserves and surplus"],
  [1, "mapping2_resultant", "Uncategorised Other Income", "Uncategorised Other income"],
  [1, "mapping2_resultant", "Interest expense (other than interest on partners' capital/member' capital)", "Interest expense"],
  [1, "mapping2_resultant", "Interest on partners' capital/member' capital", "Interest on owner's capital"],
  [2, "mapping2_resultant", "Travelling expenses", "Travelling and conveyance"],
  [2, "mapping2_resultant", "Provision for doubtful debts", "Provision for doubtful debts and advances"],
  [2, "mapping2_resultant", "Loss on sale of Property, Plant and Equipment", "Loss on sale of property, plant and equipment"],
  [2, "mapping2_resultant", "Uncategorised Changes in inventories of finished goods, Work-in-progress and Stock-in-Trade", "Uncategorised Inventory"],
  [2, "mapping3_resultant", "Uncategorised Other Current liabilities", "Uncategorised Other current liabilities"],
]

// Context-dependent renames: the same old text meant different things under
// different parents, so each carries the extra condition that disambiguates it.
//   [constitution, field, old, new, { m1, m2, m3 }]  (extra equality conditions)
const CONTEXT_RENAMES = [
  [1, 'mapping2_resultant', 'Misc Expenses', 'Miscellaneous expenses', { m1: 'Other expenses' }],
  [1, 'mapping2_resultant', 'Misc Expenses', 'Exceptional items',      { m1: 'Exceptional items' }],
  [1, 'mapping2_resultant', 'Misc Expenses', 'Extraordinary items',    { m1: 'Extraordinary items' }],
  [3, 'mapping2_resultant', 'Misc Expenses', 'Miscellaneous expenses', { m1: 'Other expenses' }],
  [3, 'mapping2_resultant', 'Misc Expenses', 'Exceptional items',      { m1: 'Exceptional items' }],
  [3, 'mapping2_resultant', 'Misc Expenses', 'Extraordinary items',    { m1: 'Extraordinary items' }],
  // Sch III 2021: current maturities moved from Other current liabilities to Short-term borrowings
  [1, 'mapping3_resultant', 'Current maturities of long-term debt', 'Current maturities of long-term borrowings', { m2: 'Other current liabilities' }],
  [3, 'mapping3_resultant', 'Current maturities of long-term debt', 'Current maturities of long-term borrowings', { m2: 'Other current liabilities' }],
  [1, 'mapping2_resultant', 'Other current liabilities', 'Short-term borrowings', { m3: 'Current maturities of long-term borrowings' }],
  [1, 'mapping2_resultant', 'Other current liabilities', 'Short-term borrowings', { m3: 'Current maturities of finance lease obligations' }],
  [2, 'mapping2_resultant', 'Other current liabilities', 'Short-term borrowings', { m3: 'Current maturities of finance lease obligations' }],
  [3, 'mapping2_resultant', 'Other current liabilities', 'Short-term borrowings', { m3: 'Current maturities of long-term borrowings' }],
  [3, 'mapping2_resultant', 'Other current liabilities', 'Short-term borrowings', { m3: 'Current maturities of finance lease obligations' }],
  [2, 'mapping3_resultant', 'Term loans', 'Current maturities of long-term borrowings', { m2: 'Short-term borrowings' }],
  [2, 'mapping2_resultant', 'Other non-current assets', 'Long-term loans and advances', { m3: 'Security Deposits' }],
  [2, 'mapping3_resultant', 'Tangible Assets',   'Depreciation on Property, Plant and Equipment', { m1: 'Depreciation and amortization expense' }],
  [2, 'mapping3_resultant', 'Intangible Assets', 'Amortisation of Intangible Assets',            { m1: 'Depreciation and amortization expense' }],
  // Level 1s that were BOTH terminal and a parent lost their terminal row (the
  // 0.1.10 rectification-queue trap, removed at source). Rows saved at the
  // terminal level move to the Level 2 that a plain ledger of that kind means.
  [3, 'mapping2_resultant', null, 'Interest expense',                       { m1: 'Finance Costs' }],
  [3, 'mapping2_resultant', 'Finance Costs', 'Interest expense',            { m1: 'Finance Costs' }],
  [1, 'mapping2_resultant', null, 'Depreciation and amortization expense',  { m1: 'Depreciation and amortization expense' }],
  [3, 'mapping2_resultant', null, 'Depreciation and amortization expense',  { m1: 'Depreciation and amortization expense' }],
  [3, 'mapping2_resultant', 'Depreciation & Amortisation Expenses', 'Depreciation and amortization expense', { m1: 'Depreciation and amortization expense' }],
]

const FIELD = { m1: 'mapping1_resultant', m2: 'mapping2_resultant', m3: 'mapping3_resultant' }

async function applyRename(table, c, field, oldVal, newVal, ctx = {}) {
  const params = [newVal, c]
  const where = [`e.constitution = $2`]
  if (oldVal === null) where.push(`t.${field} IS NULL`)
  else { params.push(oldVal); where.push(`t.${field} = $${params.length}`) }
  for (const [k, v] of Object.entries(ctx)) { params.push(v); where.push(`t.${FIELD[k]} = $${params.length}`) }
  const join = table === 'mapped_tb'
    ? `FROM trial_balances tb JOIN entities e ON e.id = tb.entity_id WHERE t.tb_id = tb.id AND `
    : `FROM entities e WHERE t.entity_id = e.id AND `
  const { rowCount } = await query(`UPDATE ${table} t SET ${field} = $1 ${join}${where.join(' AND ')}`, params)
  return rowCount
}

/**
 * One-time carry-over of existing categorisations to the Mapping_v2.xlsx
 * captions introduced on 8 Sep 2026 (the "v3" review). Runs AFTER
 * seedDefaultMapping(), only once the seeded default rule set actually IS the
 * new file (detected by a caption that only exists there), and claims a
 * schema_migrations key so no client repeats it. DML only — no table or
 * column is added, dropped or renamed.
 */
export async function migrateMappingV3Captions() {
  const { rows: rs } = await query(`SELECT id FROM mapping_rule_sets WHERE is_default = TRUE LIMIT 1`)
  if (!rs.length) return
  const rsId = rs[0].id
  const { rows: probe } = await query(
    `SELECT 1 FROM level_format WHERE rule_set_id = $1 AND level3 = 'Statutory dues payable' LIMIT 1`, [rsId])
  if (!probe.length) return                       // old workbook still seeded — nothing to migrate yet
  if (!(await tryClaimMigration('mapping_v3_captions'))) return

  let n = 0
  await runInTransaction(async () => {
    for (const table of ['mapped_tb', 'learned_ledger_rules']) {
      for (const [c, field, o, nw] of GENERIC_RENAMES) n += await applyRename(table, c, field, o, nw)
      for (const [c, field, o, nw, ctx] of CONTEXT_RENAMES) n += await applyRename(table, c, field, o, nw, ctx)
    }
    // Re-resolve the format row for EVERY row of the default rule set from the
    // (now renamed) captions — the old ids point at rows the reseed deleted.
    await query(`UPDATE mapped_tb SET level_format_id = NULL WHERE rule_set_id = $1`, [rsId])
    await query(`
      UPDATE mapped_tb mt SET level_format_id = (
        SELECT lf.id FROM level_format lf
        WHERE lf.rule_set_id = mt.rule_set_id
          AND LOWER(TRIM(REPLACE(lf.level1, '(specify nature)', ''))) = LOWER(TRIM(REPLACE(mt.mapping1_resultant, '(specify nature)', '')))
          AND (
            (mt.mapping2_resultant IS NULL AND lf.level2 IS NULL)
            OR (mt.mapping2_resultant IS NOT NULL AND lf.level2 IS NOT NULL
                AND LOWER(TRIM(REPLACE(lf.level2, '(specify nature)', ''))) = LOWER(TRIM(REPLACE(mt.mapping2_resultant, '(specify nature)', ''))))
          )
        ORDER BY
          CASE WHEN mt.mapping3_resultant IS NOT NULL AND lf.level3 IS NOT NULL
                    AND LOWER(TRIM(REPLACE(lf.level3, '(specify nature)', ''))) = LOWER(TRIM(REPLACE(mt.mapping3_resultant, '(specify nature)', ''))) THEN 0
               WHEN lf.level3 IS NULL THEN 1
               ELSE 2 END,
          lf.id
        LIMIT 1
      )
      WHERE mt.rule_set_id = $1 AND mt.mapping1_resultant IS NOT NULL
    `, [rsId])
  })
  console.log(`Mapping v3 caption migration: ${n} row updates applied, level_format_id re-resolved for rule set ${rsId}`)
}

/**
 * Second pass (separate key, so databases that already ran the first pass
 * still get it): captions the first pass could not match because they had
 * been saved truncated or customised before 8 Sep 2026.
 */
export async function migrateMappingV3CaptionsPass2() {
  const { rows: rs } = await query(`SELECT id FROM mapping_rule_sets WHERE is_default = TRUE LIMIT 1`)
  if (!rs.length) return
  const { rows: probe } = await query(`SELECT 1 FROM level_format WHERE rule_set_id = $1 AND level3 = 'Statutory dues payable' LIMIT 1`, [rs[0].id])
  if (!probe.length) return
  if (!(await tryClaimMigration('mapping_v3_captions_pass2'))) return
  let n = 0
  await runInTransaction(async () => {
    for (const table of ['mapped_tb', 'learned_ledger_rules']) {
      const join = table === 'mapped_tb'
        ? `FROM trial_balances tb JOIN entities e ON e.id = tb.entity_id WHERE t.tb_id = tb.id AND `
        : `FROM entities e WHERE t.entity_id = e.id AND `
      // constitution 1: truncated / customised finance-cost captions
      n += (await query(`UPDATE ${table} t SET mapping2_resultant = 'Interest expense' ${join} e.constitution = 1 AND t.mapping1_resultant = 'Finance Costs' AND t.mapping2_resultant LIKE 'Interest expense (other than%'`)).rowCount
      n += (await query(`UPDATE ${table} t SET mapping2_resultant = 'Interest on owner''s capital' ${join} e.constitution = 1 AND t.mapping1_resultant = 'Finance Costs' AND t.mapping2_resultant LIKE 'Interest on partners%'`)).rowCount
      // constitution 2: finance-cost rows saved with no Level 2 (the Level 1 always had children here)
      n += (await query(`UPDATE ${table} t SET mapping2_resultant = (SELECT level2 FROM level_format WHERE rule_set_id = $1 AND constitution = 2 AND level1 = 'Finance Costs' AND level2 LIKE 'Interest expense%' ORDER BY sort_order LIMIT 1) ${join} e.constitution = 2 AND t.mapping1_resultant = 'Finance Costs' AND t.mapping2_resultant IS NULL`, [rs[0].id])).rowCount
    }
    await query(`
      UPDATE mapped_tb mt SET level_format_id = (
        SELECT lf.id FROM level_format lf
        WHERE lf.rule_set_id = mt.rule_set_id
          AND LOWER(TRIM(lf.level1)) = LOWER(TRIM(mt.mapping1_resultant))
          AND lf.level2 IS NOT NULL AND LOWER(TRIM(lf.level2)) = LOWER(TRIM(mt.mapping2_resultant))
        ORDER BY CASE WHEN lf.level3 IS NULL THEN 0 ELSE 1 END, lf.id LIMIT 1)
      WHERE mt.rule_set_id = $1 AND mt.level_format_id IS NULL AND mt.mapping1_resultant = 'Finance Costs' AND mt.mapping2_resultant IS NOT NULL
    `, [rs[0].id])
  })
  console.log(`Mapping v3 caption migration pass 2: ${n} row updates applied`)
}
