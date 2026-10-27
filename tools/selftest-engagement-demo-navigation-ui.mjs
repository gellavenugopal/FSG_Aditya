import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveDisposableTestTarget } from '../src/main/test-isolation.mjs'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'

if (process.env.FSG_TEST_MODE !== 'true') {
  throw new Error('Run this visual check only against the existing isolated desktop harness.')
}

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { target } = resolveDisposableTestTarget()
const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const credentials = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8'))
validateDemoUserCredentials(credentials.testUsers)
const administrator = credentials.testUsers.administrator
const engagementReference = 'UAE-SAMPLE-01-2025'
const engagementName = 'UAE Sample 01 Demo LLC'
const screenshotDirectory = path.join(demoHome, 'outputs', 'engagement-navigation-review')
fs.mkdirSync(screenshotDirectory, { recursive: true })
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-engagement-navigation-'))
const edgePath = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(candidate => fs.existsSync(candidate))
assert.ok(edgePath, 'an already-installed local Edge renderer is available for screenshots')

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (error) { reject(new Error('Could not read the isolated Electron automation endpoint.', { cause: error })) }
      })
    }).on('error', reject)
  })
}

let page
const pageDeadline = Date.now() + 30000
while (!page && Date.now() < pageDeadline) {
  const targets = await getJson('http://127.0.0.1:9339/json/list')
  page = targets.find(item => {
    if (item.type !== 'page') return false
    const url = new URL(item.url)
    return url.hostname === 'localhost' && Number(url.port) >= 5173 && Number(url.port) <= 5180
  })
  if (!page) await new Promise(resolve => setTimeout(resolve, 250))
}
assert.ok(page?.webSocketDebuggerUrl, 'the existing isolated desktop is running; launch it separately first')

const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let nextCommandId = 0
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (!message.id || !pending.has(message.id)) return
  const { resolve, reject, timer } = pending.get(message.id)
  clearTimeout(timer)
  pending.delete(message.id)
  if (message.error) reject(new Error(message.error.message))
  else resolve(message.result)
})
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

function command(method, params = {}, timeoutMs = 30000) {
  const id = ++nextCommandId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Electron automation command timed out: ${method}`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  })
  if (result.exceptionDetails) throw new Error(result.result?.description || result.exceptionDetails.text)
  return result.result?.value
}

async function waitFor(expression, description, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  const pageText = await evaluate('(document.body?.innerText || "").slice(0, 1800)')
  throw new Error(`Timed out waiting for ${description}. Visible page text: ${pageText}`)
}

async function clickButton(label, required = true) {
  const result = await evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find(item=>item.innerText.trim()===${JSON.stringify(label)});
    if(!button || button.disabled)return false;
    button.click();
    return true;
  })()`)
  if (required) assert.ok(result, `the visible "${label}" button is available`)
  return result
}

async function clickTab(label) {
  const clicked = await evaluate(`(() => {
    const tab=[...document.querySelectorAll('[role="tab"]')].find(item=>item.innerText.trim()===${JSON.stringify(label)});
    if(!tab)return false;
    tab.click();
    return true;
  })()`)
  assert.ok(clicked, `the "${label}" subsection tab is available`)
}

async function signInNormally() {
  const identity = `Signed in as ${administrator.displayName} · FSG Isolated Demo Firm`
  const body = await evaluate('document.body?.innerText || ""')
  if (body.includes(identity)) return
  if (body.includes('Signed in as ')) await clickButton('Sign out')
  await waitFor('!!document.querySelector(\'input[type="email"]\')', 'the normal isolated sign-in form')
  const submitted = await evaluate(`(() => {
    const email=document.querySelector('input[type="email"]');
    const passwordInput=document.querySelector('input[type="password"]');
    if(!email || !passwordInput || !email.form)return false;
    const set=(input,value)=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    };
    set(email,${JSON.stringify(administrator.email)});
    set(passwordInput,${JSON.stringify(administrator.password)});
    email.form.requestSubmit();
    return true;
  })()`)
  assert.ok(submitted, 'the normal sign-in form accepts the isolated demo account')
  await waitFor(`(document.body?.innerText || '').includes(${JSON.stringify(identity)})`, 'the authorized isolated administrator')
}

