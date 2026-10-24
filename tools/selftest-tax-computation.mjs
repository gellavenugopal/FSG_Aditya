/**
 * Pre-release self-test (0.1.122): Features > Tax Computation - Profit before tax -> Total Income -> tax, surcharge, cess ->
 * net tax payable, the Company / Partnership / Proprietorship differences, and interest u/s 234A / 234B / 234C.
 *   node tools/selftest-tax-computation.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let fails = 0
const ok = (what, cond, d = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + d}`) }
const eq = (a, b) => Math.abs(a - b) < 0.5
console.log('\nTax computation')
const T = await import(pathToFileURL(path.join(root, 'src/renderer/src/utils/taxComputation.js')).href)
const { computeTax, allowableRemuneration, monthsOrPart, yearDates } = T
const P = '2025-04-01 To 2026-03-31'

// ── Company ──
let c = computeTax({ group: 'company', pbt: 1000000, depCompanies: 200000, depIT: 300000, periodLabel: P }, { advanceTotal: 100000, tds: 20000, tcs: 5000 })
ok('company: first addition row is depreciation as per the Companies Act, first deduction depreciation as per the IT Act', c.additions[0].id === 'dep_co' && c.deductions[0].id === 'dep_it')
ok('company: Total Income = PBT + depreciation (Companies Act) - depreciation (IT Act)', eq(c.totalIncome, 900000), c.totalIncome)
ok('company: defaults 22% / 10% / 4% -> tax 1,98,000, surcharge 19,800, cess 8,712, total 2,26,512', eq(c.tax, 198000) && eq(c.surcharge, 19800) && eq(c.cess, 8712) && eq(c.totalTax, 226512), JSON.stringify([c.tax, c.surcharge, c.cess, c.totalTax]))
ok('company: net payable = total tax - advance - TDS - TCS', eq(c.netPayable, 226512 - 100000 - 20000 - 5000), c.netPayable)
c = computeTax({ group: 'company', pbt: 1000000, depCompanies: 200000, depIT: 300000, periodLabel: P }, { ov: { dep_co: 250000, dep_it: 0 } })
ok('company: the pulled depreciation figures can be typed over', eq(c.totalIncome, 1250000), c.totalIncome)
c = computeTax({ group: 'company', pbt: 500000, depCompanies: 0, depIT: 0, periodLabel: P }, { additions: [{ id: 'x', label: 'Penalty', amount: 10000 }], deductions: [{ id: 'y', label: 'Donation', amount: 5004 }], rate: 25, surcharge: 0, cess: 0 })
ok('rows can be added to each segment; rate, surcharge and cess are editable; Total Income is rounded to 10', eq(c.totalIncome, 505000) && eq(c.totalTax, 126250), JSON.stringify([c.totalIncome, c.totalTax]))
c = computeTax({ group: 'company', pbt: -200000, depCompanies: 50000, depIT: 0, periodLabel: P }, {})
ok('a loss carries no tax', c.totalTax === 0 && c.totalIncome < 0)

// ── Partnership ──
c = computeTax({ group: 'partnership', pbt: 800000, remuneration: 400000, depCompanies: 999999, depIT: 999999, periodLabel: P }, {})
ok('partnership: no depreciation rows; remuneration is the first addition', c.additions.length === 1 && c.additions[0].id === 'remun' && c.deductions.length === 0)
ok('partnership: Book Profit 12,00,000, allowable remuneration limited to the amount paid (4,00,000), taxable 8,00,000', eq(c.bookProfit, 1200000) && eq(c.allowable, 400000) && eq(c.totalIncome, 800000), JSON.stringify([c.bookProfit, c.allowable, c.totalIncome]))
ok('partnership: 30% default -> tax 2,40,000 + cess 9,600 = 2,49,600', eq(c.rate, 30) && eq(c.totalTax, 249600), c.totalTax)
ok('allowable remuneration: first 6,00,000 at 90% / 3,00,000, balance 60%', eq(allowableRemuneration(600000, 1e9), 540000) && eq(allowableRemuneration(1800000, 1e9), 540000 + 0.6 * 1200000) && eq(allowableRemuneration(100000, 1e9), 300000) && eq(allowableRemuneration(-50000, 1e9), 300000) && eq(allowableRemuneration(400000, 1e9), 360000))
c = computeTax({ group: 'partnership', pbt: 100000, remuneration: 2000000, periodLabel: P }, {})
ok('partnership: remuneration above the limit is disallowed (limit 14,40,000)', eq(c.allowable, 1440000), c.allowable)
c = computeTax({ group: 'partnership', pbt: -100000, remuneration: 200000, periodLabel: P }, {})
ok('partnership: a small Book Profit allows the remuneration paid up to the 3,00,000 floor', eq(c.bookProfit, 100000) && eq(c.allowable, 200000))
c = computeTax({ group: 'partnership', pbt: 800000, remuneration: 400000, periodLabel: P }, { ov: { allowable: 100000 } })
ok('partnership: the allowable remuneration can be typed over', eq(c.totalIncome, 1100000))

// ── Proprietorship ──
c = computeTax({ group: 'individual', pbt: 700000, depCompanies: 5, depIT: 5, remuneration: 5, periodLabel: P }, {})
ok('proprietorship: no depreciation or remuneration rows, and no default tax rate', c.additions.length === 0 && c.deductions.length === 0 && c.rate === 0 && c.totalTax === 0)
c = computeTax({ group: 'individual', pbt: 700000, periodLabel: P }, { rate: 20 })
ok('proprietorship: the rate typed is applied (20% + 4% cess)', eq(c.tax, 140000) && eq(c.totalTax, 145600), c.totalTax)

// ── Interest ──
ok('months or part of a month', monthsOrPart('2026-04-01', '2026-07-10') === 4 && monthsOrPart('2026-11-01', '2026-11-15') === 1 && monthsOrPart('2026-11-01', '2026-12-31') === 2 && monthsOrPart('2026-11-01', '2027-01-01') === 3 && monthsOrPart('2026-11-01', '2026-10-01') === 0)
const y = yearDates(P)
ok('year dates: instalments, 1 April of the assessment year, default due date', y.instalments[0] === '2025-06-15' && y.instalments[3] === '2026-03-15' && y.ayStart === '2026-04-01' && y.defaultDueDate === '2026-10-31' && y.ayLabel === '2026-27')
const base = { group: 'company', pbt: 1000000, depCompanies: 200000, depIT: 300000, periodLabel: P }
c = computeTax(base, { advance: [30000, 30000, 30000, 10000], tds: 20000, tcs: 5000, filingDate: '2026-07-10' })
ok('234C: shortfall by instalment (none for 15 June as 12% was paid; 920 + 1,834 + 1,015)', eq(c.interest.c, 3769), JSON.stringify(c.interest.cDetail.map(d => d.interest)))
ok('234B: advance tax below 90% of the assessed tax -> 4 months @1% on 1,01,512', eq(c.interest.bMonths, 4) && eq(c.interest.b, 4060), JSON.stringify([c.interest.bMonths, c.interest.b]))
ok('234A: nothing when filed before the due date', c.interest.a === 0)
c = computeTax(base, { advance: [30000, 30000, 30000, 10000], tds: 20000, tcs: 5000, filingDate: '2026-11-15' })
ok('234A: filed after the due date -> 1 month @1% on the tax unpaid', eq(c.interest.aMonths, 1) && eq(c.interest.a, 1015), JSON.stringify([c.interest.aMonths, c.interest.a]))
c = computeTax(base, { advance: [60000, 60000, 60000, 51512], tds: 20000, tcs: 5000, filingDate: '2026-07-10' })
ok('no 234B / 234C when the advance tax paid covers the assessed tax in time', c.interest.b === 0 && c.interest.c === 0, JSON.stringify([c.interest.b, c.interest.c]))
c = computeTax(base, { tds: 0, advanceTotal: 0 })
ok('the dates asked for are noted when missing', c.interest.notes.some(n => n.startsWith('234A')))
c = computeTax({ group: 'company', pbt: 20000, periodLabel: P }, { filingDate: '2026-07-10' })
ok('assessed tax below 10,000: no 234B / 234C', c.interest.b === 0 && c.interest.c === 0)

// today's date is the date of filing unless one is typed; presumptive taxation pays in one instalment
c = computeTax({ ...base, today: '2026-07-10' }, { advance: [30000, 30000, 30000, 10000], tds: 20000, tcs: 5000 })
ok('the date of filing is the current date by default', c.filingDate === '2026-07-10' && c.interest.bMonths === 4 && c.filingDateIsToday)
c = computeTax({ ...base, today: '2026-07-10' }, { advance: [30000, 30000, 30000, 10000], tds: 20000, tcs: 5000, filingDate: '2026-11-15' })
ok('...and a typed date wins', c.filingDate === '2026-11-15' && c.interest.aMonths === 1 && !c.filingDateIsToday)
c = computeTax({ group: 'individual', pbt: 700000, periodLabel: P, today: '2026-07-10' }, { rate: 30, advance: [0, 0, 0, 0], presumptive: true })
ok('presumptive: only the 15 March instalment is required (100%), 1 month', c.presumptive && c.interest.cDetail[0].required === 0 && eq(c.interest.cDetail[3].required, c.assessedTax) && c.interest.cDetail[3].months === 1)
c = computeTax({ group: 'individual', pbt: 700000, periodLabel: P, today: '2026-07-10' }, { rate: 30, advance: [0, 0, 0, 0] })
ok('not presumptive: the four instalments as for a company', !c.presumptive && eq(c.interest.cDetail[0].required, c.assessedTax * 0.15))
c = computeTax({ ...base, today: '2026-07-10' }, { presumptive: true })
ok('a company is never presumptive', c.presumptive === false)

// ── wiring ──
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const app = read('src/renderer/src/App.jsx'), nav = read('src/renderer/src/components/Layout/NavTabs.jsx')
ok("Features menu has the 'Tax Computation' item, and a keyboard shortcut", app.includes("'Features': ['ITR', 'Tax Computation'") && nav.includes("'Tax Computation': 'T'"))
ok('an Auditee with branches gets the Consolidated computation', app.includes("'Tax Computation'") && /ENTITY_LEVEL_TABS = new Set\(\[[^\]]*'Tax Computation'/.test(app))
const ui = read('src/renderer/src/components/TaxComputation/index.jsx'), io = read('src/renderer/src/utils/taxComputationIO.js')
ok('the screen takes PBT, depreciation (P&L) and the partners remuneration from the statements and the IT depreciation from Dep (IT)', io.includes('extractITRFigures(data)') && io.includes('depITGet') && io.includes('_profitBeforeTax') && ui.includes('buildTaxInput('))
ok('the screen saves per Auditee and Financial Year', ui.includes('saveTaxComputation') && read('src/main/ipc/cfs.js').includes('tax_computations') && read('src/main/db/schema.js').includes('CREATE TABLE IF NOT EXISTS tax_computations'))
ok('the screen has Upload saved Excel and Save Excel', ui.includes('Upload saved Excel') && ui.includes('parseSavedWorkbook(') && ui.includes('buildSavedWorkbook('))
const ex = read('src/renderer/src/components/ExceptionReport/index.jsx')
ok('the Exception Report shows Total Tax as per Computation against Current Tax as per the P&L', ex.includes('Total Tax as per Computation') && ex.includes('Current Tax as per P&L') && ex.includes('computeTax(inp, taxComp.saved)'))

ok('the Exception Report and the screen compare with the Current Tax line only (not deferred tax / the whole tax expense)', ex.includes('fig.taxCurrentOnly') && io.includes('fig.taxCurrentOnly') && read('src/renderer/src/utils/itrPull.js').includes('f.taxCurrentOnly'))

// the saved Excel round trip (a fresh Trial Balance upload must not lose the typed figures)
{
  const { createRequire } = await import('node:module')
  const req = createRequire(import.meta.url)
  const esbuild = req(path.join(root, 'node_modules', 'esbuild'))
  const reactShim = { name: 'react-shim', setup(b) { b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' })); b.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({ contents: 'module.exports = {}', loader: 'js' })) } }
  const built = await esbuild.build({ entryPoints: [path.join(root, 'src/renderer/src/utils/taxComputationIO.js')], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', loader: { '.js': 'jsx', '.jsx': 'jsx' }, nodePaths: [path.join(root, 'node_modules')], plugins: [reactShim], external: ['xlsx-js-style'] })
  const tmp = path.join(root, 'tools', '_taxio_tmp_' + process.pid + '.cjs')   // beside the tools, so xlsx-js-style resolves from node_modules
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  const IO = req(tmp)
  fs.rmSync(tmp, { force: true })
  const savedDoc = { ov: { pbt: 123456, dep_it: 5000 }, additions: [{ id: 'a', label: 'Penalty u/s 37', amount: 7000 }], deductions: [{ id: 'b', label: 'Donation', amount: 1000 }], rate: 25, surcharge: 7, cess: 4, advance: [100, null, 300, 400], advanceTotal: null, tds: 20000, tcs: 5, dueDate: '2026-10-31', filingDate: '2026-11-15', presumptive: false }
  const m0 = computeTax({ group: 'company', pbt: 1, depCompanies: 2, depIT: 3, periodLabel: P }, savedDoc)
  const wb = IO.buildSavedWorkbook({ entityName: 'X', title: 't', subtitle: 's', lines: IO.computationLines(m0), saved: savedDoc })
  const back = IO.parseSavedWorkbook(wb)
  ok('saved Excel: the typed figures come back (overrides, rows, rates, advance tax, TDS, dates)', back && back.ov.pbt === 123456 && back.ov.dep_it === 5000 && back.additions[0].label === 'Penalty u/s 37' && back.additions[0].amount === 7000 && back.deductions[0].amount === 1000 && back.rate === 25 && back.surcharge === 7 && back.advance[0] === 100 && back.advance[1] === null && back.advance[3] === 400 && back.tds === 20000 && back.tcs === 5 && back.dueDate === '2026-10-31' && back.filingDate === '2026-11-15', JSON.stringify(back))
  const same = computeTax({ group: 'company', pbt: 1, depCompanies: 2, depIT: 3, periodLabel: P }, back)
  ok('saved Excel: the restored figures give the same computation', same.totalTax === m0.totalTax && same.totalIncome === m0.totalIncome && same.netPayable === m0.netPayable)
  ok('saved Excel: a file that is not a saved computation is refused', IO.parseSavedWorkbook({ Sheets: { Sheet1: {} } }) === null)
}
console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
