// Read-only check of the provisional Interior 2024 Balance Sheet / P&L preview against live ledger data.
// Recomputes the statements independently from raw rows and the pack, writes nothing to the database.
//   node tools/selftest-uae-statement-preview.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { buildStatementPreview, compareWithReference } from '../src/shared/uae-pack-statement-preview.mjs'

const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const outputDirectory = path.join(demoHome, 'outputs', 'Interior-LLC')
const targets = await new Promise((resolve, reject) => http.get('http://127.0.0.1:9339/json/list', response => {
  const chunks = []
  response.on('data', chunk => chunks.push(chunk))
  response.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
}).on('error', reject))
const page = targets.find(item => item.type === 'page' && new URL(item.url).hostname === 'localhost')
if (!page) throw new Error('Open the isolated desktop first.')
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
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.result?.description || result.exceptionDetails.text)
  return result.result?.value
}
const appApi = (method, argument) => evaluate(`window.api[${JSON.stringify(method)}](${JSON.stringify(argument)})`)
const results = []
const check = (condition, message) => { assert.ok(condition, message); results.push(message); console.log('PASS', message) }
const near = (a, b) => Math.abs(a - b) < 0.005

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const credentials = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8'))
const administrator = credentials.testUsers.administrator
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
await signIn()
const interior = (await appApi('listEngagements', 'all')).find(item => item.reference === 'INTERIOR-LLC-2024')
const snapshots = await appApi('listEngagementFinalTrialBalances', interior.id)
const latest = [...snapshots].sort((a, b) => Number(b.version) - Number(a.version))[0]
const review = await appApi('getEngagementPackMappingReview', { engagementId: interior.id, trialBalanceId: Number(latest.id) })
const preview = buildStatementPreview(review)

check(Number(review.finalVersion) === 1, 'preview source is Interior final TB v1')
check(review.pack.id === 'AE_UAE_SEPARATE_FS' && review.pack.version === '0.1-draft', 'pack is AE_UAE_SEPARATE_FS 0.1-draft')
check(review.rows.length === 302, `302 non-zero accounts (${review.rows.length})`)

// Independent recomputation straight from the raw rows.
const lineByKey = new Map(review.pack.lines.map(line => [line.key, line]))
const placedIds = new Map()
const independent = new Map()
let unresolvedNet = 0
let unresolvedAbs = 0
let unresolvedCount = 0
for (const row of review.rows) {
  const key = row.status === 'confirmed' ? row.lineKey : row.suggestedLineKey
  if (!key) { unresolvedNet += row.balance; unresolvedAbs += Math.abs(row.balance); unresolvedCount += 1; continue }
  assert.ok(lineByKey.has(key), `line ${key} defined`)
  placedIds.set(row.id, (placedIds.get(row.id) || 0) + 1)
  independent.set(key, (independent.get(key) || 0) + row.balance)
}
check([...placedIds.values()].every(count => count === 1), 'no ledger is counted twice')
check(placedIds.size + unresolvedCount === review.rows.length, `no ledger omitted (${placedIds.size} placed + ${unresolvedCount} exceptions = ${review.rows.length})`)
check(unresolvedCount === 17 && near(unresolvedAbs, 31279035) && near(unresolvedNet, -1033563), `unresolved coverage 17 accounts, net ${unresolvedNet}, absolute ${unresolvedAbs}`)
check(preview.coverage.suggestedCount === 285 && preview.coverage.confirmedCount === 0, 'preview uses the 285 suggestions and 0 confirmed mappings')
for (const line of preview.lineRows) {
  const expectedDebit = independent.get(line.key) || 0
  check(near(line.net, expectedDebit), `line ${line.key}: contributing ledgers sum to ${line.net}`)
  check(near(line.members.reduce((sum, row) => sum + row.balance, 0), expectedDebit), `line ${line.key}: members match independent total`)
}
const sectionOf = key => lineByKey.get(key).section
const sum = predicate => [...independent].filter(([key]) => predicate(lineByKey.get(key))).reduce((acc, [, v]) => acc + v, 0)
const debitPlaceholder = -[...review.rows].filter(row => row.balance < 0 && !(row.status === 'confirmed' ? row.lineKey : row.suggestedLineKey)).reduce((acc, row) => acc + row.balance, 0)
const assets = debitPlaceholder - sum(line => line.statement === 'SFP' && ['Non-current assets', 'Current assets'].includes(line.section))
const profit = sum(line => line.statement === 'PL')
const creditPlaceholder = [...review.rows].filter(row => row.balance > 0 && !(row.status === 'confirmed' ? row.lineKey : row.suggestedLineKey)).reduce((acc, row) => acc + row.balance, 0)
const equityLiab = creditPlaceholder + sum(line => line.statement === 'SFP' && ['Equity', 'Liabilities'].includes(line.section)) + profit
check(near(preview.totals.totalAssets, assets), `total assets ${preview.totals.totalAssets} matches independent ${assets}`)
check(near(preview.totals.totalEquityAndLiabilities, equityLiab), `total equity and liabilities ${preview.totals.totalEquityAndLiabilities} matches independent ${equityLiab}`)
check(near(preview.totals.profit, profit), `profit ${preview.totals.profit} matches independent ${profit}`)
check(near(preview.totals.difference, assets - equityLiab), `Balance Sheet difference ${preview.totals.difference} shown, not forced to zero`)
check(near(preview.totals.difference, -preview.tbNet) && near(preview.tbNet, 0), 'balanced final TB gives a balanced draft Balance Sheet with all 17 unresolved accounts visible as placeholders')
check(preview.unclassified.debit.count + preview.unclassified.credit.count === 17 && near(preview.unclassified.debit.amount - preview.unclassified.credit.amount, -unresolvedNet), 'debit and credit placeholders hold all 17 accounts and are kept separate')
check(near(preview.totals.totalEquity - preview.totals.totalEquityBeforeProfit, profit), 'only the derived P&L profit was added to equity')
check(preview.checks.filter(item => item.kind === 'arithmetic').every(item => item.passed) && preview.arithmeticReconciled, 'arithmetic reconciliation checks pass')
check(preview.classification.complete === false, 'classification completeness is reported separately and is incomplete')
check(sectionOf('revenue') === 'Profit or loss', 'sanity: revenue is a P&L line')

const comparison = compareWithReference(preview)
fs.mkdirSync(outputDirectory, { recursive: true })
fs.writeFileSync(path.join(outputDirectory, 'statement-preview-check.json'), JSON.stringify({
  checkedAt: new Date().toISOString(), finalTb: latest.id, finalVersion: review.finalVersion, totals: preview.totals,
  coverage: preview.coverage, tbNet: preview.tbNet, checks: preview.checks,
  lines: preview.lineRows.filter(line => line.members.length).map(line => ({ key: line.key, amount: line.amount, ledgers: line.members.length })),
  referenceComparison: comparison.map(({ label, calculated, reference, difference, populated }) => ({ label, calculated, reference, difference, populated })),
}, null, 2))
console.log(JSON.stringify({ totals: preview.totals, tbNet: preview.tbNet, coverage: preview.coverage }, null, 1))
console.log(`${results.length} checks passed`)
socket.close()
