/**
 * Pre-release self-test: the Masters window (Auditor Firms / Auditor Members /
 * Signing Authorities) prints its names, designations and membership numbers
 * in a readable colour. It is rendered inside the blue top bar
 * (<header className="text-white">), and every cell without a colour of its own
 * inherited that white — the members' Name, Designation and Membership No. read
 * blank on a white window (reported 28 Sep 2026).
 *
 * Renders the REAL MastersModal (React, the app's compiled CSS, standards mode)
 * inside a white-text container in Electron and reads the computed colours.
 * Needs a previous build's out/renderer CSS (Release.ps1 builds after the gates).
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 *   node tools/selftest-masters-visible.mjs
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
const ok = (what, cond, detail = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + detail}`) }
console.log('\nMasters window: names and figures readable (rendered inside the white-text top bar)')

const assets = path.join(root, 'out', 'renderer', 'assets')
const cssFile = fs.existsSync(assets) ? fs.readdirSync(assets).find(f => f.endsWith('.css')) : null
if (!cssFile) { ok('a previous build\'s out/renderer CSS is present', false, 'run a build once'); process.exit(1) }
const css = fs.readFileSync(path.join(assets, cssFile), 'utf8')

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-selftest-masters-'))
const entry = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import MastersModal from ${JSON.stringify(path.join(srcRoot, 'src/renderer/src/components/shared/MastersModal.jsx'))}
const firms = [{ id: 1, firm_name: 'Test & Co.', frn: '123456E' }]
const members = [{ id: 11, firm_id: 1, name: 'CA. Test Partner', designation: 'Partner', membership_number: '061237', din: null }]
window.api = new Proxy({ listAuditorFirms: async () => firms, listGlobalSignatories: async () => members },
  { get: (t, k) => t[k] || (async () => []) })
createRoot(document.getElementById('root')).render(
  <header className="text-white" style={{ background: '#1e40af' }}><MastersModal entity={null} onClose={() => {}} /></header>)
`
const out = esbuild.buildSync({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'iife',
  loader: { '.js': 'jsx', '.jsx': 'jsx' }, define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [path.join(root, 'node_modules')] })
fs.writeFileSync(path.join(work, 'page.html'), `<!DOCTYPE html><html><head><style>${css}</style></head><body><div id="root"></div><script>${out.outputFiles[0].text}</script></body></html>`)
fs.writeFileSync(path.join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const fs = require('fs'), path = require('path')
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 1200, height: 800 })
  await w.loadFile(path.join(__dirname, 'page.html'))
  const js = (s) => w.webContents.executeJavaScript(s)
  await new Promise(r => setTimeout(r, 500))
  await js("[...document.querySelectorAll('button')].find(b => /Auditor Members/.test(b.textContent)).click()")
  await new Promise(r => setTimeout(r, 500))
  const res = await js("JSON.stringify([...document.querySelectorAll('td')].map(t => [t.textContent, getComputedStyle(t).color]))")
  fs.writeFileSync(path.join(__dirname, 'result.json'), res)
  app.quit()
})`)
const electron = require('electron')   // path to the Electron binary
spawnSync(electron, [path.join(work, 'main.cjs')], { stdio: 'ignore', timeout: 90000 })
const resFile = path.join(work, 'result.json')
const cells = fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')) : null
fs.rmSync(work, { recursive: true, force: true })
if (!cells) { ok('the window rendered', false, 'no result from Electron'); process.exit(1) }
const white = (c) => /rgba?\(255, 255, 255/.test(c)
for (const text of ['CA. Test Partner', 'Partner', '061237', '—']) {
  const cell = cells.find(([t]) => t === text)
  ok(`"${text}" is shown in a readable colour`, !!cell && !white(cell[1]), cell ? cell[1] : 'cell not found')
}
console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
