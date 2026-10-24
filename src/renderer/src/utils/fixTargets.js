// "Fix" buttons (Notes, Balance Sheet, P&L) open the Rectification / Recategorisation
// screen. They used to send a FILTER OF CAPTIONS (alie / Level 1 / 2 / 3, "Unclassified"),
// which the screen looked up with exact text matching against the raw mapped_tb columns —
// while Notes and BS work out what is flagged IN MEMORY (level-format-first captions,
// GST-netted ledgers, case-merged captions, Previous Year rows). Any disagreement found
// zero ledgers and the screen said "No exceptions". A Fix now carries the IDENTITY of the
// ledgers behind the flagged line instead:
//   mappedIds    - mapped_tb ids of the Current Year ledgers
//   pyMappedIds  - the same for the Previous Year Trial Balance (a flag that exists only
//                  because of a Previous Year ledger)
// The caption filter is still sent alongside, as the fallback for a flag with no ledger
// behind it (e.g. a row that comes from a depreciation schedule).

const toId = (v) => { const n = Number(v); return v !== null && v !== undefined && v !== '' && Number.isInteger(n) ? n : null }

/** Unique mapped_tb ids of a list of ledger rows (rows carry `mapped_id`). */
export function ledgerIdsOf(rows) {
  const out = []
  const seen = new Set()
  for (const r of rows || []) {
    const id = toId(r && r.mapped_id)
    if (id !== null && !seen.has(id)) { seen.add(id); out.push(id) }
  }
  return out
}

/** filter + the ledgers behind it, by id (empty lists are simply not added); focusLevel = the nature level (4-7) the Fix is about. */
export function fixFilterWithIds(filter, ids, pyIds, focusLevel) {
  const out = { ...filter }
  const cy = (ids || []).map(toId).filter(x => x !== null)
  const py = (pyIds || []).map(toId).filter(x => x !== null)
  if (cy.length) out.mappedIds = cy
  if (py.length) out.pyMappedIds = py
  if (focusLevel) out.focusLevel = focusLevel
  return out
}

/** Same, straight from ledger rows. */
export const fixFilterWith = (filter, rows, pyRows, focusLevel) => fixFilterWithIds(filter, ledgerIdsOf(rows), ledgerIdsOf(pyRows), focusLevel)

/**
 * What the Recategorisation screen should query for a scope filter.
 * @returns {{ idScoped: boolean, ids: number[]|null, filter: object|null }}
 *   idScoped - the scope carries ledger ids; ids - those for the year being shown (may be empty:
 *   nothing to query, not "everything"); filter - the caption filter otherwise.
 */
export function resolveFixScope(scope, categorisePY) {
  if (!scope) return { idScoped: false, ids: null, filter: null }
  const hasIds = (scope.mappedIds && scope.mappedIds.length) || (scope.pyMappedIds && scope.pyMappedIds.length)
  if (hasIds) return { idScoped: true, ids: (categorisePY ? scope.pyMappedIds : scope.mappedIds) || [], filter: null,
    counts: { cy: (scope.mappedIds || []).length, py: (scope.pyMappedIds || []).length } }
  return {
    idScoped: false, ids: null,
    filter: {
      alie: scope.alie, mapping1_resultant: scope.mapping1_resultant,
      mapping2_resultant: scope.mapping2_resultant, mapping3_resultant: scope.mapping3_resultant,
      level5_unclassified: scope.level5_unclassified, level5_value: scope.level5_value,
      uncategorised: scope.uncategorised, level1Pattern: scope.level1Pattern,
    },
  }
}

/** Which year a fresh Fix should open: the Previous Year when that is the only place its ledgers are. */
export function fixOpensPreviousYear(scope, hasPrevTB) {
  if (!scope) return false
  const cy = scope.mappedIds && scope.mappedIds.length
  const py = scope.pyMappedIds && scope.pyMappedIds.length
  return !!(!cy && py && hasPrevTB)
}

// ── What a ledger still needs, from its own Level Format row(s) ─────────────────
// The Level Format gives a ledger, beyond Mapping 1/2/3, up to four more classifications:
//   Level 4  a sub-head           Statutory dues payable -> GST payable / TDS payable / ...
//   Level 5  its nature           Secured / Unsecured / Doubtful, PPE class, "from banks" / "from other parties"
//   Level 6  a second nature      Term loans, Loans repayable on demand -> Secured / Unsecured
//   Level 7  "Specify nature"     free text
// Several Level Format rows can share one Level 3 (Loans repayable on demand has one per Level 5
// value), so a level's options are the union over those siblings.

const normCap = (s) => String(s || '').replace(/\s*\(specify nature\)/gi, '').trim().toLowerCase()
const JUST_SPECIFY = /^\s*specify\s+nature\s*$/i
const isUncategorised = (s) => !String(s || '').trim() || /uncategori[sz]ed/i.test(String(s))

