// Populates the supported Kreston Menon DEMO masters in the isolated UAT desktop through the same preload API
// that Firm Settings uses (authenticated service operations). Usage:
//   $env:FSG_TEST_TARGET_FILE = "$env:USERPROFILE\FSG-Aditya-engagement-demo\target.json"
//   node tools/populate-kreston-demo-masters.mjs inspect | apply | verify
// Requires the isolated desktop (.\tools\engagement-demo.ps1 demo) on DevTools port 9339. Never targets the normal profile.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { validateDemoUserCredentials } from './engagement-demo-auth-config.mjs'

const phase = process.argv[2]
assert.ok(['inspect', 'apply', 'verify'].includes(phase), 'phase must be inspect, apply or verify')
assert.ok(process.env.FSG_TEST_TARGET_FILE, 'FSG_TEST_TARGET_FILE must point at the isolated demo target.json')
const demoHome = path.dirname(process.env.FSG_TEST_TARGET_FILE)
const credentials = JSON.parse(fs.readFileSync(path.join(demoHome, 'credentials.json'), 'utf8'))
validateDemoUserCredentials(credentials.testUsers)
const administrator = credentials.testUsers.administrator
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const SITE = 'https://www.krestonmenon.com/'
const STYLE_NAME = 'Kreston Menon Demo - proposed presentation'
const FIRM = {
  firmName: 'Kreston Menon',
  address: 'Level 15, Lake Central, Marasi Drive, Business Bay, Dubai, UAE. PO Box 55535',
  email: 'info@krestonmenon.com',
  phone: '+971 4 276 2233',
  websiteUrl: SITE,
  sourceUrls: [SITE, `${SITE}contact-us/`, `${SITE}contact-us/dubai/`, `${SITE}about/team/`],
}
const CHECKED = '2026-11-03T00:00:00+05:30'
const OFFICES = [
  ['Dubai', 'dubai', 'Level 15, Lake Central, Marasi Drive, Business Bay, Dubai, UAE. PO Box 55535', '+971 4 276 2233', 'dubai@krestonmenon.com'],
  ['Abu Dhabi', 'abu-dhabi', 'Office 705, Abu Dhabi Plaza Tower, Hamdan Street, Abu Dhabi, UAE. PO Box 31616', '+971 2 677 2727', 'abudhabi@krestonmenon.com'],
  ['Sharjah', 'sharjah', 'Office 403, Tower 400, Al Soor, Sharjah, UAE. PO Box 5199', '+971 6 575 8899', 'sharjah@krestonmenon.com'],
  ['JAFZA', 'jafza', 'Offices 1214\u20131215, floor 12, JAFZA One A, Jebel Ali Free Zone, Dubai, UAE. PO Box 61136', '+971 4 887 1727', 'jebelali@krestonmenon.com'],
].map(([officeName, slug, address, phone, email]) => ({ officeName, address, phone, email, sourceUrl: `${SITE}contact-us/${slug}/`, sourceRetrievedAt: CHECKED }))
const STYLE = {
  fontFamily: 'Tahoma', fontFallback: 'Arial, sans-serif', bodyFontSize: 11, headingFontSize: 14, headingWeight: 700,
  logoPlacement: 'top-left', logoWidthMm: 45, headerText: '', footerText: '',
  tableHeaderColor: '#243746', tableHeaderTextColor: '#ffffff', tableStripeColor: '#f3f4f6',
  pageSize: 'A4', pageOrientation: 'portrait', pageMarginMm: 15,
}

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
const api = (method, argument) => evaluate(`window.api[${JSON.stringify(method)}](${JSON.stringify(argument)})`)

async function signIn() {
  if ((await api('engagementAuthStatus', null))?.user) return
  for (let attempt = 0; attempt < 50 && !(await evaluate(`!!document.querySelector('input[type="email"],input[autocomplete="username"],input[type="text"]')`)); attempt++) await sleep(200)
  await evaluate(`(() => {
    const email=document.querySelector('input[type="email"],input[autocomplete="username"],input[type="text"]'), password=document.querySelector('input[type="password"]');
    const set=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))};
    set(email,${JSON.stringify(administrator.email)});set(password,${JSON.stringify(administrator.password)});email.form.requestSubmit()})()`)
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await api('engagementAuthStatus', null))?.user) return
    await sleep(200)
  }
  throw new Error('Isolated sign-in did not complete.')
}

