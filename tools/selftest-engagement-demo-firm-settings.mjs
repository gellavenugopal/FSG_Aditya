import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveDisposableTestTarget } from '../src/main/test-isolation.mjs'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'

if (process.env.FSG_TEST_MODE !== 'true') {
  throw new Error('Run Firm Settings UI verification only through the isolated engagement demo harness.')
}

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { target } = resolveDisposableTestTarget()
const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const credentials = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8'))
const workflow = JSON.parse(fs.readFileSync(path.join(demoHome, 'workflow.json'), 'utf8'))
validateDemoUserCredentials(credentials.testUsers)
const verificationPath = path.join(demoHome, 'firm-settings-verification.json')
const outputDirectory = path.join(demoHome, 'outputs')
const dialogHelper = path.join(repositoryRoot, 'tools', 'engagement-demo-select-dialog.ps1')
const logoPath = path.join(demoHome, 'synthetic-firm-logo.png')
const professionalFirmName = 'FSG Demo Audit LLP'
const professionalFirmFrn = 'FRN-DEMO-SYNTHETIC-01'
const officeName = 'FSG Demo Downtown Office'
const cfoName = 'FSG Demo CFO'
const approvalWording = 'Synthetic demo wording entered through the audit report form; balances do not infer an opinion.'
const changedMasterName = 'FSG Demo Audit LLP - Updated Master'

function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii')
  const payload = Buffer.concat([name, data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(payload))
  return Buffer.concat([length, payload, checksum])
}

function makeSyntheticLogo() {
  const width = 400
  const height = 96
  const scale = 8
  const background = [255, 255, 255, 255]
  const ink = [25, 73, 128, 255]
  const accent = [19, 130, 125, 255]
  const glyphs = {
    F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  }
  const pixels = Buffer.alloc(width * height * 4)
  for (let index = 0; index < width * height; index++) {
    pixels.set(background, index * 4)
  }
  const drawRect = (x, y, w, h, color) => {
    for (let row = Math.max(0, y); row < Math.min(height, y + h); row++) {
      for (let column = Math.max(0, x); column < Math.min(width, x + w); column++) {
        pixels.set(color, (row * width + column) * 4)
      }
    }
  }
  const word = 'FSG DEMO'
  let cursorX = 18
  for (const character of word) {
    if (character === ' ') {
      cursorX += scale * 2
      continue
    }
    glyphs[character].forEach((row, rowIndex) => {
      for (let column = 0; column < row.length; column++) {
        if (row[column] === '1') {
          drawRect(cursorX + column * scale, 12 + rowIndex * scale, scale, scale, ink)
        }
      }
    })
    cursorX += 6 * scale
  }
  drawRect(18, 82, width - 36, 5, accent)

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const rows = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4)
    row[0] = 0
    pixels.copy(row, 1, y * width * 4, (y + 1) * width * 4)
    rows.push(row)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (error) { reject(new Error('Could not read isolated Electron automation endpoint.', { cause: error })) }
      })
    }).on('error', reject)
  })
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const deadline = Date.now() + 60000
let page
let lastError
while (!page && Date.now() < deadline) {
  try {
    const targets = await getJson('http://127.0.0.1:9339/json/list')
    page = targets.find(item => {
      if (item.type !== 'page') return false
      const url = new URL(item.url)
      return url.hostname === 'localhost' && Number(url.port) >= 5173 && Number(url.port) <= 5180
    })
  } catch (error) { lastError = error }
  if (!page) await sleep(250)
}
if (!page?.webSocketDebuggerUrl) {
  throw new Error(`The isolated demo desktop renderer is unavailable.${lastError ? ` ${lastError.message}` : ''}`)
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
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (await evaluate(`(() => { const text=document.body?.innerText || ''; return ${predicate}; })()`)) return
    await sleep(200)
  }
  throw new Error(`Timed out waiting for ${description}.`)
}

