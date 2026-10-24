// Mapping_v2.xlsx integrity — mirrors how mapping-engine.js resolves captions:
// exact, case-sensitive text; Map3 keyed by Level 2 || Level 3 after stripping
// "(specify nature)". Fails the release when a rule points at a caption that
// does not exist, when a Map3 rule sits under a terminal Level 1 (Stage 2 exits
// before Stage 3 there) or has a blank Level 2 (fires inside every Level 2), or
// when the loader contract (sheet names / headers) is broken.
//   node tools/selftest-mapping.mjs
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const wb = XLSX.readFile(path.join(root, 'Mapping_v2.xlsx'))
const t = (v) => (v == null ? '' : String(v).trim())
const spec = (v) => t(v).replace(/\s*\(specify nature\)/gi, '').trim()
const sheet = (n) => {
  if (!wb.Sheets[n]) throw new Error(`sheet ${n} missing`)
  return XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null })
}
const lf = sheet('LevelFormat'), m1 = sheet('Map1'), m2 = sheet('Map2'), m3 = sheet('Map3')
const need = { LevelFormat: ['Constitution', 'ALIE', 'Level 1', 'Level 2', 'Level 3'], Map1: ['Constitution', 'Tally Pre-Primary', 'Mapping1 Resultant'],
               Map2: ['Constitution', 'Keyword', 'Mapping2 Resultant', 'Mapping1 Resultant', 'Priority'], Map3: ['Constitution', 'Keyword', 'Mapping1 Resultant', 'Mapping2 Resultant', 'Mapping3 Resultant', 'Priority'] }
const fails = []
for (const [n, cols] of Object.entries(need)) for (const c of cols) if (!(c in sheet(n)[0])) fails.push(`header '${c}' missing on ${n}`)

const L1 = {}, L2 = {}, L3 = {}, hasL2 = {}
for (const r of lf) {
  const c = t(r['Constitution']), l1 = t(r['Level 1']), l2 = spec(r['Level 2']), l3 = spec(r['Level 3'])
  ;(L1[c] ||= new Set()).add(l1)
  if (l2) { (L2[c] ||= new Set()).add(l1 + '||' + l2); (hasL2[c] ||= new Set()).add(l1) }
  if (l3) (L3[c] ||= new Set()).add(l1 + '||' + l2 + '||' + l3)
}
const RUNTIME_L1 = new Set(['Opening Stock (PL)', 'Closing Stock (PL)'])
const STOCK = (r) => /^(Opening|Closing) Stock/.test(t(r['Keyword'])) || /^Changes in inventories/.test(t(r['Mapping1 Resultant']))
for (const r of m1) { const c = t(r['Constitution']), l1 = t(r['Mapping1 Resultant']); if (l1 && !L1[c]?.has(l1) && !RUNTIME_L1.has(l1)) fails.push(`Map1 c${c} "${t(r['Tally Pre-Primary'])}" -> unknown Level 1 "${l1}"`) }
for (const r of m2) {
  const c = t(r['Constitution']), l1 = t(r['Mapping1 Resultant']), l2 = spec(r['Mapping2 Resultant'])
  if (!t(r['Keyword'])) fails.push(`Map2 c${c} empty keyword -> ${l1} > ${l2}`)
  if (l1 && !L1[c]?.has(l1) && !RUNTIME_L1.has(l1)) fails.push(`Map2 c${c} [${t(r['Keyword']).slice(0, 30)}] -> unknown Level 1 "${l1}"`)
  else if (l2 && L1[c]?.has(l1) && !L2[c]?.has(l1 + '||' + l2)) fails.push(`Map2 c${c} [${t(r['Keyword']).slice(0, 30)}] -> unknown Level 2 "${l2}" under "${l1}"`)
  if (t(r['Keyword']).split('|').some(k => k.trim().length === 1)) fails.push(`Map2 c${c} one-letter keyword in [${t(r['Keyword']).slice(0, 30)}]`)
}
for (const r of m3) {
  if (STOCK(r)) continue   // stock rows are driven by tb.js / ensureStockCategories, not by these captions
  const c = t(r['Constitution']), l1 = t(r['Mapping1 Resultant']), l2 = spec(r['Mapping2 Resultant']), l3 = spec(r['Mapping3 Resultant']), k = t(r['Keyword']).slice(0, 30)
  if (!t(r['Keyword'])) { fails.push(`Map3 c${c} empty keyword -> ${l1} > ${l2} > ${l3}`); continue }
  if (!L1[c]?.has(l1)) { fails.push(`Map3 c${c} [${k}] -> unknown Level 1 "${l1}"`); continue }
  if (!hasL2[c]?.has(l1)) { fails.push(`Map3 c${c} [${k}] -> terminal Level 1 "${l1}" (rule can never run)`); continue }
  if (!l2) { fails.push(`Map3 c${c} [${k}] -> blank Level 2 (fires inside every Level 2 of "${l1}")`); continue }
  if (!L2[c]?.has(l1 + '||' + l2)) { fails.push(`Map3 c${c} [${k}] -> unknown Level 2 "${l2}"`); continue }
  if (l3 && l3 !== 'Closing Stock (BS)' && !L3[c]?.has(l1 + '||' + l2 + '||' + l3)) fails.push(`Map3 c${c} [${k}] -> unknown Level 3 "${l3}" under "${l2}"`)
}
// code-coupled captions that must stay byte-identical
for (const c of ['1', '2', '3']) {
  for (const cap of ['Current assets', 'Current liabilities', 'Revenue from operations', 'Other income', 'Other expenses', 'Employee benefits expense', 'Finance Costs', 'Cost of materials consumed', 'Purchases of Stock-in-Trade', 'Depreciation and amortization expense'])
    if (!L1[c]?.has(cap)) fails.push(`c${c}: code-coupled Level 1 "${cap}" missing`)
  for (const pair of ['Current assets||Inventories', 'Current assets||Other current assets', 'Current liabilities||Other current liabilities', 'Current assets||Trade receivables', 'Current liabilities||Trade payables', 'Revenue from operations||Sale'])
    if (!L2[c]?.has(pair)) fails.push(`c${c}: code-coupled Level 2 "${pair}" missing`)
  for (const trip of ['Current assets||Other current assets||Advance to Suppliers', 'Current liabilities||Other current liabilities||Advance from Customers', 'Revenue from operations||Sale||Sale of Products', 'Revenue from operations||Sale||Sale of Services'])
    if (!L3[c]?.has(trip)) fails.push(`c${c}: code-coupled Level 3 "${trip}" missing`)
}
if (!L1['3']?.has('Tax expense:') || !L1['1']?.has('Tax expense') || !L1['2']?.has('Tax expense')) fails.push('Tax expense caption drift (c3 keeps the colon; c1/c2 do not)')

console.log(`selftest-mapping: LevelFormat ${lf.length}, Map1 ${m1.length}, Map2 ${m2.length}, Map3 ${m3.length}`)
if (fails.length) { console.error(`FAIL — ${fails.length} problem(s):`); for (const f of fails) console.error('  ' + f); process.exit(1) }
console.log('selftest-mapping: OK — every rule resolves to an existing caption; loader contract intact')
