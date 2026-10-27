import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { resolveDisposableTestTarget } from '../src/main/test-isolation.mjs'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'

if (process.env.FSG_TEST_MODE !== 'true') {
  throw new Error('Run this authentication UI check only against the existing isolated desktop harness.')
}

const phase = process.argv[2]
if (!['fresh', 'resume'].includes(phase)) throw new Error('Select the "fresh" or "resume" phase.')
const { target } = resolveDisposableTestTarget()
const localServiceIdentity = JSON.parse(fs.readFileSync(path.join(target.userDataPath, 'engagement-service-identity.json'), 'utf8'))
const rememberPrefix = `remember-${createHash('sha256').update(`local-profile:${localServiceIdentity.id}`, 'utf8').digest('hex')}-`
const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const credentials = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8'))
validateDemoUserCredentials(credentials.testUsers)
const administrator = credentials.testUsers.administrator
const identity = `Signed in as ${administrator.displayName} · FSG Isolated Demo Firm`
const debugUrl = 'http://127.0.0.1:9339'

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (error) { reject(new Error('Could not read the isolated desktop automation endpoint.', { cause: error })) }
      })
    }).on('error', reject)
  })
}

const deadline = Date.now() + 30000
let page
while (!page && Date.now() < deadline) {
  const targets = await getJson(`${debugUrl}/json/list`)
  page = targets.find(item => {
    if (item.type !== 'page') return false
    const url = new URL(item.url)
    return url.hostname === 'localhost' && Number(url.port) >= 5173 && Number(url.port) <= 5180
  })
  if (!page) await new Promise(resolve => setTimeout(resolve, 250))
}
assert.ok(page?.webSocketDebuggerUrl, 'the isolated desktop was launched separately')

const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let commandId = 0
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

async function evaluate(expression) {
  const result = await new Promise((resolve, reject) => {
    const id = ++commandId
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Timed out waiting for the desktop UI.'))
    }, 30000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true, userGesture: true },
    }))
  })
  if (result.exceptionDetails) throw new Error(result.result?.description || result.exceptionDetails.text)
  return result.result?.value
}

async function waitFor(expression, description, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await evaluate(expression)) return
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  const visible = await evaluate('(document.body?.innerText || "").slice(0, 1200)')
  throw new Error(`Timed out waiting for ${description}. Visible text: ${visible}`)
}

async function clickButton(label) {
  const clicked = await evaluate(`(() => {
    const button=[...document.querySelectorAll('button')].find(item=>item.innerText.trim()===${JSON.stringify(label)});
    if(!button || button.disabled)return false;
    button.click();return true;
  })()`)
  assert.ok(clicked, `visible "${label}" button is available`)
}

async function submitLogin(email, password, remember) {
  const submitted = await evaluate(`(() => {
    const email=document.querySelector('input[type="email"]');
    const passwordInput=document.querySelector('input[type="password"]');
    if(!email || !passwordInput || !email.form)return false;
    const set=(input,value)=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    };
    set(email,${JSON.stringify(email)});
    set(passwordInput,${JSON.stringify(password)});
    const checkbox=[...document.querySelectorAll('input[type="checkbox"]')].find(item=>item.parentElement.innerText.includes('Keep me signed in'));
    if(checkbox && checkbox.checked!==${JSON.stringify(remember)})checkbox.click();
    email.form.requestSubmit();
    return true;
  })()`)
  assert.ok(submitted, 'the visible sign-in form accepted the test input')
}

async function quitDesktop() {
  await evaluate('(setTimeout(()=>window.api.quitApp(),50),true)')
}

async function waitForDesktopStop() {
  const end = Date.now() + 20000
  while (Date.now() < end) {
    try { await getJson(`${debugUrl}/json/version`) } catch { return }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('The isolated desktop did not close after the quit request.')
}

if (phase === 'fresh') {
  let body = await evaluate('document.body?.innerText || ""')
  if (body.includes('Signed in as ')) {
    await clickButton('Sign out')
    await waitFor('!!document.querySelector(\'input[type="email"]\')', 'the ordinary sign-in screen')
  }
  await waitFor('!!document.querySelector(\'input[type="email"]\')', 'the ordinary sign-in screen')

  await submitLogin(administrator.email, 'Incorrect-Synthetic-Password!', false)
  await waitFor('(document.body?.innerText || "").includes("Email or password is incorrect.")', 'incorrect-password rejection')
  assert.ok(!(await evaluate('(document.body?.innerText || "").includes("Signed in as ")')),
    'a wrong password does not authenticate')
  await clickButton('Forgot password?')
  await waitFor('(document.body?.innerText || "").includes("single-use reset credential") && !!document.querySelector(\'input[autocomplete="off"]\')',
    'the guarded administrator-issued reset screen')
  await clickButton('Back to sign in')
  await waitFor('!!document.querySelector(\'input[type="email"]\')', 'return to normal sign-in')

  await submitLogin(administrator.email, administrator.password, true)
  await waitFor(`(document.body?.innerText || '').includes(${JSON.stringify(identity)})`, 'normal authenticated desktop access')
  const authDirectory = path.join(target.userDataPath, 'engagement-auth')
  const rememberedFiles = fs.existsSync(authDirectory)
    ? fs.readdirSync(authDirectory).filter(name => name.startsWith(rememberPrefix) && name.endsWith('.bin'))
    : []
  assert.equal(rememberedFiles.length, 1, 'Keep me signed in saved one protected token under the isolated Windows profile')
  const encryptedToken = fs.readFileSync(path.join(authDirectory, rememberedFiles[0]))
  assert.ok(encryptedToken.length > 32 && !encryptedToken.toString('utf8').includes(administrator.email),
    'the remembered credential is stored as encrypted bytes rather than readable account data')
  console.info('Fresh UI phase passed: normal login, incorrect-password rejection and protected remembered-token storage.')
} else {
  await waitFor(`(document.body?.innerText || '').includes(${JSON.stringify(identity)})`, 'remembered sign-in after application restart')
  await clickButton('Sign out')
  await waitFor('!!document.querySelector(\'input[type="email"]\')', 'the signed-out login form')
  const prefilledEmail = await evaluate('document.querySelector(\'input[type="email"]\')?.value || ""')
  assert.equal(prefilledEmail.toLowerCase(), administrator.email.toLowerCase(), 'username remains prefilled after restart and logout')
  const authDirectory = path.join(target.userDataPath, 'engagement-auth')
  const rememberedFiles = fs.existsSync(authDirectory)
    ? fs.readdirSync(authDirectory).filter(name => name.startsWith(rememberPrefix) && name.endsWith('.bin'))
    : []
  assert.equal(rememberedFiles.length, 0, 'logout removed the local remembered credential')
  console.info('Restart UI phase passed: remembered sign-in resumed and logout removed the stored credential.')
}

await quitDesktop()
await waitForDesktopStop()
socket.close()
