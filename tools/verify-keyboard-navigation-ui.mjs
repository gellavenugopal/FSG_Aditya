// Keyboard-only verification of the unified shell in the isolated UAT desktop (DevTools port 9339).
//   $env:FSG_TEST_TARGET_FILE = "$env:USERPROFILE\FSG-Aditya-engagement-demo\target.json"
//   node tools/verify-keyboard-navigation-ui.mjs [screenshotDirectory]
// Sends real key events. The only draft is an unsaved, empty-database-safe "Create engagement" form that is discarded;
// no engagement, journal, mapping or output is created or changed.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'

assert.ok(process.env.FSG_TEST_TARGET_FILE, 'FSG_TEST_TARGET_FILE must point at the isolated demo target.json')
const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const credentials = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8'))
validateDemoUserCredentials(credentials.testUsers)
const administrator = credentials.testUsers.administrator
const shots = process.argv[2] || process.env.TEMP
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const targets = await new Promise((resolve, reject) => http.get('http://127.0.0.1:9339/json/list', response => {
  const chunks = []
  response.on('data', chunk => chunks.push(chunk))
  response.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
}).on('error', reject))
const page = targets.find(item => item.type === 'page' && new URL(item.url).hostname === 'localhost')
assert.ok(page, 'Launch the isolated desktop first (.\\tools\\engagement-demo.ps1 demo).')
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
const evaluate = async expression => {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(result.result?.description || result.exceptionDetails.text)
  return result.result?.value
}
const KEYS = {
  Tab: { key: 'Tab', code: 'Tab', vk: 9 }, Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' }, Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Space: { key: ' ', code: 'Space', vk: 32, text: ' ' }, ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 }, ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  F1: { key: 'F1', code: 'F1', vk: 112 },
}
for (const letter of 'TFNAPSEX') KEYS[`Alt+${letter}`] = { key: letter.toLowerCase(), code: `Key${letter}`, vk: letter.charCodeAt(0), modifiers: 1 }
KEYS['Shift+Tab'] = { ...KEYS.Tab, modifiers: 8 }
async function press(name) {
  const k = KEYS[name]
  const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: k.modifiers || 0 }
  await command('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', ...base, ...(k.text ? { text: k.text } : {}) })
  await command('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  await sleep(350)
}
async function typeText(text) { await command('Input.insertText', { text }); await sleep(200) }
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
async function shot(name) {
  const { data } = await command('Page.captureScreenshot', { format: 'png' })
  const file = path.join(shots, `kbd-${name}.png`)
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  console.log(`SCREENSHOT ${file}`)
}
const api = (method, argument) => evaluate(`window.api[${JSON.stringify(method)}](${JSON.stringify(argument)})`)
const currentSection = () => evaluate(`document.querySelector('nav[aria-label="Engagement sections"] [aria-current="page"]')?.getAttribute('aria-label') || null`)
const topSection = () => evaluate(`document.querySelector('nav[aria-label="Firm workspace"] [aria-current="page"]')?.getAttribute('aria-label') || null`)
const dialogRole = () => evaluate(`document.querySelector('[role="alertdialog"]') ? 'alertdialog' : document.querySelector('[role="dialog"]') ? 'dialog' : null`)
const active = () => evaluate(`(() => { const e = document.activeElement; return e ? (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 60) : null })()`)

async function signIn() {
  if ((await api('engagementAuthStatus', null))?.user) return
  for (let attempt = 0; attempt < 50 && !(await evaluate(`!!document.querySelector('input[type="password"]')`)); attempt++) await sleep(200)
  await evaluate(`(() => {
    const email=document.querySelector('input[type="email"],input[autocomplete="username"],input[type="text"]'), pw=document.querySelector('input[type="password"]');
    const set=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))};
    set(email,${JSON.stringify(administrator.email)});set(pw,${JSON.stringify(administrator.password)});email.form.requestSubmit()})()`)
  for (let attempt = 0; attempt < 100 && !(await api('engagementAuthStatus', null))?.user; attempt++) await sleep(200)
  assert.ok((await api('engagementAuthStatus', null))?.user, 'Isolated sign-in did not complete.')
}

