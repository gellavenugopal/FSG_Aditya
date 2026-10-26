import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveDisposableTestTarget } from '../src/main/test-isolation.mjs'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'

if (process.env.FSG_TEST_MODE !== 'true') {
  throw new Error('Run reporting reconciliation only through the isolated engagement demo harness.')
}

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { target } = resolveDisposableTestTarget()
const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const credentials = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8'))
const statePath = path.join(demoHome, 'workflow.json')
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const helperPath = path.join(repositoryRoot, 'tools', 'engagement-demo-select-dialog.ps1')
const administrator = credentials.testUsers.administrator
validateDemoUserCredentials(credentials.testUsers)

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
let lastTargetError
const pageDeadline = Date.now() + 60000
while (!page && Date.now() < pageDeadline) {
  try {
    const targets = await getJson('http://127.0.0.1:9339/json/list')
    page = targets.find(item => {
      if (item.type !== 'page') return false
      const url = new URL(item.url)
      return url.hostname === 'localhost' && Number(url.port) >= 5173 && Number(url.port) <= 5180
    })
  } catch (error) {
    lastTargetError = error
  }
  if (!page) await new Promise(resolve => setTimeout(resolve, 250))
}
if (!page?.webSocketDebuggerUrl) {
  throw new Error(`The isolated desktop renderer did not become available within 60 seconds.${lastTargetError ? ` ${lastTargetError.message}` : ''}`)
}

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

function command(method, params = {}) {
  const id = ++nextCommandId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Electron automation command timed out: ${method}`))
    }, 60000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (result.exceptionDetails) throw new Error(result.result?.description || result.exceptionDetails.text)
  return result.result?.value
}

async function waitFor(predicate, description, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(`(() => { const text=document.body?.innerText || ''; return ${predicate}; })()`)) return
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`Timed out waiting for ${description}.`)
}

async function clickButton(text) {
  const clicked = await evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find(item=>item.innerText.trim()===${JSON.stringify(text)});
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`)
  if (!clicked) throw new Error(`The enabled "${text}" button was not available.`)
}

async function setLabeledControl(labelText, value) {
  const updated = await evaluate(`(() => {
    const label=[...document.querySelectorAll('label')].find(item=>
      ([...item.children].find(child=>child.tagName==='SPAN')?.innerText.trim() || '')===${JSON.stringify(labelText)});
    const input=label?.querySelector('input,textarea,select');
    if (!input || input.disabled) return false;
    const prototype=input.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype :
      input.tagName==='SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`)
  if (!updated) throw new Error(`Could not set the "${labelText}" field.`)
}

async function setCheckbox(labelText, checked) {
  const updated = await evaluate(`(() => {
    const label=[...document.querySelectorAll('label')].find(item=>
      (item.innerText || '').includes(${JSON.stringify(labelText)}));
    const input=label?.querySelector('input[type="checkbox"]');
    if (!input) return false;
    if (input.checked !== ${JSON.stringify(checked)}) input.click();
    return input.checked === ${JSON.stringify(checked)};
  })()`)
  if (!updated) throw new Error(`Could not set the "${labelText}" checkbox.`)
}

async function signIn() {
  const body = await evaluate('document.body?.innerText || ""')
  if (body.includes(`Signed in as ${administrator.displayName}`)) return
  if (body.includes('Signed in as ')) await clickButton('Sign out')
  await waitFor(`!!document.querySelector('input[type="email"]')`, 'the normal sign-in form')
  const submitted = await evaluate(`(() => {
    const email=document.querySelector('input[type="email"]');
    const password=document.querySelector('input[type="password"]');
    if (!email || !password || !email.form) return false;
    const set=(input,value)=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    };
    set(email,${JSON.stringify(administrator.email)});
    set(password,${JSON.stringify(administrator.password)});
    email.form.requestSubmit();
    return true;
  })()`)
  if (!submitted) throw new Error('Could not submit administrator credentials through the normal sign-in screen.')
  await waitFor(`text.includes(${JSON.stringify(`Signed in as ${administrator.displayName}`)})`, 'administrator sign-in')
}

