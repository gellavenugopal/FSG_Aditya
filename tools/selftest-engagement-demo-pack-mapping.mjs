// Mapping-review persistence and isolation check. Writes ONLY to the synthetic UAE-SAMPLE-01-2025 engagement
// and reads Interior before/after to prove it is unchanged. Run against the isolated desktop only.
//   node tools/selftest-engagement-demo-pack-mapping.mjs write   (then restart the app)
//   node tools/selftest-engagement-demo-pack-mapping.mjs verify
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')
const phase = process.argv[2]
assert.ok(['write', 'verify'].includes(phase), 'phase must be write or verify')
const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const credentials = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8'))
validateDemoUserCredentials(credentials.testUsers)
const administrator = credentials.testUsers.administrator
const outputDirectory = path.join(demoHome, 'outputs', 'UAE-Sample-01-pack-mapping')
const stateFile = path.join(outputDirectory, 'state.json')
const REFERENCE_WORKBOOK = process.env.FSG_UAE_REFERENCE_WORKBOOK
  || 'D:\\Programs\\FinancialStatements\\AdityaTool\\client-reference\\UAESample1\\Schedules & PL.xlsx'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const results = []
const check = (condition, message) => { assert.ok(condition, message); results.push(message); console.log('PASS', message) }

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
const failure = async (method, argument) => {
  try { await appApi(method, argument) } catch (error) { return String(error.message) }
  return null
}

async function signIn() {
  if ((await appApi('engagementAuthStatus', null))?.user) return
  for (let attempt = 0; attempt < 50 && !(await evaluate(`!!document.querySelector('input[type="email"]')`)); attempt++) await sleep(200)
  await evaluate(`(() => {
    const email=document.querySelector('input[type="email"]'), password=document.querySelector('input[type="password"]');
    const set=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))};
    set(email,${JSON.stringify(administrator.email)});set(password,${JSON.stringify(administrator.password)});email.form.requestSubmit()})()`)
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await appApi('engagementAuthStatus', null))?.user) return
    await sleep(200)
  }
  throw new Error('Isolated sign-in did not complete.')
}

const digest = review => crypto.createHash('sha256').update(JSON.stringify(
  review.rows.map(row => [row.id, row.code, row.balance, row.lineKey, row.basis, row.suggestedLineKey, row.status]),
)).digest('hex')

async function reviewOf(engagementId) {
  const snapshots = await appApi('listEngagementFinalTrialBalances', engagementId)
  const latest = [...snapshots].sort((a, b) => Number(b.version) - Number(a.version))[0]
  const review = await appApi('getEngagementPackMappingReview', { engagementId, trialBalanceId: Number(latest.id) })
  return { snapshot: latest, review }
}

await signIn()
assert.equal((await appApi('engagementAuthStatus', null)).user.firmName, 'FSG Isolated Demo Firm')
const list = await appApi('listEngagements', 'all')
const interior = list.find(item => item.reference === 'INTERIOR-LLC-2024')
const sample = list.find(item => item.reference === 'UAE-SAMPLE-01-2025')
assert.ok(interior && sample, 'Interior and synthetic UAE Sample 01 exist')
fs.mkdirSync(outputDirectory, { recursive: true })

const SOURCE_A = 'TEST-REF-A'
const SOURCE_B = 'TEST-REF-B'

