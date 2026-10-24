/**
 * Pre-release self-test: "+ Add PY-only Major Head" (Notes screen). A
 * Balance Sheet major head with NO Current Year ledger at all — nothing
 * uploaded this year — normally gets no note whatsoever, even though its
 * Manual PY figure (if the CA saves one via the modal) sits in the database.
 * processRows() must synthesize a single zero-value placeholder row for such
 * a title (sourced from the entity's own LevelFormat, so it lands in the
 * correct statutory section/position for EITHER a Company's fixed Schedule
 * III layout or another constitution's dynamic layout), so a real, correctly
 * numbered note is created for it — without duplicating or disturbing a
 * title that already has real data.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against
 * that source to prove they fail there (this feature did not exist before).
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-py-only-major-head.mjs
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

const REACT_SHIM = 'const React = { createElement: () => null, useCallback: (f) => f }; export default React; export const useState = () => []; export const useEffect = () => {}; export const useRef = () => ({}); export const useMemo = (f) => f(); export const useCallback = (f) => f;'
async function load(rel) {
  const file = path.join(srcRoot, ...rel.split('/'))
  if (!fs.existsSync(file)) return { __missing: `${rel} does not exist` }
  const built = await esbuild.build({
    stdin: { contents: `export * from ${JSON.stringify(file)}\n`, resolveDir: srcRoot, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [{
      name: 'selftest-shims',
      setup(b) {
        b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
        b.onLoad({ filter: /^react$/, namespace: 'shim' }, () => ({ contents: REACT_SHIM, loader: 'js' }))
      },
    }],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-pyonly-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try { return await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
}

const E = 'EQUITY AND LIABILITIES', A = 'ASSETS'
const row = (name, alie, level1, level2, level3, closing, opening, sortOrder) => ({
  ledger_name: name, name, alie, level1, mapping1_resultant: level1,
  level2, mapping2_resultant: level2, level3, mapping3_resultant: level3,
  closing_balance: String(closing), opening_balance: String(opening ?? 0),
  is_deemed_positive: alie === A, upload_nature: '', sort_order: sortOrder,
})

async function main() {
  const uf = await load('src/renderer/src/hooks/useFinancials.js')
  if (uf.__missing || typeof uf.processRows !== 'function') {
    ok('useFinancials.js exports processRows', false, uf.__missing || 'missing export')
    console.log(fails ? `\n${fails} FAILURE(S)\n` : '\nAll checks passed\n')
    process.exit(1)
  }

  // ── 1. Non-corporate (Proprietorship, constitution=1) — the dynamic,
  // LevelFormat-driven layout every constitution but Company uses. ─────────
  console.log('\nNon-corporate (constitution=1): PY-only major head')
  const LF1 = [
    { alie: E, level1: 'Current liabilities', level2: 'Trade payables', level3: 'Due to Creditors other than MSME', sort_order: 5 },
    { alie: E, level1: 'Long-term provisions', level2: 'Long-term provisions', level3: 'Provision for Gratuity', sort_order: 10 },
    { alie: E, level1: 'Non-current liabilities', level2: 'Deferred Tax Liability (Net)', level3: null, sort_order: 3 },
  ]
  const rows1 = [
    row('Local Creditor', E, 'Current liabilities', 'Trade payables', 'Due to Creditors other than MSME', 50000, 40000, 5),
  ]

  // Baseline: without manualPyOnlyTitles, an absent title gets no note at all —
  // this is the gap being fixed (proves the test fixture itself is honest).
  const baseline = uf.processRows(rows1, null, 1, [], null, false, false, null, LF1, null)
  const baselineNote = Object.values(baseline.notes || {}).find(n => (n.title || '').toLowerCase() === 'deferred tax liability (net)')
  ok('baseline (no manualPyOnlyTitles): absent title really does get no note', !baselineNote)

  // With it: a real, numbered note is synthesized, zero Current Year, correct
  // Level 1/alie sourced from LevelFormat — and it sits in the CORRECT
  // statutory position (sort_order 3, BEFORE Long-term provisions'
  // sort_order 10 and Trade payables' sort_order 5) even though it has no
  // real ledger at all.
  const titles = new Set(['deferred tax liability (net)'])
  const withTitles = uf.processRows(rows1, null, 1, [], null, false, false, null, LF1, titles)
  const synthNote = Object.values(withTitles.notes || {}).find(n => (n.title || '').toLowerCase() === 'deferred tax liability (net)')
  const payablesNote = Object.values(withTitles.notes || {}).find(n => (n.title || '').toLowerCase() === 'trade payables')
  ok('a PY-only title gets a real note', !!synthNote)
  if (synthNote) {
    ok('...zero Current Year total', Math.abs(synthNote.total) < 0.005, String(synthNote.total))
    ok('...correct Level 1 from LevelFormat', synthNote.level1 === 'Non-current liabilities', synthNote.level1)
    ok('...correct alie (liability side) from LevelFormat', synthNote.alie === E, synthNote.alie)
    ok('...gets a real note number', Number.isInteger(synthNote.num) && synthNote.num > 0, String(synthNote.num))
    ok('...positioned BEFORE a lower-priority real note (sort_order 3 vs 5)', !!payablesNote && synthNote.num < payablesNote.num,
      `synth=${synthNote.num} payables=${payablesNote?.num}`)
  }

  // A manualPyOnlyTitles entry with NO matching LevelFormat row must not
  // crash, and must leave the entry orphaned exactly as it was before this
  // feature (no note synthesized for an unrecognised title).
  const unknownTitles = new Set(['some completely unrecognised caption'])
  let unknownResult = null, threw = false
  try { unknownResult = uf.processRows(rows1, null, 1, [], null, false, false, null, LF1, unknownTitles) } catch { threw = true }
  ok('an unrecognised title does not crash processRows', !threw)
  ok('...and gets no note (stays orphaned, as before)',
    !threw && !Object.values(unknownResult.notes || {}).some(n => (n.title || '').toLowerCase() === 'some completely unrecognised caption'))

  // A title that already has REAL Current Year data must not be duplicated —
  // the real note's own figure is untouched, no synthetic double.
  const realTitles = new Set(['trade payables'])
  const withRealTitle = uf.processRows(rows1, null, 1, [], null, false, false, null, LF1, realTitles)
  const realNotes = Object.values(withRealTitle.notes || {}).filter(n => (n.title || '').toLowerCase() === 'trade payables')
  ok('a title with real data is not duplicated into a second note', realNotes.length === 1, String(realNotes.length))
  if (realNotes.length === 1) ok('...and keeps its real (non-zero) total', Math.abs(realNotes[0].total - 50000) < 0.005, String(realNotes[0].total))

  // ── 2. Company (constitution=3) — the fixed Schedule III layout, matched
  // by regex against BS_STRUCTURE rather than LevelFormat sort_order alone. ──
  console.log('\nCompany (constitution=3): PY-only major head')
  const LF3 = [
    { alie: E, level1: 'Current liabilities', level2: 'Trade payables', level3: 'Due to Creditors other than MSME', sort_order: 5 },
    { alie: E, level1: 'Non-current liabilities', level2: 'Deferred tax liabilities (Net)', level3: null, sort_order: 3 },
  ]
  const rows3 = [
    row('Local Creditor', E, 'Current liabilities', 'Trade payables', 'Due to Creditors other than MSME', 50000, 40000, 5),
  ]
  const titles3 = new Set(['deferred tax liabilities (net)'])
  const co = uf.processRows(rows3, null, 3, [], null, false, false, null, LF3, titles3)
  const coSynthNote = Object.values(co.notes || {}).find(n => (n.title || '').toLowerCase() === 'deferred tax liabilities (net)')
  ok('Company: a PY-only title matched against BS_STRUCTURE also gets a real note', !!coSynthNote)
  if (coSynthNote) {
    ok('...zero Current Year total', Math.abs(coSynthNote.total) < 0.005, String(coSynthNote.total))
    ok('...gets a real note number', Number.isInteger(coSynthNote.num) && coSynthNote.num > 0, String(coSynthNote.num))
  }

  // ── 3. P&L major heads (identified by Level 1, not Level 2) — e.g.
  // "Partners' Remuneration" (flat, no Level 2 in LevelFormat at all) and
  // "Tax expense" (matched by Level 1 even though LevelFormat ALSO carries
  // Level 2 rows for it, e.g. "Current tax" — the match must not require an
  // exact Level 2 match, since a P&L note's identity is its Level 1). ─────
  console.log('\nNon-corporate (constitution=1): PY-only P&L major head')
  const I = 'Income', X = 'Expenses'
  const LF_PL = [
    { alie: X, level1: 'Employee benefits expense', level2: 'Salaries and wages', level3: null, sort_order: 4 },
    { alie: X, level1: "Partners' Remuneration", level2: null, level3: null, sort_order: 20 },
    { alie: X, level1: 'Tax expense', level2: 'Current tax', level3: null, sort_order: 30 },
    { alie: X, level1: 'Tax expense', level2: 'Deferred tax', level3: null, sort_order: 31 },
  ]
  const rowsPL = [
    row('Staff Salary', X, 'Employee benefits expense', 'Salaries and wages', null, -120000, -100000, 4),
  ]

  const plTitles = new Set(["partners' remuneration", 'tax expense'])
  const withPL = uf.processRows(rowsPL, null, 1, [], null, false, false, null, LF_PL, plTitles)
  const remNote = Object.values(withPL.notes || {}).find(n => (n.title || '').toLowerCase() === "partners' remuneration")
  const taxNote = Object.values(withPL.notes || {}).find(n => (n.title || '').toLowerCase() === 'tax expense')
  const empNote = Object.values(withPL.notes || {}).find(n => (n.title || '').toLowerCase() === 'employee benefits expense')
  ok('"Partners\' Remuneration" (flat, no Level 2 at all) gets a real note', !!remNote)
  if (remNote) {
    ok('...isPL', remNote.isPL === true)
    ok('...zero Current Year total', Math.abs(remNote.total) < 0.005, String(remNote.total))
    ok('...correct alie (Expenses)', remNote.alie === X, remNote.alie)
    ok('...gets a real note number', Number.isInteger(remNote.num) && remNote.num > 0, String(remNote.num))
  }
  ok('"Tax expense" (matched by Level 1 despite LevelFormat having Level 2 rows) gets a real note', !!taxNote)
  if (taxNote) {
    ok('...isPL', taxNote.isPL === true)
    ok('...zero Current Year total', Math.abs(taxNote.total) < 0.005, String(taxNote.total))
  }
  ok('a real P&L title (Employee benefits expense) is untouched, not duplicated',
    !!empNote && Math.abs(empNote.total - 120000) < 0.005, String(empNote?.total))
  ok('exactly one note per synthesized P&L title (no duplicates)',
    Object.values(withPL.notes || {}).filter(n => (n.title || '').toLowerCase() === "partners' remuneration").length === 1)

  // Without manualPyOnlyTitles, the same absent P&L title gets no note at
  // all — proves the fixture is honest, same as the BS baseline above.
  const plBaseline = uf.processRows(rowsPL, null, 1, [], null, false, false, null, LF_PL, null)
  ok('baseline (no manualPyOnlyTitles): absent P&L title really does get no note',
    !Object.values(plBaseline.notes || {}).some(n => (n.title || '').toLowerCase() === "partners' remuneration"))

  console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
  process.exit(fails ? 1 : 0)
}

main()
