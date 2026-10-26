import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveDisposableTestTarget } from '../src/main/test-isolation.mjs'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'

if (process.env.FSG_TEST_MODE !== 'true') {
  throw new Error('Run the saved-engagement workflow only through the isolated engagement demo harness.')
}

async function setAriaControl(label, value) {
  const result = await evaluate(`(() => {
    const control=document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)});
    if (!control) return false;
    const prototype=control instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(control,${JSON.stringify(String(value))});
    control.dispatchEvent(new Event('input',{bubbles:true}));
    control.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`)
  if (!result) throw new Error(`Could not find the "${label}" control.`)
}

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { target } = resolveDisposableTestTarget()
const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const credentialsPath = path.join(demoHome, 'credentials.json')
const statePath = path.join(demoHome, 'workflow.json')
const dialogHelper = path.join(repositoryRoot, 'tools', 'engagement-demo-select-dialog.ps1')
const currentWorkbook = path.join(demoHome, 'FSG-Demo-Current-2025-26.xlsx')
const priorWorkbook = path.join(demoHome, 'FSG-Demo-Prior-2024-25.xlsx')
const outputDirectory = path.join(demoHome, 'outputs')
const reference = 'FSG-DEMO-2025-26'
const engagementName = 'Synthetic statutory audit 2025-26'
const clientName = 'FSG Demo Carverse Private Limited'
const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))
validateDemoUserCredentials(credentials.testUsers)
for (const file of [currentWorkbook, priorWorkbook]) {
  if (!fs.statSync(file).isFile()) throw new Error(`Synthetic Trial Balance workbook is missing: ${path.basename(file)}`)
}
fs.mkdirSync(outputDirectory, { recursive: true })

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (error) { reject(new Error('Could not read the local Electron automation endpoint.', { cause: error })) }
      })
    }).on('error', reject)
  })
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const targets = await getJson('http://127.0.0.1:9339/json/list')
const page = targets.find(item => {
  if (item.type !== 'page') return false
  const url = new URL(item.url)
  return url.hostname === 'localhost' && Number(url.port) >= 5173 && Number(url.port) <= 5180
})
if (!page?.webSocketDebuggerUrl) {
  throw new Error('Start the isolated desktop with .\\tools\\engagement-demo.ps1 launch before running this workflow.')
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
  const response = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
  }
  return response.result?.value
}

async function waitFor(predicate, description, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await evaluate(`(() => { const text=document.body?.innerText || ''; return ${predicate}; })()`)
    if (result) return
    await sleep(200)
  }
  throw new Error(`Timed out waiting for ${description}.`)
}

async function clickButton(text, occurrence = 0) {
  const result = await evaluate(`(() => {
    const buttons=[...document.querySelectorAll('button')].filter(button=>button.innerText.trim()===${JSON.stringify(text)});
    const button=buttons[${occurrence}];
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`)
  if (!result) throw new Error(`The enabled "${text}" button was not available.`)
}

async function setLabeledControl(labelText, value, { contains = false } = {}) {
  const result = await evaluate(`(() => {
    const label=[...document.querySelectorAll('label')].find(item=>{
      const title=[...item.children].find(child=>child.tagName==='SPAN')?.innerText.trim() || '';
      return ${contains ? `title.toLowerCase().includes(${JSON.stringify(labelText.toLowerCase())})` : `title===${JSON.stringify(labelText)}`};
    });
    const control=label?.querySelector('input,textarea,select');
    if (!control) return false;
    const prototype=control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(prototype,'value').set;
    setter.call(control,${JSON.stringify(String(value))});
    control.dispatchEvent(new Event('input',{bubbles:true}));
    control.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`)
  if (!result) throw new Error(`Could not find the "${labelText}" field.`)
}

async function setPlaceholder(placeholder, value) {
  const result = await evaluate(`(() => {
    const control=[...document.querySelectorAll('input,textarea')].find(item=>item.placeholder===${JSON.stringify(placeholder)});
    if (!control) return false;
    const setter=Object.getOwnPropertyDescriptor(control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set;
    setter.call(control,${JSON.stringify(String(value))});
    control.dispatchEvent(new Event('input',{bubbles:true}));
    control.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`)
  if (!result) throw new Error(`Could not find the "${placeholder}" field.`)
}

