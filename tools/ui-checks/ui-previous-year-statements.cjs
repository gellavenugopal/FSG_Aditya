// Screen check (not part of the release gate): Profit & Loss / Balance Sheet with 'Previous Year figures' Required / Not required.
// Needs the fixture first: FSG_DUMP_ROWS=<temp>/adj_rows.json node tools/selftest-tb-adjustments.mjs
// Run: node_modules/electron/dist/electron.exe tools/ui-checks/ui-previous-year-statements.cjs (log in a fsg-py-ui-* folder in the temp folder).
// Renders the real Profit & Loss and Balance Sheet screens (Company) with real rows from the throw-away database
// (FSG_DUMP_ROWS of selftest-tb-adjustments.mjs) and a stubbed window.api, and drives "Previous Year figures":
// Required (a Previous Year with figures but no share count: EPS asks), Not required - "-" (EPS a dash, column
// shown), Not required - column left out (the Previous Year header and cells hidden).
const path = require('path'), fs = require('fs'), os = require('os')
const root = 'C:/Users/Aditya Maheshwari/Desktop/JE_Financial_App'
const esbuild = require(root + '/node_modules/esbuild')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-py-ui-'))
const fixture = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'adj_rows.json'), 'utf8'))
const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import PL from ${JSON.stringify(root + '/src/renderer/src/components/PL/index.jsx')}
import BS from ${JSON.stringify(root + '/src/renderer/src/components/BS/index.jsx')}
const FX = ${JSON.stringify(fixture)}
window.__mode = 'required'; window.__sets = []
window.api = new Proxy({
  getFinancialData: async (id) => id === 2 ? FX.py : FX.cy,
  getLevelFormat: async () => FX.lf,
  getEntityPeriod: async () => ({ id: 5, py_mode: window.__mode }),
  setEntityPeriodPYMode: async (id, mode) => { window.__sets.push([id, mode]); window.__mode = mode; return { id, py_mode: mode } },
  listNoteDetails: async () => [{ note_num: 1, note_title: 'Share capital', data: { classes: [{ type: 'Equity', faceValue: 10, cy: { subscribed: 100000 }, py: { subscribed: 0 } }] } }],
}, { get: (o, k) => k in o ? o[k] : (k === 'then' ? undefined : (() => Promise.resolve(/^list|Rows$|^get(Level|Rule)|TBList/.test(String(k)) ? [] : null))) })
const entity = { id: 1, name: 'ZZ Adjusted Co', constitution: 3, constitution_display: 'Company', business_type: 'Trader' }
const tb = { id: 1, entity_id: 1, period: '2025-26', entity_period_id: 5 }
function Host() {
  const [which, setWhich] = React.useState('PL')
  window.__show = setWhich
  const Show = which === 'PL' ? PL : BS
  return <div style={{ height: 900, width: 1100 }} className="flex flex-col"><Show entity={entity} activeTB={tb} prevTB={null} activeRsId={1} onPrevTBChange={() => {}} onNoteClick={() => {}} onFixNavigate={() => {}} /></div>
}
createRoot(document.getElementById('root')).render(<Host />)
`
const out = esbuild.buildSync({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'iife',
  loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [root + '/node_modules'] })
const appCss = fs.readFileSync(root + '/src/renderer/src/index.css', 'utf8')
const tw = fs.existsSync(root + '/out/renderer/assets') ? fs.readdirSync(root + '/out/renderer/assets').filter(f => f.endsWith('.css')).map(f => fs.readFileSync(root + '/out/renderer/assets/' + f, 'utf8')).join('\n') : ''
fs.writeFileSync(path.join(dir, 'page.html'), `<html><head><meta charset="utf-8"><style>${tw}</style><style>${appCss}</style></head><body><div id="root"></div><script>${out.outputFiles[0].text.split('</script>').join('<\\/script>')}</script></body></html>`)

const { app, BrowserWindow } = require('electron')
app.on('window-all-closed', () => {})
const log = []
const emit = m => { log.push(m); fs.writeFileSync(path.join(dir, 'out.txt'), log.join('\n') + '\n') }
let fails = 0
const ok = (what, cond, detail) => { if (!cond) fails++; emit(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + detail}`) }
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 1200, height: 1000 })
  const errs = []
  w.webContents.on('console-message', (e, l, m) => { if (l >= 3) errs.push(m.slice(0, 200)) })
  const js = s => w.webContents.executeJavaScript(s)
  const wait = ms => new Promise(r => setTimeout(r, ms))
  await w.loadFile(path.join(dir, 'page.html')); await wait(2500)
  const pyHeader = () => js(`(() => { const th = [...document.querySelectorAll('th')].find(t => /Previous Year/.test(t.innerText) || t.classList.contains('py-col')); if (!th) return { found: false }; return { found: true, display: getComputedStyle(th).display, text: th.innerText } })()`)
  const epsInputs = () => js(`[...document.querySelectorAll('input[type=number]')].map(i => ({ ph: i.placeholder, red: /red/.test(i.className), v: i.value }))`)
  const select = () => js(`(() => { const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => /Not required/.test(o.text))); return s ? { value: s.value, label: (s.parentElement.querySelector('label') || {}).innerText } : null })()`)
  const choose = async (v) => { await js(`(() => { const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => /Not required/.test(o.text))); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(v)}); s.dispatchEvent(new Event('change', { bubbles: true })) })()`); await wait(1800) }

  let sel = await select()
  ok('Profit & Loss shows "Previous Year figures:" with Required selected', sel && sel.value === 'required' && /Previous Year figures/.test(sel.label || ''), JSON.stringify(sel))
  let eps = await epsInputs()
  ok('Required, a Previous Year with figures but no share count: PY EPS still asks ("Fill Share Capital", red)', eps.some(e => e.ph === 'Fill Share Capital' && e.red), JSON.stringify(eps))
  let h = await pyHeader()
  ok('Required: the Previous Year column is there', h.found && h.display !== 'none', JSON.stringify(h))

  await choose('none_show')
  ok('choosing it saved against the Financial Year (5)', JSON.stringify(await js('window.__sets')) === JSON.stringify([[5, 'none_show']]), JSON.stringify(await js('window.__sets')))
  eps = await epsInputs()
  ok('Not required (column shown): PY EPS is a dash placeholder, not red, no "Fill Share Capital"', eps.every(e => e.ph !== 'Fill Share Capital') && eps.some(e => e.ph === '—' && !e.red), JSON.stringify(eps))
  h = await pyHeader()
  ok('...and the Previous Year column is still shown', h.found && h.display !== 'none', JSON.stringify(h))
  const txt1 = await js('document.body.innerText')
  ok('...the screen carries no shares-missing warning', !/not found in the Share Capital/i.test(txt1))

  await choose('none_hide')
  h = await pyHeader()
  ok('Not required (column left out): the Previous Year header is hidden', h.found && h.display === 'none', JSON.stringify(h))
  const cellsHidden = await js(`(() => { const cells = [...document.querySelectorAll('.py-col')]; return { n: cells.length, shown: cells.filter(c => getComputedStyle(c).display !== 'none').length } })()`)
  ok('...and so is every Previous Year cell (a good number of them)', cellsHidden.n > 20 && cellsHidden.shown === 0, JSON.stringify(cellsHidden))
  const disabledTitle = await js(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Manual PY/.test(x.innerText)); return b ? { disabled: b.disabled, title: b.title } : null })()`)
  ok('Manual PY is switched off while Previous Year is not required', disabledTitle && disabledTitle.disabled === true && /switched off/i.test(disabledTitle.title), JSON.stringify(disabledTitle))

  await js(`window.__show('BS')`); await wait(2000)
  h = await pyHeader()
  const bsCells = await js(`(() => { const cells = [...document.querySelectorAll('.py-col')]; return { n: cells.length, shown: cells.filter(c => getComputedStyle(c).display !== 'none').length } })()`)
  ok('Balance Sheet: Previous Year header, cells and <col> hidden too', h.found && h.display === 'none' && bsCells.n > 20 && bsCells.shown === 0, JSON.stringify([h, bsCells]))
  sel = await select()
  ok('...and it shows the same choice', sel && sel.value === 'none_hide', JSON.stringify(sel))

  await choose('required')
  h = await pyHeader()
  ok('Back to Required: the column is back', h.found && h.display !== 'none', JSON.stringify(h))
  ok('no console errors', errs.length === 0, errs.join(' || '))
  emit(fails ? `\n${fails} FAILURE(S)` : '\nAll checks passed')
  app.exit(fails ? 1 : 0)
})
setTimeout(() => { fs.appendFileSync(path.join(dir, 'out.txt'), 'TIMEOUT\n'); app.exit(2) }, 110000)
