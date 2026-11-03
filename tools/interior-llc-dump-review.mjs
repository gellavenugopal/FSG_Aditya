// Read-only: dumps Interior's mapping review rows and provisional preview to the isolated demo outputs folder.
//   $env:FSG_TEST_TARGET_FILE = "$env:USERPROFILE\FSG-Aditya-engagement-demo\target.json"; node tools/interior-llc-dump-review.mjs
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { buildStatementPreview } from '../src/shared/uae-pack-statement-preview.mjs'

const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
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
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const administrator = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8')).testUsers.administrator
if (!(await appApi('engagementAuthStatus', null))?.user) {
  for (let attempt = 0; attempt < 50 && !(await evaluate(`!!document.querySelector('input[type="email"]')`)); attempt++) await sleep(200)
  await evaluate(`(() => {
    const email=document.querySelector('input[type="email"]'), password=document.querySelector('input[type="password"]');
    const set=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))};
    set(email,${JSON.stringify(administrator.email)});set(password,${JSON.stringify(administrator.password)});email.form.requestSubmit()})()`)
  for (let attempt = 0; attempt < 100 && !(await appApi('engagementAuthStatus', null))?.user; attempt++) await sleep(200)
}
const interior = (await appApi('listEngagements', 'all')).find(item => item.reference === 'INTERIOR-LLC-2024')
const snapshots = await appApi('listEngagementFinalTrialBalances', interior.id)
const latest = [...snapshots].sort((a, b) => Number(b.version) - Number(a.version))[0]
const review = await appApi('getEngagementPackMappingReview', { engagementId: interior.id, trialBalanceId: Number(latest.id) })
const preview = buildStatementPreview(review)
const out = path.join(demoHome, 'outputs', 'Interior-LLC')
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'review-dump.json'), JSON.stringify({ interior, latest, review, totals: preview.totals, tbNet: preview.tbNet }, null, 1))
console.log(JSON.stringify({ interior, totals: preview.totals, tbNet: preview.tbNet, rows: review.rows.length, keys: Object.keys(review.rows[0]) }, null, 1))
socket.close()
