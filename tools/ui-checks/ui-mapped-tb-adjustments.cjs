// Screen check (not part of the release gate): the real Mapped TB in Electron, Adjustments typed and checked.
// Run: node_modules/electron/dist/electron.exe tools/ui-checks/ui-mapped-tb-adjustments.cjs (the log is in the scratch folder, adj_out.txt).
// Renders the real Mapped TB screen with a stubbed window.api that behaves like the server
// (closing = imported + Adj Cr - Adj Dr, Cr positive / Dr negative), types Adjustments, and checks
// Clos Bal (as imported) / Adjustments / Revised Clos Bal, the totals row, the summary strip, the notices,
// the number-format gate and Clear all.
const path = require('path'), fs = require('fs')
const root = 'C:/Users/Aditya Maheshwari/Desktop/JE_Financial_App'
const esbuild = require(root + '/node_modules/esbuild')
const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fsg-ui-'))   // scratch folder for the page and the log
const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import MappedTB from ${JSON.stringify(root + '/src/renderer/src/components/MappedTB/index.jsx')}
const base = { status: 'user_approved', mapping1_resultant: 'x', mapping2_resultant: 'y', mapping3_resultant: null, alie: 'Expenses', ledger_code: '', opening_balance: '0', debit: '0', credit: '0', upload_nature: null }
// Server-side state: imported, adj_debit, adj_credit -> closing (what everything else reads)
const S = {
  1: { id: 1, name: 'Rent', is_deemed_positive: true, imported: -1000, d: null, c: null },
  2: { id: 2, name: 'Sales', is_deemed_positive: false, imported: 500, d: 25, c: null },
  3: { id: 3, name: 'Closing Stock - PL - X', is_deemed_positive: false, imported: 300, d: null, c: null, nature: 'Stock Entry' },
}
const closing = (r) => r.imported + (r.c || 0) - (r.d || 0)
const asRow = (r) => ({ ...base, id: r.id, name: r.name, is_deemed_positive: r.is_deemed_positive, upload_nature: r.nature || null,
  imported_closing_balance: String(r.imported), closing_balance: String(closing(r)), adj_debit: r.d == null ? null : String(r.d), adj_credit: r.c == null ? null : String(r.c) })
window.__saves = []; window.__alerts = []; window.__confirms = 0
window.alert = (m) => window.__alerts.push(String(m)); window.confirm = () => { window.__confirms++; return true }
const summary = () => {
  const rs = Object.values(S).filter(r => !r.nature)
  const adj = rs.filter(r => r.d != null || r.c != null)
  const td = rs.reduce((s, r) => s + (r.d || 0), 0), tc = rs.reduce((s, r) => s + (r.c || 0), 0)
  const rsum = rs.reduce((s, r) => s + closing(r), 0)
  return { rows_adjusted: adj.length, total_debit: td, total_credit: tc, difference: td - tc,
    revised_dr: rs.reduce((s, r) => s + Math.max(-closing(r), 0), 0), revised_cr: rs.reduce((s, r) => s + Math.max(closing(r), 0), 0),
    revised_sum: rsum, adjustments_balanced: Math.abs(td - tc) < 0.005, revised_balanced: Math.abs(rsum) <= 0.01 }
}
const t = { getMappedRows: async () => Object.values(S).map(asRow), getLevelFormat: async () => [], getRuleSets: async () => [],
  setAdjustment: async (id, d) => {
    window.__saves.push([id, d]); const r = S[id]
    if (r.nature) throw new Error('Opening / Closing Stock is maintained on the Stock tab - change it there, not by an adjustment.')
    if ('debit' in d) r.d = d.debit; if ('credit' in d) r.c = d.credit
    return { tb_row_id: id, adj_debit: r.d, adj_credit: r.c, closing_balance: String(closing(r)), imported_closing_balance: String(r.imported) }
  },
  getAdjustmentSummary: async () => summary(),
  clearAdjustments: async () => { Object.values(S).forEach(r => { r.d = null; r.c = null }); return { cleared: 2 } } }
