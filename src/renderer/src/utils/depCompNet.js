// Dep (Comp): every closing figure and the Net Block (WDV) are FORMULAS, not typed:
//   Gross Block Closing  = Opening + Additions - Deductions
//   Depreciation Closing = Opening + For Year - On Disposal
//   Net Block Opening    = Gross Block Opening - Depreciation Opening
//   Net Block Closing    = Gross Block Closing - Depreciation Closing
// A row with none of the figures a formula needs (an older save that only typed the result) keeps its typed figure.
const n = (v) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
const has = (v) => String(v ?? '').trim() !== ''
const r2 = (x) => Math.round(x * 100) / 100

export const grossCloseDerived = (r) => !!r && (has(r.grossOpen) || has(r.additions) || has(r.deductions))
export const depCloseDerived   = (r) => !!r && (has(r.depOpen) || has(r.depForYear) || has(r.depOnDisposal))
export const netOpenDerived    = (r) => !!r && (has(r.grossOpen) || has(r.depOpen))
export const netCloseDerived   = (r) => !!r && (grossCloseDerived(r) || depCloseDerived(r) || has(r.grossClose) || has(r.depClose))

export function withNet(r) {
  if (!r) return r
  const out = { ...r }
  if (grossCloseDerived(r)) out.grossClose = String(r2(n(r.grossOpen) + n(r.additions) - n(r.deductions)))
  if (depCloseDerived(r))   out.depClose   = String(r2(n(r.depOpen) + n(r.depForYear) - n(r.depOnDisposal)))
  if (netOpenDerived(r))    out.netBlockOpen  = String(r2(n(r.grossOpen) - n(r.depOpen)))
  if (netCloseDerived(r))   out.netBlockClose = String(r2(n(out.grossClose) - n(out.depClose)))
  return out
}

/** Which field of the Dep (Comp) table is a formula for this row */
export const isDerivedField = (field, r) => (
  (field === 'grossClose' && grossCloseDerived(r)) || (field === 'depClose' && depCloseDerived(r)) ||
  (field === 'netBlockOpen' && netOpenDerived(r)) || (field === 'netBlockClose' && netCloseDerived(r)))
