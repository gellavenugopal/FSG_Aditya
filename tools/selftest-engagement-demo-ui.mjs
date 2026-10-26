import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { resolveDisposableTestTarget } from '../src/main/test-isolation.mjs'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'

if (process.env.FSG_TEST_MODE !== 'true') {
  throw new Error('Run UI authentication checks only through the isolated engagement demo harness.')
}
const { target } = resolveDisposableTestTarget()
const credentialsFile = path.join(path.dirname(process.env.FSG_TEST_TARGET_FILE), 'credentials.json')
const credentials = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'))
validateDemoUserCredentials(credentials.testUsers)

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch (error) {
          reject(new Error('Could not read the local Electron automation endpoint.', { cause: error }))
        }
      })
    }).on('error', reject)
  })
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
let page
let lastTargetError
const pageDeadline = Date.now() + 60000
while (!page && Date.now() < pageDeadline) {
  try {
    const browser = await getJson('http://127.0.0.1:9339/json/list')
    page = browser.find(item => {
      if (item.type !== 'page') return false
      const url = new URL(item.url)
      return url.hostname === 'localhost' && Number(url.port) >= 5173 && Number(url.port) <= 5180
    })
  } catch (error) {
    lastTargetError = error
  }
  if (!page) await sleep(250)
}
if (!page?.webSocketDebuggerUrl) {
  throw new Error(`The isolated demo renderer did not become available within 60 seconds.${lastTargetError ? ` ${lastTargetError.message}` : ''}`)
}

const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 0
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
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Electron automation command timed out: ${method}`))
    }, 10000)
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

async function waitForPage(predicate, message, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await evaluate(`(() => { const text=document.body?.innerText || ''; return ${predicate}; })()`)
    if (state) return
    await sleep(250)
  }
  throw new Error(message)
}

async function enterCredentials(user, password) {
  const result = await evaluate(`(() => {
    const email=document.querySelector('input[type="email"]');
    const pass=document.querySelector('input[type="password"]');
    const form=email?.form;
    if (!email || !pass || !form) return false;
    const set=(input,value)=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    };
    set(email,${JSON.stringify(user.email)});
    set(pass,${JSON.stringify(password)});
    form.requestSubmit();
    return true;
  })()`)
  if (!result) throw new Error('Could not find the regular sign-in form.')
}

async function assertSignedIn(displayName) {
  await waitForPage(
    `text.includes(${JSON.stringify(`Signed in as ${displayName}`)}) && !!document.querySelector('button')`,
    `The normal sign-in flow did not reach the ${displayName} workspace.`
  )
}

async function signOut() {
  await evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find(item=>item.innerText.trim()==='Sign out');
    if (!button) return false;
    button.click();
    return true;
  })()`).then(result => {
    if (!result) throw new Error('The normal sign-out control was not available.')
  })
  await waitForPage(`!!document.querySelector('input[type="email"]')`, 'Sign-out did not return to the sign-in form.')
}

try {
  await command('Page.enable')
  await command('Runtime.enable')
  await command('Page.reload', { ignoreCache: true })
  await waitForPage(`!!document.querySelector('input[type="email"]')`, 'The sign-in form did not appear after app reload.')

  const administrator = credentials.testUsers.administrator
  await enterCredentials(administrator, randomBytes(32).toString('base64url'))
  await waitForPage(
    `(() => { const alert=document.querySelector('[role="alert"]'); return !!alert && (alert.textContent || '').includes('Email or password is incorrect.'); })()`,
    'The login screen did not show its standard incorrect-password error.'
  )

  await enterCredentials(administrator, administrator.password)
  await assertSignedIn(administrator.displayName)
  await signOut()

  const signedInRoles = []
  for (const key of ['contributor', 'reader', 'partner']) {
    const user = credentials.testUsers[key]
    await enterCredentials(user, user.password)
    await assertSignedIn(user.displayName)
    signedInRoles.push(key)
    await signOut()
  }

  console.info(JSON.stringify({
    result: 'normal Electron sign-in UI passed',
    target: `${target.host}:${target.port}/${target.database}`,
    incorrectPasswordRejected: true,
    administratorSignedInAndOut: true,
    contributorSignedInAndOut: signedInRoles.includes('contributor'),
    readerSignedInAndOut: signedInRoles.includes('reader'),
    partnerSignedInAndOut: signedInRoles.includes('partner'),
    passwordsPrinted: false,
  }))
} finally {
  socket.close()
}
