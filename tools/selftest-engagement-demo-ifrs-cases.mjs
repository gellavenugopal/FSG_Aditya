import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import { buildUaeDemoFinancials, suggestUaeDemoAccountLine } from '../src/renderer/src/components/Engagements/uaeDemoReporting.js'
import { resolveDisposableTestTarget } from '../src/main/test-isolation.mjs'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'
import { createUaeIfrsTestBedFixtures } from './uae-ifrs-testbed-fixtures.mjs'

if (process.env.FSG_TEST_MODE !== 'true') {
  throw new Error('Run UAE IFRS case workflows only through the existing isolated engagement demo.')
}

const phase = process.argv[2] || 'create'
if (!['create', 'reopen'].includes(phase)) throw new Error('Choose the "create" or "reopen" verification phase.')

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { target } = resolveDisposableTestTarget()
const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const credentialsPath = path.join(demoHome, 'credentials.json')
const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))
validateDemoUserCredentials(credentials.testUsers)
const administrator = credentials.testUsers.administrator
const outputDirectory = path.join(demoHome, 'outputs', 'UAE-IFRS-Testbed', 'Saved-Engagements')
const inputDirectory = path.join(demoHome, 'inputs', 'UAE-IFRS-Testbed')
const statePath = path.join(outputDirectory, 'engagements.json')
const helperPath = path.join(repositoryRoot, 'tools', 'engagement-demo-select-dialog.ps1')
const periodStart = '2025-01-01'
const periodEnd = '2025-12-31'
const caseReferences = new Map([
  ['B-SIMPLE-TRADING-LLC', 'IFRS-CASE-B-TRADING-2025'],
  ['C-IAS16-REVALUATION-OCI', 'IFRS-CASE-C-OCI-2025'],
])
const fixtures = createUaeIfrsTestBedFixtures().filter(fixture => caseReferences.has(fixture.id))

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (error) { reject(new Error('Could not read the isolated desktop DevTools endpoint.', { cause: error })) }
      })
    }).on('error', reject)
  })
}

const targets = await getJson('http://127.0.0.1:9339/json/list')
const page = targets.find(item => {
  if (item.type !== 'page') return false
  const url = new URL(item.url)
  return url.hostname === 'localhost' && Number(url.port) >= 5173 && Number(url.port) <= 5180
})
if (!page?.webSocketDebuggerUrl) {
  throw new Error('Open exactly one existing isolated desktop instance with .\\tools\\engagement-demo.ps1 launch first.')
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
  if (result.exceptionDetails) {
    throw new Error(result.result?.description || result.exceptionDetails.text)
  }
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

async function setLabeledControl(labelText, value) {
  const updated = await evaluate(`(() => {
    const label=[...document.querySelectorAll('label')].find(item=>
      ([...item.children].find(child=>child.tagName==='SPAN')?.innerText.trim() || '')===${JSON.stringify(labelText)});
    const input=label?.querySelector('input,textarea,select');
    if(!input || input.disabled)return false;
    const prototype=input.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype :
      input.tagName==='SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`)
  if (!updated) throw new Error(`Could not set the "${labelText}" field.`)
}

async function ensureCheckbox(labelText) {
  const checked = await evaluate(`(() => {
    const label=[...document.querySelectorAll('label')].find(item=>(item.innerText || '').includes(${JSON.stringify(labelText)}));
    const input=label?.querySelector('input[type="checkbox"]');
    if(!input)return false;
    if(!input.checked)input.click();
    return input.checked;
  })()`)
  if (!checked) throw new Error(`Could not select the "${labelText}" signatory.`)
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
  body = await evaluate('document.body?.innerText || ""')
  assert.ok(body.includes('Engagements'), 'successful sign-in opens the firm engagement workspace')
}

async function returnToList() {
  const listVisible = await evaluate(`!!document.querySelector('h2') && [...document.querySelectorAll('h2')].some(item=>item.innerText.trim()==='Engagements')`)
  if (listVisible) return
  await clickButton('← Engagements')
  await waitFor(`text.includes('All Engagements')`, 'the firm-wide engagement list')
}

async function refreshEngagementList() {
  const currentScope = await evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find(item=>item.innerText.trim()==='All Engagements');
    return !!button && button.className.includes('border-blue-700');
  })()`)
  if (currentScope) {
    await clickButton('My Engagements')
    await waitFor(`(() => [...document.querySelectorAll('button')].some(item=>item.innerText.trim()==='My Engagements' && item.className.includes('border-blue-700')))()`,
      'My Engagements refresh')
    await clickButton('All Engagements')
  } else {
    await clickButton('All Engagements')
  }
  await waitFor(`(() => [...document.querySelectorAll('button')].some(item=>item.innerText.trim()==='All Engagements' && item.className.includes('border-blue-700')))()`,
    'the firm-wide engagement list refresh')
}

async function clickEngagement(reference) {
  await waitFor(`([...document.querySelectorAll('tr')].some(item=>item.innerText.includes(${JSON.stringify(reference)})))`,
    `engagement ${reference} to appear in the visible firm list`)
  const clicked = await evaluate(`(() => {
    const row=[...document.querySelectorAll('tr')].find(item=>item.innerText.includes(${JSON.stringify(reference)}));
    if(!row)return false;
    row.click();
    return true;
  })()`)
  if (!clicked) throw new Error(`Engagement ${reference} is not present in the visible firm list.`)
  await waitFor(`text.includes('UAE reporting demonstration')`, `the reporting panel for ${reference}`)
}

async function clickOutputButton(rowText, buttonText) {
  const clicked = await evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find(item=>{
      if(item.innerText.trim()!==${JSON.stringify(buttonText)})return false;
      let parent=item.parentElement;
      while(parent && parent!==document.body){
        if((parent.innerText || '').includes(${JSON.stringify(rowText)}))return true;
        parent=parent.parentElement;
      }
      return false;
    });
    if(!button || button.disabled)return false;
    button.scrollIntoView({block:'center'});
    button.click();
    return true;
  })()`)
  if (!clicked) throw new Error(`Could not find "${buttonText}" for "${rowText}".`)
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

