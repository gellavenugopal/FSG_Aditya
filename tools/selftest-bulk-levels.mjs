/**
 * Pre-release self-test: Rectification / Recategorisation bulk "Level 4-7 only"
 * (utils/fixTargets.js bulkNaturePlan + Exceptions/index.jsx). Ticked ledgers
 * under DIFFERENT Level 3 lines can have one Level 4-7 set together — e.g. all
 * the loans still missing Secured / Unsecured — with only the options valid for
 * every one of them, and without touching their Mapping 1/2/3 or other levels.
 * Requested in the field (28 Sep 2026): bulk rectification stopped at Level 3.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = process.env.FSG_SRC_ROOT ? path.resolve(process.env.FSG_SRC_ROOT) : root
const require = createRequire(pathToFileURL(path.join(root, 'package.json')).href)
const esbuild = require('esbuild')
const XLSX = require('xlsx')

let fails = 0
const ok = (what, cond, detail = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + detail}`) }

const built = await esbuild.build({
  stdin: { contents: `export * from ${JSON.stringify(path.join(srcRoot, 'src/renderer/src/utils/fixTargets.js'))}\n`, resolveDir: srcRoot, loader: 'js' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', loader: { '.js': 'jsx' }, nodePaths: [path.join(root, 'node_modules')],
})
const tmp = path.join(os.tmpdir(), `fsg-selftest-bulk-${process.pid}.mjs`)
fs.writeFileSync(tmp, built.outputFiles[0].text)
const ft = await import(pathToFileURL(tmp).href)
fs.rmSync(tmp, { force: true })

const wb = XLSX.readFile(path.join(root, 'Mapping_v2.xlsx'))
const LF = XLSX.utils.sheet_to_json(wb.Sheets.LevelFormat, { defval: null }).map((r, i) => ({
  id: i + 1, constitution: parseInt(r['Constitution']), alie: r['ALIE'], level1: r['Level 1'], level2: r['Level 2'], level3: r['Level 3'],
  level4: r['Level 4'], level5: r['Level 5'], level6: r['Level 6'], level7: r['Level 7'],
})).filter(r => r.constitution === 3)
const led = (id, m1, m2, m3, l = {}) => ({ id, mapping1_resultant: m1, mapping2_resultant: m2, mapping3_resultant: m3,
  level4_value: l.l4 || null, level5_value: l.l5 || null, level6_value: l.l6 || null, level7_value: l.l7 || null })

console.log('\nRecategorisation: bulk "Level 4-7 only"')
ok('bulkNaturePlan exists (utils/fixTargets.js)', typeof ft.bulkNaturePlan === 'function')
if (typeof ft.bulkNaturePlan === 'function') {
  // Three loans under different lines, none with Secured / Unsecured yet.
  const termLoan = led(1, 'Non-current liabilities', 'Long-term borrowings', 'Term loans', { l5: 'from banks' })
  const odLoan = led(2, 'Current liabilities', 'Short-term borrowings', 'Loans repayable on demand', { l5: 'from banks' })
  const odLoan2 = led(3, 'Current liabilities', 'Short-term borrowings', 'Loans repayable on demand', { l5: 'from other parties', l6: 'Secured' })
  const plan = ft.bulkNaturePlan(LF, [termLoan, odLoan, odLoan2])
  const l6 = plan.find(p => p.level === 6)
  ok('Level 6 (Secured / Unsecured) is offered for all three loans across two lines',
    !!l6 && l6.ids.length === 3 && l6.options.join('|') === 'Secured|Unsecured', JSON.stringify(l6))
  ok('...and it counts the two still without one', l6?.missing === 2, String(l6?.missing))
  const l5 = plan.find(p => p.level === 5)
  ok('Level 5 (from banks / from other parties) is offered with its own options', !!l5 && l5.options.includes('from banks') && l5.options.includes('from other parties'), JSON.stringify(l5))

  // Different option lists at one level: only the common ones.
  const deposit = led(4, 'Non-current liabilities', 'Long-term borrowings', 'Deposits')        // Level 5: Secured / Unsecured
  const mixed = ft.bulkNaturePlan(LF, [termLoan, deposit])
  const m5 = mixed.find(p => p.level === 5)
  ok('different Level 5 lists (from banks… vs Secured / Unsecured): no option is offered for all', !!m5 && m5.ids.length === 2 && m5.options.length === 0, JSON.stringify(m5))

  const done = ft.bulkNaturePlan(LF, [led(5, 'Current liabilities', 'Trade payables', 'Due to MSME')])
  ok('a ledger whose line needs no Level 4-7 gets no picker', done.length === 0, JSON.stringify(done))
}

const ui = fs.readFileSync(path.join(srcRoot, 'src/renderer/src/components/Exceptions/index.jsx'), 'utf8')
ok('the Recategorisation screen offers it and sets only that one level (Mapping 1/2/3 kept)',
  /bulkNaturePlan\(/.test(ui) && /\{ \.\.\.r, \[p\.key\]: value \}/.test(ui))

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
