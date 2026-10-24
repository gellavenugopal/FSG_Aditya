/**
 * Pre-release self-test: a FINAL copy (0.1.97). Ticking "Final" while generating the PDF / Excel saves the Place and Date of Signing in the
 * database and locks the Financial Year; once final, the place and date cannot be changed, and unlocking the year in Master releases them.
 *
 * Runs the REAL main-process handlers on a throw-away PostgreSQL cluster in the temp folder, deleted afterwards - the live database is never touched.
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source to prove they fail there.
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-final-signing.mjs
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
const xlsxShim = path.join(os.tmpdir(), `fsg-selftest-xlsx-fin-${process.pid}.mjs`)
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
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + String(detail).slice(0, 400)}`)
}
const finish = () => { console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n') }
console.log(`\nFinal copy: Place / Date of Signing and the Financial Year lock${srcRoot !== root ? `  (source: ${srcRoot})` : ''}`)

const pgRoot = 'C:\\Program Files\\PostgreSQL'
const ver = fs.existsSync(pgRoot) ? fs.readdirSync(pgRoot).filter(d => fs.existsSync(path.join(pgRoot, d, 'bin', 'initdb.exe'))).sort((a, b) => parseFloat(b) - parseFloat(a))[0] : null
if (!ver) { ok('PostgreSQL binaries found (C:\\Program Files\\PostgreSQL\\<ver>\\bin)', false); finish(); process.exit(1) }
const bin = (x) => path.join(pgRoot, ver, 'bin', x)
const port = await new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) }) })
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-selftest-pg-fin-'))
const run = (exe, args, quiet = false) => spawnSync(bin(exe), args, quiet ? { stdio: 'ignore', timeout: 60000 } : { encoding: 'utf8', timeout: 120000 })
let started = false
const cleanup = () => {
  if (started) run('pg_ctl.exe', ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], true)
  fs.rmSync(dataDir, { recursive: true, force: true })
}

try {
  let r = run('initdb.exe', ['-D', dataDir, '-U', 'selftest', '-A', 'trust', '-E', 'UTF8', '-N'])
  if (r.status !== 0) throw new Error('initdb failed: ' + (r.stderr || r.stdout))
  r = run('pg_ctl.exe', ['-D', dataDir, '-o', `-p ${port}`, '-l', path.join(dataDir, 'log.txt'), '-w', 'start'], true)
  if (r.status !== 0) throw new Error('pg_ctl start failed (status ' + r.status + ')')
  started = true

  process.chdir(srcRoot)
  const imp = (rel) => import(pathToFileURL(path.join(srcRoot, 'src', 'main', ...rel.split('/'))).href)
  const { initDB, query } = await imp('db/client.js')
  const { ensureSchema } = await imp('db/schema.js')
  const { registerTBHandlers } = await imp('ipc/tb.js')
  const { registerFinancialPeriodHandlers } = await imp('ipc/financial-periods.js')
  await initDB({ host: 'localhost', port, database: 'postgres', user: 'selftest', password: '' })
  await ensureSchema()
  registerTBHandlers(); registerFinancialPeriodHandlers()
  const ipc = (name, ...args) => globalThis.__ipc[name](null, ...args)
  const one = async (sql, p) => (await query(sql, p)).rows[0]
  const fails_ = async (fn) => { try { await fn(); return null } catch (e) { return String(e && e.message || e) } }

  const cols = (await query(`SELECT column_name FROM information_schema.columns WHERE table_name='entity_periods'`)).rows.map(x => x.column_name)
  ok('the database has is_final, final_sign_place, final_sign_date and finalised_at on entity_periods', ['is_final', 'final_sign_place', 'final_sign_date', 'finalised_at'].every(c => cols.includes(c)), cols.join(','))

  const ent = await one(`INSERT INTO entities (name, constitution, constitution_display, business_type) VALUES ('ZZ Final Co', 3, 'Company', 'Trader') RETURNING *`)
  const fp = (await one(`INSERT INTO financial_periods (year_label, date_from, date_till) VALUES ('2025-26', '2025-04-01', '2026-03-31') RETURNING id`)).id
  const ep = (await one(`INSERT INTO entity_periods (entity_id, financial_period_id) VALUES ($1,$2) RETURNING id`, [ent.id, fp])).id

  const before = await ipc('entityPeriod:get', ep)
  ok('a new year is not final and not locked', before.is_final === false && before.locked === false && !before.final_sign_place)
  ok('Final needs a Place of Signing', /place/i.test(await fails_(() => ipc('entityPeriod:finalise', ep, '   ', '2026-09-30')) || ''))
  ok('Final needs a real Date of Signing', /date/i.test(await fails_(() => ipc('entityPeriod:finalise', ep, 'Siliguri', '30-09-2026')) || '') && /date/i.test(await fails_(() => ipc('entityPeriod:finalise', ep, 'Siliguri', '2026-13-45')) || '') && /date/i.test(await fails_(() => ipc('entityPeriod:finalise', ep, 'Siliguri', '')) || ''))
  ok('...and a refused attempt changes nothing', (await one(`SELECT is_final, locked FROM entity_periods WHERE id=$1`, [ep])).is_final === false)

  const done = await ipc('entityPeriod:finalise', ep, '  Siliguri ', '2026-09-30')
  const row = await one(`SELECT * FROM entity_periods WHERE id=$1`, [ep])
  ok('Final saves the Place (tidied) and the Date in the database', row.is_final === true && row.final_sign_place === 'Siliguri' && row.final_sign_date === '2026-09-30' && !!row.finalised_at, JSON.stringify(row))
  ok('...and locks the Financial Year in the same step', row.locked === true && !!row.locked_at && done.locked === true)
  const fetched = await ipc('entityPeriod:get', ep)
  ok('the screens read it back (get and list)', fetched.is_final === true && fetched.final_sign_place === 'Siliguri' && fetched.final_sign_date === '2026-09-30')
  const listed = (await ipc('entityPeriod:list', ent.id)).find(x => x.id === ep)
  ok('...Master sees it too', listed && listed.is_final === true && listed.final_sign_place === 'Siliguri' && listed.final_sign_date === '2026-09-30' && listed.locked === true)

  ok('asking again with the same Place and Date is harmless', (await fails_(() => ipc('entityPeriod:finalise', ep, 'Siliguri', '2026-09-30'))) === null)
  const e1 = await fails_(() => ipc('entityPeriod:finalise', ep, 'Kolkata', '2026-09-30'))
  const e2 = await fails_(() => ipc('entityPeriod:finalise', ep, 'Siliguri', '2026-10-05'))
  ok('once Final, a different Place or Date is refused, and the saved ones stay', !!e1 && !!e2 && /already Final/i.test(e1 + e2) && (await one(`SELECT final_sign_place, final_sign_date FROM entity_periods WHERE id=$1`, [ep])).final_sign_place === 'Siliguri', `${e1} | ${e2}`)
  const upErr = await fails_(() => ipc('tb:uploadRealBooks', { entityId: ent.id, period: '2025-26', fileName: 'x.xlsx', tbRows: [], branchName: '', entityPeriodId: ep }))
  ok('the lock really bites: a Trial Balance cannot be uploaded to a Final year', /locked/i.test(upErr || ''), upErr)

  await ipc('entityPeriod:unlock', ep)
  const un = await one(`SELECT * FROM entity_periods WHERE id=$1`, [ep])
  ok('unlocking the year in Master releases the signing details (no longer Final, no longer locked)', un.is_final === false && un.locked === false && un.finalised_at === null)
  ok('...the last Place and Date are kept as the starting values', un.final_sign_place === 'Siliguri' && un.final_sign_date === '2026-09-30')
  await ipc('entityPeriod:finalise', ep, 'Kolkata', '2026-10-05')
  const again = await one(`SELECT * FROM entity_periods WHERE id=$1`, [ep])
  ok('it can be finalised afresh with a new Place and Date', again.is_final === true && again.final_sign_place === 'Kolkata' && again.final_sign_date === '2026-10-05' && again.locked === true)

  // the screen
  const gf = fs.readFileSync(path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'GenerateFinancials', 'index.jsx'), 'utf8')
  const pre = fs.readFileSync(path.join(srcRoot, 'src', 'preload', 'index.js'), 'utf8')
  ok('the preload exposes finaliseEntityPeriod', /finaliseEntityPeriod:.*entityPeriod:finalise/.test(pre))
  ok('the export dialog has the Final tick-box and saves through finaliseEntityPeriod before exporting', /This is the final copy/.test(gf) && /finaliseEntityPeriod\(epId, signPlace\.trim\(\), signDate\)/.test(gf))
  ok('once Final, the dialog shows the saved Place and Date, locked', /value=\{effSignPlace\} disabled=\{isFinal\}/.test(gf) && /value=\{effSignDate\} disabled=\{isFinal\}/.test(gf))
  ok('every export (single / consolidated, Excel / PDF) prints the saved Place and Date', (gf.match(/signPlace: effSignPlace, signDate: effSignDate,/g) || []).length >= 4 && !/^\s+signPlace, signDate,$/m.test(gf))
} catch (e) {
  ok('the checks ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e))
} finally {
  cleanup()
  try { fs.rmSync(xlsxShim, { force: true }) } catch (_) {}
}
finish()
process.exit(fails ? 1 : 0)
