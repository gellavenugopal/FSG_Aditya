import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveDisposableTestTarget } from '../src/main/test-isolation.mjs'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'

if (process.env.FSG_TEST_MODE !== 'true') {
  throw new Error('Run saved-PDF restart verification only through the isolated engagement demo harness.')
}

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const { target } = resolveDisposableTestTarget()
const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const credentials = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8'))
const statePath = path.join(demoHome, 'workflow.json')
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const helperPath = path.join(repositoryRoot, 'tools', 'engagement-demo-select-dialog.ps1')
const partner = credentials.testUsers.partner
validateDemoUserCredentials(credentials.testUsers)
state.outputs.reopened = path.join(
  demoHome,
  'outputs',
  `${state.reference}-reporting-pack-v${state.updatedOutputVersion}-reopened.pdf`,
)

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
let lastTargetError
const pageDeadline = Date.now() + 60000
while (!page && Date.now() < pageDeadline) {
  try {
    const targets = await getJson('http://127.0.0.1:9339/json/list')
    page = targets.find(item => {
      if (item.type !== 'page') return false
      const url = new URL(item.url)
      return url.hostname === 'localhost' && Number(url.port) >= 5173 && Number(url.port) <= 5180
    })
  } catch (error) {
    lastTargetError = error
  }
  if (!page) await new Promise(resolve => setTimeout(resolve, 250))
}
if (!page?.webSocketDebuggerUrl) {
  throw new Error(`The restarted isolated desktop renderer did not become available within 60 seconds.${lastTargetError ? ` ${lastTargetError.message}` : ''}`)
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
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`)
  if (!clicked) throw new Error(`The enabled "${text}" button was not available.`)
}

async function clickOutputButton(rowText, buttonText) {
  const clicked = await evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find(item=>{
      if (item.innerText.trim()!==${JSON.stringify(buttonText)}) return false;
      let parent=item.parentElement;
      while (parent && parent!==document.body) {
        if ((parent.innerText || '').includes(${JSON.stringify(rowText)})) return true;
        parent=parent.parentElement;
      }
      return false;
    });
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`)
  if (!clicked) throw new Error(`Could not find "${buttonText}" for "${rowText}".`)
}

async function signIn() {
  const body = await evaluate('document.body?.innerText || ""')
  if (body.includes(`Signed in as ${partner.displayName}`)) return
  if (body.includes('Signed in as ')) await clickButton('Sign out')
  await waitFor(`!!document.querySelector('input[type="email"]')`, 'the normal sign-in form')
  const submitted = await evaluate(`(() => {
    const email=document.querySelector('input[type="email"]');
    const password=document.querySelector('input[type="password"]');
    if (!email || !password || !email.form) return false;
    const set=(input,value)=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    };
    set(email,${JSON.stringify(partner.email)});
    set(password,${JSON.stringify(partner.password)});
    email.form.requestSubmit();
    return true;
  })()`)
  if (!submitted) throw new Error('Could not submit partner credentials through the normal sign-in screen.')
  await waitFor(`text.includes(${JSON.stringify(`Signed in as ${partner.displayName}`)})`, 'partner sign-in')
}

function saveDownloadedPdf() {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-STA', '-File', helperPath,
    '-Action', 'Save',
    '-DialogTitle', 'Save combined financial reporting pack',
    '-FilePath', state.outputs.reopened,
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
  await signIn()
  if (await evaluate(`!![...document.querySelectorAll('button')].find(item=>item.innerText.trim()==='← Engagements')`)) {
    await clickButton('← Engagements')
  }
  await waitFor(`!![...document.querySelectorAll('tr')].find(item=>item.innerText.includes(${JSON.stringify(state.reference)}))`, 'the saved engagement row')
  const opened = await evaluate(`(() => {
    const row=[...document.querySelectorAll('tr')].find(item=>item.innerText.includes(${JSON.stringify(state.reference)}));
    if (!row) return false;
    row.click();
    return true;
  })()`)
  if (!opened) throw new Error('The reopened engagement was not visible after restart.')
  await waitFor(`text.includes('Saved combined PDF versions')`, 'persisted combined PDF versions')

  const outputs = await evaluate(`window.api.listEngagementReportOutputs(${state.engagementId})`)
  const output = outputs.find(item => Number(item.version) === Number(state.updatedOutputVersion))
  if (!output?.finalised_at) throw new Error('The finalised PDF version did not persist across the application/service restart.')
  const storedOutput = await evaluate(`window.api.getEngagementReportOutput(${Number(output.id)})`)
  const pdfBuffer = Buffer.from(storedOutput.pdfContentBase64, 'base64')
  if (pdfBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('The reopened service output is not a PDF.')
  const serviceHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex')
  if (!fs.existsSync(state.outputs.reopened)) {
    await clickOutputButton(`Version ${state.updatedOutputVersion} ·`, 'Download PDF')
    saveDownloadedPdf()
    const deadline = Date.now() + 10000
    while (Date.now() < deadline
      && (!fs.existsSync(state.outputs.reopened) || fs.statSync(state.outputs.reopened).size !== pdfBuffer.length)) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  if (!fs.existsSync(state.outputs.reopened)) throw new Error('The restarted desktop did not save the downloaded PDF.')
  if (fs.statSync(state.outputs.reopened).size !== pdfBuffer.length) {
    throw new Error('The restarted desktop PDF download did not finish writing the full persisted output.')
  }
  const localHash = crypto.createHash('sha256').update(fs.readFileSync(state.outputs.reopened)).digest('hex')
  if (localHash !== serviceHash || serviceHash !== state.finalisation.pdfSha256) {
    throw new Error('The downloaded PDF after restart differs from the previously finalised service output.')
  }

  state.restartVerification = {
    sameTarget: `${target.host}:${target.port}/${target.database}`,
    engagementReopened: true,
    outputVersion: Number(output.version),
    outputAvailable: true,
    downloadedPdfSha256: localHash,
  }
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
  console.info(JSON.stringify({
    result: 'same isolated engagement and final PDF reopened after desktop and service restart',
    target: state.restartVerification.sameTarget,
    reference: state.reference,
    outputVersion: state.restartVerification.outputVersion,
    pdf: state.outputs.reopened,
    pdfSha256: localHash,
  }, null, 2))
  socket.send(JSON.stringify({
    id: ++nextCommandId,
    method: 'Runtime.evaluate',
    params: { expression: 'window.api.quitApp()', awaitPromise: false, returnByValue: true },
  }))
  await new Promise(resolve => setTimeout(resolve, 1000))
} finally {
  socket.close()
}