async function saveScreenshot(name, scrollToTop = true) {
  if (scrollToTop) await evaluate('window.scrollTo(0, 0)')
  await new Promise(resolve => setTimeout(resolve, 350))
  const filePath = path.join(screenshotDirectory, name)
  const snapshot = JSON.parse(await evaluate(`JSON.stringify({
    styles: [...document.head.querySelectorAll('style')].map(style=>style.outerHTML).join(''),
    body: document.body.innerHTML,
    scrollY: window.scrollY
  })`))
  const htmlPath = path.join(temporaryDirectory, `${name}.html`)
  const profilePath = path.join(temporaryDirectory, `edge-${name}`)
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="http://localhost:5173/">${snapshot.styles}</head><body>${snapshot.body}<script>window.scrollTo(0, ${Number(snapshot.scrollY) || 0})</script></body></html>`
  fs.writeFileSync(htmlPath, html, 'utf8')
  const result = spawnSync(edgePath, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${currentViewport.width},${currentViewport.height}`,
    `--user-data-dir=${profilePath}`,
    `--screenshot=${filePath}`,
    `file:///${htmlPath.replace(/\\/g, '/')}`,
  ], { encoding: 'utf8', timeout: 60000 })
  if (result.error || result.status !== 0 || !fs.existsSync(filePath)) {
    throw new Error(`The local screenshot renderer failed: ${result.error?.message || result.stderr || result.stdout || result.status}`)
  }
  const image = fs.readFileSync(filePath)
  assert.equal(image.readUInt32BE(16), currentViewport.width, 'the saved screenshot has the requested width')
  assert.equal(image.readUInt32BE(20), currentViewport.height, 'the saved screenshot has the requested height')
  assert.ok(image.length > 5000, 'the saved screenshot contains the desktop UI')
  const metrics = await evaluate(`({
    width: window.innerWidth,
    height: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    engagement: document.body.innerText.includes(${JSON.stringify(engagementName)}),
    header: [...document.querySelectorAll('header')].map(item=>item.innerText).find(text=>text.includes(${JSON.stringify(engagementName)})) || '',
    period: [...document.querySelectorAll('header span')].map(item=>item.innerText).find(text=>text.includes('2025')) || ''
  })`)
  assert.equal(metrics.width, currentViewport.width, 'the requested viewport width was applied')
  assert.equal(metrics.height, currentViewport.height, 'the requested viewport height was applied')
  assert.ok(metrics.documentWidth <= currentViewport.width, 'the screen has no page-level horizontal overflow')
  assert.ok(metrics.engagement, 'the selected engagement remains visible while navigating')
  assert.ok(metrics.header.includes('AED'), 'the presentation currency remains in the compact engagement header')
  assert.ok(metrics.period, 'the reporting period remains in the compact engagement header')
  return { filePath, ...metrics }
}

const sections = [
  { section: 'Overview', tab: 'Summary', key: 'overview' },
  { section: 'Trial Balance', tab: 'Imports', key: 'trial-balance' },
  { section: 'Journals', tab: 'Posted journals', key: 'journals' },
  { section: 'Mapping', tab: 'Unmapped', key: 'mapping' },
  { section: 'Statements and Notes', tab: 'Notes', key: 'statements-notes' },
  { section: 'Reports and Exports', tab: 'Preview & exports', key: 'reports-exports' },
]
const viewports = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]
let currentViewport = viewports[0]
const captures = []
let confirmOverridden = false