await command('Page.enable')
await command('Page.bringToFront')
await command('Emulation.setFocusEmulationEnabled', { enabled: true })
await command('Page.reload')
await sleep(3000)
await signIn()
for (let attempt = 0; attempt < 50 && !(await evaluate(`!!document.querySelector('nav[aria-label="Firm workspace"]')`)); attempt++) await sleep(200)
await sleep(1500)

// Mnemonics, tooltips and accessible names
const top = await evaluate(`[...document.querySelectorAll('nav[aria-label="Firm workspace"] button')].map(b => ({ name: b.getAttribute('aria-label'), title: b.title, underlined: b.querySelector('u')?.textContent || null }))`)
const expectedTop = { Engagements: ['E', 'Alt+E'], Settings: ['S', 'Alt+S'], Exit: ['X', 'Alt+X'] }
for (const [name, [letter, combo]] of Object.entries(expectedTop)) {
  const button = top.find(item => item.name === name)
  check(`${name}: underlined ${letter}, tooltip ${combo}`, button?.underlined?.toLowerCase() === letter.toLowerCase() && button.title.includes(combo), JSON.stringify(button))
}
check('Landing page is Engagements', await topSection() === 'Engagements')

// No engagement open
await press('Alt+T')
check('Alt+T without an open engagement explains itself', (await evaluate(`document.querySelector('nav[aria-label="Firm workspace"] [role="status"]')?.textContent || ''`)).includes('Open an engagement first'))
await press('Alt+S')
check('Alt+S opens Settings', await topSection() === 'Settings')
await shot('settings')
await press('Alt+E')
check('Alt+E returns to Engagements', await topSection() === 'Engagements')

// List arrow keys + Enter -> Go
const rows = await evaluate(`document.querySelectorAll('tr[data-engagement-id]').length`)
check('Engagements list has rows', rows >= 2, `${rows} rows`)
await evaluate(`document.querySelector('tr[data-engagement-id]').focus()`)
await press('ArrowDown')
check('ArrowDown selects the second row', await evaluate(`document.querySelectorAll('tr[data-engagement-id]')[1]?.getAttribute('aria-selected') === 'true' && document.activeElement === document.querySelectorAll('tr[data-engagement-id]')[1]`))
await press('ArrowUp')
check('ArrowUp selects the first row', await evaluate(`document.querySelectorAll('tr[data-engagement-id]')[0]?.getAttribute('aria-selected') === 'true'`))
await shot('list-row-focus')
await press('Enter')
for (let attempt = 0; attempt < 40 && !(await evaluate(`!!document.querySelector('nav[aria-label="Engagement sections"]')`)); attempt++) await sleep(250)
check('Enter activates Go and opens the engagement', await evaluate(`!!document.querySelector('nav[aria-label="Engagement sections"]')`))

// Engagement sections
const sectionBar = await evaluate(`[...document.querySelectorAll('nav[aria-label="Engagement sections"] button')].map(b => ({ name: b.getAttribute('aria-label'), title: b.title, underlined: b.querySelector('u')?.textContent || null }))`)
const expectedSections = { 'Trial Balance': 'T', Financials: 'F', Notes: 'N', 'Accounting Policies': 'A', Presentation: 'P' }
for (const [name, letter] of Object.entries(expectedSections)) {
  const button = sectionBar.find(item => item.name === name)
  check(`${name}: underlined ${letter}, tooltip Alt+${letter}`, button?.underlined?.toLowerCase() === letter.toLowerCase() && button.title.includes(`Alt+${letter}`), JSON.stringify(button))
}
for (const [combo, name] of [['Alt+F', 'Financials'], ['Alt+N', 'Notes'], ['Alt+A', 'Accounting Policies'], ['Alt+P', 'Presentation'], ['Alt+T', 'Trial Balance']]) {
  await press(combo)
  check(`${combo} selects ${name}`, await currentSection() === name, `selected: ${await currentSection()}`)
}
await press('Alt+F')
await press('Alt+S')
check('Settings round trip: Settings visible', await topSection() === 'Settings')
await press('Alt+E')
check('Settings round trip: engagement and Financials still open', await currentSection() === 'Financials')

