/**
 * Pre-release self-test: "+ Add PY-only Major Head" works for EVERY Balance Sheet
 * major head in Mapping_v2.xlsx, for every constitution, through the real
 * fetchFinancialsData: the head gets a note, the note is in the Notes list with
 * its Previous Year figure, and the Balance Sheet face line under that note
 * number shows the same figure — one head at a time and all together.
 * Also the shapes a real TB gives that head this year: nil-balance ledgers,
 * ledgers cancelling out, GST ledgers netted onto it. Reported in the field
 * (27 Sep 2026, Proprietorship): Other current liabilities got Note 5 on the
 * face with a blank Previous Year, and the Notes screen skipped Note 5 — its
 * nil-balance ledgers made the head count as present this year.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = process.env.FSG_SRC_ROOT || root
const require = createRequire(pathToFileURL(path.join(root, 'package.json')).href)
const esbuild = require('esbuild')
const XLSX = require('xlsx')

const wb = XLSX.readFile(path.join(root, 'Mapping_v2.xlsx'))
const lfAll = XLSX.utils.sheet_to_json(wb.Sheets.LevelFormat, { defval: null }).map((r, i) => ({
  id: i + 1, constitution: parseInt(r['Constitution']), alie: r['ALIE'], level1: r['Level 1'], level2: r['Level 2'], level3: r['Level 3'],
  level4: r['Level 4'], level5: r['Level 5'], level6: r['Level 6'], level7: r['Level 7'], sort_order: i,
})).filter(r => !isNaN(r.constitution))

const built = await esbuild.build({
  stdin: { contents: `export * from ${JSON.stringify(path.join(srcRoot, 'src/renderer/src/hooks/useFinancials.js'))}\n`, resolveDir: srcRoot, loader: 'js' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  loader: { '.js': 'jsx', '.jsx': 'jsx' }, nodePaths: [path.join(root, 'node_modules')],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: [{ name: 's', setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
    b.onLoad({ filter: /^react$/, namespace: 'shim' }, () => ({ contents: 'const R={createElement:()=>null,useCallback:(f)=>f,useRef:()=>({})};export default R;export const useState=()=>[];export const useEffect=()=>{};export const useRef=()=>({});export const useMemo=(f)=>f();export const useCallback=(f)=>f;', loader: 'js' }))
  } }],
})
const tmp = path.join(os.tmpdir(), `probe-pyonly-${process.pid}.mjs`)
fs.writeFileSync(tmp, built.outputFiles[0].text)
const fin = await import(pathToFileURL(tmp).href)
fs.rmSync(tmp)

const E = 'EQUITY AND LIABILITIES', A = 'ASSETS'
function cyRowsFor(c) {
  const lf = lfAll.filter(r => r.constitution === c)
  const pick = (alie, rx) => lf.find(r => r.alie === alie && rx.test(r.level2 || ''))
  const cap = c === 3 ? pick(E, /^share capital$/i) : pick(E, /capital/i)
  const cash = pick(A, /cash and (bank balances|cash equivalents)/i)
  const row = (name, l, closing) => ({ name, ledger_name: name, alie: l.alie, level1: l.level1, mapping1_resultant: l.level1, level2: l.level2, mapping2_resultant: l.level2,
    level3: l.level3 && !l.level3.includes('/') ? l.level3 : null, mapping3_resultant: l.level3 && !l.level3.includes('/') ? l.level3 : null,
    closing_balance: String(closing), opening_balance: '0', status: 'user_approved', is_deemed_positive: l.alie === A, sort_order: l.sort_order })
  return [row('Capital', cap, 100000), row('Bank', cash, -100000)]
}

let problems = 0
async function runCase(c, titles) {
  const lf = lfAll.filter(r => r.constitution === c)
  const entries = titles.map((t, i) => ({ id: i + 1, note_num: 0, note_title: t, particular_label: '', py_amount: 1000 * (i + 1) + 0.5 }))
  globalThis.window = { api: {
    getFinancialData: async (id) => (id === 1 ? cyRowsFor(c) : []),
    getLevelFormat: async () => lf.map(r => ({ ...r })),
    listNoteDetails: async () => [], depGet: async () => null, depITGet: async () => null, depCompGet: async () => null,
    getManualPY: async () => true, listManualPyEntries: async () => entries,
    getPlClosedToCapital: async () => false, getGeneralNotes: async () => null, getEps: async () => null,
  } }
  const entity = { id: 1, name: 'Probe', constitution: c, business_type: 'Trader' }
  const data = await fin.fetchFinancialsData({ id: 1, period: '2025-04-01 To 2026-03-31' }, null, entity, null)
  const out = []
  for (const [i, t] of titles.entries()) {
    const py = 1000 * (i + 1) + 0.5
    const note = Object.values(data.notes).find(n => (n.title || '').trim().toLowerCase() === t.trim().toLowerCase())
    const listed = !!note && (data.activeNotes || []).includes(note)
    const line = note && [...(data.elSections || []), ...(data.assetSections || [])].flatMap(s => s.lines || []).find(l => l.noteNum === note.num)
    const bad = []
    if (!note) bad.push('no note')
    else {
      if (Math.abs((note.prevTotal || 0) - py) > 0.01) bad.push(`note PY ${note.prevTotal}`)
      if (!listed) bad.push('not in Notes list')
      if (!line) bad.push('no BS face line with its number')
      else if (Math.abs((line.prevTotal || 0) - py) > 0.01) bad.push(`face PY ${line.prevTotal}`)
    }
    if (bad.length) { problems++; out.push(`    ${t}: ${bad.join(', ')}`) }
  }
  return out
}

for (const c of [1, 2, 3]) {
  const titles = [...new Set(lfAll.filter(r => r.constitution === c && [E, A].includes(r.alie) && r.level2).map(r => r.level2))]
    .filter(t => !cyRowsFor(c).some(r => r.level2 === t) && !/^uncategorised/i.test(t))   // Uncategorised heads are not offered
  console.log(`\nConstitution ${c}: ${titles.length} BS major heads`)
  const single = []
  for (const t of titles) single.push(...await runCase(c, [t]))
  console.log(single.length ? `  FAIL  one head at a time:\n${single.join('\n')}` : `  PASS  one head at a time: all ${titles.length} carry their Previous Year to the note, the Notes list and the BS face`)
  const together = await runCase(c, titles)
  console.log(together.length ? `  FAIL  all heads together:\n${together.join('\n')}` : '  PASS  all heads together: the same')
}
console.log('\nWhat a real TB gives the head this year (Proprietorship, Other current liabilities)')
await variants()
console.log(problems ? `\n${problems} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(problems ? 1 : 0)
async function variants() {
  const c = 1, lf = lfAll.filter(r => r.constitution === c)
  const ocl = lf.find(r => r.level2 === 'Other current liabilities' && /statutory/i.test(r.level3 || ''))
  const stla = lf.find(r => r.level2 === 'Short-term loans and advances' && /government/i.test(r.level3 || ''))
  const base = cyRowsFor(c)
  const g = (name, l, closing) => ({ name, ledger_name: name, alie: l.alie, level1: l.level1, mapping1_resultant: l.level1, level2: l.level2, mapping2_resultant: l.level2, level3: l.level3, mapping3_resultant: l.level3, closing_balance: String(closing), opening_balance: '0', status: 'user_approved', is_deemed_positive: l.alie === A, sort_order: l.sort_order })
  const cases = {
    'no GST ledgers': base,
    'GST ledgers netting to 0, mapped to Statutory dues': [...base, g('Output CGST', ocl, 5000), g('Input CGST', ocl, -5000)],
    'GST ledgers netting to 0, mapped to STLA': [...base, g('Output CGST', stla, 5000), g('Input CGST', stla, -5000)],
    'zero-balance GST ledger on STLA': [...base, g('Output CGST', stla, 0)],
    'zero-balance ledger on OCL (non-GST)': [...base, g('Salary Payable', ocl, 0)],
    'non-GST ledgers on OCL cancelling out': [...base, g('Salary Payable', ocl, 5000), g('Salary Advance', ocl, -5000)],
    'OCL ledger: nil closing, opening balance': [...base, { ...g('Old Payable', ocl, 0), opening_balance: '7000' }],
    'OCL with a real CY figure (not PY-only)': [...base, g('Salary Payable', ocl, 9000)],
  }
  for (const [label, rows] of Object.entries(cases)) {
    globalThis.window = { api: {
      getFinancialData: async (id) => (id === 1 ? rows : []), getLevelFormat: async () => lf.map(r => ({ ...r })),
      listNoteDetails: async () => [], depGet: async () => null, depITGet: async () => null, depCompGet: async () => null,
      getManualPY: async () => true, listManualPyEntries: async () => [{ id: 1, note_num: 0, note_title: 'Other current liabilities', particular_label: '', py_amount: 4321 }],
      getPlClosedToCapital: async () => false, getGeneralNotes: async () => null, getEps: async () => null,
    } }
    const d = await fin.fetchFinancialsData({ id: 1, period: 'x' }, null, { id: 1, constitution: c, business_type: 'Trader' }, null)
    const note = Object.values(d.notes).find(n => n.title === 'Other current liabilities')
    const line = note && [...d.elSections, ...d.assetSections].flatMap(s => s.lines).find(l => l.noteNum === note.num)
    const real = /real CY figure/.test(label)
    const good = real ? (!!note && Math.abs((note.prevTotal||0)) < 0.01) : (!!note && Math.abs(note.prevTotal - 4321) < 0.01 && d.activeNotes.includes(note) && Math.abs((line?.prevTotal||0) - 4321) < 0.01)
    if (!good) problems++
    console.log(`  ${good ? 'PASS' : 'FAIL'}  ${label}${real ? ' — a lump sum is not forced onto it' : ': note, Notes list and BS face all carry 4,321'}${good ? '' : `  -- note#${note?.num} PY ${note?.prevTotal} listed ${!!note && d.activeNotes.includes(note)} face ${line?.prevTotal}`}`)
  }
}
