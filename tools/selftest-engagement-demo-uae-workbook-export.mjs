import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import ExcelJS from 'exceljs'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveDisposableTestTarget } from '../src/main/test-isolation.mjs'
import {
  buildUaeDemoComparativeMappings,
  getUaeDemoAccountLine,
} from '../src/renderer/src/components/Engagements/uaeDemoReporting.js'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'

if (process.env.FSG_TEST_MODE !== 'true') {
  throw new Error('Export the UAE workbook only through the existing isolated desktop harness.')
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
const outputPath = process.env.FSG_UAE_WORKBOOK_OUTPUT_PATH
  ? path.resolve(process.env.FSG_UAE_WORKBOOK_OUTPUT_PATH)
  : path.join(outputsDirectory, 'UAE-Sample-01-reporting-pack-v7-final.xlsx')
const helperPath = path.join(repositoryRoot, 'tools', 'engagement-demo-select-dialog.ps1')
const reopenOnly = process.env.FSG_UAE_WORKBOOK_REOPEN_ONLY === 'true'
if (!reopenOnly && fs.existsSync(outputPath)) throw new Error(`Refusing to overwrite the existing workbook: ${outputPath}`)
if (reopenOnly && !fs.existsSync(outputPath)) throw new Error(`Saved workbook not found for reopen verification: ${outputPath}`)

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
  throw new Error('Open the existing isolated desktop using .\\tools\\engagement-demo.ps1 launch first.')
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
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  })
  if (result.exceptionDetails) throw new Error(result.result?.description || result.exceptionDetails.text)
  return result.result?.value
}

async function appApi(method, argument) {
  return evaluate(`window.api[${JSON.stringify(method)}](${JSON.stringify(argument)})`)
}

