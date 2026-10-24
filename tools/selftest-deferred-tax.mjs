/**
 * Pre-release self-test (0.1.125): Features > Deferred Tax - DTA / DTL by Approach 1 (timing difference of the year) and Approach 2
 * (WDV approach), each reconciled with the Deferred Tax of the Profit & Loss account.
 *   node tools/selftest-deferred-tax.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let fails = 0
const ok = (what, cond, d = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + d}`) }
const eq = (a, b) => Math.abs(a - b) < 0.01
console.log('\nDeferred tax')
const { computeDeferredTax, netTaxRate } = await import(pathToFileURL(path.join(root, 'src/renderer/src/utils/deferredTax.js')).href)

// net tax rate: 22% + 10% surcharge + 4% cess = 22 x 1.1 x 1.04 = 25.168%
ok('net tax rate = rate x (1 + surcharge) x (1 + cess): 22 / 10 / 4 -> 25.168', eq(netTaxRate(22, 10, 4), 25.168))
let m = computeDeferredTax({ group: 'company', bookDep: 100000, itDep: 100000 }, {})
ok('company defaults: 22% tax, 10% surcharge, 4% cess', m.rate === 22 && m.surcharge === 10 && m.cess === 4 && eq(m.netRate, 25.168))
m = computeDeferredTax({ group: 'partnership', bookDep: 0, itDep: 0 }, {})
ok('partnership default 30% / 0 / 4', m.rate === 30 && m.surcharge === 0 && m.cess === 4 && eq(m.netRate, 31.2))
m = computeDeferredTax({ group: 'individual', bookDep: 0, itDep: 0 }, {})
ok('proprietorship: no default rate', m.rate === 0 && m.netRate === 0)
m = computeDeferredTax({ group: 'individual', bookDep: 0, itDep: 0 }, { rate: 30 })
ok('proprietorship: the rate typed is used', eq(m.netRate, 31.2))

// ── Approach 1 ──
m = computeDeferredTax({ group: 'company', bookDep: 500000, itDep: 300000, plDeferredTax: 0 }, {})
ok('A1: books depreciation higher than IT -> timing difference (A - B) +2,00,000 -> DTA', eq(m.a1.depTD, 200000) && m.a1.kind === 'DTA')
ok('A1: DTA = 2,00,000 x 25.168% = 50,336', eq(m.a1.amount, 50336), m.a1.amount)
ok('A1: a DTA is a credit to the Profit & Loss account (-50,336)', eq(m.a1.charge, -50336))
m = computeDeferredTax({ group: 'company', bookDep: 100000, itDep: 400000, plDeferredTax: 75504 }, {})
ok('A1: IT depreciation higher -> negative timing difference -> DTL of 3,00,000 x 25.168% = 75,504', m.a1.kind === 'DTL' && eq(m.a1.netTD, -300000) && eq(m.a1.amount, 75504))
ok('A1: a DTL is a charge (+75,504) and agrees with the P&L deferred tax of 75,504 -> difference nil; the P&L is a DTL', eq(m.a1.charge, 75504) && eq(m.a1.difference, 0) && m.a1.plKind === 'DTL')
m = computeDeferredTax({ group: 'company', bookDep: 100000, itDep: 400000, plDeferredTax: -10000 }, {})
ok('A1: a P&L credit is a DTA; the difference is shown', m.a1.plKind === 'DTA' && eq(m.a1.difference, 75504 + 10000))
m = computeDeferredTax({ group: 'company', bookDep: 500000, itDep: 300000 }, { other1: [{ id: 'x', label: 'Provision for gratuity (s.43B)', amount: -50000 }] })
ok('A1: other timing differences are added to the net', eq(m.a1.netTD, 150000) && eq(m.a1.amount, 150000 * 0.25168))
m = computeDeferredTax({ group: 'company', bookDep: 500000, itDep: 300000 }, { ov: { bookDep: 450000, itDep: 450000 } })
ok('A1: the pulled figures can be typed over', eq(m.a1.depTD, 0) && m.a1.kind === null)

// ── Approach 2 ──
m = computeDeferredTax({ group: 'company', bookWdv: 1000000, itWdv: 700000, openDTA: 0, openDTL: 50000, plDeferredTax: 0 }, {})
ok('A2: IT WDV below books WDV -> negative cumulative difference (B - A) -> closing DTL', eq(m.a2.wdvTD, -300000) && m.a2.kind === 'DTL')
ok('A2: closing DTL = 3,00,000 x 25.168% = 75,504; no closing DTA', eq(m.a2.closingDTL, 75504) && m.a2.closingDTA === 0)
ok('A2: DTL to be created = closing - opening = 75,504 - 50,000 = 25,504, charge of 25,504', eq(m.a2.moveDTL, 25504) && eq(m.a2.charge, 25504))
ok('A2: opening plus the creation equals the ideal closing', eq(m.a2.openDTL + m.a2.moveDTL, m.a2.closingDTL))
m = computeDeferredTax({ group: 'company', bookWdv: 700000, itWdv: 1000000, openDTA: 20000, openDTL: 0, plDeferredTax: -55336 }, {})
ok('A2: IT WDV above books WDV -> closing DTA 75,504; DTA to be created 55,504', m.a2.kind === 'DTA' && eq(m.a2.closingDTA, 75504) && eq(m.a2.moveDTA, 55504))
ok('A2: the DTA created is a credit (-55,504); against the P&L (-55,336) the difference is -168', eq(m.a2.charge, -55504) && eq(m.a2.difference, -168))
m = computeDeferredTax({ group: 'company', bookWdv: 1000000, itWdv: 1000000, openDTA: 0, openDTL: 80000 }, {})
ok('A2: nil timing difference reverses the whole opening DTL (credit of 80,000)', eq(m.a2.closingDTL, 0) && eq(m.a2.moveDTL, -80000) && eq(m.a2.charge, -80000))
m = computeDeferredTax({ group: 'company', bookWdv: 1000000, itWdv: 700000, openDTA: 30000, openDTL: 0 }, {})
ok('A2: an opening DTA with a closing DTL: DTA fully reversed and DTL created (both are charges)', eq(m.a2.moveDTA, -30000) && eq(m.a2.moveDTL, 75504) && eq(m.a2.charge, 105504))
m = computeDeferredTax({ group: 'company', bookWdv: 1000000, itWdv: 700000, openDTA: 0, openDTL: 0, bsDTL: 70000 }, {})
ok('A2: closing DTL as per computation less DTL as per the Balance Sheet', eq(m.a2.bsDifferenceDTL, 5504))
m = computeDeferredTax({ group: 'company', bookWdv: 1000000, itWdv: 700000, openDTA: 0, openDTL: 0 }, { other2: [{ id: 'y', label: 'Unabsorbed depreciation', amount: 300000 }] })
ok('A2: other cumulative differences are added (net nil here)', eq(m.a2.cumTD, 0) && m.a2.kind === null)
m = computeDeferredTax({ group: 'company', bookWdv: 1000000, itWdv: 700000, openDTA: 0, openDTL: 0 }, { ov: { openDTL: 10000, itWdv: 600000 }, rate: 30, surcharge: 0, cess: 4 })
ok('A2: the figures and the rates can be typed over; opening DTL typed', eq(m.a2.openDTL, 10000) && eq(m.netRate, 31.2) && eq(m.a2.closingDTL, 400000 * 0.312))

// ── wiring ──
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const app = read('src/renderer/src/App.jsx'), nav = read('src/renderer/src/components/Layout/NavTabs.jsx'), ex = read('src/renderer/src/components/ExceptionReport/index.jsx')
ok("Features menu has 'Deferred Tax' with a keyboard shortcut", app.includes("'Tax Computation', 'Deferred Tax'") && nav.includes("'Deferred Tax': 'D'"))
ok('an Auditee with branches gets the Consolidated computation', /ENTITY_LEVEL_TABS = new Set\(\[[^\]]*'Deferred Tax'/.test(app))
const io = read('src/renderer/src/utils/deferredTaxIO.js'), ui = read('src/renderer/src/components/DeferredTax/index.jsx')
ok('the screen draws the P&L depreciation, Dep (IT) depreciation and WDV, Dep (Comp) WDV and the previous year DTA / DTL', io.includes('depITGet') && io.includes('depCompGet') && io.includes('blockSummary') && io.includes('netBlockClose') && io.includes('dtaPY') && ui.includes('buildDeferredInput('))
ok('it saves per Auditee and Financial Year', ui.includes('saveDeferredTax') && read('src/main/ipc/cfs.js').includes('deferred_tax_computations') && read('src/main/db/schema.js').includes('CREATE TABLE IF NOT EXISTS deferred_tax_computations'))
ok('the Exception Report shows both approaches against the P&L deferred tax', ex.includes('Deferred Tax - Approach 1') && ex.includes('Deferred Tax - Approach 2') && ex.includes('computeDeferredTax('))
console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
