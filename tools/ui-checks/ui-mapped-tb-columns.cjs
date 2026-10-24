// Screen check (not part of the release gate): the Mapped TB opens with its default columns, fits a 1100-1920px window
// without a sideways scrollbar, headers whole, Select all / Default view, and a picked column is remembered.
// Run: node_modules/electron/dist/electron.exe tools/ui-checks/ui-mapped-tb-columns.cjs (log and screenshots in the temp folder fsg-mtb-cols).
// Renders the real Mapped TB at several window widths: the default columns, no sideways scroll, headers whole,
// Select all / Default view, and that a picked column survives a reload. Saves a screenshot per width.
const path = require('path'), fs = require('fs'), os = require('os')
const root = 'C:/Users/Aditya Maheshwari/Desktop/JE_Financial_App'
const esbuild = require(root + '/node_modules/esbuild')
const dir = path.join(os.tmpdir(), 'fsg-mtb-cols'); fs.mkdirSync(dir, { recursive: true })
const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import MappedTB from ${JSON.stringify(root + '/src/renderer/src/components/MappedTB/index.jsx')}
const base = { status: 'user_approved', mapping1_resultant: 'Other expenses', mapping2_resultant: 'Rent', mapping3_resultant: null, alie: 'Expenses', ledger_code: 'L001', opening_balance: '0', debit: '0', credit: '0', upload_nature: null, group_parent: 'Indirect Expenses' }
const names = ['Office Rent', 'Sales - Goods', 'Salary and Wages to Employees including Bonus, Incentives and Reimbursements for the Branch Offices at Mumbai, Delhi and Chennai', 'HDFC Bank Current Account No. 50200012345678', 'ABC Suppliers Private Limited', 'Interest on Unsecured Loan from Directors and Their Relatives', 'Sundry Deposit', 'Closing Stock - PL - X', 'Printing & Stationery', 'Telephone & Internet Charges', 'Legal and Professional Fees', 'Depreciation']
const S = names.map((n, i) => ({ id: i + 1, name: n, is_deemed_positive: i % 2 === 0, imported: (i % 2 === 0 ? -1 : 1) * (123456789.5 - i * 4321987.25), d: i === 1 ? 12500.75 : null, c: i === 3 ? 100000 : null, nature: i === 7 ? 'Stock Entry' : null }))
const closing = (r) => r.imported + (r.c || 0) - (r.d || 0)
const asRow = (r) => ({ ...base, id: r.id, name: r.name, ledger_code: 'L' + String(r.id).padStart(3, '0'), is_deemed_positive: r.is_deemed_positive, upload_nature: r.nature,
  status: r.id % 5 === 0 ? 'auto_medium' : r.id % 7 === 0 ? 'unmapped' : 'user_approved',
  imported_closing_balance: String(r.imported), closing_balance: String(closing(r)), adj_debit: r.d == null ? null : String(r.d), adj_credit: r.c == null ? null : String(r.c) })
const t = { getMappedRows: async () => S.map(asRow), getLevelFormat: async () => [], getRuleSets: async () => [],
  getAdjustmentSummary: async () => ({ rows_adjusted: 2, total_debit: 12500.75, total_credit: 100000, difference: -87499.25, revised_dr: 1, revised_cr: 1, revised_sum: -87499.25, adjustments_balanced: false, revised_balanced: false }) }
