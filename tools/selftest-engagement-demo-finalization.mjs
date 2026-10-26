import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { resolveDisposableTestTarget } from '../src/main/test-isolation.mjs'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'

if (process.env.FSG_TEST_MODE !== 'true') {
  throw new Error('Run finalisation verification only through the isolated engagement demo harness.')
}

const { target } = resolveDisposableTestTarget()
const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const credentials = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8'))
const statePath = path.join(demoHome, 'workflow.json')
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
validateDemoUserCredentials(credentials.testUsers)
const partner = credentials.testUsers.partner

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

const targets = await getJson('http://127.0.0.1:9339/json/list')
const page = targets.find(item => {
  if (item.type !== 'page') return false
  const url = new URL(item.url)
  return url.hostname === 'localhost' && Number(url.port) >= 5173 && Number(url.port) <= 5180
})
if (!page?.webSocketDebuggerUrl) throw new Error('Start the isolated desktop before finalisation verification.')

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

async function clickRowButton(rowText, buttonText) {
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

async function setField(labelText, value) {
  const set = await evaluate(`(() => {
    const label=[...document.querySelectorAll('label')].find(item=>
      ([...item.children].find(child=>child.tagName==='SPAN')?.innerText.trim() || '')===${JSON.stringify(labelText)});
    const control=label?.querySelector('input,textarea,select');
    if (!control) return false;
    const prototype=control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(control,${JSON.stringify(value)});
    control.dispatchEvent(new Event('input',{bubbles:true}));
    control.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`)
  if (!set) throw new Error(`Could not set the "${labelText}" field.`)
}

async function signIn(user) {
  let body = await evaluate('document.body?.innerText || ""')
  if (!body.includes(`Signed in as ${user.displayName}`)) {
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
      set(email,${JSON.stringify(user.email)});
      set(password,${JSON.stringify(user.password)});
      email.form.requestSubmit();
      return true;
    })()`)
    if (!submitted) throw new Error('Could not submit partner credentials through the normal sign-in screen.')
    await waitFor(`text.includes(${JSON.stringify(`Signed in as ${user.displayName}`)})`, `${user.displayName} sign-in`)
  }
}

try {
  await command('Page.enable')
  await command('Runtime.enable')
  await signIn(partner)
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
  if (!opened) throw new Error('The saved engagement was not available to the partner.')
  await waitFor(`text.includes('Status & workflow')`, 'the partner engagement overview')

  const outputs = await evaluate(`window.api.listEngagementReportOutputs(${state.engagementId})`)
  const output = outputs.find(item => Number(item.version) === Number(state.updatedOutputVersion))
  if (!output) throw new Error('The updated combined PDF version is not available in the engagement.')
  if (!output.finalised_at) {
    await waitFor(`!![...document.querySelectorAll('button')].find(item=>
      item.innerText.trim()==='Finalise version' && item.parentElement?.innerText.includes(${JSON.stringify(`Version ${state.updatedOutputVersion} ·`)}))`,
    'the current output version finalisation control')
    await clickRowButton(`Version ${state.updatedOutputVersion} ·`, 'Finalise version')
    await waitFor(`window.api.listEngagementReportOutputs(${state.engagementId})
      .then(rows=>!!rows.find(item=>Number(item.id)===${Number(output.id)})?.finalised_at)`,
    'the partner-finalised PDF version')
  }

  const overview = await evaluate(`window.api.getEngagementOverview(${state.engagementId})`)
  if (overview.engagement.status === 'active') {
    await setField('Signing place', 'Mumbai')
    await setField('Signing date', '2026-06-30')
    await clickButton('Finalise')
    await waitFor(`window.api.getEngagementOverview(${state.engagementId})
      .then(data=>data.engagement.status==='finalised')`, 'engagement finalisation')
  } else if (overview.engagement.status !== 'finalised') {
    throw new Error(`The engagement has unexpected status ${overview.engagement.status}.`)
  }

  await signIn(credentials.testUsers.administrator)
  const editRejection = await evaluate(`window.api.postEngagementJournal({
    engagementId:${state.engagementId},
    sourceTrialBalanceId:${Number(state.sourceTrialBalanceId)},
    date:'2026-03-31',
    narration:'Must be rejected after finalisation',
    entries:[]
  }).then(()=>({rejected:false})).catch(error=>({rejected:true,message:error.message}))`)
  if (!editRejection.rejected || !/edit access is required|locked or finalised/i.test(editRejection.message)) {
    throw new Error(`Finalisation did not prevent a journal change: ${editRejection.message || 'operation succeeded'}.`)
  }

  await signIn(partner)
  if (await evaluate(`!![...document.querySelectorAll('button')].find(item=>item.innerText.trim()==='← Engagements')`)) {
    await clickButton('← Engagements')
  }
  await waitFor(`!![...document.querySelectorAll('tr')].find(item=>item.innerText.includes(${JSON.stringify(state.reference)}))`, 'the finalised engagement row')
  const reopenedPage = await evaluate(`(() => {
    const row=[...document.querySelectorAll('tr')].find(item=>item.innerText.includes(${JSON.stringify(state.reference)}));
    if (!row) return false;
    row.click();
    return true;
  })()`)
  if (!reopenedPage) throw new Error('The partner could not reopen the finalised engagement overview.')
  await waitFor(`text.includes('Status & workflow')`, 'the finalised engagement overview')
  await clickButton('Reopen engagement')
  await waitFor(`window.api.getEngagementOverview(${state.engagementId})
    .then(data=>data.engagement.status==='active')`, 'authorised reopening')
  const reopenedOutputs = await evaluate(`window.api.listEngagementReportOutputs(${state.engagementId})`)
  const retained = reopenedOutputs.find(item => Number(item.id) === Number(output.id))
  if (!retained?.finalised_at) throw new Error('Reopening did not retain the previous final PDF version.')
  const storedOutput = await evaluate(`window.api.getEngagementReportOutput(${Number(output.id)})`)
  const pdfHash = crypto.createHash('sha256')
    .update(Buffer.from(storedOutput.pdfContentBase64, 'base64'))
    .digest('hex')
  const localHash = crypto.createHash('sha256').update(fs.readFileSync(state.outputs.updated)).digest('hex')
  if (pdfHash !== localHash) throw new Error('The saved PDF differs from the service-persisted final output.')

  state.finalisation = {
    outputId: Number(output.id),
    outputVersion: Number(output.version),
    outputFinalised: true,
    engagementFinalised: true,
    journalEditRejected: true,
    engagementReopened: true,
    previousOutputRetained: true,
    pdfSha256: pdfHash,
  }
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
  console.info(JSON.stringify({
    result: 'partner finalisation, edit rejection and reopening passed in the isolated desktop UI',
    target: `${target.host}:${target.port}/${target.database}`,
    reference: state.reference,
    outputVersion: state.finalisation.outputVersion,
    journalEditRejected: true,
    previousOutputRetained: true,
    pdfSha256: pdfHash,
  }, null, 2))
} finally {
  socket.close()
}