window.api = new Proxy(t, { get: (o, k) => k in o ? o[k] : (k === 'then' ? undefined : (() => Promise.resolve([]))) })
const entity = { id: 1, name: 'T Co', constitution: 3, constitution_display: 'Company' }
const tb = { id: 1, period: '2025-04-01 To 2026-03-31', entity_period_id: 1 }
function Host() {
  const [fmt, setFmt] = React.useState('as_is')
  window.__setFmt = setFmt
  return <div style={{ height: 800, width: 2600 }} className="ag-theme-alpine"><MappedTB entity={entity} activeTB={tb} prevTB={null} onPrevTBChange={() => {}} activeRsId={null} numFormat={fmt} onNumFormatChange={setFmt} onOpenMappingRules={() => {}} /></div>
}
createRoot(document.getElementById('root')).render(<Host />)
`
const out = esbuild.buildSync({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'iife',
  loader: { '.js': 'jsx', '.jsx': 'jsx' }, define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [root + '/node_modules'] })
const js = out.outputFiles[0].text
const css = ['ag-grid.css', 'ag-theme-alpine.css'].map(f => fs.readFileSync(root + '/node_modules/ag-grid-community/styles/' + f, 'utf8')).join(' ')
fs.writeFileSync(path.join(dir, 'adj.html'), `<html><head><style>${css}</style></head><body><div id="root"></div><script>${js.split('</script>').join('<\\/script>')}</script></body></html>`)

const { app, BrowserWindow } = require('electron')
app.on('window-all-closed', () => {})
const log = []
const emit = m => { log.push(m); fs.writeFileSync(path.join(dir, 'adj_out.txt'), log.join('\n') + '\n') }
let fails = 0
const ok = (what, cond, detail) => { if (!cond) fails++; emit(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + detail}`) }
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 2700, height: 900 })
  const errs = []
  w.webContents.on('console-message', (e, l, m) => { if (l >= 3) errs.push(m.slice(0, 200)) })
  await w.loadFile(path.join(dir, 'adj.html'))
  await w.webContents.executeJavaScript(`localStorage.removeItem('fsg-mappedtb-columns')`)
  await w.loadFile(path.join(dir, 'adj.html'))
  const js = s => w.webContents.executeJavaScript(s)
  const wait = ms => new Promise(r => setTimeout(r, ms))
  await wait(2500)
  const COLS = "['closing_balance','clos_bal_debit','clos_bal_credit','adj_debit','adj_credit','rev_clos_debit','rev_clos_credit']"
  const cells = (i) => js(`(() => { const row = document.querySelectorAll('.ag-center-cols-container .ag-row[row-index="${i}"]')[0]; if (!row) return null; const g = c => { const e = row.querySelector('[col-id="' + c + '"]'); return e ? e.innerText.trim() : '-' }; const o = {}; ${COLS}.forEach(c => o[c] = g(c)); return o })()`)
  const pinned = () => js(`(() => { const row = document.querySelector('.ag-floating-bottom'); if (!row) return null; const g = c => { const e = row.querySelector('[col-id="' + c + '"]'); return e ? e.innerText.trim() : '-' }; const o = {}; ${COLS}.forEach(c => o[c] = g(c)); return o })()`)
  const type = async (rowIdx, col, text) => {
    await js(`(() => { const c = document.querySelectorAll('.ag-center-cols-container .ag-row[row-index="${rowIdx}"] [col-id="${col}"]')[0]; c.dispatchEvent(new MouseEvent('click', { bubbles: true })); c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })()`)
    await wait(250)
    const editing = await js(`!!document.querySelector('.ag-cell-inline-editing input')`)
    if (editing) {
      await js(`(() => { const i = document.querySelector('.ag-cell-inline-editing input'); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })) })()`)
      await wait(450)
    }
    return editing
  }
  const text = () => js(`document.body.innerText`)

  const heads = (await js(`[...document.querySelectorAll('.ag-header-cell-text')].map(e => e.innerText)`)).filter(h => /Clos|Adjust|Tally/.test(h))
  ok('the screen opens with Clos Bal (Debit), Clos Bal (Credit), Adjustments (Debit), Adjustments (Credit), Revised Clos Bal (Debit), Revised Clos Bal (Credit) - and no Tally Group',
    heads.join('|') === 'Clos Bal (Debit)|Clos Bal (Credit)|Adjustments (Debit)|Adjustments (Credit)|Revised Clos Bal (Debit)|Revised Clos Bal (Credit)', heads.join(' | '))
  let r0 = await cells(0), r1 = await cells(1)
  ok('Rent as imported: Clos Dr 1,000.00 = Revised Dr 1,000.00', r0.clos_bal_debit === '1,000.00' && r0.rev_clos_debit === '1,000.00' && r0.adj_debit === '', JSON.stringify(r0))
  ok('Sales with an Adj Dr 25 already: Clos Cr 500.00 | Adj Dr 25.00 | Revised Cr 475.00', r1.clos_bal_credit === '500.00' && r1.adj_debit === '25.00' && r1.rev_clos_credit === '475.00', JSON.stringify(r1))
  let txt = await text()
  ok('the summary strip shows 1 ledger adjusted', /Adjustments are applied/.test(txt) && /1 ledger/.test(txt), txt.slice(0, 300))

  ok('click -> edit opens on Adjustments (Debit)', await type(0, 'adj_debit', '1,200'))
  r0 = await cells(0)
  ok('typed 1,200 on Rent: Clos Dr stays 1,000.00 (as imported), Revised Dr = 1,000 + 1,200 - 0 = 2,200.00', r0.clos_bal_debit === '1,000.00' && r0.adj_debit === '1,200.00' && r0.rev_clos_debit === '2,200.00', JSON.stringify(r0))
  await type(1, 'adj_credit', '75')
  r1 = await cells(1)
  ok('typed 75 as Adj Cr on Sales (Adj Dr 25): Revised Cr = 500 + 75 - 25 = 550.00', r1.adj_credit === '75.00' && r1.rev_clos_credit === '550.00', JSON.stringify(r1))
  let p = await pinned()
  ok('totals row (the Stock row at 300 Cr included): Clos Dr 1,000.00 / Cr 800.00 as imported; Adj Dr 1,225.00 / Cr 75.00; Revised Dr 2,200.00 / Cr 850.00', p && p.clos_bal_credit === '800.00' && p.clos_bal_debit === '1,000.00' && p.adj_debit === '1,225.00' && p.adj_credit === '75.00' && p.rev_clos_debit === '2,200.00' && p.rev_clos_credit === '850.00', JSON.stringify(p))
  txt = await text()
  ok('summary strip now 2 ledgers, flagged out of balance', /2 ledgers/.test(txt) && /Out of balance/.test(txt), txt.slice(0, 300))

  await type(0, 'adj_debit', 'abc')
  r0 = await cells(0); txt = await text()
  ok('"abc" is not an amount: nothing changed, and the user is told', r0.adj_debit === '1,200.00' && /not an amount/.test(txt), JSON.stringify(r0))
  await type(0, 'adj_credit', '-5')
  r0 = await cells(0); txt = await text()
  ok('a negative amount is refused with the reason', r0.adj_credit === '' && /cannot be negative/.test(txt), JSON.stringify(r0))
  const saves = JSON.stringify(await js('window.__saves'))
  ok('...and neither reached the server', saves === JSON.stringify([[2 - 1, { debit: 1200 }], [2, { credit: 75 }]]), saves)

  await type(1, 'adj_debit', '')
  r1 = await cells(1)
  ok('clearing Sales Adj Dr: Revised Cr = 500 + 75 - 0 = 575.00', r1.adj_debit === '' && r1.rev_clos_credit === '575.00', JSON.stringify(r1))

  // a debit ledger carried to credit
  await type(0, 'adj_credit', '5000')
  r0 = await cells(0); txt = await text()
  ok('Rent: Adj Dr 1,200 and Adj Cr 5,000 -> Revised Dr = 1,000 + 1,200 - 5,000 = -2,800.00 (balance crossed to credit)', r0.rev_clos_debit === '-2,800.00', JSON.stringify(r0))
  ok('...and the user is warned the categorisation does not change by itself', /now carries a credit balance \(was debit\)/.test(txt), txt.slice(0, 500))

  // a stock row cannot be edited here
  ok('the Stock tab rows are not editable here', !(await type(2, 'adj_debit', '10')))
  // typing needs figures in rupees
  await js(`window.__setFmt('lakhs')`); await wait(400)
  ok('with the figures in Lakhs the Adjustments cells are not editable', !(await type(0, 'adj_debit', '7')))
  await js(`window.__setFmt('no_dec')`); await wait(400)
  ok('No Decimals is still rupees: editable', await type(0, 'adj_debit', '1200'))
  await js(`window.__setFmt('as_is')`); await wait(300)

  // Clear all
  const btn = await js(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Clear all adjustments/.test(x.innerText)); if (!b) return false; b.click(); return true })()`)
  await wait(700)
  r0 = await cells(0); r1 = await cells(1); txt = await text()
  ok('Clear all adjustments (after the confirm): imported figures back, strip gone', btn && r0.adj_debit === '' && r0.rev_clos_debit === '1,000.00' && r1.rev_clos_credit === '500.00' && !/Adjustments are applied/.test(txt) && (await js('window.__confirms')) === 1, JSON.stringify([btn, r0, r1, await js('window.__confirms')]))
  ok('no console errors', errs.length === 0, errs.join(' || '))
  emit(fails ? `\n${fails} FAILURE(S)` : '\nAll checks passed')
  app.exit(fails ? 1 : 0)
})
setTimeout(() => { fs.appendFileSync(path.join(dir, 'adj_out.txt'), 'TIMEOUT\n'); app.exit(2) }, 100000)
