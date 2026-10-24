/**
 * Pre-release self-test: Settings -> "Download All Tables (Excel)".
 *
 * Reported live: "Export failed: Invalid array length". The workbook was built in the
 * renderer and its bytes sent back through IPC as a plain array
 * (Array.from(new Uint8Array(buf))) -- V8 cannot make an array of ~134 million+
 * elements, and SheetJS writes UNcompressed, so a big database crossed that line.
 * Also proven here, because they were next in line: a cell over 32,767 characters,
 * a sheet over 1,048,576 rows, and values Excel has no type for (dates, JSON, binary...).
 *
 * The export now runs in the main process (services/dbExport.js): compressed, paged,
 * sanitised, split into several files when a workbook would be too big. This test drives
 * that module with synthetic tables and reads the written files back.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 * FSG_STRESS=1 additionally writes a workbook whose uncompressed size is well over the
 * old ~134 MB failure point (a minute or two).
 *
 *   node tools/selftest-db-export.mjs
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
const XLSX = require(path.join(root, 'node_modules', 'xlsx'))

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + String(detail).slice(0, 300)}`)
}

console.log(`\nDatabase export (Settings -> Download All Tables)${srcRoot !== root ? `  (source: ${srcRoot})` : ''}`)

const modFile = path.join(srcRoot, 'src', 'main', 'services', 'dbExport.js')
if (!fs.existsSync(modFile)) {
  ok('the export module exists (services/dbExport.js)', false, 'not found - the export still runs in the renderer and sends the file back as an array')
  console.log(`\n${fails} FAILURE(S) — release aborted\n`)
  process.exit(1)
}
const built = await esbuild.build({
  entryPoints: [modFile], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  nodePaths: [path.join(root, 'node_modules')],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
})
const tmpMod = path.join(os.tmpdir(), `fsg-selftest-dbexport-${process.pid}.mjs`)
fs.writeFileSync(tmpMod, built.outputFiles[0].text)
const { exportTablesToFiles, cleanCell } = await import(pathToFileURL(tmpMod).href)
fs.rmSync(tmpMod, { force: true })

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-dbexp-'))
const read = (f) => XLSX.readFile(f)
const dataRows = (wb, name) => { const r = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null }); return r.slice(1) }
const totalDataRows = (files) => files.reduce((s, f) => { const wb = read(f); return s + wb.SheetNames.filter(n => n !== '_Contents').reduce((t, n) => t + dataRows(wb, n).length, 0) }, 0)

try {
  // ── values a database hands back ──────────────────────────────────────────
  const d = cleanCell(new Date(Date.UTC(2026, 8, 21, 10, 30, 5, 123))).v
  ok('a Date becomes readable text', d === '2026-09-21 10:30:05', d)
  ok('binary becomes a marker, not bytes', cleanCell(Buffer.from('abc')).v === '[binary 3 bytes]')
  ok('JSON / arrays become text', cleanCell({ a: [1, 2] }).v === '{"a":[1,2]}' && cleanCell([1, 2]).v === '[1,2]')
  ok('NaN / Infinity become text, not a broken number', cleanCell(NaN).v === 'NaN' && cleanCell(Infinity).v === 'Infinity')
  ok('a bigint is a number when it is safe, text when it is not', cleanCell(12n).v === 12 && cleanCell(12345678901234567890n).v === '12345678901234567890')
  ok('null stays empty; numbers and booleans stay as they are', cleanCell(null).v === null && cleanCell(3.5).v === 3.5 && cleanCell(true).v === true)
  const ctl = cleanCell('a\u0001b\u0008c\u000Bd\te\nf').v
  ok('control characters that are illegal in XML are dropped (tab and newline kept)', ctl === 'abcd\te\nf', JSON.stringify(ctl))
  const long = cleanCell('x'.repeat(40000))
  ok('a cell over the Excel limit is cut, marked, and under 32,767 characters', long.cut && long.v.length < 32767 && /\[cut \d+ characters\]$/.test(long.v), long.v.length)

  // ── synthetic tables ─────────────────────────────────────────────────────
  const many = Array.from({ length: 45000 }, (_, i) => ({ id: i + 1, name: `Ledger ${i}`, amount: (i * 37.5) % 9999 }))
  const TABLES = {
    small_mixed: [
      { id: 1, d: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)), j: { k: 'v' }, arr: [1, 2], b: Buffer.from('abc'), big: 'y'.repeat(40000), n: null, flag: true, nan: NaN, txt: 'a\u0001b' },
      { id: 2, d: null, j: null, arr: null, b: null, big: 'short', n: 5, flag: false, nan: 1, txt: 'plain' },
    ],
    many,
    'weird/name*table?[x]': [{ a: 1 }],
    a_very_long_table_name_that_exceeds_thirty_one_chars_A: [{ v: 'A' }],
    a_very_long_table_name_that_exceeds_thirty_one_chars_B: [{ v: 'B' }],
    empty_table: [],
  }
  const tables = Object.keys(TABLES)
  const fetchPage = async (t, offset, limit) => TABLES[t].slice(offset, offset + limit)
  const totalRows = Object.values(TABLES).reduce((s, r) => s + r.length, 0)

  // ── one file, default limits: exactly the file the user chose ────────────
  const f1 = path.join(work, 'all.xlsx')
  const r1 = await exportTablesToFiles({ filePath: f1, tables, fetchPage })
  ok('a normal database is ONE file, named exactly as chosen (no _part1 left behind)', r1.files.length === 1 && r1.files[0] === f1 && fs.existsSync(f1) && !fs.existsSync(path.join(work, 'all_part1.xlsx')), JSON.stringify(r1.files))
  ok('...counting every table and row', r1.tables === tables.length && r1.rows === totalRows, JSON.stringify(r1))
  const wb1 = read(f1)
  ok('an index sheet comes first, then one sheet per table', wb1.SheetNames[0] === '_Contents' && tables.length + 1 === wb1.SheetNames.length, wb1.SheetNames.join(' | '))
  ok('every sheet name is legal (<=31 chars, none of : \\ / ? * [ ]) and unique', wb1.SheetNames.every(n => n.length <= 31 && !/[:\\/?*[\]]/.test(n)) && new Set(wb1.SheetNames.map(n => n.toLowerCase())).size === wb1.SheetNames.length, wb1.SheetNames.join(' | '))
  ok('two long table names with the same first 31 characters keep separate sheets', wb1.SheetNames.filter(n => n.startsWith('a_very_long_table_name_that_e')).length === 2)
  ok('all 45,000 rows of the big table are there, in order', dataRows(wb1, 'many').length === 45000 && dataRows(wb1, 'many')[44999][0] === 45000 && dataRows(wb1, 'many')[0][1] === 'Ledger 0')
  const sm = dataRows(wb1, 'small_mixed')
  ok('mixed values written as text/numbers; the 40,000-character cell is cut and marked', sm.length === 2 && sm[0][1] === '2026-01-02 03:04:05' && sm[0][2] === '{"k":"v"}' && sm[0][4] === '[binary 3 bytes]' && String(sm[0][5]).length < 32767 && /\[cut \d+ characters\]$/.test(String(sm[0][5])) && sm[0][9] === 'ab', JSON.stringify(sm[0]).slice(0, 200))
  ok('the cut cell is reported', r1.cutCells === 1, r1.cutCells)
  ok('an empty table still gets its sheet', XLSX.utils.sheet_to_json(wb1.Sheets.empty_table, { header: 1 })[0]?.[0] === '(no rows)')

  // ── a table bigger than a sheet continues on the next one ────────────────
  const f2 = path.join(work, 'rowcap.xlsx')
  const r2 = await exportTablesToFiles({ filePath: f2, tables: ['many'], fetchPage, limits: { maxRowsPerSheet: 20000, pageSize: 7000 } })
  const wb2 = read(f2)
  ok('a table over the row limit continues on many_2, many_3 (20,000 / 20,000 / 5,000 rows)', JSON.stringify(wb2.SheetNames.slice(1)) === JSON.stringify(['many', 'many_2', 'many_3']) && dataRows(wb2, 'many').length === 20000 && dataRows(wb2, 'many_2').length === 20000 && dataRows(wb2, 'many_3').length === 5000, wb2.SheetNames.join(' | '))
  ok('...no row lost or repeated across pages and sheets', totalDataRows(r2.files) === 45000 && dataRows(wb2, 'many_2')[0][0] === 20001 && dataRows(wb2, 'many_3')[4999][0] === 45000)

  // ── a database too big for one workbook becomes several files ────────────
  const f3 = path.join(work, 'parts.xlsx')
  const r3 = await exportTablesToFiles({ filePath: f3, tables, fetchPage, limits: { partCharBudget: 400000, sheetCharBudget: 250000, pageSize: 5000 } })
  ok('a too-big database becomes several files _part1, _part2, ...', r3.files.length > 1 && r3.files.every((f, i) => f === path.join(work, `parts_part${i + 1}.xlsx`) && fs.existsSync(f)), JSON.stringify(r3.files.map(f => path.basename(f))))
  ok('...every file has its own index sheet', r3.files.every(f => read(f).SheetNames[0] === '_Contents'))
  ok('...and together they hold every row exactly once', totalDataRows(r3.files) === totalRows, `${totalDataRows(r3.files)} of ${totalRows}`)

  // ── compressed (SheetJS writes UNcompressed by default: ~60 bytes a cell) ─
  const cells = 45000 * 3
  const perCell = fs.statSync(f2).size / cells
  ok('the file is compressed (well under the ~60 bytes a cell an uncompressed write costs)', perCell < 25, `${perCell.toFixed(1)} bytes per cell`)

  // ── the old failure, in numbers ──────────────────────────────────────────
  let oldFails = false
  try { Array.from(new Uint8Array(150e6)) } catch (e) { oldFails = /Invalid array length/.test(e.message) }
  ok('(the old path\'s call - Array.from over a 150 MB file - really is "Invalid array length")', oldFails)
  const preload = fs.readFileSync(path.join(srcRoot, 'src', 'preload', 'index.js'), 'utf8')
  const settings = fs.readFileSync(path.join(srcRoot, 'src', 'main', 'ipc', 'settings.js'), 'utf8')
  const modal = fs.readFileSync(path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'shared', 'SettingsModal.jsx'), 'utf8')
  ok('the Settings button asks the main process to write the file (no bytes come back to the renderer)', /exportAllTablesToFile/.test(preload) && /db:exportAllTablesToFile/.test(settings) && /exportAllTablesToFile/.test(modal) && !/exportAllTables\(\)/.test(modal))
  const handler = modal.slice(modal.indexOf('handleExportAllTables'), modal.indexOf('handleDownloadFormatReference'))
  ok('...and that button no longer builds the workbook or converts bytes to an array', !/Array\.from\(new Uint8Array/.test(handler) && !/json_to_sheet/.test(handler))

  // ── optional: a workbook far past the old failure point ──────────────────
  if (process.env.FSG_STRESS) {
    const N = 3500000
    const big = { fetch: async (t, offset, limit) => (offset >= N ? [] : Array.from({ length: Math.min(limit, N - offset) }, (_, i) => ({ id: offset + i, a: (offset + i) * 1.5, b: 'row' + ((offset + i) % 997) }))) }
    const f4 = path.join(work, 'stress.xlsx')
    const t0 = Date.now()
    const r4 = await exportTablesToFiles({ filePath: f4, tables: ['big'], fetchPage: big.fetch })
    const size = r4.files.reduce((s, f) => s + fs.statSync(f).size, 0)
    ok(`STRESS: ${N.toLocaleString()} rows x 3 columns (${(N * 3 * 60 / 1e6).toFixed(0)} MB uncompressed-equivalent, past the old ~134 MB failure) written in ${((Date.now() - t0) / 1000).toFixed(0)}s`, r4.rows === N && size > 1e6, `${r4.files.length} file(s), ${(size / 1e6).toFixed(0)} MB`)
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
