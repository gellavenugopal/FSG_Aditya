/**
 * Pre-release self-test: the branch-wise Columnar Excel export's "Notes
 * (Columnar)" and "Annexures (Columnar)" sheets (see buildColumnarWorkbook
 * in buildExcel.js). Before this feature, the Columnar Excel workbook only
 * had branch-column sheets for BS and PL -- Notes and ledger-level Annexures
 * either didn't exist (Notes) or were thin, disconnected per-branch dumps
 * with no note numbering/titles/sub-note grouping (Annexures), making it
 * hard to trace a consolidated note or ledger figure back to which branch
 * it came from.
 *
 * Runs the REAL buildColumnarWorkbook() against two synthetic branches that
 * both post to the SAME note (by title, since note numbers are positional
 * and differ branch to branch) with DIFFERENT ledger names (branches don't
 * share ledgers), and checks the produced workbook.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against
 * that source to prove they fail there (these sheets did not exist before).
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-columnar-notes-annexures.mjs
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
const src = (...p) => JSON.stringify(path.join(srcRoot, 'src', 'renderer', 'src', ...p))

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + detail}`)
}

console.log('\nColumnar Excel: Notes (Columnar) / Annexures (Columnar)')

let buildColumnarWorkbook, XLSX
try {
  const built = await esbuild.build({
    stdin: {
      contents: `export { buildColumnarWorkbook } from ${src('components', 'GenerateFinancials', 'buildExcel.js')}\n`,
      resolveDir: srcRoot, loader: 'js',
    },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [{
      name: 'react-shim',
      setup(b) {
        b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
        b.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({
          contents: 'const React = { createElement: () => null }; export default React; export const useState = () => []; export const useEffect = () => {}; export const useRef = () => ({}); export const useMemo = (f) => f();',
          loader: 'js',
        }))
      },
    }],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-columnar-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try {
    ;({ buildColumnarWorkbook } = await import(pathToFileURL(tmp).href))
  } finally { fs.rmSync(tmp, { force: true }) }
  XLSX = require(path.join(root, 'node_modules', 'xlsx-js-style'))
} catch (e) {
  ok('buildColumnarWorkbook loads', false, e.message)
  console.log(fails ? `\n${fails} FAILURE(S)\n` : '\nAll checks passed\n')
  process.exit(1)
}

if (typeof buildColumnarWorkbook !== 'function') {
  ok('buildExcel.js exports buildColumnarWorkbook', false, 'missing export')
  console.log(fails ? `\n${fails} FAILURE(S)\n` : '\nAll checks passed\n')
  process.exit(1)
}
ok('buildExcel.js exports buildColumnarWorkbook', true)

const E = 'EQUITY AND LIABILITIES', X = 'Expenses'
const row = (name, alie, level1, level2, level3, closing) => ({
  ledger_name: name, name, alie, level1, mapping1_resultant: level1,
  level2, mapping2_resultant: level2, level3, mapping3_resultant: level3,
  closing_balance: String(closing), opening_balance: '0', trail_balance: String(closing),
  is_deemed_positive: alie !== E, upload_nature: '', sort_order: 1,
})

// Both branches post to "Trade payables" (same title, different ledgers --
// branches never share a ledger) -- proves title-based matching across
// branches, and that each branch's own ledger shows up under it.
const branchTBsData = [
  {
    tbId: 1, branchName: 'Kolkata', period: '2024-25',
    rows: [
      row('Local Creditor - Kolkata', E, 'Current liabilities', 'Trade payables', 'Due to Creditors other than MSME', 50000),
      row('Staff Salary - Kolkata', X, 'Employee benefits expense', 'Salaries and wages', null, -120000),
    ],
  },
  {
    tbId: 2, branchName: 'Siliguri', period: '2024-25',
    rows: [
      row('Local Creditor - Siliguri', E, 'Current liabilities', 'Trade payables', 'Due to Creditors other than MSME', 30000),
      row('Staff Salary - Siliguri', X, 'Employee benefits expense', 'Salaries and wages', null, -80000),
    ],
  },
]

const wb = buildColumnarWorkbook({ entity: { name: 'Test Co', constitution: 3 }, branchTBsData, denomination: 'as_is', levelFormat: [] })

ok('workbook has a "Notes (Columnar)" sheet', wb.SheetNames.includes('Notes (Columnar)'), wb.SheetNames.join(', '))
ok('workbook has an "Annexures (Columnar)" sheet', wb.SheetNames.includes('Annexures (Columnar)'), wb.SheetNames.join(', '))
// The pre-existing sheets must still be there -- this is additive, not a replacement.
ok('BS (Columnar) sheet still present', wb.SheetNames.includes('BS (Columnar)'))
ok('PL (Columnar) sheet still present', wb.SheetNames.includes('PL (Columnar)'))

function sheetToRows(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })
}

if (wb.SheetNames.includes('Notes (Columnar)')) {
  const rows = sheetToRows(wb.Sheets['Notes (Columnar)'])
  const tpRow = rows.find(r => String(r[0] || '').trim().toLowerCase() === 'trade payables')
  ok('"Trade payables" appears once, matched by title across both branches', !!tpRow, JSON.stringify(rows.map(r => r[0])))
  if (tpRow) {
    ok('Kolkata column shows 50000', Math.abs(Number(tpRow[1]) - 50000) < 0.5, String(tpRow[1]))
    ok('Siliguri column shows 30000', Math.abs(Number(tpRow[2]) - 30000) < 0.5, String(tpRow[2]))
    ok('Total column shows 80000 (50000+30000)', Math.abs(Number(tpRow[3]) - 80000) < 0.5, String(tpRow[3]))
  }
}

if (wb.SheetNames.includes('Annexures (Columnar)')) {
  const allRows = sheetToRows(wb.Sheets['Annexures (Columnar)'])
  const labels = allRows.map(r => (r[0] || '').toString())

  // Genuinely columnar, not appended: no more "Branch: X" sub-header rows
  // interrupting the Particulars column -- every row has the same fixed
  // Particulars | Branch1 | Branch2 | Total shape throughout.
  const hasBranchSubheaders = labels.some(v => v.startsWith('  Branch:'))
  ok('no "Branch: X" sub-header rows (true columnar, not appended by branch)', !hasBranchSubheaders)

  const noteHeader = labels.find(v => v.includes('Trade payables') && v.startsWith('──'))
  ok('a "── Trade payables ──" note header row is present', !!noteHeader, JSON.stringify(labels))

  const kolkataLedgerRow = allRows.find(r => (r[0] || '').toString().includes('Local Creditor - Kolkata'))
  ok('Kolkata\'s own ledger row exists', !!kolkataLedgerRow)
  if (kolkataLedgerRow) {
    ok('...with its amount (50000) in the Kolkata column', Math.abs(Number(kolkataLedgerRow[1]) - 50000) < 0.5, String(kolkataLedgerRow[1]))
    ok('...and 0/blank in the Siliguri column (ledgers don\'t recur across branches)', !Number(kolkataLedgerRow[2]), String(kolkataLedgerRow[2]))
  }
  const siliguriLedgerRow = allRows.find(r => (r[0] || '').toString().includes('Local Creditor - Siliguri'))
  ok('Siliguri\'s own ledger row exists', !!siliguriLedgerRow)
  if (siliguriLedgerRow) {
    ok('...with its amount (30000) in the Siliguri column', Math.abs(Number(siliguriLedgerRow[2]) - 30000) < 0.5, String(siliguriLedgerRow[2]))
    ok('...and 0/blank in the Kolkata column', !Number(siliguriLedgerRow[1]), String(siliguriLedgerRow[1]))
  }

  // Per the CA's clarification: each sub-note's branch SUBTOTAL row must
  // come first, carrying a real (non-zero) figure in EVERY branch's column
  // (dense, like BS/PL (Columnar)) -- not just whichever branch happens to
  // own a given ledger -- with the full ledger-level detail beneath it.
  const subnoteRowIdx = allRows.findIndex(r => (r[0] || '').toString().trim().startsWith('► Due to Creditors'))
  ok('a dense sub-note subtotal row ("► Due to Creditors...") exists', subnoteRowIdx !== -1, JSON.stringify(labels))
  if (subnoteRowIdx !== -1) {
    const subnoteRow = allRows[subnoteRowIdx]
    ok('...Kolkata column = 50000 (not blank/zero)', Math.abs(Number(subnoteRow[1]) - 50000) < 0.5, String(subnoteRow[1]))
    ok('...Siliguri column = 30000 (not blank/zero)', Math.abs(Number(subnoteRow[2]) - 30000) < 0.5, String(subnoteRow[2]))
    ok('...Total column = 80000', Math.abs(Number(subnoteRow[3]) - 80000) < 0.5, String(subnoteRow[3]))
    const kolkataLedgerIdx = allRows.findIndex(r => (r[0] || '').toString().includes('Local Creditor - Kolkata'))
    ok('the subtotal row comes BEFORE the ledger detail rows', kolkataLedgerIdx > subnoteRowIdx, `subtotal=${subnoteRowIdx} ledger=${kolkataLedgerIdx}`)
  }

  const noteTotalRow = allRows.find(r => (r[0] || '').toString().startsWith('TOTAL Trade payables'))
  ok('a "TOTAL Trade payables" row is present', !!noteTotalRow, JSON.stringify(labels))
  if (noteTotalRow) {
    ok('...Kolkata column = 50000', Math.abs(Number(noteTotalRow[1]) - 50000) < 0.5, String(noteTotalRow[1]))
    ok('...Siliguri column = 30000', Math.abs(Number(noteTotalRow[2]) - 30000) < 0.5, String(noteTotalRow[2]))
    ok('...Total column = 80000', Math.abs(Number(noteTotalRow[3]) - 80000) < 0.5, String(noteTotalRow[3]))
  }
}

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