function selectWorkbookThroughDesktopDialog(filePath, dialogTitle) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-STA', '-File', helperPath,
    '-Action', 'Open',
    '-DialogTitle', dialogTitle,
    '-FilePath', filePath,
    '-DemoHome', demoHome,
    '-UserDataPath', target.userDataPath,
    '-RepositoryRoot', repositoryRoot,
  ], { encoding: 'utf8', timeout: 45000 })
  if (result.error || result.status !== 0) {
    throw new Error(`The isolated desktop workbook dialog failed: ${result.error?.message || result.stderr || result.stdout || result.status}`)
  }
}

async function waitForFile(filePath) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`The desktop save dialog closed but ${path.basename(filePath)} was not written.`)
}

function reportFields(fixture, firm, partner) {
  return {
    addressee: `The Members of ${fixture.entity.name}`,
    opinion: 'Synthetic test-bed wording only. This is not a client audit opinion or a claim of IFRS compliance.',
    basisForOpinion: 'This first-cut synthetic reporting example is for development testing and has not been validated for production.',
    managementResponsibilities: 'Management is responsible for the synthetic information presented in this demonstration.',
    auditorResponsibilities: 'The demonstration text does not describe an audit performed for a client.',
    otherMatters: 'Draft for demonstration; the reporting coverage is limited and not a validated IFRS pack.',
    reportDate: '2026-03-15',
    reportPlace: 'Dubai, United Arab Emirates',
    firmName: firm.firm_name,
    firmAddress: firm.address || '',
    firmRegistrationNumber: firm.frn || '',
    auditorName: partner.displayName,
    auditorMembershipNumber: partner.registration_number || '',
    auditorDesignation: partner.jobTitle || 'Partner',
  }
}

function assertExpectedFinancials(fixture, financials) {
  assert.ok(financials, `${fixture.id} financial statements were calculated`)
  assert.ok(!financials.reportingError, `${fixture.id} has no reporting error: ${financials.reportingError || ''}`)
  const comparePeriod = (actual, expected, period) => {
    assert.equal(actual.position.assets, expected.assets, `${fixture.id} ${period} assets`)
    assert.equal(actual.position.totalLiabilitiesAndEquity, expected.liabilitiesAndEquity, `${fixture.id} ${period} liabilities and equity`)
    assert.equal(actual.profit.profitForYear, expected.profit, `${fixture.id} ${period} profit`)
    assert.equal(actual.profit.otherComprehensiveIncome, expected.oci, `${fixture.id} ${period} OCI`)
    assert.equal(actual.profit.totalComprehensiveIncome, expected.comprehensiveIncome, `${fixture.id} ${period} comprehensive income`)
    assert.equal(actual.equity.totalClosing, expected.equity, `${fixture.id} ${period} closing equity`)
    assert.equal(actual.equity.difference, 0, `${fixture.id} ${period} equity movements reconcile`)
    assert.equal(actual.cashFlow.openingCash, expected.cashOpening, `${fixture.id} ${period} selected opening cash`)
    assert.equal(actual.cashFlow.closingCash, expected.cashClosing, `${fixture.id} ${period} closing cash`)
    assert.equal(actual.cashFlow.netMovement, expected.cashMovement, `${fixture.id} ${period} cash flow movement`)
    assert.equal(actual.cashFlow.difference, 0, `${fixture.id} ${period} cash flows reconcile`)
  }
  comparePeriod(financials.current, fixture.expected.current, 'current')
  comparePeriod(financials.comparative, fixture.expected.comparative, 'comparative')
  for (const expectedNote of fixture.expected.noteTotals) {
    const note = financials.notes.find(item => item.number === expectedNote.noteNumber)
    assert.ok(note, `${fixture.id} note ${expectedNote.noteNumber} exists`)
    assert.equal(note.currentTotal, expectedNote.currentTotal, `${fixture.id} note ${expectedNote.noteNumber} current balance`)
    assert.equal(note.comparativeTotal, expectedNote.comparativeTotal, `${fixture.id} note ${expectedNote.noteNumber} comparative balance`)
  }
}

