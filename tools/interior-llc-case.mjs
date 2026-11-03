import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { suggestUaeDemoAccountLine } from '../src/renderer/src/components/Engagements/uaeDemoReporting.js'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'
import {
  INTERIOR_SOURCE_FILE, indexAccounts, isPriorYearJournal, readInteriorWorkbook, resolveJournalAccount,
} from './interior-llc-source.mjs'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const credentials = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8'))
validateDemoUserCredentials(credentials.testUsers)
const administrator = credentials.testUsers.administrator
const inputDirectory = path.join(demoHome, 'inputs', 'Interior-LLC')
const outputDirectory = path.join(demoHome, 'outputs', 'Interior-LLC')
const REFERENCE = 'INTERIOR-LLC-2024'
const ENGAGEMENT_NAME = 'Interior LLC 2024 testing record'
const ENTITY_NAME = 'Interior LLC'
const ORIGINAL_FILE = 'Interior-LLC-TB-2024-original.xlsx'
const round2 = value => Math.round((value + Number.EPSILON) * 100) / 100

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (error) { reject(error) } })
    }).on('error', reject)
  })
}
const targets = await getJson('http://127.0.0.1:9339/json/list')
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
const appApi = (method, argument) => {
  console.error('api', method)
  return evaluate(`window.api[${JSON.stringify(method)}](${JSON.stringify(argument)})`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function signIn() {
  const status = await appApi('engagementAuthStatus', null)
  if (status?.user) return
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await evaluate(`!!document.querySelector('input[type="email"]')`)) break
    await sleep(200)
  }
  const submitted = await evaluate(`(() => {
    const email=document.querySelector('input[type="email"]');
    const password=document.querySelector('input[type="password"]');
    if(!email || !password || !email.form)return false;
    const set=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))};
    set(email,${JSON.stringify(administrator.email)});set(password,${JSON.stringify(administrator.password)});
    email.form.requestSubmit();return true})()`)
  assert.ok(submitted, 'the normal sign-in form accepted the isolated administrator')
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await appApi('engagementAuthStatus', null))?.user) return
    await sleep(200)
  }
  throw new Error('Isolated sign-in did not complete.')
}

// Original (unadjusted) balances only: the workbook's NET column, never the JV or Final columns.
function buildOriginalWorkbook(accounts) {
  const originalAccounts = accounts.filter(account => account.code !== '' || (!account.originalIsBlank && account.original !== 0))
  const rows = originalAccounts.map(account => {
    const closing = -account.original
    const opening = Math.round(account.openingCredit - account.openingDebit)
    const movement = closing - opening
    return {
      Period: '', Branch: '', 'Ledger Code': account.code, Name: account.name,
      OpeningBalance: opening, Debit: Math.max(0, -movement), Credit: Math.max(0, movement), ClosingBalance: closing,
      IsRevenue: false, IsDeemedPositive: closing <= 0, TrailBalance: closing, Parent: account.clientCategory,
    }
  })
  const total = rows.reduce((sum, row) => sum + row.ClosingBalance, 0)
  assert.equal(total, 0, 'the original unadjusted TB balances to zero')
  fs.mkdirSync(inputDirectory, { recursive: true })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Trial Balance')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Interior LLC - original unadjusted TB, FY 2024 (1 Jan 2024 to 31 Dec 2024)'],
    ['Source', `${INTERIOR_SOURCE_FILE} sheet TB 24, NET column (whole-AED rounded, includes TB round off row)`],
    ['Convention', 'ClosingBalance = credit - debit; debit balances negative. JV and Final columns are NOT imported.'],
    ['Opening balances', 'Source opening balance column; not verified prior-year closing and not used as a comparative.'],
  ]), 'Basis')
  const filePath = path.join(inputDirectory, ORIGINAL_FILE)
  fs.writeFileSync(filePath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  return { filePath, rows: rows.length }
}

