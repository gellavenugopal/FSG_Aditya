// REFERENCE ONLY - not used by the app. The Level Format helpers of src/renderer/src/utils/fixTargets.js exactly as they were
// before 0.1.92, when every call scanned the whole Level Format (about 1,500 rows, each caption cleaned with a regular
// expression) once per ledger - minutes of a frozen window for a branch with 67,000 ledgers. The app now indexes the format
// once; tools/selftest-large-branch.mjs checks that the indexed helpers answer EXACTLY as these scanning ones do.
const normCap = (s) => String(s || '').replace(/\s*\(specify nature\)/gi, '').trim().toLowerCase()
const JUST_SPECIFY = /^\s*specify\s+nature\s*$/i
const isUncategorised = (s) => !String(s || '').trim() || /uncategori[sz]ed/i.test(String(s))

/** The Level Format rows a ledger sits on: by its captions; when those lead nowhere (old wording, blank Level 3), by its own level_format_id. */
export function lfRowsFor(levelFormat, row) {
  const lf = levelFormat || []
  const m1 = normCap(row.mapping1_resultant), m2 = normCap(row.mapping2_resultant), m3 = normCap(row.mapping3_resultant)
  let hits = m1 ? lf.filter(l => normCap(l.level1) === m1 && normCap(l.level2) === m2 && normCap(l.level3) === m3) : []
  if (!hits.length && row.level_format_id) {
    const base = lf.find(l => l.id === row.level_format_id)
    if (base) hits = lf.filter(l => normCap(l.level1) === normCap(base.level1) && normCap(l.level2) === normCap(base.level2) && normCap(l.level3) === normCap(base.level3))
  }
  return hits
}

/**
 * Levels 4-7 that apply to this ledger.
 * @returns {Array<{ level:number, key:string, freeText:boolean, options:string[]|null, required:boolean,
 *   fixed:string|null, value:string, ok:boolean, outdated:boolean }>}
 *   required - a choice must be made (more than one option); ok - not required, or the held value is one of the options;
 *   outdated - a value is held but is not one of the options (older wording).
 */
export function natureLevelsFor(levelFormat, row) {
  const rows = lfRowsFor(levelFormat, row)
  if (!rows.length) return []
  const out = []
  for (const level of [4, 5, 6, 7]) {
    const raw = rows.map(r => r['level' + level]).filter(v => v !== null && v !== undefined && String(v).trim() !== '').map(v => String(v).trim())
    if (!raw.length) continue
    const key = `level${level}_value`
    const value = String(row[key] || '').trim()
    if (raw.every(v => JUST_SPECIFY.test(v))) { out.push({ level, key, freeText: true, options: null, required: false, fixed: null, value, ok: true, outdated: false }); continue }
    const options = [...new Set(raw.flatMap(v => v.split('/').map(s => s.trim()).filter(Boolean)).filter(o => !JUST_SPECIFY.test(o)))]
    if (!options.length) continue
    const required = options.length > 1
    const inList = !!value && options.some(o => o.toLowerCase() === value.toLowerCase())
    out.push({ level, key, freeText: false, options, required, fixed: required ? null : options[0], value, ok: !required || inList, outdated: !!value && !inList && required })
  }
  return out
}

const stmtOf = (alie) => {
  const a = String(alie || '').trim()
  return /^(income|expenses)$/i.test(a) ? 'PL' : /^(assets|equity and liabilities)$/i.test(a) ? 'BS' : null
}
/** A Level 2 the format places only on the OTHER statement than the ledger's Level 1 (the statements leave such a heading out). */
function foreignLevel2(lf, row) {
  const m2 = normCap(row.mapping2_resultant)
  if (!m2 || isUncategorised(row.mapping2_resultant)) return false
  const m1 = normCap(row.mapping1_resultant)
  const own = stmtOf(lf.find(l => normCap(l.level1) === m1 && stmtOf(l.alie))?.alie) || stmtOf(row.alie)
  if (!own) return false
  const l2Rows = lf.filter(l => normCap(l.level2) === m2 && stmtOf(l.alie))
  return l2Rows.length > 0 && !l2Rows.some(l => stmtOf(l.alie) === own)
}

