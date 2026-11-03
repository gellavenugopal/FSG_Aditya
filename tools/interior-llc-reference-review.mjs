// Loads the supplied TB - 25 reference classifications into the isolated Interior engagement
// (as year-2025 proposals) and prints the mapping-review coverage. It never changes TB balances,
// journals or mappings. Run only against the isolated desktop: .\tools\engagement-demo.ps1 demo
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')
const REFERENCE_WORKBOOK = process.env.FSG_UAE_REFERENCE_WORKBOOK
  || 'D:\\Programs\\FinancialStatements\\AdityaTool\\client-reference\\UAESample1\\Schedules & PL.xlsx'
const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const credentials = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8'))
validateDemoUserCredentials(credentials.testUsers)
const administrator = credentials.testUsers.administrator
const outputDirectory = path.join(demoHome, 'outputs', 'Interior-LLC')
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
const appApi = (method, argument) => evaluate(`window.api[${JSON.stringify(method)}](${JSON.stringify(argument)})`)

async function signIn() {
  if ((await appApi('engagementAuthStatus', null))?.user) return
  for (let attempt = 0; attempt < 50 && !(await evaluate(`!!document.querySelector('input[type="email"]')`)); attempt++) await sleep(200)
  const submitted = await evaluate(`(() => {
    const email=document.querySelector('input[type="email"]');
    const password=document.querySelector('input[type="password"]');
    if(!email || !password || !email.form)return false;
    const set=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))};
    set(email,${JSON.stringify(administrator.email)});set(password,${JSON.stringify(administrator.password)});
    email.form.requestSubmit();return true})()`)
  assert.ok(submitted, 'sign-in form available')
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await appApi('engagementAuthStatus', null))?.user) return
    await sleep(200)
  }
  throw new Error('Isolated sign-in did not complete.')
}

function readReferenceRows() {
  const workbook = XLSX.readFile(REFERENCE_WORKBOOK, { cellDates: false })
  const sheet = workbook.Sheets['TB - 25']
  assert.ok(sheet, 'TB - 25 sheet exists')
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', range: { s: { r: 0, c: 0 }, e: { r: 2000, c: 14 } } })
  const text = value => String(value ?? '').trim()
  return grid.slice(2).filter(row => text(row[1])).map(row => ({
    accountCode: text(row[1]), description: text(row[2]), clientMapping: text(row[7]),
    mainClassification: text(row[8]), subClassification: text(row[9]), subClassificationExtra: text(row[10]),
  })).map(row => ({ ...row, subClassification2: row.subClassificationExtra }))
}

await signIn()
const status = await appApi('engagementAuthStatus', null)
assert.equal(status.user.firmName, 'FSG Isolated Demo Firm')
const engagement = (await appApi('listEngagements', 'all')).find(item => item.reference === 'INTERIOR-LLC-2024')
assert.ok(engagement, 'Interior engagement exists')
const snapshots = await appApi('listEngagementFinalTrialBalances', engagement.id)
const finalSnapshot = snapshots.find(item => Number(item.version) === 1) || snapshots[0]
assert.ok(finalSnapshot, 'Interior final TB exists')
const rows = readReferenceRows()
let imported = 'already imported'
try {
  const result = await appApi('importEngagementPackReference', {
    engagementId: engagement.id, sourceLabel: 'TB - 25 reference (2025 classifications)', sourceYear: 2025,
    sourceSheet: 'TB - 25', replace: true, rows,
  })
  imported = `${result.rowCount} rows imported`
} catch (error) {
  if (!/already imported/.test(String(error.message))) throw error
}
const review = await appApi('getEngagementPackMappingReview', { engagementId: engagement.id, trialBalanceId: Number(finalSnapshot.id) })
const duplicates = review.rows.filter(row => row.duplicate).length
const conflicts = review.rows.filter(row => row.conflict).length
const summary = {
  engagementId: engagement.id, finalVersion: review.finalVersion, finalTrialBalanceId: review.trialBalanceId,
  reference: imported, referenceRowCount: review.referenceRowCount, nonZeroAccounts: review.rows.length,
  zeroBalanceAccounts: review.zeroBalanceAccounts, coverage: review.coverage, duplicateCodeRows: duplicates, conflictingRows: conflicts,
  unresolvedAccounts: review.rows.filter(row => row.status === 'unresolved' || row.status === 'conflict')
    .map(row => ({ code: row.code, name: row.name, balance: row.balance, issue: row.issue })),
}
fs.mkdirSync(outputDirectory, { recursive: true })
fs.writeFileSync(path.join(outputDirectory, 'mapping-review-coverage.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ ...summary, unresolvedAccounts: summary.unresolvedAccounts.length }, null, 2))
socket.close()
