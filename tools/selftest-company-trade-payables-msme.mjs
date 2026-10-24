/**
 * Pre-release self-test: on a Company's Balance Sheet face, Current liabilities
 * (b) Trade payables is presented as Schedule III requires —
 *   (A) total outstanding dues of micro enterprises and small enterprises; and
 *   (B) total outstanding dues of creditors other than micro enterprises and
 *       small enterprises
 * — on the BS screen's layout, in the PDF and in Excel, both years, with (A)+(B)
 * equal to Trade payables and the Balance Sheet totals unchanged. Reported
 * missing in the field (27 Sep 2026).
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
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
const ok = (what, cond, detail = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + detail}`) }
const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.01

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
  const tmp = path.join(os.tmpdir(), `fsg-selftest-tpmsme-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try { return await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
}

// Company Level Format from the real workbook.
const wb0 = XLSX.readFile(path.join(root, 'Mapping_v2.xlsx'))
const LF = XLSX.utils.sheet_to_json(wb0.Sheets.LevelFormat, { defval: null }).map((r, i) => ({
  id: i + 1, constitution: parseInt(r['Constitution']), alie: r['ALIE'], level1: r['Level 1'], level2: r['Level 2'], level3: r['Level 3'],
  level4: r['Level 4'], level5: r['Level 5'], level6: r['Level 6'], level7: r['Level 7'], sort_order: i,
})).filter(r => r.constitution === 3)
const lfOf = (rx) => LF.find(r => rx.test(r.level2 || ''))
const row = (name, lf, l3, closing, opening = 0) => ({ name, ledger_name: name, ledger_code: '', alie: lf.alie, level1: lf.level1, mapping1_resultant: lf.level1,
  level2: lf.level2, mapping2_resultant: lf.level2, level3: l3, mapping3_resultant: l3, level4_value: null, level5_value: null, level6_value: null, level7_value: null,
  closing_balance: String(closing), opening_balance: String(opening), status: 'user_approved', upload_nature: null, sort_order: lf.sort_order })
const TP = lfOf(/^trade payables$/i), SC = lfOf(/^share capital$/i), CASH = lfOf(/cash and (cash equivalents|bank)/i)
const cy = () => [
  row('Share Capital', SC, null, 200000),
  row('Micro Supplier Ltd', TP, 'Due to MSME', 30000),
  row('Big Supplier Ltd', TP, 'Due to Creditors other than MSME', 70000),
  row('Bank', CASH, null, -300000),
]
const py = () => [
  row('Share Capital', SC, null, 200000),
  row('Micro Supplier Ltd', TP, 'Due to MSME', 10000),
  row('Big Supplier Ltd', TP, 'Due to Creditors other than MSME', 50000),
  row('Bank', CASH, null, -260000),
]
globalThis.window = { api: {
  getFinancialData: async (id) => (id === 1 ? cy() : id === 2 ? py() : []), getLevelFormat: async () => LF.map(r => ({ ...r })),
  listNoteDetails: async () => [], depGet: async () => null, depITGet: async () => null, depCompGet: async () => null,
  getManualPY: async () => false, listManualPyEntries: async () => [], getPlClosedToCapital: async () => false, getGeneralNotes: async () => null, getEps: async () => null,
} }

console.log('\nCompany Balance Sheet: Trade payables (A) MSME / (B) others')
const fin = await load('src/renderer/src/hooks/useFinancials.js')
const bs = await load('src/renderer/src/utils/bsStructure.js')
const html = await load('src/renderer/src/components/GenerateFinancials/buildHTML.js')
const xl = await load('src/renderer/src/components/GenerateFinancials/buildExcel.js')
const entity = { id: 1, name: 'MSME Test Pvt Ltd', constitution: 3, constitution_display: 'Company', business_type: 'Trader' }
const activeTB = { id: 1, period: '2025-04-01 To 2026-03-31' }, prevTB = { id: 2, period: '2024-04-01 To 2025-03-31' }
const data = await fin.fetchFinancialsData(activeTB, prevTB, entity, null)
const A = /^\(A\) total outstanding dues of micro and small enterprises$/
const B = /^\(B\) total outstanding dues of creditors other than micro and small enterprises$/

const layout = bs.computeCompanyBSLayout(data)
const tp = layout.el.groups.flatMap(g => g.lines).find(l => l.key === 'trade_pay')
const subs = tp?.subLines || []
ok('Trade payables is 1,00,000 / 60,000 (unchanged)', !!tp && near(tp.total, 100000) && near(tp.prevTotal, 60000), tp && `${tp.total} / ${tp.prevTotal}`)
ok('BS layout: (A) MSME 30,000 / 10,000 and (B) others 70,000 / 50,000, in Schedule III wording',
  subs.length === 2 && A.test(subs[0].label) && B.test(subs[1].label) && near(subs[0].total, 30000) && near(subs[0].prevTotal, 10000) && near(subs[1].total, 70000) && near(subs[1].prevTotal, 50000),
  JSON.stringify(subs))
ok('Balance Sheet still balances (3,00,000 / 2,60,000)', near(layout.totalEL, 300000) && near(layout.prevEL, 260000) && near(layout.totalAsset, 300000), `${layout.totalEL} / ${layout.prevEL} vs ${layout.totalAsset}`)

const pdf = html.buildFinancialsHTML({ entity, activeTB, prevTB, data, auditor: null, signatories: [], signPlace: 'X', signDate: '2026-09-27' }).replace(/<template[\s\S]*?<\/template>/g, '')
const face = (pdf.match(/<div class="statement-title">Balance Sheet<\/div>[\s\S]*?<\/table>/) || [''])[0]
const trs = [...face.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1].replace(/<[^>]*>/g, '').trim()))
const tpRow = trs.find(c => /\(b\) Trade Payables/i.test(c[0] || ''))
ok('PDF: (A) / (B) stay in the label column (no spill into the Note column)', !/<td[^>]*colspan[^>]*>\([AB]\) total/.test(face) && /\(A\) total/.test(face))
const aRow = trs.find(c => A.test(c[0] || '')), bRow = trs.find(c => B.test(c[0] || ''))
ok('PDF: "(b) Trade Payables" is a caption with its note number and no amount', !!tpRow && /^\d+$/.test(tpRow[1] || '') && !tpRow[2] && !tpRow[3], JSON.stringify(tpRow))
ok('PDF: (A) 30,000.00 / 10,000.00 and (B) 70,000.00 / 50,000.00', !!aRow && !!bRow && aRow.at(-2) === '30,000.00' && aRow.at(-1) === '10,000.00' && bRow.at(-2) === '70,000.00' && bRow.at(-1) === '50,000.00', JSON.stringify([aRow, bRow]))

const wb = xl.buildFinancialsWorkbook({ entity, activeTB, prevTB, data, levelFormat: LF, auditor: null, signatories: [], signPlace: 'X', signDate: '2026-09-27' })
const ws = wb.Sheets['Balance Sheet']
const grid = XLSXS.utils.sheet_to_json(ws, { header: 1, defval: '' })
const xTp = grid.find(r => /\(b\) Trade Payables/i.test(String(r[0])))
const xA = grid.find(r => A.test(String(r[0]).trim())), xB = grid.find(r => B.test(String(r[0]).trim()))
const xTpIdx = grid.indexOf(xTp)
const cell = (c) => ws[XLSXS.utils.encode_cell({ c, r: xTpIdx })]
const blank = (x) => !x || ((x.v === '' || x.v == null) && !x.f)
ok('Excel: "(b) Trade Payables" is a caption with its note number and no amount or formula (the section SUM counts it once)', !!xTp && String(xTp[1]) !== '' && blank(cell(2)) && blank(cell(3)), JSON.stringify([xTp, cell(2), cell(3)]))
ok('Excel: (A) 30,000 / 10,000 and (B) 70,000 / 50,000', !!xA && !!xB && near(xA[2], 30000) && near(xA[3], 10000) && near(xB[2], 70000) && near(xB[3], 50000), JSON.stringify([xA, xB]))

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
