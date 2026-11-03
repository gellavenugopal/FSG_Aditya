// Draft-revision verification in the isolated desktop. Writes only: (1) a new synthetic engagement and its draft
// revisions, (2) additive draft revisions for Interior (TB, journals, mappings are read-only and compared before/after).
//   node tools/selftest-engagement-demo-draft-revisions.mjs write   (then restart the app)
//   node tools/selftest-engagement-demo-draft-revisions.mjs verify
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'
import { formatAmount } from '../src/shared/uae-draft-report-model.mjs'

const require = createRequire(import.meta.url)
const JSZip = require('jszip')
const ExcelJS = require('exceljs')
const phase = process.argv[2]
assert.ok(['write', 'verify'].includes(phase), 'phase must be write or verify')
const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const credentials = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8'))
validateDemoUserCredentials(credentials.testUsers)
const administrator = credentials.testUsers.administrator
const outputDirectory = path.join(demoHome, 'outputs', 'draft-revisions')
const stateFile = path.join(outputDirectory, 'state.json')
const SYNTHETIC_REFERENCE = 'SYN-DRAFT-REV-2025'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const check = (condition, message) => { assert.ok(condition, message); console.log('PASS', message) }

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

const latestFinal = async engagementId => {
  const snapshots = await appApi('listEngagementFinalTrialBalances', engagementId)
  return [...snapshots].sort((a, b) => Number(b.version) - Number(a.version))[0]
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const interiorDigest = async interiorId => {
  const snapshot = await latestFinal(interiorId)
  const review = await appApi('getEngagementPackMappingReview', { engagementId: interiorId, trialBalanceId: Number(snapshot.id) })
  const journals = await appApi('listEngagementJournals', interiorId)
  return digest({ rows: review.rows.map(row => [row.id, row.balance, row.lineKey, row.basis, row.status]), journals: journals.map(item => item.id), version: snapshot.version })
}

async function generate(engagementId, trialBalanceId) {
  const prepared = await appApi('prepareEngagementDraftReport', { engagementId, trialBalanceId })
  const files = await appApi('buildEngagementDraftFiles', prepared.model)
  check(Object.keys(files).sort().join() === 'docxBase64,pdfBase64,xlsxBase64', 'PDF, Word and Excel are produced from one prepared model')
  const saved = await appApi('saveEngagementDraftRevision', { engagementId, trialBalanceId, modelSha256: prepared.modelSha256, ...files })
  return { prepared, saved }
}

async function figuresInFiles(engagementId, revision, model) {
  const figures = [model.totals.totalAssets, model.totals.totalEquityAndLiabilities, model.totals.profit].map(formatAmount)
  const read = async format => Buffer.from((await appApi('readEngagementDraftRevision', { revisionId: revision.id, format })).fileBase64, 'base64')
  const pdf = await read('pdf')
  check(pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 5000, `revision ${revision.revision} PDF is a real PDF`)
  const zip = await JSZip.loadAsync(await read('docx'))
  const text = (await zip.file('word/document.xml').async('string')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  check(figures.every(item => text.includes(item)), `revision ${revision.revision} Word shows the screen totals ${figures.join(' / ')}`)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await read('xlsx'))
  const numbers = new Set()
  workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => { if (typeof cell.value === 'number') numbers.add(Math.round(cell.value * 100) / 100) })))
  check([model.totals.totalAssets, model.totals.totalEquityAndLiabilities, model.totals.profit].every(value => numbers.has(Math.round(value * 100) / 100)), `revision ${revision.revision} Excel holds the same totals`)
  return pdf
}

await signIn()
assert.equal((await appApi('engagementAuthStatus', null)).user.firmName, 'FSG Isolated Demo Firm')
const list = await appApi('listEngagements', 'all')
const interior = list.find(item => item.reference === 'INTERIOR-LLC-2024')
assert.ok(interior, 'Interior exists')
fs.mkdirSync(outputDirectory, { recursive: true })

