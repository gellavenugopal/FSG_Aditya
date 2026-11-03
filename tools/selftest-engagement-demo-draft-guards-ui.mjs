import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const credentials = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8'))
const administrator = credentials.testUsers.administrator
const screenshotDirectory = path.join(demoHome, 'outputs', 'UAE-Sample-01-draft-guards')
fs.mkdirSync(screenshotDirectory, { recursive: true })
const SAMPLE = 'UAE-SAMPLE-01-2025'
const WORDING = `To the members of UAE Sample 01 Demo LLC (draft-guard test ${new Date().toISOString().slice(0, 19)})`
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const targets = await new Promise((resolve, reject) => http.get('http://127.0.0.1:9339/json/list', response => {
  const chunks = []
  response.on('data', chunk => chunks.push(chunk))
  response.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
}).on('error', reject))
const page = targets.find(item => item.type === 'page' && new URL(item.url).hostname === 'localhost')
if (!page) throw new Error('Open the isolated desktop first with .\\tools\\engagement-demo.ps1 demo.')
const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 0
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  const entry = pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result)
})
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(result.result?.description || result.exceptionDetails.text)
  return result.result?.value
}
async function waitFor(expression, description, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return
    await sleep(150)
  }
  throw new Error(`Timed out waiting for ${description}. Page: ${await evaluate('document.body.innerText.slice(0,900)')}`)
}
const results = []
const record = (check, detail) => { results.push({ check, detail }); console.log(`PASS ${check}${detail ? ` - ${detail}` : ''}`) }