async function findOrCreateEngagement(fixture, options, existingEngagements, pack, partner) {
  const reference = caseReferences.get(fixture.id)
  let engagement = existingEngagements.find(item => item.reference === reference)
  if (engagement) return Number(engagement.id)

  let entity = options.entities.find(item => item.name === fixture.entity.name)
  if (!entity) {
    entity = await appApi('createEngagementClient', {
      name: fixture.entity.name,
      jurisdiction: 'AE',
      legalForm: 'LLC',
    })
  }
  const created = await appApi('createEngagement', {
    entityId: Number(entity.id),
    name: fixture.name,
    reference,
    periodStart,
    periodEnd,
    serviceScope: ['statutory_audit'],
    reportingPackId: pack.pack_id,
    jurisdiction: pack.jurisdiction,
    framework: pack.framework,
    trialBalanceCurrency: 'AED',
    presentationCurrency: 'AED',
    displayScale: 'units',
    decimalPlaces: 2,
    ownerUserId: Number(options.userId),
    partnerUserId: Number(partner.id),
    substituteUserId: null,
    participants: [],
    status: 'active',
    separateReason: `Separate deterministic synthetic test-bed case ${fixture.id}; no client accounts.`,
    compatibilityConfirmed: true,
    templateSelections: {},
  })
  const engagementId = Number(created.id || created.engagement?.id)
  assert.ok(Number.isSafeInteger(engagementId) && engagementId > 0, `${fixture.id} engagement was created through the protected service`)
  return engagementId
}

async function importFixtureTB(engagementId, filename, comparative) {
  const filePath = path.join(inputDirectory, filename)
  if (!fs.existsSync(filePath)) throw new Error(`Synthetic source Trial Balance is missing: ${filePath}`)
  const sources = await appApi('listEngagementTrialBalances', engagementId)
  const existing = sources.find(item => item.source_filename === filename || item.filename === filename)
  if (existing) {
    if (comparative) {
      await appApi('selectEngagementComparativeTrialBalance', {
        engagementId,
        trialBalanceId: Number(existing.id),
      })
    }
    return existing
  }
  if (comparative) {
    const snapshots = await appApi('listEngagementFinalTrialBalances', engagementId)
    if (snapshots[0]) {
      const reportData = await appApi('getEngagementReportingData', {
        engagementId,
        trialBalanceId: Number(snapshots[0].id),
      })
      const selectedComparative = reportData.comparativeTrialBalance
      if (selectedComparative?.filename === filename) return selectedComparative
      if (selectedComparative) {
        throw new Error(`A different comparative is already selected for engagement ${engagementId}; it was preserved.`)
      }
    }
  }
  const button = comparative ? 'Import prior-year Trial Balance' : '+ Import Excel'
  const title = comparative ? 'Import Prior-year Trial Balance' : 'Import Trial Balance'
  await clickButton(button)
  selectWorkbookThroughDesktopDialog(filePath, title)
  if (comparative) {
    await waitFor(`text.includes('imported and selected')`, `${filename} comparative import`)
  } else {
    await waitFor(`text.includes(${JSON.stringify(filename)})`, `${filename} current-year import`)
  }
  const alert = await evaluate(`document.querySelector('[role="alert"]')?.textContent || ''`)
  if (alert) throw new Error(`The visible import workflow reported an error: ${alert}`)
  const importedSources = await appApi('listEngagementTrialBalances', engagementId)
  return importedSources.find(item => item.source_filename === filename || item.filename === filename) || null
}