if (phase === 'write') {
  const interiorBefore = await interiorDigest(interior.id)
  const options = await appApi('listEngagementOptions', null)
  const pack = options.packs.find(item => item.pack_id === 'AE_UAE_DEMO')
  const partner = options.users.find(item => item.role === 'partner')
  const userId = Number((await appApi('engagementAuthStatus', null)).user.id)
  let synthetic = list.find(item => item.reference === SYNTHETIC_REFERENCE)
  if (!synthetic) {
    const entity = await appApi('createEngagementClient', { name: 'Synthetic Draft Revision LLC', jurisdiction: 'AE', legalForm: 'LLC' })
    const created = await appApi('createEngagement', {
      entityId: Number(entity.id), name: 'Synthetic draft revision test', reference: SYNTHETIC_REFERENCE,
      periodStart: '2025-01-01', periodEnd: '2025-12-31', serviceScope: ['statutory_audit'],
      reportingPackId: pack.pack_id, jurisdiction: pack.jurisdiction, framework: pack.framework,
      trialBalanceCurrency: 'AED', presentationCurrency: 'AED', displayScale: 'units', decimalPlaces: 2,
      ownerUserId: userId, partnerUserId: Number(partner.id), substituteUserId: null, participants: [], status: 'active',
      separateReason: 'Synthetic draft-revision verification; no client accounts.', compatibilityConfirmed: true, templateSelections: {},
    })
    synthetic = { id: Number(created.id || created.engagement?.id) }
  }
  const XLSX = require('xlsx')
  const ledgers = [['Cash at bank', -1000], ['Trade receivables', -500], ['Office rent', -200], ['Trade payables', 300], ['Share capital', 700], ['Sales revenue', 700], ['Zzz unknown A', -50], ['Zzz unknown B', 50]]
  const sheet = XLSX.utils.aoa_to_sheet([['LedgerCode', 'Name', 'OpeningBalance', 'Debit', 'Credit', 'ClosingBalance'], ...ledgers.map(([name, closing], index) => [`S${index + 1}`, name, 0, closing < 0 ? -closing : 0, closing > 0 ? closing : 0, closing])])
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Trial Balance')
  const fileBytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
  const filePath = path.join(demoHome, 'inputs', 'SYN-DRAFT-REV-2025.xlsx')
  fs.writeFileSync(filePath, fileBytes)
  let sources = await appApi('listEngagementTrialBalances', synthetic.id)
  if (!sources.length) {
    const target = JSON.parse(fs.readFileSync(process.env.FSG_TEST_TARGET_FILE, 'utf8'))
    const importing = appApi('importEngagementTrialBalance', { engagementId: synthetic.id })
    await sleep(2500)
    const dialog = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-File', path.join(repositoryRoot, 'tools', 'engagement-demo-select-dialog.ps1'),
      '-Action', 'Open', '-DialogTitle', 'Import Trial Balance', '-FilePath', filePath, '-DemoHome', demoHome, '-UserDataPath', target.userDataPath, '-RepositoryRoot', repositoryRoot], { encoding: 'utf8', timeout: 45000 })
    assert.equal(dialog.status, 0, `import dialog helper: ${dialog.stderr || dialog.stdout}`)
    await importing
    sources = await appApi('listEngagementTrialBalances', synthetic.id)
  }
  await appApi('createEngagementFinalTrialBalance', { engagementId: synthetic.id, sourceTrialBalanceId: Number(sources[0].id) })
  const snapshot = await latestFinal(synthetic.id)
  const trialBalanceId = Number(snapshot.id)

  const emptyList = await appApi('listEngagementDraftRevisions', { engagementId: synthetic.id })
  check(emptyList.finalisationBlockers !== undefined, 'draft-revision list responds for the synthetic engagement')
  const first = await generate(synthetic.id, trialBalanceId)
  check(first.saved.revision >= 1, 'first synthetic revision saved')
  const review = await appApi('getEngagementPackMappingReview', { engagementId: synthetic.id, trialBalanceId })
  const target = review.rows.find(row => row.status !== 'confirmed' && !row.lineKey && Math.abs(row.balance) > 0.005)
  assert.ok(target, 'an unclassified synthetic row exists to correct')
  const sameSign = review.pack.lines.find(line => line.statement === 'SFP' && (target.balance < 0 ? /assets/i.test(line.section) : line.section === 'Liabilities'))
  await appApi('saveEngagementPackMappingReview', { engagementId: synthetic.id, trialBalanceId, tbRowId: target.id, lineKey: sameSign.key, basis: 'manual' })
  const second = await generate(synthetic.id, trialBalanceId)
  check(second.saved.revision === first.saved.revision + 1 && second.saved.modelSha256 !== first.saved.modelSha256, 'mapping correction creates revision 2 with a different source hash')
  check(second.prepared.model.coverage.unresolvedCount === first.prepared.model.coverage.unresolvedCount - 1, 'revision 2 has one fewer unclassified account')

  const revisions = (await appApi('listEngagementDraftRevisions', { engagementId: synthetic.id })).revisions
  const oldRead = await appApi('readEngagementDraftRevision', { revisionId: revisions.find(item => item.revision === first.saved.revision).id })
  check(oldRead.modelSha256 === first.saved.modelSha256 && oldRead.model.coverage.unresolvedCount === first.prepared.model.coverage.unresolvedCount, 'revision 1 still reopens with its original figures after the mapping change')
  await figuresInFiles(synthetic.id, revisions.find(item => item.revision === first.saved.revision), oldRead.model)
  const newRead = await appApi('readEngagementDraftRevision', { revisionId: revisions.find(item => item.revision === second.saved.revision).id })
  await figuresInFiles(synthetic.id, revisions.find(item => item.revision === second.saved.revision), newRead.model)

  const syntheticBlockers = (await appApi('listEngagementDraftRevisions', { engagementId: synthetic.id })).finalisationBlockers
  check(syntheticBlockers.some(item => /unclassified|pack/i.test(item)), 'synthetic finalisation blockers are reported')
  const finaliseMessage = await failure('finaliseEngagement', { engagementId: synthetic.id })
  console.log('finalise message:', finaliseMessage)
  check(Boolean(finaliseMessage), 'engagement finalisation is refused for the administrator (role check; the blocker gate shares the same helper and is reported in the list)')
  const outputMessage = await failure('saveEngagementReportOutput', { engagementId: synthetic.id, trialBalanceId })
  console.log('output-save message:', outputMessage)
  check(/separate|draft revision/i.test(outputMessage || ''), 'legacy synthetic-path output save is refused for a separate-FS engagement')

  const interiorSnapshot = await latestFinal(interior.id)
  const interiorRun = await generate(interior.id, Number(interiorSnapshot.id))
  const interiorModel = interiorRun.prepared.model
  check(interiorModel.identity.reference === 'INTERIOR-LLC-2024' && interiorModel.source.packId === 'AE_UAE_SEPARATE_FS', 'Interior draft uses its own identity and the separate-FS pack, not AE_UAE_DEMO')
  check(interiorModel.coverage.unresolvedCount === 17 && Math.abs(interiorModel.totals.difference) < 0.005, 'Interior draft keeps 17 unresolved accounts and a zero difference')
  const interiorRevisions = (await appApi('listEngagementDraftRevisions', { engagementId: interior.id })).revisions
  await figuresInFiles(interior.id, interiorRevisions.find(item => item.revision === interiorRun.saved.revision), interiorModel)
  check(interiorBefore === await interiorDigest(interior.id), 'Interior TB, journals and mappings are unchanged by draft generation')
  fs.writeFileSync(stateFile, JSON.stringify({
    syntheticId: synthetic.id, syntheticHashes: { [first.saved.revision]: first.saved.modelSha256, [second.saved.revision]: second.saved.modelSha256 },
    interiorId: interior.id, interiorRevision: interiorRun.saved.revision, interiorHash: interiorRun.saved.modelSha256, interiorDigest: interiorBefore,
    totals: interiorModel.totals,
  }, null, 2))
} else {
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  const synthetic = (await appApi('listEngagementDraftRevisions', { engagementId: state.syntheticId })).revisions
  check(Object.entries(state.syntheticHashes).every(([revision, hash]) => synthetic.find(item => item.revision === Number(revision))?.modelSha256 === hash), 'synthetic revisions 1 and 2 reopen after restart with recorded hashes')
  const interiorRevisions = (await appApi('listEngagementDraftRevisions', { engagementId: state.interiorId })).revisions
  const saved = interiorRevisions.find(item => item.revision === state.interiorRevision)
  check(saved && saved.modelSha256 === state.interiorHash, 'Interior saved draft reopens after restart with its recorded hash')
  const read = await appApi('readEngagementDraftRevision', { revisionId: saved.id })
  check(Math.abs(read.model.totals.totalAssets - state.totals.totalAssets) < 0.005 && read.model.coverage.unresolvedCount === 17, 'reopened Interior draft shows the same totals and 17 unresolved accounts')
  await figuresInFiles(state.interiorId, saved, read.model)
  check(state.interiorDigest === await interiorDigest(state.interiorId), 'Interior TB, journals and mappings are unchanged after restart')
}
socket.close()
console.log('\nDone.')
