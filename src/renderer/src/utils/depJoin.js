// ── Joining branches' own Dep (IT) / Dep (Comp) schedules for "Pull from
// Branches" (Consolidated only — see components/DepreciationIT/index.jsx and
// DepreciationComp/index.jsx) ────────────────────────────────────────────
// Pure, framework-free arithmetic, kept out of the React components so it is
// unit-testable without a DOM — these figures feed straight into the PPE
// note, so getting the sums right matters more than convenience.
const num = v => parseFloat(String(v ?? '').replace(/,/g, '')) || 0

/**
 * Sums every branch's own asset rows block-by-block. Dep (IT) computes
 * Depreciation/Closing WDV/STCL from a block's raw openingWDV/additions/
 * deduction (see computeBlockTotals in DepreciationIT/index.jsx) — this only
 * sums those raw inputs; the caller re-runs the normal rate/STCL computation
 * over the joined totals, so nothing here duplicates that math.
 * @param {Array<{rows?: Record<string, {block:string, openingWDV, addBefore180, addAfter180, deduction}>, pyTotals?: object}|null>} branchSchedules
 * @param {string[]} pyFields
 * @returns {{ byBlock: Map<string, {openingWDV:number, addBefore180:number, addAfter180:number, deduction:number}>, pyAgg: object|null }}
 */
export function joinDepITSchedules(branchSchedules, pyFields) {
  const byBlock = new Map()
  let pyAgg = null
  for (const saved of branchSchedules || []) {
    if (!saved) continue
    for (const row of Object.values(saved.rows || {})) {
      if (!row?.block) continue
      if (!byBlock.has(row.block)) byBlock.set(row.block, { openingWDV: 0, addBefore180: 0, addAfter180: 0, deduction: 0 })
      const agg = byBlock.get(row.block)
      agg.openingWDV += num(row.openingWDV)
      agg.addBefore180 += num(row.addBefore180)
      agg.addAfter180 += num(row.addAfter180)
      agg.deduction += num(row.deduction)
    }
    if (saved.pyTotals) {
      if (!pyAgg) pyAgg = Object.fromEntries(pyFields.map(f => [f, 0]))
      for (const f of pyFields) pyAgg[f] = num(pyAgg[f]) + num(saved.pyTotals[f])
    }
  }
  if (pyAgg) for (const f of pyFields) pyAgg[f] = String(pyAgg[f])
  return { byBlock, pyAgg }
}

/**
 * Sums every branch's own category rows, matched by Asset Category name
 * (trimmed, case-insensitive — Dep (Comp) has no stable block-id equivalent,
 * only free text, unlike Dep (IT)'s entity-scoped block ids). Every Dep
 * (Comp) figure is plain typed input (no rate/formula), so this sum IS the
 * joined figure — nothing further to recompute.
 * @param {Array<{categoryRows?: Array<{category:string}&Record<string, any>>, pyTotals?: object}|null>} branchSchedules
 * @param {string[]} categoryFields
 * @param {string[]} pyFields
 * @returns {{ byCategory: Map<string, {category:string}&Record<string, number>>, pyAgg: object|null }}
 */
export function joinDepCompSchedules(branchSchedules, categoryFields, pyFields) {
  const byCategory = new Map()
  let pyAgg = null
  for (const saved of branchSchedules || []) {
    if (!saved) continue
    for (const row of (saved.categoryRows || [])) {
      const key = (row?.category || '').trim().toLowerCase()
      if (!key) continue
      if (!byCategory.has(key)) byCategory.set(key, { category: row.category.trim(), ...Object.fromEntries(categoryFields.map(f => [f, 0])) })
      const agg = byCategory.get(key)
      for (const f of categoryFields) agg[f] += num(row[f])
    }
    if (saved.pyTotals) {
      if (!pyAgg) pyAgg = Object.fromEntries(pyFields.map(f => [f, 0]))
      for (const f of pyFields) pyAgg[f] = num(pyAgg[f]) + num(saved.pyTotals[f])
    }
  }
  if (pyAgg) for (const f of pyFields) pyAgg[f] = String(pyAgg[f])
  return { byCategory, pyAgg }
}