window.api = new Proxy(t, { get: (o, k) => k in o ? o[k] : (k === 'then' ? undefined : (() => Promise.resolve([]))) })
const entity = { id: 1, name: 'T Co', constitution: 3, constitution_display: 'Company' }
const tb = { id: 1, period: '2025-04-01 To 2026-03-31', entity_period_id: 1 }
createRoot(document.getElementById('root')).render(<div style={{ height: window.innerHeight - 4, width: '100%' }} className="flex flex-col"><MappedTB entity={entity} activeTB={tb} prevTB={null} onPrevTBChange={() => {}} activeRsId={null} numFormat="as_is" onNumFormatChange={() => {}} onOpenMappingRules={() => {}} /></div>)
`
const out = esbuild.buildSync({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'iife',
  loader: { '.js': 'jsx', '.jsx': 'jsx' }, define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [root + '/node_modules'] })
const tw = fs.existsSync(root + '/out/renderer/assets') ? fs.readdirSync(root + '/out/renderer/assets').filter(f => f.endsWith('.css')).map(f => fs.readFileSync(root + '/out/renderer/assets/' + f, 'utf8')).join('\n') : ''
const css = ['ag-grid.css', 'ag-theme-alpine.css'].map(f => fs.readFileSync(root + '/node_modules/ag-grid-community/styles/' + f, 'utf8')).join(' ')
fs.writeFileSync(path.join(dir, 'page.html'), `<html><head><meta charset="utf-8"><style>html,body{margin:0;font-family:Segoe UI,Arial,sans-serif;font-size:14px} #root{height:100vh} .flex{display:flex}.flex-col{flex-direction:column}${css}</style><style>${tw}</style></head><body><div id="root"></div><script>${out.outputFiles[0].text.split('</script>').join('<\\/script>')}</script></body></html>`)

