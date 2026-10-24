/**
 * Pre-release self-test: amount and "To fix" filters (asked for 30 Sep 2026).
 *
 *  - Rectification / Recategorisation: the CY (or PY) column filters by typed
 *    amount — >100000, <1000, <0, 200000-300000, 400 — as the column shows it;
 *    an unreadable entry turns the box red and hides nothing. The "To fix"
 *    column filters To fix (anything) / Complete / one particular need.
 *  - Mapped TB and Mapped TB with Remarks (ag-grid): the same typed amounts in
 *    an amount column's filter box, read as displayed (Lakhs included).
 *
 * Renders the REAL Rectification screen (React, the app's compiled CSS) and a
 * real ag-grid with the shared filter settings in Electron, and types into the
 * filter boxes. Needs a previous build's out/renderer CSS.
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 *   node tools/selftest-amount-filters.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = process.env.FSG_SRC_ROOT ? path.resolve(process.env.FSG_SRC_ROOT) : root
const require = createRequire(pathToFileURL(path.join(root, 'package.json')).href)
const esbuild = require('esbuild')
const XLSX = require('xlsx')

let fails = 0
const ok = (what, cond, detail = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + detail}`) }
console.log('\nAmount filters (Rectification, Mapped TB) and the "To fix" filter')

const assets = path.join(root, 'out', 'renderer', 'assets')
const cssFile = fs.existsSync(assets) ? fs.readdirSync(assets).find(f => f.endsWith('.css')) : null
if (!cssFile) { ok('a previous build\'s out/renderer CSS is present', false, 'run a build once'); process.exit(1) }
const css = fs.readFileSync(path.join(assets, cssFile), 'utf8') + '\n' +
  ['ag-grid.css', 'ag-theme-alpine.css'].map(f => fs.readFileSync(path.join(root, 'node_modules/ag-grid-community/styles', f), 'utf8')).join('\n')

// Company Level Format from the real workbook; four ledgers.
const wb0 = XLSX.readFile(path.join(root, 'Mapping_v2.xlsx'))
const LF = XLSX.utils.sheet_to_json(wb0.Sheets.LevelFormat, { defval: null }).map((r, i) => ({
  id: i + 1, rule_set_id: 1, constitution: parseInt(r['Constitution']), alie: r['ALIE'], level1: r['Level 1'], level2: r['Level 2'], level3: r['Level 3'],
  level4: r['Level 4'], level5: r['Level 5'], level6: r['Level 6'], level7: r['Level 7'], sort_order: i,
})).filter(r => r.constitution === 3)
const TP = LF.find(r => r.level2 === 'Trade payables' && r.level3 && !/uncategorised/i.test(r.level3))
const TR = LF.find(r => r.level2 === 'Trade receivables')
const mk = (id, name, f, l3, closing) => ({ id, tb_row_id: id, name, closing_balance: closing, opening_balance: 0, alie: f.alie, trial_balance_type: f.alie,
  mapping1_resultant: f.level1, mapping2_resultant: f.level2, mapping3_resultant: l3, level1: f.level1, level2: f.level2, level3: l3, status: 'user_approved', rule_set_id: 1 })
const ledgers = [mk(1, 'Big Creditor', TP, TP.level3, 150000), mk(2, 'Small Creditor', TP, null, 400),
  mk(3, 'Debtor X', TR, TR.level3 || null, -250000), mk(4, 'Odd Debtor', TR, TR.level3 || null, 5000)]

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-selftest-amt-'))
const page = (name, entry) => {
  const out = esbuild.buildSync({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'iife',
    loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [path.join(root, 'node_modules')], logLevel: 'silent' })
  fs.writeFileSync(path.join(work, name), `<!DOCTYPE html><html><head><style>${css}</style></head><body><div id="root" style="height:900px"></div><script>${out.outputFiles[0].text}</script></body></html>`)
}
page('exc.html', `
import React from 'react'
import { createRoot } from 'react-dom/client'
import Exceptions from ${JSON.stringify(path.join(srcRoot, 'src/renderer/src/components/Exceptions/index.jsx'))}
const LEDGERS = ${JSON.stringify(ledgers)}, LF = ${JSON.stringify(LF)}
window.api = new Proxy({ findMappedByFilter: async () => LEDGERS, getLevelFormat: async () => LF, listLearnedRules: async () => [] }, { get: (t, k) => t[k] || (async () => []) })
createRoot(document.getElementById('root')).render(<Exceptions entity={{ id: 1, name: 'T', constitution: 3 }} activeTB={{ id: 1, period: '2025-04-01 To 2026-03-31' }} activeRsId={1} initialFilter={{}} />)
`)
let hasAgHelper = fs.existsSync(path.join(srcRoot, 'src/renderer/src/utils/amountFilter.js'))
page('grid.html', `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { AgGridReact } from 'ag-grid-react'
${hasAgHelper ? `import { agAmountFilter } from ${JSON.stringify(path.join(srcRoot, 'src/renderer/src/utils/amountFilter.js'))}` : 'const agAmountFilter = () => ({ filter: "agNumberColumnFilter" })'}
const rows = [{ n: 'A', v: 150000 }, { n: 'B', v: 400 }, { n: 'C', v: -5000 }, { n: 'D', v: 2500000 }]
window.__div = 1
function G() {
  return <div className="ag-theme-alpine" style={{ height: 400, width: 600 }}><AgGridReact rowData={rows} onGridReady={p => { window.__api = p.api }}
    defaultColDef={{ floatingFilter: true, filter: 'agTextColumnFilter' }}
    columnDefs={[{ field: 'n' }, { field: 'v', type: 'numericColumn', ...agAmountFilter(() => window.__div) }]} /></div>
}
createRoot(document.getElementById('root')).render(<G />)
`)
fs.writeFileSync(path.join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const fs = require('fs'), path = require('path')
const res = {}
setTimeout(() => { fs.writeFileSync(path.join(__dirname, 'result.json'), JSON.stringify({ ...res, timeout: true })); app.exit(1) }, 90000)
app.whenReady().then(async () => {
  try {
    const w = new BrowserWindow({ show: false, width: 1500, height: 1000 })
    const js = (s) => w.webContents.executeJavaScript(s)
    const wait = (ms) => new Promise(r => setTimeout(r, ms))
    await w.loadFile(path.join(__dirname, 'exc.html')); await wait(1500)
    const names = () => js("JSON.stringify([...document.querySelectorAll('tbody tr')].map(tr => tr.children[1]?.textContent.trim()).filter(Boolean))").then(JSON.parse)
    await js("(() => { const cb = [...document.querySelectorAll('label')].find(l => /Show all mapped rows/.test(l.textContent))?.querySelector('input'); if (cb && !cb.checked) cb.click() })()")
    await wait(800)
    res.all = await names()
    const amtSel = 'input[placeholder=">1000, <500, 1-5000"]'
    res.hasAmountBox = await js("!!document.querySelector(" + JSON.stringify(amtSel) + ")")
    res.amount = {}
    for (const v of ['>100000', '<1000', '<0', '200000-300000', '400', 'xyz']) {
      if (!res.hasAmountBox) break
      await js("(() => { const el = document.querySelector(" + JSON.stringify(amtSel) + "); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, " + JSON.stringify(v) + "); el.dispatchEvent(new Event('input', { bubbles: true })) })()")
      await wait(300)
      res.amount[v] = { rows: await names(), red: await js("document.querySelector(" + JSON.stringify(amtSel) + ").className.includes('border-red-400')") }
    }
    if (res.hasAmountBox) { await js("(() => { const el = document.querySelector(" + JSON.stringify(amtSel) + "); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })) })()"); await wait(300) }
    res.hasNeeds = await js("!!document.querySelector('thead select')")
    const pick = (v) => js("(() => { const el = document.querySelector('thead select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(el, " + JSON.stringify(v) + "); el.dispatchEvent(new Event('change', { bubbles: true })) })()")
    if (res.hasNeeds) {
      res.needsOptions = await js("JSON.stringify([...document.querySelector('thead select').options].map(o => o.textContent))").then(JSON.parse)
      await pick('__any__'); await wait(300); res.toFix = await names()
      await pick('__none__'); await wait(300); res.complete = await names()
      await pick('Mapping 3'); await wait(300); res.needM3 = await names()
    }
    await w.loadFile(path.join(__dirname, 'grid.html')); await wait(1500)
    const shown = () => js("(() => { const out = []; window.__api.forEachNodeAfterFilter(n => out.push(n.data.n)); return JSON.stringify(out) })()").then(JSON.parse)
    const typeFF = async (v) => { await js("(() => { const el = document.querySelectorAll('.ag-floating-filter input')[1]; if (!el) return; el.focus(); el.value = " + JSON.stringify(v) + "; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })) })()"); await wait(700) }
    res.grid = {}
    for (const v of ['>100000', '<1000', '<0', '1000-200000', '400', '']) { await typeFF(v); res.grid[v] = await shown() }
    await js('window.__div = 100000'); await typeFF('>10'); res.gridLakhs = await shown()
  } catch (e) { res.error = e.message }
  fs.writeFileSync(path.join(__dirname, 'result.json'), JSON.stringify(res))
  app.quit()
})`)
const electron = require('electron')
const run = spawnSync(electron, [path.join(work, 'main.cjs')], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000 })
const resFile = path.join(work, 'result.json')
const r = fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')) : null
fs.rmSync(work, { recursive: true, force: true })
if (!r) { ok('the screens rendered', false, 'no result from Electron: ' + String(run.stderr || '').slice(0, 600)); process.exit(1) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
ok('Rectification lists all four ledgers', same(r.all, ['Big Creditor', 'Small Creditor', 'Debtor X', 'Odd Debtor']), JSON.stringify(r.all) + (r.error ? ' ' + r.error : ''))
ok('Rectification: the CY column has an amount filter box', !!r.hasAmountBox)
const A = r.amount || {}
ok('... >100000 keeps Big Creditor and Debtor X (as shown, 1,50,000 / 2,50,000)', same(A['>100000']?.rows, ['Big Creditor', 'Debtor X']), JSON.stringify(A['>100000']))
ok('... <1000 keeps Small Creditor (400) and Odd Debtor (shown -5,000)', same(A['<1000']?.rows, ['Small Creditor', 'Odd Debtor']), JSON.stringify(A['<1000']))
ok('... <0 finds the balance on the wrong side (Odd Debtor)', same(A['<0']?.rows, ['Odd Debtor']), JSON.stringify(A['<0']))
ok('... 200000-300000 keeps Debtor X; 400 keeps Small Creditor', same(A['200000-300000']?.rows, ['Debtor X']) && same(A['400']?.rows, ['Small Creditor']))
ok('... an unreadable entry hides nothing and turns the box red', A.xyz?.rows?.length === 4 && A.xyz?.red === true, JSON.stringify(A.xyz))
ok('Rectification: "To fix" filter offers All / To fix / Complete / each need', !!r.hasNeeds && same(r.needsOptions, ['All', 'To fix (anything)', '✓ Complete', 'Needs: Mapping 3']), JSON.stringify(r.needsOptions))
ok('... To fix → Small Creditor; Complete → the other three; Needs: Mapping 3 → Small Creditor',
  same(r.toFix, ['Small Creditor']) && same(r.complete, ['Big Creditor', 'Debtor X', 'Odd Debtor']) && same(r.needM3, ['Small Creditor']), JSON.stringify([r.toFix, r.complete, r.needM3]))
const G = r.grid || {}
ok('Mapped TB grid: >100000, <1000, <0, 1000-200000, 400 filter the amount column',
  same(G['>100000'], ['A', 'D']) && same(G['<1000'], ['B', 'C']) && same(G['<0'], ['C']) && same(G['1000-200000'], ['A']) && same(G['400'], ['B']) && same(G[''], ['A', 'B', 'C', 'D']), JSON.stringify(G))
ok('Mapped TB grid: in Lakhs, >10 means more than 10 lakhs as displayed', same(r.gridLakhs, ['D']), JSON.stringify(r.gridLakhs))
console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
