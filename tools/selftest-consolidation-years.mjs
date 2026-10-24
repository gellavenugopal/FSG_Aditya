/**
 * Pre-release self-test (0.1.118): the Consolidated statements add together the Trial Balances of ONE Financial Year (current year) and,
 * for the Previous Year, those of the year before - not every Trial Balance of the Auditee of every year. The CA can tick other ones.
 *   node tools/selftest-consolidation-years.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const esbuild = require(path.join(root, 'node_modules', 'esbuild'))
let fails = 0
const ok = (what, cond, d = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + d}`) }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
console.log('\nConsolidation: current year / previous year Trial Balances')

const reactShim = { name: 'react-shim', setup(b) { b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' })); b.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({ contents: 'export default { createContext: () => ({}) }', loader: 'js' })) } }
const r = await esbuild.build({
  entryPoints: [path.join(root, 'src/renderer/src/utils/consolidationSelection.js')], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', plugins: [reactShim],
})
const dir = fs.mkdtempSync(path.join(process.env.TEMP || '.', 'cons-'))
const file = path.join(dir, 'm.mjs'); fs.writeFileSync(file, r.outputFiles[0].text)
const { chooseConsolidation } = await import(pathToFileURL(file).href)

const periods = [{ id: 20, year_label: '2025-26' }, { id: 10, year_label: '2024-25' }]   // newest first, as entityPeriod:list returns
const tbs = [
  { id: 1, branch_name: 'Head', entity_period_id: 10 }, { id: 2, branch_name: 'Branch', entity_period_id: 10 }, { id: 5, branch_name: 'Head dup', entity_period_id: 10 },
  { id: 3, branch_name: 'Head', entity_period_id: 20 }, { id: 4, branch_name: 'Branch', entity_period_id: 20 },
]
let c = chooseConsolidation({ tbs, periods, entityPeriodId: 20, override: null })
ok('current year = the Trial Balances of the Financial Year on screen only', eq(c.cyIds, [3, 4]), JSON.stringify(c.cyIds))
ok('previous year = the Trial Balances of the year before', eq(c.pyIds, [1, 2, 5]), JSON.stringify(c.pyIds))
c = chooseConsolidation({ tbs, periods, entityPeriodId: 10, override: null })
ok('the earliest year has no previous-year Trial Balances (opening balances are used)', eq(c.cyIds, [1, 2, 5]) && c.pyIds.length === 0)
c = chooseConsolidation({ tbs, periods, entityPeriodId: 20, override: { cy: [3, 4], py: [1, 2] } })
ok('ticking a different set for the previous year (a duplicate upload left out) is honoured', eq(c.pyIds, [1, 2]) && c.customPY)
c = chooseConsolidation({ tbs, periods, entityPeriodId: 20, override: { cy: [3], py: null } })
ok('ticking fewer current-year Trial Balances is honoured', eq(c.cyIds, [3]) && c.customCY)
c = chooseConsolidation({ tbs, periods, entityPeriodId: 20, override: { cy: [3, 4, 1], py: [1, 2] } })
ok('one Trial Balance is never on both sides', !c.pyIds.some(id => c.cyIds.includes(id)))
c = chooseConsolidation({ tbs, periods, entityPeriodId: 20, override: { cy: [3, 999], py: [888] } })
ok('a ticked Trial Balance that no longer exists is ignored', eq(c.cyIds, [3]) && c.pyIds.length === 0)
c = chooseConsolidation({ tbs: [{ id: 7, entity_period_id: null }, { id: 8, entity_period_id: null }], periods: [], entityPeriodId: null, override: null })
ok('old Trial Balances not tied to a year are all consolidated, as before', eq(c.cyIds, [7, 8]))

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const fin = read('src/main/ipc/financials.js'), uf = read('src/renderer/src/hooks/useFinancials.js'), pre = read('src/preload/index.js')
ok('the consolidated query takes the Trial Balance ids', fin.includes('tb.id = ANY($2::int[])') && fin.includes("'financials:getConsolidatedData', async (_, entityId, tbIds)"))
ok('preload passes them', /getConsolidatedData:\s*\(entityId, tbIds\)/.test(pre))
const i = uf.indexOf("if (activeTB.id === '__consolidated__')"), j = uf.indexOf('const fetchCY = window.api?.getFinancialData(activeTB.id)')
const path1 = uf.slice(i, j)
ok('the Consolidated path fetches the current year by ids and builds the Previous Year from the previous year\'s ids', path1.includes('resolveConsolidationSelection(') && path1.includes('getConsolidatedData(entityId, sel.cyIds)') && path1.includes('getConsolidatedData(entityId, sel.pyIds)') && path1.includes('buildPrevMap(pyRows)'))
ok('no consolidated fetch without ids is left', !/getConsolidatedData\((entityId|entity\.id)\)/.test(uf))
const bar = read('src/renderer/src/components/shared/BranchModeBar.jsx')
ok('the Consolidated mode offers Consolidate Trial Balance (CY) and (PY)', bar.includes('Consolidate Trial Balance (CY):') && bar.includes('Consolidate Trial Balance (PY):'))
const app = read('src/renderer/src/App.jsx')
ok('a change of ticks refreshes the statements (consKey on the virtual Trial Balance)', app.includes('consKey }') && app.includes('ConsolidationContext.Provider'))

fs.rmSync(dir, { recursive: true, force: true })
console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