const { app, BrowserWindow } = require('electron')
app.on('window-all-closed', () => {})
const log = []
const emit = m => { log.push(m); fs.writeFileSync(path.join(dir, 'out.txt'), log.join('\n') + '\n') }
let fails = 0
const ok = (what, cond, detail) => { if (!cond) fails++; emit(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + detail}`) }
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 1200, height: 800, useContentSize: true })
  const errs = []
  w.webContents.on('console-message', (e, l, m) => { if (l >= 3) errs.push(m.slice(0, 200)) })
  const js = s => w.webContents.executeJavaScript(s)
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const load = async () => { await w.loadFile(path.join(dir, 'page.html')); await wait(2400) }
  await w.loadFile(path.join(dir, 'page.html'))
  await js(`localStorage.removeItem('fsg-mappedtb-columns')`)
  const DEFAULT = ['name', 'clos_bal_debit', 'clos_bal_credit', 'adj_debit', 'adj_credit', 'rev_clos_debit', 'rev_clos_credit', 'status']
  const measure = () => js(`(() => {
    const vp = document.querySelector('.ag-body-horizontal-scroll-viewport')
    const heads = [...document.querySelectorAll('.ag-header-cell[col-id]')].map(h => { const t = h.querySelector('.ag-header-cell-text'); const hb = h.getBoundingClientRect(), tb = t ? t.getBoundingClientRect() : null; return { id: h.getAttribute('col-id'), w: Math.round(hb.width), lines: t ? Math.round(tb.height / (parseFloat(getComputedStyle(t).lineHeight) || 14)) : 0, clipped: t ? (tb.bottom > hb.bottom + 1 || t.scrollWidth > t.clientWidth + 1) : false } })
    // amounts: any cell whose text is cut off (ellipsis)
    const cut = [...document.querySelectorAll('.ag-cell[col-id]')].filter(c => /clos_bal|adj_|rev_clos/.test(c.getAttribute('col-id')) && c.scrollWidth > c.clientWidth + 1).map(c => c.getAttribute('col-id') + ':' + c.innerText)
    const nameCell = document.querySelector('.ag-pinned-left-cols-container .ag-row[row-index="2"] [col-id="name"]')
    return { iw: window.innerWidth, grid: Math.round(document.querySelector('.ag-root-wrapper').getBoundingClientRect().width), hscroll: vp ? vp.scrollWidth > vp.clientWidth + 1 : false, vp: vp ? [vp.scrollWidth, vp.clientWidth] : null,
      scrollbarVisible: !!document.querySelector('.ag-body-horizontal-scroll') && document.querySelector('.ag-body-horizontal-scroll').getBoundingClientRect().height > 2,
      heads, cut, nameW: nameCell ? Math.round(nameCell.getBoundingClientRect().width) : null, cellFont: getComputedStyle(document.querySelector('.ag-cell')).fontSize }
  })()`)
  for (const [zoom, label] of [[1.09, '~1100'], [1.0, '~1200'], [0.75, '~1600'], [0.625, '~1920']]) {
    w.webContents.setZoomFactor(zoom)
    await load()
    const m = await measure()
    const named = m.heads.filter(h => isNaN(Number(h.id)))
    emit(`\n[${label}px wide] window ${m.iw}, grid ${m.grid}px, cell font ${m.cellFont}, name column ${m.nameW}px, centre scroll ${JSON.stringify(m.vp)}`)
    emit('  columns: ' + m.heads.map(h => `${h.id}(${h.w}px,${h.lines}l${h.clipped ? ',CLIPPED' : ''})`).join(' '))
    ok(`[${label}] opens with the default columns only`, DEFAULT.every(i => named.some(h => h.id === i)) && named.length === DEFAULT.length, named.map(h => h.id).join(','))
    ok(`[${label}] no sideways scrollbar`, !m.hscroll && !m.scrollbarVisible, JSON.stringify(m.vp) + ' visible=' + m.scrollbarVisible)
    ok(`[${label}] every header whole, on at most 3 lines`, m.heads.every(h => !h.clipped && h.lines <= 3), m.heads.filter(h => h.clipped || h.lines > 3).map(h => h.id + ':' + h.lines).join(','))
    ok(`[${label}] the amounts are not cut off`, m.cut.length === 0, m.cut.join(' | '))
    const cap = await w.webContents.capturePage()
    fs.writeFileSync(path.join(dir, 'shot_' + label.replace('~', '') + '.png'), cap.toPNG())
    await wait(600)
    const m3 = await measure()
    emit(`  after the capture: window ${m3.iw}, grid ${m3.grid}px, name ${m3.nameW}px, columns ` + m3.heads.map(h => h.id + ':' + h.w).join(' '))
  }
  // Columns panel
  w.webContents.setZoomFactor(1.0); await load()
  const click = (rx) => js(`(() => { const b = [...document.querySelectorAll('button')].find(x => /${rx}/.test(x.innerText)); if (!b) return false; b.click(); return true })()`)
  const panelOpen = () => js(`[...document.querySelectorAll('button')].some(x => /^Select all$/.test(x.innerText))`)
  const openPanel = async () => { if (!(await panelOpen())) { await click('^Columns'); await wait(300) } }
  await openPanel()
  ok('Columns panel offers Select all and Default view', await panelOpen() && await js(`[...document.querySelectorAll('button')].some(x => /^Default view$/.test(x.innerText))`))
  await click('^Select all$'); await wait(300)
  const checked = await js(`[...document.querySelectorAll('label input[type=checkbox]')].filter(i => i.checked).length`)
  const total = await js(`[...document.querySelectorAll('label input[type=checkbox]')].length`)
  ok('Select all ticks every column in the list', checked === total && total >= 20, `${checked}/${total}`)
  await click('^Default view$'); await wait(700)
  await openPanel()
  const checked2 = await js(`[...document.querySelectorAll('label')].filter(l => l.querySelector('input') && l.querySelector('input').checked).map(l => l.innerText.trim())`)
  ok('Default view ticks exactly the 8 default columns', checked2.length === 8 && ['Ledger Name', 'Status'].every(n => checked2.includes(n)), checked2.join(' | '))
  await js(`(() => { const l = [...document.querySelectorAll('label')].find(x => /^Mapping 1/.test(x.innerText.trim())); if (l) l.querySelector('input').click() })()`)
  await wait(500)
  await load()
  const after = (await measure()).heads.map(h => h.id)
  ok('a column picked in Columns is still there after a reload (it is remembered)', after.includes('mapping1'), after.join(','))
  const m2 = await measure()
  emit(`  with Mapping 1 added: centre scroll ${JSON.stringify(m2.vp)}`)
  ok('no console errors', errs.length === 0, errs.join(' || '))
  emit(fails ? `\n${fails} FAILURE(S)` : '\nAll checks passed')
  app.exit(fails ? 1 : 0)
})
setTimeout(() => { fs.appendFileSync(path.join(dir, 'out.txt'), 'TIMEOUT\n'); app.exit(2) }, 150000)