async function setSelectByText(labelText, optionText) {
  await waitFor(`(() => {
    const label=[...document.querySelectorAll('label')].find(item=>
      ([...item.children].find(child=>child.tagName==='SPAN')?.innerText.trim() || '')===${JSON.stringify(labelText)});
    return [...(label?.querySelector('select')?.options || [])]
      .some(item=>item.textContent.includes(${JSON.stringify(optionText)}));
  })()`, `"${optionText}" in "${labelText}"`)
  const result = await evaluate(`(() => {
    const label=[...document.querySelectorAll('label')].find(item=>
      ([...item.children].find(child=>child.tagName==='SPAN')?.innerText.trim() || '')===${JSON.stringify(labelText)});
    const select=label?.querySelector('select');
    const option=[...(select?.options || [])].find(item=>item.textContent.includes(${JSON.stringify(optionText)}));
    if (!select || !option) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,option.value);
    select.dispatchEvent(new Event('input',{bubbles:true}));
    select.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`)
  if (!result) throw new Error(`Could not select "${optionText}" for "${labelText}".`)
}

async function setCheckbox(labelText, checked, { contains = false } = {}) {
  const result = await evaluate(`(() => {
    const label=[...document.querySelectorAll('label')].find(item=>{
      const text=(item.innerText || item.textContent || '').replace(/\\s+/g,' ').trim();
      return !!item.querySelector('input[type="checkbox"]')
        && (${contains ? `text.toLowerCase().includes(${JSON.stringify(labelText.toLowerCase())})` : `text===${JSON.stringify(labelText)}`});
    });
    const input=label?.querySelector('input[type="checkbox"]');
    if (!input) return false;
    if (input.checked!==${checked}) input.click();
    return input.checked===${checked};
  })()`)
  if (!result) throw new Error(`Could not set the "${labelText}" checkbox.`)
}

async function clickTextRowButton(rowText, buttonText) {
  const result = await evaluate(`(() => {
    const row=[...document.querySelectorAll('div')].filter(item=>
      item.innerText?.includes(${JSON.stringify(rowText)}) &&
      [...item.querySelectorAll('button')].some(button=>button.innerText.trim()===${JSON.stringify(buttonText)}))
      .sort((left,right)=>left.innerText.length-right.innerText.length)[0];
    const button=[...(row?.querySelectorAll('button') || [])].find(item=>item.innerText.trim()===${JSON.stringify(buttonText)});
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`)
  if (!result) throw new Error(`Could not find "${buttonText}" in "${rowText}".`)
}

async function signIn(user) {
  let current = await evaluate('document.body?.innerText || ""')
  if (!current.includes('Signed in as ')) {
    await command('Page.reload', { ignoreCache: true })
    await waitFor(`text.includes('Signed in as ') || !!document.querySelector('input[type="email"]')`, 'the sign-in state')
    current = await evaluate('document.body?.innerText || ""')
  }
  if (current.includes(`Signed in as ${user.displayName}`)) return
  if (current.includes('Signed in as ')) {
    await clickButton('Sign out')
  }
  await waitFor(`!!document.querySelector('input[type="email"]')`, 'the normal firm sign-in form')
  const result = await evaluate(`(() => {
    const email=document.querySelector('input[type="email"]');
    const password=document.querySelector('input[type="password"]');
    if (!email || !password || !email.form) return false;
    const set=(input,value)=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    };
    set(email,${JSON.stringify(user.email)});
    set(password,${JSON.stringify(user.password)});
    email.form.requestSubmit();
    return true;
  })()`)
  if (!result) throw new Error('Could not submit credentials through the regular sign-in form.')
  await waitFor(`text.includes(${JSON.stringify(`Signed in as ${user.displayName}`)})`, `${user.displayName} sign-in`)
}