const canon = value => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))))
const summary = settings => ({
  firms: settings.professionalFirms.map(f => ({ id: f.id, name: f.firm_name, status: f.profile_status, website: f.website_url, logo: f.logo_mime_type, active: f.is_active })),
  offices: settings.offices.map(o => ({ id: o.id, firm: o.auditor_firm_id, name: o.office_name, active: o.is_active })),
  partners: settings.partners.map(p => ({ id: p.id, name: p.display_name, title: p.job_title })),
})
const isKreston = firm => /kreston/i.test(firm.firm_name || '') || /krestonmenon\.com/i.test(firm.website_url || '')

await signIn()
const before = await api('getEngagementFirmSettings', null)
console.log('EXISTING', JSON.stringify(summary(before), null, 1))
console.log('REPORT STYLES', JSON.stringify((await api('listFirmReportStyles', null)).map(s => ({ id: s.id, version: s.version, name: s.name }))))
if (phase === 'inspect') { socket.close(); process.exit(0) }

if (phase === 'apply') {
  const preview = await api('fetchPublicFirmProfilePreview', { websiteUrl: SITE })
  console.log('LOGO SOURCE', preview.preview.logoUrl, preview.logoMimeType, `${Buffer.from(preview.logoBase64, 'base64').length} bytes`)
  const existing = before.professionalFirms.find(f => isKreston(f) && f.profile_status === 'demo')
  const firmInput = {
    ...(existing ? { id: existing.id } : { createSeparateProfile: true }),
    ...FIRM, profileStatus: 'demo', isActive: true,
    sourceRetrievedAt: preview.preview.retrievedAt || new Date().toISOString(),
    logoBase64: preview.logoBase64, logoMimeType: preview.logoMimeType,
  }
  const firm = await api('saveEngagementProfessionalFirm', firmInput)
  console.log(existing ? 'FIRM updated' : 'FIRM created', firm.id)
  const current = await api('getEngagementFirmSettings', null)
  for (const office of OFFICES) {
    const match = current.offices.find(o => o.auditor_firm_id === firm.id && o.office_name === office.officeName)
    const saved = await api('saveEngagementFirmOffice', { ...office, auditorFirmId: firm.id, ...(match ? { id: match.id } : {}) })
    console.log(match ? 'OFFICE updated' : 'OFFICE created', saved.office_name, saved.id)
  }
  const styles = await api('listFirmReportStyles', null)
  const sameStyle = styles.find(s => s.name === STYLE_NAME && canon(s.settings) === canon(STYLE))
  if (sameStyle) console.log('REPORT STYLE already present, version', sameStyle.version)
  else console.log('REPORT STYLE created, version', (await api('saveFirmReportStyle', { name: STYLE_NAME, settings: STYLE })).version)
}

// verify (also runs after apply): read everything back from the service
const after = await api('getEngagementFirmSettings', null)
const kreston = after.professionalFirms.filter(f => isKreston(f) && f.profile_status === 'demo')
assert.equal(kreston.length, 1, 'exactly one Kreston demo firm')
const firm = kreston[0]
const logo = Buffer.from(firm.logo_base64 || '', 'base64')
console.log('VERIFY firm', JSON.stringify({ id: firm.id, name: firm.firm_name, status: firm.profile_status, email: firm.email, phone: firm.phone, website: firm.website_url, frn: firm.frn, pan: firm.pan, sources: firm.source_urls, retrieved: firm.source_retrieved_at, logoMime: firm.logo_mime_type, logoBytes: logo.length, logoSha256: crypto.createHash('sha256').update(logo).digest('hex') }))
const offices = after.offices.filter(o => o.auditor_firm_id === firm.id)
console.log('VERIFY offices', JSON.stringify(offices.map(o => ({ id: o.id, name: o.office_name, phone: o.phone, email: o.email, source: o.source_url, retrieved: o.source_retrieved_at }))))
assert.deepEqual(offices.map(o => o.office_name).sort(), OFFICES.map(o => o.officeName).sort(), 'four distinct offices, no duplicates')
const unchanged = summary(before).firms.filter(f => !isKreston({ firm_name: f.name, website_url: f.website }))
for (const prior of unchanged) assert.ok(after.professionalFirms.some(f => f.id === prior.id && f.firm_name === prior.name), `existing firm preserved: ${prior.name}`)
assert.equal(after.partners.length, before.partners.length, 'no partner/login account was created')
const styleRows = (await api('listFirmReportStyles', null)).filter(s => s.name === STYLE_NAME)
assert.ok(styleRows.length >= 1 && canon(styleRows[0].settings) === canon(STYLE), 'proposed report style saved')
console.log('VERIFY OK', JSON.stringify({ firmsTotal: after.professionalFirms.length, offices: offices.length, partnersUnchanged: after.partners.length, reportStyleVersions: styleRows.map(s => s.version) }))
socket.close()
process.exit(0)
