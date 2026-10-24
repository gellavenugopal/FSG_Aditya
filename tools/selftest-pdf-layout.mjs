/**
 * Pre-release self-test for the PDF layout: buildHTML.js and the page layout
 * script it injects (flowLayoutScript), printed in a real Electron window with
 * the same printToPDF options as src/main/ipc/financials.js.
 *
 * Two documents shaped like the cases that broke:
 *   - a Proprietorship with General Notes holding a 40-row table resized wider
 *     than the page (it used to shrink the WHOLE PDF to ~67%), Owners' Capital
 *     Fill Details, 70 expense heads and a 150-ledger annexure;
 *   - a Company with three directors in the signature footer (it overflowed
 *     the page slightly, shrinking the PDF to ~98%), General Notes placed LAST
 *     whose last policy is a bulleted list of two long items (a real policy of
 *     that shape once printed overfull), Share Capital Fill Details listing 60
 *     promoters, and an 11-column depreciation schedule.
 * Asserts, for both:
 *   - all text is at least 10pt, except inside Fill Details / schedule tables
 *     (the CA's rule) — including the Balance Sheet and P&L faces, which must
 *     still fit on one page each
 *   - Fill Details tables print at 10pt too, smaller only when the table is
 *     too wide for the page at the next size up
 *   - no empty "()" item labels
 *   - no page is wider than the paper (so Chromium never shrinks the PDF)
 *   - every Notes / Annexures page but the last of its run is at least 60%
 *     full (General Notes are a run of their own)
 *   - General Notes have pages of their own: placed first, the numbered notes
 *     start on the next page; placed last, they start on the page after the
 *     last note and carry the next number
 *   - the signature block comes once, right after the last policy (never on a
 *     page of its own), and on no other Notes / Annexures page
 *   - a block is split across pages only when it is taller than a page, or
 *     moving it whole would leave more than a quarter of the page blank
 *   - a table longer than the page continues overleaf under its header row
 *   - the PDF has exactly one sheet per laid-out page (nothing spills over)
 *   - every ledger / row is printed exactly once, and every "Carried forward"
 *     figure reappears as the next page's "Brought forward"
 *
 * Two small documents — a proprietorship with General Notes first and a company
 * with them last — whose notes would all fit on one page, so General Notes
 * sharing a page with a numbered note cannot go unnoticed.
 *
 * And a last document — the same stylesheet and page script around blocks of
 * known height — pins the keep-together rule (a short note that does not fit
 * the foot of a nearly full page moves overleaf whole; a long one starts in
 * the room left and continues overleaf), the trailer rule (a closing signature
 * block that does not fit takes the paragraph before it along, instead of going
 * overleaf on its own), list breaking (a list longer than the page breaks
 * between its items, numbering carried on) and the no-overflow fallback (when
 * nothing before the signature can break, the signature goes overleaf rather
 * than the page printing overfull).
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-pdf-layout.mjs
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const esbuild = require(path.join(root, 'node_modules', 'esbuild'))
const electronBin = require(path.join(root, 'node_modules', 'electron'))
const src = (...p) => JSON.stringify(path.join(root, 'src', 'renderer', 'src', ...p))

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-selftest-pdf-'))
let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + detail}`)
}

try {
  const built = await esbuild.build({
    stdin: {
      contents: `export { buildFinancialsHTML } from ${src('components', 'GenerateFinancials', 'buildHTML.js')}\nexport { processRows } from ${src('hooks', 'useFinancials.js')}\n`,
      resolveDir: root, loader: 'js',
    },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    plugins: [{
      name: 'react-shim',
      setup(b) {
        b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'shim' }))
        b.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({
          contents: 'const React = { createElement: () => null }; export default React; export const useState = () => []; export const useEffect = () => {}; export const useRef = () => ({}); export const useMemo = (f) => f();',
          loader: 'js',
        }))
      },
    }],
  })
  const bundleFile = path.join(work, 'bundle.mjs')
  fs.writeFileSync(bundleFile, built.outputFiles[0].text)
  const { buildFinancialsHTML, processRows } = await import(pathToFileURL(bundleFile).href)

  const row = (alie, level1, level2, level3, closing, name) => ({
    alie, level1, mapping1_resultant: level1, level2, mapping2_resultant: level2, level3, mapping3_resultant: level3,
    name, ledger_name: name, ledger_code: '', closing_balance: String(closing), opening_balance: '0',
  })
  const amt = (i, base) => Math.round((base + ((i * 7919) % 1000) * 137.31) * 100) / 100
  const pad = (n, w) => String(n).padStart(w, '0')
  function tb(isCo) {
    const EL = 'EQUITY AND LIABILITIES', AS = 'ASSETS', r = []
    r.push(isCo
      ? row(EL, "Shareholders' funds", 'Share capital', 'Equity share capital', 10000000, 'Equity Share Capital')
      : row(EL, "Owners' Funds", "Owners' Capital Account", 'Capital', 5361029.83, 'Capital Account'))
    for (let i = 1; i <= 40; i++) r.push(row(EL, 'Current liabilities', 'Trade payables', 'Due to Creditors other than MSME', amt(i, 5000), `Creditor ${pad(i, 3)} Traders`))
    r.push(row(AS, 'Non-current assets', 'Property, plant and equipment', 'Machinery & Plant', -804712.18, 'Machinery'))
    for (let i = 1; i <= 150; i++) r.push(row(AS, 'Current assets', 'Trade receivables', 'Unsecured, considered good', -amt(i, 3000), `Debtor ${pad(i, 3)} Enterprises Private Limited`))
    for (let i = 1; i <= 25; i++) r.push(row(AS, 'Current assets', 'Other current assets', 'Advance to Suppliers', -amt(i, 2000), `Supplier Advance ${pad(i, 2)}`))
    r.push(row('Income', 'Revenue from operations', 'Sale of products', null, 61874915, 'Sales'))
    r.push(row('Expenses', 'Employee benefits expense', 'Salaries and wages', null, -1800000, 'Salary'))
    for (let i = 1; i <= 70; i++) r.push(row('Expenses', 'Other expenses', `Expense head ${pad(i, 2)}`, null, -amt(i, 1000), `Expense ledger ${pad(i, 3)}`))
    return r
  }
  const para = '<p>The financial statements have been prepared as per mercantile method in accordance with the generally accepted accounting principles; unless specifically stated to be otherwise, and all expenses and incomes to the extent considered payable and receivable respectively are accounted for on accrual basis.</p>'
  // A related-party table as TipTap saves it after its columns were resized on
  // a wide screen: header cells in the first body row, pixel widths.
  const resizedTable = '<table style="width: 1180px"><colgroup><col style="width: 90px"><col style="width: 420px"><col style="width: 330px"><col style="width: 340px"></colgroup><tbody>' +
    '<tr><th colwidth="90"><p>Sl. No.</p></th><th colwidth="420"><p>Name of the Related Party</p></th><th colwidth="330"><p>Relationship</p></th><th colwidth="340"><p>Value of Transaction (Rs.)</p></th></tr>' +
    Array.from({ length: 40 }, (_, i) => i + 1).map(n => `<tr><td><p>${n}.</p></td><td><p>Related Party ${pad(n, 2)} Private Limited</p></td><td><p>Partnership Firm in which the Proprietor is a Partner</p></td><td><p>${(n * 1548976).toLocaleString('en-IN')}.00</p></td></tr>`).join('') +
    '</tbody></table>'

  const docs = []
  for (const isCo of [false, true]) {
    const constitution = isCo ? 3 : 1
    const generalPosition = isCo ? 'last' : 'first'
    const data = processRows(tb(isCo), null, constitution, [], 'Trader', false, false, generalPosition)
    const notes = Object.values(data.notes)
    const noteDetailsMap = {}
    const ppe = notes.find(n => /property/i.test(n.title || ''))
    if (isCo) {
      // An 11-column depreciation schedule: too wide for the page at 10pt.
      if (ppe) {
        ppe.compScheduleData = ['Plant and Machinery', 'Furniture and Fixtures', 'Office Equipment', 'Computers', 'Motor Vehicles'].map((category, i) => ({
          category, grossOpen: 18726950.09 - i * 2500000, additions: 1250000.5, deductions: 12500.25, grossClose: 19964450.34 - i * 2500000,
          depOpen: 5421345.67, depForYear: 2815699.8, depOnDisposal: 1250.75, depClose: 8235794.72, netBlockOpen: 13305604.42 - i * 2500000, netBlockClose: 11728655.62 - i * 2500000,
        }))
        ppe.compScheduleTbCY = 804712.18
        ppe.compScheduleTbPY = 0
      }
      // Share Capital details with 60 promoters: longer than a page.
      const sc = notes.find(n => /share capital/i.test(n.title || ''))
      const shares = { authorised: 1500000, issued: 1000000, subscribed: 1000000, paidUp: 1000000, openingShares: 1000000, issuedDuringYear: 0, deletedDuringYear: 0 }
      if (sc) noteDetailsMap[sc.num] = {
        classes: [{ name: 'Equity Shares', faceValue: 10, cy: shares, py: shares }],
        shareholders5pctEquity: [{ name: 'First Director Name', cyShares: 400000, cyPct: 40, pyShares: 400000, pyPct: 40 }],
        promoters: Array.from({ length: 60 }, (_, i) => ({ name: `Promoter Shareholder ${pad(i + 1, 3)}`, class: 'Equity', shares: 1000 + i * 10, pctTotal: '0.10', pctChange: '' })),
        rights: 'The Company has only one class of equity shares having a par value of Rs. 10 per share. Each holder of equity shares is entitled to one vote per share.',
      }
    } else {
      // A depreciation block summary and the Owners' Capital roll-forward: both fit at 10pt.
      if (ppe) ppe.itBlockSummaryData = [
        { block: 'Know-how, patents, copyrights, trademarks, licences, franchises or any other business or commercial rights of similar nature not being goodwill', rate: 25, openingWDV: 19879.94, depreciation: 4970, closingWDV: 14910 },
        { block: 'Machinery & Plant - General', rate: 15, openingWDV: 804712.18, depreciation: 120707, closingWDV: 684005 },
      ]
      const owners = notes.find(n => /owners' capital/i.test(n.title || ''))
      if (owners) noteDetailsMap[owners.num] = {
        rows: [{ name: 'Proprietor Name', opening: 11122471.77, introduced: 2925, withdrawals: 7128417, shareOfProfit: 1364050.06 }],
        py: { opening: 10078573.45, introduced: 0, withdrawals: 88918.1, shareOfProfit: 1123774.46 },
        isSingleOwner: true,
      }
    }
    Object.assign(data, {
      levelFormat: [], manualTaxLines: [],
      generalNotes: {
        title: 'Significant Accounting Policies', position: generalPosition,
        points: isCo
          ? [
              ...Array.from({ length: 2 }, (_, i) => ({ header: `Policy ${i + 1}`, contentHtml: para })),
              { header: 'Related Party Disclosure', contentHtml: `<ul><li>${para.repeat(5)}</li><li>${para.repeat(5)}</li></ul>` },
            ]
          : Array.from({ length: 8 }, (_, i) => ({ header: `Policy ${i + 1}`, contentHtml: i === 7 ? para + resizedTable : para.repeat(2 + (i % 3)) })),
      },
    })
    const docArgs = {
      entity: isCo
        ? { name: 'Selftest Industries Private Limited', constitution: 3, constitution_display: 'Company', cin: 'U12345WB2015PTC123456' }
        : { name: 'Selftest Proprietor', constitution: 1, constitution_display: 'Proprietorship' },
      activeTB: { id: 1, period: '2025-04-01 To 2026-03-31' }, prevTB: null, data, noteDetailsMap,
      auditor: { firm_name: 'Selftest & Co.', frn: '000000E', name: 'Auditor Name', designation: 'Partner', membership_number: '000000' },
      signatories: isCo
        ? [{ name: 'First Director Name', designation: 'Managing Director', din: '01234567' }, { name: 'Second Director Name', designation: 'Whole-time Director', din: '07654321' }, { name: 'Third Director Name', designation: 'Director', din: '09876543' }]
        : [{ name: 'Proprietor Name', designation: 'Proprietor' }],
      includeSigningPage: true, signPlace: 'Siliguri', signDate: '2026-09-13',
    }
    const html = buildFinancialsHTML(docArgs)
    const file = path.join(work, `${isCo ? 'company' : 'proprietor'}.html`)
    fs.writeFileSync(file, html)
    const bigLabel = isCo ? 'Company, 3 directors, General Notes last' : 'Proprietorship, resized General Notes table'
    docs.push({ label: bigLabel, isCo, file })
    // The export's SECOND PDF: no Index page, no Annexures, no signing page --
    // it must open on the Balance Sheet and end with the last note.
    const bareFile = path.join(work, `${isCo ? 'company' : 'proprietor'}-statements-only.html`)
    fs.writeFileSync(bareFile, buildFinancialsHTML({ ...docArgs, includeSigningPage: false, includeIndex: false, includeAnnexures: false }))
    docs.push({ label: `${bigLabel} — statements only`, isCo, bare: true, of: bigLabel, file: bareFile })
  }

  // Small documents: every note would fit on one page.
  for (const position of ['first', 'last']) {
    const isCo = position === 'last'
    const small = isCo
      ? [
          row('EQUITY AND LIABILITIES', "Shareholders' funds", 'Share capital', 'Equity share capital', 500000, 'Equity Share Capital'),
          row('ASSETS', 'Current assets', 'Cash and bank balances', 'Cash on hand', -500000, 'Cash'),
          row('Income', 'Revenue from operations', 'Sale of products', null, 100000, 'Sales'),
        ]
      : [
          row('EQUITY AND LIABILITIES', "Owners' Funds", "Owners' Capital Account", 'Capital', 500000, 'Capital Account'),
          row('ASSETS', 'Current assets', 'Cash and bank balances', 'Cash on hand', -180000, 'Cash'),
          row('Income', 'Revenue from operations', 'Sale of products', null, 900000, 'Sales'),
          row('Expenses', 'Purchases of Stock-in-Trade', null, null, -600000, 'Purchases'),
          row('Expenses', 'Other expenses', 'Rent', null, -120000, 'Rent'),
        ]
    const data = processRows(small, null, isCo ? 3 : 1, [], 'Trader', false, false, position)
    Object.assign(data, {
      levelFormat: [], manualTaxLines: [],
      generalNotes: {
        title: 'Significant Accounting Policies', position,
        points: isCo
          ? [{ header: 'Basis of preparation', contentHtml: '<p>The accounts are prepared on the accrual basis.</p>' }]
          : [{ header: 'Basis of preparation', contentHtml: para }, { header: 'Revenue recognition', contentHtml: para }],
      },
    })
    const html = buildFinancialsHTML({
      entity: isCo
        ? { name: 'Small Selftest Private Limited', constitution: 3, constitution_display: 'Company', cin: 'U12345WB2015PTC123457' }
        : { name: 'Small Selftest Proprietor', constitution: 1, constitution_display: 'Proprietorship' },
      activeTB: { id: 1, period: '2025-04-01 To 2026-03-31' }, prevTB: null, data,
      auditor: { firm_name: 'Selftest & Co.', frn: '000000E', name: 'Auditor Name', designation: 'Partner', membership_number: '000000' },
      signatories: isCo
        ? [{ name: 'First Director Name', designation: 'Managing Director', din: '01234567' }, { name: 'Second Director Name', designation: 'Director', din: '07654321' }]
        : [{ name: 'Proprietor Name', designation: 'Proprietor' }],
      includeSigningPage: true, signPlace: 'Siliguri', signDate: '2026-09-13',
    })
    const file = path.join(work, `small-${position}.html`)
    fs.writeFileSync(file, html)
    docs.push({ label: `Small ${isCo ? 'company' : 'proprietorship'}, General Notes ${position}`, isCo, smallDoc: true, file })
  }

  // Place/Date must print only under the Auditor's signature, never the
  // Signatory (Auditee)'s — every doc[] above was built with a real auditor,
  // real signatories, includeSigningPage:true and signPlace:'Siliguri', so
  // "Place: Siliguri" should appear exactly once per signature block
  // instance (compact per-page footer + the dedicated Signatures page) —
  // the same count as an auditor-only marker ("M.No."/"Membership No.:"),
  // never twice.
  for (const doc of docs) {
    const html = fs.readFileSync(doc.file, 'utf8')
    const auditorMarkers = (html.match(/M\.No\.:|Membership No\.:/g) || []).length
    const placeCount = (html.match(/Place: Siliguri/g) || []).length
    // A Company in absolute figures (these documents are built As Is) is signed by the directors only (0.1.126): no auditor block,
    // and Place / Date stand under the directors instead.
    if (doc.isCo || /company/i.test(doc.label)) {
      ok(`[${doc.label}] a Company in absolute figures: no auditor block; Place/Date stand under the directors`, auditorMarkers === 0 && placeCount > 0,
        `auditor markers=${auditorMarkers} "Place: Siliguri" occurrences=${placeCount}`)
      continue
    }
    ok(`[${doc.label}] Place/Date appear only under the Auditor's signature`, placeCount === auditorMarkers && auditorMarkers > 0,
      `auditor markers=${auditorMarkers} "Place: Siliguri" occurrences=${placeCount}`)
  }

  // The layout engine on its own: the statements' stylesheet and page script
  // around blocks of known height. The page body measures 258mm; the header
  // takes about 20mm.
  const proto = fs.readFileSync(docs[0].file, 'utf8')
  const css = (proto.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''
  const script = (proto.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || ''
  const synSection = (title, fillerMm, cls, rows) => `
    <div class="flow-section"><div class="print-page flow-src"><div class="page-body">
      <div class="flow-header"><div class="page-header"><div class="entity-name">Layout engine</div><div class="statement-title">${title}</div></div></div>
      <div class="flow-blocks">
        <div class="flow-block" data-flow="atomic"><div style="height:${fillerMm}mm">filler</div></div>
        <div class="flow-block" data-flow="rows"><div class="note-block"><div class="note-title" data-flow-title>${title}</div>
          <table class="fs-table" data-flow-table><tbody>${Array.from({ length: rows }, (_, i) => `<tr class="${cls}"><td>Row ${i + 1}</td><td class="right">1,000.00</td><td class="right">900.00</td></tr>`).join('')}<tr class="total-row"><td>Total</td><td class="right">-</td><td class="right">-</td></tr></tbody></table>
        </div></div>
      </div>
    </div><div class="flow-footer"></div></div></div>`
  // A closing signature block that does not fit: the paragraph before it must
  // go overleaf with it (room left here is well over a quarter page, so the
  // block splits rather than moving whole).
  const trailerSection = `
    <div class="flow-section"><div class="print-page flow-src"><div class="page-body">
      <div class="flow-header"><div class="page-header"><div class="entity-name">Layout engine</div><div class="statement-title">A signature block after the last paragraph</div></div></div>
      <div class="flow-blocks">
        <div class="flow-block" data-flow="atomic"><div style="height:120mm">filler</div></div>
        <div class="flow-block" data-flow="children"><div data-flow-children>
          <p class="syn-p1" style="height:60mm;margin:0">First paragraph</p>
          <p class="syn-p2" style="height:40mm;margin:0">Last paragraph</p>
          <div class="syn-trailer" data-flow-trailer style="height:45mm">Signature block</div>
        </div></div>
      </div>
    </div><div class="flow-footer"></div></div></div>`
  const blockSection = (title, inner) => `
    <div class="flow-section"><div class="print-page flow-src"><div class="page-body">
      <div class="flow-header"><div class="page-header"><div class="entity-name">Layout engine</div><div class="statement-title">${title}</div></div></div>
      <div class="flow-blocks"><div class="flow-block" data-flow="children"><div data-flow-children>${inner}</div></div></div>
    </div><div class="flow-footer"></div></div></div>`
  const listSection = blockSection('A numbered list longer than the page',
    `<ol class="syn-ol">${[1, 2, 3].map(i => `<li class="syn-ol-li" style="height:90mm">Item ${i}</li>`).join('')}</ol><div class="syn-trailer" data-flow-trailer style="height:45mm">Signature block</div>`)
  const mittalSection = blockSection('Two long bullet points and the signature',
    `<ul><li class="syn-ul-li" style="height:97mm">First bullet</li><li class="syn-ul-li" style="height:92mm">Second bullet</li></ul><div class="syn-trailer" data-flow-trailer style="height:56mm">Signature block</div>`)
  const tallSection = blockSection('A paragraph that cannot break, then the signature',
    `<p class="syn-tall" style="height:200mm;margin:0">One long paragraph</p><div class="syn-trailer" data-flow-trailer style="height:56mm">Signature block</div>`)
  const synFile = path.join(work, 'engine.html')
  fs.writeFileSync(synFile, `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>` +
    synSection('A short note after a nearly full page', 200, 'syn-short', 6) +
    synSection('A long note with half a page left', 110, 'syn-long', 45) +
    trailerSection + listSection + mittalSection + tallSection +
    `<script>${script}</script></body></html>`)
  docs.push({ label: 'Layout engine, blocks of known height', synthetic: true, file: synFile })

  const runner = path.join(work, 'print.cjs')
  fs.writeFileSync(runner, `
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const docs = ${JSON.stringify(docs)}
const out = []
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  for (const doc of docs) {
    const win = new BrowserWindow({ show: false, width: 794, height: 1123, webPreferences: { contextIsolation: true, nodeIntegration: false } })
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fs.readFileSync(doc.file, 'utf8')))
      await new Promise(r => setTimeout(r, 300))
      const deadline = Date.now() + 20000
      while (Date.now() < deadline) {
        if (await win.webContents.executeJavaScript("!document.querySelector('.flow-section') || window.__flowDone === true")) break
        await new Promise(r => setTimeout(r, 100))
      }
      const dom = await win.webContents.executeJavaScript(doc.synthetic ? \`(() => ({
        flowError: window.__flowError || null, flowDone: window.__flowDone === true, sheets: document.querySelectorAll('.print-page').length,
        syn: Array.from(document.querySelectorAll('.flow-section')).map(sec => Array.from(sec.querySelectorAll('.flow-page')).map(pg => ({
          short: pg.querySelectorAll('tr.syn-short').length, long: pg.querySelectorAll('tr.syn-long').length,
          p1: pg.querySelectorAll('.syn-p1').length, p2: pg.querySelectorAll('.syn-p2').length, trailer: pg.querySelectorAll('.syn-trailer').length,
          ol: pg.querySelectorAll('li.syn-ol-li').length, olStart: pg.querySelector('ol.syn-ol') ? pg.querySelector('ol.syn-ol').getAttribute('start') : null,
          ul: pg.querySelectorAll('li.syn-ul-li').length, tall: pg.querySelectorAll('.syn-tall').length,
          overfull: pg.querySelector('.page-body').scrollHeight > pg.querySelector('.page-body').clientHeight + 1,
        }))),
      }))()\` : \`(() => {
        const res = { flowError: window.__flowError || null, flowDone: window.__flowDone === true, sheets: document.querySelectorAll('.print-page').length, wide: [], carry: [], text: document.body.innerText, small: [], shrunk: [], faces: [] }
        res.sheetTitles = Array.from(document.querySelectorAll('.print-page')).map(p => ((p.querySelector('.statement-title') || {}).textContent || '').trim())
        res.hasCover = !!document.querySelector('.cover-page')
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        const seen = new Set()
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const el = n.parentElement
          if (!el || seen.has(el) || !n.textContent.trim() || el.closest('.fill-details, template, script, style')) continue
          seen.add(el)
          const pt = parseFloat(getComputedStyle(el).fontSize) * 0.75
          if (pt < 9.95) res.small.push(Math.round(pt * 10) / 10 + 'pt: ' + n.textContent.trim().slice(0, 40))
        }
        document.querySelectorAll('[data-flow-fitted]').forEach(el => { if (!el.closest('.fill-details')) res.shrunk.push(el.tagName + ' zoom ' + el.style.zoom) })
        document.querySelectorAll('.compact-page').forEach(pg => res.faces.push((pg.querySelector('.statement-title') || {}).textContent + ' @ ' + pg.getAttribute('data-face-font')))
        document.querySelectorAll('.print-page').forEach((p, i) => { if (p.scrollWidth > p.clientWidth + 1) res.wide.push(i + 1) })
        // Fill Details tables — a table continued overleaf counted once, as a
        // whole: its printed size, and whether the next size up would fit.
        const fdTables = Array.from(document.querySelectorAll('.fill-details table'))
        const counted = new Set()
        res.fd = []
        fdTables.forEach(t => {
          if (counted.has(t)) return
          const id = t.getAttribute('data-flow-split')
          const parts = id ? fdTables.filter(x => x.getAttribute('data-flow-split') === id) : [t]
          parts.forEach(x => counted.add(x))
          const pg = t.closest('.print-page'), cell = t.querySelector('td, th')
          const pt = Math.round(parseFloat(getComputedStyle(cell).fontSize) * 7.5) / 10
          let fitsLarger = null
          if (pt < 9.95) {
            const whole = t.cloneNode(true)
            whole.style.zoom = ''
            parts.slice(1).forEach(x => Array.from(x.tBodies[0].rows).forEach(r => {
              if (!Array.from(r.cells).every(c => c.tagName === 'TH')) whole.tBodies[0].appendChild(r.cloneNode(true))
            }))
            whole.style.setProperty('--fd-font', (Math.round(pt * 2) + 1) / 2 + 'pt')
            t.parentNode.insertBefore(whole, t.nextSibling)
            fitsLarger = whole.getBoundingClientRect().right - pg.getBoundingClientRect().left <= pg.clientWidth + 1
            whole.remove()
          }
          res.fd.push({ pt, fitsLarger, parts: parts.length })
        })
        const pages = Array.from(document.querySelectorAll('.flow-page'))
        res.pages = pages.map(pg => {
          const body = pg.querySelector('.page-body'), content = pg.querySelector('.flow-page-content'), last = content && content.lastElementChild
          const titles = Array.from(pg.querySelectorAll('.note-title')).map(t => t.textContent.trim())
          const generalTitle = titles.find(t => t.indexOf('Significant Accounting Policies') >= 0)
          return {
            title: ((pg.querySelector('.statement-title') || {}).textContent || '').trim(),
            fill: last ? (last.getBoundingClientRect().bottom - body.getBoundingClientRect().top) / body.clientHeight : 0,
            general: !!pg.querySelector('.general-note-point'),
            footer: !!pg.querySelector('.page-signature'),
            numbered: titles.some(t => t.indexOf('Significant Accounting Policies') < 0),
            noteNums: titles.filter(t => t.indexOf('Significant Accounting Policies') < 0).map(t => parseInt(t.replace(/^Note /, ''), 10)).filter(n => n > 0),
            generalNum: generalTitle ? parseInt(generalTitle.replace(/^Note /, ''), 10) : null,
            // the signature block on this page has policy text above it on this page
            signedAfterText: Array.from(pg.querySelectorAll('.page-signature')).some(sig => {
              const trailer = sig.closest('[data-flow-trailer]')
              return !!(trailer && trailer.previousElementSibling && trailer.previousElementSibling.textContent.trim())
            }),
          }
        })
        // Every block split across pages: the room it had where it started, and
        // whether all of it would have fitted on a page of its own.
        const groups = {}
        pages.forEach((pg, i) => pg.querySelectorAll('[data-flow-part]').forEach(el => {
          const id = el.getAttribute('data-flow-part')
          ;(groups[id] = groups[id] || []).push({ el, i })
        }))
        res.splits = Object.values(groups).map(parts => {
          const pg = pages[parts[0].i], body = pg.querySelector('.page-body'), content = pg.querySelector('.flow-page-content')
          const top = body.getBoundingClientRect().top
          return {
            page: parts[0].i + 1,
            room: Math.round((body.clientHeight - (parts[0].el.getBoundingClientRect().top - top)) / body.clientHeight * 100) / 100,
            fitsOnePage: parts.reduce((s, p) => s + p.el.getBoundingClientRect().height, 0) <= body.clientHeight - (content.getBoundingClientRect().top - top),
          }
        })
        const spread = (cellText, headText) => pages.map(pg => ({
          rows: Array.from(pg.querySelectorAll('td')).filter(td => td.textContent.indexOf(cellText) >= 0).length,
          head: Array.from(pg.querySelectorAll('th')).some(th => th.textContent.indexOf(headText) >= 0),
        })).filter(x => x.rows > 0)
        res.spreads = { related: spread('Related Party ', 'Name of the Related Party'), promoters: spread('Promoter Shareholder ', 'Name of Promoter') }
        pages.forEach((pg, i) => pg.querySelectorAll('tr[data-flow-carry]').forEach(tr => {
          if (tr.textContent.indexOf('Carried forward') < 0) return
          const bf = pages[i + 1] && Array.from(pages[i + 1].querySelectorAll('tr[data-flow-carry]')).find(t => t.textContent.indexOf('Brought forward') >= 0)
          res.carry.push({ cf: tr.dataset.cumCy + '|' + tr.dataset.cumPy, bf: bf ? bf.dataset.cumCy + '|' + bf.dataset.cumPy : null })
        }))
        return res
      })()\`)
      const pdf = await win.webContents.printToPDF({ pageSize: 'A4', margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }, printBackground: true, landscape: false, preferCSSPageSize: true, displayHeaderFooter: false })
      dom.pdfPages = (pdf.toString('latin1').match(/\\/Type\\s*\\/Page(?![s\\w])/g) || []).length
      out.push({ ...dom, label: doc.label, isCo: doc.isCo, smallDoc: !!doc.smallDoc, synthetic: !!doc.synthetic, bare: !!doc.bare, of: doc.of || null })
    } catch (e) {
      out.push({ label: doc.label, error: String(e && e.stack || e) })
    } finally { win.close() }
  }
  fs.writeFileSync(${JSON.stringify(path.join(work, 'result.json'))}, JSON.stringify(out))
  app.exit(0)
})
setTimeout(() => app.exit(3), 120000)
`)
  const proc = spawnSync(electronBin, [runner], { stdio: 'ignore', timeout: 150000 })
  const resultFile = path.join(work, 'result.json')

  console.log('\nPDF layout self-test')
  ok('Electron printed the test documents', fs.existsSync(resultFile), `exit ${proc.status}${proc.error ? ' ' + proc.error.message : ''}`)
  const results = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : []
  // General Notes: pages of their own with the signature block on each, then
  // the numbered notes from a fresh page — or, placed last, from a fresh page
  // after the last note, numbered after it.
  function generalNotesChecks(r, tag) {
    const notesPages = r.pages.map((p, i) => ({ ...p, i })).filter(p => /notes to financial statements/i.test(p.title))
    const gen = notesPages.filter(p => p.general), num = notesPages.filter(p => p.numbered)
    const mixed = notesPages.filter(p => p.general && p.numbered)
    ok(`${tag} General Notes have pages of their own (no page shares them with a numbered note)`,
      gen.length > 0 && num.length > 0 && mixed.length === 0, mixed.map(p => `laid-out page ${p.i + 1}`).join(', ') || `${gen.length} General Notes / ${num.length} numbered-note pages`)
    if (gen.length && num.length) {
      if (r.isCo) {
        const lastNum = num[num.length - 1], firstGen = gen[0]
        const maxNum = Math.max(...num.flatMap(p => p.noteNums))
        ok(`${tag} placed last: General Notes start on the page after the last note and are numbered next (Note ${maxNum + 1})`,
          firstGen.i === lastNum.i + 1 && firstGen.generalNum === maxNum + 1,
          `last numbered note on laid-out page ${lastNum.i + 1}, General Notes from ${firstGen.i + 1} as Note ${firstGen.generalNum}`)
      } else {
        const lastGen = gen[gen.length - 1], firstNum = num[0]
        ok(`${tag} placed first: General Notes are Note 1 and Note 2 starts on the page after them`,
          gen[0].generalNum === 1 && firstNum.i === lastGen.i + 1 && Math.min(...firstNum.noteNums) === 2,
          `General Notes (Note ${gen[0].generalNum}) end on laid-out page ${lastGen.i + 1}; numbered notes from ${firstNum.i + 1} (Note ${Math.min(...firstNum.noteNums)})`)
      }
    }
    const signed = r.pages.map((p, i) => ({ ...p, i })).filter(p => p.footer)
    const lastGen = gen[gen.length - 1]
    ok(`${tag} signature block once, right after the last policy (Sign Notes / Sign Annexures off)`,
      signed.length === 1 && !!lastGen && signed[0].i === lastGen.i && signed[0].signedAfterText,
      `signature on laid-out page(s) ${signed.map(p => p.i + 1).join(', ') || 'none'}; last General Notes page ${lastGen ? lastGen.i + 1 : '-'}; policy text above it on that page: ${signed.length ? signed[0].signedAfterText : '-'}`)
  }
  for (const r of results) {
    const tag = `[${r.label}]`
    if (r.error) { ok(`${tag} printed`, false, r.error); continue }
    ok(`${tag} page layout script finished without errors`, r.flowDone && !r.flowError, r.flowError || 'did not finish')
    if (r.bare) {
      const full = results.find(x => x.label === r.of)
      const notesSheets = (x) => x.sheetTitles.filter(t => /notes to financial statements/i.test(t)).length
      ok(`${tag} opens on the Balance Sheet, then the P&L`, /balance sheet/i.test(r.sheetTitles[0] || '') && /profit|loss/i.test(r.sheetTitles[1] || ''), JSON.stringify(r.sheetTitles.slice(0, 3)))
      ok(`${tag} has no Index page`, !r.hasCover && r.sheetTitles.every(t => t !== ''), JSON.stringify(r.sheetTitles.slice(0, 3)))
      ok(`${tag} has no Annexures and no dedicated signing page`, !r.sheetTitles.some(t => /annexure|signatures/i.test(t)), JSON.stringify(r.sheetTitles))
      ok(`${tag} ends with the last note`, /notes to financial statements/i.test(r.sheetTitles[r.sheetTitles.length - 1] || ''), r.sheetTitles[r.sheetTitles.length - 1])
      ok(`${tag} has exactly the full document's notes pages, laid out the same`, !!full && !full.error && notesSheets(r) > 0 && notesSheets(r) === notesSheets(full), `${notesSheets(r)} vs ${full && !full.error ? notesSheets(full) : 'no full doc'}`)
      ok(`${tag} no page is wider than the paper`, r.wide.length === 0, `pages ${r.wide.join(', ')}`)
      ok(`${tag} one PDF sheet per laid-out page (no trailing blank page)`, r.pdfPages === r.sheets, `${r.pdfPages} PDF pages for ${r.sheets} laid-out pages`)
      generalNotesChecks(r, tag)
      continue
    }
    if (r.smallDoc) {
      generalNotesChecks(r, tag)
      ok(`${tag} one PDF sheet per laid-out page (nothing spills over)`, r.pdfPages === r.sheets, `${r.pdfPages} PDF pages for ${r.sheets} laid-out pages`)
      continue
    }
    if (r.synthetic) {
      const [short = [], long = [], closing = [], olPages = [], mittal = [], tall = []] = r.syn
      ok(`${tag} a short note that does not fit the foot of a nearly full page moves overleaf whole`,
        short.length === 2 && short[0].short === 0 && short[1].short === 6, JSON.stringify(short))
      ok(`${tag} a long note starts in the room left on the page and continues overleaf`,
        long.length >= 2 && long[0].long >= 10 && long.reduce((s, p) => s + p.long, 0) === 45, JSON.stringify(long))
      const trailerPage = closing.find(p => p.trailer)
      ok(`${tag} a signature block that does not fit takes the last paragraph along, never going overleaf alone`,
        closing.length === 2 && closing[0].p1 === 1 && closing[0].trailer === 0 && !!trailerPage && trailerPage.p2 === 1, JSON.stringify(closing))
      ok(`${tag} a numbered list longer than the page breaks between its items and carries its numbering on`,
        olPages.length === 2 && olPages[0].ol === 2 && olPages[1].ol === 1 && olPages[1].olStart === '3' && olPages[1].trailer === 1 && !olPages.some(p => p.overfull), JSON.stringify(olPages))
      ok(`${tag} two long bullet points and the signature: the second bullet goes overleaf with the signature, nothing overfull`,
        mittal.length === 2 && mittal[0].ul === 1 && mittal[0].trailer === 0 && mittal[1].ul === 1 && mittal[1].trailer === 1 && !mittal.some(p => p.overfull), JSON.stringify(mittal))
      ok(`${tag} nothing before the signature can break: the signature goes overleaf rather than the page printing overfull`,
        tall.length === 2 && tall[0].tall === 1 && tall[1].trailer === 1 && !tall.some(p => p.overfull), JSON.stringify(tall))
      ok(`${tag} one PDF sheet per laid-out page (nothing spills over)`, r.pdfPages === r.sheets, `${r.pdfPages} PDF pages for ${r.sheets} laid-out pages`)
      continue
    }
    ok(`${tag} all text outside Fill Details / schedule tables is at least 10pt`, r.small.length === 0, r.small.slice(0, 5).join(' | '))
    ok(`${tag} Balance Sheet and P&L faces print at 10pt or more (and on one page)`,
      r.faces.length === 2 && r.faces.every(f => parseFloat(f.split(' @ ')[1]) >= 10), r.faces.join('; '))
    const fdTooSmall = r.fd.filter(f => f.pt < 9.95 && f.fitsLarger)
    ok(`${tag} Fill Details tables print at 10pt, smaller only when too wide for the page`,
      r.fd.some(f => f.pt >= 9.95) && (!r.isCo || r.fd.some(f => f.pt < 9.95)) && fdTooSmall.length === 0,
      `${r.fd.length} tables at ${r.fd.map(f => f.pt).join('/')}pt; ${fdTooSmall.length} would fit larger`)
    ok(`${tag} nothing outside a Fill Details table had to be shrunk to fit`, r.shrunk.length === 0, r.shrunk.join('; '))
    ok(`${tag} no empty "()" item labels`, !/\(\)\s*\S/.test(r.text))
    ok(`${tag} no page is wider than the paper (the PDF is not shrunk)`, r.wide.length === 0, `pages ${r.wide.join(', ')}`)
    // Over consecutive pages of the same statement (General Notes are a run of
    // their own); if nothing was laid out that is a failure.
    const underfilled = []
    r.pages.forEach((pg, i) => {
      const next = r.pages[i + 1]
      if (next && next.title === pg.title && next.general === pg.general && pg.fill < 0.6) underfilled.push(`${pg.title} page ${i + 1}: ${Math.round(pg.fill * 100)}% full`)
    })
    const laidOut = new Set(r.pages.map(p => p.title)).size >= 2
    ok(`${tag} every Notes/Annexures page but the last of its run is at least 60% full`, laidOut && underfilled.length === 0,
      laidOut ? underfilled.join('; ') : 'no Notes/Annexures pages were laid out to fill')
    generalNotesChecks(r, tag)
    const needless = r.splits.filter(s => s.fitsOnePage && s.room <= 0.25)
    ok(`${tag} a block is split only when taller than a page or moving it would leave over a quarter page blank`,
      needless.length === 0, needless.map(s => `page ${s.page}: split with ${Math.round(s.room * 100)}% of the page left`).join('; '))
    const spreadOk = (s) => s.length >= 2 && s.every(x => x.head)
    if (r.isCo) ok(`${tag} a Fill Details table longer than the page continues overleaf under its header row`, spreadOk(r.spreads.promoters), JSON.stringify(r.spreads.promoters))
    else ok(`${tag} a General Notes table longer than the page continues overleaf under its header row`, spreadOk(r.spreads.related), JSON.stringify(r.spreads.related))
    ok(`${tag} one PDF sheet per laid-out page (nothing spills over)`, r.pdfPages === r.sheets, `${r.pdfPages} PDF pages for ${r.sheets} laid-out pages`)
    const once = (rx, n) => {
      const seen = new Map()
      for (const m of r.text.matchAll(rx)) seen.set(m[0], (seen.get(m[0]) || 0) + 1)
      return seen.size === n && [...seen.values()].every(c => c === 1)
    }
    ok(`${tag} all 150 debtor ledgers printed exactly once`, once(/Debtor \d{3} Enterprises/g, 150))
    ok(`${tag} all 70 expense ledgers printed exactly once`, once(/Expense ledger \d{3}/g, 70))
    if (r.isCo) ok(`${tag} all 60 promoter rows printed exactly once`, once(/Promoter Shareholder \d{3}/g, 60))
    else ok(`${tag} all 40 related-party rows printed exactly once`, once(/Related Party \d{2} Private Limited/g, 40))
    const mismatched = r.carry.filter(c => c.cf !== c.bf)
    ok(`${tag} long tables split with matching Carried/Brought forward figures`, r.carry.length > 0 && mismatched.length === 0,
      r.carry.length ? JSON.stringify(mismatched) : 'no table was split')
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}

console.log(fails ? `\n${fails} check(s) FAILED\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
