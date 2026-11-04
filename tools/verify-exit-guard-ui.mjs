// Delayed-outcome verification of the guarded exit in the isolated UAT desktop (DevTools port 9339).
//   $env:FSG_TEST_TARGET_FILE = "$env:USERPROFILE\FSG-Aditya-engagement-demo\target.json"
//   node tools/verify-exit-guard-ui.mjs <phase>
// Phases (each needs a freshly launched UAT desktop):
//   cancel         exit dialog unanswered 10 s; Cancel after 5 s then 10 s survival; Alt+X, Alt+F4 (SC_CLOSE system command) and WM_CLOSE (title-bar Close)
//   delayed-keep   renderer blocked: native recovery dialog appears, "Keep window open" keeps window and draft
//   discard        Discard closes the window and the app exits (ends the desktop)
//   clean          no unsaved work: Alt+X exits normally (ends the desktop)
//   delayed-close  renderer blocked: native "Close without saving" closes only on that explicit choice (ends the desktop)
// Only a synthetic, unsaved create-engagement form is used; nothing is saved, posted or finalised.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'

const phase = process.argv[2]
assert.ok(['cancel', 'delayed-keep', 'discard', 'clean', 'delayed-close'].includes(phase), 'unknown phase')
assert.ok(process.env.FSG_TEST_TARGET_FILE, 'FSG_TEST_TARGET_FILE must point at the isolated demo target.json')
const here = path.dirname(fileURLToPath(import.meta.url))
const credentials = JSON.parse(fs.readFileSync(path.join(path.dirname(process.env.FSG_TEST_TARGET_FILE), 'credentials.json'), 'utf8'))
validateDemoUserCredentials(credentials.testUsers)
const administrator = credentials.testUsers.administrator
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const DRAFT = 'Exit guard synthetic draft'