try {
  await command('Page.enable')
  await command('Runtime.enable')
  await command('Emulation.setDeviceMetricsOverride', {
    width: currentViewport.width,
    height: currentViewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await signInNormally()
  const alreadyOpen = await evaluate(`!!document.querySelector('nav[aria-label="Engagement sections"]')
    && (document.body?.innerText || '').includes(${JSON.stringify(engagementName)})
    && (document.body?.innerText || '').includes(${JSON.stringify(engagementReference)})`)
  if (!alreadyOpen) {
    const onList = await evaluate(`[...document.querySelectorAll('h2')].some(item=>item.innerText.trim()==='Engagements')`)
    if (!onList) await clickButton('← Engagements')
    await waitFor(`(document.body?.innerText || '').includes('All Engagements')`, 'the authorized engagement list')
    await clickButton('All Engagements', false)
    await waitFor(`[...document.querySelectorAll('tr')].some(row=>row.innerText.includes(${JSON.stringify(engagementReference)}))`,
      'the existing authorized UAE engagement')
    const opened = await evaluate(`(() => {
      const row=[...document.querySelectorAll('tr')].find(item=>item.innerText.includes(${JSON.stringify(engagementReference)}));
      if(!row)return false;
      row.click();
      return true;
    })()`)
    assert.ok(opened, 'open the existing UAE Sample 01 engagement')
  }
  await waitFor(`!!document.querySelector('nav[aria-label="Engagement sections"]')`, 'the selected UAE engagement workspace')
  assert.ok((await evaluate('document.body?.innerText || ""')).includes('FSG Isolated Demo Firm'),
    'the test uses the firm that owns the existing UAE engagement')

  for (currentViewport of viewports) {
    await command('Emulation.setDeviceMetricsOverride', {
      width: currentViewport.width,
      height: currentViewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    })
    for (const item of sections) {
      await clickButton(item.section)
      await clickTab(item.tab)
      await waitFor(`(document.body?.innerText || '').includes(${JSON.stringify(item.section)})`, `${item.section} section`)
      if (item.key === 'trial-balance') {
        await clickTab('Current year')
        await waitFor(`document.querySelector('#engagement-tb-select')?.selectedOptions[0]?.textContent.includes('2025')`,
          'the 2025 current-year Trial Balance')
        await clickTab('Prior year')
        await waitFor(`document.querySelector('#engagement-tb-select')?.selectedOptions[0]?.textContent.includes('2024')`,
          'the 2024 prior-year Trial Balance')
        await clickTab('Current year')
        await waitFor(`document.querySelector('#engagement-tb-select')?.selectedOptions[0]?.textContent.includes('2025')`,
          'the current-year Trial Balance after switching back')
        await clickTab('Imports')
      }
      if (item.key === 'journals') {
        assert.ok(!(await evaluate('(document.body?.innerText || "").includes("undefined undefined")')),
          'posted journal ledger names and debit/credit sides render from the service response')
      }
      if (item.key === 'mapping') {
        await clickTab('Mapped')
        await waitFor(`(document.body?.innerText || '').includes('Mapped accounts (16)')`, 'the 16 saved UAE mappings')
        await clickTab('Unmapped')
        await waitFor(`(document.body?.innerText || '').includes('Unmapped accounts (0)')`, 'the empty unmapped-account view')
      }
      if (item.key === 'statements-notes') {
        await evaluate(`document.querySelector('textarea[aria-label="Narrative disclosure"]')?.scrollIntoView({block:'center'})`)
      }
      let scrollToTop = true
      if (item.key === 'reports-exports') {
        const exportControls = await evaluate(`(() => {
          const visible=element => {
            const rect=element.getBoundingClientRect();
            return rect.width>0 && rect.height>0;
          };
          const row=[...document.querySelectorAll('div.flex.flex-wrap.items-center.gap-3.py-3')]
            .find(item=>item.innerText.includes('Version 7 · Final TB v3'));
          if(row)row.scrollIntoView({block:'center'});
          const buttons=[...(row?.querySelectorAll('button') || [])].filter(visible).map(item=>item.innerText.trim());
          return {
            buttons,
            sourceRevision: row?.innerText.includes('Source: PDF v7 · Final TB v3') || false,
            draftStatus: row?.innerText.includes('Draft · not finalised') || false,
          };
        })()`)
        for (const label of ['Download PDF', 'Export Excel', 'Export Word']) {
          assert.ok(exportControls.buttons.includes(label), `saved revision v7 exposes ${label}`)
        }
        assert.ok(exportControls.sourceRevision, 'the saved exports identify PDF v7 and final TB v3 as their source')
        assert.ok(exportControls.draftStatus, 'saved version finalisation state remains visible')
        scrollToTop = false
      } else if (item.key === 'statements-notes') {
        scrollToTop = false
      }
      const fileName = `UAE-Sample-01-${item.key}-${currentViewport.width}x${currentViewport.height}.png`
      captures.push(await saveScreenshot(fileName, scrollToTop))
    }
    const finalState = await evaluate(`({
      client: document.body.innerText.includes(${JSON.stringify(engagementName)}),
      reference: document.body.innerText.includes(${JSON.stringify(engagementReference)}),
      readOnly: document.body.innerText.includes('view-only')
    })`)
    assert.ok(finalState.client && finalState.reference, 'the same client and engagement persist across sections')
  }

  await clickButton('Reports and Exports')
  await clickTab('Audit report')
  await waitFor('!![...document.querySelectorAll("label")].some(item => item.innerText.trim() === "Addressee")',
    'the editable audit-report addressee')
  const originalAddressee = await evaluate(`(() => [...document.querySelectorAll('label')]
    .find(item=>item.innerText.trim()==='Addressee')?.querySelector('input')?.value ?? null)()`)
  assert.notEqual(originalAddressee, null, 'the audit-report addressee field is rendered')
  const changedAddressee = `${originalAddressee} navigation-unsaved-check`.trim()
  await evaluate(`(() => {
    const input=[...document.querySelectorAll('label')].find(item=>item.innerText.trim()==='Addressee')?.querySelector('input');
    if(!input)return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(changedAddressee)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`)
  await waitFor(`(document.body?.innerText || '').includes('Unsaved edits are preserved')`, 'the unsaved-change indicator')
  await clickButton('Mapping')
  await clickButton('Reports and Exports')
  await clickTab('Audit report')
  const preservedDraft = await evaluate(`(() => [...document.querySelectorAll('label')]
    .find(item=>item.innerText.trim()==='Addressee')?.querySelector('input')?.value ?? null)()`)
  assert.equal(preservedDraft, changedAddressee, 'an unsaved edit survives navigation between engagement sections')
  await evaluate(`window.__navigationDiscardPrompt = '';
    window.__navigationNativeConfirm = window.confirm;
    window.confirm = message => { window.__navigationDiscardPrompt = message; return true; }`)
  confirmOverridden = true
  await clickButton('← Engagements')
  await waitFor(`[...document.querySelectorAll('h2')].some(item=>item.innerText.trim()==='Engagements')`,
    'the engagement list after explicitly discarding an unsaved edit')
  const discardPrompt = await evaluate('window.__navigationDiscardPrompt')
  assert.ok(discardPrompt.includes('discard'), 'leaving asks before discarding unsaved edits')
  await waitFor(`[...document.querySelectorAll('tr')].some(row=>row.innerText.includes(${JSON.stringify(engagementReference)}))`,
    'the same authorized UAE engagement after returning to the list')
  const reopened = await evaluate(`(() => {
    const row=[...document.querySelectorAll('tr')].find(item=>item.innerText.includes(${JSON.stringify(engagementReference)}));
    if(!row)return false;
    row.click();
    return true;
  })()`)
  assert.ok(reopened, 'reopen the same UAE engagement through the normal list')
  await waitFor(`(document.body?.innerText || '').includes(${JSON.stringify(engagementName)})`, 'the reopened UAE engagement')
  await clickButton('Reports and Exports')
  await clickTab('Audit report')
  await waitFor(`(() => [...document.querySelectorAll('label')].some(item=>item.innerText.trim()==='Addressee'))()`,
    'the saved audit-report field after reopening')
  const reopenedAddressee = await evaluate(`(() => [...document.querySelectorAll('label')]
    .find(item=>item.innerText.trim()==='Addressee')?.querySelector('input')?.value ?? null)()`)
  assert.equal(reopenedAddressee, originalAddressee, 'the explicitly discarded draft does not alter saved report settings')
  await evaluate(`window.confirm = window.__navigationNativeConfirm; delete window.__navigationNativeConfirm;`)
  confirmOverridden = false
  await clickTab('Preview & exports')

  console.log(JSON.stringify({
    engagement: engagementReference,
    authenticatedFirm: 'FSG Isolated Demo Firm',
    editPermission: true,
    unsavedEditsPreservedAndDiscardConfirmed: true,
    screenshots: captures,
  }, null, 2))
} finally {
  try {
    if (confirmOverridden && socket.readyState === WebSocket.OPEN) {
      await evaluate(`window.confirm = window.__navigationNativeConfirm; delete window.__navigationNativeConfirm;`)
    }
  } finally {
    socket.close()
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}
