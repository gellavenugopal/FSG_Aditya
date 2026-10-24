/**
 * Pre-release self-test: Dep (IT) for a COMPANY (asked 1 Oct 2026).
 *
 * A company maps its fixed-asset ledgers for Dep (Comp); mapping every ledger a
 * second time for the Income Tax blocks is impracticable. So for a company the
 * Dep (IT) screen lists NO ledgers: "+ Add Row" gives a blank row, the Block is
 * chosen from a drop-down of every block (grouped by major category), figures
 * typed in; the Block maths and Block Summary are unchanged, nothing is
 * reconciled against the books. Every other constitution is untouched: its
 * mapped ledgers are listed, with the "Amt as per TB" / Difference columns.
 *
 * Renders the REAL Dep (IT) screen (React, the app's compiled CSS) in Electron
 * with a stubbed window.api and drives it like a user.
 * Needs a previous build's out/renderer CSS.
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 *   node tools/selftest-dep-it-company.mjs
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
console.log('\nDep (IT): a Company fills its own blocks; other constitutions still map ledgers')

const assets = path.join(root, 'out', 'renderer', 'assets')
const cssFile = fs.existsSync(assets) ? fs.readdirSync(assets).find(f => f.endsWith('.css')) : null
if (!cssFile) { ok('a previous build\'s out/renderer CSS is present', false, 'run a build once'); process.exit(1) }
const css = fs.readFileSync(path.join(assets, cssFile), 'utf8')

const BLOCKS = [
  { id: 'furniture', majorCategory: 'II. FURNITURE AND FITTINGS', block: 'Furniture & Fittings incl Electrical Fittings', rate: 10 },
  { id: 'mp-general', majorCategory: 'III. MACHINERY AND PLANT', block: 'Machinery & Plant — General', rate: 15 },
  { id: 'computers', majorCategory: 'III. MACHINERY AND PLANT', block: 'Computers including Computer Software', rate: 40 },
  { id: 'intangible', majorCategory: 'INTANGIBLE ASSETS', block: 'Know-how, patents, copyrights', rate: 25 },
]
const MAPPED = [{ ledger_name: 'Office Computers', m3_name: 'Computers', is_deemed_positive: true, balance: '50000' },
  { ledger_name: 'Factory Building', m3_name: 'Buildings', is_deemed_positive: true, balance: '900000' }]

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-selftest-depit-'))
const page = (name, constitution, saved) => {
  const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import DepreciationIT from ${JSON.stringify(path.join(srcRoot, 'src/renderer/src/components/DepreciationIT/index.jsx'))}
window.__saved = null; window.__ledgerCalls = 0
const api = {
  depITBlocksMaster: async () => ${JSON.stringify(BLOCKS)}, depITBlocksCustom: async () => [],
  depITGetLedgers: async () => { window.__ledgerCalls++; return ${JSON.stringify(MAPPED)} },
  depITGet: async () => (${JSON.stringify(saved)}),
  depITSave: async (x) => { window.__saved = JSON.parse(JSON.stringify(x)); return { ok: true } },
}
window.api = new Proxy(api, { get: (t, k) => t[k] || (async () => null) })
createRoot(document.getElementById('root')).render(<DepreciationIT entity={{ id: 1, name: 'T', constitution: ${constitution} }} activeTB={{ id: 7, period: '2025-04-01 To 2026-03-31' }} />)
`
  const out = esbuild.buildSync({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'iife',
    loader: { '.js': 'jsx', '.jsx': 'jsx' }, define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [path.join(root, 'node_modules')], logLevel: 'silent' })
  fs.writeFileSync(path.join(work, name), `<!DOCTYPE html><html><head><style>${css}</style></head><body><div id="root" style="height:900px"></div><script>${out.outputFiles[0].text}</script></body></html>`)
}
// A company's old saved rows: one with figures (a former mapped ledger), one still empty.
const legacy = { rows: {
  'Office Computers': { block: 'computers', openingWDV: '40000', addBefore180: '', addAfter180: '10000', deduction: '' },
  'Factory Building': { block: '', openingWDV: '', addBefore180: '', addAfter180: '', deduction: '' } }, includeInPPENote: false }
page('company.html', 3, legacy)
page('firm.html', 1, null)

fs.writeFileSync(path.join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const fs = require('fs'), path = require('path')
const res = {}
setTimeout(() => { fs.writeFileSync(path.join(__dirname, 'result.json'), JSON.stringify({ ...res, timeout: true })); app.exit(1) }, 90000)
app.whenReady().then(async () => {
  try {
    const w = new BrowserWindow({ show: false, width: 1600, height: 1000 })
    const js = (s) => w.webContents.executeJavaScript(s)
    const wait = (ms) => new Promise(r => setTimeout(r, ms))
    const text = () => js('document.body.innerText')
    const btn = (rx) => js("(() => { const b = [...document.querySelectorAll('button')].find(b => " + rx + ".test(b.textContent)); if (!b) return false; b.click(); return true })()")
    const setVal = (sel, i, v, tag) => js("(() => { const el = document.querySelectorAll(" + JSON.stringify(sel) + ")[" + i + "]; if (!el) return false; const set = Object.getOwnPropertyDescriptor(window." + tag + ".prototype, 'value').set; set.call(el, " + JSON.stringify(v) + "); el.dispatchEvent(new Event(" + JSON.stringify(tag === 'HTMLSelectElement' ? 'change' : 'input') + ", { bubbles: true })); return true })()")

    // ── Company ──
    await w.loadFile(path.join(__dirname, 'company.html')); await wait(1500)
    res.co = {}
    res.co.ledgerCalls = await js('window.__ledgerCalls')
    let t = await text()
    res.co.mappedShown = /Factory Building|Office Computers/.test(t.replace(/Office Computers/, 'Office Computers'))
    res.co.inputs0 = await js("[...document.querySelectorAll('tbody tr')].map(tr => tr.querySelector('input')?.value || '').filter(Boolean).join('|')")
    res.co.hasAddRow = await btn(/\\+ Add Row/)
    await wait(400)
    res.co.selects = await js("document.querySelectorAll('tbody select').length")
    res.co.optgroups = await js("JSON.stringify([...document.querySelectorAll('tbody select')[document.querySelectorAll('tbody select').length - 1].querySelectorAll('optgroup')].map(g => [g.label, g.querySelectorAll('option').length]))")
    // the new (blank) row is the last one: choose Machinery & Plant — General, type figures
    const idx = res.co.selects - 1
    await setVal('tbody select', idx, 'mp-general', 'HTMLSelectElement'); await wait(300)
    // its inputs, found by row: description, opening, <180, >=180, deduction
    res.co.rowsAfterPick = await js("[...document.querySelectorAll('tbody tr')].map(tr => tr.textContent.slice(0, 60)).length")
    // find the row holding the machinery select
    await js("window.__row = [...document.querySelectorAll('tbody tr')].find(tr => tr.querySelector('select') && tr.querySelector('select').value === 'mp-general')")
    const rowInputs = await js("window.__row ? window.__row.querySelectorAll('input').length : -1")
    res.co.rowInputs = rowInputs
    const fill = (i, v) => js("(() => { const el = window.__row.querySelectorAll('input')[" + i + "]; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, " + JSON.stringify(v) + "); el.dispatchEvent(new Event('input', { bubbles: true })) })()")
    await fill(0, 'Plant at Unit 2'); await fill(1, '200000'); await fill(2, '40000'); await fill(3, '60000'); await fill(4, '10000'); await wait(300)
    await js("window.__row = [...document.querySelectorAll('tbody tr')].find(tr => tr.querySelector('select') && tr.querySelector('select').value === 'mp-general')")
    t = await text()
    res.co.text = t
    await btn(/^Save$/); await wait(600)
    res.co.saved = await js('JSON.stringify(window.__saved)')
    await btn(/Block Summary/); await wait(400)
    res.co.summary = await text()
    fs.writeFileSync(path.join(__dirname, 'company.png'), (await w.webContents.capturePage()).toPNG())

    // ── Partnership (regression) ──
    await w.loadFile(path.join(__dirname, 'firm.html')); await wait(1500)
    res.firm = { ledgerCalls: await js('window.__ledgerCalls'), text: await text() }
    res.firm.hasAddRow = await js("[...document.querySelectorAll('button')].some(b => /\\\\+ Add Row/.test(b.textContent))")
    res.firm.hasHideZero = /Hide zero-balance ledgers/.test(res.firm.text)
  } catch (e) { res.error = e.message }
  fs.writeFileSync(path.join(__dirname, 'result.json'), JSON.stringify(res))
  app.quit()
})`)
const electron = require('electron')
const run = spawnSync(electron, [path.join(work, 'main.cjs')], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000 })
const resFile = path.join(work, 'result.json')
const r = fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')) : null
fs.rmSync(work, { recursive: true, force: true })
if (!r) { ok('the screens rendered', false, 'no result from Electron: ' + String(run.stderr || '').slice(0, 500)); process.exit(1) }
if (r.error) ok('the driver ran without error', false, r.error)

const co = r.co || {}
ok('Company: the Mapped-TB ledgers are not fetched or listed (no mapping to do)', co.ledgerCalls === 0 && !/Factory Building/.test(co.text || ''), `calls=${co.ledgerCalls}`)
ok('Company: a row saved earlier with figures stays (nothing lost); its empty twin is dropped', /Office Computers/.test(co.inputs0 || '') && !/Factory Building/.test(co.inputs0 || ''), co.inputs0)
ok('Company: "+ Add Row" is there and adds a blank row', co.hasAddRow === true)
ok('Company: the Block drop-down offers every block, grouped by major category',
  JSON.stringify(JSON.parse(co.optgroups || "[]")) === JSON.stringify([['II. FURNITURE AND FITTINGS', 1], ['III. MACHINERY AND PLANT', 2], ['INTANGIBLE ASSETS', 1]]), co.optgroups)
const T = co.text || ''
// Machinery & Plant — General, 15%: Opening 2,00,000 + >=180d 60,000 - ded 10,000 = full-rate base 2,50,000 → 37,500; <180d 40,000 at half rate = 3,000 → 40,500; closing = 3,00,000+... = 2,90,000 - 40,500 = 2,49,500
ok('Company: filling a row computes the block exactly as before (15% → depreciation 40,500.00, closing WDV 2,49,500.00)', /Machinery & Plant — General — Total/.test(T) && /40,500\.00/.test(T) && /2,49,500\.00/.test(T), T.slice(0, 400))
ok('Company: nothing is reconciled against the books (no "Difference" figure, no TB amount)', !/Hide zero-balance/.test(T) && !/Difference:/.test(T))
let saved = null
try { saved = JSON.parse(co.saved || 'null') } catch { /* */ }
const rows = saved?.data?.rows || {}
const mp = Object.entries(rows).find(([, v]) => v.block === 'mp-general')
ok('Company: Save stores the new row (block, figures, description) and the block summary',
  !!mp && mp[1].openingWDV === '200000' && mp[1].addAfter180 === '60000' && mp[1].label === 'Plant at Unit 2' &&
  (saved.data.blockSummary || []).some(b => b.blockId === 'mp-general' && Math.abs(b.depreciation - 40500) < 1 && Math.abs(b.closingWDV - 249500) < 1), co.saved)
ok('Company: Block Summary tab lists both blocks without a Difference column figure', /Computers including Computer Software/.test(co.summary || '') && /Machinery & Plant — General/.test(co.summary || ''))

const f = r.firm || {}
ok('Partnership: its mapped ledgers are still listed (Office Computers, Factory Building)', f.ledgerCalls === 1 && /Office Computers/.test(f.text || '') && /Factory Building/.test(f.text || ''), f.text?.slice(0, 200))
ok('Partnership: no "+ Add Row"; "Hide zero-balance ledgers" and Difference still there', f.hasAddRow === false && f.hasHideZero === true && /Difference/.test(f.text || ''))
console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
