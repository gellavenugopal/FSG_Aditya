/**
 * Features > Format > Proprietorship / Partnership / LLP / Company (1 Oct 2026).
 *
 * The blank format — Balance Sheet, Statement of Profit and Loss and every note
 * with its Fill Details tables, no figures — is built from the mapping rules by
 * the same code that builds a real set of financials (utils/blankFormat.js). This
 * checks, for all four constitutions:
 *   - the menu: Features > Format > the four constitutions, wired in App.jsx;
 *   - every note the rules define is laid out, once, and printed in the PDF;
 *   - the Fill Details tables of that constitution print, empty;
 *   - the Excel carries the same, and nothing is NaN / undefined / left unfilled.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = process.env.FSG_SRC_ROOT ? path.resolve(process.env.FSG_SRC_ROOT) : root
const require = createRequire(pathToFileURL(path.join(root, 'package.json')).href)
const esbuild = require('esbuild')
const XLSX = require('xlsx')
const XLSXS = require('xlsx-js-style')

let fails = 0
const ok = (what, cond, detail = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + String(detail).slice(0, 300)}`) }
const text = (h) => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<template[\s\S]*?<\/template>/g, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/\s+/g, ' ')

async function load(rel) {
  const built = await esbuild.build({
    stdin: { contents: `export * from ${JSON.stringify(path.join(srcRoot, ...rel.split('/')))}\n`, resolveDir: srcRoot, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' }, nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [{ name: 's', setup(b) {
      b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
      b.onLoad({ filter: /^react$/, namespace: 'shim' }, () => ({ contents: 'const R={createElement:()=>null,useCallback:(f)=>f,useRef:()=>({})};export default R;export const useState=()=>[];export const useEffect=()=>{};export const useRef=()=>({});export const useMemo=(f)=>f();export const useCallback=(f)=>f;', loader: 'js' }))
    } }],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-fmt-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try { return await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
}

globalThis.window = { api: {} }
// The engine reports data oddities on the console as it builds; this test is about its output.
const quiet = (fn) => { const keep = console.log; console.log = (...a) => { if (!String(a[0]).startsWith('[notes]')) keep(...a) }; try { return fn() } finally { console.log = keep } }

console.log('\nFeatures > Format (blank Balance Sheet, P&L, notes and Fill Details)')

// ── the menu ────────────────────────────────────────────────────────────────
const app = fs.readFileSync(path.join(srcRoot, 'src/renderer/src/App.jsx'), 'utf8')
const nav = fs.readFileSync(path.join(srcRoot, 'src/renderer/src/components/Layout/NavTabs.jsx'), 'utf8')
ok("Features menu lists 'Format'", /'Features':\s*\[[^\]]*'Format'[^\]]*\]/.test(app))
ok('Format lists Proprietorship, Partnership, LLP and Company, in that order',
  /'Format':\s*\[\s*'Format: Proprietorship',\s*'Format: Partnership',\s*'Format: LLP',\s*'Format: Company'\s*\]/.test(app))
ok('each of the four opens the Format screen', ['Proprietorship', 'Partnership', 'LLP', 'Company'].every(k => app.includes(`case 'Format: ${k}':`)) && /<Format\b/.test(app))
ok('the menu opens a second list beside an item that is itself a group', /openSub/.test(nav) && /left-full/.test(nav))

let bf, html, xl
try {
  bf = await load('src/renderer/src/utils/blankFormat.js')
  html = await load('src/renderer/src/components/GenerateFinancials/buildHTML.js')
  xl = await load('src/renderer/src/components/GenerateFinancials/buildExcel.js')
} catch (e) {
  ok('the blank-format module loads', false, e.message)
  console.log(`\n${fails} FAILURE(S) — release aborted\n`)
  process.exit(1)
}

const wb0 = XLSX.readFile(path.join(root, 'Mapping_v2.xlsx'))
const LF_ALL = XLSX.utils.sheet_to_json(wb0.Sheets.LevelFormat, { defval: null }).map((r, i) => ({
  id: i + 1, constitution: parseInt(r['Constitution']), alie: r['ALIE'], level1: r['Level 1'], level2: r['Level 2'], level3: r['Level 3'],
  level4: r['Level 4'], level5: r['Level 5'], level6: r['Level 6'], level7: r['Level 7'], sort_order: i,
}))

// What each constitution's Fill Details must show, empty.
const EXPECT = {
  Company: ['1(a) Details of Share Capital', '1(e) Class of Shares', '1(l) Forfeiture of Shares', 'Details of Long-Term Borrowings', 'Details of Short-Term Borrowings',
    'Trade Payables ageing schedule', 'Trade Receivables ageing schedule', 'Other Details relating to Cash and Bank Balances', 'Details of Amount relating to MSME'],
  Proprietorship: ["Owners' Capital Account", 'Name of Owner', 'Details of Long-Term Borrowings', 'Details of Short-Term Borrowings', 'Other Details relating to Cash and Bank Balances', 'Details of Amount relating to MSME'],
  Partnership: ["Owners' Capital Account", 'Name of Partner', 'Share of profit', 'Details of Long-Term Borrowings', 'Details of Short-Term Borrowings', 'Other Details relating to Cash and Bank Balances', 'Details of Amount relating to MSME'],
  LLP: ['Partners Contribution Account', 'Partners Current Account', 'Name of Partner', 'Details of Long-Term Borrowings', 'Details of Short-Term Borrowings', 'Other Details relating to Cash and Bank Balances', 'Details of Amount relating to MSME'],
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

for (const kind of ['Proprietorship', 'Partnership', 'LLP', 'Company']) {
  console.log(`\n  ${kind}`)
  const k = bf.FORMAT_KINDS[kind]
  const LF = LF_ALL.filter(r => r.constitution === k.constitution)
  const data = quiet(() => bf.blankFormatData(LF, kind))
  const entity = bf.blankFormatEntity(kind)
  const { noteDetailsMap } = bf.blankNoteDetails(kind, data.activeNotes)
  const docOpts = { entity, activeTB: { id: 0, period: bf.FORMAT_PERIOD }, prevTB: { id: 0, period: bf.FORMAT_PREV_PERIOD }, data, auditor: null, signatories: [], noteDetailsMap, noteDisclosureMap: {}, signPlace: '', signDate: '' }
  const pdf = quiet(() => html.buildFinancialsHTML({ ...docOpts, includeAnnexures: false, includeSigningPage: false }))
  const t = text(pdf)

  const titles = data.activeNotes.map(n => n.title)
  ok(`${kind}: the rules lay out a full set of notes (${titles.length})`, titles.length >= 20, titles.length)
  ok(`${kind}: no note is laid out twice`, new Set(titles.map(s => s.toLowerCase())).size === titles.length)
  const nums = data.activeNotes.map(n => n.num)
  ok(`${kind}: every note has a number, none repeated`, nums.every(n => Number.isFinite(n)) && new Set(nums).size === nums.length, nums.join(','))
  ok(`${kind}: the Balance Sheet and the Statement of Profit and Loss are there`, /balance sheet/i.test(t) && /profit (and|&) loss/i.test(t))
  const missing = data.activeNotes.filter(n => !new RegExp(`Note ${n.num}: ${esc(n.displayTitle || n.title)}`, 'i').test(t)).map(n => `${n.num} ${n.title}`)
  ok(`${kind}: every note is printed under its number`, missing.length === 0, missing.join('; '))
  const missingFD = EXPECT[kind].filter(s => !t.includes(s))
  ok(`${kind}: Fill Details tables print, blank`, missingFD.length === 0, 'missing: ' + missingFD.join(' | '))
  ok(`${kind}: no NaN / undefined / [object Object] anywhere`, !/NaN|undefined|\[object/.test(t))
  const figures = (t.match(/\b\d{1,3}(,\d{2})*,\d{3}\.\d{2}\b|\b[1-9]\d*\.\d{2}\b/g) || [])
  ok(`${kind}: no figure anywhere — every amount is a dash`, figures.length === 0, figures.slice(0, 5).join(' '))
  ok(`${kind}: the entity line carries the constitution`, kind === 'Company' || t.includes(`(${k.display})`))
  // The engine's own bookkeeping lines must not appear as if they were part of the statements.
  ok(`${kind}: no catch-all "Uncategorised" line and no internal Opening / Closing Stock (PL) head`, !/Uncategorised|\((PL)\)/.test(t), (t.match(/Uncategorised[^|]{0,40}|\w+ Stock \(PL\)/g) || []).slice(0, 4).join(' ; '))
  const revLines = (Object.values(data.notes || {}).find(n => /^revenue from operations/i.test(n.title || ''))?.lines || []).map(l => (l.level2 || '').trim())
  ok(`${kind}: Revenue from operations shows Sale of Goods and Sale of Services, no bare "Sale"`, revLines.includes('Sale of Goods') && revLines.includes('Sale of Services') && !revLines.includes('Sale'), revLines.join(' | '))
  const faceNums = [...(data.elSections || []), ...(data.assetSections || []), ...(data.incomeSections || []), ...(data.expenseSections || [])]
    .flatMap(sec => [sec.noteNum, ...(sec.lines || []).map(l => l.noteNum)]).filter(n => Number.isFinite(n))
  const unprinted = [...new Set(faceNums)].filter(n => !nums.includes(n))
  ok(`${kind}: every note number the statements quote is a note that is printed`, unprinted.length === 0, unprinted.join(','))
  const remun = /partners' remuneration/i.test(t)
  const noRemun = kind === 'Proprietorship' || kind === 'LLP'
  ok(`${kind}: ${noRemun ? "no Partners' remuneration line or note" : kind === 'Partnership' ? "Partners' remuneration is there" : "(Company: no partners' remuneration either way)"}`, noRemun ? !remun : (kind === 'Company' ? true : remun))
  if (kind !== 'Company') ok(`${kind}: the Trade receivables ageing table says whose it is when it starts a page`, /data-flow-contd-title="Note \d+: Trade receivables"/.test(pdf))

  const wb = quiet(() => xl.buildFinancialsWorkbook({ ...docOpts, levelFormat: LF }))
  ok(`${kind}: Excel has Balance Sheet, Profit & Loss and Notes sheets`, ['Balance Sheet', 'Profit & Loss', 'Notes'].every(n => wb.SheetNames.includes(n)), wb.SheetNames.join(','))
  const grid = XLSXS.utils.sheet_to_json(wb.Sheets['Notes'], { header: 1, defval: '' })
  const flat = grid.map(r => r.join(' ')).join(' | ').replace(/\s+/g, ' ')
  const missingX = EXPECT[kind].filter(s => !flat.includes(s.replace(/^(\d+)\((\w)\) /, '$1($2) ')))
  ok(`${kind}: Excel notes carry the same Fill Details tables`, missingX.length === 0, 'missing: ' + missingX.join(' | '))
  ok(`${kind}: Excel has no NaN / undefined`, !/NaN|undefined|\[object/.test(flat))
}

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