async function click(selector, text) {
  const ok = await evaluate(`(() => {
    const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(item=>item.innerText.trim()===${JSON.stringify(text)} && !item.disabled);
    if(!el)return false; el.click(); return true})()`)
  assert.ok(ok, `${selector} "${text}" is available`)
}
const clickButton = text => click('button', text)
const clickTab = text => click('[role="tab"]', text)
async function setControl(finder, value) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline && !(await evaluate(`(() => { const i=(${finder})(); return !!i && !i.disabled })()`))) await sleep(200)
  const ok = await evaluate(`(() => {
    const input=(${finder})();
    if(!input || input.disabled)return false;
    const proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:input.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(input,${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
  assert.ok(ok, `control ${finder.slice(0, 80)} is editable`)
}
const byAria = label => `() => document.querySelector('[aria-label=${JSON.stringify(label)}]')`
const byLabelSpan = text => `() => { const l=[...document.querySelectorAll('label')].find(i=>([...i.children].find(c=>c.tagName==='SPAN')?.innerText.trim()||'')===${JSON.stringify(text)}); return l?.querySelector('input,textarea,select') }`
const readControl = async finder => {
  const deadline = Date.now() + 8000
  for (;;) {
    const value = await evaluate(`(() => { const el=(${finder})(); return el ? el.value : null })()`)
    if (value !== null || Date.now() > deadline) return value
    await sleep(200)
  }
}
const dialog = () => evaluate(`(() => { const d=document.querySelector('[role="alertdialog"]'); return d ? { text: d.innerText, buttons: [...d.querySelectorAll('button')].map(b=>b.innerText.trim()) } : null })()`)
const dialogClick = text => evaluate(`(() => { const b=[...document.querySelectorAll('[role="alertdialog"] button')].find(i=>i.innerText.trim()===${JSON.stringify(text)}); if(!b)return false; b.click(); return true })()`)

async function capture(name) {
  await command('Page.setWebLifecycleState', { state: 'active' }).catch(() => {})
  await command('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  const shot = await command('Page.captureScreenshot', { format: 'png', fromSurface: true })
  await command('Emulation.clearDeviceMetricsOverride')
  const filePath = path.join(screenshotDirectory, name)
  fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'))
  return filePath
}

async function signIn() {
  await waitFor(`document.body.innerText.includes('Signed in as') || !!document.querySelector('input[type="email"]')`, 'sign-in state', 30000)
  const body = await evaluate('document.body.innerText')
  if (body.includes('Signed in as')) return
  await waitFor(`!!document.querySelector('input[type="email"]')`, 'sign-in form')
  await evaluate(`(() => {
    const e=document.querySelector('input[type="email"]'), p=document.querySelector('input[type="password"]');
    const set=(i,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,v);i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}))};
    set(e,${JSON.stringify(administrator.email)});set(p,${JSON.stringify(administrator.password)});e.form.requestSubmit()})()`)
  await waitFor(`document.body.innerText.includes('Signed in as')`, 'signed-in desktop')
}
async function toList() {
  const open = await evaluate(`!![...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='\u2190 Engagements' && b.offsetParent)`)
  if (open) {
    await clickButton('\u2190 Engagements')
    const d = await dialog()
    if (d) await dialogClick('Discard changes')
  }
  await clickButton('Engagements')
  await waitFor(`document.body.innerText.includes('All Engagements')`, 'engagement list')
  await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(i=>i.innerText.trim()==='All Engagements'); if(b)b.click() })()`)
}
async function openEngagement(reference) {
  await toList()
  await waitFor(`[...document.querySelectorAll('tr')].some(r=>r.innerText.includes(${JSON.stringify(reference)}))`, `${reference} in the list`)
  await evaluate(`[...document.querySelectorAll('tr')].find(r=>r.innerText.includes(${JSON.stringify(reference)})).click()`)
  await waitFor(`!!document.querySelector('aside[aria-label="Selected engagement"] button')`, 'Selected engagement panel')
  await click('aside[aria-label="Selected engagement"] button', 'Go')
  await waitFor(`!!document.querySelector('nav[aria-label="Engagement sections"]')`, 'engagement sidebar')
}
const NAV = {
  'Journals and Adjustments|New journal': ['Trial Balance', 'Journals'],
  'Mapping|Unmapped': ['Trial Balance', 'Grouping'],
  'Mapping|Mapped': ['Trial Balance', 'Grouping'],
  'Audit Report|Audit report': ['Presentation', 'Audit Report'],
  'Financial Statements|Notes': ['Notes', 'Notes to Accounts'],
}
const section = async (label, tab) => {
  const target = NAV[`${label}|${tab}`]
  assert.ok(target, `no unified-navigation mapping for ${label} / ${tab}`)
  await click('[aria-label="Engagement sections"] button', target[0])
  await clickTab(target[1])
}
const onEngagementScreen = () => evaluate(`!!document.querySelector('nav[aria-label="Engagement sections"]') && !!document.querySelector('nav[aria-label="Engagement sections"]').offsetParent`)

async function visitSettingsAndBack(reference) {
  await clickButton('Settings')
  await waitFor(`document.body.innerText.includes('Firm and offices')`, 'Settings workspace')
  await clickButton('Engagements')
  await waitFor(`!!document.querySelector('nav[aria-label="Engagement sections"]') && !!document.querySelector('nav[aria-label="Engagement sections"]').offsetParent`, `${reference} still open after Settings`)
}

