/**
 * Pre-release self-test for notes: their numbers, the data saved against them,
 * and the face lines that cite them.
 *
 * Bundles the REAL renderer code with esbuild (useFinancials.js, bsStructure.js,
 * savedNoteData.js, buildExcel.js) and asserts:
 *
 * 1. Note numbering (processRows), for every constitution and both General
 *    Notes positions, on a Proprietorship / Trader Trial Balance shaped like the
 *    live case that broke — stock entered on the Stock tab plus a
 *    Previous-Year-only "Other current liabilities" balance. That combination
 *    used to overwrite the "Changes in inventories" note: the P&L showed Other
 *    current liabilities' number (Note 7) against it and its own note vanished.
 *    Every face line must point at its own note; numbers unique and gap-free.
 * 2. Saved note data (Fill Details, disclosures) follows its note by title after
 *    the numbers shift, and never leaks into the note that inherits a number.
 * 3. Excel: the P&L "Changes in inventories" cell shows that line's own figure
 *    (a formula into the Notes sheet only when it lands on that very note).
 * 4. Company Balance Sheet face: a single "Property, Plant and Equipment and
 *    Intangible assets" note is spread over a(i) Tangible / a(ii) Intangible by
 *    its Level 3 figures (Manual PY included); separate captions land on their
 *    own lines; the a(i)..a(iv) order is unchanged.
 * 5. Excel General Notes sheet: the signature block comes once, after the last
 *    policy (as in the PDF and on every other sheet).
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-notes.mjs
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const esbuild = require(path.join(root, 'node_modules', 'esbuild'))
const src = (...p) => JSON.stringify(path.join(root, 'src', 'renderer', 'src', ...p))

const entry = `
export { processRows, buildPrevMap } from ${src('hooks', 'useFinancials.js')}
export { indexSavedNoteRows, mapSavedRowsToLiveNotes } from ${src('utils', 'savedNoteData.js')}
export { computeCompanyBSLayout } from ${src('utils', 'bsStructure.js')}
export { buildFinancialsWorkbook, buildGeneralNotesSheet } from ${src('components', 'GenerateFinancials', 'buildExcel.js')}
`
const built = await esbuild.build({
  stdin: { contents: entry, resolveDir: root, loader: 'js' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  // xlsx-js-style is CommonJS and requires Node built-ins at load time.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: [{
    name: 'selftest-shims',
    setup(b) {
      b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
      b.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({
        contents: 'const React = { createElement: () => null }; export default React; export const useState = () => []; export const useEffect = () => {}; export const useRef = () => ({}); export const useMemo = (f) => f();',
        loader: 'js',
      }))
      // buildPrevMap is module-private; expose it to this test only.
      b.onLoad({ filter: /useFinancials\.js$/ }, (args) => ({
        contents: fs.readFileSync(args.path, 'utf8') + '\nexport { buildPrevMap }\n',
        loader: 'jsx',
        resolveDir: path.dirname(args.path),
      }))
    },
  }],
})
const tmp = path.join(os.tmpdir(), `fsg-selftest-notes-${process.pid}.mjs`)
fs.writeFileSync(tmp, built.outputFiles[0].text)
let mod
try { mod = await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
const { processRows, buildPrevMap, indexSavedNoteRows, mapSavedRowsToLiveNotes, computeCompanyBSLayout, buildFinancialsWorkbook, buildGeneralNotesSheet } = mod
const XLSX = require(path.join(root, 'node_modules', 'xlsx-js-style'))

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + detail}`)
}
const near = (a, b) => Math.abs((a || 0) - (b || 0)) < 0.01
const canon = (s) => (s || '').trim().toLowerCase()
const hasFigures = (x) => Math.abs(x.total || 0) >= 0.005 || Math.abs(x.prevTotal || 0) >= 0.005

// Sign convention as stored in tb_rows: Dr negative, Cr positive.
const STOCK = { upload_nature: 'Stock Entry', level5_value: 'Stock-in-Trade' }
function row(alie, level1, level2, closing, extra = {}) {
  const name = extra.name || `${level2 || level1} ledger`
  return {
    alie, level1, mapping1_resultant: level1,
    level2: level2 || null, mapping2_resultant: level2 || null,
    level3: extra.level3 || null, mapping3_resultant: extra.level3 || null,
    name, ledger_name: name, ledger_code: '',
    closing_balance: String(closing), opening_balance: String(extra.opening || 0),
    upload_nature: extra.upload_nature || null, level5_value: extra.level5_value || null,
  }
}
const cyRows = () => [
  row('EQUITY AND LIABILITIES', "Owners' Funds", "Owners' Capital Account", 1000000),
  row('EQUITY AND LIABILITIES', 'Current liabilities', 'Trade payables', 3885228.11),
  row('EQUITY AND LIABILITIES', 'Current liabilities', 'Short-term provisions', 8000),
  row('ASSETS', 'Current assets', 'Inventories', -1537303.92, { ...STOCK, level3: 'Closing Stock (BS)', name: 'Closing Stock - BS' }),
  row('ASSETS', 'Current assets', 'Cash and bank balances', -500000),
  row('Income', 'Revenue from operations', 'Sale of products', 106767915),
  row('Income', 'Closing Stock (PL)', 'Closing Stock', 1537303.92, { ...STOCK, level3: 'Closing Stock', name: 'Closing Stock - PL' }),
  row('Expenses', 'Purchases of Stock-in-Trade', null, -105979887),
  row('Expenses', 'Opening Stock (PL)', 'Opening Stock', -892244.69, { ...STOCK, level3: 'Opening Stock', name: 'Opening Stock - PL' }),
  row('Expenses', 'Employee benefits expense', 'Salaries and wages', -180000),
  row('Expenses', 'Other expenses', 'Rent', -407195.53),
]
// Comparative TB (as imported from Tally): the only place Other current
// liabilities has a balance.
const pyRows = () => [
  row('EQUITY AND LIABILITIES', "Owners' Funds", "Owners' Capital Account", 900000),
  row('EQUITY AND LIABILITIES', 'Current liabilities', 'Trade payables', 2302536.9),
  row('EQUITY AND LIABILITIES', 'Current liabilities', 'Other current liabilities', 44240.5),
  row('ASSETS', 'Current assets', 'Inventories', -892244.69, { ...STOCK, level3: 'Closing Stock (BS)', name: 'Closing Stock - BS' }),
  row('Income', 'Revenue from operations', 'Sale of products', 1217675),
  row('Income', 'Closing Stock (PL)', 'Closing Stock', 892244.69, { ...STOCK, level3: 'Closing Stock', name: 'Closing Stock - PL' }),
  row('Expenses', 'Purchases of Stock-in-Trade', null, -1116882),
  row('Expenses', 'Opening Stock (PL)', 'Opening Stock', -741141.15, { ...STOCK, level3: 'Opening Stock', name: 'Opening Stock - PL' }),
  row('Expenses', 'Other expenses', 'Rent', -40220.7),
]

// ── 1. Note numbering ────────────────────────────────────────────────────────
console.log('\nNotes self-test\n\n1. Note numbering')
for (const constitution of [1, 2, 3]) {
  for (const generalNotesMode of [null, 'first', 'last']) {
    const tag = `[constitution ${constitution}, General Notes ${generalNotesMode || 'off'}]`
    let out
    try {
      out = processRows(cyRows(), buildPrevMap(pyRows()), constitution, [], 'Trader', false, false, generalNotesMode)
    } catch (e) {
      ok(`${tag} processRows runs`, false, e.stack)
      continue
    }
    const notes = Object.values(out.notes)
    ok(`${tag} every note is stored under its own number`, Object.entries(out.notes).every(([k, n]) => Number(k) === n.num))
    const nums = notes.map(n => n.num).sort((a, b) => a - b)
    const first = generalNotesMode === 'first' ? 2 : 1
    ok(`${tag} note numbers are unique and gap-free`, nums.every((n, i) => n === first + i), nums.join(','))
    if (generalNotesMode === 'last') {
      const printed = out.activeNotes.map(n => n.num)
      ok(`${tag} General Notes placed last take the number after the last printed note`,
        out.generalNoteNum === Math.max(...printed) + 1, `General Notes ${out.generalNoteNum}, printed notes ${printed.join(',')}`)
    }

    const bad = []
    for (const sec of [...out.incomeSections, ...out.expenseSections]) {
      if (!hasFigures(sec) || /uncategorised/i.test(sec.level1 || '')) continue
      const note = out.notes[sec.noteNum]
      const sharesMaterials = constitution === 1 && /^purchases of stock-in-trade/i.test(sec.level1 || '')
        && /^cost of materials consumed/i.test(note?.title || '')
      if (!note) bad.push(`P&L "${sec.level1}" -> note ${sec.noteNum} (missing)`)
      else if (!note.isPL) bad.push(`P&L "${sec.level1}" -> BS note ${note.num} "${note.title}"`)
      else if (canon(note.title) !== canon(sec.level1) && !sharesMaterials) bad.push(`P&L "${sec.level1}" -> note ${note.num} "${note.title}"`)
    }
    for (const sec of [...out.elSections, ...out.assetSections]) {
      for (const line of sec.lines) {
        if (!line.level2 || !hasFigures(line) || /uncategorised/i.test(line.level2)) continue
        const note = out.notes[line.noteNum]
        if (!note) bad.push(`BS "${line.level2}" -> note ${line.noteNum} (missing)`)
        else if (note.isPL) bad.push(`BS "${line.level2}" -> P&L note ${note.num} "${note.title}"`)
        else if (canon(note.title) !== canon(line.level2)) bad.push(`BS "${line.level2}" -> note ${note.num} "${note.title}"`)
      }
    }
    ok(`${tag} every face line points at its own note`, bad.length === 0, bad.join('; '))

    const changesSec = out.expenseSections.find(s => /changes in inventor/i.test(s.level1 || ''))
    const changesNote = changesSec && out.notes[changesSec.noteNum]
    ok(`${tag} Changes in inventories has its own note under the P&L line's number`,
      !!changesNote && /changes in inventor/i.test(changesNote.title || ''),
      changesSec ? `line says note ${changesSec.noteNum} = "${changesNote?.title}"` : 'no Changes in inventories section')
    ok(`${tag} ...with CY (6,45,059.23) and PY (1,51,103.54)`,
      !!changesNote && near(changesNote.total, -645059.23) && near(changesNote.prevTotal, -151103.54),
      `${changesNote?.total} / ${changesNote?.prevTotal}`)
    ok(`${tag} ...and is listed in activeNotes`, !!changesNote && out.activeNotes.includes(changesNote))
    const oclNote = notes.find(n => canon(n.title) === 'other current liabilities')
    ok(`${tag} Other current liabilities keeps its own note (PY 44,240.50 only)`,
      !!oclNote && near(oclNote.prevTotal, 44240.5) && near(oclNote.total, 0), oclNote ? `${oclNote.total} / ${oclNote.prevTotal}` : 'missing')
  }
}

// ── 2. Saved note data follows its note ──────────────────────────────────────
console.log('\n2. Saved note data follows its note by title')
{
  const saved = [
    { note_num: 6, note_title: 'Trade payables', data: { ageing: 'TP' }, updated_at: '2026-09-01T10:00:00Z' },
    { note_num: 7, note_title: 'Cash and bank balances', data: { cash: 'CB' }, updated_at: '2026-09-01T10:00:00Z' },
    { note_num: 5, note_title: '', data: { legacy: true } },
    { note_num: 9, note_title: 'Share capital', data: { v: 'older' }, updated_at: '2026-08-01T10:00:00Z' },
    { note_num: 3, note_title: 'Share Capital', data: { v: 'newer' }, updated_at: '2026-09-05T10:00:00Z' },
    { note_num: -101, note_title: 'Consolidated Dep (Comp) schedule', data: { dep: 1 } },
  ]
  // Numbers have since shifted.
  const live = [
    { num: 2, title: 'Share capital' },
    { num: 5, title: 'Short-term provisions' },
    { num: 6, title: 'Other current liabilities' },
    { num: 7, title: 'Trade payables' },
    { num: 8, title: 'Cash and bank balances' },
  ]
  const byNum = mapSavedRowsToLiveNotes(saved, live, r => r.data)
  ok('Trade payables data moves with the note to 7', byNum[7]?.ageing === 'TP')
  ok('Cash and bank balances data moves with the note to 8', byNum[8]?.cash === 'CB')
  ok('the note that inherited number 6 gets nothing', byNum[6] === undefined, JSON.stringify(byNum[6]))
  ok('an untitled row saved by an older version still applies at its number', byNum[5]?.legacy === true)
  ok('duplicate saves: the most recent wins, title matched regardless of case', byNum[2]?.v === 'newer')
  ok('reserved consolidated Dep row attaches to no live note', !Object.values(byNum).some(v => v?.dep))
  const lookup = indexSavedNoteRows(saved, r => r.data)
  ok('lookup by note ignores punctuation/spacing in titles', lookup({ num: 99, title: 'Trade  Payables' })?.ageing === 'TP')
}

// ── 3. Excel P&L cell for Changes in inventories ─────────────────────────────
console.log('\n3. Excel: P&L Changes in inventories cell')
{
  try {
    const data = processRows(cyRows(), buildPrevMap(pyRows()), 1, [], 'Trader', false, false, 'first')
    data.levelFormat = []
    data.manualTaxLines = []
    const wb = buildFinancialsWorkbook({
      entity: { name: 'Selftest Proprietor', constitution: 1, constitution_display: 'Proprietorship' },
      activeTB: { id: 1, period: '2025-04-01 To 2026-03-31' },
      prevTB: { id: 2, period: '2024-04-01 To 2025-03-31' },
      data, levelFormat: [], auditor: null, signatories: [],
    })
    const pl = wb.Sheets['Profit & Loss']
    const notesWs = wb.Sheets['Notes']
    const colA = (ws) => {
      const range = XLSX.utils.decode_range(ws['!ref'])
      const out = []
      for (let r = range.s.r; r <= range.e.r; r++) out.push(ws[XLSX.utils.encode_cell({ c: 0, r })]?.v)
      return out
    }
    const plA = colA(pl)
    const r = plA.findIndex(v => /changes in inventor/i.test(String(v || '')))
    ok('P&L sheet has a Changes in inventories line', r >= 0)
    const notesA = colA(notesWs)
    ok('Notes sheet has a "Changes in inventories" note', notesA.some(v => /^Note \d+: Changes in inventor/i.test(String(v || ''))))
    for (const [c, want, label] of [[2, -645059.23, 'CY'], [3, -151103.54, 'PY']]) {
      const cell = pl[XLSX.utils.encode_cell({ c, r })]
      if (cell?.f) {
        const m = /^Notes!([A-Z]+)(\d+)$/.exec(cell.f)
        let heading = null
        for (let i = m ? Number(m[2]) - 1 : -1; i >= 0; i--) {
          if (/^Note \d+: /.test(String(notesA[i] || ''))) { heading = notesA[i]; break }
        }
        ok(`${label} cell links into the Changes in inventories note`, /changes in inventor/i.test(String(heading || '')), `${cell.f} lands under "${heading}"`)
      } else {
        ok(`${label} cell shows the line's own figure`, near(cell?.v, want), String(cell?.v))
      }
    }
  } catch (e) {
    ok('Excel workbook builds', false, e.stack)
  }
}

// ── 4. Company Balance Sheet face: PPE / Intangible assets ───────────────────
console.log('\n4. Company BS face: Property, Plant and Equipment / Intangible assets')
{
  const COMBINED = 'Property, Plant and Equipment and Intangible assets'
  const assetLine = (level2, parts, noteNum, extra = {}) => {
    const rows = parts.map(([l3, cy, py]) => row('ASSETS', 'Non-current assets', level2, -cy, { level3: l3, opening: -py }))
    return {
      level2, noteNum, rows,
      total: parts.reduce((s, p) => s + p[1], 0),
      prevTotal: extra.prevTotal ?? parts.reduce((s, p) => s + p[2], 0),
    }
  }
  const layoutFor = (lines, notes = {}) => computeCompanyBSLayout({
    elSections: [],
    assetSections: [{ level1: 'Non-current assets', lines, total: lines.reduce((s, l) => s + l.total, 0), prevTotal: lines.reduce((s, l) => s + l.prevTotal, 0) }],
    notes,
  })
  // The four PPE lines are (i)-(iv) under the caption (a) since 1 Oct 2026; 'a(i)' below names the first of them.
  const faceLine = (layout, alpha) => layout.assets.groups[0].lines.find(l => l.alpha === alpha.replace(/^a\((.*)\)$/, '$1'))

  // As in the live case: one note, Level 3 split, figures from the ledgers.
  let layout = layoutFor([assetLine(COMBINED, [['Property, plant and equipment', 16071443.87, 4688228], ['Intangible assets', 15504, 18051]], 8)],
    { 8: { num: 8, title: COMBINED, isPL: false } })
  ok('a(i) Tangible carries only Property, plant and equipment', near(faceLine(layout, 'a(i)').total, 16071443.87) && near(faceLine(layout, 'a(i)').prevTotal, 4688228),
    `${faceLine(layout, 'a(i)').total} / ${faceLine(layout, 'a(i)').prevTotal}`)
  ok('a(ii) Intangible carries Intangible assets', near(faceLine(layout, 'a(ii)').total, 15504) && near(faceLine(layout, 'a(ii)').prevTotal, 18051),
    `${faceLine(layout, 'a(ii)').total} / ${faceLine(layout, 'a(ii)').prevTotal}`)
  ok('both cite the one note', faceLine(layout, 'a(i)').noteNum === 8 && faceLine(layout, 'a(ii)').noteNum === 8)
  ok('Non-current assets total is unchanged', near(layout.assets.groups[0].total, 16086947.87), String(layout.assets.groups[0].total))

  // Manual PY: the ledgers carry no opening balance; the note's Level-3 rows do.
  const manualLine = assetLine(COMBINED, [['Property, plant and equipment', 16071443.87, 0], ['Intangible assets', 15504, 0]], 8, { prevTotal: 4706279 })
  layout = layoutFor([manualLine], { 8: { num: 8, title: COMBINED, isPL: false, templateRowsAll: [
    { type: 'l3', label: 'Property, plant and equipment', cy: 16071443.87, py: 4688228 },
    { type: 'option', label: 'Plant and Equipment', cy: 3160368.32, py: 3898321, parentL3: 'Property, plant and equipment' },
    { type: 'l3', label: 'Intangible assets', cy: 15504, py: 18051 },
    { type: 'option', label: 'Computer software', cy: 15504, py: 18051, parentL3: 'Intangible assets' },
  ] } })
  ok('Manual PY: previous year split by the note\'s own Level 3 figures',
    near(faceLine(layout, 'a(i)').prevTotal, 4688228) && near(faceLine(layout, 'a(ii)').prevTotal, 18051),
    `${faceLine(layout, 'a(i)').prevTotal} / ${faceLine(layout, 'a(ii)').prevTotal}`)

  // A Level 3 breakdown that doesn't account for the whole line leaves it whole.
  layout = layoutFor([assetLine(COMBINED, [['Property, plant and equipment', 100, 0], ['Something unrecognised', 50, 0]], 8)])
  ok('unrecognised Level 3 — line left whole, nothing lost', near(faceLine(layout, 'a(i)').total, 150) && near(faceLine(layout, 'a(ii)').total, 0))

  // Descriptive Level 3s never move money between face lines.
  layout = layoutFor([assetLine('Capital work-in-progress', [['Building under construction', 70, 0], ['Intangible assets under development', 30, 0]], 10)])
  ok('CWIP with a descriptive Level 3 stays whole in a(iii)', near(faceLine(layout, 'a(iii)').total, 100) && near(faceLine(layout, 'a(i)').total, 0),
    `a(iii) ${faceLine(layout, 'a(iii)').total}, a(i) ${faceLine(layout, 'a(i)').total}`)
  layout = layoutFor([assetLine(COMBINED, [['Property, Plant & Equipment', 900, 800], ['Capital Work-in-Progress', 100, 0]], 8)])
  ok('caption spelling variants (&, hyphens, case) still split', near(faceLine(layout, 'a(i)').total, 900) && near(faceLine(layout, 'a(iii)').total, 100))

  // Separate captions land on their own face lines.
  layout = layoutFor([
    assetLine('Property, plant and equipment', [['Plant', 500, 400]], 8),
    assetLine('Intangible assets', [['Software', 60, 50]], 9),
    assetLine('Capital work-in-progress', [['Building under construction', 70, 0]], 10),
    assetLine('Intangible assets under development', [['ERP under development', 80, 0]], 11),
  ])
  ok('separate "Intangible assets" -> a(ii), not Tangible', near(faceLine(layout, 'a(ii)').total, 60) && faceLine(layout, 'a(ii)').noteNum === 9)
  ok('"Intangible assets under development" -> a(iv), not a(ii)', near(faceLine(layout, 'a(iv)').total, 80) && faceLine(layout, 'a(iv)').noteNum === 11)
  ok('"Capital work-in-progress" -> a(iii)', near(faceLine(layout, 'a(iii)').total, 70))
  ok('"Property, plant and equipment" -> a(i)', near(faceLine(layout, 'a(i)').total, 500))
  const order = layout.assets.groups[0].lines.map(l => l.alpha).join(',')
  ok('face line order is the caption (a), (i), (ii), (iii), (iv), b, c, d, e', order === 'a,i,ii,iii,iv,b,c,d,e', order)
}

// ── 5. Excel General Notes sheet: signature once, after the last policy ────
console.log('\n5. Excel: General Notes sheet ends with the signature block once')
{
  try {
    // buildGeneralNotesSheet flattens the policies' HTML through the DOM; a
    // minimal stand-in is enough for plain paragraphs.
    globalThis.document = globalThis.document || {
      createElement: () => {
        const el = { childNodes: [] }
        Object.defineProperty(el, 'innerHTML', {
          set(html) {
            el.childNodes = [...String(html).matchAll(/<p>([\s\S]*?)<\/p>/g)].map(m => ({ tagName: 'P', textContent: m[1].replace(/<[^>]+>/g, '') }))
          },
        })
        return el
      },
    }
    const data = {
      generalNoteNum: 1,
      generalNotes: { title: 'Significant Accounting Policies', position: 'first', points: [
        { header: 'Basis of preparation', contentHtml: '<p>The accounts are prepared on the accrual basis.</p>' },
        { header: 'Inventories', contentHtml: '<p>Inventories are valued at lower of cost and net realisable value.</p>' },
      ] },
    }
    const ws = buildGeneralNotesSheet(data, {
      entity: { name: 'Selftest Proprietor', constitution: 1 },
      auditor: { firm_name: 'Selftest & Co.', frn: '000000E', name: 'Auditor Name', designation: 'Partner', membership_number: '000000' },
      signatories: [{ name: 'Proprietor Name', designation: 'Proprietor' }],
      signPlace: 'Siliguri', signDate: '2026-09-13',
    })
    const range = XLSX.utils.decode_range(ws['!ref'])
    const colA = []
    for (let r = range.s.r; r <= range.e.r; r++) colA.push(String(ws[XLSX.utils.encode_cell({ c: 0, r })]?.v ?? ''))
    const sigRows = colA.map((v, i) => (/As per our report of even date/i.test(v) ? i : -1)).filter(i => i >= 0)
    const lastPolicy = colA.findIndex(v => /Inventories are valued/.test(v))
    ok('the signature block appears exactly once', sigRows.length === 1, `${sigRows.length} found`)
    ok('...after the last policy', sigRows.length === 1 && lastPolicy >= 0 && sigRows[0] > lastPolicy, `signature row ${sigRows[0]}, last policy row ${lastPolicy}`)
    ok('...with the auditor and the proprietor', colA.some(v => /For Selftest & Co\./.test(v)) && colA.some(v => /Auditor Name/.test(v)))
  } catch (e) {
    ok('the General Notes sheet builds with a signature block', false, e.stack)
  }
}

console.log(fails ? `\n${fails} check(s) FAILED\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