// Window actions for the isolated UAT desktop (the process listening on DevTools port 9339), passed to PowerShell in memory.
// close = WM_CLOSE (title-bar Close); altf4 = WM_SYSCOMMAND/SC_CLOSE (the system command Windows issues for Alt+F4; no key
// press is injected); click = TDM_CLICK_BUTTON to the native message box (custom button id 100 + index); dismiss = WM_CLOSE to it.
const WINDOW_SCRIPT = String.raw`
param([string]$Action, [string]$Button = '')
$ErrorActionPreference = 'Stop'
$conn = Get-NetTCPConnection -State Listen -LocalPort 9339 -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $conn) { if ($Action -eq 'alive') { 'gone'; exit 0 } else { throw 'No isolated UAT desktop is listening on 9339.' } }
$targetPid = [int]$conn.OwningProcess
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class UatWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  public static IntPtr Find(uint pid, string cls, string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h)) return true;
      var c = new StringBuilder(256); var t = new StringBuilder(256);
      GetClassName(h, c, 256); GetWindowText(h, t, 256);
      if (c.ToString() == cls && t.ToString().StartsWith(title)) found = h;
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$main = [UatWin]::Find([uint32]$targetPid, 'Chrome_WidgetWin_1', 'FSG Bharat')
$dialog = [UatWin]::Find([uint32]$targetPid, '#32770', 'FSG Bharat')
switch ($Action) {
  'alive' { if ($main -ne [IntPtr]::Zero) { 'alive' } else { 'gone' } }
  'close' { [void][UatWin]::PostMessage($main, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); 'posted' }
  'altf4' { [void][UatWin]::PostMessage($main, 0x0112, [IntPtr]0xF060, [IntPtr]::Zero); 'posted' }
  'dialog' { if ($dialog -ne [IntPtr]::Zero) { 'present' } else { 'absent' } }
  'dismiss' { if ($dialog -eq [IntPtr]::Zero) { throw 'no native dialog' }; [void][UatWin]::PostMessage($dialog, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); 'posted' }
  'click' {
    if ($dialog -eq [IntPtr]::Zero) { throw 'no native dialog' }
    $index = @{ 'Keep window open' = 0; 'Close without saving' = 1 }[$Button]
    [void][UatWin]::PostMessage($dialog, 0x0466, [IntPtr](100 + $index), [IntPtr]::Zero); 'posted'
  }
}
`
const encodedWindowScript = Buffer.from(`& { ${WINDOW_SCRIPT} } -Action $env:UAT_ACTION -Button $env:UAT_BUTTON`, 'utf16le').toString('base64')
const native = (action, button = '') => execFileSync('powershell', ['-NoProfile', '-EncodedCommand', encodedWindowScript], { encoding: 'utf8', timeout: 60000, env: { ...process.env, UAT_ACTION: action, UAT_BUTTON: button } }).trim()
const desktopAlive = () => native('alive') === 'alive'
const nativeDialog = () => native('dialog') === 'present'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`)
}

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
const evaluate = async (expression, timeoutMs = 20000) => {
  const result = await Promise.race([
    command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }),
    sleep(timeoutMs).then(() => { throw new Error(`evaluate timed out: ${expression.slice(0, 60)}`) }),
  ])
  if (result.exceptionDetails) throw new Error(result.result?.description || result.exceptionDetails.text)
  return result.result?.value
}
async function pressAltKey(letter) {
  const base = { key: letter.toLowerCase(), code: `Key${letter}`, windowsVirtualKeyCode: letter.charCodeAt(0), nativeVirtualKeyCode: letter.charCodeAt(0), modifiers: 1 }
  await command('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
  await command('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}
async function pressEscape() {
  const base = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }
  await command('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
  await command('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}
const api = (method, argument) => evaluate(`window.api[${JSON.stringify(method)}](${JSON.stringify(argument)})`)
const jsDialog = () => evaluate(`!!document.querySelector('[role="alertdialog"]')`)
const draftPresent = () => evaluate(`[...document.querySelectorAll('input')].some(i => i.value === ${JSON.stringify(DRAFT)})`)
const state = async () => ({ alive: desktopAlive(), dialog: await jsDialog(), draft: await draftPresent() })

async function signIn() {
  if ((await api('engagementAuthStatus', null))?.user) return
  for (let attempt = 0; attempt < 100 && !(await evaluate(`!!document.querySelector('input[type="password"]')`)); attempt++) await sleep(200)
  await evaluate(`(() => {
    const email=document.querySelector('input[type="email"],input[autocomplete="username"],input[type="text"]'), pw=document.querySelector('input[type="password"]');
    const set=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))};
    set(email,${JSON.stringify(administrator.email)});set(pw,${JSON.stringify(administrator.password)});email.form.requestSubmit()})()`)
  for (let attempt = 0; attempt < 100 && !(await api('engagementAuthStatus', null))?.user; attempt++) await sleep(200)
  assert.ok((await api('engagementAuthStatus', null))?.user, 'Isolated sign-in did not complete.')
  await sleep(2500)
}
async function createDraft() {
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.offsetParent && /Create engagement/.test(b.textContent)).click()`)
  await sleep(900)
  await evaluate(`[...document.querySelectorAll('input:not([type]),input[type="text"]')].find(i => i.offsetParent && i.getAttribute('aria-label') !== 'Search engagements').focus()`)
  await command('Input.insertText', { text: DRAFT })
  await sleep(300)
  assert.ok(await draftPresent(), 'synthetic draft was not entered')
}
// One exit request through the named path; returns after the request was delivered.
async function requestExit(path) {
  if (path === 'Alt+X') await pressAltKey('X')
  else if (path === 'Alt+F4') native('altf4')
  else native('close')
  await sleep(900)
}

await command('Page.enable')
await command('Page.bringToFront')
await command('Emulation.setFocusEmulationEnabled', { enabled: true })
await command('Page.reload')
await sleep(3000)
await signIn()
for (let attempt = 0; attempt < 50 && !(await evaluate(`!!document.querySelector('nav[aria-label="Firm workspace"]')`)); attempt++) await sleep(200)
console.log(`PHASE ${phase}`)

