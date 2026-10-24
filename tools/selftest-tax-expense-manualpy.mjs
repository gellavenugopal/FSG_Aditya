/**
 * Pre-release self-test: a Previous Year "Current tax" figure entered through
 * "+ Add PY-only Major Head" (or by name) must appear on the P&L face -- and the
 * face's tax rows must always add up to the tax total that feeds the profit.
 *
 * Reported live, twice (Consolidated, branch-having Partnership): the PY figure
 * reached "Profit for the period from continuing operations" but the
 * "(a) Current tax" row stayed blank. "+ Add PY-only Major Head" saved ONE
 * blank-labelled (whole-note) figure under "Tax expense"; that fed the profit,
 * but the face only shows a Tax expense figure through a LINE -- the
 * non-corporate face reads a line literally named "Current tax", the LLP/Company
 * face prints every line -- and a flat total has none.
 *
 * Runs the REAL processRows() + applyManualPyOverrides() + (Partnership face)
 * computeNonCorpPLLayout(), the pipeline the live P&L screen / PDF / Excel use.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that
 * source to prove they fail there.
 *
 *   node tools/selftest-tax-expense-manualpy.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = process.env.FSG_SRC_ROOT ? path.resolve(process.env.FSG_SRC_ROOT) : root
const require = createRequire(import.meta.url)
const esbuild = require(path.join(root, 'node_modules', 'esbuild'))

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + detail}`)
}

console.log('\nTax expense: a Manual PY figure must reach the P&L face and the face must foot')

const REACT_SHIM = 'const React = { createElement: () => null, useCallback: (f) => f }; export default React; export const useState = () => []; export const useEffect = () => {}; export const useRef = () => ({}); export const useMemo = (f) => f(); export const useCallback = (f) => f;'

let processRows, applyManualPyOverrides, computeNonCorpPLLayout
try {
  const ufFile = path.join(srcRoot, 'src', 'renderer', 'src', 'hooks', 'useFinancials.js')
  const plFile = path.join(srcRoot, 'src', 'renderer', 'src', 'utils', 'plStructureNonCorp.js')
  if (!fs.existsSync(ufFile) || !fs.existsSync(plFile)) throw new Error('source files missing')
  const built = await esbuild.build({
    stdin: {
      contents: `export { processRows, applyManualPyOverrides } from ${JSON.stringify(ufFile)}\nexport { computeNonCorpPLLayout } from ${JSON.stringify(plFile)}\n`,
      resolveDir: srcRoot, loader: 'js',
    },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [{
      name: 'shims',
      setup(b) {
        b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
        b.onLoad({ filter: /^react$/, namespace: 'shim' }, () => ({ contents: REACT_SHIM, loader: 'js' }))
        b.onLoad({ filter: /useFinancials\.js$/ }, (args) => ({
          contents: fs.readFileSync(args.path, 'utf8') + '\nexport { applyManualPyOverrides }\n', loader: 'jsx', resolveDir: path.dirname(args.path),
        }))
      },
    }],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-taxpy-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try {
    ;({ processRows, applyManualPyOverrides, computeNonCorpPLLayout } = await import(pathToFileURL(tmp).href))
  } finally { fs.rmSync(tmp, { force: true }) }
} catch (e) {
  ok('processRows/applyManualPyOverrides/computeNonCorpPLLayout load', false, e.message)
  console.log(fails ? `\n${fails} FAILURE(S)\n` : '\nAll checks passed\n')
  process.exit(1)
}
ok('processRows/applyManualPyOverrides/computeNonCorpPLLayout load', true)

const X = 'Expenses'
const row = (name, level1, level2, closing, opening, sortOrder) => ({
  ledger_name: name, name, alie: X, level1, mapping1_resultant: level1,
  level2, mapping2_resultant: level2, level3: null, mapping3_resultant: null,
  closing_balance: String(closing), opening_balance: String(opening ?? 0),
  is_deemed_positive: false, upload_nature: '', sort_order: sortOrder,
})

// Per-constitution captions, exactly as Mapping_v2.xlsx spells them.
const CONS = {
  1: { taxL1: 'Tax expense',  deferred: 'Deferred tax',                   display: 'Partnership' },
  2: { taxL1: 'Tax expense',  deferred: 'Deferred tax charge/ (benefit)', display: 'LLP' },
  3: { taxL1: 'Tax expense:', deferred: 'Deferred tax',                   display: 'Company' },
}
const EXCESS = 'Excess/ Short provision of tax relating to earlier years'

// realTaxRows: ledgers really present this year under Tax expense.
function build(cons, { realTaxRows = [], pyOnlyTax = true, extraOnly = [] } = {}) {
  const c = CONS[cons]
  const rows = [row('Staff Salary', 'Employee benefits expense', 'Salaries and wages', -120000, -100000, 4), ...realTaxRows]
  const lfRows = [
    { alie: X, level1: 'Employee benefits expense', level2: 'Salaries and wages', level3: null, sort_order: 4 },
    { alie: X, level1: c.taxL1, level2: null, level3: null, sort_order: 30 },
    { alie: X, level1: "Partners' Remuneration", level2: null, level3: null, sort_order: 20 },
  ]
  const only = new Set(extraOnly.map(t => t.toLowerCase()))
  if (pyOnlyTax) only.add(c.taxL1.toLowerCase())
  const processed = processRows(rows, null, cons, [], null, false, false, null, lfRows, only)
  return { processed, c }
}
const noteOf = (processed, title) => Object.values(processed.notes || {}).find(n => (n.title || '').trim().toLowerCase() === title.toLowerCase())
const entry = (title, label, amount) => ({ note_num: 0, note_title: title, particular_label: label, py_amount: amount, is_custom: false })

// What the P&L face prints for the Tax expense block, per family of layout.
function faceTaxRows(processed, cons) {
  if (cons === 1) {
    const items = computeNonCorpPLLayout(processed, CONS[1].display, []).items
    const start = items.findIndex(i => i.kind === 'header' && /^tax expense/i.test(i.label))
    const end = items.findIndex(i => i.kind === 'total' && /continuing operations/i.test(i.label))
    return items.slice(start + 1, end).filter(i => i.kind === 'sub').map(i => ({ label: i.label, cy: i.cy, py: i.py }))
  }
  // LLP / Company: every line of every Tax expense section is printed (PL screen, PDF, Excel)
  return (processed.expenseSections || []).filter(s => /^tax expense$/i.test((s.level1 || '').replace(/:\s*$/, '')))
    .flatMap(s => s.lines.map(l => ({ label: l.level2 || s.level1, cy: l.total || 0, py: l.prevTotal || 0 })))
}
const taxSecOf = (processed) => (processed.expenseSections || []).find(s => /^tax expense$/i.test((s.level1 || '').replace(/:\s*$/, '')))
const sum = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0)

for (const cons of [1, 2, 3]) {
  const { c } = { c: CONS[cons] }
  console.log(`\n  -- constitution ${cons} (${c.display}) --`)

  // S1: the reported scenario -- ONE whole-note figure, exactly what "+ Add PY-only Major Head -> Tax expense" saved.
  {
    const { processed } = build(cons)
    const note = noteOf(processed, c.taxL1)
    ok('S1  "Tax expense" note exists (PY-only, no ledger this year)', !!note)
    if (!note) continue
    applyManualPyOverrides(processed, true, [entry(c.taxL1, '', 45000)])
    const face = faceTaxRows(processed, cons)
    const cur = face.find(r => /^current tax$/i.test(r.label))
    ok('S1  the face shows a "Current tax" row', !!cur, JSON.stringify(face))
    ok('S1  ...carrying the entered figure (45000), not blank', !!cur && cur.py === 45000, JSON.stringify(cur))
    const sec = taxSecOf(processed)
    ok('S1  the face rows foot to the tax total that feeds the profit', Math.abs(sum(face, 'py') - (sec?.prevTotal || 0)) < 0.005 && (sec?.prevTotal || 0) === 45000, `face=${sum(face, 'py')} section=${sec?.prevTotal}`)
    ok('S1  no stray "Tax expense 0 0" placeholder row', !face.some(r => /^tax expense:?$/i.test(r.label)), JSON.stringify(face))
  }

  // S2: entered line by line (what the picker now asks for).
  {
    const { processed } = build(cons)
    applyManualPyOverrides(processed, true, [entry(c.taxL1, 'Current tax', 45000), entry(c.taxL1, EXCESS, 5000), entry(c.taxL1, c.deferred, 2000)])
    const face = faceTaxRows(processed, cons)
    const by = (rx) => face.find(r => rx.test(r.label))
    ok('S2  Current tax / Excess-Short / Deferred each on its own row with its own figure',
      by(/^current tax$/i)?.py === 45000 && by(/excess.*short/i)?.py === 5000 && by(/deferred tax/i)?.py === 2000, JSON.stringify(face))
    const sec = taxSecOf(processed)
    ok('S2  the face rows foot to the tax total (52000)', Math.abs(sum(face, 'py') - 52000) < 0.005 && sec?.prevTotal === 52000, `face=${sum(face, 'py')} section=${sec?.prevTotal}`)
  }

  // S3: a tax line the face has no fixed row for must still get one (AMT/MAT credit, a CA-named particular).
  {
    const { processed } = build(cons)
    applyManualPyOverrides(processed, true, [entry(c.taxL1, 'Current tax', 45000), entry(c.taxL1, cons === 3 ? 'MAT credit entitlement' : 'AMT credit entitlement', -300)])
    const face = faceTaxRows(processed, cons)
    ok('S3  a line with no fixed face row gets a row of its own', face.some(r => /credit entitlement/i.test(r.label) && r.py === -300), JSON.stringify(face))
    ok('S3  ...and the face still foots (44700)', Math.abs(sum(face, 'py') - 44700) < 0.005, `face=${sum(face, 'py')}`)
  }

  // S4: a named "Current tax" and a leftover whole-note figure -- the named one wins, nothing is double counted.
  {
    const { processed } = build(cons)
    applyManualPyOverrides(processed, true, [entry(c.taxL1, '', 45000), entry(c.taxL1, 'Current tax', 9000)])
    const face = faceTaxRows(processed, cons)
    ok('S4  named Current tax wins over a leftover whole-note figure (9000, not 54000)', face.find(r => /^current tax$/i.test(r.label))?.py === 9000 && Math.abs(sum(face, 'py') - 9000) < 0.005, JSON.stringify(face))
  }

  // S5: next year the TB really has a "Current tax" ledger; the PY figure entered earlier as a lump sum must not vanish.
  {
    const { processed } = build(cons, { pyOnlyTax: false, realTaxRows: [row('Income Tax Provision', c.taxL1, 'Current tax', -10000, 0, 30)] })
    applyManualPyOverrides(processed, true, [entry(c.taxL1, '', 45000)])
    const face = faceTaxRows(processed, cons)
    const cur = face.find(r => /^current tax$/i.test(r.label))
    ok('S5  real Current tax ledger keeps its CY (10000) and takes the earlier lump-sum PY (45000)', cur?.cy === 10000 && cur?.py === 45000, JSON.stringify(face))
    ok('S5  ...and the face foots on both years', Math.abs(sum(face, 'cy') - 10000) < 0.005 && Math.abs(sum(face, 'py') - 45000) < 0.005, JSON.stringify(face))
  }

  // S6: another whole-note P&L head keeps working as before (Partners' Remuneration is one face row).
  {
    const { processed } = build(cons, { pyOnlyTax: false, extraOnly: ["Partners' Remuneration"] })
    applyManualPyOverrides(processed, true, [entry("Partners' Remuneration", '', 7000)])
    const sec = (processed.expenseSections || []).find(s => /partners.{0,3}remuneration/i.test(s.level1 || ''))
    ok("S6  Partners' Remuneration whole-note figure still reaches its section (7000)", sec?.prevTotal === 7000, JSON.stringify(sec && { l1: sec.level1, py: sec.prevTotal }))
  }
}

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
