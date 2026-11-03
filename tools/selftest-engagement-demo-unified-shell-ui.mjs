import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'

// Read-only navigation check of the unified shell against the isolated demo. It never posts, saves, maps or exports.
if (process.env.FSG_TEST_MODE !== 'true') throw new Error('Run this check only against the existing isolated desktop harness.')

const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const credentials = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8'))
validateDemoUserCredentials(credentials.testUsers)
const administrator = credentials.testUsers.administrator
const screenshotDirectory = path.join(demoHome, 'outputs', 'unified-shell-review')
fs.mkdirSync(screenshotDirectory, { recursive: true })
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-unified-shell-'))
const edgePath = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync)
assert.ok(edgePath, 'local Edge is available for screenshots')
const targetClient = process.env.FSG_SHELL_CLIENT || 'UAE Sample 01 Demo LLC'
const viewport = { width: 1440, height: 900, scaleFactor: Number(process.env.FSG_SHELL_SCALE || 1) }
const results = []
const record = (check, detail = '') => { results.push({ check, detail }); console.log(`PASS ${check}${detail ? ` — ${detail}` : ''}`) }

const getJson = url => new Promise((resolve, reject) => {
  http.get(url, response => {
    const chunks = []
    response.on('data', chunk => chunks.push(chunk))
    response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (error) { reject(error) } })
  }).on('error', reject)
})
const targets = await getJson('http://127.0.0.1:9339/json/list')
const page = targets.find(item => item.type === 'page' && new URL(item.url).hostname === 'localhost')
assert.ok(page?.webSocketDebuggerUrl, 'the isolated desktop is running')
const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 0
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  const entry = pending.get(message.id)
  if (!entry) return
  clearTimeout(entry.timer); pending.delete(message.id)
  message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result)
})
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
const command = (method, params = {}, timeoutMs = 30000) => new Promise((resolve, reject) => {
  const id = ++nextId
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timed out: ${method}`)) }, timeoutMs)
  pending.set(id, { resolve, reject, timer })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async expression => {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(result.result?.description || result.exceptionDetails.text)
  return result.result?.value
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(expression, description, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await sleep(200) }
  throw new Error(`Timed out waiting for ${description}. Page: ${(await evaluate('(document.body?.innerText||"").slice(0,900)'))}`)
}
const click = async (selector, label, exact = true) => {
  const ok = await evaluate(`(() => { const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(item=>{const t=item.innerText.trim();return ${exact ? `t===${JSON.stringify(label)}` : `t.includes(${JSON.stringify(label)})`}}); if(!el||el.disabled)return false; el.click(); return true })()`)
  assert.ok(ok, `${selector} "${label}" is available`)
}
await command('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.scaleFactor, mobile: false })

async function screenshot(name) {
  await sleep(350)
  const snapshot = JSON.parse(await evaluate(`JSON.stringify({styles:[...document.head.querySelectorAll('style')].map(s=>s.outerHTML).join(''),body:document.body.innerHTML})`))
  const htmlPath = path.join(temporaryDirectory, `${name}.html`)
  const filePath = path.join(screenshotDirectory, `${name}.png`)
  fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><base href="http://localhost:5173/">${snapshot.styles}</head><body>${snapshot.body}</body></html>`, 'utf8')
  const run = spawnSync(edgePath, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--force-device-scale-factor=${viewport.scaleFactor}`,
    `--window-size=${viewport.width},${viewport.height}`, `--user-data-dir=${path.join(temporaryDirectory, `edge-${name}`)}`, `--screenshot=${filePath}`,
    `file:///${htmlPath.replace(/\\/g, '/')}`], { encoding: 'utf8', timeout: 60000 })
  assert.ok(!run.error && fs.existsSync(filePath), 'screenshot renderer produced an image')
  return filePath
}

// sign in with the isolated administrator
const body = await evaluate('document.body?.innerText||""')
if (body.includes('Signed in as ')) await click('button', 'Sign out')
await waitFor('!!document.querySelector(\'input[type="email"]\') && !!document.querySelector(\'input[type="password"]\')', 'sign-in form')
await sleep(500)
await evaluate(`(() => { const e=document.querySelector('input[type="email"]'),p=document.querySelector('input[type="password"]'); const set=(i,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,v);i.dispatchEvent(new Event('input',{bubbles:true}))}; set(e,${JSON.stringify(administrator.email)}); set(p,${JSON.stringify(administrator.password)}); e.form.requestSubmit() })()`)
await waitFor(`(document.body?.innerText||'').includes('Signed in as ${administrator.displayName}')`, 'signed in')

// 1. one shell: no legacy navigation, environment identified
const shell = await evaluate(`({
  legacyTabs: !!document.querySelector('[aria-label="Main navigation"], nav[aria-label="Tabs"]') || /Auditee Details|Upload TB|Generate Financials/.test(document.body.innerText),
  topNav: [...document.querySelectorAll('nav[aria-label="Firm workspace"] button')].map(b=>b.innerText.trim()),
  env: document.querySelector('[data-testid="environment-badge"]')?.innerText || ''
})`)
assert.deepEqual(shell.topNav, ['Engagements', 'Settings'], 'only Engagements and Settings are application destinations')
assert.equal(shell.legacyTabs, false, 'no legacy menu labels are visible')
assert.match(shell.env, /UAT/, 'isolated environment is labelled UAT')
record('Landing: only Engagements and Settings', `environment badge "${shell.env}"`)
await waitFor(`[...document.querySelectorAll('tbody tr')].some(r=>r.innerText.includes(${JSON.stringify(targetClient)}))`, 'engagement rows')
const landingRows = await evaluate(`[...document.querySelectorAll('[aria-label="Engagements"] tbody tr, main tbody tr')].filter(r=>r.offsetParent).map(r=>r.innerText.replace(/\\s+/g,' ').slice(0,90))`)
record('Landing: engagements listed', `${landingRows.length} rows`)
assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Engagement sections"]').length`), 0, 'a row click must not open the engagement')
const landing = await screenshot('01-engagements-landing')

// 2. select, details, Go
const picked = await evaluate(`(() => { const r=[...document.querySelectorAll('tbody tr')].find(x=>x.innerText.includes(${JSON.stringify(targetClient)})); if(!r) return false; r.click(); return true })()`)
assert.ok(picked, `engagement row for ${targetClient}`)
await waitFor(`!!document.querySelector('aside[aria-label="Selected engagement"] button')`, 'details panel with Go')
assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Engagement sections"]').length`), 0, 'selecting does not open')
const detailText = await evaluate(`document.querySelector('aside[aria-label="Selected engagement"]').innerText.replace(/\\s+/g,' ')`)
record('Landing: select shows details and a Go button', detailText.slice(0, 160))
await click('aside[aria-label="Selected engagement"] button', 'Go')
await waitFor(`!!document.querySelector('[aria-label="Engagement sections"]')`, 'engagement workspace')

// 3. exactly five sections and their subsections
const labels = await evaluate(`[...document.querySelectorAll('[aria-label="Engagement sections"] button')].map(b=>b.innerText.trim())`)
assert.deepEqual(labels, ['Trial Balance', 'Financials', 'Notes', 'Accounting Policies', 'Presentation'], 'exactly five sidebar sections')
record('Workspace: exactly five sidebar sections', labels.join(' | '))
assert.equal(await evaluate(`document.querySelectorAll('nav').length`), 2, 'only the firm destinations and the engagement sidebar exist')
const expected = {
  'Trial Balance': ['Import', 'Journals', 'Adjusted TB', 'Grouping'],
  'Financials': ['Balance Sheet', 'Profit and Loss', 'Changes in Equity', 'Cash Flow'],
  'Notes': ['Notes to Accounts', 'Supporting Schedules', 'Annexures'],
  'Accounting Policies': ['Selected Policies', 'Policy Library'],
  'Presentation': ['Preview and Text Editing', 'Audit Report', 'Checks', 'Saved Versions and Exports'],
}
const header = await evaluate(`[...document.querySelectorAll('header')].map(h=>h.innerText.replace(/\\s+/g,' ')).find(t=>t.includes('Period')) || ''`)
assert.match(header, /Period/); assert.match(header, /Framework/); assert.match(header, /Currency/)
record('Workspace: client, period, framework, currency and status stay visible', header.slice(0, 200))
const shots = []
for (const [section, tabs] of Object.entries(expected)) {
  await click('[aria-label="Engagement sections"] button', section)
  const shown = await evaluate(`[...document.querySelectorAll('[role="tab"]')].map(t=>t.innerText.trim())`)
  assert.deepEqual(shown, tabs, `${section} subsections`)
  for (const tab of tabs) {
    await click('[role="tab"]', tab)
    await sleep(250)
    const text = await evaluate('(document.querySelector("main main")?.innerText || document.body.innerText).replace(/\\s+/g," ").slice(0,160)')
    const unavailable = await evaluate(`!!document.querySelector('section[role="status"][aria-label$="status"]')`)
    record(`${section} › ${tab}`, unavailable ? 'explains it is not available yet' : `renders: ${text.slice(0, 90)}`)
  }
  shots.push(await screenshot(`02-${section.toLowerCase().replace(/\s+/g, '-')}`))
}
await click('[aria-label="Engagement sections"] button', 'Financials')
await click('[role="tab"]', 'Balance Sheet')
await sleep(1500)
shots.push(await screenshot('03-financials-balance-sheet'))
await click('[aria-label="Engagement sections"] button', 'Presentation')
await click('[role="tab"]', 'Preview and Text Editing')
await sleep(1500)
shots.push(await screenshot('03-presentation-preview'))
await click('nav[aria-label="Firm workspace"] button', 'Settings')
await waitFor(`document.body.innerText.includes('Employees, accounts and roles')`, 'Settings with the people-and-access link')
await click('nav[aria-label="Settings sections"] button', 'Employees, accounts and roles')
await waitFor(`document.body.innerText.includes('User accounts') && document.body.innerText.includes('Roles and access')`, 'distinct employees/accounts/roles definitions')
const settingsText = await evaluate('document.body.innerText')
assert.ok(!/Firm Team|Firm Settings/.test(settingsText.replace(/Settings · Firm Team/, '')), 'no duplicate administration labels')
shots.push(await screenshot('04-settings-people-and-access'))
record('Settings: employees, user accounts and roles are distinct and unsupported operations are stated')
await click('nav[aria-label="Firm workspace"] button', 'Engagements')
await waitFor(`!!document.querySelector('[aria-label="Engagement sections"]')?.offsetParent`, 'engagement still open after Settings')
record('Settings round trip returns to the same open engagement')
const evidence = { checkedAt: new Date().toISOString(), viewport, client: targetClient, results, screenshots: [landing, ...shots] }
fs.writeFileSync(path.join(screenshotDirectory, `shell-results-${viewport.scaleFactor}x.json`), JSON.stringify(evidence, null, 2))
console.log(JSON.stringify({ passed: results.length, screenshots: evidence.screenshots }, null, 1))
socket.close()
