/**
 * Pre-release self-test: the Owners'/Partners' Capital Account Excel note
 * detail (buildNoteDetailRows in buildExcel.js) must not throw. Reported
 * live: downloading a "Generate Financials" Excel for an LLP (whose
 * Partners Contribution Account table passes showAgreed=true) crashed with
 * "showAgreed is not defined" -- a column-index helper had been hoisted
 * OUTSIDE pushAcctTable, referencing showAgreed before it existed (it's
 * that function's own parameter, not anything in the enclosing scope).
 *
 * Runs the REAL buildNoteDetailRows() for both the LLP variant (Contribution
 * + Current Account, exercising showAgreed=true) and the Partnership variant
 * (single table, showAgreed=false), and checks the Share of profit (%)
 * column lands in the right place with the right value for each.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against
 * that source to prove they fail there (this crash did not exist there).
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-owners-capital-excel.mjs
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

console.log('\nExcel: Owners\'/Partners\' Capital Account note detail must not throw')

let buildNoteDetailRows
try {
  const file = path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'GenerateFinancials', 'buildExcel.js')
  if (!fs.existsSync(file)) throw new Error(`${file} does not exist`)
  const built = await esbuild.build({
    stdin: { contents: `export * from ${JSON.stringify(file)}\n`, resolveDir: srcRoot, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [{
      name: 'shims',
      setup(b) {
        b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
        b.onLoad({ filter: /^react$/, namespace: 'shim' }, () => ({
          contents: 'const React = { createElement: () => null }; export default React; export const useState = () => []; export const useEffect = () => {}; export const useRef = () => ({}); export const useMemo = (f) => f();',
          loader: 'js',
        }))
        // buildNoteDetailRows is module-private; expose it to this test.
        b.onLoad({ filter: /buildExcel\.js$/ }, (args) => ({
          contents: fs.readFileSync(args.path, 'utf8') + '\nexport { buildNoteDetailRows }\n', loader: 'jsx', resolveDir: path.dirname(args.path),
        }))
      },
    }],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-ownerscap-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try {
    ;({ buildNoteDetailRows } = await import(pathToFileURL(tmp).href))
  } finally { fs.rmSync(tmp, { force: true }) }
} catch (e) {
  ok('buildExcel.js loads and exposes buildNoteDetailRows', false, e.message)
  console.log(fails ? `\n${fails} FAILURE(S)\n` : '\nAll checks passed\n')
  process.exit(1)
}

if (typeof buildNoteDetailRows !== 'function') {
  ok('buildExcel.js exports buildNoteDetailRows (via test shim)', false, 'missing export')
  console.log(fails ? `\n${fails} FAILURE(S)\n` : '\nAll checks passed\n')
  process.exit(1)
}
ok('buildNoteDetailRows loaded', true)

const scale = (n) => n
const party = (name, sharePct, extra) => ({
  name,
  contrib: { sharePct, opening: 100000, introduced: 20000, remuneration: 0, interest: 0, withdrawals: 5000, shareOfProfit: 15000 },
  current: { sharePct, opening: 5000, introduced: 0, remuneration: 30000, interest: 2000, withdrawals: 8000, shareOfProfit: 4000 },
  agreedContribution: 100000,
  ...extra,
})

// ── LLP: Contribution Account is pushed with showAgreed=true — the exact
// call that crashed with "showAgreed is not defined". ─────────────────────
{
  const details = {
    variant: 'llp',
    isSingleOwner: false,
    rows: [party('Partner A', 60), party('Partner B', 40)],
    pyContrib: { opening: 90000, introduced: 10000, remuneration: 0, interest: 0, withdrawals: 4000, shareOfProfit: 12000 },
    pyCurrent: { opening: 4000, introduced: 0, remuneration: 25000, interest: 1500, withdrawals: 6000, shareOfProfit: 3500 },
  }
  let result, threw = null
  try {
    result = buildNoteDetailRows("Partners' Capital Account", details, 5, scale, 250000, '2024-04-01', '2025-03-31')
  } catch (e) { threw = e }
  ok('LLP variant (showAgreed=true for Contribution Account) does not throw', !threw, threw?.message || threw?.stack)
  if (!threw && result) {
    ok('...produces rows', Array.isArray(result.rows) && result.rows.length > 0, JSON.stringify(result.rows?.[0]))
    // Column layout: Sr., Name, Agreed contribution, Share of profit (%), Opening...
    const dataRow = result.rows.find(r => r[0] === 1 && typeof r[3] === 'number')
    ok('Share of profit (%) lands in column 3 (after Agreed contribution) with the right value', !!dataRow && dataRow[3] === 60, JSON.stringify(dataRow))
    ok('centerCells marks that exact cell for centering', (result.centerCells || []).some(c => c.c === 3), JSON.stringify(result.centerCells))
  }
}

// ── Partnership (non-LLP): single table, showAgreed=false. ────────────────
{
  const details = {
    variant: 'partnership',
    isSingleOwner: false,
    rows: [
      { name: 'Partner A', sharePct: 60, opening: 100000, introduced: 20000, remuneration: 30000, interest: 2000, withdrawals: 8000, shareOfProfit: 15000 },
      { name: 'Partner B', sharePct: 40, opening: 50000, introduced: 10000, remuneration: 20000, interest: 1000, withdrawals: 4000, shareOfProfit: 10000 },
    ],
    py: { opening: 90000, introduced: 10000, remuneration: 25000, interest: 1500, withdrawals: 6000, shareOfProfit: 12000 },
  }
  let result, threw = null
  try {
    result = buildNoteDetailRows("Partners' Capital Account", details, 6, scale, 210000, '2024-04-01', '2025-03-31')
  } catch (e) { threw = e }
  ok('Partnership variant (showAgreed=false, single table) does not throw', !threw, threw?.message || threw?.stack)
  if (!threw && result) {
    // Column layout without Agreed contribution: Sr., Name, Share of profit (%), Opening...
    const dataRow = result.rows.find(r => r[0] === 1 && typeof r[2] === 'number')
    ok('Share of profit (%) lands in column 2 (no Agreed contribution column) with the right value', !!dataRow && dataRow[2] === 60, JSON.stringify(dataRow))
    ok('centerCells marks that exact cell for centering', (result.centerCells || []).some(c => c.c === 2), JSON.stringify(result.centerCells))
  }
}

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