async function readAllEngagementTrialBalanceRows(id, trialBalanceId) {
  const rows = []
  let offset = 0
  let totalRows = Number.POSITIVE_INFINITY
  while (offset < totalRows) {
    const page = await appApi('getEngagementTrialBalanceRows', {
      engagementId: id,
      trialBalanceId,
      offset,
      limit: 1000,
    })
    rows.push(...page.rows)
    totalRows = Number(page.totalRows)
    offset += page.rows.length
    if (!page.rows.length && offset < totalRows) {
      throw new Error('Comparative export verification stopped before all source rows were received.')
    }
  }
  return rows
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
    if(!button || button.disabled)return false;
    button.scrollIntoView({block:'center'});
    button.click();
    return true;
  })()`)
  if (!clicked) throw new Error(`The enabled "${text}" button was not available.`)
}

async function signInNormally() {
  const identity = `Signed in as ${administrator.displayName} · FSG Isolated Demo Firm`
  const body = await evaluate('document.body?.innerText || ""')
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
  await waitFor(`text.includes(${JSON.stringify(identity)})`, 'normal administrator sign-in')
}

function saveThroughDesktopDialog(filePath) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-STA', '-File', helperPath,
    '-Action', 'Save',
    '-DialogTitle', 'Save UAE demonstration workbook',
    '-FilePath', filePath,
    '-DemoHome', demoHome,
    '-UserDataPath', target.userDataPath,
    '-RepositoryRoot', repositoryRoot,
  ], { encoding: 'utf8', timeout: 45000 })
  if (result.error || result.status !== 0) {
    throw new Error(`The isolated desktop Save Excel dialog failed: ${result.error?.message || result.stderr || result.stdout || result.status}`)
  }
}

try {
  await command('Page.enable')
  await command('Runtime.enable')
  await signInNormally()
  const alreadyOnList = await evaluate(`[...document.querySelectorAll('h2')].some(item=>item.innerText.trim()==='Engagements')`)
  if (!alreadyOnList) await clickButton('← Engagements')
  await waitFor(`text.includes('All Engagements')`, 'the authorized engagement list')
  await waitFor(`([...document.querySelectorAll('tr')].some(row=>row.innerText.includes(${JSON.stringify(engagementReference)})))`,
    'the existing UAE Sample 01 engagement')
  const opened = await evaluate(`(() => {
    const row=[...document.querySelectorAll('tr')].find(item=>item.innerText.includes(${JSON.stringify(engagementReference)}));
    if(!row)return false;
    row.click();
    return true;
  })()`)
  if (!opened) throw new Error('Could not open the existing UAE Sample 01 engagement.')
  await waitFor(`text.includes('Financial-statement approval date')`, 'the UAE reporting panel')
  const visible = await evaluate('document.body?.innerText || ""')
  assert.ok(visible.includes('UAE Sample 01 Demo LLC'), 'the selected engagement is the existing UAE sample')

  const outputs = await appApi('listEngagementReportOutputs', engagementId)
  const output = outputs.find(item => Number(item.version) === 7)
  assert.ok(output, 'the saved UAE report version 7 is available')
  assert.equal(Number(output.final_tb_version), 3, 'saved PDF v7 uses final Trial Balance v3')
  const savedPdf = await appApi('getEngagementReportOutput', Number(output.id))
  assert.equal(crypto.createHash('sha256').update(Buffer.from(savedPdf.pdfContentBase64, 'base64')).digest('hex'),
    '2d1d41e69827f5eed47f041a0b84ff13dfd80c97a4ccc9d4fd08c67e897838f6',
    'the preserved saved UAE PDF v7 remains byte-identical')
  if (reopenOnly) {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(outputPath)
    const reportingData = await appApi('getEngagementReportingData', {
      engagementId,
      trialBalanceId: Number(output.final_tb_id),
    })
    const currentMappings = Object.fromEntries(reportingData.uaeMappings.map(item => [
      String(item.trialBalanceRowId), item.lineKey,
    ]))
    const comparativeMappings = buildUaeDemoComparativeMappings(reportingData.currentRows || [], currentMappings)
    const comparativeRows = await readAllEngagementTrialBalanceRows(
      engagementId, Number(reportingData.comparativeTrialBalance.id),
    )
    const priorSheet = workbook.getWorksheet('Original Prior TB')
    assert.equal(priorSheet.rowCount, comparativeRows.length + 2,
      'reopened workbook retains every selected comparative source row')
    comparativeRows.forEach((row, index) => {
      assert.equal(priorSheet.getCell(index + 3, 8).value || '',
        getUaeDemoAccountLine(row, comparativeMappings) || '',
        `comparative row ${row.id} uses the report's selected mapping`)
    })
    assert.ok(workbook.getWorksheet('Movement Schedules'), 'reopened workbook retains the supporting schedules')
    assert.ok(workbook.getWorksheet('Final TB').getCell('K3').value.formula.includes("'Review Adjustments'!"),
      'reopened workbook retains formula-linked review-adjustment debits')
    assert.ok(workbook.getWorksheet('Final TB').getCell('L3').value.formula.includes("'Review Adjustments'!"),
      'reopened workbook retains formula-linked review-adjustment credits')
    assert.equal(workbook.getWorksheet('Statements & Schedules').getCell('B8').value.result, 239250,
      'reopened workbook retains the saved AED statement value')
    const notes = workbook.getWorksheet('Notes')
    assert.equal(notes.pageSetup.printArea, `A1:G${notes.rowCount}`,
      'reopened workbook prints every supporting note and note-total row')
    const bytes = fs.readFileSync(outputPath)
    console.log(JSON.stringify({
      reopenedEngagement: engagementReference,
      sourcePdfVersion: output.version,
      sourcePdfSha256: crypto.createHash('sha256').update(Buffer.from(savedPdf.pdfContentBase64, 'base64')).digest('hex'),
      workbookPath: outputPath,
      workbookSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      visibleOutputsReopened: true,
    }, null, 2))
  } else {
    const button = await evaluate(`(() => {
    const heading=[...document.querySelectorAll('div.flex.flex-wrap.items-center.gap-2.text-sm.font-medium')]
      .find(item=>item.innerText.includes('Version 7 · Final TB v3'));
    const row=heading?.closest('div.flex.flex-wrap.items-center.gap-3.py-3');
    const action=[...row?.querySelectorAll('button')||[]].find(item=>item.innerText.trim()==='Export Excel');
    if(!action || action.disabled)return false;
    action.scrollIntoView({block:'center'});
    action.click();
    return true;
  })()`)
    if (!button) throw new Error('Could not export the saved version 7 workbook through the visible UI.')
    await new Promise(resolve => setTimeout(resolve, 750))
    const exportError = await evaluate('document.querySelector(\'[role="alert"]\')?.innerText || ""')
    if (exportError) throw new Error(`The desktop rejected the workbook export: ${exportError}`)
    saveThroughDesktopDialog(outputPath)
    const fileDeadline = Date.now() + 20000
    while (Date.now() < fileDeadline && !fs.existsSync(outputPath)) {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    assert.ok(fs.existsSync(outputPath), `visible export created ${outputPath}`)
    const bytes = fs.readFileSync(outputPath)
    assert.equal(bytes.subarray(0, 2).toString('ascii'), 'PK', 'the exported file is a genuine OOXML ZIP workbook')
    assert.ok(bytes.length > 5000, 'the workbook contains substantive report data')
    console.log(JSON.stringify({
      engagement: engagementReference,
      sourcePdfVersion: output.version,
      finalTrialBalanceVersion: output.final_tb_version,
      workbookPath: outputPath,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    }, null, 2))
  }
} finally {
  socket.close()
}