/**
 * Bulk "Level 4-7 only" on the Recategorisation screen: for the ticked ledgers,
 * every Level 4-7 that at least one of them must choose (or specify), with the
 * options valid for EVERY ledger it applies to, and those ledgers' ids. Setting
 * a level this way leaves each ledger's Mapping 1/2/3 and its other levels as
 * they are — the ticked ledgers may sit under different Level 3 lines (e.g. all
 * the loans still missing Secured / Unsecured), which the Mapping 1-3 bulk bar
 * cannot handle without overwriting their lines.
 *   [{ level, key, freeText, options, ids, missing }]  — missing: how many of
 *   ids have no valid value yet (the ones shown red).
 */
export function bulkNaturePlan(levelFormat, rows) {
  const plan = []
  for (const level of [4, 5, 6, 7]) {
    const hits = []
    for (const r of rows || []) {
      const n = natureLevelsFor(levelFormat, r).find(x => x.level === level)
      if (n && (n.required || n.freeText)) hits.push({ id: r.id, n })
    }
    if (!hits.length) continue
    const choose = hits.filter(h => !h.n.freeText)
    const freeText = choose.length === 0
    const target = freeText ? hits : choose
    const lc = (s) => String(s).toLowerCase()
    const options = freeText ? null
      : choose[0].n.options.filter(o => choose.every(h => h.n.options.some(x => lc(x) === lc(o))))
    plan.push({ level, key: `level${level}_value`, freeText, options, ids: target.map(h => h.id), missing: target.filter(h => !h.n.ok || (freeText && !h.n.value)).length })
  }
  return plan
}

/** What is still missing for a ledger, in words: [{ what: 'Mapping 2' | 'Level 5' ..., hint? }] - empty when it is complete. */
export function ledgerNeeds(levelFormat, row) {
  const lf = levelFormat || []
  const needs = []
  const m1 = normCap(row.mapping1_resultant)
  if (isUncategorised(row.mapping1_resultant)) {
    needs.push({ what: 'Mapping 1' })
  } else {
    const realL2 = lf.filter(l => normCap(l.level1) === m1 && l.level2 && !/^uncategori[sz]ed/i.test(String(l.level2).trim()))
    if (isUncategorised(row.mapping2_resultant)) {
      if (realL2.length) needs.push({ what: 'Mapping 2' })
    } else {
      const m2 = normCap(row.mapping2_resultant)
      const realL3 = lf.filter(l => normCap(l.level1) === m1 && normCap(l.level2) === m2 && l.level3 && !/^uncategori[sz]ed/i.test(String(l.level3).trim()))
      if (realL3.length && isUncategorised(row.mapping3_resultant)) needs.push({ what: 'Mapping 3' })
    }
  }
  for (const n of natureLevelsFor(levelFormat, row)) {
    if (n.ok) continue
    const shown = n.options.slice(0, 3).join(' / ') + (n.options.length > 3 ? ' …' : '')
    needs.push({ what: `Level ${n.level}`, hint: n.outdated ? `“${n.value}” is not an option` : `choose ${shown}` })
  }
  if (foreignLevel2(lf, row)) needs.push({ what: 'Mapping 2', hint: 'belongs to the other statement' })
  if (/^(discrepancy|conflict)$/i.test(String(row.status || ''))) needs.push({ what: 'Engine review', hint: 'more than one possible match — pick the right one' })
  return needs
}

/**
 * Nothing left to do for this ledger: no missing Mapping / Level 4-7, no engine flag, no "Uncategorised ..." caption.
 * The default Recategorisation list never shows such a ledger, whatever the database query listed.
 */
export function isComplete(levelFormat, row) {
  if (/uncategori[sz]ed/i.test([row.mapping1_resultant, row.mapping2_resultant, row.mapping3_resultant].join(' '))) return false
  return ledgerNeeds(levelFormat, row).length === 0
}