function selectFile(action, dialogTitle, filePath) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-STA', '-File', dialogHelper,
    '-Action', action,
    '-DialogTitle', dialogTitle,
    '-FilePath', filePath,
    '-DemoHome', demoHome,
    '-UserDataPath', target.userDataPath,
    '-RepositoryRoot', repositoryRoot,
  ], { encoding: 'utf8', timeout: 45000 })
  if (result.error || result.status !== 0) {
    throw new Error(`Isolated Windows file-dialog automation failed: ${result.error?.message || result.stderr || result.stdout || result.status}`)
  }
}

async function importWorkbook(buttonText, dialogTitle, workbook, sourceFilename) {
  const sources = await evaluate(`window.api.listEngagementTrialBalances(${state.engagementId})`)
  let alreadyImported = sources.some(item => (item.source_filename || item.filename) === sourceFilename)
  if (!alreadyImported && sourceFilename === state.priorFilename && state.finalTrialBalanceId) {
    const reportData = await evaluate(`window.api.getEngagementReportingData({
      engagementId:${state.engagementId},trialBalanceId:${state.finalTrialBalanceId}
    })`)
    alreadyImported = reportData.comparativeTrialBalances.some(item => item.filename === sourceFilename)
  }
  if (alreadyImported) return
  await clickButton(buttonText)
  selectFile('Open', dialogTitle, workbook)
  await waitFor(`text.includes(${JSON.stringify(sourceFilename)})`, `${sourceFilename} import`)
  const alert = await evaluate(`document.querySelector('[role="alert"]')?.textContent || ''`)
  if (alert) throw new Error(`The UI reported an import error: ${alert}`)
}

async function applyExpenseMappingCorrection() {
  const reportData = await evaluate(`window.api.getEngagementReportingData({
    engagementId:${state.engagementId},trialBalanceId:${state.finalTrialBalanceId}
  })`)
  const rows = await evaluate(`window.api.getEngagementFinalTrialBalanceRows({
    engagementId:${state.engagementId},trialBalanceId:${state.finalTrialBalanceId}
  })`)
  const row = rows.find(item => item.name === 'Operating Expenses')
  if (!row) throw new Error('The final Trial Balance has no Operating Expenses row to correct.')
  if (row.status === 'user_override' && row.override_note) {
    return {
      ledger: row.name,
      from: 'Automatic mapping',
      to: [row.alie, row.mapping1_resultant, row.mapping2_resultant, row.mapping3_resultant].filter(Boolean).join(' · '),
      levelFormatId: Number(row.level_format_id || row.lf_id),
    }
  }
  const currentId = Number(row.level_format_id || row.lf_id)
  const current = reportData.levelFormat.find(item => Number(item.id) === currentId) || {
    alie: row.alie,
    level1: row.level1,
    level2: row.level2,
    level3: row.level3,
  }
  const pathFor = item => [item.alie, item.level1, item.level2, item.level3].filter(Boolean).join(' · ')
  const currentPath = pathFor(current)
  const sameSide = reportData.levelFormat.filter(item => item.alie === current.alie
    && Number(item.id) !== currentId && pathFor(item) !== currentPath)
  const target = sameSide.find(item => /other expenses|administrative expenses/i.test(pathFor(item)))
    || sameSide.find(item => item.level1 === current.level1 && item.level2 !== current.level2)
    || sameSide[0]
  if (!target) throw new Error('No alternate mapping exists on the same statement side for a safe manual correction.')
  const controlName = `Correct mapping for ${row.name}`
  const selected = await evaluate(`(() => {
    const select=document.querySelector(${JSON.stringify(`select[aria-label="${controlName}"]`)});
    if (!select || ![...select.options].some(option=>option.value===${JSON.stringify(String(target.id))})) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(String(target.id))});
    select.dispatchEvent(new Event('input',{bubbles:true}));
    select.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`)
  if (!selected) throw new Error('Could not select the Operating Expenses mapping correction through the UI.')
  await waitFor(`(() => {
    const select=document.querySelector(${JSON.stringify(`select[aria-label="${controlName}"]`)});
    const button=select?.closest('tr')?.querySelector('button');
    return select?.value===${JSON.stringify(String(target.id))} && !!button && !button.disabled;
  })()`, 'the manual mapping save action')
  const saved = await evaluate(`(() => {
    const select=document.querySelector(${JSON.stringify(`select[aria-label="${controlName}"]`)});
    const button=select?.closest('tr')?.querySelector('button');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`)
  if (!saved) throw new Error('Could not save the Operating Expenses mapping correction through the UI.')
  await waitFor(`text.includes(${JSON.stringify(`Mapping correction saved for ${row.name}`)})`, 'the manual mapping correction')
  const refreshedRows = await evaluate(`window.api.getEngagementFinalTrialBalanceRows({
    engagementId:${state.engagementId},trialBalanceId:${state.finalTrialBalanceId}
  })`)
  const corrected = refreshedRows.find(item => item.id === row.id)
  if (Number(corrected?.level_format_id || corrected?.lf_id) !== Number(target.id)) {
    throw new Error('The saved manual mapping correction was not returned by the service.')
  }
  return { ledger: row.name, from: pathFor(current), to: pathFor(target), levelFormatId: Number(target.id) }
}

