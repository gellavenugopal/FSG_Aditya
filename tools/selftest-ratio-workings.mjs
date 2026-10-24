/**
 * Pre-release self-test (0.1.114): the working of "Net Credit Purchases" (Trade Payables Turnover Ratio) is in the Annexures - screen, PDF and
 * Excel - not on the face of the Notes, and it agrees with the figure the ratio uses.
 *   node tools/selftest-ratio-workings.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const esbuild = require(path.join(root, 'node_modules', 'esbuild'))
let fails = 0
const ok = (what, cond, d = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + d}`) }
const near = (a, b) => Math.abs(a - b) < 0.01
console.log('\nNet Credit Purchases working')

const reactShim = { name: 'react-shim', setup(b) { b.onResolve({ filter: /^react(\/.*)?$/ }, () => ({ path: 'react', namespace: 'shim' })); b.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({ contents: 'export default {}; export const useState = () => []; export const useEffect = () => {}; export const useMemo = (f) => f(); export const useCallback = (f) => f; export const useRef = () => ({ current: null })', loader: 'js' })) } }
const r = await esbuild.build({
  stdin: { contents: `export { netCreditPurchasesWorking, computeRatios } from ${JSON.stringify(path.join(root, 'src/renderer/src/utils/ratios.js').replace(/\\/g, '/'))}`, resolveDir: root, loader: 'js' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', loader: { '.js': 'jsx', '.jsx': 'jsx' },
  nodePaths: [path.join(root, 'node_modules')], plugins: [reactShim],
})
const f = path.join(os.tmpdir(), `fsg-selftest-ncp-${process.pid}.mjs`)
fs.writeFileSync(f, r.outputFiles[0].text)
let M; try { M = await import(pathToFileURL(f).href) } finally { fs.rmSync(f, { force: true }) }

const data = {
  elSections: [{ level1: 'Current liabilities', total: 600000, prevTotal: 400000, lines: [{ level2: 'Trade payables', total: 600000, prevTotal: 400000, rows: [] }] }], assetSections: [], incomeSections: [{ level1: 'Revenue from operations', total: 5000000, prevTotal: 4000000, lines: [] }],
  netProfit: 0, prevNetProfit: 0,
  expenseSections: [
    { level1: 'Cost of materials consumed', total: 1700000, prevTotal: 1500000, lines: [
      { level2: 'Purchases', total: 1500000, prevTotal: 1400000 },
      { level2: 'Opening Stock of Raw Materials', total: 300000, prevTotal: 250000 },
      { level2: 'Less: Closing Stock of Raw Materials', total: -100000, prevTotal: -150000 },
    ] },
    { level1: 'Purchases of Stock-in-Trade', total: 400000, prevTotal: 350000, lines: [{ level2: 'Purchases of Stock-in-Trade', total: 400000, prevTotal: 350000 }] },
    { level1: 'Other expenses', total: 99999, prevTotal: 0, lines: [] },
  ],
  notes: { 7: { num: 7, isPL: false, title: 'Trade payables', total: 600000, prevTotal: 400000 } },
}
const w = M.netCreditPurchasesWorking(data)
ok('a working is produced', !!w)
ok('it lists the lines of each of the two captions, Current and Previous Year', w.rows.filter(x => x.kind === 'line').length === 4 && w.rows.some(x => x.label === 'Opening Stock of Raw Materials' && near(x.cy, 300000) && near(x.py, 250000)))
ok('other captions are not in it', !w.rows.some(x => /other expenses/i.test(x.label)))
ok('the total is the two captions together (CY 21,00,000 / PY 18,50,000)', near(w.numerator.cy, 2100000) && near(w.numerator.py, 1850000), JSON.stringify(w.numerator))
const row = M.computeRatios(data).find(x => x.key === 'tp_turnover')
ok('...and it is exactly the numerator the ratio uses', near(w.numerator.cy, row.numeratorValue), `${w.numerator.cy} v ${row.numeratorValue}`)
ok('the average Trade Payables is the ratio\'s denominator, with its two components', near(w.average, 500000) && w.components && near(w.components.closing, 600000) && near(w.components.opening, 400000), JSON.stringify([w.average, w.components]))
ok('the ratio is shown', near(w.ratio, 2100000 / 500000), String(w.ratio))
ok('a line not itemised in a caption is added, so the sub-total agrees', (() => { const d = JSON.parse(JSON.stringify(data)); d.expenseSections[0].total += 5000; const x = M.netCreditPurchasesWorking(d); return x.rows.some(y => /other ledgers/i.test(y.label) && near(y.cy, 5000)) && near(x.numerator.cy, 2105000) })())
ok('neither caption present: no working', M.netCreditPurchasesWorking({ ...data, expenseSections: [{ level1: 'Other expenses', total: 1, prevTotal: 0, lines: [] }] }) === null)

const rd = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8')
const annex = rd('src/renderer/src/components/Annexures/index.jsx'), html = rd('src/renderer/src/components/GenerateFinancials/buildHTML.js'), xl = rd('src/renderer/src/components/GenerateFinancials/buildExcel.js')
ok('the Annexures screen shows it below the reconciliation', annex.includes('<NetCreditPurchasesWorking data={data} />') && annex.indexOf('<TradePayablesReceivablesReconciliation data') < annex.indexOf('<NetCreditPurchasesWorking data'))
ok('the PDF prints it at the end of the Annexures, the Excel at the end of the Annexures sheet', html.includes('Workings of Ratios — Net Credit Purchases') && xl.includes('Workings of Ratios - Net Credit Purchases'))
ok('it is not on the face of the Notes', !rd('src/renderer/src/components/Notes/index.jsx').includes('netCreditPurchasesWorking'))

console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