if (phase === 'write') {
  const interiorBefore = await reviewOf(interior.id)
  const interiorDigest = digest(interiorBefore.review)
  const { snapshot, review: initial } = await reviewOf(sample.id)
  const finalRows = await appApi('getEngagementFinalTrialBalanceRows', { engagementId: sample.id, trialBalanceId: Number(snapshot.id) })
  const coded = finalRows.filter(row => row.ledger_code && Math.abs(Number(row.closing_balance)) > 0.004)
  assert.ok(coded.length >= 4, 'sample has at least four coded non-zero rows')
  const [rowOne, rowTwo, rowThree, rowFour] = coded
  const refRow = (row, main, sub = '') => ({ accountCode: ` ${String(row.ledger_code).toLowerCase()} `, description: row.name, clientMapping: 'TEST', mainClassification: main, subClassification: sub })

  const importA = await appApi('importEngagementPackReference', {
    engagementId: sample.id, sourceLabel: SOURCE_A, sourceYear: 2025, sourceSheet: 'TEST',
    rows: [refRow(rowOne, '  Cash   and Cash Equivalents'), refRow(rowTwo, 'REVENUE'), refRow(rowThree, 'Share Capital')],
  })
  const importB = await appApi('importEngagementPackReference', {
    engagementId: sample.id, sourceLabel: SOURCE_B, sourceYear: 2024, sourceSheet: 'TEST-B',
    rows: [refRow(rowFour, 'Other Income')],
  })
  check(importA.rowCount === 3 && importB.rowCount === 1, 'two separate reference sources import into the test engagement')
  const duplicateImport = await failure('importEngagementPackReference', { engagementId: sample.id, sourceLabel: SOURCE_A, sourceYear: 2025, sourceSheet: 'TEST', rows: [refRow(rowOne, 'Revenue')] })
  check(/already imported/.test(duplicateImport || ''), 'importing the same source again is refused unless replacement is explicit')

  let { review } = await reviewOf(sample.id)
  const find = (r, row) => r.rows.find(item => item.id === Number(row.id))
  check(find(review, rowOne).status === 'suggested' && find(review, rowOne).suggestedLineKey === 'cash_and_bank'
    && find(review, rowOne).references[0].sourceYear === 2025 && find(review, rowOne).references[0].sourceLabel === SOURCE_A,
  'suggestions match exact codes after case and whitespace normalisation, keeping source label, year and original text')
  check(review.coverage.confirmed.count === 0 && review.coverage.suggestedAwaitingReview.count >= 4,
    'suggestions alone never become confirmed mappings')

  const refusedBasis = await failure('saveEngagementPackMappingReview', { engagementId: sample.id, trialBalanceId: review.trialBalanceId, tbRowId: Number(rowOne.id), lineKey: 'not_a_line', basis: 'manual' })
  check(/statement line defined/.test(refusedBasis || ''), 'an undefined statement line is rejected')

  await appApi('saveEngagementPackMappingReview', { engagementId: sample.id, trialBalanceId: review.trialBalanceId, tbRowId: Number(rowOne.id), lineKey: 'cash_and_bank', basis: 'accepted_suggestion' })
  await appApi('saveEngagementPackMappingReview', { engagementId: sample.id, trialBalanceId: review.trialBalanceId, tbRowId: Number(rowTwo.id), lineKey: 'other_income', basis: 'manual' })
  review = (await reviewOf(sample.id)).review
  check(find(review, rowOne).status === 'confirmed' && find(review, rowOne).basis === 'accepted_suggestion'
    && find(review, rowTwo).status === 'confirmed' && find(review, rowTwo).lineKey === 'other_income' && find(review, rowTwo).basis === 'manual'
    && review.coverage.confirmed.count === 2,
  'accepted suggestion and manual change are saved as confirmed')
  const overwrite = await failure('saveEngagementPackMappingReview', { engagementId: sample.id, trialBalanceId: review.trialBalanceId, tbRowId: Number(rowTwo.id), lineKey: 'revenue', basis: 'accepted_suggestion' })
  check(/never replaced by a suggestion/.test(overwrite || ''), 'a suggestion cannot overwrite a manual mapping')

  // Replace source A: row two now proposes a different line; row three is dropped from the reference.
  await appApi('importEngagementPackReference', {
    engagementId: sample.id, sourceLabel: SOURCE_A, sourceYear: 2025, sourceSheet: 'TEST', replace: true,
    rows: [refRow(rowOne, 'Cash and cash equivalents'), refRow(rowTwo, 'Revenue', ''), refRow(rowThree, 'Statutory reserve')],
  })
  const afterReplace = (await reviewOf(sample.id)).review
  check(find(afterReplace, rowTwo).lineKey === 'other_income' && find(afterReplace, rowTwo).basis === 'manual' && find(afterReplace, rowTwo).status === 'confirmed',
    'replacing reference suggestions leaves the manual mapping unchanged')
  check(find(afterReplace, rowOne).lineKey === 'cash_and_bank' && find(afterReplace, rowOne).basis === 'accepted_suggestion',
    'replacing reference suggestions leaves the accepted mapping unchanged')
  check(find(afterReplace, rowThree).suggestedLineKey === 'statutory_reserve' && find(afterReplace, rowThree).status === 'suggested',
    'the replaced source supplies the new proposal without confirming it')
  check(find(afterReplace, rowFour).references.length === 1 && find(afterReplace, rowFour).references[0].sourceLabel === SOURCE_B && find(afterReplace, rowFour).references[0].sourceYear === 2024,
    'replacing one source leaves an unrelated source untouched')

  const interiorAfter = await reviewOf(interior.id)
  check(digest(interiorAfter.review) === interiorDigest && interiorAfter.review.referenceRowCount === interiorBefore.review.referenceRowCount,
    'Interior mappings and reference rows are unchanged by writes to another engagement')
  const crossEngagement = await failure('saveEngagementPackMappingReview', { engagementId: sample.id, trialBalanceId: interiorBefore.review.trialBalanceId, tbRowId: Number(interiorBefore.review.rows[0].id), lineKey: 'cash_and_bank', basis: 'manual' })
  check(!!crossEngagement, `a mapping cannot be written to another engagement's final TB (${crossEngagement})`)
  const crossRow = await failure('saveEngagementPackMappingReview', { engagementId: sample.id, trialBalanceId: review.trialBalanceId, tbRowId: Number(interiorBefore.review.rows[0].id), lineKey: 'cash_and_bank', basis: 'manual' })
  check(/not in this final Trial Balance/.test(crossRow || ''), 'a row from another engagement cannot be mapped')
  fs.writeFileSync(stateFile, JSON.stringify({
    sampleEngagementId: sample.id, rowOne: { id: Number(rowOne.id), code: rowOne.ledger_code }, rowTwo: { id: Number(rowTwo.id), code: rowTwo.ledger_code },
    interiorDigest, interiorReferenceRows: interiorBefore.review.referenceRowCount,
  }, null, 2))
} else {
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  const { review } = await reviewOf(sample.id)
  const find = id => review.rows.find(item => item.id === id)
  check(find(state.rowOne.id).lineKey === 'cash_and_bank' && find(state.rowOne.id).basis === 'accepted_suggestion' && find(state.rowOne.id).status === 'confirmed',
    'accepted suggestion survives an application restart')
  check(find(state.rowTwo.id).lineKey === 'other_income' && find(state.rowTwo.id).basis === 'manual',
    'manual mapping survives an application restart')
  const interiorNow = await reviewOf(interior.id)
  check(digest(interiorNow.review) === state.interiorDigest && interiorNow.review.referenceRowCount === state.interiorReferenceRows,
    'Interior review is identical after restart')
}

