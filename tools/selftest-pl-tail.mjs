/**
 * The Statement of Profit and Loss below the expense lines — discontinuing
 * operations, Exceptional and Extraordinary items (1 Oct 2026).
 *
 * Found while walking through Features > Format with the CA:
 *   - Proprietorship / Partnership printed a discontinuing PROFIT as a loss, so
 *     "Profit for the year" disagreed with the profit the Balance Sheet takes;
 *   - Company / LLP folded "Profit for period from discontinuing operations" into
 *     Other expenses (wrong sign), counted "Tax expense of discontinuing operations"
 *     as ordinary tax, showed Extraordinary items as a fixed 0 on the screen and in
 *     Excel, quoted no note number on Exceptional / Extraordinary, and the PDF had no
 *     continuing / discontinuing lines at all;
 *   - the Company Balance Sheet read "(a(i)) Property, Plant and Equipment — Tangible
 *     assets" instead of a caption (a) over (i)-(iv).
 *
 * One ledger of each kind goes through the real engine and every face is checked
 * against the same expected figures and against data.netProfit.
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
const ok = (what, cond, detail = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + String(detail).slice(0, 320)}`) }
const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005
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
  const tmp = path.join(os.tmpdir(), `fsg-selftest-pl-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try { return await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
}

globalThis.window = { api: {} }
const quiet = (fn) => { const keep = console.log; console.log = (...a) => { if (!String(a[0]).startsWith('[notes]')) keep(...a) }; try { return fn() } finally { console.log = keep } }

const fin = await load('src/renderer/src/hooks/useFinancials.js')
const html = await load('src/renderer/src/components/GenerateFinancials/buildHTML.js')
const xl = await load('src/renderer/src/components/GenerateFinancials/buildExcel.js')
const nc = await load('src/renderer/src/utils/plStructureNonCorp.js')

const wb0 = XLSX.readFile(path.join(root, 'Mapping_v2.xlsx'))
const LF_ALL = XLSX.utils.sheet_to_json(wb0.Sheets.LevelFormat, { defval: null }).map((r, i) => ({
  id: i + 1, constitution: parseInt(r['Constitution']), alie: r['ALIE'], level1: r['Level 1'], level2: r['Level 2'], level3: r['Level 3'],
  level4: r['Level 4'], level5: r['Level 5'], level6: r['Level 6'], level7: r['Level 7'], sort_order: i,
}))
const row = (name, lf, closing) => ({ name, ledger_name: name, ledger_code: '', alie: lf.alie, level1: lf.level1, mapping1_resultant: lf.level1,
  level2: lf.level2, mapping2_resultant: lf.level2, level3: lf.level3, mapping3_resultant: lf.level3, level4_value: null, level5_value: null, level6_value: null, level7_value: null,
  closing_balance: String(closing), opening_balance: '0', status: 'user_approved', upload_nature: null, sort_order: lf.sort_order })

console.log('\nStatement of Profit and Loss: Exceptional / Extraordinary items and discontinuing operations')

const KINDS = [['Proprietorship', 1], ['Partnership', 1], ['LLP', 2], ['Company', 3]]
for (const [kind, c] of KINDS) {
  console.log(`\n  ${kind}`)
  const LF = LF_ALL.filter(r => r.constitution === c)
  const lf = (l1, l2) => LF.find(r => new RegExp(l1, 'i').test(r.level1 || '') && (!l2 || new RegExp(l2, 'i').test(r.level2 || '')))
  // Credits are positive, debits negative (a profit is a credit).
  const rows = [
    row('Sales', lf('^revenue from operations', '^sale$'), 1000),
    row('Salary', lf('^employee benefits'), -400),
    row('Exceptional', lf('^exceptional item'), -50),
    ...(lf('^extraordinary item') ? [row('Extraordinary', lf('^extraordinary item'), -20)] : []),   // an LLP has no such line to map to
    row('Income tax', lf('^tax expense:?$', 'current tax'), -60),
    row('Discontinuing profit', lf('profit.*discontinuing'), 100),
    row('Discontinuing tax', lf('tax expense of discontinuing'), -30),
  ]
  const data = quiet(() => fin.processRows(rows, null, c, [], 'Trader', false, false, null, LF, null))
  data.levelFormat = LF
  data.generalNotes = { title: '', points: [] }
  quiet(() => fin.attachNoteExtras(data, [], LF, null, c, null, null, null))
  const display = kind === 'Company' ? 'Company' : kind
  const entity = { id: 1, name: 'PL Test', constitution: c, constitution_display: display, business_type: 'Trader' }
  const docOpts = { entity, activeTB: { id: 1, period: '2025-04-01 To 2026-03-31' }, prevTB: { id: 2, period: '2024-04-01 To 2025-03-31' }, data, auditor: null, signatories: [], noteDetailsMap: {}, noteDisclosureMap: {}, signPlace: '', signDate: '' }

  const EX = lf('^extraordinary item') ? 20 : 0
  const NET = 1000 - 400 - 50 - EX - 60 + 100 - 30, PBT = 1000 - 400 - 50 - EX, CONT = PBT - 60
  ok(`${kind}: the profit the Balance Sheet takes is ${NET} (1000 - 400 - 50${EX ? ' - 20' : ''} - 60 + 100 - 30)`, near(data.netProfit, NET), data.netProfit)

  // The figure printed after a caption, in the PDF text: the caption, an optional note number or
  // "(IX - X)" style reference, then the amount. (A caption that is the start of a longer one — "... (after tax)" —
  // simply doesn't match at that place and the scan moves on.)
  const t0 = text(quiet(() => html.buildFinancialsHTML({ ...docOpts })))
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\/]/g, (ch) => String.fromCharCode(92) + ch)
  const after = (label) => {
    const m = t0.match(new RegExp(esc(label) + String.raw`\s+(?:\([IVX +\-]+\)\s+)?(?:\d{1,2}\s+)?(\(?[\d,]+\.\d{2}\)?)`))
    return m ? parseFloat(m[1].replace(/[(),]/g, '')) * (/^\(/.test(m[1]) ? -1 : 1) : null
  }

  if (c === 1) {
    const lay = nc.computeNonCorpPLLayout(data, display, [])
    const find = (rx) => lay.items.find(i => rx.test(i.label || ''))
    ok(`${kind}: a discontinuing profit prints as a profit (100), its tax 30, after tax 70`,
      near(find(/^Profit\/\(loss\) from discontinuing operations$/)?.cy, 100) && near(find(/^Tax expense of discontinuing operations$/)?.cy, 30) && near(find(/discontinuing operations \(after tax\)/)?.cy, 70),
      lay.items.filter(i => /discontinuing/i.test(i.label || '')).map(i => `${i.label}=${i.cy}`).join(' ; '))
    ok(`${kind}: "Profit/(Loss) for the year" is the profit the Balance Sheet takes (${NET})`, near(find(/^Profit\/\(Loss\) for the year$/)?.cy, NET) && near(lay.netProfit, NET), `${find(/^Profit\/\(Loss\) for the year$/)?.cy} / ${lay.netProfit}`)
    ok(`${kind}: the PDF prints the same`, near(after('Profit/(Loss) for the year'), NET), String(after('Profit/(Loss) for the year')))
    continue
  }

  // Company / LLP
  ok(`${kind}: PDF — Exceptional items 50${EX ? ' and Extraordinary Items 20 (not a fixed 0)' : ''}, quoting their notes`,
    near(after('Exceptional items'), 50) && /Exceptional items \d+ 50\.00/.test(t0) && (!EX || (near(after('Extraordinary Items'), 20) && /Extraordinary Items \d+ 20\.00/.test(t0))), `${after('Exceptional items')} / ${after('Extraordinary Items')}`)
  ok(`${kind}: PDF — profit before tax is ${PBT} and the ordinary tax block holds only the 60`, near(after('Profit / (Loss) before tax'), PBT) && !/Current tax\s+\d*\s*90\.00/.test(t0), String(after('Profit / (Loss) before tax')))
  ok(`${kind}: PDF — continuing operations ${CONT}`, near(after('Profit / (Loss) for the period from continuing operations'), CONT), String(after('Profit / (Loss) for the period from continuing operations')))
  ok(`${kind}: PDF — discontinuing profit 100, its tax 30, after tax 70`,
    near(after('Profit / (loss) from discontinuing operations'), 100) && near(after('Tax expense of discontinuing operations'), 30) && near(after('Profit / (loss) from discontinuing operations (after tax)'), 70),
    `${after('Profit / (loss) from discontinuing operations')} ${after('Tax expense of discontinuing operations')} ${after('Profit / (loss) from discontinuing operations (after tax)')}`)
  ok(`${kind}: PDF — Profit / (Loss) for the period is the profit the Balance Sheet takes (${NET})`, near(after('Profit / (Loss) for the period'), NET), String(after('Profit / (Loss) for the period')))
  const otherExp = (Object.values(data.notes || {}).find(n => /^other expenses/i.test(n.title || '')))
  ok(`${kind}: Other expenses holds none of it`, !otherExp || near(otherExp.total, 0), otherExp && otherExp.total)

  // Excel: the subtotals are live formulas (SUM / + / -), so work them out the way Excel will.
  const wb = quiet(() => xl.buildFinancialsWorkbook({ ...docOpts, levelFormat: LF }))
  const ws = wb.Sheets['Profit & Loss']
  const grid = XLSXS.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const val = (addr, sheet = 'Profit & Loss') => { const cl = wb.Sheets[sheet] && wb.Sheets[sheet][addr]; if (!cl) return 0; return cl.f ? ev(cl.f, sheet) : (typeof cl.v === 'number' ? cl.v : (parseFloat(cl.v) || 0)) }
  const sumOf = (args, sheet) => args.split(',').reduce((sum, part) => {
    const m = part.trim().match(/^(?:(?:'([^']+)'|([A-Za-z_]+))!)?([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/)
    if (!m) return sum
    const sh = m[1] || m[2] || sheet
    for (let r = +m[4]; r <= +(m[6] || m[4]); r++) sum += val(m[3] + r, sh)
    return sum
  }, 0)
  const ev = (f, sheet) => Function('return (' + f
    .replace(/SUM\(([^)]*)\)/g, (_, args) => '(' + sumOf(args, sheet) + ')')
    .replace(/(?:'([^']+)'|([A-Za-z_]+))!([A-Z]+\d+)/g, (_, q, n, a) => '(' + val(a, q || n) + ')')
    .replace(/(?<![A-Za-z!(])\b([A-Z]+\d+)\b/g, (_, a) => '(' + val(a, sheet) + ')') + ')')()
  const cell = (rx) => { const r = grid.findIndex(g => rx.test(String(g[0]))); return r < 0 ? null : val('C' + (r + 1)) }
  ok(`${kind}: Excel — the same figures (Exceptional 50, Extraordinary ${EX}, disc. profit 100, its tax 30, after tax 70, net ${NET})`,
    near(cell(/Exceptional items/), 50) && near(cell(/Extraordinary Items/), EX) && near(cell(/Profit\/\(loss\) from discontinuing operations$/), 100) && near(cell(/Tax expense of discontinuing/), 30)
      && near(cell(/discontinuing operations after tax/i), 70) && near(cell(/Profit \(Loss\) for the period \(/), NET),
    [/Exceptional items/, /Extraordinary Items/, /discontinuing operations$/, /Tax expense of discontinuing/, /discontinuing operations after tax/i, /Profit \(Loss\) for the period \(/].map(r => cell(r)).join(' / '))
}

// ── Company Balance Sheet: (a) caption over (i)-(iv) ───────────────────────
{
  const LF = LF_ALL.filter(r => r.constitution === 3)
  const lf = (l1, l2) => LF.find(r => new RegExp(l1, 'i').test(r.level1 || '') && (!l2 || new RegExp(l2, 'i').test(r.level2 || '')))
  const cashLf = lf('current assets', '^cash and (bank|cash)')
  const rows = [row('Capital', lf('shareholders', 'share capital'), 100), row('Building', lf('non-current assets', '^property'), -90), { ...row('Bank', cashLf, -10), level3: 'Balances with banks', mapping3_resultant: 'Balances with banks' }]
  const data = quiet(() => fin.processRows(rows, null, 3, [], 'Trader', false, false, null, LF, null))
  data.levelFormat = LF; data.generalNotes = { title: '', points: [] }
  quiet(() => fin.attachNoteExtras(data, [], LF, null, 3, null, null, null))
  const entity = { id: 1, name: 'PL Test', constitution: 3, constitution_display: 'Company', business_type: 'Trader' }
  const t = text(quiet(() => html.buildFinancialsHTML({ entity, activeTB: { id: 1, period: '2025-04-01 To 2026-03-31' }, prevTB: null, data, auditor: null, signatories: [], noteDetailsMap: {}, noteDisclosureMap: {}, signPlace: '', signDate: '' })))
  console.log('\n  Company Balance Sheet')
  ok('"(a) Property, Plant and Equipment and Intangible assets" is a caption over (i) to (iv)',
    /\(a\) Property, Plant and Equipment and Intangible assets \(i\) Tangible assets[^(]*\(ii\) Intangible assets[^(]*\(iii\) Capital work-in-progress[^(]*\(iv\) Intangible assets under development/.test(t), (t.match(/\(a\) Property[^]{0,260}/) || [''])[0])
  ok('no "(a(i))" any more', !/\(a\(i+v?\)\)/.test(t))
  const cashNote = Object.values(data.notes || {}).find(n => /^cash and (bank|cash)/i.test(n.title || ''))
  ok('Company: the Cash note prints under the face caption "Cash and cash equivalents"', !!cashNote && /Note \d+: Cash and cash equivalents/.test(t) && !/Note \d+: Cash and bank balances/.test(t), (t.match(/Note \d+: Cash[^N]{0,40}/) || [''])[0])
  ok('... while the note keeps its stored title, so saved Fill Details and Manual PY stay attached', cashNote && /^cash and bank balances$/i.test(cashNote.title), cashNote && cashNote.title)
  ok('each of (i)-(iv) cites the one PPE note', /\(i\) Tangible assets\s+\d+/.test(t) && /\(ii\) Intangible assets\s+\d+/.test(t) && /\(iii\) Capital work-in-progress\s+\d+/.test(t) && /\(iv\) Intangible assets under development\s+\d+/.test(t))
}

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