async function prepareCase(fixture, options, firmSettings, existingEngagements, pack, partner) {
  const reference = caseReferences.get(fixture.id)
  const existing = existingEngagements.find(item => item.reference === reference)
  if (existing) {
    const outputs = await appApi('listEngagementReportOutputs', Number(existing.id))
    if (outputs.length) {
      const savedState = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null
      const savedCase = savedState?.cases.find(item => item.fixtureId === fixture.id)
      const output = outputs.reduce((latest, item) => Number(item.version) > Number(latest?.version || 0) ? item : latest, null)
      if (savedCase?.pdfSha256 && savedCase.pdfPath && Number(output.version) === Number(savedCase.outputVersion)) {
        return { ...savedCase, existing: Number(output.version) >= 2 }
      }

      assert.ok(output, `${reference} has a saved output`)
      assert.equal(output.finalised_at || null, null, `${reference} version ${output.version} remains a demonstration draft`)
      const snapshots = await appApi('listEngagementFinalTrialBalances', Number(existing.id))
      const snapshot = snapshots.find(item => Number(item.version) === Number(output.final_tb_version))
      assert.ok(snapshot, `${reference} saved output references an existing final Trial Balance`)
      const finalTrialBalanceId = Number(snapshot.id)
      const [sources, journals, reportData, savedOutput] = await Promise.all([
        appApi('listEngagementTrialBalances', Number(existing.id)),
        appApi('listEngagementJournals', Number(existing.id)),
        appApi('getEngagementReportingData', { engagementId: Number(existing.id), trialBalanceId: finalTrialBalanceId }),
        appApi('getEngagementReportOutput', Number(output.id)),
      ])
      const current = sources.find(item => item.source_filename === `${fixture.id}-2025.xlsx`
        || item.filename === `${fixture.id}-2025.xlsx`)
      assert.ok(current, `${reference} source Trial Balance remains available`)
      assert.ok(reportData.comparativeTrialBalance, `${reference} saved comparative Trial Balance remains selected`)
      const mappings = Object.fromEntries(reportData.uaeMappings.map(item => [
        String(item.trialBalanceRowId), item.lineKey,
      ]))
      const financials = buildUaeDemoFinancials({
        currentRows: reportData.currentRows,
        comparativeRows: reportData.comparativeRows,
        mappings,
        periodEnd: reportData.engagement.periodEnd,
        comparativePeriodEnd: reportData.comparativeTrialBalance.dateTill,
      })
      assertExpectedFinancials(fixture, financials)
      const pdfBytes = Buffer.from(savedOutput.pdfContentBase64, 'base64')
      const pdfSha256 = crypto.createHash('sha256').update(pdfBytes).digest('hex')
      const pdfPath = path.join(outputDirectory, `${fixture.id}-reporting-pack-v${output.version}.pdf`)
      assert.ok(fs.existsSync(pdfPath), `${reference} local copy of the saved output is available`)
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(pdfPath)).digest('hex'), pdfSha256,
        `${reference} local PDF matches the service-saved output`)
      const pdf = await PDFDocument.load(pdfBytes)
      const fields = reportData.auditReport?.fields || {}
      const selections = reportData.reportingSelections || {}
      return {
        fixtureId: fixture.id,
        reference,
        engagementId: Number(existing.id),
        entityName: fixture.entity.name,
        currentSourceFile: `${fixture.id}-2025.xlsx`,
        comparativeSourceFile: `${fixture.id}-2024.xlsx`,
        currentTrialBalanceId: Number(current.id),
        comparativeTrialBalanceId: Number(reportData.comparativeTrialBalance.id),
        finalTrialBalanceId,
        finalTBVersion: Number(snapshot.version),
        journalCount: journals.filter(item => Number(item.source_trial_balance_id) === Number(current.id)).length,
        outputVersion: Number(output.version),
        pdfPath,
        pdfSha256,
        pdfPages: pdf.getPageCount(),
        pdfBytes: pdfBytes.length,
        financials: {
          assets: financials.current.position.assets,
          liabilitiesAndEquity: financials.current.position.totalLiabilitiesAndEquity,
          profit: financials.current.profit.profitForYear,
          oci: financials.current.profit.otherComprehensiveIncome,
          comprehensiveIncome: financials.current.profit.totalComprehensiveIncome,
          closingEquity: financials.current.equity.totalClosing,
          closingCash: financials.current.cashFlow.closingCash,
        },
        expectedReportingSelections: {
          responsibleAuditorFirmId: Number(selections.responsibleAuditorFirmId),
          responsibleOfficeId: Number(selections.responsibleOfficeId),
          brandingAuditorFirmId: Number(selections.brandingAuditorFirmId),
          managementSignatoryIds: (selections.managementSignatoryIds || []).map(Number),
          approvalDate: output.approval_date,
          approvalPlace: output.approval_place,
          reportDate: fields.reportDate,
          reportPlace: fields.reportPlace,
        },
        existing: Number(output.version) >= 2,
      }
    }
  }

  const engagementId = existing
    ? Number(existing.id)
    : await findOrCreateEngagement(fixture, options, existingEngagements, pack, partner)
  await returnToList()
  await refreshEngagementList()
  await clickEngagement(reference)
  const currentFile = `${fixture.id}-2025.xlsx`
  const priorFile = `${fixture.id}-2024.xlsx`
  const currentSources = await appApi('listEngagementTrialBalances', engagementId)
  let current = currentSources.find(item => item.source_filename === currentFile || item.filename === currentFile)
  if (!current) {
    current = await importFixtureTB(engagementId, currentFile, false)
  }
  assert.ok(Number(current?.id) > 0, `${fixture.id} current-year source Trial Balance was imported`)

  await importFixtureTB(engagementId, priorFile, true)
  const currentJournalRows = await appApi('listEngagementJournals', engagementId)
  const sourceAccounts = new Map(fixture.currentTrialBalance.rows.map(row => [row.name.trim().toLowerCase(), row]))
  for (const journal of fixture.journals) {
    const narration = `${journal.description} [${journal.id}]`
    if (currentJournalRows.some(item => item.narration === narration)) continue
    const entries = journal.entries.map(entry => {
      const row = sourceAccounts.get(entry.ledgerName.trim().toLowerCase())
      if (!row) throw new Error(`${journal.id} ledger ${entry.ledgerName} is missing from its source fixture.`)
      return {
        ledgerName: entry.ledgerName,
        ledgerCode: row.ledger_code,
        side: entry.side,
        amount: entry.amount,
      }
    })
    await appApi('postEngagementJournal', {
      engagementId,
      sourceTrialBalanceId: Number(current.id),
      date: journal.date,
      narration,
      entries,
    })
  }

  const journals = await appApi('listEngagementJournals', engagementId)
  const latestJournalId = Math.max(0, ...journals
    .filter(item => Number(item.source_trial_balance_id) === Number(current.id))
    .map(item => Number(item.id)))
  let snapshots = await appApi('listEngagementFinalTrialBalances', engagementId)
  let latest = snapshots[0]
  if (!latest || Number(latest.journal_watermark || latest.journalWatermark || 0) < latestJournalId) {
    await appApi('createEngagementFinalTrialBalance', {
      engagementId,
      sourceTrialBalanceId: Number(current.id),
    })
    snapshots = await appApi('listEngagementFinalTrialBalances', engagementId)
    latest = snapshots[0]
  }
  const finalTrialBalanceId = Number(latest?.id)
  assert.ok(finalTrialBalanceId > 0, `${fixture.id} final Trial Balance snapshot exists`)

  const finalRows = await appApi('getEngagementFinalTrialBalanceRows', {
    engagementId,
    trialBalanceId: finalTrialBalanceId,
  })
  const mappingByCode = new Map(fixture.currentTrialBalance.rows.map(row => [
    String(row.ledger_code).toLowerCase(),
    fixture.currentTrialBalance.mappings[String(row.id)],
  ]))
  const mappings = finalRows.map(row => ({
    tbRowId: Number(row.id),
    lineKey: mappingByCode.get(String(row.ledger_code || '').toLowerCase()) || suggestUaeDemoAccountLine(row.name),
  }))
  assert.ok(mappings.every(item => item.lineKey), `${fixture.id} all final Trial Balance rows map to UAE demonstration lines`)
  await appApi('saveEngagementUaeDemoMappings', {
    engagementId,
    trialBalanceId: finalTrialBalanceId,
    mappings,
  })

  const currentReportData = await appApi('getEngagementReportingData', {
    engagementId,
    trialBalanceId: finalTrialBalanceId,
  })
  const comparativeId = Number(currentReportData.comparativeTrialBalance?.id)
  assert.ok(comparativeId > 0, `${fixture.id} selected 2024 comparative Trial Balance exists`)
  if (Number(currentReportData.comparativeTrialBalance?.id) !== comparativeId) {
    await appApi('selectEngagementComparativeTrialBalance', {
      engagementId,
      trialBalanceId: comparativeId,
    })
  }

  const signatoryName = fixture.id.startsWith('B-')
    ? 'Synthetic Managing Member - Trading LLC'
    : 'Synthetic Managing Member - OCI LLC'
  let signatory = currentReportData.signatories.find(item => item.name === signatoryName)
  if (!signatory) {
    signatory = await appApi('createEngagementReportSignatory', {
      engagementId,
      name: signatoryName,
      designation: 'Managing Member',
    })
  }
  const selectedFirm = firmSettings.professionalFirms.find(item => item.is_active)
  const selectedOffice = firmSettings.offices.find(item => item.is_active
    && Number(item.auditor_firm_id) === Number(selectedFirm?.id))
  assert.ok(selectedFirm && selectedOffice, 'an active isolated firm, office, and logo profile are configured')
  await appApi('saveEngagementReportingSelections', {
    engagementId,
    responsibleAuditorFirmId: Number(selectedFirm.id),
    responsibleOfficeId: Number(selectedOffice.id),
    brandingAuditorFirmId: Number(selectedFirm.id),
    managementSignatoryIds: [Number(signatory.id)],
  })
  const fields = reportFields(fixture, selectedFirm, partner)
  await appApi('saveEngagementAuditReportSettings', { engagementId, fields })
  const narrative = fixture.disclosures.narrative[0]
  await appApi('saveEngagementNoteDisclosure', {
    engagementId,
    trialBalanceId: finalTrialBalanceId,
    noteNum: narrative.note_num,
    noteTitle: narrative.note_title,
    text: narrative.text,
  })

  const reportData = await appApi('getEngagementReportingData', {
    engagementId,
    trialBalanceId: finalTrialBalanceId,
  })
  const savedNarrative = reportData.noteDisclosures.find(item => Number(item.note_num) === narrative.note_num)
  assert.equal(savedNarrative?.note_title, narrative.note_title, `${fixture.id} narrative remains attached to its selected note`)
  assert.equal(savedNarrative?.text, narrative.text, `${fixture.id} narrative text persists unchanged`)
  const savedMappings = Object.fromEntries(reportData.uaeMappings.map(item => [
    String(item.trialBalanceRowId), item.lineKey,
  ]))
  const financials = buildUaeDemoFinancials({
    currentRows: reportData.currentRows,
    comparativeRows: reportData.comparativeRows,
    mappings: savedMappings,
    periodEnd: reportData.engagement.periodEnd,
    comparativePeriodEnd: reportData.comparativeTrialBalance?.dateTill,
  })
  assertExpectedFinancials(fixture, financials)
  await clickButton('← Engagements')
  await waitFor(`text.includes('All Engagements')`, 'return to the visible firm engagement list after case setup')

  return {
    fixtureId: fixture.id,
    reference,
    engagementId,
    entityName: fixture.entity.name,
    currentSourceFile: currentFile,
    comparativeSourceFile: priorFile,
    currentTrialBalanceId: Number(current.id),
    comparativeTrialBalanceId: comparativeId,
    finalTrialBalanceId,
    finalTBVersion: Number(latest.version),
    journalCount: fixture.journals.length,
    outputVersion: null,
    pdfPath: path.join(outputDirectory, `${fixture.id}-reporting-pack-v1.pdf`),
    financials: {
      assets: financials.current.position.assets,
      liabilitiesAndEquity: financials.current.position.totalLiabilitiesAndEquity,
      profit: financials.current.profit.profitForYear,
      oci: financials.current.profit.otherComprehensiveIncome,
      comprehensiveIncome: financials.current.profit.totalComprehensiveIncome,
      closingEquity: financials.current.equity.totalClosing,
      closingCash: financials.current.cashFlow.closingCash,
    },
    expectedReportingSelections: {
      responsibleAuditorFirmId: Number(selectedFirm.id),
      responsibleOfficeId: Number(selectedOffice.id),
      brandingAuditorFirmId: Number(selectedFirm.id),
      managementSignatoryIds: [Number(signatory.id)],
      approvalDate: '2026-03-10',
      approvalPlace: 'Dubai, United Arab Emirates',
      reportDate: fields.reportDate,
      reportPlace: fields.reportPlace,
    },
  }
}

