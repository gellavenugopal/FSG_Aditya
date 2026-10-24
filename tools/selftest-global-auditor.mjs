/**
 * Pre-release self-test: the GLOBAL auditor list (Masters → Auditor Firms and
 * their partners / proprietor) works end to end, and an auditee takes its
 * auditor from it instead of re-typing it (Create / Edit Auditee and Master →
 * Auditor use the shared GlobalAuditorPicker). Requested in the field
 * (28 Sep 2026): "the name of auditor is to be typed every time I create a
 * new company".
 *
 * The firm / partner queries compared PostgreSQL BOOLEAN columns with 1 / 0
 * (is_active=1), which PostgreSQL rejects — the global list could not be
 * listed or deleted from.
 *
 * Runs the REAL main-process handlers (ipc/masters.js) on a throw-away
 * PostgreSQL cluster in the temp folder, deleted afterwards.
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = process.env.FSG_SRC_ROOT ? path.resolve(process.env.FSG_SRC_ROOT) : root
register(pathToFileURL(path.join(root, 'tools', 'e2e-learned-rules', 'hooks.mjs')).href)
// The main process's `import * as XLSX from 'xlsx'` is bundled by Vite in the app; under plain Node hand it the CommonJS module.
const xlsxShim = path.join(os.tmpdir(), `fsg-selftest-xlsx-ga-${process.pid}.mjs`)
fs.writeFileSync(xlsxShim, `import { createRequire } from 'node:module'
const X = createRequire(${JSON.stringify(pathToFileURL(path.join(root, 'package.json')).href)})('xlsx')
export const { read, readFile, utils, write, writeFile } = X
export default X
`)
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === 'xlsx') return { url: ${JSON.stringify(pathToFileURL(xlsxShim).href)}, shortCircuit: true }
  return next(specifier, context)
}`))

let fails = 0
const ok = (what, cond, detail = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + detail}`) }
const finish = () => { console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n') }

const pgRoot = 'C:\\Program Files\\PostgreSQL'
const ver = fs.existsSync(pgRoot) ? fs.readdirSync(pgRoot).filter(d => fs.existsSync(path.join(pgRoot, d, 'bin', 'initdb.exe'))).sort((a, b) => parseFloat(b) - parseFloat(a))[0] : null
if (!ver) { ok('PostgreSQL binaries found', false); finish(); process.exit(1) }
const bin = (x) => path.join(pgRoot, ver, 'bin', x)
const port = await new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) }) })
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-selftest-pg-'))
const run = (exe, args, quiet = false) => spawnSync(bin(exe), args, quiet ? { stdio: 'ignore', timeout: 60000 } : { encoding: 'utf8', timeout: 120000 })
let started = false

try {
  let r = run('initdb.exe', ['-D', dataDir, '-U', 'selftest', '-A', 'trust', '-E', 'UTF8'])
  if (r.status !== 0) throw new Error('initdb failed: ' + (r.stderr || r.stdout))
  r = run('pg_ctl.exe', ['-D', dataDir, '-o', `-p ${port}`, '-l', path.join(dataDir, 'log.txt'), '-w', 'start'], true)
  if (r.status !== 0) throw new Error('pg_ctl start failed')
  started = true
  const imp = (rel) => import(pathToFileURL(path.join(srcRoot, 'src', 'main', ...rel.split('/'))).href)
  const { initDB, query } = await imp('db/client.js')
  const { ensureSchema } = await imp('db/schema.js')
  const { registerMastersHandlers } = await imp('ipc/masters.js')
  await initDB({ host: 'localhost', port, database: 'postgres', user: 'selftest', password: '' })
  await ensureSchema()
  registerMastersHandlers()
  const ipc = (name, ...args) => globalThis.__ipc[name](null, ...args)
  const attempt = async (fn) => { try { return { v: await fn() } } catch (e) { return { e: e.message } } }

  console.log('\nGlobal auditor list (Masters)')
  const firm = await ipc('auditorFirm:save', { firm_name: 'Maheshwari & Co.', frn: '123456E' })
  const solo = await ipc('auditorFirm:save', { firm_name: 'Solo Associates', frn: '654321E' })
  await ipc('globalSignatory:save', { firm_id: firm.id, name: 'A. Partner', designation: 'Partner', membership_number: '111111' })
  await ipc('globalSignatory:save', { firm_id: firm.id, name: 'B. Partner', designation: 'Partner', membership_number: '222222' })
  await ipc('globalSignatory:save', { firm_id: solo.id, name: 'S. Proprietor', designation: 'Proprietor', membership_number: '333333' })

  const firms = await attempt(() => ipc('auditorFirm:list'))
  ok('the firms can be listed', !firms.e && (firms.v || []).map(f => f.firm_name).join('|') === 'Maheshwari & Co.|Solo Associates', firms.e || JSON.stringify(firms.v?.map(f => f.firm_name)))
  const partners = await attempt(() => ipc('globalSignatory:list', firm.id))
  ok('choosing a firm lists only its partners (2)', !partners.e && (partners.v || []).length === 2 && partners.v.every(p => p.firm_name === 'Maheshwari & Co.' && p.firm_frn === '123456E'), partners.e || JSON.stringify(partners.v))
  const soloList = await attempt(() => ipc('globalSignatory:list', solo.id))
  ok('a proprietor firm lists its one proprietor', !soloList.e && (soloList.v || []).length === 1 && soloList.v[0].membership_number === '333333', soloList.e || JSON.stringify(soloList.v))
  const del = await attempt(() => ipc('auditorFirm:delete', solo.id))
  const afterDel = await attempt(() => ipc('auditorFirm:list'))
  ok('a firm can be removed from the list', !del.e && !afterDel.e && (afterDel.v || []).length === 1, del.e || afterDel.e || JSON.stringify(afterDel.v))
  const delP = await attempt(async () => { const p = (await ipc('globalSignatory:list', firm.id))[0]; await ipc('globalSignatory:delete', p.id); return ipc('globalSignatory:list', firm.id) })
  ok('a partner can be removed from the list', !delP.e && (delP.v || []).length === 1, delP.e || JSON.stringify(delP.v))

  console.log('\nAn auditee takes its auditor from the global list')
  const ent = (await query(`INSERT INTO entities (name, constitution, constitution_display) VALUES ('ZZ Auditee', 3, 'Company') RETURNING id`)).rows[0].id
  const p = (await ipc('globalSignatory:list', firm.id))[0]
  const f = (await ipc('auditorFirm:list'))[0]
  const saved = await attempt(() => ipc('auditor:save', { entity_id: ent, firm_name: f.firm_name, frn: f.frn, name: p.name, designation: p.designation, membership_number: p.membership_number }))
  const list = await ipc('auditor:list', ent)
  ok('saved on the auditee with firm, FRN, partner and membership number', !saved.e && list.length === 1 && list[0].firm_name === 'Maheshwari & Co.' && list[0].frn === '123456E' && list[0].membership_number === p.membership_number, saved.e || JSON.stringify(list))
  const glob = await ipc('auditor:listGlobal')
  ok('Generate Financials still sees the global list', glob.length >= 1 && glob.every(g => g.firm_name && g.membership_number !== undefined), JSON.stringify(glob))

  console.log('\nA database whose is_active was made an integer is converted on launch')
  await query("ALTER TABLE auditor_firms ALTER COLUMN is_active DROP DEFAULT")
  await query("ALTER TABLE auditor_firms ALTER COLUMN is_active TYPE INTEGER USING (CASE WHEN is_active THEN 1 ELSE 0 END)")
  await ensureSchema()
  const t = (await query("SELECT data_type FROM information_schema.columns WHERE table_name = 'auditor_firms' AND column_name = 'is_active'")).rows[0]?.data_type
  const again = await attempt(() => ipc('auditorFirm:list'))
  ok('converted back to boolean, active firms kept, removed one still removed', t === 'boolean' && !again.e && (again.v || []).length === 1, `${t} ${again.e || JSON.stringify(again.v?.map(f => f.firm_name))}`)
} catch (e) {
  ok('harness ran', false, e.stack || e.message)
} finally {
  if (started) run('pg_ctl.exe', ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], true)
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.rmSync(xlsxShim, { force: true })
}

console.log('\nThe screens use it')
const readUi = (rel) => { try { return fs.readFileSync(path.join(srcRoot, 'src', 'renderer', 'src', 'components', ...rel.split('/')), 'utf8') } catch { return '' } }
ok('Create / Edit Auditee offers the global auditor picker', /GlobalAuditorPicker/.test(readUi('Master/AuditeeFormModal.jsx')))
ok('Master → Auditor → Add offers it too', /GlobalAuditorPicker/.test(readUi('Master/AuditorManageModal.jsx')))
finish()
process.exit(fails ? 1 : 0)
