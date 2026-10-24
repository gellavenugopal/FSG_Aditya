/**
 * Pre-release self-test: a "+ Add PY-only Major Head" Balance Sheet note whose
 * title has LevelFormat Level 3 rows (e.g. Long-term borrowings, Other
 * long-term liabilities) must, once its whole-note Manual PY figure is saved:
 *   - carry that Previous Year figure (note total AND the BS face line),
 *   - be in data.activeNotes (the Notes screen / PDF / Excel note list), not
 *     merely numbered on the Balance Sheet.
 * Reported in the field: the note got a number on the BS but clicking it found
 * no note, and the Previous Year stayed blank on the face — the whole-note
 * (blank-label) entry matched no template row, and activeNotes was computed
 * before Manual PY was applied.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that
 * source to prove they fail there.
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-py-only-manualpy-template.mjs
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

let processRows, applyManualPyOverrides, attachNoteExtras
try {
  const ufFile = path.join(srcRoot, 'src', 'renderer', 'src', 'hooks', 'useFinancials.js')
  if (!fs.existsSync(ufFile)) throw new Error('useFinancials.js missing')
  const built = await esbuild.build({
    stdin: { contents: `export { processRows, applyManualPyOverrides, attachNoteExtras } from ${JSON.stringify(ufFile)}\n`, resolveDir: srcRoot, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [{
      name: 'shims',
      setup(b) {
        b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
        b.onLoad({ filter: /^react$/, namespace: 'shim' }, () => ({ contents: REACT_SHIM, loader: 'js' }))
        // applyManualPyOverrides is module-private (attachNoteExtras is exported since Features > Format needs it); expose what is not.
        b.onLoad({ filter: /useFinancials\.js$/ }, (args) => ({
          contents: (() => { const src = fs.readFileSync(args.path, 'utf8'); return src + (/export function attachNoteExtras/.test(src) ? '\nexport { applyManualPyOverrides }\n' : '\nexport { applyManualPyOverrides, attachNoteExtras }\n') })() + '', loader: 'jsx', resolveDir: path.dirname(args.path),
        }))
      },
    }],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-pyonlytpl-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try { ;({ processRows, applyManualPyOverrides, attachNoteExtras } = await import(pathToFileURL(tmp).href)) } finally { fs.rmSync(tmp, { force: true }) }
} catch (e) {
  ok('processRows/applyManualPyOverrides/attachNoteExtras load', false, e.message)
  console.log(fails ? `\n${fails} FAILURE(S)\n` : '\nAll checks passed\n')
  process.exit(1)
}

const E = 'EQUITY AND LIABILITIES'
const row = (name, alie, level1, level2, level3, closing, opening, sortOrder) => ({
  ledger_name: name, name, alie, level1, mapping1_resultant: level1,
  level2, mapping2_resultant: level2, level3, mapping3_resultant: level3,
  closing_balance: String(closing), opening_balance: String(opening ?? 0),
  is_deemed_positive: false, upload_nature: '', sort_order: sortOrder,
})
const LF = [
  { alie: E, level1: "Owners' Funds", level2: "Owners' Capital Account", level3: null, sort_order: 1 },
  { alie: E, level1: 'Non-current liabilities', level2: 'Long-term borrowings', level3: 'From banks', level4: 'Secured/Unsecured', sort_order: 3 },
  { alie: E, level1: 'Non-current liabilities', level2: 'Long-term borrowings', level3: 'From others', level4: 'Secured/Unsecured', sort_order: 3 },
  { alie: E, level1: 'Non-current liabilities', level2: 'Other long-term liabilities', level3: 'Trade payables (LT)', sort_order: 5 },
  { alie: E, level1: 'Current liabilities', level2: 'Trade payables', level3: 'Due to Creditors other than MSME', sort_order: 8 },
]
const rows = [
  row('Capital', E, "Owners' Funds", "Owners' Capital Account", null, 1000000, 900000, 1),
  row('Creditor', E, 'Current liabilities', 'Trade payables', 'Due to Creditors other than MSME', 50000, 40000, 8),
]
const titles = new Set(['long-term borrowings', 'other long-term liabilities'])
const entries = [
  { note_num: 0, note_title: 'Long-term borrowings', particular_label: '', py_amount: 700000, id: 1 },
  { note_num: 0, note_title: 'Other long-term liabilities', particular_label: '', py_amount: 150000, id: 2 },
]

for (const [constitution, name] of [[1, 'Non-corporate (Proprietorship)'], [3, 'Company']]) {
  console.log(`\n${name}: PY-only major heads that have Level 3 template rows`)
  const processed = processRows(rows, null, constitution, [], null, false, false, null, LF, titles)
  attachNoteExtras(processed, [], LF, null, constitution, null, null, null)
  applyManualPyOverrides(processed, true, entries)

  for (const [title, py] of [['Long-term borrowings', 700000], ['Other long-term liabilities', 150000]]) {
    const note = Object.values(processed.notes).find(n => n.title === title)
    ok(`"${title}" has a note`, !!note)
    if (!note) continue
    ok('...carrying its Previous Year figure', Math.abs(note.prevTotal - py) < 0.005, String(note.prevTotal))
    ok('...zero Current Year (unchanged)', Math.abs(note.total) < 0.005, String(note.total))
    ok('...listed in activeNotes (Notes screen / PDF / Excel)', processed.activeNotes.includes(note))
    const line = [...processed.elSections, ...processed.assetSections].flatMap(s => s.lines).find(l => l.noteNum === note.num)
    ok('...and its Balance Sheet face line shows the Previous Year', !!line && Math.abs(line.prevTotal - py) < 0.005, String(line?.prevTotal))
  }
  const payables = Object.values(processed.notes).find(n => n.title === 'Trade payables')
  ok('an ordinary note is still listed and unchanged', !!payables && processed.activeNotes.includes(payables) && Math.abs(payables.total - 50000) < 0.005)
  ok('activeNotes stays sorted by note number', processed.activeNotes.every((n, i, a) => i === 0 || a[i - 1].num <= n.num))
}

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
