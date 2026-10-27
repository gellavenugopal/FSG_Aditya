import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { PDFDocument } from 'pdf-lib'
import { fileURLToPath } from 'node:url'
import { resolveDisposableTestTarget } from '../src/main/test-isolation.mjs'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'
import { buildUaeDemoFinancials } from '../src/renderer/src/components/Engagements/uaeDemoReporting.js'

if (process.env.FSG_TEST_MODE !== 'true') {
  throw new Error('Generate UAE Sample 01 output only through the existing isolated desktop harness.')
}

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { target } = resolveDisposableTestTarget()
const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const outputsDirectory = path.join(demoHome, 'outputs')
const credentials = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8'))
validateDemoUserCredentials(credentials.testUsers)
const administrator = credentials.testUsers.administrator
const engagementId = 2
const engagementReference = 'UAE-SAMPLE-01-2025'
const noteNarrative = financials =>
  `Synthetic demonstration disclosure: cash and cash equivalents are AED ${financials.current.position.cash.toLocaleString('en-US')} at 31 December 2025 (AED ${financials.comparative.position.cash.toLocaleString('en-US')} at 31 December 2024), based on the selected final and comparative Trial Balances.`
const expectedPreservedHashes = new Map([
  [5, '29936ef746e59428080ccc119e392678bcd0374b6ad88046523b647cf248ea7a'],
  [6, 'cefb5b714f1069c73af30970cd637d2049ddb9448333b953ff4773f121fb77a1'],
])
const helperPath = path.join(repositoryRoot, 'tools', 'engagement-demo-select-dialog.ps1')
const visiblePdfPath = version => path.join(outputsDirectory, `UAE-Sample-01-reporting-pack-v${version}-corrected.pdf`)

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
const pageDeadline = Date.now() + 60000
while (!page && Date.now() < pageDeadline) {
  const targets = await getJson('http://127.0.0.1:9339/json/list')
  page = targets.find(item => {
    if (item.type !== 'page') return false
    const url = new URL(item.url)
    return url.hostname === 'localhost' && Number(url.port) >= 5173 && Number(url.port) <= 5180
  })
  if (!page) await new Promise(resolve => setTimeout(resolve, 250))
}
if (!page?.webSocketDebuggerUrl) {
  throw new Error('Open exactly one isolated desktop using .\\tools\\engagement-demo.ps1 launch first.')
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

async function appApi(method, argument) {
  return evaluate(`window.api[${JSON.stringify(method)}](${JSON.stringify(argument)})`)
}

async function waitFor(predicate, description, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(`(() => { const text=document.body?.innerText || ''; return ${predicate}; })()`)) return
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`Timed out waiting for ${description}.`)
}

async function waitForOutputVersion(version, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const outputs = await appApi('listEngagementReportOutputs', engagementId)
    const output = outputs.find(item => Number(item.version) === version)
    if (output) return output
    const error = await evaluate('document.querySelector(\'[role="alert"]\')?.innerText || ""')
    if (error) throw new Error(`The desktop could not generate the UAE report: ${error}`)
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for the saved UAE report version ${version}.`)
}

async function clickButton(text) {
  const clicked = await evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find(item=>item.innerText.trim()===${JSON.stringify(text)});
    if(!button || button.disabled)return false;
    button.scrollIntoView({block:'center'});
    button.click();
    return true;
  })()`)
  if (!clicked) throw new Error(`The enabled "${text}" button was not available.`)
}