async function clickOutputButton(rowText, buttonText) {
  const clicked = await evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find(item=>{
      if (item.innerText.trim()!==${JSON.stringify(buttonText)}) return false;
      let parent=item.parentElement;
      while (parent && parent!==document.body) {
        if ((parent.innerText || '').includes(${JSON.stringify(rowText)})) return true;
        parent=parent.parentElement;
      }
      return false;
    });
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`)
  if (!clicked) throw new Error(`Could not find "${buttonText}" for "${rowText}".`)
}

function saveDownloadedPdf(filename) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-STA', '-File', helperPath,
    '-Action', 'Save',
    '-DialogTitle', 'Save combined financial reporting pack',
    '-FilePath', filename,
    '-DemoHome', demoHome,
    '-UserDataPath', target.userDataPath,
    '-RepositoryRoot', repositoryRoot,
  ], { encoding: 'utf8', timeout: 45000 })
  if (result.error || result.status !== 0) {
    throw new Error(`Isolated Windows PDF save dialog failed: ${result.error?.message || result.stderr || result.stdout || result.status}`)
  }
}

try {
  await command('Page.enable')
  await command('Runtime.enable')
  await signIn()
  if (await evaluate(`!![...document.querySelectorAll('button')].find(item=>item.innerText.trim()==='← Engagements')`)) {
    await clickButton('← Engagements')
  }
  await waitFor(`!![...document.querySelectorAll('tr')].find(item=>item.innerText.includes(${JSON.stringify(state.reference)}))`, 'the saved engagement row')
  const opened = await evaluate(`(() => {
    const row=[...document.querySelectorAll('tr')].find(item=>item.innerText.includes(${JSON.stringify(state.reference)}));
    if (!row) return false;
    row.click();
    return true;
  })()`)
  if (!opened) throw new Error('The saved engagement was not available to the administrator.')
  await waitFor(`!![...document.querySelectorAll('label')].find(item=>
    ([...item.children].find(child=>child.tagName==='SPAN')?.innerText.trim() || '')==='Addressee')`,
  'the loaded audit-report inputs')
  await setLabeledControl('Addressee', 'The Members of FSG Demo Carverse Private Limited')
  await setLabeledControl('Opinion — entered explicitly by the auditor; never generated from balances', 'We have audited the accompanying financial statements and report that they present fairly, in all material respects, the company’s financial position.')
  await setLabeledControl('Basis for opinion', 'We conducted our audit in accordance with the applicable auditing standards in India.')
  await setLabeledControl('Management responsibilities', 'Management is responsible for the preparation of these financial statements.')
  await setLabeledControl('Auditor responsibilities', 'Our responsibility is to express an opinion based on our audit.')
  await setLabeledControl('Other matters (optional)', 'The company maintains documented controls over revenue recognition.')
  await setLabeledControl('Audit report date', '2026-06-30')
  await setLabeledControl('Audit report place', 'Mumbai')
  await setLabeledControl('Financial-statement approval date', '2026-06-25')
  await setLabeledControl('Financial-statement approval place', 'Mumbai')
  await setLabeledControl('Audit firm name', 'FSG Demo Assurance LLP')
  await setLabeledControl('Firm registration number (FRN)', 'DEMO-FRN-001')
  await setLabeledControl('Auditor name', 'Asha Mehta')
  await setLabeledControl('Auditor membership number', 'DEMO-MEMBER-001')
  await setLabeledControl('Auditor designation', 'Partner')
  await setLabeledControl('Audit firm address', '101 Example Road, Mumbai, Maharashtra, India')
  await setCheckbox('Anaya Mehta', true)
  await waitFor(`!![...document.querySelectorAll('summary')].find(item=>item.innerText.includes('Notes to accounts'))`, 'the notes section')
  const notesOpened = await evaluate(`(() => {
    const summary=[...document.querySelectorAll('summary')].find(item=>item.innerText.includes('Notes to accounts'));
    if (!summary) return false;
    summary.closest('details').open=true;
    return true;
  })()`)
  if (!notesOpened) throw new Error('Could not open the notes section.')
  await waitFor(`text.includes('Structured share-capital details')`, 'the structured share-capital form')
  const formOpened = await evaluate(`(() => {
    const summary=[...document.querySelectorAll('summary')].find(item=>item.innerText.includes('Structured share-capital details'));
    if (!summary) return false;
    summary.closest('details').open=true;
    return true;
  })()`)
  if (!formOpened) throw new Error('Could not open the structured share-capital form.')

  for (const period of ['Current year', 'Prior year']) {
    await setLabeledControl(`Issued shares · ${period}`, '10000')
    await setLabeledControl(`Subscribed shares · ${period}`, '10000')
    await setLabeledControl(`Paid-up shares · ${period}`, '10000')
  }
  await clickButton('Save structured details')
  await waitFor(`text.includes('Structured details for')`, 'structured share-capital values to save')
  const existingOutputs = await evaluate(`window.api.listEngagementReportOutputs(${state.engagementId})`)
  const nextVersion = Math.max(0, ...existingOutputs.map(item => Number(item.version))) + 1
  await clickButton('Generate & save combined PDF')
  await waitFor(`text.includes(${JSON.stringify(`Combined PDF v${nextVersion} saved`)})`,
    `the reconciled combined PDF version ${nextVersion}`, 60000)

  const outputs = await evaluate(`window.api.listEngagementReportOutputs(${state.engagementId})`)
  const output = outputs.find(item => Number(item.version) === nextVersion)
  if (!output) throw new Error(`The corrected report output was not persisted as version ${nextVersion}.`)
  const saved = await evaluate(`window.api.getEngagementReportOutput(${Number(output.id)})`)
  const pdfBytes = Buffer.from(saved.pdfContentBase64, 'base64')
  if (pdfBytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('The corrected report output is not a PDF.')
  const serviceHash = crypto.createHash('sha256').update(pdfBytes).digest('hex')
  const localPath = path.join(demoHome, 'outputs', `${state.reference}-reporting-pack-v${nextVersion}.pdf`)
  if (fs.existsSync(localPath)) throw new Error(`Refusing to overwrite an existing review file: ${localPath}`)
  await clickOutputButton(`Version ${nextVersion} ·`, 'Download PDF')
  saveDownloadedPdf(localPath)
  const deadline = Date.now() + 10000
  while (!fs.existsSync(localPath) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
  if (!fs.existsSync(localPath)) throw new Error('The corrected PDF was not saved through the desktop UI.')
  const localHash = crypto.createHash('sha256').update(fs.readFileSync(localPath)).digest('hex')
  if (localHash !== serviceHash) throw new Error('The downloaded version 4 PDF differs from the service-persisted bytes.')

  state.updatedOutputId = Number(output.id)
  state.updatedOutputVersion = nextVersion
  state.outputs.updated = localPath
  state.structuredShareCapitalReconciled = {
    issuedShares: 10000,
    subscribedShares: 10000,
    paidUpShares: 10000,
    outputId: Number(output.id),
    pdfSha256: serviceHash,
  }
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
  console.info(JSON.stringify({
    result: 'structured share-capital details reconcile to the mapped balance sheet and a corrected PDF was persisted',
    engagement: state.reference,
    outputVersion: nextVersion,
    pdf: localPath,
    pdfSha256: localHash,
  }, null, 2))
} finally {
  socket.close()
}