async function fillReportInputs({ changed = false } = {}) {
  const value = changed ? 'We have audited the accompanying financial statements and report that they present fairly, in all material respects, the company’s financial position.' :
    'We have audited the accompanying financial statements of the company.'
  await setLabeledControl('Addressee', 'The Members of FSG Demo Carverse Private Limited')
  await setLabeledControl('Opinion — entered explicitly by the auditor; never generated from balances', value)
  await setLabeledControl('Basis for opinion', 'We conducted our audit in accordance with the applicable auditing standards in India.')
  await setLabeledControl('Management responsibilities', 'Management is responsible for the preparation of these financial statements.')
  await setLabeledControl('Auditor responsibilities', 'Our responsibility is to express an opinion based on our audit.')
  await setLabeledControl('Other matters (optional)', changed
    ? 'The company maintains documented controls over revenue recognition.'
    : 'This report is prepared for the members of the company.')
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
}

async function completeReportInputs({ changed = false } = {}) {
  const reportData = await evaluate(`window.api.getEngagementReportingData({
    engagementId:${state.engagementId},trialBalanceId:${state.finalTrialBalanceId}
  })`)
  if (!reportData.signatories?.length) {
    await setPlaceholder('Signatory name', 'Anaya Mehta')
    await setPlaceholder('Designation', 'Director')
    await setPlaceholder('DIN / ID (optional)', 'DEMO-DIN-0001')
    await clickButton('Add signatory')
    await waitFor(`text.includes('Anaya Mehta')`, 'the new client signatory')
  }
  await setCheckbox('Anaya Mehta', true, { contains: true })
  await setLabeledControl('Addressee', 'The Members of FSG Demo Carverse Private Limited')
  await fillReportInputs({ changed })
  const opened = await evaluate(`(() => {
    const summary=[...document.querySelectorAll('summary')].find(item=>item.innerText.includes('Notes to accounts'));
    if (!summary) return false;
    if (!summary.parentElement.open) summary.click();
    return true;
  })()`)
  if (!opened) throw new Error('The notes-to-accounts disclosure section was not available.')
  const disclosureLabel = await evaluate(`(() => [...document.querySelectorAll('label')].map(label=>
    [...label.children].find(child=>child.tagName==='SPAN')?.innerText.trim() || ''
  ).find(text=>/^Note \\d+:.*share capital/i.test(text)) || '')()`)
  if (!disclosureLabel) throw new Error('No mapped share-capital note was available for the structured disclosure.')
  await setLabeledControl(disclosureLabel, 'Share capital comprises 10,000 equity shares of INR 10 each.')
  await evaluate(`(() => {
    const summary=[...document.querySelectorAll('summary')].find(item=>item.innerText.includes('Structured share-capital details'));
    if (!summary) return false;
    if (!summary.parentElement.open) summary.click();
    return true;
  })()`).then(found => {
    if (!found) throw new Error('Structured share-capital details were not available.')
  })
  await setLabeledControl('Share class', 'Equity Shares')
  await setLabeledControl('Face value per share', '10')
  for (const period of ['Current year', 'Prior year']) {
    await setLabeledControl(`Authorised shares · ${period}`, '10000')
    await setLabeledControl(`Issued shares · ${period}`, '10000')
    await setLabeledControl(`Subscribed shares · ${period}`, '10000')
    await setLabeledControl(`Paid-up shares · ${period}`, '10000')
    await setLabeledControl(`Opening shares · ${period}`, '10000')
    await setLabeledControl(`Issued during year · ${period}`, '0')
    await setLabeledControl(`Shares cancelled during year · ${period}`, '0')
  }
  await clickButton('Save structured details')
  await waitFor(`text.includes('Structured details for')`, 'structured share-capital details to save')
  await setCheckbox('Anaya Mehta', true, { contains: true })
  await clickButton('Save audit report edits')
  const expectedOpinion = changed
    ? 'We have audited the accompanying financial statements and report that they present fairly, in all material respects, the company’s financial position.'
    : 'We have audited the accompanying financial statements of the company.'
  await waitFor(`window.api.getEngagementReportingData({
    engagementId:${state.engagementId},trialBalanceId:${state.finalTrialBalanceId}
  }).then(data=>data.auditReport?.fields?.opinion===${JSON.stringify(expectedOpinion)})`, 'audit report settings to save')
  const narrative = changed
    ? 'Share capital comprises 10,000 fully paid equity shares of INR 10 each.'
    : 'Share capital comprises 10,000 equity shares of INR 10 each.'
  await setLabeledControl(disclosureLabel, narrative)
  const saved = await evaluate(`(() => {
    const label=[...document.querySelectorAll('label')].find(item=>
      ([...item.children].find(child=>child.tagName==='SPAN')?.innerText.trim() || '')===${JSON.stringify(disclosureLabel)});
    const section=label?.parentElement;
    const button=[...(section?.querySelectorAll('button') || [])].find(item=>item.innerText.trim()==='Save note text');
    if (!button) return false;
    button.click();
    return true;
  })()`)
  if (!saved) throw new Error('Could not save the share-capital narrative disclosure through the UI.')
  await waitFor(`text.includes('Note ') && text.includes('disclosure saved')`, 'the note disclosure to save')
}