if (phase === 'cancel') {
  await createDraft()
  for (const exitPath of ['Alt+X', 'Alt+F4', 'Title-bar Close']) {
    // 1. unanswered for 10 s
    await requestExit(exitPath)
    check(`${exitPath}: exit dialog shown`, await jsDialog())
    await sleep(10000)
    let s = await state()
    check(`${exitPath}: unanswered 10 s - window open, dialog still shown, draft kept`, s.alive && s.dialog && s.draft, JSON.stringify(s))
    check(`${exitPath}: no native recovery dialog while the renderer answered`, !nativeDialog())
    // 2. wait 5 s then Cancel; survive another 10 s
    await sleep(5000)
    await pressEscape()
    await sleep(800)
    s = await state()
    check(`${exitPath}: Cancel closes the dialog and keeps window and draft`, s.alive && !s.dialog && s.draft, JSON.stringify(s))
    await sleep(10000)
    s = await state()
    check(`${exitPath}: window and draft survive 10 s after Cancel`, s.alive && !s.dialog && s.draft && !nativeDialog(), JSON.stringify(s))
  }
  // Cancel cleared the pending request: a new request must work again
  await requestExit('Alt+X')
  check('A request after Cancel shows the dialog again (pending request was cleared)', await jsDialog())
  await pressEscape()
  await sleep(500)
  check('Final Cancel keeps window and draft', (await state()).alive && await draftPresent())
}

if (phase === 'delayed-keep' || phase === 'delayed-close') {
  await createDraft()
  // Block the renderer's main thread for 9 s (no await), then request exit through the real title-bar close message.
  const blocked = evaluate('(() => { const end = Date.now() + 9000; while (Date.now() < end) {} return 1 })()', 30000).catch(() => null)
  await sleep(300)
  native('close')
  await sleep(6500)
  const dialog = nativeDialog()
  check('Unresponsive renderer: native recovery decision is shown after the acknowledgement timeout', dialog)
  check('Unresponsive renderer: window was not closed automatically', desktopAlive())
  await blocked
  await sleep(1500)
  check('Native decision stays open until the user chooses (renderer recovered)', nativeDialog() && desktopAlive())
  if (phase === 'delayed-keep') {
    native('click', 'Keep window open')
    await sleep(1000)
    check('Keep window open: window alive, native dialog dismissed', desktopAlive() && !nativeDialog())
    // The renderer answered late with its own unsaved-changes dialog; Cancel it.
    if (await jsDialog()) await pressEscape()
    await sleep(800)
    await sleep(10000)
    const s = await state()
    check('Draft and window survive 10 s after Keep window open', s.alive && s.draft && !s.dialog && !nativeDialog(), JSON.stringify(s))
    await pressAltKey('X')
    await sleep(900)
    check('A new exit request works after the native decision', await jsDialog())
    await pressEscape()
    await sleep(600)
    check('Cancel keeps the draft', (await state()).draft)
  } else {
    native('click', 'Close without saving')
    await sleep(4000)
    check('Close without saving closes the window only on the explicit choice', !desktopAlive())
  }
}

if (phase === 'discard') {
  await createDraft()
  await pressAltKey('X')
  await sleep(900)
  check('Exit dialog shown before Discard', await jsDialog())
  await sleep(3000)
  check('Window still open before the decision', desktopAlive())
  await evaluate(`[...document.querySelectorAll('[role="alertdialog"] button')].find(b => /Discard/.test(b.textContent)).click()`)
  let gone = false
  for (let attempt = 0; attempt < 20 && !gone; attempt++) { await sleep(500); gone = !desktopAlive() }
  check('Discard closes the application normally', gone)
}

if (phase === 'clean') {
  check('Clean window has no unsaved dialog', !(await jsDialog()))
  pressAltKey('X').catch(() => {})
  let gone = false
  for (let attempt = 0; attempt < 20 && !gone; attempt++) { await sleep(500); gone = !desktopAlive() }
  check('Clean window exits normally on Alt+X', gone)
}

const failed = results.filter(r => !r.ok)
console.log(`\nEXIT GUARD ${phase} ${failed.length ? 'FAILED' : 'OK'}: ${results.length - failed.length}/${results.length} passed`)
try { socket.close() } catch { /* the desktop may have exited */ }
process.exit(failed.length ? 1 : 0)