async function generateThroughVisibleUI(caseState) {
  const reportIsOpen = await evaluate(`(document.body?.innerText || '').includes(${JSON.stringify(caseState.reference)}) && (document.body?.innerText || '').includes('UAE reporting demonstration')`)
  if (!reportIsOpen) {
    await returnToList()
    await refreshEngagementList()
    await clickEngagement(caseState.reference)
  }
  await waitFor(`text.includes('Financial-statement approval date')`, `signing controls for ${caseState.reference}`)
  const fixture = fixtures.find(item => item.id === caseState.fixtureId)
  assert.ok(fixture, `${caseState.fixtureId} fixture remains available`)
  const narrative = fixture.disclosures.narrative[0]
  await appApi('saveEngagementNoteDisclosure', {
    engagementId: caseState.engagementId,
    trialBalanceId: caseState.finalTrialBalanceId,
    noteNum: narrative.note_num,
    noteTitle: narrative.note_title,
    text: narrative.text,
  })
  await clickButton('← Engagements')
  await waitFor(`text.includes('All Engagements')`, 'refresh the saved narrative in the reporting panel')
  await refreshEngagementList()
  await clickEngagement(caseState.reference)
  await waitFor(`text.includes('Financial-statement approval date')`, `reopened signing controls for ${caseState.reference}`)
  const reportData = await appApi('getEngagementReportingData', {
    engagementId: caseState.engagementId,
    trialBalanceId: caseState.finalTrialBalanceId,
  })
  const savedNarrative = reportData.noteDisclosures.find(item => Number(item.note_num) === narrative.note_num)
  assert.equal(savedNarrative?.note_title, narrative.note_title, `${caseState.fixtureId} narrative is attached to its selected note`)
  assert.equal(savedNarrative?.text, narrative.text, `${caseState.fixtureId} narrative survives panel reopening`)
  await setLabeledControl('Financial-statement approval date', caseState.expectedReportingSelections.approvalDate)
  await setLabeledControl('Financial-statement approval place', caseState.expectedReportingSelections.approvalPlace)
  await ensureCheckbox(caseState.fixtureId.startsWith('B-')
    ? 'Synthetic Managing Member - Trading LLC'
    : 'Synthetic Managing Member - OCI LLC')
  const savedOutputs = await appApi('listEngagementReportOutputs', caseState.engagementId)
  const targetVersion = Math.max(0, ...savedOutputs.map(item => Number(item.version))) + 1
  assert.ok(targetVersion <= 2, `${caseState.fixtureId} does not create duplicate versions after the corrected draft`)
  if (caseState.outputVersion) {
    caseState.priorOutputVersion = Number(caseState.outputVersion)
    caseState.priorPdfPath = caseState.pdfPath
    caseState.priorPdfSha256 = caseState.pdfSha256
  }
  caseState.outputVersion = targetVersion
  caseState.pdfPath = path.join(outputDirectory, `${caseState.fixtureId}-reporting-pack-v${targetVersion}.pdf`)
  if (!savedOutputs.some(item => Number(item.version) === targetVersion)) {
    await clickButton('Generate & save combined PDF')
    await waitFor(`text.includes(${JSON.stringify(`combined PDF v${targetVersion} saved as a draft for demonstration`)})`,
      `the saved ${caseState.fixtureId} PDF v${targetVersion}`, 120000)
  }
  const outputs = await appApi('listEngagementReportOutputs', caseState.engagementId)
  const output = outputs.find(item => Number(item.version) === targetVersion)
  assert.ok(output, `${caseState.fixtureId} combined PDF v${targetVersion} is saved by the reporting UI`)
  assert.equal(output.finalised_at || null, null, `${caseState.fixtureId} output remains a demonstration draft`)
  const saved = await appApi('getEngagementReportOutput', Number(output.id))
  const pdfBytes = Buffer.from(saved.pdfContentBase64, 'base64')
  assert.equal(pdfBytes.subarray(0, 5).toString('ascii'), '%PDF-', `${caseState.fixtureId} service output is a PDF`)
  const pdfSha256 = crypto.createHash('sha256').update(pdfBytes).digest('hex')
  fs.mkdirSync(outputDirectory, { recursive: true })
  const localPath = caseState.pdfPath
  if (fs.existsSync(localPath)) {
    const localHash = crypto.createHash('sha256').update(fs.readFileSync(localPath)).digest('hex')
    assert.equal(localHash, pdfSha256, `${caseState.fixtureId} preserved local PDF matches the saved output`)
  } else {
    await clickOutputButton(`Version ${targetVersion} ·`, 'Download PDF')
    savePdfThroughDesktopDialog(localPath)
    await waitForFile(localPath)
  }
  const downloadedHash = crypto.createHash('sha256').update(fs.readFileSync(localPath)).digest('hex')
  assert.equal(downloadedHash, pdfSha256, `${caseState.fixtureId} visible UI download matches the service-saved PDF`)
  if (caseState.priorOutputVersion) {
    const priorOutput = outputs.find(item => Number(item.version) === Number(caseState.priorOutputVersion))
    assert.ok(priorOutput, `${caseState.fixtureId} prior PDF version remains saved`)
    assert.ok(fs.existsSync(caseState.priorPdfPath), `${caseState.fixtureId} prior local PDF remains available`)
    assert.equal(
      crypto.createHash('sha256').update(fs.readFileSync(caseState.priorPdfPath)).digest('hex'),
      caseState.priorPdfSha256,
      `${caseState.fixtureId} prior local PDF was not changed by regeneration`,
    )
    const priorSaved = await appApi('getEngagementReportOutput', Number(priorOutput.id))
    assert.equal(
      crypto.createHash('sha256').update(Buffer.from(priorSaved.pdfContentBase64, 'base64')).digest('hex'),
      caseState.priorPdfSha256,
      `${caseState.fixtureId} prior service output was not changed by regeneration`,
    )
  }
  const pdf = await PDFDocument.load(pdfBytes)
  assert.ok(pdf.getPageCount() >= 1, `${caseState.fixtureId} PDF has physical pages`)
  caseState.outputVersion = Number(output.version)
  caseState.pdfSha256 = pdfSha256
  caseState.pdfPages = pdf.getPageCount()
  caseState.pdfBytes = pdfBytes.length
  caseState.pdfPath = localPath
  await clickButton('← Engagements')
  await waitFor(`text.includes('All Engagements')`, 'return to the visible firm engagement list')
}

