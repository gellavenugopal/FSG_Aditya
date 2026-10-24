/**
 * Pre-release self-test: the tax on the P&L face -- in the REAL PDF builder and the REAL
 * Excel builder -- for every constitution.
 *
 * Reported live (Lifestyle Mobile Pvt Ltd, a Company): the PDF's P&L face printed the empty
 * "(1) Current tax - - / (2) Deferred tax - -" placeholders and "Profit for the period"
 * equalled "Profit before tax", while Note 23 (Tax expense: Current tax 1,75,219.96) and
 * Note 2 (Reserves and surplus: surplus = profit before tax LESS that tax) had it. Only
 * Company's caption is "Tax expense:" (trailing colon); buildHTML.js's dynamic P&L matched
 * /^tax expense$/i against the raw caption, found no Tax section, and fell back to the
 * placeholders. selftest-tax-expense-manualpy.mjs had missed it because it re-implemented
 * the face's row-picking itself; THIS test reads what the builders actually print.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source to
 * prove they fail there.
 *
 *   node tools/selftest-tax-face-renderers.mjs
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
const XLSX = require(path.join(root, 'node_modules', 'xlsx-js-style'))

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + String(detail).slice(0, 320)}`)
}
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.006

const REACT_SHIM = 'const React = { createElement: () => null, useCallback: (f) => f }; export default React; export const useState = () => []; export const useEffect = () => {}; export const useRef = () => ({}); export const useMemo = (f) => f(); export const useCallback = (f) => f;'
async function load(rel) {
  const file = path.join(srcRoot, ...rel.split('/'))
  if (!fs.existsSync(file)) return { __missing: `${rel} does not exist` }
  const built = await esbuild.build({
    stdin: { contents: `export * from ${JSON.stringify(file)}\n`, resolveDir: srcRoot, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [{
      name: 'shims',
      setup(b) {
        b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
        b.onLoad({ filter: /^react$/, namespace: 'shim' }, () => ({ contents: REACT_SHIM, loader: 'js' }))
      },
    }],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-taxface-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try { return await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
}

// ── Fixture: profit before tax 4,70,000 (PY 3,75,000); current tax 1,75,219.96 (PY 10,000) ──
const E = 'EQUITY AND LIABILITIES'
const CAPTION = { 1: 'Tax expense', 2: 'Tax expense', 3: 'Tax expense:' }        // exactly as Mapping_v2.xlsx spells them
const NAME = { 1: 'Partnership', 2: 'LLP', 3: 'Company' }
const LF = (c) => [
  { alie: 'Income', level1: 'Revenue from operations', level2: 'Sale', level3: null },
  { alie: 'Expenses', level1: 'Other expenses', level2: 'Rent', level3: null },
  { alie: 'Expenses', level1: CAPTION[c], level2: 'Current tax', level3: null },
  { alie: 'Expenses', level1: CAPTION[c], level2: 'Deferred tax', level3: null },
]
function row(name, alie, level1, level2, level3, closing, opening = 0) {
  return {
    name, ledger_name: name, ledger_code: '', alie,
    level1, mapping1_resultant: level1, level2: level2 || null, mapping2_resultant: level2 || null,
    level3: level3 || null, mapping3_resultant: level3 || null,
    level4_value: null, level5_value: null, level6_value: null, level7_value: null,
    closing_balance: String(closing), opening_balance: String(opening),
    status: 'user_approved', upload_nature: null, sort_order: null,
  }
}
const CY_TAX = 175219.96, PY_TAX = 10000
const PBT_CY = 470000, PBT_PY = 375000
const rowsFor = (c, withTaxLedger) => [
  row('Sales', 'Income', 'Revenue from operations', 'Sale', null, 500000, 400000),
  row('Rent', 'Expenses', 'Other expenses', 'Rent', null, -30000, -25000),
  ...(withTaxLedger ? [row('Income Tax Provision', 'Expenses', CAPTION[c], 'Current tax', null, -CY_TAX, -PY_TAX)] : []),
]
const activeTB = { id: 1, period: '2025-04-01 To 2026-03-31' }
const entityOf = (c) => ({ id: 7, name: 'Test Entity', constitution: c, constitution_display: NAME[c], business_type: 'Trader' })
let CUR = { c: 3, ledger: true, py: [] }
globalThis.window = {
  api: {
    getFinancialData: async (id) => (id === 1 ? rowsFor(CUR.c, CUR.ledger) : []),
    getLevelFormat: async () => LF(CUR.c).map(r => ({ ...r })),
    listNoteDetails: async () => [],
    depGet: async () => null, depITGet: async () => null, depCompGet: async () => null,
    getManualPY: async () => CUR.py.length > 0, listManualPyEntries: async () => CUR.py,
    getPlClosedToCapital: async () => false,
    getGeneralNotes: async () => null,
  },
}

console.log(`\nTax on the P&L face, in the real PDF and Excel builders${srcRoot !== root ? `  (source: ${srcRoot})` : ''}`)

let fin, htmlMod, xl
try {
  fin = await load('src/renderer/src/hooks/useFinancials.js')
  htmlMod = await load('src/renderer/src/components/GenerateFinancials/buildHTML.js')
  xl = await load('src/renderer/src/components/GenerateFinancials/buildExcel.js')
} catch (e) { ok('modules load', false, e.message); process.exit(1) }

const decode = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
const parseINR = (t) => { const s = decode(t); if (!s || s === '—' || s === '-') return 0; const n = parseFloat(s.replace(/[(),]/g, '')) || 0; return /^\(.*\)$/.test(s) ? -n : n }

// The P&L page of the PDF: the page after the Balance Sheet, up to the Notes.
function plRows(html) {
  const body = html.slice(html.indexOf('<body>'))
  const first = body.indexOf('class="print-page compact-page"')
  const second = body.indexOf('class="print-page compact-page"', first + 10)
  const end = body.indexOf('<div class="flow-section">', second)
  const page = body.slice(second, end > 0 ? end : undefined)
  return [...page.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(x => decode(x[1]))).filter(r => r.length >= 2)
}
const lastNums = (r) => ({ cy: parseINR(r[r.length - 2]), py: parseINR(r[r.length - 1]) })
const findRow = (rows, rx) => rows.find(r => rx.test(r[0] || ''))
const findLastRow = (rows, rx) => [...rows].reverse().find(r => rx.test(r[0] || ''))

for (const c of [1, 2, 3]) {
  console.log(`\n  -- constitution ${c} (${NAME[c]}, caption "${CAPTION[c]}") --`)

  // ── A. Current Year tax comes from a Trial Balance ledger ──────────────────
  CUR = { c, ledger: true, py: [] }
  const data = await fin.fetchFinancialsData(activeTB, null, entityOf(c), null)
  data.manualTaxLines = []
  const noteNotes = Object.values(data.notes)
  const taxNote = noteNotes.find(n => /^tax expense/i.test(n.title || ''))
  ok('A: the data itself has the tax (a Tax expense note with the current tax; net profit is after it)', !!taxNote && near(taxNote.total, CY_TAX) && near(data.netProfit, PBT_CY - CY_TAX), `note ${JSON.stringify(taxNote && taxNote.total)} netProfit ${data.netProfit}`)
  const opts = { entity: entityOf(c), activeTB, prevTB: null, data, auditor: null, signatories: [], noteDetailsMap: {}, noteDisclosureMap: {}, signPlace: '', signDate: '' }
  const html = htmlMod.buildFinancialsHTML(opts)
  const rows = plRows(html)
  const cur = findRow(rows, /current tax/i)
  ok('A: PDF P&L face shows a Current tax row', !!cur, JSON.stringify(rows.map(r => r[0]).filter(x => /tax|profit/i.test(x))))
  ok(`A: ...with the current tax (${CY_TAX}) in the Current Year column`, !!cur && near(lastNums(cur).cy, CY_TAX), cur && JSON.stringify(cur))
  ok('A: ...and its Previous Year (10,000)', !!cur && near(lastNums(cur).py, PY_TAX), cur && JSON.stringify(cur))
  ok('A: PDF P&L does not fall back to the empty "(1) Current tax / (2) Deferred tax" placeholders', !rows.some(r => /^\(1\) current tax/i.test(r[0] || '')), JSON.stringify(rows.map(r => r[0]).filter(x => /tax/i.test(x))))
  const pat = findLastRow(rows, /for the (period|year)/i)
  ok(`A: PDF "Profit for the period/year" is AFTER the tax (${PBT_CY - CY_TAX}), the same figure Reserves and surplus / capital take`, !!pat && near(lastNums(pat).cy, PBT_CY - CY_TAX) && near(lastNums(pat).cy, data.netProfit), pat && JSON.stringify(pat))
  ok(`A: ...and for the Previous Year (${PBT_PY - PY_TAX})`, !!pat && near(lastNums(pat).py, PBT_PY - PY_TAX), pat && JSON.stringify(pat))

  // Excel
  let wb = null
  try { wb = xl.buildFinancialsWorkbook({ entity: entityOf(c), activeTB, prevTB: null, data, levelFormat: LF(c), auditor: null, signatories: [], noteDetailsMap: {}, signPlace: '', signDate: '' }) }
  catch (e) { ok('A: the Excel workbook builds', false, e.stack) }
  if (wb) {
    const plName = wb.SheetNames.find(n => /^(p&l|pl|profit)/i.test(n)) || wb.SheetNames.find(n => /loss/i.test(n))
    const aoa = plName ? XLSX.utils.sheet_to_json(wb.Sheets[plName], { header: 1, defval: '' }) : []
    const evalCell = workbookEvaluator(wb)          // its formulas, worked out the way Excel works them out
    const at = (rx, from = 0, last = false) => { const idx = aoa.map((r, i) => (rx.test(String(r[0] || '')) ? i : -1)).filter(i => i >= from); return idx.length ? (last ? idx[idx.length - 1] : idx[0]) : -1 }
    const iCur = at(/current tax/i)
    ok('A: Excel P&L has the Current tax row with the figure (current and previous year)', iCur >= 0 && near(evalCell(plName, `C${iCur + 1}`), CY_TAX) && near(evalCell(plName, `D${iCur + 1}`), PY_TAX), `sheet ${plName}: row ${iCur} ${iCur >= 0 ? JSON.stringify(aoa[iCur]) : ''}`)
    const iPat = at(/for the (period|year)/i, 0, true)
    ok(`A: Excel "Profit for the period/year" is after the tax (${PBT_CY - CY_TAX})`, iPat >= 0 && near(evalCell(plName, `C${iPat + 1}`), PBT_CY - CY_TAX), `row ${iPat} ${iPat >= 0 ? JSON.stringify(aoa[iPat]) + ' = ' + evalCell(plName, `C${iPat + 1}`) : ''}`)
  }

  // ── B. Previous Year only: entered through "+ Add PY-only Major Head" on Tax expense ──
  CUR = { c, ledger: false, py: [{ note_num: 0, note_title: CAPTION[c], particular_label: '', py_amount: 45000, is_custom: false }] }
  const data2 = await fin.fetchFinancialsData(activeTB, null, entityOf(c), null)
  data2.manualTaxLines = []
  const rows2 = plRows(htmlMod.buildFinancialsHTML({ ...opts, data: data2 }))
  const cur2 = findRow(rows2, /current tax/i)
  ok('B: PY-only Tax expense figure (45,000) appears on the PDF P&L face as Current tax, Previous Year', !!cur2 && near(lastNums(cur2).py, 45000) && near(lastNums(cur2).cy, 0), cur2 ? JSON.stringify(cur2) : JSON.stringify(rows2.map(r => r[0]).filter(x => /tax/i.test(x))))
  const pat2 = findLastRow(rows2, /for the (period|year)/i)
  // Manual PY mode: every Previous Year figure comes ONLY from the manual entries (none for Sales / Rent here), so the year's result is just this tax.
  ok('B: ...and Previous Year profit after tax carries it (0 - 45,000)', !!pat2 && near(lastNums(pat2).py, -45000), pat2 && JSON.stringify(pat2))
}

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)

// Evaluates the formula shapes buildExcel.js writes (cell and cross-sheet references, ranges,
// SUM, + - * /, unary minus), the way Excel would.
function workbookEvaluator(book) {
  const memo = new Map()
  const value = (sheet, addr) => {
    const key = `${sheet}!${addr}`
    if (memo.has(key)) return memo.get(key)
    memo.set(key, 0)
    const cell = book?.Sheets?.[sheet]?.[addr]
    const v = !cell ? 0 : cell.f ? evalFormula(cell.f, sheet) : (typeof cell.v === 'number' ? cell.v : 0)
    memo.set(key, v)
    return v
  }
  const tokenize = (src) => {
    const out = []
    let i = 0
    while (i < src.length) {
      const rest = src.slice(i)
      let m
      if (rest[0] === ' ') { i++; continue }
      if ('+-*/(),:'.includes(rest[0])) { out.push({ t: rest[0] }); i++; continue }
      if ((m = /^'([^']+)'!\$?([A-Z]{1,3})\$?(\d+)/.exec(rest)) || (m = /^([A-Za-z_][A-Za-z0-9_]*)!\$?([A-Z]{1,3})\$?(\d+)/.exec(rest))) {
        out.push({ t: 'ref', sheet: m[1], col: m[2], row: Number(m[3]) }); i += m[0].length; continue
      }
      if ((m = /^([A-Z]+)\(/.exec(rest))) { out.push({ t: 'fn', name: m[1] }); i += m[1].length; continue }
      if ((m = /^\$?([A-Z]{1,3})\$?(\d+)/.exec(rest))) { out.push({ t: 'ref', sheet: null, col: m[1], row: Number(m[2]) }); i += m[0].length; continue }
      if ((m = /^\d+(\.\d+)?/.exec(rest))) { out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue }
      throw new Error(`cannot read formula "${src}" at "${rest}"`)
    }
    return out
  }
  function evalFormula(formula, sheet) {
    const tokens = tokenize(String(formula).replace(/^=/, ''))
    let p = 0
    const peek = () => tokens[p]
    const next = () => tokens[p++]
    const rangeSum = (a, b) => {
      let s = 0
      const c0 = XLSX.utils.decode_col(a.col), c1 = XLSX.utils.decode_col(b.col)
      for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
        for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) s += value(a.sheet || sheet, `${XLSX.utils.encode_col(c)}${r}`)
      }
      return s
    }
    const factor = () => {
      const tk = next()
      if (!tk) throw new Error(`unexpected end of "${formula}"`)
      if (tk.t === '-') return -factor()
      if (tk.t === '+') return factor()
      if (tk.t === 'num') return tk.v
      if (tk.t === '(') { const v = expr(); next(); return v }
      if (tk.t === 'ref') {
        if (peek()?.t === ':') { next(); return rangeSum(tk, next()) }
        return value(tk.sheet || sheet, `${tk.col}${tk.row}`)
      }
      if (tk.t === 'fn') {
        if (tk.name !== 'SUM') throw new Error(`unsupported function ${tk.name} in "${formula}"`)
        next()
        let total = 0
        if (peek()?.t !== ')') {
          for (;;) {
            total += expr()
            if (peek()?.t === ',') { next(); continue }
            break
          }
        }
        next()
        return total
      }
      throw new Error(`unexpected "${tk.t}" in "${formula}"`)
    }
    const term = () => { let v = factor(); while (peek() && (peek().t === '*' || peek().t === '/')) { const op = next().t; const r = factor(); v = op === '*' ? v * r : v / r } return v }
    const expr = () => { let v = term(); while (peek() && (peek().t === '+' || peek().t === '-')) { const op = next().t; const r = term(); v = op === '+' ? v + r : v - r } return v }
    return expr()
  }
  return value
}