const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {}
state.reference = reference
state.engagementName = engagementName
state.clientName = clientName
state.currentFilename = path.basename(currentWorkbook)
state.priorFilename = path.basename(priorWorkbook)
state.outputs = {
  first: path.join(outputDirectory, 'FSG-Demo-Carverse-Reporting-Pack-v1.pdf'),
  updated: path.join(outputDirectory, 'FSG-Demo-Carverse-Reporting-Pack-v3.pdf'),
  reopened: path.join(outputDirectory, 'FSG-Demo-Carverse-Reporting-Pack-reopened.pdf'),
}

try {
  await command('Page.enable')
  await command('Runtime.enable')
  await signIn(credentials.testUsers.administrator)
  if (await evaluate(`!![...document.querySelectorAll('button')].find(item=>item.innerText.trim()==='← Engagements')`)) {
    await clickButton('← Engagements')
    await waitFor(`!![...document.querySelectorAll('button')].find(item=>item.innerText.trim()==='+ Create engagement')`, 'the engagement list')
  }

  const existing = await evaluate(`window.api.listEngagements('all')`)
  const currentEngagement = existing.find(item => item.reference === reference)
  if (!currentEngagement) {
    const options = await evaluate('window.api.listEngagementOptions()')
    await clickButton('+ Create engagement')
    await waitFor(`text.includes('Create engagement')`, 'the engagement setup form')
    let entity = options.entities.find(item => item.name === clientName)
    if (!entity) {
      await clickButton('+ Create client')
      await setLabeledControl('Legal client name', clientName)
      await setLabeledControl('Jurisdiction code', 'IN')
      await setSelectByText('Legal form', 'Company')
      await clickButton('Save client')
      await waitFor(`!![...document.querySelectorAll('select')].find(item=>item.closest('label')?.innerText.includes('Client entity'))?.value`, 'the new client to be selected')
    } else {
      await setSelectByText('Client entity', entity.name)
    }
    await setLabeledControl('Engagement name', engagementName)
    await setLabeledControl('Reference', reference)
    await setLabeledControl('Reporting period start', '2025-04-01')
    await setLabeledControl('Reporting period end', '2026-03-31')
    await setCheckbox('Statutory audit', true, { contains: true })
    await clickButton('Continue')
    await setSelectByText('Reporting pack', 'India legacy Schedule III')
    await setLabeledControl('Trial balance currency', 'INR')
    await setLabeledControl('Presentation currency', 'INR')
    await setCheckbox('I have confirmed the reporting basis', true, { contains: true })
    await clickButton('Continue')
    await setSelectByText('Assigned engagement partner', 'Demo Engagement Partner')
    await setCheckbox('Demo Contributor', true, { contains: true })
    await setCheckbox('Demo Reader', true, { contains: true })
    const participantAccess = await evaluate(`(() => {
      const select=[...document.querySelectorAll('select')].find(item=>
        item.parentElement?.querySelector('label')?.innerText.includes('Demo Contributor')
        && [...item.options].some(option=>option.value==='edit'));
      if (!select) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'edit');
      select.dispatchEvent(new Event('input',{bubbles:true}));
      select.dispatchEvent(new Event('change',{bubbles:true}));
      return select.value==='edit';
    })()`)
    if (!participantAccess) throw new Error('Could not assign edit access to the synthetic contributor.')
    await clickButton('Continue')
    await waitFor(`text.toLowerCase().includes('owner / partner')`, 'engagement review')
    await waitFor(`!![...document.querySelectorAll('button')].find(item=>item.innerText.trim()==='Create & activate' && !item.disabled)`, 'eligible activation')
    await clickButton('Create & activate')
    await waitFor(`text.includes(${JSON.stringify(clientName)}) && text.includes('India reporting pack')`, 'the saved engagement reporting panel')
  } else {
    const opened = await evaluate(`(() => {
      const row=[...document.querySelectorAll('tr')].find(item=>item.innerText.includes(${JSON.stringify(reference)}));
      if (!row) return false;
      row.click();
      return true;
    })()`)
    if (!opened) throw new Error(`The saved sample engagement ${reference} is not visible in the engagement list.`)
    await waitFor(`text.includes(${JSON.stringify(clientName)}) && text.includes('India reporting pack')`, 'the saved engagement reporting panel')
  }

  const engagements = await evaluate(`window.api.listEngagements('all')`)
  const engagement = engagements.find(item => item.reference === reference)
  if (!engagement) throw new Error('The newly created engagement was not returned by the service.')
  state.engagementId = Number(engagement.id)
  const overview = await evaluate(`window.api.getEngagementOverview(${state.engagementId})`)
  if (overview.engagement.status !== 'active') throw new Error('The sample engagement was not activated through the UI.')

  await importWorkbook('+ Import Excel', 'Import Trial Balance', currentWorkbook, state.currentFilename)
  let sources = await evaluate(`window.api.listEngagementTrialBalances(${state.engagementId})`)
  const source = sources.find(item => (item.source_filename || item.filename) === state.currentFilename)
  if (!source) throw new Error('The imported current-year Trial Balance was not linked to the engagement.')
  state.sourceTrialBalanceId = Number(source.id)

  const journals = await evaluate(`window.api.listEngagementJournals(${state.engagementId})`)
  if (!journals.some(item => item.narration === 'Demo adjustment: year-end depreciation')) {
    await setLabeledControl('Journal date', '2026-03-31')
    await setLabeledControl('Narration', 'Demo adjustment: year-end depreciation')
    await setAriaControl('Line 1 ledger', 'Depreciation Expense')
    await setAriaControl('Line 1 code', '5200')
    await setAriaControl('Line 1 side', 'Dr')
    await setAriaControl('Line 1 amount', '2000')
    await setAriaControl('Line 2 ledger', 'Accumulated Depreciation - Office Equipment')
    await setAriaControl('Line 2 code', '1590')
    await setAriaControl('Line 2 side', 'Cr')
    await setAriaControl('Line 2 amount', '2000')
    await clickButton('Post journal')
    await waitFor(`text.includes('The imported Trial Balance remains unchanged.')`, 'the balanced first journal')
  }

  let snapshots = await evaluate(`window.api.listEngagementFinalTrialBalances(${state.engagementId})`)
  if (!snapshots.length) {
    await clickButton('Create & map final TB')
    await waitFor(`text.includes('Final Trial Balance v1 created and mapped')`, 'the initial final Trial Balance')
    snapshots = await evaluate(`window.api.listEngagementFinalTrialBalances(${state.engagementId})`)
  }
  state.finalTrialBalanceId = Number(snapshots[snapshots.length - 1].id)

  await importWorkbook('Import prior-year Trial Balance', 'Import Prior-year Trial Balance', priorWorkbook, state.priorFilename)
  await waitFor(`text.includes('Comparative Trial Balance')`, 'the comparative Trial Balance selector')
  await waitFor(`!![...document.querySelectorAll('button')].find(item=>item.innerText.trim()==='Save comparative selection' && !item.disabled)`, 'the comparative selection save action')
  await clickButton('Save comparative selection')
  await waitFor(`text.includes('Comparatives use prior-year closing balances')`, 'the saved prior-year comparative selection')

  const firstMapping = await applyExpenseMappingCorrection()
  await completeReportInputs()
  const outputRows = await evaluate(`window.api.listEngagementReportOutputs(${state.engagementId})`)
  if (!outputRows.length) {
    await clickButton('Generate & save combined PDF')
    await waitFor(`text.includes('Combined PDF v1 saved')`, 'the first combined PDF to persist through the engagement service', 60000)
  }
  const firstOutputs = await evaluate(`window.api.listEngagementReportOutputs(${state.engagementId})`)
  state.firstOutputId = Number(firstOutputs[0].id)
  state.firstOutputVersion = Number(firstOutputs[0].version)
  if (!fs.existsSync(state.outputs.first)) {
    await clickTextRowButton('Version 1 ·', 'Download PDF')
    selectFile('Save', 'Save combined financial reporting pack', state.outputs.first)
  }

  const secondNarration = 'Demo adjustment: additional operating expense'
  const existingJournals = await evaluate(`window.api.listEngagementJournals(${state.engagementId})`)
  if (!existingJournals.some(item => item.narration === secondNarration)) {
    await setLabeledControl('Journal date', '2026-03-31')
    await setLabeledControl('Narration', secondNarration)
    await setAriaControl('Line 1 ledger', 'Operating Expenses')
    await setAriaControl('Line 1 code', '5100')
    await setAriaControl('Line 1 side', 'Dr')
    await setAriaControl('Line 1 amount', '500')
    await setAriaControl('Line 2 ledger', 'Main Bank Account')
    await setAriaControl('Line 2 code', '1100')
    await setAriaControl('Line 2 side', 'Cr')
    await setAriaControl('Line 2 amount', '500')
    await clickButton('Post journal')
    await waitFor(`text.includes('The imported Trial Balance remains unchanged.')`, 'the second balanced journal')
  }
  snapshots = await evaluate(`window.api.listEngagementFinalTrialBalances(${state.engagementId})`)
  const journalsAfterPost = await evaluate(`window.api.listEngagementJournals(${state.engagementId})`)
  const latestJournalId = Math.max(...journalsAfterPost.map(item => Number(item.id)))
  if (!snapshots.some(item => Number(item.journal_watermark || item.journalWatermark) >= latestJournalId)) {
    const nextFinalVersion = Math.max(...snapshots.map(item => Number(item.version))) + 1
    await clickButton('Create & map final TB')
    await waitFor(`text.includes(${JSON.stringify(`Final Trial Balance v${nextFinalVersion} created and mapped`)})`, 'the updated final Trial Balance')
    snapshots = await evaluate(`window.api.listEngagementFinalTrialBalances(${state.engagementId})`)
  }
  state.finalTrialBalanceId = Number(snapshots[0].id)
  await waitFor(`text.includes('Comparatives use prior-year closing balances')`, 'comparatives on the updated final Trial Balance')
  const updatedMapping = await applyExpenseMappingCorrection()
  await completeReportInputs({ changed: true })
  const outputRowsBeforeUpdate = await evaluate(`window.api.listEngagementReportOutputs(${state.engagementId})`)
  const updatedOutputExists = fs.existsSync(state.outputs.updated)
  const updatedVersion = updatedOutputExists
    ? Number(outputRowsBeforeUpdate[0].version)
    : Math.max(...outputRowsBeforeUpdate.map(item => Number(item.version))) + 1
  if (!updatedOutputExists) {
    await clickButton('Generate & save combined PDF')
    await waitFor(`text.includes(${JSON.stringify(`Combined PDF v${updatedVersion} saved`)})`, 'the revised combined PDF to persist through the engagement service', 60000)
  }
  const outputRowsAfterUpdate = await evaluate(`window.api.listEngagementReportOutputs(${state.engagementId})`)
  state.updatedOutputId = Number(outputRowsAfterUpdate.find(item => Number(item.version) === updatedVersion)?.id)
  state.updatedOutputVersion = updatedVersion
  if (!state.updatedOutputId) throw new Error(`The service did not retain revised PDF version ${updatedVersion}.`)
  if (!fs.existsSync(state.outputs.updated)) {
    await clickTextRowButton(`Version ${updatedVersion} ·`, 'Download PDF')
    selectFile('Save', 'Save combined financial reporting pack', state.outputs.updated)
  }

  const finalRows = await evaluate(`window.api.getEngagementFinalTrialBalanceRows({
    engagementId:${state.engagementId},trialBalanceId:${state.finalTrialBalanceId}
  })`)
  const finalBalance = finalRows.reduce((sum, row) => sum + Number(row.closing_balance || 0), 0)
  const reportingData = await evaluate(`window.api.getEngagementReportingData({
    engagementId:${state.engagementId},trialBalanceId:${state.finalTrialBalanceId}
  })`)
  const sourcesAfter = await evaluate(`window.api.listEngagementTrialBalances(${state.engagementId})`)
  const journalsAfter = await evaluate(`window.api.listEngagementJournals(${state.engagementId})`)
  const importedSourceCount = sourcesAfter.length + (reportingData.comparativeTrialBalances || []).length
  if (Math.abs(finalBalance) > 0.01) throw new Error(`The final Trial Balance does not reconcile: ${finalBalance}.`)
  if (!reportingData.comparativeTrialBalance
    || reportingData.comparativeTrialBalance.dateFrom !== '2024-04-01'
    || reportingData.comparativeTrialBalance.dateTill !== '2025-03-31') {
    throw new Error('The selected comparative is not the 2024-25 prior-year Trial Balance.')
  }
  if (importedSourceCount < 2 || journalsAfter.length < 2) {
    throw new Error('The saved engagement does not retain both imports and both journal adjustments.')
  }
  state.finalBalance = finalBalance
  state.sourceCount = importedSourceCount
  state.journalCount = journalsAfter.length
  state.priorPeriod = reportingData.comparativeTrialBalance.period
  state.firstMapping = firstMapping
  state.updatedMapping = updatedMapping
  state.noteTitles = (reportingData.noteDetails || []).map(item => item.note_title)
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { flag: fs.existsSync(statePath) ? 'w' : 'wx' })

  console.info(JSON.stringify({
    result: 'saved engagement reporting workflow generated service-persisted PDFs through the desktop UI',
    target: `${target.host}:${target.port}/${target.database}`,
    reference: state.reference,
    engagementId: state.engagementId,
    sources: state.sourceCount,
    journals: state.journalCount,
    finalTrialBalanceBalance: finalBalance,
    comparativePeriod: state.priorPeriod,
    mappings: [firstMapping, updatedMapping],
    outputVersions: outputRowsAfterUpdate.map(item => Number(item.version)),
    pdfs: [state.outputs.first, state.outputs.updated],
    credentialsPrinted: false,
  }, null, 2))
} finally {
  socket.close()
}