function verifyPersistedFinancials(fixture, reportData) {
  const mappings = Object.fromEntries(reportData.uaeMappings.map(item => [
    String(item.trialBalanceRowId), item.lineKey,
  ]))
  const financials = buildUaeDemoFinancials({
    currentRows: reportData.currentRows,
    comparativeRows: reportData.comparativeRows,
    mappings,
    periodEnd: reportData.engagement.periodEnd,
    comparativePeriodEnd: reportData.comparativeTrialBalance?.dateTill,
  })
  assertExpectedFinancials(fixture, financials)
  return financials
}

async function verifyAfterRestart(state) {
  const engagements = await appApi('listEngagements', 'all')
  const caseResults = []
  for (const fixture of fixtures) {
    const caseState = state.cases.find(item => item.fixtureId === fixture.id)
    assert.ok(caseState, `${fixture.id} has a saved local checkpoint`)
    const engagement = engagements.find(item => item.reference === caseState.reference)
    assert.ok(engagement, `${caseState.reference} remains visible after restart`)
    await returnToList()
    await refreshEngagementList()
    await clickEngagement(caseState.reference)

    const outputs = await appApi('listEngagementReportOutputs', caseState.engagementId)
    const output = outputs.find(item => Number(item.version) === Number(caseState.outputVersion))
    assert.ok(output, `${fixture.id} saved output survives application restart`)
    assert.equal(output.finalised_at || null, null, `${fixture.id} saved output remains a draft after restart`)
    const saved = await appApi('getEngagementReportOutput', Number(output.id))
    const bytes = Buffer.from(saved.pdfContentBase64, 'base64')
    const hash = crypto.createHash('sha256').update(bytes).digest('hex')
    assert.equal(hash, caseState.pdfSha256, `${fixture.id} reopened service output hash is unchanged`)
    assert.ok(fs.existsSync(caseState.pdfPath), `${fixture.id} local downloaded PDF remains available`)
    assert.equal(
      crypto.createHash('sha256').update(fs.readFileSync(caseState.pdfPath)).digest('hex'),
      hash,
      `${fixture.id} local PDF matches the reopened service output`,
    )
    if (caseState.priorOutputVersion) {
      const priorOutput = outputs.find(item => Number(item.version) === Number(caseState.priorOutputVersion))
      assert.ok(priorOutput, `${fixture.id} earlier saved PDF version remains available after restart`)
      const priorSaved = await appApi('getEngagementReportOutput', Number(priorOutput.id))
      assert.equal(
        crypto.createHash('sha256').update(Buffer.from(priorSaved.pdfContentBase64, 'base64')).digest('hex'),
        caseState.priorPdfSha256,
        `${fixture.id} earlier service output hash remains unchanged after restart`,
      )
      assert.ok(fs.existsSync(caseState.priorPdfPath), `${fixture.id} earlier local PDF survives restart`)
      assert.equal(
        crypto.createHash('sha256').update(fs.readFileSync(caseState.priorPdfPath)).digest('hex'),
        caseState.priorPdfSha256,
        `${fixture.id} earlier local PDF hash remains unchanged after restart`,
      )
    }

    const reportData = await appApi('getEngagementReportingData', {
      engagementId: caseState.engagementId,
      trialBalanceId: Number(caseState.finalTrialBalanceId),
    })
    verifyPersistedFinancials(fixture, reportData)
    const expected = caseState.expectedReportingSelections
    assert.equal(Number(reportData.reportingSelections.responsibleAuditorFirmId), expected.responsibleAuditorFirmId)
    assert.equal(Number(reportData.reportingSelections.responsibleOfficeId), expected.responsibleOfficeId)
    assert.equal(Number(reportData.reportingSelections.brandingAuditorFirmId), expected.brandingAuditorFirmId)
    assert.deepEqual(reportData.reportingSelections.managementSignatoryIds.map(Number), expected.managementSignatoryIds)
    assert.equal(reportData.auditReport.fields.reportDate, expected.reportDate)
    assert.equal(reportData.auditReport.fields.reportPlace, expected.reportPlace)
    const narrative = fixture.disclosures.narrative[0]
    const savedNarrative = reportData.noteDisclosures.find(item => Number(item.note_num) === narrative.note_num)
    assert.equal(savedNarrative?.note_title, narrative.note_title,
      `${fixture.id} narrative disclosure remains attached to its selected note after restart`)
    assert.equal(savedNarrative?.text, narrative.text,
      `${fixture.id} supporting narrative disclosure persists after restart`)
    assert.equal(output.approval_date, expected.approvalDate)
    assert.equal(output.approval_place, expected.approvalPlace)
    assert.deepEqual(output.approval_signatory_ids.map(Number), expected.managementSignatoryIds)
    assert.ok((documentText => documentText.includes(caseState.reference))(
      await evaluate('document.body?.innerText || ""'),
    ), `${fixture.id} is opened through the visible navigation after restart`)

    const pageCount = (await PDFDocument.load(bytes)).getPageCount()
    assert.equal(pageCount, caseState.pdfPages, `${fixture.id} reopened PDF page count is unchanged`)
    caseResults.push({
      fixture: fixture.id,
      reference: caseState.reference,
      engagementId: Number(engagement.id),
      finalTBVersion: caseState.finalTBVersion,
      outputVersion: Number(output.version),
      pdfPath: caseState.pdfPath,
      pdfSha256: hash,
      pages: pageCount,
      reconciled: {
        assets: fixture.expected.current.assets,
        liabilitiesAndEquity: fixture.expected.current.liabilitiesAndEquity,
        profit: fixture.expected.current.profit,
        oci: fixture.expected.current.oci,
        comprehensiveIncome: fixture.expected.current.comprehensiveIncome,
      },
      selectionsAndDisclosurePersisted: true,
    })
    await clickButton('← Engagements')
    await waitFor(`text.includes('All Engagements')`, 'return to the visible firm engagement list')
  }
  return caseResults
}

