/**
 * Pre-release self-test: the Stock screen's Other-expenses head box, used the way a person uses it (0.1.93).
 *
 * Renders the REAL Stock screen (React) in Electron with a stand-in for window.api that behaves like the database (saveStock keeps the stock rows
 * with their head, getStockRows gives them back) and drives it: a row that has an amount and no head turns red and Save is held with a message
 * naming it; a real mouse click on the box opens the pick-list (this Trial Balance's heads, then the standard ones, each once); typing narrows
 * it, the first arrow-down lands on a match, Enter keeps what was typed (tidied, or matched to a listed spelling), clicking elsewhere keeps it,
 * the cross clears it; the save carries the amounts and exactly the heads of the categories that have one; the screen then shows what it saved.
 * Where each of the five fixed categories lands is read off the screen for a Manufacturer and for a Trader.
 * (The page's markup for each state is also checked without a browser, in tools/selftest-stock-heads.mjs.)
 *
 * Needs no compiled CSS: the checks are on behaviour, text and class names.
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source (to prove they fail on 0.1.92).
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-stock-ui.mjs
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

let fails = 0
const ok = (what, cond, detail = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + String(detail).slice(0, 400)}`) }
console.log(`\nThe Stock screen's head box, used like a person uses it${srcRoot !== root ? `  (source: ${srcRoot})` : ''}`)

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-selftest-stockui-'))
const cleanup = () => fs.rmSync(work, { recursive: true, force: true })
const STOCK_PAGE = JSON.stringify(path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'Stock', 'StockPage.jsx'))
const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import StockPage from ${STOCK_PAGE}
const STANDARD = ['Consumption of stores and spare parts', 'Power and fuel', 'Rent', 'Repairs to buildings', 'Repairs to machinery', 'Insurance', 'Printing and stationery', 'Miscellaneous expenses']
let persisted = []
window.__saved = []
const rowsFrom = (sd) => {
  const rows = [], head = (t) => (['Stores & Spares', 'Loose Tools', 'Others'].includes(t) && sd.heads && sd.heads[t]) || null
  for (const [t, v] of Object.entries(sd.opening || {})) rows.push({ name: 'Opening Stock - ' + t, closing_balance: -v, stock_head: head(t) })
  for (const [t, v] of Object.entries(sd.closing || {})) rows.push({ name: 'Closing Stock - PL - ' + t, closing_balance: v, stock_head: head(t) })
  for (const t of new Set([...Object.keys(sd.opening || {}), ...Object.keys(sd.closing || {})])) rows.push({ name: 'Closing Stock - BS - ' + t, closing_balance: -((sd.closing && sd.closing[t]) || 0), stock_head: head(t) })
  return rows
}
window.api = {
  getStockRows: async () => persisted.map(r => ({ ...r })),
  getOpeningStockCheck: async () => ({ isBalanced: true, embeddedOpening: 0, embeddedClosing: 0, litmusTotal: 0, hasManualOpeningStock: false }),
  getOtherExpenseHeads: async () => ({ inTB: [{ name: 'Rent', total: 100000 }, { name: 'Consumption of stores and spare parts', total: 200000 }], standard: STANDARD }),
  getTBList: async () => [],
  saveStock: async (x) => { window.__saved.push(JSON.parse(JSON.stringify(x))); persisted = rowsFrom(x.stockData); return { inserted: persisted.length } },
  saveFileDialog: async () => ({ canceled: true }), openFileDialog: async () => ({ canceled: true }), readFile: async () => [], writeFile: async () => {},
}
const bt = new URLSearchParams(location.search).get('bt') || 'Manufacturer'
createRoot(document.getElementById('root')).render(<div style={{ height: '100vh' }}><StockPage entity={{ id: 1, name: 'Test Co', business_type: bt, constitution: 3 }} activeTB={{ id: 1 }} prevTB={null} onPrevTBChange={() => {}} /></div>)
`
let htmlFile = null
try {
  const built = esbuild.buildSync({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' }, define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [path.join(root, 'node_modules')] })
  htmlFile = path.join(work, 'stock.html')
  fs.writeFileSync(htmlFile, `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>${built.outputFiles[0].text.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`)
} catch (e) { ok('the Stock screen builds', false, e && e.message) }

if (htmlFile) {
  const resultFile = path.join(work, 'result.json')
  const electron = require('electron')
  const run = spawnSync(electron, [path.join(root, 'tools', 'selftest-stock-ui-driver.cjs')], {
    stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000, env: { ...process.env, FSG_UI_HTML: htmlFile, FSG_UI_RESULT: resultFile },
  })
  const r = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : null
  if (!r) ok('the screen was driven', false, 'no result from Electron: ' + String(run.stderr || '').slice(0, 500))
  else {
    for (const c of r.results || []) ok(c.what, c.pass, c.detail)
    if (r.error) ok('the driver ran to the end', false, r.error)
    if (r.timeout) ok('the driver finished in time', false, 'timed out')
    ok('the checks ran (a source with no head box stops early and fails here)', (r.results || []).length >= 23 && !r.error && !r.timeout, `${(r.results || []).length} checks`)
  }
}
cleanup()
console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
