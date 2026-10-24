/**
 * Pre-release self-test: (1) the Trade Receivables ageing table for Proprietorship /
 * Partnership (1) and LLP (2) reaches the Notes data, the PDF, the Excel and the
 * bulk Fill Details workbook -- and Company (3) is left exactly as it was; (2) the
 * export's second PDF (no Index page, no Annexures) is what it says.
 *
 * Runs the real fetchFinancialsData() (mocked window.api), buildFinancialsHTML(),
 * buildFinancialsWorkbook() and buildFillDetailsWorkbook().
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that
 * source to prove they fail there.
 *
 *   node tools/selftest-tr-ageing-and-pdf-variants.mjs
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
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + String(detail).slice(0, 300)}`)
}

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
  const tmp = path.join(os.tmpdir(), `fsg-selftest-trpdf-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try { return await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
}

// ── Fixture ──────────────────────────────────────────────────────────────────
const E = 'EQUITY AND LIABILITIES', A = 'ASSETS', TR = 'Trade receivables'
const LF = [
  { alie: E, level1: "Owners' Funds", level2: "Owners' Capital Account", level3: null },
  { alie: A, level1: 'Current assets', level2: TR, level3: 'Unsecured, considered good' },
  { alie: A, level1: 'Current assets', level2: 'Cash and bank balances', level3: 'Cash on hand' },
  { alie: 'Income', level1: 'Revenue from operations', level2: 'Sale', level3: null },
  { alie: 'Expenses', level1: 'Other expenses', level2: 'Rent', level3: null },
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
const TR_TOTAL = 123456
const rows = () => [
  row('Proprietor', E, "Owners' Funds", "Owners' Capital Account", null, 100000, 90000),
  row('Debtor A', A, 'Current assets', TR, 'Unsecured, considered good', -83456, -70000),
  row('Debtor B', A, 'Current assets', TR, 'Unsecured, considered good', -40000, -30000),
  row('Cash', A, 'Current assets', 'Cash and bank balances', 'Cash on hand', -10000, -5000),
  row('Sales', 'Income', 'Revenue from operations', 'Sale', null, 500000, 400000),
  row('Rent', 'Expenses', 'Other expenses', 'Rent', null, -30000, -25000),
]
const activeTB = { id: 1, period: '2025-04-01 To 2026-03-31' }
const entityOf = (c) => ({ id: 7, name: 'Test Entity', constitution: c, constitution_display: ({ 1: 'Partnership', 2: 'LLP', 3: 'Company' })[c], business_type: 'Trader' })
let SAVED = []
globalThis.window = {
  api: {
    getFinancialData: async (id) => (id === 1 ? rows() : []),
    getLevelFormat: async () => LF.map(r => ({ ...r })),
    listNoteDetails: async () => SAVED,
    depGet: async () => null, depITGet: async () => null, depCompGet: async () => null,
    getManualPY: async () => false, listManualPyEntries: async () => [],
    getPlClosedToCapital: async () => false,
    getGeneralNotes: async () => null,
  },
}

console.log(`\nTrade Receivables ageing (1, 2) and the two-PDF export${srcRoot !== root ? `  (source: ${srcRoot})` : ''}`)

let fin, htmlMod, xl, fdw, saved, util
try {
  fin = await load('src/renderer/src/hooks/useFinancials.js')
  htmlMod = await load('src/renderer/src/components/GenerateFinancials/buildHTML.js')
  xl = await load('src/renderer/src/components/GenerateFinancials/buildExcel.js')
  fdw = await load('src/renderer/src/components/GenerateFinancials/fillDetailsWorkbook.js')
  saved = await load('src/renderer/src/utils/savedNoteData.js')
  util = await load('src/renderer/src/utils/tradeReceivablesNonCorp.js')
} catch (e) { ok('modules load', false, e.message); process.exit(1) }

// ── the shared definition ────────────────────────────────────────────────────
ok('the shared ageing helper exists', !util.__missing && typeof util.ncAgeingResolve === 'function', util.__missing)
if (util.ncAgeingResolve) {
  const d = util.ncAgeingResolve(null, TR_TOTAL)
  ok('untouched: the whole figure defaults to "less than 6 months / Unsecured, considered good"',
    d.isDefault && d.values.lt6.unsecured === TR_TOTAL && d.values.lt6.secured === 0 && d.values.lt6.doubtful === 0 &&
    d.values.gt6.secured === 0 && d.values.gt6.unsecured === 0 && d.values.gt6.doubtful === 0 && d.total === TR_TOTAL, JSON.stringify(d))
  const s = util.ncAgeingResolve({ lt6: { secured: '20000', unsecured: 90000 }, gt6: { doubtful: 13456 } }, TR_TOTAL)
  ok('edited: shows exactly what was saved (strings read as numbers), no default left behind', !s.isDefault && s.values.lt6.secured === 20000 && s.values.lt6.unsecured === 90000 && s.values.gt6.doubtful === 13456 && s.total === TR_TOTAL, JSON.stringify(s))
  const m = util.ncAgeingResolve({ lt6: { unsecured: 100000 }, gt6: {} }, TR_TOTAL)
  ok('a saved table that disagrees with the Trial Balance shows a difference (for the Exception Report)', Math.abs(TR_TOTAL - m.total - 23456) < 0.005, JSON.stringify(m))
  ok('the table applies to Proprietorship / Partnership / LLP Trade receivables only',
    util.isNonCorpTradeReceivables(1, 'Trade receivables') && util.isNonCorpTradeReceivables(2, 'Trade Receivables') &&
    !util.isNonCorpTradeReceivables(3, 'Trade receivables') && !util.isNonCorpTradeReceivables(1, 'Trade payables'))
}

const AMOUNTS_RX = /text-align:right;white-space:nowrap;">([^<]*)<\/td>/g
const parseINR = (t) => { const s = String(t).trim(); if (!s || s === '—' || s === '-') return 0; const n = parseFloat(s.replace(/[(),]/g, '')) || 0; return /^\(.*\)$/.test(s) ? -n : n }
function pdfTable(html) {
  const i = html.indexOf('Ageing of Trade Receivables')
  if (i < 0) return null
  const start = html.lastIndexOf('<table', i)
  const end = html.indexOf('</table>', i) + 8
  const t = html.slice(start, end)
  return { html: t, amounts: [...t.matchAll(AMOUNTS_RX)].map(m => parseINR(m[1])), at: i }
}

const savedRow = (num, ncAgeing) => ({ note_num: num, note_title: 'Trade receivables', data: { ncAgeing } })

for (const cons of [1, 2, 3]) {
  const nonCorp = cons !== 3
  const label = `constitution ${cons} (${entityOf(cons).constitution_display})`
  console.log(`\n  -- ${label} --`)

  for (const variant of ['default', 'edited']) {
    if (cons === 3 && variant === 'edited') continue
    SAVED = []
    let data
    try {
      const probe = await fin.fetchFinancialsData(activeTB, null, entityOf(cons), null)
      const trNote = Object.values(probe.notes).find(n => /trade receivable/i.test(n.title))
      if (variant === 'edited' && trNote) SAVED = [savedRow(trNote.num, { lt6: { secured: 20000, unsecured: 90000, doubtful: 0 }, gt6: { secured: 0, unsecured: 0, doubtful: 13456 } })]
      data = await fin.fetchFinancialsData(activeTB, null, entityOf(cons), null)
    } catch (e) { ok(`${variant}: data builds`, false, e.stack); continue }
    data.manualTaxLines = []
    const notes = (data.activeNotes || Object.values(data.notes)).filter(n => !n.isEmpty)
    const tr = notes.find(n => /trade receivable/i.test(n.title))
    ok(`${variant}: the Trade receivables note exists (total ${TR_TOTAL})`, !!tr && Math.abs(tr.total - TR_TOTAL) < 0.005, tr && tr.total)
    if (!tr) continue
    const noteDetailsMap = saved.mapSavedRowsToLiveNotes(SAVED, notes, saved.parsedNoteData)

    // the note itself
    if (nonCorp) {
      ok(`${variant}: the note carries the table's data (null = default)`, !!tr.ncTradeReceivables && (variant === 'default' ? tr.ncTradeReceivables.saved === null : !!tr.ncTradeReceivables.saved), JSON.stringify(tr.ncTradeReceivables))
    } else {
      ok(`${variant}: Company's note is left alone (no non-corporate table on it)`, tr.ncTradeReceivables === undefined)
    }

    // PDF (full + statements-only)
    const opts = { entity: entityOf(cons), activeTB, prevTB: null, data, auditor: null, signatories: [{ id: 1, name: 'A Partner', designation: 'Partner' }], noteDetailsMap, noteDisclosureMap: {}, signPlace: 'Kolkata', signDate: '2026-09-19' }
    let full = '', bare = ''
    try {
      full = htmlMod.buildFinancialsHTML({ ...opts, includeSigningPage: true })
      bare = htmlMod.buildFinancialsHTML({ ...opts, includeSigningPage: false, includeIndex: false, includeAnnexures: false })
    } catch (e) { ok(`${variant}: the PDF documents build`, false, e.stack); continue }

    const tf = pdfTable(full), tb = pdfTable(bare)
    if (nonCorp) {
      ok(`${variant}: PDF has the table beneath the Trade receivables note`, !!tf && full.indexOf(`Note ${tr.num}: ${tr.title}`) < tf.at, 'no table')
      const want = variant === 'default' ? [0, TR_TOTAL, 0, 0, 0, 0, TR_TOTAL] : [20000, 90000, 0, 0, 0, 13456, TR_TOTAL]
      ok(`${variant}: PDF amounts are ${JSON.stringify(want)} (three categories x two blocks, then Total)`, !!tf && JSON.stringify(tf.amounts) === JSON.stringify(want), tf && JSON.stringify(tf.amounts))
      ok(`${variant}: PDF has both ageing blocks and the three categories, as drawn`, !!tf &&
        tf.html.includes('outstanding for less than 6 months from the date due for receipts') &&
        tf.html.includes('outstanding for more than 6 months from the date due for receipts') &&
        (tf.html.match(/>Secured, considered good</g) || []).length === 2 && (tf.html.match(/>Unsecured, considered good</g) || []).length === 2 &&
        (tf.html.match(/>Doubtful</g) || []).length === 2 && tf.html.includes('>Total<'))
      ok(`${variant}: the statements-only PDF carries the same table`, !!tb && JSON.stringify(tb.amounts) === JSON.stringify(tf?.amounts))
    } else {
      ok(`${variant}: Company's PDF has no non-corporate ageing table`, !tf && !tb)
    }

    if (variant === 'default') {
      // the two documents
      const body = (h) => h.slice(h.indexOf('<body>'))
      ok('the full PDF still has its Index page and its Annexures (defaults unchanged)', body(full).includes('cover-page') && full.includes('Annexures — Ledger Details'))
      ok('the statements-only PDF has NO Index page', !body(bare).includes('cover-page'))
      ok('the statements-only PDF has NO Annexures', !body(bare).includes('Annexures — Ledger Details') && !body(bare).includes('annex-table'))
      const fb = body(full)
      ok('(the marker for the dedicated signing page is real: the full PDF has a "Signatures" page after the Annexures)', fb.indexOf('>Signatures<', fb.indexOf('Annexures — Ledger Details')) > 0)
      ok('the statements-only PDF has NO dedicated signing page (it ends with the last note)', !body(bare).includes('>Signatures<'))
      const iBS = body(bare).indexOf('Balance Sheet'), iPL = body(bare).indexOf('Profit and Loss'), iNotes = body(bare).indexOf('Notes to Financial Statements')
      ok('the statements-only PDF opens on the Balance Sheet, then P&L, then the Notes', iBS >= 0 && iBS < (iPL >= 0 ? iPL : Infinity) && iBS < iNotes, `BS ${iBS} PL ${iPL} Notes ${iNotes}`)
      const escT = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
      const titlesOf = (h) => notes.map(n => h.includes(`Note ${n.num}: ${escT(n.displayTitle || n.title)}`))
      ok('the statements-only PDF has every note', titlesOf(bare).every(Boolean), notes.map(n => n.title).join(' | '))
      const lastNote = notes[notes.length - 1]
      const iLast = bare.lastIndexOf(`Note ${lastNote.num}: ${escT(lastNote.title)}`)
      ok('...and nothing after the last note but the layout script', iLast >= 0 && !/Annexure/i.test(bare.slice(iLast)) && !bare.slice(iLast).includes('cover-page'))
      const again = htmlMod.buildFinancialsHTML({ ...opts, includeSigningPage: true, includeIndex: true, includeAnnexures: true })
      ok('asking for Index and Annexures explicitly gives the same document as the default (nothing else moved)', again === full)
      ok('the statements-only PDF is the full one minus Index, Annexures and signing page: its Balance Sheet, P&L and Notes are byte-identical', (() => {
        const FIRST_PAGE = '<div class="print-page compact-page"'          // the Balance Sheet page
        const fbody = body(full), bbody = body(bare)
        const fCore = fbody.slice(fbody.indexOf(FIRST_PAGE), fbody.lastIndexOf('<div class="flow-section">', fbody.indexOf('Annexures — Ledger Details')))
        const bCore = bbody.slice(bbody.indexOf(FIRST_PAGE), bbody.indexOf('<script>'))
        const norm = (x) => x.replace(/\s+/g, ' ').trim()
        return fCore.length > 500 && norm(fCore) === norm(bCore)
      })())
    }

    // Excel
    let wb = null
    try { wb = xl.buildFinancialsWorkbook({ entity: entityOf(cons), activeTB, prevTB: null, data, levelFormat: LF, auditor: null, signatories: [], noteDetailsMap, signPlace: 'Kolkata', signDate: '2026-09-19' }) }
    catch (e) { ok(`${variant}: the Excel workbook builds`, false, e.stack); continue }
    const ws = wb.Sheets['Notes']
    const range = XLSX.utils.decode_range(ws['!ref'])
    const cellV = (r, c) => ws[XLSX.utils.encode_cell({ r, c })]?.v
    let hdr = -1
    for (let r = range.s.r; r <= range.e.r; r++) if (cellV(r, 0) === 'Ageing of Trade Receivables') { hdr = r; break }
    if (nonCorp) {
      ok(`${variant}: Excel Notes sheet has the ageing table`, hdr >= 0, 'not found')
      if (hdr >= 0) {
        const catRows = []
        let r = hdr + 1, total = null
        for (; r <= range.e.r; r++) {
          const a = String(cellV(r, 0) ?? '')
          if (/^Total$/.test(a)) { total = cellV(r, 2); break }
          if (/^\s+(Secured|Unsecured|Doubtful)/.test(a)) catRows.push({ label: a.trim(), amt: Number(cellV(r, 2)) || 0 })
        }
        const want = variant === 'default' ? [0, TR_TOTAL, 0, 0, 0, 0] : [20000, 90000, 0, 0, 0, 13456]
        ok(`${variant}: Excel category amounts are ${JSON.stringify(want)}`, JSON.stringify(catRows.map(x => x.amt)) === JSON.stringify(want), JSON.stringify(catRows))
        ok(`${variant}: Excel labels are the three categories, twice`, JSON.stringify(catRows.map(x => x.label)) === JSON.stringify(['Secured, considered good', 'Unsecured, considered good', 'Doubtful', 'Secured, considered good', 'Unsecured, considered good', 'Doubtful']), JSON.stringify(catRows.map(x => x.label)))
        ok(`${variant}: Excel Total is ${TR_TOTAL}`, Number(total) === TR_TOTAL, total)
        // both blocks' headings sit above their categories
        const texts = []; for (let rr = hdr; rr < hdr + 12; rr++) texts.push(String(cellV(rr, 0) ?? ''))
        ok(`${variant}: Excel has both ageing headings`, texts.some(t => /less than 6 months/.test(t)) && texts.some(t => /more than 6 months/.test(t)))
      }
    } else {
      ok(`${variant}: Company's Excel has no non-corporate ageing table`, hdr < 0)
    }
  }

  // The Fill Details Excel downloaded from Notes: blank template, filled download, and the upload back
  {
    SAVED = []
    const probe = await fin.fetchFinancialsData(activeTB, null, entityOf(cons), null)
    const trNote = Object.values(probe.notes).find(n => /trade receivable/i.test(n.title))
    const liveNotes = probe.activeNotes || Object.values(probe.notes)
    const sheetRows = (wb) => {
      const name = wb.SheetNames.find(n => /trade receivables ageing/i.test(n))
      return name ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) : null
    }
    const blankWb = fdw.buildFillDetailsWorkbook(liveNotes, new Map(), null, { blank: true, constitution: cons })
    const blank = sheetRows(blankWb)
    ok(`${label}: the blank Fill Details Excel has a Trade Receivables ageing sheet`, !!blank, JSON.stringify(blankWb.SheetNames))
    if (blank) {
      const header = blank[3]
      if (nonCorp) {
        ok(`${label}: its header is the table's own (Ageing of Trade Receivables | Category | Amount)`, JSON.stringify(header.slice(0, 3)) === JSON.stringify(['Ageing of Trade Receivables', 'Category', 'Amount']), JSON.stringify(header))
        const data = blank.slice(4)
        ok(`${label}: six ageing lines (two blocks x three categories) + the Trial Balance reference row, no amounts in the blank template`,
          data.length === 7 && data.slice(0, 6).every(r => r[2] === '') && /less than 6 months/.test(data[0][0]) && /more than 6 months/.test(data[3][0]) &&
          JSON.stringify(data.slice(0, 3).map(r => r[1])) === JSON.stringify(['Secured, considered good', 'Unsecured, considered good', 'Doubtful']), JSON.stringify(data))
      } else {
        ok(`${label}: Company keeps its own Schedule III ageing sheet (Period | Particulars | buckets)`, header[0] === 'Period' && header[1] === 'Particulars' && header.length > 3, JSON.stringify(header))
      }
    }

    if (nonCorp && trNote) {
      // filled download, nothing saved: shows what the app shows (the default)
      const filledDefault = fdw.buildFillDetailsWorkbook(liveNotes, new Map(), null, { constitution: cons })
      const fd = sheetRows(filledDefault)?.slice(4) || []
      ok(`${label}: the FILLED download, nothing saved yet, carries the default (${TR_TOTAL} in less than 6 months / Unsecured) and the TB figure`,
        fd.length === 7 && fd[1][2] === TR_TOTAL && [0, 2, 3, 4, 5].every(k => fd[k][2] === '') && fd[6][2] === TR_TOTAL, JSON.stringify(fd.map(r => r[2])))

      // filled download with saved figures
      const savedNc = { lt6: { secured: 20000, unsecured: 90000, doubtful: 0 }, gt6: { secured: 0, unsecured: 0, doubtful: 13456 } }
      const withSaved = fdw.buildFillDetailsWorkbook(liveNotes, new Map([[trNote.num, { ncAgeing: savedNc, somethingElse: 'kept' }]]), null, { constitution: cons })
      const sv = sheetRows(withSaved)?.slice(4) || []
      ok(`${label}: the FILLED download carries the saved figures`, JSON.stringify(sv.slice(0, 6).map(r => r[2])) === JSON.stringify([20000, 90000, '', '', '', 13456]), JSON.stringify(sv.map(r => r[2])))

      // upload back
      const up = fdw.parseFillDetailsWorkbook(withSaved, { constitution: cons })
      const upNc = up.results.find(r => /trade receivable/i.test(r.noteTitle))?.data?.ncAgeing
      ok(`${label}: uploading that workbook back gives exactly the saved figures`, JSON.stringify(upNc) === JSON.stringify(savedNc), JSON.stringify(upNc))

      // the user edits two cells in Excel and uploads
      const name = withSaved.SheetNames.find(n => /trade receivables ageing/i.test(n))
      const ws = withSaved.Sheets[name]
      ws['C5'] = { t: 'n', v: 33456 }        // less than 6 months / Secured
      ws['C6'] = { t: 'n', v: 76544 }        // less than 6 months / Unsecured
      const up2 = fdw.parseFillDetailsWorkbook(withSaved, { constitution: cons })
      const ed = up2.results.find(r => /trade receivable/i.test(r.noteTitle))?.data?.ncAgeing
      ok(`${label}: figures edited in Excel come back as edited (total still ${TR_TOTAL})`,
        !!ed && ed.lt6.secured === 33456 && ed.lt6.unsecured === 76544 && ed.gt6.doubtful === 13456 && (ed.lt6.secured + ed.lt6.unsecured + ed.lt6.doubtful + ed.gt6.secured + ed.gt6.unsecured + ed.gt6.doubtful) === TR_TOTAL, JSON.stringify(ed))

      // an untouched blank template is "not filled": nothing saved, nothing overwritten
      const upBlank = fdw.parseFillDetailsWorkbook(blankWb, { constitution: cons })
      ok(`${label}: the untouched blank template saves nothing for this note`, !upBlank.results.some(r => /trade receivable/i.test(r.noteTitle)) && upBlank.skippedBlank >= 1, JSON.stringify(upBlank.results.map(r => r.noteTitle)))

      // an untouched default-prefilled download saves the default (what the app was already showing)
      const upDef = fdw.parseFillDetailsWorkbook(filledDefault, { constitution: cons })
      const dn = upDef.results.find(r => /trade receivable/i.test(r.noteTitle))?.data?.ncAgeing
      ok(`${label}: an untouched filled download saves the default figures back`, !!dn && dn.lt6.unsecured === TR_TOTAL && dn.lt6.secured === 0 && dn.gt6.doubtful === 0, JSON.stringify(dn))

      // a Company-format sheet uploaded to a Proprietorship / Partnership / LLP must change nothing
      const companyWb = fdw.buildFillDetailsWorkbook(liveNotes, new Map([[trNote.num, { cy: { undis_good: { less6m: 123456 } }, py: {} }]]), null, { constitution: 3 })
      const upCo = fdw.parseFillDetailsWorkbook(companyWb, { constitution: cons })
      const coRes = upCo.results.find(r => /trade receivable/i.test(r.noteTitle))
      ok(`${label}: a Company-format Trade Receivables sheet uploaded here changes nothing (no ageing figures are invented)`, !coRes || !coRes.data.ncAgeing, JSON.stringify(coRes))
    }
    if (!nonCorp && trNote) {
      const co = fdw.buildFillDetailsWorkbook(liveNotes, new Map([[trNote.num, { cy: { undis_good: { less6m: 123456 } }, py: {}, includeInOutput: true }]]), null, { constitution: 3 })
      const back = fdw.parseFillDetailsWorkbook(co, { constitution: 3 }).results.find(r => /trade receivable/i.test(r.noteTitle))
      ok(`${label}: Company's Trade Receivables sheet still round-trips exactly as before`, back?.data?.cy?.undis_good?.less6m === 123456 && !back.data.ncAgeing, JSON.stringify(back))
    }
  }
}

// Company keeps its own Schedule III ageing, untouched -- and 1 / 2 still ignore stale Company-shaped data
{
  const cy = { undis_good: { less6m: '123456' } }
  for (const cons of [3, 1]) {
    SAVED = []
    const probe = await fin.fetchFinancialsData(activeTB, null, entityOf(cons), null)
    const trNote = Object.values(probe.notes).find(n => /trade receivable/i.test(n.title))
    SAVED = [{ note_num: trNote.num, note_title: 'Trade receivables', data: { cy, py: {} } }]
    const data = await fin.fetchFinancialsData(activeTB, null, entityOf(cons), null)
    data.manualTaxLines = []
    const notes = (data.activeNotes || Object.values(data.notes)).filter(n => !n.isEmpty)
    const noteDetailsMap = saved.mapSavedRowsToLiveNotes(SAVED, notes, saved.parsedNoteData)
    const pdf = htmlMod.buildFinancialsHTML({ entity: entityOf(cons), activeTB, prevTB: null, data, auditor: null, signatories: [], noteDetailsMap, noteDisclosureMap: {}, signPlace: '', signDate: '' })
    const hasCompanySchedule = pdf.includes('Trade Receivables ageing schedule')
    ok(cons === 3 ? "Company: its Schedule III ageing schedule still prints (untouched)" : 'Proprietorship: stale Company-shaped ageing data still does not print', cons === 3 ? hasCompanySchedule : !hasCompanySchedule)
  }
}

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