async function main() {
  fs.mkdirSync(outputDirectory, { recursive: true })
  const { accounts, journals } = readInteriorWorkbook()
  const byName = indexAccounts(accounts)
  const original = buildOriginalWorkbook(accounts)
  await signIn()
  const status = await appApi('engagementAuthStatus', null)
  assert.equal(status.user.firmName, 'FSG Isolated Demo Firm')
  const options = await appApi('listEngagementOptions', null)
  const pack = options.packs.find(item => item.pack_id === 'AE_UAE_DEMO')
  const partner = options.users.find(item => item.role === 'partner')
  assert.ok(pack && partner)
  const existing = (await appApi('listEngagements', 'all')).find(item => item.reference === REFERENCE)
  let engagementId
  if (existing) engagementId = Number(existing.id)
  else {
    let entity = options.entities.find(item => item.name === ENTITY_NAME)
    if (!entity) entity = await appApi('createEngagementClient', { name: ENTITY_NAME, jurisdiction: 'AE', legalForm: 'LLC' })
    const created = await appApi('createEngagement', {
      entityId: Number(entity.id), name: ENGAGEMENT_NAME, reference: REFERENCE,
      periodStart: '2024-01-01', periodEnd: '2024-12-31', serviceScope: ['statutory_audit'],
      reportingPackId: pack.pack_id, jurisdiction: pack.jurisdiction, framework: pack.framework,
      trialBalanceCurrency: 'AED', presentationCurrency: 'AED', displayScale: 'units', decimalPlaces: 0,
      ownerUserId: Number(status.user.id), partnerUserId: Number(partner.id), substituteUserId: null, participants: [],
      status: 'active',
      separateReason: 'Interior LLC FY2024 client-data testing record created in the isolated demo database only.',
      compatibilityConfirmed: true, templateSelections: {},
    })
    engagementId = Number(created.id || created.engagement?.id)
  }
  assert.ok(engagementId > 0)

  let sources = await appApi('listEngagementTrialBalances', engagementId)
  let current = sources.find(item => (item.source_filename || item.filename) === ORIGINAL_FILE)
  if (!current) {
    const bytes = fs.readFileSync(original.filePath)
    await appApi('importEngagementTrialBalance', {
      engagementId, comparative: false, fileName: ORIGINAL_FILE, fileContentBase64: bytes.toString('base64'),
    })
    sources = await appApi('listEngagementTrialBalances', engagementId)
    current = sources.find(item => (item.source_filename || item.filename) === ORIGINAL_FILE)
  }
  assert.ok(current, 'original TB imported')
  const rowsPayload = await appApi('getEngagementTrialBalanceRows', { engagementId, trialBalanceId: Number(current.id) })
  const importedRows = Array.isArray(rowsPayload) ? rowsPayload : rowsPayload.rows
  const importedTotal = round2(importedRows.reduce((sum, row) => sum + Number(row.closing_balance), 0))
  assert.equal(importedRows.length, original.rows, 'every original row was imported')
  assert.equal(importedTotal, 0, 'imported original TB balances')

  const existingJournals = await appApi('listEngagementJournals', engagementId)
  const postable = journals.map((journal, index) => ({ journal, index: index + 1 })).filter(item => !isPriorYearJournal(item.journal))
  const excluded = journals.map((journal, index) => ({ journal, index: index + 1 })).filter(item => isPriorYearJournal(item.journal))
  for (const { journal, index } of postable) {
    const narration = `${journal.narration || 'No narration in source workbook'} [JV 24 #${index}]`
    if (existingJournals.some(item => item.narration === narration && Number(item.source_trial_balance_id) === Number(current.id))) continue
    const entries = journal.lines.map(line => {
      const account = resolveJournalAccount(line.sourceName, byName)
      assert.ok(account, `JV #${index} ledger "${line.sourceName}" resolves to a TB account`)
      return { ledgerName: account.name, ledgerCode: account.code, side: line.amount > 0 ? 'Dr' : 'Cr', amount: Math.abs(line.amount).toFixed(2) }
    })
    await appApi('postEngagementJournal', { engagementId, sourceTrialBalanceId: Number(current.id), date: '2024-12-31', narration, entries })
  }
  const journalList = await appApi('listEngagementJournals', engagementId)
  const mine = journalList.filter(item => Number(item.source_trial_balance_id) === Number(current.id))
  assert.equal(mine.length, postable.length, 'each supplied 2024 journal is posted exactly once')

  let snapshots = await appApi('listEngagementFinalTrialBalances', engagementId)
  const latestJournal = Math.max(0, ...mine.map(item => Number(item.id)))
  if (!snapshots[0] || Number(snapshots[0].journal_watermark || snapshots[0].journalWatermark || 0) < latestJournal) {
    await appApi('createEngagementFinalTrialBalance', { engagementId, sourceTrialBalanceId: Number(current.id) })
    snapshots = await appApi('listEngagementFinalTrialBalances', engagementId)
  }
  const snapshot = snapshots[0]
  const finalRows = await appApi('getEngagementFinalTrialBalanceRows', { engagementId, trialBalanceId: Number(snapshot.id) })

  const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  const finalByName = new Map(finalRows.map(row => [norm(row.name), row]))
  const reconciliation = accounts.map(account => {
    const row = finalByName.get(norm(account.name))
    const appFinal = row ? -Number(row.closing_balance) : 0
    return {
      code: account.code, name: account.name, clientCategory: account.clientCategory,
      original: account.original, workbookJournalColumn: account.journalColumn, workbookFinal: account.final,
      appFinal, difference: round2(appFinal - account.final), inAppFinal: Boolean(row),
    }
  })
  const differences = reconciliation.filter(item => Math.abs(item.difference) > 0.005)
  const totals = {
    originalTotal: reconciliation.reduce((sum, item) => sum + item.original, 0),
    workbookFinalTotal: reconciliation.reduce((sum, item) => sum + item.workbookFinal, 0),
    appFinalTotal: round2(finalRows.reduce((sum, row) => sum + Number(row.closing_balance), 0)),
    workbookFinalDebits: reconciliation.filter(item => item.workbookFinal > 0).reduce((sum, item) => sum + item.workbookFinal, 0),
    appFinalDebits: round2(finalRows.filter(row => Number(row.closing_balance) < 0).reduce((sum, row) => sum - Number(row.closing_balance), 0)),
  }

  // Mapping coverage against the 19-line UAE demonstration pack (no statements are generated from this).
  const mappingCoverage = { suggested: 0, unsuggested: [] }
  for (const row of finalRows) {
    const balance = Number(row.closing_balance)
    if (Math.abs(balance) < 0.005) continue
    if (suggestUaeDemoAccountLine(row.name)) mappingCoverage.suggested += 1
    else mappingCoverage.unsuggested.push({ name: row.name, balance: -balance, category: accounts.find(item => norm(item.name) === norm(row.name))?.clientCategory })
  }
  const unsuggestedTotal = mappingCoverage.unsuggested.reduce((sum, item) => sum + Math.abs(item.balance), 0)

  const result = {
    generatedAt: new Date().toISOString(), engagementId, reference: REFERENCE, sourceWorkbook: INTERIOR_SOURCE_FILE,
    sourceWorkbookSha256: crypto.createHash('sha256').update(fs.readFileSync(INTERIOR_SOURCE_FILE)).digest('hex'),
    importedFile: original.filePath, importedFileSha256: crypto.createHash('sha256').update(fs.readFileSync(original.filePath)).digest('hex'),
    sourceTrialBalanceId: Number(current.id), importedRows: importedRows.length,
    postedJournals: mine.length, excludedJournals: excluded.map(item => ({ sheetGroup: item.index, narration: item.journal.narration })),
    finalTrialBalanceId: Number(snapshot.id), finalTrialBalanceVersion: Number(snapshot.version), finalRows: finalRows.length,
    totals, accountsCompared: reconciliation.length, differences, mappingCoverage: {
      nonZeroLedgers: mappingCoverage.suggested + mappingCoverage.unsuggested.length,
      withSuggestedPackLine: mappingCoverage.suggested, withoutPackLine: mappingCoverage.unsuggested.length,
      withoutPackLineAbsoluteAed: unsuggestedTotal, examples: mappingCoverage.unsuggested.slice(0, 15),
    },
    reconciliation,
  }
  fs.writeFileSync(path.join(outputDirectory, 'interior-llc-reconciliation.json'), JSON.stringify(result, null, 2))
  const { reconciliation: _omit, ...summary } = result
  console.log(JSON.stringify(summary, null, 2))
}

try { await main() } finally { socket.close() }