// Compare the importer's stored Interior reference rows with the workbook (read-only).
if (phase === 'write') {
  const workbook = XLSX.readFile(REFERENCE_WORKBOOK)
  const grid = XLSX.utils.sheet_to_json(workbook.Sheets['TB - 25'], { header: 1, defval: '', range: { s: { r: 0, c: 0 }, e: { r: 2000, c: 14 } } })
  const source = new Map(grid.slice(2).filter(row => String(row[1]).trim()).map(row => [String(row[1]).trim(), row]))
  const { review } = await reviewOf(interior.id)
  const samples = ['1000', '1056', '2000', '4502', '5000-10-101', '9363-10'].filter(code => source.has(code))
  for (const code of samples) {
    const row = review.rows.find(item => String(item.code).trim() === code)
    if (!row) continue
    const ref = row.references[0]
    const raw = source.get(code)
    check(ref && ref.main === String(raw[8]).trim() && (ref.sub || '') === String(raw[9]).trim() && (ref.clientMapping || '') === String(raw[7]).trim()
      && ref.sourceYear === 2025 && ref.sheet === 'TB - 25',
    `Interior reference row ${code} matches workbook columns H/I/J (client, main, sub) with year 2025 and sheet TB - 25`)
  }
  check(review.referenceRowCount === source.size, `importer stored all ${source.size} TB - 25 rows (${review.referenceRowCount})`)
}
fs.writeFileSync(path.join(outputDirectory, `${phase}-results.json`), JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
console.log(`${phase}: ${results.length} checks passed`)
socket.close()