async function signInNormally() {
  let body = await evaluate('document.body?.innerText || ""')
  const identity = `Signed in as ${administrator.displayName} · FSG Isolated Demo Firm`
  if (body.includes(identity)) return
  if (body.includes('Signed in as ')) await clickButton('Sign out')
  await waitFor('!!document.querySelector(\'input[type="email"]\')', 'the normal isolated sign-in form')
  const submitted = await evaluate(`(() => {
    const email=document.querySelector('input[type="email"]');
    const password=document.querySelector('input[type="password"]');
    if(!email || !password || !email.form)return false;
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
  if (!submitted) throw new Error('Could not submit the administrator through the normal sign-in form.')
  await waitFor(`text.includes(${JSON.stringify(identity)})`, 'administrator sign-in to FSG Isolated Demo Firm')
}

async function returnToList() {
  const onList = await evaluate(`[...document.querySelectorAll('h2')].some(item=>item.innerText.trim()==='Engagements')`)
  if (onList) return
  await clickButton('← Engagements')
  await waitFor(`text.includes('All Engagements')`, 'the firm engagement list')
}

async function openUaeEngagement() {
  await waitFor(`([...document.querySelectorAll('tr')].some(row=>row.innerText.includes(${JSON.stringify(engagementReference)})))`,
    'UAE Sample 01 in the authorized firm list')
  const opened = await evaluate(`(() => {
    const row=[...document.querySelectorAll('tr')].find(item=>item.innerText.includes(${JSON.stringify(engagementReference)}));
    if(!row)return false;
    row.click();
    return true;
  })()`)
  if (!opened) throw new Error('The existing UAE Sample 01 engagement row was not clickable.')
  await waitFor(`text.includes('Financial-statement approval date')`, 'the UAE reporting panel')
  const visible = await evaluate('document.body?.innerText || ""')
  assert.ok(visible.includes('UAE Sample 01 Demo LLC'), 'the selected engagement is UAE Sample 01 Demo LLC')
}

async function setNoteNarrativeThroughForm(text) {
  const opened = await evaluate(`(() => {
    const summary=[...document.querySelectorAll('summary')]
      .find(item=>item.innerText.includes('Notes to accounts'));
    if(!summary)return false;
    const details=summary.closest('details');
    if(details && !details.open)summary.click();
    return true;
  })()`)
  if (!opened) throw new Error('The Notes to accounts disclosure form is not available.')
  const updated = await evaluate(`(() => {
    const label=[...document.querySelectorAll('label')]
      .find(item=>item.innerText.includes('Note 1: Cash and cash equivalents'));
    const textarea=label?.querySelector('textarea');
    if(!textarea || textarea.disabled)return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,${JSON.stringify(text)});
    textarea.dispatchEvent(new Event('input',{bubbles:true}));
    textarea.dispatchEvent(new Event('change',{bubbles:true}));
    let container=label;
    while(container && ![...container.querySelectorAll('button')]
      .some(button=>button.innerText.trim()==='Save note text'))container=container.parentElement;
    const save=[...container?.querySelectorAll('button')||[]]
      .find(button=>button.innerText.trim()==='Save note text');
    if(!save || save.disabled)return false;
    save.click();
    return true;
  })()`)
  if (!updated) throw new Error('Could not save the Note 1 narrative through the visible engagement form.')
  await waitFor(`text.includes('Note 1 disclosure saved separately')`, 'the Note 1 save confirmation')
}

function savePdfThroughDesktopDialog(filePath) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-STA', '-File', helperPath,
    '-Action', 'Save',
    '-DialogTitle', 'Save combined financial reporting pack',
    '-FilePath', filePath,
    '-DemoHome', demoHome,
    '-UserDataPath', target.userDataPath,
    '-RepositoryRoot', repositoryRoot,
  ], { encoding: 'utf8', timeout: 45000 })
  if (result.error || result.status !== 0) {
    throw new Error(`The isolated desktop Save PDF dialog failed: ${result.error?.message || result.stderr || result.stdout || result.status}`)
  }
}

async function downloadOutput(output, filePath) {
  const downloaded = await evaluate(`(() => {
    const row=[...document.querySelectorAll('div.flex.flex-wrap.items-center.gap-2.text-sm.font-medium')]
      .find(item=>item.innerText.includes(${JSON.stringify(`Version ${output.version} ·`)}));
    const container=row?.parentElement?.parentElement;
    const button=[...container?.querySelectorAll('button')||[]]
      .find(item=>item.innerText.trim()==='Download PDF');
    if(!button || button.disabled)return false;
    button.click();
    return true;
  })()`)
  if (!downloaded) throw new Error(`Could not download saved UAE version ${output.version} through its visible UI row.`)
  savePdfThroughDesktopDialog(filePath)
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`The PDF save dialog closed but ${path.basename(filePath)} was not written.`)
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

try {
  await command('Page.enable')
  await command('Runtime.enable')
  await signInNormally()
  await returnToList()
  await openUaeEngagement()

  const snapshots = await appApi('listEngagementFinalTrialBalances', engagementId)
  const finalSnapshot = snapshots.find(item => Number(item.version) === 3)
  assert.ok(finalSnapshot, 'the existing UAE engagement final Trial Balance v3 is present')
  const reporting = await appApi('getEngagementReportingData', {
    engagementId,
    trialBalanceId: Number(finalSnapshot.id),
  })
  const mappings = Object.fromEntries((reporting.uaeMappings || []).map(item => [
    String(item.trialBalanceRowId), item.lineKey,
  ]))
  const financials = buildUaeDemoFinancials({
    currentRows: reporting.currentRows || [],
    comparativeRows: reporting.comparativeRows || [],
    mappings,
    periodEnd: reporting.engagement.periodEnd,
    comparativePeriodEnd: reporting.comparativeTrialBalance?.dateTill,
  })
  assert.equal(financials.current.position.assets, 239250)
  assert.equal(financials.current.profit.profitForYear, 36250)

  const savedOutputs = await appApi('listEngagementReportOutputs', engagementId)
  for (const [version, expectedHash] of expectedPreservedHashes) {
    const output = savedOutputs.find(item => Number(item.version) === version)
    assert.ok(output, `preserved UAE output v${version} remains in the authorized output list`)
    const saved = await appApi('getEngagementReportOutput', Number(output.id))
    assert.equal(sha256(Buffer.from(saved.pdfContentBase64, 'base64')), expectedHash,
      `saved UAE output v${version} remains byte-identical`)
  }

  const auditFields = reporting.auditReport?.fields || {}
  const savedAuditNarrative = [
    auditFields.opinion,
    auditFields.basisForOpinion,
    auditFields.managementResponsibilities,
    auditFields.auditorResponsibilities,
    auditFields.otherMatters,
  ].filter(value => String(value || '').trim())
  assert.ok(savedAuditNarrative.length > 0, 'the saved auditor narrative is available to the UAE report builder')

  const narrative = noteNarrative(financials)
  await setNoteNarrativeThroughForm(narrative)
  const refreshedReporting = await appApi('getEngagementReportingData', {
    engagementId,
    trialBalanceId: Number(finalSnapshot.id),
  })
  const savedNote = refreshedReporting.noteDisclosures?.find(item =>
    Number(item.note_num) === 1 && item.note_title === 'Cash and cash equivalents')
  assert.equal(savedNote?.text, narrative, 'the Note 1 narrative is persisted on the existing UAE engagement')

  const firstCorrectedVersion = Math.max(...expectedPreservedHashes.keys()) + 1
  const existingCorrectedOutput = savedOutputs.find(item => Number(item.version) === firstCorrectedVersion)
  const nextVersion = existingCorrectedOutput
    ? firstCorrectedVersion
    : Math.max(0, ...savedOutputs.map(item => Number(item.version))) + 1
  const downloadPath = visiblePdfPath(nextVersion)
  if (!existingCorrectedOutput) {
    await clickButton('Generate & save combined PDF')
  }
  const savedReport = await waitForOutputVersion(nextVersion)
  assert.ok(savedReport, 'the corrected UAE report is persisted')
  assert.equal(savedReport.finalised_at || null, null, 'the corrected demonstration PDF remains a draft')
  const savedOutput = await appApi('getEngagementReportOutput', Number(savedReport.id))
  const pdfBytes = Buffer.from(savedOutput.pdfContentBase64, 'base64')
  assert.equal(sha256(pdfBytes), sha256(Buffer.from(savedOutput.pdfContentBase64, 'base64')))
  const pdf = await PDFDocument.load(pdfBytes)
  const pageCount = pdf.getPageCount()
  let downloadedBytes
  if (fs.existsSync(downloadPath)) {
    downloadedBytes = fs.readFileSync(downloadPath)
  } else {
    await downloadOutput(savedReport, downloadPath)
    downloadedBytes = fs.readFileSync(downloadPath)
  }
  assert.equal(sha256(downloadedBytes), sha256(pdfBytes), 'the visible PDF download matches the persisted new version')

  for (const [version, expectedHash] of expectedPreservedHashes) {
    const priorPath = path.join(outputsDirectory, `UAE-Sample-01-reporting-pack-v${version}.pdf`)
    assert.ok(fs.existsSync(priorPath), `preserved local UAE v${version} remains available`)
    assert.equal(sha256(fs.readFileSync(priorPath)), expectedHash, `preserved local UAE v${version} remains unchanged`)
  }

  console.info(JSON.stringify({
    result: 'UAE Sample 01 corrected report saved and downloaded through the normal desktop UI',
    engagement: engagementReference,
    entity: reporting.entity.name,
    authenticatedFirm: 'FSG Isolated Demo Firm',
    priorVersionsPreserved: [5, 6],
    noteNarrative: { noteNumber: 1, title: savedNote.note_title, text: savedNote.text },
    savedAuditNarrativeFields: savedAuditNarrative.length,
    reconciliation: {
      assets: financials.current.position.assets,
      liabilitiesAndEquity: financials.current.position.totalLiabilitiesAndEquity,
      profit: financials.current.profit.profitForYear,
      oci: financials.current.profit.otherComprehensiveIncome,
    },
    version: nextVersion,
    pages: pageCount,
    sha256: sha256(downloadedBytes),
    downloadedPath: downloadPath,
  }, null, 2))
} finally {
  socket.close()
}
