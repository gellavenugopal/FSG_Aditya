/**
 * Pre-release self-test: a NAMED Manual PY particular (e.g. "Current tax")
 * on an otherwise-flat P&L note must reach the P&L face's own named line for
 * it, not just the note's combined total.
 *
 * Reported live: a CA filled a Manual PY figure for "Current tax" on a
 * Consolidated, branch-having entity's "Tax expense" note (created via
 * "+ Add PY-only Major Head", which starts with no Level 2 breakdown at
 * all). The figure correctly reached "Profit/(Loss) for the period from
 * continuing operations" (the aggregate), but "(a) Current tax" on the face
 * itself stayed blank -- plStructureNonCorp.js's taxL2() requires a LINE
 * whose level2 literally reads "Current tax", and applyManualPyOverrides()
 * only ever consulted a blank-labelled entry for a note with no real Level
 * 2 breakdown, never a named one.
 *
 * Runs the REAL processRows() + applyManualPyOverrides() + (for the P&L
 * face) computeNonCorpPLLayout() together -- end to end, the same pipeline
 * fetchFinancialsData() and the live P&L screen use -- against a
 * Consolidated-shaped fixture: a "Tax expense" note synthesized flat (no
 * real ledger, exactly like "+ Add PY-only Major Head" creates), with a
 * Manual PY entry specifically labelled "Current tax".
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against
 * that source to prove they fail there.
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-named-manualpy-flat-note.mjs
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

console.log('\nA named Manual PY particular on a flat P&L note must reach the P&L face')

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
        // applyManualPyOverrides is module-private; expose it to this test.
        b.onLoad({ filter: /useFinancials\.js$/ }, (args) => ({
          contents: fs.readFileSync(args.path, 'utf8') + '\nexport { applyManualPyOverrides }\n', loader: 'jsx', resolveDir: path.dirname(args.path),
        }))
      },
    }],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-namedpy-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
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

const E = 'EQUITY AND LIABILITIES', X = 'Expenses'
const row = (name, alie, level1, level2, level3, closing, opening, sortOrder) => ({
  ledger_name: name, name, alie, level1, mapping1_resultant: level1,
  level2, mapping2_resultant: level2, level3, mapping3_resultant: level3,
  closing_balance: String(closing), opening_balance: String(opening ?? 0),
  is_deemed_positive: alie === 'ASSETS', upload_nature: '', sort_order: sortOrder,
})

// Real data: only Employee benefits expense -- "Tax expense" has NO real
// ledger at all, matching the "+ Add PY-only Major Head" scenario exactly.
const rows = [
  row('Staff Salary', X, 'Employee benefits expense', 'Salaries and wages', null, -120000, -100000, 4),
]
const lfRows = [
  { alie: X, level1: 'Employee benefits expense', level2: 'Salaries and wages', level3: null, sort_order: 4 },
  { alie: X, level1: 'Tax expense', level2: null, level3: null, sort_order: 30 },
]

// "+ Add PY-only Major Head" gives "Tax expense" a real (flat, zero-CY) note.
const manualPyOnlyTitles = new Set(['tax expense'])
const processed = processRows(rows, null, 1, [], null, false, false, null, lfRows, manualPyOnlyTitles)
const taxNote = Object.values(processed.notes || {}).find(n => (n.title || '').toLowerCase() === 'tax expense')
ok('"Tax expense" note exists (synthesized flat, zero Current Year)', !!taxNote)
if (!taxNote) { console.log(`\n${fails} FAILURE(S) — release aborted\n`); process.exit(1) }
ok('...starts with no Level 2 breakdown at all (the reported scenario)', !(taxNote.lines || []).some(l => l.level2))

// The CA labels the entry "Current tax" specifically (not a blank flat total).
const manualPyEntries = [
  { note_num: taxNote.num, note_title: 'Tax expense', particular_label: 'Current tax', py_amount: 45000, is_custom: true },
]
applyManualPyOverrides(processed, true, manualPyEntries)

const currentTaxLine = (taxNote.lines || []).find(l => (l.level2 || '').trim().toLowerCase() === 'current tax')
ok('a "Current tax" line now exists on the note itself', !!currentTaxLine, JSON.stringify(taxNote.lines))
if (currentTaxLine) ok('...with the entered PY figure (45000)', Number(currentTaxLine.prevTotal) === 45000, String(currentTaxLine.prevTotal))
ok('the note\'s own total reflects it too', Number(taxNote.prevTotal) === 45000, String(taxNote.prevTotal))

const taxSec = (processed.expenseSections || []).find(s => (s.level1 || '').toLowerCase() === 'tax expense')
ok('the P&L face section (sec.prevTotal) reflects it (feeds the aggregate profit figure)',
  !!taxSec && Number(taxSec.prevTotal) === 45000, JSON.stringify(taxSec))

// The actual face row a CA sees: plStructureNonCorp.js's taxL2(/^current tax$/i)
// via computeNonCorpPLLayout(), the same function the live P&L screen calls.
const layout = computeNonCorpPLLayout(processed, 'Partnership')
const currentTaxItem = (layout.items || []).find(i => i.label === 'Current tax')
ok('"(a) Current tax" is present on the P&L face', !!currentTaxItem, JSON.stringify(layout.items?.map(i => i.label)))
if (currentTaxItem) ok('...and shows the entered PY figure (45000), not blank', Number(currentTaxItem.py) === 45000, String(currentTaxItem.py))

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
