/**
 * Pre-release self-test: a SECOND "+ Add PY-only Major Head" entry must not
 * overwrite the FIRST one (see src/main/ipc/masters.js's
 * manualPyEntries:upsert / entityManualPyEntries:upsert).
 *
 * Every "+ Add PY-only Major Head" entry is saved with noteNum=0 (a
 * placeholder — the note doesn't exist yet) and particular_label=''. The
 * table's unique key is (tb_id/entity_id, note_num, particular_label) — kept
 * for legacy rows saved before note_title existed. Before this fix, the
 * INSERT's ON CONFLICT target was that same legacy key: a second entry (a
 * DIFFERENT title, same noteNum=0, same blank label) collided with the
 * first and silently overwrote it. Reported live: adding a PY-only
 * "Partners' Remuneration" figure, then adding a PY-only "Tax expense"
 * figure, made the Partners' Remuneration one vanish.
 *
 * Runs the REAL registerMastersHandlers() against a mock ipcMain (captures
 * the handlers instead of an Electron app) and a mock query() (an in-memory
 * table implementing the same unique-key/ON CONFLICT semantics the real
 * Postgres schema does), then calls the real manualPyEntries:upsert /
 * entityManualPyEntries:upsert handlers twice with different titles.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against
 * that source to prove they fail there (this guard did not exist before).
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-manualpy-notenum-clash.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = process.env.FSG_SRC_ROOT ? path.resolve(process.env.FSG_SRC_ROOT) : root
const require = createRequire(import.meta.url)
const esbuild = require(path.join(root, 'node_modules', 'esbuild'))

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + detail}`)
}

console.log('\nA second "+ Add PY-only Major Head" entry must not overwrite the first')

// ── In-memory mock of manual_py_entries / entity_manual_py_entries — same
// unique key (scope, note_num, particular_label) and ON CONFLICT ... DO
// UPDATE semantics as the real Postgres schema (see schema.js). ───────────
function makeMockDb() {
  let table = []
  let nextId = 1
  const norm = (sql) => sql.replace(/\s+/g, ' ').trim()
  async function query(sql, params = []) {
    const s = norm(sql)
    if (s.includes('SELECT id FROM manual_py_entries WHERE tb_id=$1 AND note_title=$2 AND particular_label=$3') ||
        s.includes('SELECT id FROM entity_manual_py_entries WHERE entity_id=$1 AND note_title=$2 AND particular_label=$3')) {
      const [scopeId, title, label] = params
      return { rows: table.filter(r => r.scopeId === scopeId && r.note_title === title && r.particular_label === label).map(r => ({ id: r.id })) }
    }
    if (s.includes('SELECT id FROM manual_py_entries WHERE tb_id=$1 AND note_num=$2 AND particular_label=$3') ||
        s.includes('SELECT id FROM entity_manual_py_entries WHERE entity_id=$1 AND note_num=$2 AND particular_label=$3')) {
      const [scopeId, noteNum, label] = params
      return { rows: table.filter(r => r.scopeId === scopeId && r.note_num === noteNum && r.particular_label === label).map(r => ({ id: r.id })) }
    }
    if (s.includes('SELECT COALESCE(MIN(note_num), 0) AS min FROM manual_py_entries WHERE tb_id=$1') ||
        s.includes('SELECT COALESCE(MIN(note_num), 0) AS min FROM entity_manual_py_entries WHERE entity_id=$1')) {
      const [scopeId] = params
      const nums = table.filter(r => r.scopeId === scopeId).map(r => r.note_num)
      return { rows: [{ min: nums.length ? Math.min(...nums) : 0 }] }
    }
    if (s.startsWith('UPDATE manual_py_entries SET note_num=$1') || s.startsWith('UPDATE entity_manual_py_entries SET note_num=$1')) {
      const [noteNum, py, isCustom, id] = params
      const row = table.find(r => r.id === id)
      if (row) { row.note_num = noteNum; row.py_amount = py; row.is_custom = isCustom }
      return { rows: row ? [{ ...row }] : [] }
    }
    if (s.startsWith('INSERT INTO manual_py_entries') || s.startsWith('INSERT INTO entity_manual_py_entries')) {
      const [scopeId, noteNum, title, label, py, isCustom] = params
      const existing = table.find(r => r.scopeId === scopeId && r.note_num === noteNum && r.particular_label === label)
      if (existing) {
        existing.note_title = title; existing.py_amount = py; existing.is_custom = isCustom
        return { rows: [{ ...existing }] }
      }
      const row = { id: nextId++, scopeId, note_num: noteNum, note_title: title, particular_label: label, py_amount: py, is_custom: isCustom }
      table.push(row)
      return { rows: [{ ...row }] }
    }
    throw new Error('selftest mock: unrecognised query -- ' + s.slice(0, 120))
  }
  return { query, get table() { return table } }
}

async function loadHandlers() {
  const file = path.join(srcRoot, 'src', 'main', 'ipc', 'masters.js')
  if (!fs.existsSync(file)) return { __missing: `${file} does not exist` }
  const handlers = new Map()
  const built = await esbuild.build({
    stdin: { contents: `export * from ${JSON.stringify(file)}\n`, resolveDir: srcRoot, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [{
      name: 'selftest-shims',
      setup(b) {
        b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'shim' }))
        b.onResolve({ filter: /client\.js$/ }, () => ({ path: 'db-client', namespace: 'shim' }))
        b.onLoad({ filter: /^electron$/, namespace: 'shim' }, () => ({
          contents: `
            export const ipcMain = { handle: (name, fn) => { globalThis.__handlers.set(name, fn) } }
            export const app = { getPath: () => '/tmp', whenReady: () => Promise.resolve() }
            export const safeStorage = { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: () => '' }
            export class BrowserWindow {}
          `,
          loader: 'js',
        }))
        b.onLoad({ filter: /^db-client$/, namespace: 'shim' }, () => ({
          contents: 'export const query = (...a) => globalThis.__mockQuery(...a); export const runInTransaction = async (f) => f();',
          loader: 'js',
        }))
      },
    }],
  })
  globalThis.__handlers = handlers
  const mockDb = makeMockDb()
  globalThis.__mockQuery = mockDb.query
  const tmp = path.join(os.tmpdir(), `fsg-selftest-manualpy-clash-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try {
    const mod = await import(pathToFileURL(tmp).href)
    mod.registerMastersHandlers()
  } finally { fs.rmSync(tmp, { force: true }) }
  return { handlers, table: mockDb.table }
}

async function main() {
  const { handlers, table, __missing } = await loadHandlers()
  if (__missing) {
    ok('masters.js exists', false, __missing)
    console.log(fails ? `\n${fails} FAILURE(S)\n` : '\nAll checks passed\n')
    process.exit(1)
  }
  const upsert = handlers.get('manualPyEntries:upsert')
  ok('manualPyEntries:upsert handler is registered', typeof upsert === 'function')
  if (!upsert) { console.log(`\n${fails} FAILURE(S)\n`); process.exit(1) }

  // Mirrors Notes/index.jsx's saveAddMajorHead(): noteNum:0, particularLabel:''
  // for every new PY-only major head, whatever its title.
  await upsert(null, { tbId: 1, noteNum: 0, noteTitle: "Partners' Remuneration", particularLabel: '', py_amount: 50000, is_custom: false })
  await upsert(null, { tbId: 1, noteNum: 0, noteTitle: 'Tax expense', particularLabel: '', py_amount: 75000, is_custom: false })

  const rows = table.filter(r => r.scopeId === 1)
  ok('both entries exist (not one overwriting the other)', rows.length === 2, `found ${rows.length}: ${JSON.stringify(rows.map(r => r.note_title))}`)
  const rem = rows.find(r => r.note_title === "Partners' Remuneration")
  const tax = rows.find(r => r.note_title === 'Tax expense')
  ok('"Partners\' Remuneration" survives, still 50000', !!rem && Number(rem.py_amount) === 50000, JSON.stringify(rem))
  ok('"Tax expense" saved correctly, 75000', !!tax && Number(tax.py_amount) === 75000, JSON.stringify(tax))
  if (rem && tax) {
    ok('the two entries no longer share the same note_num slot', rem.note_num !== tax.note_num, `both at ${rem.note_num}`)
  }

  // A third entry for a different TB scope must not collide with tb_id=1's entries.
  await upsert(null, { tbId: 2, noteNum: 0, noteTitle: "Partners' Remuneration", particularLabel: '', py_amount: 99999, is_custom: false })
  const tb1Rem = table.find(r => r.scopeId === 1 && r.note_title === "Partners' Remuneration")
  ok('a same-titled entry under a DIFFERENT TB does not disturb this one', tb1Rem && Number(tb1Rem.py_amount) === 50000, JSON.stringify(tb1Rem))

  // Entity-scoped variant (Consolidated Manual PY) — same bug, same fix.
  const entityUpsert = handlers.get('entityManualPyEntries:upsert')
  ok('entityManualPyEntries:upsert handler is registered', typeof entityUpsert === 'function')
  if (entityUpsert) {
    await entityUpsert(null, { entityId: 9, noteNum: 0, noteTitle: "Partners' Remuneration", particularLabel: '', py_amount: 11111, is_custom: false })
    await entityUpsert(null, { entityId: 9, noteNum: 0, noteTitle: 'Tax expense', particularLabel: '', py_amount: 22222, is_custom: false })
    const entRows = table.filter(r => r.scopeId === 9)
    ok('Consolidated (entity-scoped): both entries exist', entRows.length === 2, `found ${entRows.length}`)
    const entRem = entRows.find(r => r.note_title === "Partners' Remuneration")
    ok('Consolidated: "Partners\' Remuneration" survives, still 11111', !!entRem && Number(entRem.py_amount) === 11111, JSON.stringify(entRem))
  }

  console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
  process.exit(fails ? 1 : 0)
}

main()