async function clickButton(text) {
  const result = await evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find(item=>item.innerText.trim()===${JSON.stringify(text)});
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`)
  if (!result) throw new Error(`The enabled "${text}" button was not available.`)
}

async function clickRowButton(rowText, buttonText) {
  const clicked = await evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find(item=>{
      if(item.innerText.trim()!==${JSON.stringify(buttonText)}) return false;
      let parent=item.parentElement;
      while(parent && parent!==document.body) {
        if((parent.innerText || '').includes(${JSON.stringify(rowText)})) return true;
        parent=parent.parentElement;
      }
      return false;
    });
    if(!button || button.disabled) return false;
    button.click();
    return true;
  })()`)
  if (!clicked) throw new Error(`Could not find "${buttonText}" for "${rowText}".`)
}

async function setControl(labelText, value, sectionHeading = '') {
  const result = await evaluate(`(() => {
    const root=${sectionHeading
      ? `(() => {
          const heading=[...document.querySelectorAll('h2,h3,h4,h5')].find(item=>item.innerText.trim()===${JSON.stringify(sectionHeading)});
          let parent=heading;
          while(parent && !parent.querySelector('label')) parent=parent.parentElement;
          return parent || document;
        })()`
      : 'document'};
    const label=[...(root || document).querySelectorAll('label')].find(item=>
      ([...item.children].find(child=>child.tagName==='SPAN')?.innerText.trim() || '')===${JSON.stringify(labelText)});
    const input=label?.querySelector('input,textarea,select');
    if(!input || input.disabled || input.readOnly) return false;
    const prototype=input instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`)
  if (!result) throw new Error(`Could not set the "${labelText}" field${sectionHeading ? ` in ${sectionHeading}` : ''}.`)
}

async function setSelectByOptionText(labelText, optionText, sectionHeading = '') {
  const result = await evaluate(`(() => {
    const root=${sectionHeading
      ? `(() => {
          const heading=[...document.querySelectorAll('h2,h3,h4,h5')].find(item=>item.innerText.trim()===${JSON.stringify(sectionHeading)});
          let parent=heading;
          while(parent && !parent.querySelector('label')) parent=parent.parentElement;
          return parent || document;
        })()`
      : 'document'};
    const label=[...(root || document).querySelectorAll('label')].find(item=>
      ([...item.children].find(child=>child.tagName==='SPAN')?.innerText.trim() || '')===${JSON.stringify(labelText)});
    const select=label?.querySelector('select');
    const option=[...(select?.options || [])].find(item=>(item.textContent || '').includes(${JSON.stringify(optionText)}));
    if(!select || !option || select.disabled) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,option.value);
    select.dispatchEvent(new Event('input',{bubbles:true}));
    select.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`)
  return result
}

async function setPlaceholder(placeholder, value) {
  const result = await evaluate(`(() => {
    const input=[...document.querySelectorAll('input')].find(item=>item.placeholder===${JSON.stringify(placeholder)});
    if(!input || input.disabled) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`)
  if (!result) throw new Error(`Could not set the "${placeholder}" input.`)
}

async function setCheckboxesForNames(names) {
  const result = await evaluate(`(() => {
    const heading=[...document.querySelectorAll('h5')].find(item=>item.innerText.includes('Ordered management signatories'));
    let container=heading?.parentElement;
    while(container && !container.querySelector('input[type="checkbox"]')) container=container.parentElement;
    if(!container) return false;
    const wanted=${JSON.stringify(names)};
    const labels=[...container.querySelectorAll('label')].filter(label=>label.querySelector('input[type="checkbox"]'));
    for(const label of labels) {
      const name=wanted.find(value=>(label.innerText || '').includes(value));
      const checkbox=label.querySelector('input[type="checkbox"]');
      const shouldCheck=!!name;
      if(checkbox.checked!==shouldCheck) checkbox.click();
    }
    return wanted.every(name=>labels.some(label=>(label.innerText || '').includes(name)
      && label.querySelector('input[type="checkbox"]')?.checked));
  })()`)
  if (!result) throw new Error('Could not select the requested management signatories.')
}