// Tab order never changes the selection
await evaluate(`document.querySelector('nav[aria-label="Engagement sections"] button[aria-label="Notes"]').focus()`)
const before = await currentSection()
await press('Tab')
const afterTab = await active()
await press('Shift+Tab')
const afterShift = await active()
check('Tab moves focus without changing the selected section', before === 'Financials' && await currentSection() === 'Financials' && afterTab !== 'Notes', `Tab→${afterTab}; Shift+Tab→${afterShift}`)
check('Shift+Tab moves focus back', afterShift === 'Notes')
await press('Enter')
check('Enter activates the focused tab', await currentSection() === 'Notes')
await evaluate(`document.querySelector('nav[aria-label="Engagement sections"] button[aria-label="Financials"]').focus()`)
await press('Space')
check('Space activates the focused tab', await currentSection() === 'Financials')
const outline = await evaluate(`(() => { document.querySelector('nav[aria-label="Engagement sections"] button[aria-label="Notes"]').focus(); return getComputedStyle(document.activeElement).outlineStyle + ' ' + getComputedStyle(document.activeElement).outlineColor })()`)
check('Focus outline is shown', /solid/.test(outline), outline)
await shot('focus-outline')

// F1 reference and Esc
await press('F1')
check('F1 opens the shortcut reference', await dialogRole() === 'dialog')
await shot('f1-reference')
await press('Alt+T')
check('Section shortcuts are ignored while the reference is open', await currentSection() === 'Financials')
await press('Escape')
check('Esc closes the reference', await dialogRole() === null)

// Unsaved draft + guarded exit
await evaluate(`document.querySelector('button[aria-label="Back to engagements"]').click()`)
await sleep(600)
await evaluate(`[...document.querySelectorAll('button')].find(b => /Create engagement/.test(b.textContent)).click()`)
await sleep(800)
await evaluate(`(() => { const input = [...document.querySelectorAll('input:not([type]),input[type="text"]')].find(i => i.offsetParent && i.getAttribute('aria-label') !== 'Search engagements'); input.focus() })()`)
await typeText('Keyboard guard synthetic draft')
const typed = await evaluate(`document.activeElement.value`)
check('Normal typing works in a form field', typed === 'Keyboard guard synthetic draft')
await press('Alt+S')
await press('Alt+E')
check('Settings round trip preserves the unsaved form value', await evaluate(`[...document.querySelectorAll('input')].some(i => i.value === 'Keyboard guard synthetic draft')`))
await press('Alt+X')
check('Alt+X shows the unsaved-changes guard instead of exiting', await dialogRole() === 'alertdialog')
await shot('exit-guard')
check('Window is still alive after Alt+X', !!(await api('engagementAuthStatus', null)))
await press('Escape')
check('Esc cancels the exit and keeps the draft', await dialogRole() === null && await evaluate(`[...document.querySelectorAll('input')].some(i => i.value === 'Keyboard guard synthetic draft')`))
// Close button / Alt+F4 use the same main-process close event
await evaluate(`window.api.requestClose()`)
await sleep(800)
check('Window Close path shows the same guard', await dialogRole() === 'alertdialog')
await press('Escape')
check('Cancelling the Close path keeps the window and the draft', await dialogRole() === null && await evaluate(`[...document.querySelectorAll('input')].some(i => i.value === 'Keyboard guard synthetic draft')`))

// Clean up: discard the synthetic draft
await evaluate(`[...document.querySelectorAll('button')].find(b => b.offsetParent && /^Cancel$/.test(b.textContent.trim()))?.click()`)
await sleep(1200)
if (await dialogRole() === 'alertdialog') await evaluate(`[...document.querySelectorAll('[role="alertdialog"] button')].find(b => /Discard/.test(b.textContent)).click()`)
await sleep(1500)
check('Synthetic draft discarded; list restored', await evaluate(`[...document.querySelectorAll('button')].some(b => b.offsetParent && /Create engagement/.test(b.textContent))`))

const failed = results.filter(r => !r.ok)
console.log(`\nKEYBOARD VERIFY ${failed.length ? 'FAILED' : 'OK'}: ${results.length - failed.length}/${results.length} passed`)
socket.close()
process.exit(failed.length ? 1 : 0)