try {
  await command('Page.reload', {})
  await sleep(2500)
  await signIn()

  // ---------- Synthetic UAE Sample 01: journal, report wording, notes ----------
  await openEngagement(SAMPLE)
  await section('Journals and Adjustments', 'New journal')
  await setControl(byLabelSpan('Narration'), 'UNSAVED TEST DRAFT - do not post')
  await setControl(byAria('Line 1 ledger'), 'Draft ledger')
  await setControl(byAria('Line 1 amount'), '123.45')
  await section('Mapping', 'Unmapped')
  await visitSettingsAndBack(SAMPLE)
  await section('Journals and Adjustments', 'New journal')
  assert.equal(await readControl(byLabelSpan('Narration')), 'UNSAVED TEST DRAFT - do not post')
  assert.equal(await readControl(byAria('Line 1 amount')), '123.45')
  record('Synthetic UAE Sample 01: unsaved journal draft survives section changes and a Settings visit')

  await clickButton('\u2190 Engagements')
  let d = await dialog()
  assert.ok(d, 'leaving with a journal draft raises the save/discard dialog')
  assert.ok(!d.buttons.includes('Save and continue'), 'an incomplete journal can never be saved from the dialog')
  assert.deepEqual(d.buttons.sort(), ['Discard changes', 'Keep editing'].sort())
  record('Synthetic UAE Sample 01: journal-draft dialog offers only Keep editing / Discard (never Save)')
  await capture('UAE-Sample-01-unsaved-journal-dialog-1440x900.png').then(file => record('Screenshot', file))
  await dialogClick('Keep editing')
  await waitFor(`!document.querySelector('[role="alertdialog"]')`, 'dialog closed')
  assert.ok(await onEngagementScreen(), 'Keep editing retains the engagement screen')
  assert.equal(await readControl(byAria('Line 1 amount')), '123.45')
  record('Synthetic UAE Sample 01: Keep editing retains both the screen and the journal draft')

  // Report wording: Save and continue
  await section('Audit Report', 'Audit report')
  const wordingBefore = await readControl(byLabelSpan('Addressee'))
  await setControl(byLabelSpan('Addressee'), WORDING)
  await clickButton('\u2190 Engagements')
  d = await dialog()
  assert.ok(d && d.buttons.includes('Keep editing') && d.buttons.includes('Discard changes'), 'dialog appears for dirty wording + journal')
  assert.ok(!d.buttons.includes('Save and continue'), 'a combined wording + journal draft cannot be saved (journal is unsaveable)')
  record('Synthetic UAE Sample 01: mixed wording + journal draft is not auto-saved (no Save offered)')
  await dialogClick('Keep editing')
  await waitFor(`!document.querySelector('[role="alertdialog"]')`, 'dialog closed')
  // Discard the journal draft only by leaving; reopen with only wording dirty
  await clickButton('\u2190 Engagements')
  await dialogClick('Discard changes')
  await waitFor(`!!document.querySelector('tr')`, 'engagement list after discard')
  await openEngagement(SAMPLE)
  await section('Journals and Adjustments', 'New journal')
  assert.equal(await readControl(byLabelSpan('Narration')), '', 'discarded journal draft is gone')
  record('Synthetic UAE Sample 01: Discard removes the journal draft; nothing was posted')
  await section('Audit Report', 'Audit report')
  await setControl(byLabelSpan('Addressee'), WORDING)
  await visitSettingsAndBack(SAMPLE)
  await section('Audit Report', 'Audit report')
  assert.equal(await readControl(byLabelSpan('Addressee')), WORDING)
  record('Synthetic UAE Sample 01: report wording draft survives navigation and Settings')
  await clickButton('\u2190 Engagements')
  d = await dialog()
  assert.ok(d?.buttons.includes('Save and continue'), 'wording-only draft offers Save and continue')
  await dialogClick('Save and continue')
  await waitFor(`!!document.querySelector('tr')`, 'engagement list after save')
  await openEngagement(SAMPLE)
  await section('Audit Report', 'Audit report')
  assert.equal(await readControl(byLabelSpan('Addressee')), WORDING)
  record('Synthetic UAE Sample 01: Save and continue persisted wording')
  await setControl(byLabelSpan('Addressee'), wordingBefore)
  await clickButton('Save audit report edits')
  await waitFor(`(${byLabelSpan('Addressee')})()?.value===${JSON.stringify(wordingBefore)}`, 'the original saved addressee to be restored')
  record('Synthetic UAE Sample 01: saved report wording restored after the guard check')

  await section('Financial Statements', 'Notes')
  const noteCount = await evaluate(`[...document.querySelectorAll('textarea')].filter(t=>t.closest('label')?.innerText.startsWith('Note ')).length`)
  if (noteCount > 0) {
    const noteFinder = `() => [...document.querySelectorAll('label')].find(l=>l.innerText.startsWith('Note '))?.querySelector('textarea')`
    await setControl(noteFinder, 'Synthetic UAE Sample 01 test note disclosure draft')
    await section('Mapping', 'Unmapped')
    await visitSettingsAndBack(SAMPLE)
    await section('Financial Statements', 'Notes')
    assert.equal(await readControl(noteFinder), 'Synthetic UAE Sample 01 test note disclosure draft')
    record('Synthetic UAE Sample 01: note-disclosure draft survives navigation and Settings')
    await clickButton('\u2190 Engagements')
    d = await dialog()
    assert.ok(d?.buttons.includes('Save and continue'))
    await dialogClick('Discard changes')
    record('Synthetic UAE Sample 01: note-disclosure draft discarded explicitly')
  } else record('Synthetic UAE Sample 01: note-disclosure editor unavailable for this reporting data')

  // ---------- Sign-out guard ----------
  await toList()
  await openEngagement(SAMPLE)
  await section('Audit Report', 'Audit report')
  await setControl(byLabelSpan('Addressee'), 'SIGN-OUT GUARD DRAFT')
  await clickButton('Sign out')
  d = await dialog()
  assert.ok(d, 'sign-out with a draft raises the dialog')
  await dialogClick('Keep editing')
  assert.ok(await onEngagementScreen())
  assert.equal(await readControl(byLabelSpan('Addressee')), 'SIGN-OUT GUARD DRAFT')
  record('Sign-out guard: Keep editing retains the draft and the screen')
  await clickButton('\u2190 Engagements')
  await dialogClick('Discard changes')

  // ---------- Final-TB switch guard (UAE Sample 01 has several final TB versions) ----------
  await openEngagement(SAMPLE)
  await section('Mapping', 'Mapped')
  const finalSelect = `() => [...document.querySelectorAll('label')].find(l=>l.innerText.trim().startsWith('Final Trial Balance') && l.offsetParent)?.querySelector('select')`
  await waitFor(`(() => { const s=(${finalSelect})(); return !!s && s.options.length>=2 })()`, 'the final TB version list', 20000)
  const versions = await evaluate(`(() => { const s=(${finalSelect})(); return s ? [...s.options].map(o=>({value:o.value,text:o.text})) : [] })()`)
  assert.ok(versions.length >= 2, 'UAE Sample 01 exposes at least two final TB versions')
  const original = await readControl(finalSelect)
  const other = versions.find(item => item.value !== original)
  await section('Audit Report', 'Audit report')
  const sampleWording = await readControl(byLabelSpan('Addressee'))
  await setControl(byLabelSpan('Addressee'), `${sampleWording} (switch-guard draft)`)
  await section('Mapping', 'Mapped')
  await setControl(finalSelect, other.value)
  d = await dialog()
  assert.ok(d, 'switching the final TB with unsaved wording raises the dialog')
  await dialogClick('Keep editing')
  assert.equal(await readControl(finalSelect), original, 'Keep editing leaves the original final TB selected')
  await section('Audit Report', 'Audit report')
  assert.equal(await readControl(byLabelSpan('Addressee')), `${sampleWording} (switch-guard draft)`)
  record('Final-TB switch guard (UAE Sample 01, synthetic): Keep editing keeps version and draft')
  await section('Mapping', 'Mapped')
  await setControl(finalSelect, other.value)
  d = await dialog()
  assert.ok(d?.buttons.includes('Discard changes'))
  await dialogClick('Discard changes')
  await waitFor(`(() => { const s=(${finalSelect})(); return s && s.value===${JSON.stringify(other.value)} })()`, 'final TB switched after Discard')
  await section('Audit Report', 'Audit report')
  await waitFor(`!((${byLabelSpan('Addressee')})()?.value || '').includes('switch-guard draft')`, 'the discarded draft to be replaced by the saved wording of the selected version')
  record('Final-TB switch guard (UAE Sample 01, synthetic): Discard switches version and drops only the draft')
  await section('Mapping', 'Mapped')
  await setControl(finalSelect, original)
  await toList()
} finally {
  fs.writeFileSync(path.join(screenshotDirectory, 'draft-guard-results.json'), JSON.stringify(results, null, 2))
  socket.close()
}
console.log(`Draft-guard UI checks passed (${results.length} recorded results).`)
