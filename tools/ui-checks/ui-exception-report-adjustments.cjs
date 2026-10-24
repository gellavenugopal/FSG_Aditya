// Screen check (not part of the release gate): Exception Report rows, the adjustments notice and the Actual TB banner.
// Needs the fixture first: FSG_DUMP_ROWS=<temp>/adj_rows.json node tools/selftest-tb-adjustments.mjs
// Run: node_modules/electron/dist/electron.exe tools/ui-checks/ui-exception-report-adjustments.cjs (the log is in the scratch folder, er_out.txt).
// Renders the real Exception Report, the AdjustmentNotice and the Actual TB banner with real rows from the
// throw-away database (FSG_DUMP_ROWS of selftest-tb-adjustments.mjs) and a stubbed window.api.
const path = require('path'), fs = require('fs'), os = require('os')
const root = 'C:/Users/Aditya Maheshwari/Desktop/JE_Financial_App'
const esbuild = require(root + '/node_modules/esbuild')
const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fsg-ui-'))   // scratch folder for the page and the log
const fixture = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'adj_rows.json'), 'utf8'))
const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import ExceptionReport from ${JSON.stringify(root + '/src/renderer/src/components/ExceptionReport/index.jsx')}
import AdjustmentNotice from ${JSON.stringify(root + '/src/renderer/src/components/shared/AdjustmentNotice.jsx')}
import ActualTBTable from ${JSON.stringify(root + '/src/renderer/src/components/TrialBalance/ActualTBTable.jsx')}
const FX = ${JSON.stringify(fixture)}
window.__mode = { balanced: true }
const sum = (bal) => bal ? FX.summary : { ...FX.summary, total_debit: 43000, difference: 1000, adjustments_balanced: false, revised_sum: -1000, revised_balanced: false, revised_dr: 1706000 }
window.api = new Proxy({
  getFinancialData: async (id) => id === 2 ? FX.py : FX.cy,
  getLevelFormat: async () => FX.lf,
  getAdjustmentSummary: async (arg) => arg === 2 ? { ...FX.summary, rows_adjusted: 2, total_debit: 5000, total_credit: 5000, revised_balanced: true } : sum(window.__mode.balanced),
  getTBRows: async () => [{ id: 1, name: 'Office Rent', closing_balance: '-50000', revised_closing_balance: '-60000', adj_debit: '10000', adj_credit: null, opening_balance: '0', debit: '0', credit: '0' }, { id: 2, name: 'Salary', closing_balance: '-100000', adj_debit: null, adj_credit: null, opening_balance: '0', debit: '0', credit: '0' }],
}, { get: (o, k) => k in o ? o[k] : (k === 'then' ? undefined : (() => Promise.resolve(/^list|Rows$|^get(Level|Rule)|TBList/.test(String(k)) ? [] : null))) })
const entity = { id: 1, name: 'ZZ Adjusted Co', constitution: 3, constitution_display: 'Company', business_type: 'Trader' }
const tb = { id: 1, entity_id: 1, period: '2025-26', entity_period_id: 1 }, prev = { id: 2, entity_id: 1, period: '2024-25' }
function Host() {
  const [which, setWhich] = React.useState('er')
  window.__show = setWhich
  return which === 'er' ? <div style={{ height: 800, width: 1500 }}><AdjustmentNotice entity={entity} activeTB={tb} prevTB={prev} refreshKey="x" onOpen={() => {}} /><ExceptionReport entity={entity} activeTB={tb} prevTB={prev} activeRsId={1} onPrevTBChange={() => {}} /></div>
       : <div style={{ height: 800, width: 1500 }}><ActualTBTable entity={entity} activeTB={tb} /></div>
}
createRoot(document.getElementById('root')).render(<Host />)
`
const out = esbuild.buildSync({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'iife',
  loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [root + '/node_modules'] })
const css = ['ag-grid.css', 'ag-theme-alpine.css'].map(f => fs.readFileSync(root + '/node_modules/ag-grid-community/styles/' + f, 'utf8')).join(' ')
fs.writeFileSync(path.join(dir, 'er.html'), `<html><head><style>${css}</style></head><body><div id="root"></div><script>${out.outputFiles[0].text.split('</script>').join('<\\/script>')}</script></body></html>`)

const { app, BrowserWindow } = require('electron')
app.on('window-all-closed', () => {})
const log = []
const emit = m => { log.push(m); fs.writeFileSync(path.join(dir, 'er_out.txt'), log.join('\n') + '\n') }
let fails = 0
const ok = (what, cond, detail) => { if (!cond) fails++; emit(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + detail}`) }
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 1600, height: 900 })
  const errs = []
  w.webContents.on('console-message', (e, l, m) => { if (l >= 3) errs.push(m.slice(0, 200)) })
  await w.loadFile(path.join(dir, 'er.html'))
  const js = s => w.webContents.executeJavaScript(s)
  const wait = ms => new Promise(r => setTimeout(r, ms))
  await wait(2500)
  let txt = await js('document.body.innerText')
  emit(txt.slice(0, 1800).replace(/\n+/g, ' | '))
  ok('notice: adjustments applied, 8 ledgers, Dr 42,000.00 / Cr 42,000.00, and 2 in the previous year', /Trial Balance adjustments are applied/.test(txt) && /8 ledgers adjusted \(Dr 42,000\.00 · Cr 42,000\.00\)/.test(txt) && /Previous Year Trial Balance: 2 ledgers adjusted/.test(txt), txt.slice(0, 400))
  ok('notice: amber, not red, while the revised Trial Balance balances', await js(`!!document.querySelector('.bg-amber-50.border-amber-200') && !document.querySelector('.bg-red-50.border-red-200.text-red-800')`))
  ok('Exception Report: a row for the adjustments, Dr against Cr', /Trial Balance adjustments \(8 ledgers\)/.test(txt) && /Adjustments \(Debit\) vs Adjustments \(Credit\)/.test(txt), '')
  ok('Exception Report: a row for the revised Trial Balance, Dr 1,705,000.00 against Cr 1,705,000.00', /Trial Balance after adjustments/.test(txt) && /17,05,000\.00/.test(txt), '')
  const rowsInfo = await js(`[...document.querySelectorAll('tbody tr')].filter(r => /Trial Balance (after )?adjustments/.test(r.innerText)).map(r => r.className)`)
  ok('...both rows green (nothing to resolve)', rowsInfo.length === 2 && rowsInfo.every(c => /bg-green-50/.test(c)), JSON.stringify(rowsInfo))
  // unbalanced
  await js(`window.__mode.balanced = false`)
  await js(`window.__show('x')`); await wait(200); await js(`window.__show('er')`); await wait(2500)
  txt = await js('document.body.innerText')
  ok('unbalanced: the notice turns red and says by how much', /out of balance by 1,000\.00/.test(txt) && !!(await js(`!!document.querySelector('.bg-red-50.border-red-200.text-red-800')`)), txt.slice(0, 500))
  const rowsRed = await js(`[...document.querySelectorAll('tbody tr')].filter(r => /Trial Balance (after )?adjustments/.test(r.innerText)).map(r => r.className)`)
  ok('...and both Exception Report rows turn red', rowsRed.length === 2 && rowsRed.every(c => /bg-red-50/.test(c)), JSON.stringify(rowsRed))
  ok('...and the count of differences includes them', /difference/.test(txt), txt.slice(0, 300))
  // Actual TB banner
  await js(`window.__show('tb')`); await wait(1500)
  txt = await js('document.body.innerText')
  ok('Actual TB: says it is the TB as uploaded, with 1 ledger adjusted', /as uploaded/.test(txt) && /1 ledger carries adjustments/.test(txt), txt.slice(0, 500))
  ok('no console errors', errs.length === 0, errs.join(' || '))
  emit(fails ? `\n${fails} FAILURE(S)` : '\nAll checks passed')
  app.exit(fails ? 1 : 0)
})
setTimeout(() => { fs.appendFileSync(path.join(dir, 'er_out.txt'), 'TIMEOUT\n'); app.exit(2) }, 100000)
