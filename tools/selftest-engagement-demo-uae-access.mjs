import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveDisposableTestTarget } from '../src/main/test-isolation.mjs'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'

if (process.env.FSG_TEST_MODE !== 'true') {
  throw new Error('Run UAE engagement access verification only through the isolated desktop harness.')
}

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { target } = resolveDisposableTestTarget()
const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const credentials = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8'))
validateDemoUserCredentials(credentials.testUsers)
const administrator = credentials.testUsers.administrator
const engagementReference = 'UAE-SAMPLE-01-2025'
const engagementId = 2
const expectedPdfHash = '29936ef746e59428080ccc119e392678bcd0374b6ad88046523b647cf248ea7a'
const helperPath = path.join(repositoryRoot, 'tools', 'engagement-demo-select-dialog.ps1')
const outputsDirectory = path.join(demoHome, 'outputs')
const requestedOutputPath = process.env.FSG_UAE_ACCESS_DOWNLOAD_PATH
const outputPath = requestedOutputPath
  ? path.resolve(requestedOutputPath)
  : path.join(outputsDirectory, `UAE-Sample-01-v5-access-check-${process.pid}.pdf`)
const relativeOutputPath = path.relative(outputsDirectory, outputPath)
if (requestedOutputPath && (
  relativeOutputPath.startsWith('..')
  || path.isAbsolute(relativeOutputPath)
  || path.extname(outputPath).toLowerCase() !== '.pdf'
)) {
  throw new Error('The retained UAE v5 download must be a PDF inside the isolated demo outputs folder.')
}
const preserveDownload = Boolean(requestedOutputPath)

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