// ── Level Format index ───────────────────────────────────────────────────────────
// Every helper below asks the Level Format the same few questions - which rows carry these Level 1/2/3 captions, does this
// Level 1 have a real Level 2 or Level 3, which statement does this Level 2 sit on - and asks them once per LEDGER. Answered
// by scanning the whole format (about 1,500 rows, each caption cleaned with a regular expression) that is tens of thousands
// of string operations per ledger: nothing for a few hundred ledgers, minutes of a frozen window for a branch with 67,000.
// The format is therefore indexed once per array (the screen keeps one array until it reloads) and each ledger costs a few
// Map lookups. The answers are exactly those of the scans they replace - tools/selftest-large-branch.mjs compares the two
// on thousands of ledgers.
const SEP = '\u0001'
const isRealCaption = (v) => !!v && !/^uncategori[sz]ed/i.test(String(v).trim())
const lfIndexCache = new WeakMap()
function lfIndex(levelFormat) {
  const lf = levelFormat || []
  const hit = lfIndexCache.get(lf)
  if (hit && hit.size === lf.length) return hit
  const ix = { size: lf.length, byL123: new Map(), byId: new Map(), realL2: new Map(), realL3: new Map(), stmtOfL1: new Map(), stmtsOfL2: new Map() }
  for (const l of lf) {
    const n1 = normCap(l.level1), n2 = normCap(l.level2), n3 = normCap(l.level3)
    const k = n1 + SEP + n2 + SEP + n3
    const bucket = ix.byL123.get(k)
    if (bucket) bucket.push(l); else ix.byL123.set(k, [l])
    if (!ix.byId.has(l.id)) ix.byId.set(l.id, l)
    if (isRealCaption(l.level2)) ix.realL2.set(n1, (ix.realL2.get(n1) || 0) + 1)
    if (isRealCaption(l.level3)) ix.realL3.set(n1 + SEP + n2, (ix.realL3.get(n1 + SEP + n2) || 0) + 1)
    const st = stmtOf(l.alie)
    if (st) {
      if (!ix.stmtOfL1.has(n1)) ix.stmtOfL1.set(n1, st)
      const set = ix.stmtsOfL2.get(n2)
      if (set) set.add(st); else ix.stmtsOfL2.set(n2, new Set([st]))
    }
  }
  lfIndexCache.set(lf, ix)
  return ix
}

/** The Level Format rows a ledger sits on: by its captions; when those lead nowhere (old wording, blank Level 3), by its own level_format_id. */
export function lfRowsFor(levelFormat, row) {
  const ix = lfIndex(levelFormat)
  const m1 = normCap(row.mapping1_resultant), m2 = normCap(row.mapping2_resultant), m3 = normCap(row.mapping3_resultant)
  let hits = m1 ? (ix.byL123.get(m1 + SEP + m2 + SEP + m3) || []) : []
  if (!hits.length && row.level_format_id) {
    const base = ix.byId.get(row.level_format_id)
    if (base) hits = ix.byL123.get(normCap(base.level1) + SEP + normCap(base.level2) + SEP + normCap(base.level3)) || []
  }
  return hits.slice()
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
function foreignLevel2(ix, row) {
  const m2 = normCap(row.mapping2_resultant)
  if (!m2 || isUncategorised(row.mapping2_resultant)) return false
  const m1 = normCap(row.mapping1_resultant)
  const own = ix.stmtOfL1.get(m1) || stmtOf(row.alie)
  if (!own) return false
  const onStatements = ix.stmtsOfL2.get(m2)
  return !!onStatements && onStatements.size > 0 && !onStatements.has(own)
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
  const ix = lfIndex(levelFormat)
  const needs = []
  const m1 = normCap(row.mapping1_resultant)
  if (isUncategorised(row.mapping1_resultant)) {
    needs.push({ what: 'Mapping 1' })
  } else {
    if (isUncategorised(row.mapping2_resultant)) {
      if (ix.realL2.get(m1)) needs.push({ what: 'Mapping 2' })
    } else {
      const m2 = normCap(row.mapping2_resultant)
      if (ix.realL3.get(m1 + SEP + m2) && isUncategorised(row.mapping3_resultant)) needs.push({ what: 'Mapping 3' })
    }
  }
  for (const n of natureLevelsFor(levelFormat, row)) {
    if (n.ok) continue
    const shown = n.options.slice(0, 3).join(' / ') + (n.options.length > 3 ? ' …' : '')
    needs.push({ what: `Level ${n.level}`, hint: n.outdated ? `“${n.value}” is not an option` : `choose ${shown}` })
  }
  if (foreignLevel2(ix, row)) needs.push({ what: 'Mapping 2', hint: 'belongs to the other statement' })
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