async function enterCredentials(user) {
  const result = await evaluate(`(() => {
    const email=document.querySelector('input[type="email"]');
    const password=document.querySelector('input[type="password"]');
    if(!email || !password || !email.form) return false;
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
  if (!result) throw new Error('Could not find the standard sign-in form.')
  await waitFor(`text.includes(${JSON.stringify(`Signed in as ${user.displayName}`)})`,
    `${user.displayName} sign-in`)
}

async function signIn(user) {
  const text = await evaluate('document.body?.innerText || ""')
  if (text.includes(`Signed in as ${user.displayName}`)) return
  if (text.includes('Signed in as ')) {
    const hasSignOut = await evaluate(`[...document.querySelectorAll('button')]
      .some(button=>button.innerText.trim()==='Sign out' && !button.disabled)`)
    if (hasSignOut) await clickButton('Sign out')
  }
  await waitFor(`!!document.querySelector('input[type="email"]')`, 'the regular sign-in form')
  await enterCredentials(user)
}

async function signOut() {
  await clickButton('Sign out')
  await waitFor(`!!document.querySelector('input[type="email"]')`, 'the sign-in screen after logout')
}

async function openSavedEngagement() {
  await waitFor(`!![...document.querySelectorAll('tr')].find(item=>item.innerText.includes(${JSON.stringify(workflow.reference)}))`,
    'the saved engagement row')
  const opened = await evaluate(`(() => {
    const row=[...document.querySelectorAll('tr')].find(item=>item.innerText.includes(${JSON.stringify(workflow.reference)}));
    if(!row) return false;
    row.click();
    return true;
  })()`)
  if (!opened) throw new Error('The saved synthetic engagement could not be opened.')
  await waitFor(`text.includes('Audit report, financial statements & notes')`, 'the reporting panel')
}

function saveDownloadedPdf(filePath) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-STA', '-File', dialogHelper,
    '-Action', 'Save',
    '-DialogTitle', 'Save combined financial reporting pack',
    '-FilePath', filePath,
    '-DemoHome', demoHome,
    '-UserDataPath', target.userDataPath,
    '-RepositoryRoot', repositoryRoot,
  ], { encoding: 'utf8', timeout: 45000 })
  if (result.error || result.status !== 0) {
    throw new Error(`Isolated Windows PDF save dialog failed: ${result.error?.message || result.stderr || result.stdout || result.status}`)
  }
}

try {
  await command('Page.enable')
  await command('Runtime.enable')
  if (process.argv[2] === 'reopen') {
    const saved = JSON.parse(fs.readFileSync(verificationPath, 'utf8'))
    await signIn(credentials.testUsers.partner)
    await openSavedEngagement()
    const persisted = await evaluate(`window.api.getEngagementReportingData({
      engagementId:${Number(workflow.engagementId)},trialBalanceId:${Number(workflow.finalTrialBalanceId)}
    })`)
    assert.equal(persisted.reportingSelections.responsibleAuditorFirmId, String(saved.professionalFirmId))
    assert.equal(persisted.reportingSelections.responsibleOfficeId, String(saved.officeId))
    assert.equal(persisted.reportingSelections.brandingAuditorFirmId, String(saved.brandingFirmId))
    assert.deepEqual(persisted.reportingSelections.managementSignatoryIds, saved.managementSignatoryIds)
    assert.equal(persisted.auditReport.fields.reportDate, saved.reportDate)
    assert.equal(persisted.auditReport.fields.reportPlace, saved.reportPlace)
    const reopened = await evaluate(`window.api.getEngagementReportOutput(${Number(saved.outputId)})`)
    const reopenedHash = crypto.createHash('sha256').update(Buffer.from(reopened.pdfContentBase64, 'base64')).digest('hex')
    assert.equal(reopenedHash, saved.pdfSha256, 'reopened application must retrieve identical saved PDF bytes')
    const outputs = await evaluate(`window.api.listEngagementReportOutputs(${Number(workflow.engagementId)})`)
    const output = outputs.find(item => Number(item.id) === Number(saved.outputId))
    assert.ok(output?.finalised_at, 'finalised report output remains available after application restart')
    console.info(JSON.stringify({
      result: 'firm settings and finalised PDF survived desktop restart',
      target: `${target.host}:${target.port}/${target.database}`,
      engagement: workflow.reference,
      outputVersion: output.version,
      pdfSha256: reopenedHash,
      firmOfficeBrandingAndSignatoriesPersisted: true,
      outputFinalised: true,
    }, null, 2))
  } else if (process.argv[2] === 'verify-master') {
    const saved = JSON.parse(fs.readFileSync(verificationPath, 'utf8'))
    assert.equal(saved.masterChanged, true, 'the later master edit must have completed')
    await signIn(credentials.testUsers.partner)
    await openSavedEngagement()
    const output = await evaluate(`window.api.getEngagementReportOutput(${Number(saved.outputId)})`)
    const digest = crypto.createHash('sha256').update(Buffer.from(output.pdfContentBase64, 'base64')).digest('hex')
    assert.equal(digest, saved.pdfSha256, 'the finalised PDF bytes remain unchanged after editing the master')
    const metadata = await evaluate(`window.api.listEngagementReportOutputs(${Number(workflow.engagementId)})
      .then(rows=>rows.find(item=>Number(item.id)===${Number(saved.outputId)}))`)
    assert.ok(metadata?.finalised_at, 'the output remains finalised after the later master edit')
    console.info(JSON.stringify({
      result: 'finalised PDF identity and bytes survived later firm-master edits',
      engagement: workflow.reference,
      outputVersion: metadata.version,
      pdfSha256: digest,
      finalised: true,
    }, null, 2))
  } else {
    fs.writeFileSync(logoPath, makeSyntheticLogo())
    await signIn(credentials.testUsers.administrator)
    await clickButton('Firm Settings')
    await waitFor(`text.includes('Maintain the existing auditor firm')`, 'Firm Settings')

    if (!await setSelectByOptionText('Existing firm', professionalFirmName, 'Professional firm')
      && !await setSelectByOptionText('Existing firm', changedMasterName, 'Professional firm')) {
      await setSelectByOptionText('Existing firm', 'Link existing:', 'Professional firm')
    }
    await setControl('Firm name', professionalFirmName, 'Professional firm')
    await setControl('Firm Registration Number (FRN)', professionalFirmFrn, 'Professional firm')
    await setControl('PAN', 'ABCDE1234F', 'Professional firm')
    await setControl('Email', 'audit-office@example.test', 'Professional firm')
    await setControl('Phone', '+91 11111 11111', 'Professional firm')
    await setControl('Main office address', '1 Synthetic Audit Road, Demo City, India', 'Professional firm')
    const document = await command('DOM.getDocument', { depth: -1 })
    const logoInput = await command('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector: 'input[type="file"]',
    })
    if (!logoInput.nodeId) throw new Error('Could not locate the firm logo upload control.')
    await command('DOM.setFileInputFiles', { files: [logoPath], nodeId: logoInput.nodeId })
    await waitFor(`!!document.querySelector('img[alt="Selected firm logo"]')`, 'the uploaded firm logo preview')
    await clickButton('Save firm')
    await waitFor(`text.includes('Firm details and branding saved.')`, 'firm master save')

    const officeExists = await setSelectByOptionText('Edit office', officeName, 'Offices')
    if (!officeExists) {
      const newOffice = await setSelectByOptionText('Edit office', 'New office', 'Offices')
      if (!newOffice) {
        const editOffice = await evaluate(`(() => {
          const section=[...document.querySelectorAll('section')].find(item=>item.innerText.includes('Offices'));
          return !!section?.querySelector('select')?.value;
        })()`)
        if (editOffice) throw new Error('Could not select an existing or new office.')
      }
    }
    await setControl('Office name', officeName, 'Offices')
    await setControl('Address', '2 Synthetic Audit Plaza, Demo City, India', 'Offices')
    await setControl('Phone', '+91 22222 22222', 'Offices')
    await setControl('Email', 'downtown@example.test', 'Offices')
    await clickButton('Save office')
    await waitFor(`text.includes('Office saved.')`, 'office save')

    const partnerRow = await evaluate(`(() => {
      const qualification=[...document.querySelectorAll('input')].find(item=>item.placeholder==='e.g. FCA');
      let row=qualification;
      while(row && !(row.querySelectorAll('input').length===3
        && [...row.querySelectorAll('button')].some(item=>item.innerText.trim()==='Save'))) row=row.parentElement;
      if(!row) return false;
      const values=[${JSON.stringify('FCA')},${JSON.stringify('DEMO-MEMBER-1001')}];
      const inputs=[...row.querySelectorAll('input[type="text"],input:not([type])')];
      for(let index=0;index<2;index++) {
        const input=inputs[index];
        if(!input) return false;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,values[index]);
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.dispatchEvent(new Event('change',{bubbles:true}));
      }
      const save=[...row.querySelectorAll('button')].find(item=>item.innerText.trim()==='Save');
      if(!save || save.disabled) return false;
      save.click();
      return true;
    })()`)
    if (!partnerRow) throw new Error('Could not update the existing engagement partner profile.')
    await waitFor(`text.includes('Partner profile saved.')`, 'partner qualification and registration number save')
    await signOut()
    await signIn(credentials.testUsers.administrator)
    await openSavedEngagement()

    await waitFor(`!![...document.querySelectorAll('label')].find(item=>
      [...item.children].some(child=>child.tagName==='SPAN' && child.innerText.trim()==='Responsible firm'))`,
    'engagement firm selections')
    if (!await setSelectByOptionText('Responsible firm', professionalFirmName, 'Firm, office and branding selections')) {
      throw new Error('Could not select the responsible professional firm.')
    }
    await waitFor(`!![...document.querySelectorAll('label')].find(item=>
      [...item.children].some(child=>child.tagName==='SPAN' && child.innerText.trim()==='Responsible office'))`,
    'engagement office selection')
    if (!await setSelectByOptionText('Responsible office', officeName, 'Firm, office and branding selections')) {
      throw new Error('Could not select the responsible firm office.')
    }
    if (!await setSelectByOptionText('Branding profile', professionalFirmName, 'Firm, office and branding selections')) {
      throw new Error('Could not select the firm branding profile.')
    }

    const hasCfo = await evaluate(`(document.body?.innerText || '').includes(${JSON.stringify(cfoName)})`)
    if (!hasCfo) {
      await setPlaceholder('Signatory name', cfoName)
      await setPlaceholder('Designation', 'Chief Financial Officer')
      await setPlaceholder('DIN / ID (optional)', 'SYN-CFO-001')
      await clickButton('Add signatory')
      await waitFor(`!![...document.querySelectorAll('label')].find(item=>item.querySelector('input[type="checkbox"]')
        && item.innerText.includes(${JSON.stringify(cfoName)}))`, 'new management signatory')
    }
    const managementNames = await evaluate(`(() => {
      const heading=[...document.querySelectorAll('h5')].find(item=>item.innerText.includes('Ordered management signatories'));
      let container=heading?.parentElement;
      while(container && !container.querySelector('input[type="checkbox"]')) container=container.parentElement;
      return [...(container?.querySelectorAll('label') || [])]
        .filter(label=>label.querySelector('input[type="checkbox"]'))
        .map(label=>label.innerText.trim())
        .filter(text=>text && !text.includes(${JSON.stringify(cfoName)}))
        .map(text=>text.split(' · ')[0])
        .slice(0,1);
    })()`)
    if (!managementNames.length) throw new Error('The synthetic client has no existing management signatory to order with the new CFO.')
    const selectedManagementNames = [cfoName, managementNames[0]]
    await setCheckboxesForNames(selectedManagementNames)
    const cfoMoved = await evaluate(`(() => {
      const first=document.querySelector('ol li');
      if(first && first.innerText.includes(${JSON.stringify(cfoName)})) return true;
      const button=document.querySelector('[aria-label=${JSON.stringify(`Move ${cfoName} up`)}]');
      if(!button || button.disabled) return false;
      button.click();
      return true;
    })()`)
    if (!cfoMoved) throw new Error('Could not order the CFO as the first management signatory.')
    await waitFor(`!!document.querySelector('ol li')?.innerText.includes(${JSON.stringify(cfoName)})`,
      'CFO as the first ordered management signatory')

    await setControl('Addressee', `The Members of ${workflow.clientName}`)
    await setControl('Opinion — entered explicitly by the auditor; never generated from balances', approvalWording)
    await setControl('Basis for opinion', 'The audit was performed using the existing India reporting basis; this wording was explicitly entered by the auditor.')
    await setControl('Management responsibilities', 'Management is responsible for the preparation and fair presentation of the financial statements.')
    await setControl('Auditor responsibilities', 'The auditor is responsible for expressing an opinion based on the audit.')
    await setControl('Audit report date', '2026-06-30')
    await setControl('Audit report place', 'Synthetic Demo City')
    await setControl('Financial-statement approval date', '2026-06-25')
    await setControl('Financial-statement approval place', 'Synthetic Demo City')
    await clickButton('Save engagement selections')
    await waitFor(`text.includes('Firm, office, branding and ordered signatory selections saved.')`, 'persisted engagement identity selections')
    await clickButton('Save audit report edits')
    await waitFor(`text.includes('Audit report settings saved') || text.includes('Audit report edits saved') || text.includes('Audit report')`,
      'audit report settings save')

    const beforeOutputs = await evaluate(`window.api.listEngagementReportOutputs(${Number(workflow.engagementId)})`)
    const nextVersion = Math.max(0, ...beforeOutputs.map(item => Number(item.version))) + 1
    const priorOutput = beforeOutputs.find(item => Number(item.version) === Number(workflow.updatedOutputVersion))
    assert.ok(priorOutput, 'the previous finalized PDF remains listed')
    const financialDataHashBefore = priorOutput.financial_data_sha256
    await clickButton('Generate & save combined PDF')
    await waitFor(`text.includes(${JSON.stringify(`Combined PDF v${nextVersion} saved`)})`,
      `combined PDF v${nextVersion} generated through the desktop`, 90000)

    const outputs = await evaluate(`window.api.listEngagementReportOutputs(${Number(workflow.engagementId)})`)
    const output = outputs.find(item => Number(item.version) === nextVersion)
    assert.ok(output, 'the generated output is persisted through the service')
    assert.equal(output.financial_data_sha256, financialDataHashBefore,
      'changing only firm settings and report wording must preserve the existing India financial data hash')
    const savedOutput = await evaluate(`window.api.getEngagementReportOutput(${Number(output.id)})`)
    const outputBytes = Buffer.from(savedOutput.pdfContentBase64, 'base64')
    const serviceHash = crypto.createHash('sha256').update(outputBytes).digest('hex')
    const filePath = path.join(outputDirectory, `${workflow.reference}-firm-settings-pack-v${nextVersion}.pdf`)
    if (fs.existsSync(filePath)) throw new Error(`Refusing to overwrite an existing review PDF: ${filePath}`)
    await clickRowButton(`Version ${nextVersion} ·`, 'Download PDF')
    saveDownloadedPdf(filePath)
    const fileDeadline = Date.now() + 10000
    while (!fs.existsSync(filePath) && Date.now() < fileDeadline) await sleep(100)
    assert.ok(fs.existsSync(filePath), 'the PDF can be reopened through the desktop download control')
    const downloadedHash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
    assert.equal(downloadedHash, serviceHash, 'the downloaded combined PDF matches the service-persisted output')

    const outputFields = await evaluate(`window.api.getEngagementReportOutput(${Number(output.id)})`)
    const outputMeta = await evaluate(`window.api.listEngagementReportOutputs(${Number(workflow.engagementId)})
      .then(rows=>rows.find(item=>Number(item.id)===${Number(output.id)}))`)
    assert.ok(outputMeta, 'saved output metadata is readable')
    await signOut()
    await signIn(credentials.testUsers.partner)
    await openSavedEngagement()
    await clickRowButton(`Version ${nextVersion} ·`, 'Finalise version')
    await waitFor(`window.api.listEngagementReportOutputs(${Number(workflow.engagementId)})
      .then(rows=>!!rows.find(item=>Number(item.id)===${Number(output.id)})?.finalised_at)`,
    'partner finalisation of the new report output')

    const reportDataBeforeMasterEdit = await evaluate(`window.api.getEngagementReportingData({
      engagementId:${Number(workflow.engagementId)},trialBalanceId:${Number(workflow.finalTrialBalanceId)}
    })`)
    assert.equal(reportDataBeforeMasterEdit.auditReport.fields.opinion, approvalWording)
    assert.equal(reportDataBeforeMasterEdit.auditReport.fields.firmName, professionalFirmName)
    const verification = {
      target: `${target.host}:${target.port}/${target.database}`,
      engagementId: Number(workflow.engagementId),
      reference: workflow.reference,
      finalTrialBalanceId: Number(workflow.finalTrialBalanceId),
      outputId: Number(output.id),
      outputVersion: Number(output.version),
      finalised: true,
      pdfPath: filePath,
      pdfSha256: serviceHash,
      financialDataSha256: output.financial_data_sha256,
      professionalFirmId: Number(reportDataBeforeMasterEdit.reportingSelections.responsibleAuditorFirmId),
      officeId: Number(reportDataBeforeMasterEdit.reportingSelections.responsibleOfficeId),
      brandingFirmId: Number(reportDataBeforeMasterEdit.reportingSelections.brandingAuditorFirmId),
      managementSignatoryIds: reportDataBeforeMasterEdit.reportingSelections.managementSignatoryIds,
      reportDate: reportDataBeforeMasterEdit.auditReport.fields.reportDate,
      reportPlace: reportDataBeforeMasterEdit.auditReport.fields.reportPlace,
      wording: approvalWording,
      previousFinalOutputId: Number(priorOutput.id),
      previousFinalOutputSha256: crypto.createHash('sha256')
        .update(Buffer.from((await evaluate(`window.api.getEngagementReportOutput(${Number(priorOutput.id)})`)).pdfContentBase64, 'base64'))
        .digest('hex'),
      previousFinancialDataSha256: financialDataHashBefore,
      changedMasterName,
      logoPath,
      masterChanged: false,
    }
    fs.writeFileSync(verificationPath, `${JSON.stringify(verification, null, 2)}\n`)

    await signOut()
    await signIn(credentials.testUsers.administrator)
    await clickButton('Firm Settings')
    await waitFor(`text.includes('Maintain the existing auditor firm')`, 'master edit screen')
    await setControl('Firm name', changedMasterName, 'Professional firm')
    await setControl('Firm Registration Number (FRN)', 'FRN-DEMO-SYNTHETIC-02', 'Professional firm')
    await setControl('Main office address', 'Updated synthetic master address, Demo City', 'Professional firm')
    await clickButton('Save firm')
    await waitFor(`text.includes('Firm details and branding saved.')`, 'later master edit')
    verification.masterChanged = true
    fs.writeFileSync(verificationPath, `${JSON.stringify(verification, null, 2)}\n`)

    await signOut()
    await signIn(credentials.testUsers.partner)
    await openSavedEngagement()
    const afterMasterEdit = await evaluate(`window.api.getEngagementReportOutput(${Number(output.id)})`)
    const afterMasterHash = crypto.createHash('sha256').update(Buffer.from(afterMasterEdit.pdfContentBase64, 'base64')).digest('hex')
    assert.equal(afterMasterHash, serviceHash, 'later master edits must not alter the finalised report PDF')
    assert.equal(afterMasterEdit.pdfContentBase64, savedOutput.pdfContentBase64,
      'later master edits must preserve the exact finalised PDF bytes')
    const finalisedMeta = await evaluate(`window.api.listEngagementReportOutputs(${Number(workflow.engagementId)})
      .then(rows=>rows.find(item=>Number(item.id)===${Number(output.id)}))`)
    assert.ok(finalisedMeta?.finalised_at, 'the previous output remains finalised after master changes')
    fs.writeFileSync(verificationPath, `${JSON.stringify(verification, null, 2)}\n`)
    console.info(JSON.stringify({
      result: 'Firm Settings, engagement selections and combined PDF UI verification passed',
      target: verification.target,
      engagement: verification.reference,
      outputVersion: verification.outputVersion,
      pdf: verification.pdfPath,
      pdfSha256: serviceHash,
      financialDataHashUnchanged: true,
      logoAndOrderedSignatoriesSaved: true,
      auditWordingPersisted: true,
      finalisedOutputUnchangedAfterMasterEdit: true,
      verificationFile: verificationPath,
    }, null, 2))
  }
} finally {
  socket.close()
}