async function waitFor(predicate, description) {
  const deadline = Date.now() + 30000
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

async function returnToEngagementList() {
  const rowVisible = await evaluate(`!![...document.querySelectorAll('tr')].find(item=>item.innerText.includes(${JSON.stringify(engagementReference)}))`)
  if (rowVisible) return
  const clicked = await evaluate(`(() => {
    const buttons=[...document.querySelectorAll('button')];
    const button=buttons.find(item=>item.innerText.trim()==='← Engagements')
      || buttons.find(item=>item.innerText.trim()==='Engagements');
    if (!button) return false;
    button.click();
    return true;
  })()`)
  return clicked
}

async function clickOutputButton(rowText, buttonText) {
  const clicked = await evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find(item=>{
      return item.innerText.trim()===${JSON.stringify(buttonText)}
        && (item.parentElement?.innerText || '').includes(${JSON.stringify(rowText)});
    });
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`)
  if (!clicked) throw new Error(`Could not find "${buttonText}" for "${rowText}".`)
}

async function signInNormally() {
  let body = await evaluate('document.body?.innerText || ""')
  if (body.includes(`Signed in as ${administrator.displayName} · FSG Isolated Demo Firm`)) return
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
  if (!submitted) throw new Error('Could not submit the isolated administrator through the normal sign-in form.')
  await waitFor(`text.includes(${JSON.stringify(`Signed in as ${administrator.displayName} · FSG Isolated Demo Firm`)})`,
    'sign-in to the firm that owns UAE Sample 01')
}

function savePdfThroughDesktopDialog() {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-STA', '-File', helperPath,
    '-Action', 'Save',
    '-DialogTitle', 'Save combined financial reporting pack',
    '-FilePath', outputPath,
    '-DemoHome', demoHome,
    '-UserDataPath', target.userDataPath,
    '-RepositoryRoot', repositoryRoot,
  ], { encoding: 'utf8', timeout: 45000 })
  if (result.error || result.status !== 0) {
    throw new Error(`The verified isolated-app save dialog failed: ${result.error?.message || result.stderr || result.stdout || result.status}`)
  }
}

async function waitForDownloadedFile() {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (fs.existsSync(outputPath)) return
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('The isolated desktop Save PDF dialog closed, but its selected PDF did not appear in the demo output folder.')
}

let removeTemporaryDownload = false
try {
  await command('Page.enable')
  await command('Runtime.enable')
  await signInNormally()
  await returnToEngagementList()
  await waitFor(
    `!![...document.querySelectorAll('tr')].find(item=>item.innerText.includes(${JSON.stringify(engagementReference)}))`,
    'the existing UAE engagement in normal navigation',
  )

  const listResults = await evaluate(`(async()=>{
    const result={};
    for(const scope of ['my','all']){
      try{
        const rows=await window.api.listEngagements(scope);
        result[scope]=rows.map(row=>({id:Number(row.id),reference:row.reference,currentAccess:row.current_access}));
      }catch(error){result[scope]={error:String(error.message||error)}}
    }
    return result;
  })()`)
  const myRows = listResults.my
  const allRows = listResults.all
  assert.ok(Array.isArray(myRows), `My Engagements API failed: ${JSON.stringify(myRows)}`)
  assert.ok(Array.isArray(allRows), `All Engagements API failed: ${JSON.stringify(allRows)}`)
  assert.ok(myRows.some(row => row.reference === engagementReference && row.currentAccess === 'Owner'),
    'the authenticated administrator owns the existing UAE engagement')
  assert.ok(allRows.some(row => row.reference === engagementReference),
    'firm-wide list returns the existing UAE engagement')
  assert.equal(myRows.find(row => row.reference === engagementReference).id, engagementId,
    'the authorised UAE reference resolves to the expected engagement id')

  const defaultScope = await evaluate(`(()=>{
    const button=[...document.querySelectorAll('button')].find(item=>item.innerText.trim()==='All Engagements');
    return !!button && button.className.includes('border-blue-700');
  })()`)
  assert.equal(defaultScope, true, 'administrator opens the firm-wide engagement list by default')

  const opened = await evaluate(`(()=>{
    const row=[...document.querySelectorAll('tr')].find(item=>item.innerText.includes(${JSON.stringify(engagementReference)}));
    if(!row)return false;
    row.click();
    return true;
  })()`)
  assert.equal(opened, true, 'the existing UAE engagement row is clickable in the visible list')
  await waitFor(`text.includes('Saved combined PDF versions')`, 'the saved output list')
  await waitFor(`text.includes('Version 5') && text.includes('Download PDF')`, 'saved output version 5')
  const visibleEngagement = await evaluate('document.body?.innerText || ""')
  assert.ok(visibleEngagement.includes('UAE Sample 01 Demo LLC'),
    'the visible reporting screen belongs to UAE Sample 01 Demo LLC')
  const savedNarrative = await evaluate(`(async()=>{
    const snapshots=await window.api.listEngagementFinalTrialBalances(${engagementId});
    const snapshot=snapshots.find(item=>Number(item.version)===3);
    if(!snapshot)throw new Error('Final Trial Balance v3 is missing from the UAE engagement.');
    const reporting=await window.api.getEngagementReportingData({
      engagementId:${engagementId},trialBalanceId:Number(snapshot.id)
    });
    return {
      finalTrialBalanceId:Number(snapshot.id),
      notes:(reporting.noteDisclosures||[]).map(item=>({
        noteNumber:Number(item.note_num),title:item.note_title,text:item.text
      }))
    };
  })()`)

  const output = await evaluate(`(async()=>{
    const outputs=await window.api.listEngagementReportOutputs(${engagementId});
    const item=outputs.find(row=>Number(row.version)===5);
    if(!item)throw new Error('Saved PDF version 5 is missing.');
    const saved=await window.api.getEngagementReportOutput(Number(item.id));
    return {version:Number(item.version),finalised:!!item.finalised_at,pdfContentBase64:saved.pdfContentBase64};
  })()`)
  assert.equal(output.version, 5)
  const storedBytes = Buffer.from(output.pdfContentBase64, 'base64')
  assert.equal(storedBytes.subarray(0, 5).toString('ascii'), '%PDF-')
  const storedHash = crypto.createHash('sha256').update(storedBytes).digest('hex')
  assert.equal(storedHash, expectedPdfHash, 'the service-saved v5 bytes match the preserved local v5 output')

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  assert.equal(fs.existsSync(outputPath), false, 'the verification download path is new')
  removeTemporaryDownload = !preserveDownload
  await clickOutputButton('Version 5 ·', 'Download PDF')
  savePdfThroughDesktopDialog()
  await waitForDownloadedFile()
  assert.equal(fs.existsSync(outputPath), true, 'the ordinary desktop save dialog wrote the selected PDF')
  const downloadedHash = crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex')
  assert.equal(downloadedHash, storedHash, 'the UI download matches the exact persisted v5 bytes')
  if (!preserveDownload) fs.unlinkSync(outputPath)
  removeTemporaryDownload = false

  console.info(JSON.stringify({
    result: 'existing UAE engagement reached and saved PDF v5 downloaded through visible application navigation',
    authenticatedFirm: 'FSG Isolated Demo Firm',
    reference: engagementReference,
    scopeCounts: { my: myRows.length, all: allRows.length },
    access: myRows.find(row => row.reference === engagementReference).currentAccess,
    outputVersion: output.version,
    pdfSha256: downloadedHash,
    downloadedPath: preserveDownload ? outputPath : null,
    savedNarrative: savedNarrative.notes,
  }, null, 2))
} finally {
  socket.close()
  if (removeTemporaryDownload && fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
}