async function createPhase() {
  await signInNormally()
  await returnToList()
  const userStatus = await appApi('engagementAuthStatus', null)
  assert.equal(userStatus.user?.firmName, 'FSG Isolated Demo Firm')
  assert.equal(userStatus.user?.role, 'administrator')
  const options = await appApi('listEngagementOptions', null)
  options.userId = Number(userStatus.user.id)
  const pack = options.packs.find(item => item.pack_id === 'AE_UAE_DEMO')
  assert.ok(pack && pack.processing_status === 'implemented', 'only the explicitly implemented UAE demonstration pack is selected')
  const partner = options.users.find(item => item.role === 'partner')
  assert.ok(partner, 'an existing isolated demo partner is assigned')
  const firmSettings = await appApi('getEngagementFirmSettings', null)
  const existingEngagements = await appApi('listEngagements', 'all')
  const cases = []
  const persistState = () => {
    fs.mkdirSync(outputDirectory, { recursive: true })
    fs.writeFileSync(statePath, JSON.stringify({
      createdAt: new Date().toISOString(),
      target: `${target.host}:${target.port}/${target.database}`,
      cases,
    }, null, 2))
  }
  for (const fixture of fixtures) {
    const caseState = await prepareCase(fixture, options, firmSettings, existingEngagements, pack, partner)
    if (!caseState.existing) await generateThroughVisibleUI(caseState)
    cases.push(caseState)
    persistState()
  }
  console.info(JSON.stringify({
    result: 'B/C synthetic UAE test-bed engagements saved through the isolated desktop workflow',
    target: `${target.host}:${target.port}/${target.database}`,
    cases: cases.map(item => ({
      fixture: item.fixtureId,
      reference: item.reference,
      engagementId: item.engagementId,
      finalTBVersion: item.finalTBVersion,
      outputVersion: item.outputVersion,
      pdfPath: item.pdfPath,
      pdfSha256: item.pdfSha256,
      pdfPages: item.pdfPages,
      reconciled: item.financials,
      existing: !!item.existing,
    })),
  }, null, 2))
}

async function reopenPhase() {
  if (!fs.existsSync(statePath)) throw new Error('Create and save the B/C test-bed engagements before restart verification.')
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  await signInNormally()
  await returnToList()
  const cases = await verifyAfterRestart(state)
  console.info(JSON.stringify({
    result: 'B/C saved engagements, selections, disclosures, reconciliations, and PDF bytes reopened successfully',
    target: `${target.host}:${target.port}/${target.database}`,
    cases,
  }, null, 2))
}

try {
  await command('Page.enable')
  await command('Runtime.enable')
  await (phase === 'create' ? createPhase() : reopenPhase())
} finally {
  socket.close()
}
