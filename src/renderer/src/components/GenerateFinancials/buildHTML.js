import { fmtINR as _fmtINRRaw, fmtDenom, DENOMINATIONS, processRows, displayAmt } from '../../hooks/useFinancials'
import { netCreditPurchasesWorking } from '../../utils/ratios'
import { auditorForDenomination } from '../../utils/signingRules'
// Ageing schedule definitions shared with the fill-details forms
// (single source of truth so PDF labels always match the forms)
import { TP_AGEING_ROWS, TP_AGEING_BUCKETS } from '../Notes/TradePayablesDisclosureForm'
import { TR_AGEING_ROWS, TR_AGEING_BUCKETS, trComputedCell } from '../Notes/TradeReceivablesAgingForm'
// Single source of truth for the Schedule III BS layout — shared with the
// live BS screen and the Excel exporter, so PDF always matches both exactly.
import { computeCompanyBSLayout, computeDynamicBSLayout } from '../../utils/bsStructure'
// Single source of truth for the non-corporate (constitution=1) PL sequence —
// shared with the live PL screen and the Excel exporter.
import { computeNonCorpPLLayout } from '../../utils/plStructureNonCorp'
import { pointLabel } from '../../utils/pointLabel'
import { withStbCurrentMaturities } from '../../utils/stbCurrentMaturities'
import { printNoteRows } from '../../utils/noteRowHeaders'
import { NC_AGEING_TITLE, NC_AGEING_BLOCKS, NC_AGEING_CATEGORIES, ncAgeingResolve } from '../../utils/tradeReceivablesNonCorp'
// Single source of truth for Company/LLP PL expense-line bucketing and
// presentation order — shared with the live PL screen and Excel exporter, so
// PDF section/note order always matches (see plStructureCorp.js doc comment
// on why raw expenseSections/incomeSections array order can't be trusted).
import { EXPENSE_LINES, corpFaceTail, TAX_SECTION_RX } from '../../utils/plStructureCorp'
// Ledger → sub-note grouping — single source of truth shared with the live
// Annexures UI and the Excel exporter.
import { getSubnoteGroups, UNCLASSIFIED_LABEL, plNoteLines, bsNoteFallbackLines, subnoteGroupFigures, pyOnlySubnoteLines, annexureDisplayLabels } from '../../utils/annexureGrouping'
import { CASH_BANK_ITEMS } from '../Notes/CashBankDetailsForm'
import { printedDisclosures, disclosureParagraphs } from '../../utils/shareCapitalDisclosures'
import { scaleRatioAmounts } from '../../utils/ratioTable'
import { buildCashFlow } from '../../utils/cashFlow'
import { pointBodyHtml } from '../../utils/generalNotePoint'
import { signatoryIdText, signedOnBehalfOf } from '../../utils/signatoryFormat'

// Module-level denomination key (set in buildFinancialsHTML).
let _DENOM_KEY = 'as_is'
const fmtINR = (n) => fmtDenom(n, _DENOM_KEY)

/**
 * financial_periods.date_from/date_till (see FinancialPeriodPicker.jsx) are
 * stored as ISO 'YYYY-MM-DD', which trial_balances.period then embeds as-is
 * (e.g. "2025-04-01 To 2026-03-31") — every PDF date derived from it inherits
 * that year-first order unless reformatted for display. Any other format
 * (already DD-MM-YYYY, DD/MM/YYYY, free text) passes through unchanged.
 */
function ddmmyyyy(s) {
  if (!s) return s
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s
}

/**
 * Extract the year-end date from a period string, reformatted for display.
 * "2025-04-01 To 2026-03-31"  →  "31-03-2026"
 * "31/03/2026"                →  "31/03/2026"   (plain date, returned as-is)
 */
function yearEnd(period) {
  if (!period) return ''
  const toIdx = period.toLowerCase().indexOf(' to ')
  const raw = toIdx !== -1 ? period.slice(toIdx + 4).trim() : period.trim()
  return ddmmyyyy(raw)
}

/**
 * Extract the year-start date from a period string, reformatted for display.
 * "2025-04-01 To 2026-03-31"  →  "01-04-2025"
 */
function yearStart(period) {
  if (!period) return ''
  const toIdx = period.toLowerCase().indexOf(' to ')
  return toIdx !== -1 ? ddmmyyyy(period.slice(0, toIdx).trim()) : ''
}

const _MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
function _ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
/** "01-04-2025" → "1st April 2025" (falls back to the raw string if unparsable) */
function fmtOrdinalDate(ddmmyyyy) {
  if (!ddmmyyyy) return ''
  const m = ddmmyyyy.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (!m) return ddmmyyyy
  const [, d, mo, y] = m
  const mi = parseInt(mo, 10) - 1
  if (mi < 0 || mi > 11) return ddmmyyyy
  return `${_ordinal(parseInt(d, 10))} ${_MONTHS[mi]} ${y}`
}

/** "2030-03-15" (ISO, what <input type="date"> and the Excel Fill Details import both store) → "15-03-2030". Anything else passes through unchanged. */
function fmtISOToDMY(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (iso || '')
}

const ALPHA = 'abcdefghijklmnopqrstuvwxyz'
const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX']

// Was a local is_deemed_positive-based sign flip, diverging from the
// alie-based convention every other screen uses (see displayAmt() in
// useFinancials.js). Delegate to the single shared implementation instead.
const rowAmt = displayAmt

function esc(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

// ── A4 Page Header (entity name centered) ─────────────────────────────────
// Companies show CIN in place of the constitution line (per Schedule III
// header convention); other constitutions keep the "(Partnership)" etc.
// sub-line. Registered/business address, when captured on the Auditee
// record, always follows immediately below.
function pageHeader(entity, title, subtitle) {
  const denomUnit = (DENOMINATIONS[_DENOM_KEY] || {}).unit || ''
  const isCompany = parseInt(entity?.constitution) === 3
  const constitutionLine = !isCompany && entity?.constitution_display
    ? `<div class="entity-sub">(${esc(entity.constitution_display)})</div>` : ''
  const cinLine = isCompany && entity?.cin
    ? `<div class="entity-sub">CIN: ${esc(entity.cin)}</div>` : ''
  const addressLine = entity?.address
    ? `<div class="entity-sub">${esc(entity.address)}</div>` : ''
  return `
    <div class="page-header">
      <div class="entity-name">${esc(entity?.name || 'Entity Name')}</div>
      ${constitutionLine}
      ${cinLine}
      ${addressLine}
      <div class="statement-title">${esc(title)}</div>
      ${subtitle ? `<div class="entity-sub">${esc(subtitle)}</div>` : ''}
      ${denomUnit ? `<div class="denom-unit">${esc(denomUnit)}</div>` : ''}
    </div>`
}

// ── Compact per-page signature footer (for BS/PL/Notes/Annexures) ─────────
function compactSignFooter(entity, auditor, signatories, { enabled = true, signPlace = '', signDate = '' } = {}) {
  if (!enabled) return ''
  if (!auditor && (!signatories || signatories.length === 0)) return ''

  const dateLine = `<div class="sigf-line sigf-sub">Date: ${signDate ? esc(fmtISOToDMY(signDate)) : ''}</div>`
  const placeLine = `<div class="sigf-line sigf-sub">Place: ${signPlace ? esc(signPlace) : ''}</div>`

  const auditorBlock = auditor ? `
    <div class="sigf-col sigf-left">
      ${auditor.firm_name ? `<div class="sigf-line sigf-bold">For ${esc(auditor.firm_name)}</div>` : ''}
      ${auditor.firm_name ? `<div class="sigf-line sigf-sub">Chartered Accountants</div>` : '<div class="sigf-line sigf-bold">Chartered Accountant</div>'}
      ${auditor.frn ? `<div class="sigf-line sigf-sub">FRN: ${esc(auditor.frn)}</div>` : ''}
      <div class="sigf-gap"></div>
      <div class="sigf-line sigf-bold">${esc(auditor.name)}</div>
      ${auditor.designation ? `<div class="sigf-line sigf-sub">${esc(auditor.designation)}</div>` : ''}
      <div class="sigf-line sigf-sub">M.No.: ${esc(auditor.membership_number || '')}</div>
      ${dateLine}
      ${placeLine}
    </div>` : '<div class="sigf-col sigf-left"></div>'

  const mgmt = signatories && signatories.length > 0 ? `
    <div class="sigf-col sigf-right">
      <div class="sigf-line sigf-bold">${esc(signedOnBehalfOf(entity?.constitution))} <span class="sigf-upper">${esc(entity?.name || '')}</span></div>
      <div class="sigf-gap"></div>
      <div class="sigf-dirs">
        ${signatories.map(s => `
          <div class="sigf-dir">
            <div class="sigf-line sigf-bold">${esc(s.name)}</div>
            ${s.designation ? `<div class="sigf-line sigf-sub">${esc(s.designation)}</div>` : ''}
            ${signatoryIdText(entity?.constitution, s) ? `<div class="sigf-line sigf-sub">${esc(signatoryIdText(entity?.constitution, s))}</div>` : ''}
          </div>
        `).join('')}
      </div>
      ${auditor ? '' : `<div class="sigf-gap"></div>${dateLine}${placeLine}`}
    </div>` : '<div class="sigf-col sigf-right"></div>'

  return `
    <div class="page-signature">
      ${auditor ? '<div class="sigf-note">As per our report of even date attached.</div>' : ''}
      <div class="sigf-grid">${auditorBlock}${mgmt}</div>
    </div>`
}

// ── Balance Sheet HTML ────────────────────────────────────────────────────
// Uses the same computeCompanyBSLayout / computeDynamicBSLayout as the live
// BS screen and the Excel exporter (see utils/bsStructure.js), so all three
// always render the identical structure, numbering, and zero-value
// uncategorised suppression.
function buildBSPage(entity, activeTB, prevTB, data, auditor, signatories, signPlace = '', signDate = '') {
  const cyYE = yearEnd(activeTB?.period)
  const isCompany = parseInt(entity?.constitution) === 3

  const lineRow = (label, noteNum, total, prevTotal) => `<tr>
    <td class="indent-1">${label}</td>
    <td class="center">${noteNum || ''}</td>
    <td class="right">${fmtINR(total)}</td>
    <td class="right">${fmtINR(prevTotal)}</td>
  </tr>`

  const buildCompanySide = (alieLabel, side, grandTotal, grandPrevTotal) => {
    let body = `<tr><td colspan="4" class="section-title">${esc(alieLabel)}</td></tr>`
    for (const grp of side.groups) {
      body += `<tr><td colspan="4" class="section-header">(${grp.num}) ${esc(grp.label)}</td></tr>`
      for (const line of grp.lines) {
        // A group's only line has no letter (e.g. Share application money pending allotment) — no empty "()".
        const label = `${line.alpha ? `(${line.alpha}) ` : ''}${esc(line.label)}`
        // (a) Property, Plant and Equipment and Intangible assets: a caption over (i)-(iv), which carry the figures.
        if (line.heading) {
          body += `<tr><td class="indent-1">${label}</td><td></td><td></td><td></td></tr>`
          continue
        }
        if (line.sub) {
          body += `<tr><td style="padding-left:22pt !important">${label}</td><td class="center">${line.noteNum || ''}</td><td class="right">${fmtINR(line.total)}</td><td class="right">${fmtINR(line.prevTotal)}</td></tr>`
          continue
        }
        if (line.subLines) {
          // Trade payables: a caption (with its note number) over (A) MSME / (B) others.
          body += `<tr><td class="indent-1">${label}</td><td class="center">${line.noteNum || ''}</td><td></td><td></td></tr>`
          for (const s of line.subLines) {
            body += `<tr><td style="padding-left:22pt !important">${esc(s.label)}</td><td></td><td class="right">${fmtINR(s.total)}</td><td class="right">${fmtINR(s.prevTotal)}</td></tr>`
          }
          continue
        }
        body += lineRow(label, line.noteNum, line.total, line.prevTotal)
      }
      if (grp.uncat) {
        body += lineRow(`${grp.uncat.alpha ? `(${grp.uncat.alpha}) ` : ''}<span class="uncat-text">${esc(grp.uncat.label)}</span>`, grp.uncat.noteNum, grp.uncat.total, grp.uncat.prevTotal)
      }
    }
    if (side.uncatTop) {
      body += `<tr><td colspan="4" class="section-header uncat-text">${esc(side.uncatTop.label)}</td></tr>`
      body += lineRow(`<span class="uncat-text">${esc(side.uncatTop.label)}</span>`, side.uncatTop.noteNum, side.uncatTop.total, side.uncatTop.prevTotal)
    }
    body += `<tr class="total-row">
      <td colspan="2">TOTAL ${esc(alieLabel)}</td>
      <td class="right">${fmtINR(grandTotal)}</td>
      <td class="right">${fmtINR(grandPrevTotal)}</td>
    </tr>`
    return body
  }

  const buildDynamicSide = (alieLabel, sections, grandTotal, grandPrevTotal) => {
    let body = `<tr><td colspan="4" class="section-title">${esc(alieLabel)}</td></tr>`
    sections.forEach((sec, si) => {
      const secCls = sec.isUncat ? ' uncat-text' : ''
      body += `<tr><td colspan="4" class="section-header${secCls}">(${si + 1}) ${esc(sec.level1 || 'Uncategorised')}</td></tr>`
      sec.lines.forEach((line, li) => {
        const lineLabel = `(${ALPHA[li] || li}) ${esc(line.level2 || 'Uncategorised')}`
        body += lineRow(line.isUncat ? `<span class="uncat-text">${lineLabel}</span>` : lineLabel, line.noteNum, line.total, line.prevTotal)
      })
    })
    body += `<tr class="total-row">
      <td colspan="2">TOTAL ${esc(alieLabel)}</td>
      <td class="right">${fmtINR(grandTotal)}</td>
      <td class="right">${fmtINR(grandPrevTotal)}</td>
    </tr>`
    return body
  }

  let elBody, assetsBody, totalEL, totalAssets

  if (isCompany) {
    const layout = computeCompanyBSLayout(data)
    totalEL = layout.totalEL; totalAssets = layout.totalAsset
    elBody = buildCompanySide('EQUITY AND LIABILITIES', layout.el, layout.totalEL, layout.prevEL)
    assetsBody = buildCompanySide('ASSETS', layout.assets, layout.totalAsset, layout.prevAsset)
  } else {
    const layout = computeDynamicBSLayout(data, entity?.constitution)
    totalEL = layout.totalEL; totalAssets = layout.totalAsset
    elBody = buildDynamicSide('EQUITY AND LIABILITIES', layout.el, layout.totalEL, layout.prevEL)
    assetsBody = buildDynamicSide('ASSETS', layout.assets, layout.totalAsset, layout.prevAsset)
  }

  return `
    <div class="print-page compact-page">
      <div class="page-body">
        ${pageHeader(entity, 'Balance Sheet', `as at ${esc(cyYE)}`)}
        <table class="fs-table compact-table">
          <thead>
            <tr>
              <th style="width:52%"></th>
              <th style="width:8%" class="center">Note</th>
              <th style="width:20%" class="right">Current Year</th>
              <th style="width:20%" class="right" data-py-col>Previous Year</th>
            </tr>
          </thead>
          <tbody>
            ${elBody}
            <tr><td colspan="4" class="spacer"></td></tr>
            ${assetsBody}
          </tbody>
        </table>
        ${Math.abs(totalEL - totalAssets) > 1 ? `
          <div class="note-text">Balance Sheet difference: ${fmtINR(Math.abs(totalEL - totalAssets))}.</div>
        ` : ''}
        <div class="footer-text">The accompanying notes form an integral part of the financial statements.</div>
      </div>
      ${compactSignFooter(entity, auditor, signatories, { enabled: true, signPlace, signDate })}
    </div>`
}

// ── Profit & Loss HTML ────────────────────────────────────────────────────
// ── Non-corporate (constitution=1) PL body — driven by the shared
// computeNonCorpPLLayout(), so the PDF always matches the live PL screen and
// the Excel export exactly (sequence, roman numerals, zero-value suppression).
function buildNonCorpPLBody(data, entity) {
  const layout = computeNonCorpPLLayout(data, entity?.constitution_display, data?.manualTaxLines || [])
  let body = ''
  for (const item of layout.items) {
    switch (item.kind) {
      case 'addline':
        break
      case 'manual':
        body += `<tr>
          <td class="indent-1">(${item.alpha}) ${esc(item.label)}</td>
          <td></td>
          <td class="right">${fmtINR(item.cy)}</td>
          <td class="right">${fmtINR(item.py)}</td>
        </tr>`
        break
      case 'row':
        body += `<tr>
          <td><span class="roman">${item.roman}.</span> ${esc(item.label)}</td>
          <td class="center">${item.noteNum || ''}</td>
          <td class="right">${fmtINR(item.cy)}</td>
          <td class="right">${fmtINR(item.py)}</td>
        </tr>`
        break
      case 'uncat':
        body += `<tr>
          <td class="indent-1" style="color:#b91c1c;">${esc(item.label)}</td>
          <td></td>
          <td class="right">${fmtINR(item.cy)}</td>
          <td class="right">${fmtINR(item.py)}</td>
        </tr>`
        break
      case 'sub':
        body += `<tr>
          <td class="indent-1">(${item.alpha}) ${esc(item.label)}</td>
          <td class="center">${item.noteNum || ''}</td>
          <td class="right">${fmtINR(item.cy)}</td>
          <td class="right">${fmtINR(item.py)}</td>
        </tr>`
        break
      case 'subtotal':
        body += `<tr class="subtotal">
          <td class="indent-1">${esc(item.label)}</td>
          <td></td>
          <td class="right">${fmtINR(item.cy)}</td>
          <td class="right">${fmtINR(item.py)}</td>
        </tr>`
        break
      case 'header':
        body += `<tr><td colspan="4" class="section-header"><span class="roman">${item.roman}.</span> ${esc(item.label)}</td></tr>`
        break
      case 'total':
        body += `<tr class="subtotal">
          <td><span class="roman">${item.roman}.</span> ${esc(item.label)}</td>
          <td></td>
          <td class="right">${fmtINR(item.cy)}</td>
          <td class="right">${fmtINR(item.py)}</td>
        </tr>`
        break
      case 'grandtotal':
        body += `<tr class="total-row">
          <td><span class="roman">${item.roman}.</span> ${esc(item.label)}</td>
          <td></td>
          <td class="right">${fmtINR(item.cy)}</td>
          <td class="right">${fmtINR(item.py)}</td>
        </tr>`
        break
    }
  }
  return body
}

// Cash Flow Statement (AS 3, indirect method) - one page after the Profit & Loss, when the CFS tab has "Include in PDF / Excel" ticked.
// The figures are the same ones the CFS tab shows (utils/cashFlow.js).
function buildCFSPage(entity, activeTB, data, auditor, signatories, signPlace = '', signDate = '') {
  const cf = buildCashFlow(data, data.cfsSaved)
  let body = ''
  for (const r of cf.rows) {
    if (r.kind === 'head') { body += `<tr class="subtotal"><td colspan="3"><b>${esc(r.label)}</b></td></tr>`; continue }
    if (r.kind === 'caption') { body += `<tr><td colspan="3" class="indent-1"><i>${esc(r.label)}</i></td></tr>`; continue }
    const strong = r.kind === 'sub' || r.kind === 'total'
    body += `<tr${strong ? ' class="subtotal"' : ''}>
      <td${strong ? '' : ' class="indent-1"'}>${strong ? '<b>' : ''}${esc(r.label)}${strong ? '</b>' : ''}</td>
      <td class="right">${strong ? '<b>' : ''}${fmtINR(r.cy)}${strong ? '</b>' : ''}</td>
      <td class="right" data-py-col>${strong ? '<b>' : ''}${fmtINR(r.py)}${strong ? '</b>' : ''}</td>
    </tr>`
  }
  // Components of cash and cash equivalents (AS 3), reconciled to the Balance Sheet
  const cc = cf.cc
  const ccRow = (label, cy, py, strong) => `<tr${strong ? ' class="subtotal"' : ''}><td${strong ? '' : ' class="indent-1"'}>${strong ? '<b>' : ''}${esc(label)}${strong ? '</b>' : ''}</td><td class="right">${strong ? '<b>' : ''}${fmtINR(cy)}${strong ? '</b>' : ''}</td><td class="right" data-py-col>${strong ? '<b>' : ''}${fmtINR(py)}${strong ? '</b>' : ''}</td></tr>`
  const ccShown = cc.items.filter(r => Math.abs(r.cy) > 0.005 || Math.abs(r.py) > 0.005)
  const ccBlock = `
          <div style="margin-top:5mm"><b>Cash and cash equivalents</b> <span style="font-size:90%">(components, as required by AS 3)</span></div>
          <table class="fs-table compact-table">
            <thead><tr><th style="width:60%"></th><th style="width:20%" class="right">Current Year</th><th style="width:20%" class="right" data-py-col>Previous Year</th></tr></thead>
            <tbody>
              ${(ccShown.length ? ccShown : cc.items.slice(0, 2)).map(r => ccRow(r.label, r.cy, r.py, false)).join('')}
              ${ccRow('Cash and cash equivalents as per the Balance Sheet', cc.totalCY, cc.totalPY, true)}
              ${Math.abs(cc.diffCY) > 0.5 || Math.abs(cc.diffPY) > 0.5 ? ccRow('Difference to be explained', cc.diffCY, cc.diffPY, false) : ''}
              ${Math.abs(cc.restricted.cy) > 0.005 || Math.abs(cc.restricted.py) > 0.005 ? ccRow(cc.restricted.label, cc.restricted.cy, cc.restricted.py, false) : ''}
            </tbody>
          </table>
          ${cc.note ? `<div class="footer-text" style="text-align:left">${esc(cc.note)}</div>` : ''}`
  return `
      <div class="print-page compact-page">
        <div class="page-body">
          ${pageHeader(entity, 'Cash Flow Statement', `for the year ended ${esc(yearEnd(activeTB?.period || ''))}`)}
          <table class="fs-table compact-table">
            <thead>
              <tr>
                <th style="width:60%"></th>
                <th style="width:20%" class="right">Current Year</th>
                <th style="width:20%" class="right" data-py-col>Previous Year</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
          ${ccBlock}
          <div class="footer-text">The accompanying notes form an integral part of the financial statements.</div>
        </div>
        ${compactSignFooter(entity, auditor, signatories, { enabled: true, signPlace, signDate })}
      </div>`
}

function buildPLPage(entity, activeTB, prevTB, data, auditor, signatories, signPlace = '', signDate = '') {
  const cyLabel = 'Current Year'
  const pyLabel = 'Previous Year'
  const constitution = entity?.constitution
  const title = constitution === 1 ? 'Profit and Loss Account' : 'Statement of Profit and Loss'

  // Individual/Proprietorship/Partnership: fixed ICAI non-corporate PL sequence.
  // Company and LLP keep the dynamic Schedule III rendering below, untouched.
  if (parseInt(constitution) === 1) {
    const body = buildNonCorpPLBody(data, entity)
    return `
      <div class="print-page compact-page">
        <div class="page-body">
          ${pageHeader(entity, title, `for the year ended ${esc(yearEnd(activeTB?.period || ''))}`)}
          <table class="fs-table compact-table">
            <thead>
              <tr>
                <th style="width:52%"></th>
                <th style="width:8%" class="center">Note</th>
                <th style="width:20%" class="right">${cyLabel}</th>
                <th style="width:20%" class="right" data-py-col>${pyLabel}</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
          <div class="footer-text">The accompanying notes form an integral part of the financial statements.</div>
        </div>
        ${compactSignFooter(entity, auditor, signatories, { enabled: true, signPlace, signDate })}
      </div>`
  }

  // ── Mirror PL component / Excel exactly: use the shared EXPENSE_LINES
  // buckets and corpPLSectionOrder(), so the PDF's section/note order and
  // roman-numeral structure always match the live PL screen and Excel —
  // including the Exceptional/Extraordinary items lines (previously silently
  // folded into Profit-before-tax with no visible line on the PDF face).
  const expSections = data.expenseSections || []
  const incSections = data.incomeSections || []

  const buckets = {}
  EXPENSE_LINES.forEach(el => { buckets[el.key] = { total: 0, prevTotal: 0, noteNum: null } })

  const openSec = expSections.find(s => /opening stock/i.test(s.level1))
  const closeSec = incSections.find(s => /closing stock/i.test(s.level1))
  const changesSec = expSections.find(s => /changes in inventor/i.test(s.level1))
  buckets['inv_changes'].total = changesSec?.total || 0
  buckets['inv_changes'].prevTotal = changesSec?.prevTotal || 0
  buckets['inv_changes'].noteNum = changesSec?.noteNum || openSec?.noteNum || closeSec?.noteNum || null

  const skipL1 = new Set([openSec?.level1, closeSec?.level1, changesSec?.level1].filter(Boolean))
  const uncatExpSecs = []
  for (const sec of expSections) {
    if (skipL1.has(sec.level1)) continue
    if (/tax expense/i.test(sec.level1) || /exceptional|extraordinary/i.test(sec.level1) || /discontinuing/i.test(sec.level1)) continue   // own lines below
    if (/uncategorised/i.test(sec.level1)) { uncatExpSecs.push(sec); continue }
    let matched = false
    for (const el of EXPENSE_LINES) {
      if (el.match && el.match.test(sec.level1)) {
        buckets[el.key].total += sec.total
        buckets[el.key].prevTotal += sec.prevTotal
        if (!buckets[el.key].noteNum) buckets[el.key].noteNum = sec.noteNum
        matched = true; break
      }
    }
    if (!matched) {
      buckets['other_expenses'].total += sec.total
      buckets['other_expenses'].prevTotal += sec.prevTotal
      if (!buckets['other_expenses'].noteNum) buckets['other_expenses'].noteNum = sec.noteNum
    }
  }

  const pureIncome = incSections.filter(s => !/closing stock/i.test(s.level1) && !/exceptional|extraordinary/i.test(s.level1))
  const revSec = pureIncome.find(s => /revenue from operation/i.test(s.level1))
  const uncatIncSecs = pureIncome.filter(s => /uncategorised/i.test(s.level1))
  const otherInc = pureIncome.filter(s => !/revenue from operation/i.test(s.level1) && !/uncategorised/i.test(s.level1))

  const totalRevCY = revSec?.total || 0
  const totalRevPY = revSec?.prevTotal || 0
  const otherIncCY = otherInc.reduce((s, x) => s + x.total, 0)
  const otherIncPY = otherInc.reduce((s, x) => s + x.prevTotal, 0)
  const uncatIncCY = uncatIncSecs.reduce((s, x) => s + x.total, 0)
  const uncatIncPY = uncatIncSecs.reduce((s, x) => s + x.prevTotal, 0)
  const totalIncomeCY = totalRevCY + otherIncCY + uncatIncCY
  const totalIncomePY = totalRevPY + otherIncPY + uncatIncPY

  const uncatExpCY = uncatExpSecs.reduce((s, x) => s + x.total, 0)
  const uncatExpPY = uncatExpSecs.reduce((s, x) => s + x.prevTotal, 0)
  const mainExpCY = EXPENSE_LINES.reduce((s, el) => s + (buckets[el.key]?.total || 0), 0) + uncatExpCY
  const mainExpPY = EXPENSE_LINES.reduce((s, el) => s + (buckets[el.key]?.prevTotal || 0), 0) + uncatExpPY

  const tail = corpFaceTail(expSections)   // Exceptional, Extraordinary, discontinuing operations — shared with the screen and Excel
  // Company's caption is "Tax expense:" (trailing colon), LLP's has none -- match both.
  // Missing it made this face print the empty (1)/(2) placeholders and leave the tax
  // out of "Profit for the period", while the note and Reserves and surplus had it.
  const taxSecs = expSections.filter(s => TAX_SECTION_RX.test((s.level1 || '').trim()))
  const exceptCY = tail.exceptional.cy, exceptPY = tail.exceptional.py
  const extraCY = tail.extraordinary.cy, extraPY = tail.extraordinary.py
  const taxCY = taxSecs.reduce((s, x) => s + x.total, 0)
  const taxPY = taxSecs.reduce((s, x) => s + x.prevTotal, 0)

  const pbeetCY = totalIncomeCY - mainExpCY, pbeetPY = totalIncomePY - mainExpPY
  const pbetCY = pbeetCY - exceptCY, pbetPY = pbeetPY - exceptPY
  const pbt = pbetCY - extraCY, prevPBT = pbetPY - extraPY
  const pat = pbt - taxCY, prevPAT = prevPBT - taxPY

  let rn = 0
  let body = `<tr><td colspan="4" class="section-header">Income</td></tr>`
  rn++
  body += `<tr>
    <td><span class="roman">${ROMAN[rn - 1]}.</span> Revenue from operations</td>
    <td class="center">${revSec?.noteNum || ''}</td>
    <td class="right">${fmtINR(totalRevCY)}</td>
    <td class="right">${fmtINR(totalRevPY)}</td>
  </tr>`
  rn++
  body += `<tr>
    <td><span class="roman">${ROMAN[rn - 1]}.</span> Other income</td>
    <td class="center">${otherInc[0]?.noteNum || ''}</td>
    <td class="right">${fmtINR(otherIncCY)}</td>
    <td class="right">${fmtINR(otherIncPY)}</td>
  </tr>`
  if (uncatIncCY || uncatIncPY) {
    body += `<tr>
      <td class="indent-1">Uncategorised Income</td>
      <td class="center">${uncatIncSecs[0]?.noteNum || ''}</td>
      <td class="right">${fmtINR(uncatIncCY)}</td>
      <td class="right">${fmtINR(uncatIncPY)}</td>
    </tr>`
  }
  rn++
  body += `<tr class="subtotal">
    <td><span class="roman">${ROMAN[rn - 1]}.</span> Total Revenue (I + II)</td>
    <td></td>
    <td class="right">${fmtINR(totalIncomeCY)}</td>
    <td class="right">${fmtINR(totalIncomePY)}</td>
  </tr>`

  // Expenses
  rn++
  body += `<tr><td colspan="4" class="section-header"><span class="roman">${ROMAN[rn - 1]}.</span> Expenses</td></tr>`
  for (const el of EXPENSE_LINES) {
    const b = buckets[el.key]
    body += `<tr>
      <td class="indent-1">${esc(el.label)}</td>
      <td class="center">${b?.noteNum || ''}</td>
      <td class="right">${fmtINR(b?.total || 0)}</td>
      <td class="right">${fmtINR(b?.prevTotal || 0)}</td>
    </tr>`
  }
  if (uncatExpCY || uncatExpPY) {
    body += `<tr>
      <td class="indent-1">Uncategorised Expenses</td>
      <td class="center">${uncatExpSecs[0]?.noteNum || ''}</td>
      <td class="right">${fmtINR(uncatExpCY)}</td>
      <td class="right">${fmtINR(uncatExpPY)}</td>
    </tr>`
  }
  body += `<tr class="subtotal">
    <td class="indent-1">Total expenses</td>
    <td></td>
    <td class="right">${fmtINR(mainExpCY)}</td>
    <td class="right">${fmtINR(mainExpPY)}</td>
  </tr>`

  // Profit before exceptional and extraordinary items and tax
  rn++
  const romanV = ROMAN[rn - 1]
  body += `<tr class="subtotal">
    <td><span class="roman">${romanV}.</span> Profit before exceptional and extraordinary items and tax (III - IV)</td>
    <td></td>
    <td class="right">${fmtINR(pbeetCY)}</td>
    <td class="right">${fmtINR(pbeetPY)}</td>
  </tr>`

  // Exceptional items
  rn++
  const romanVI = ROMAN[rn - 1]
  body += `<tr>
    <td><span class="roman">${romanVI}.</span> Exceptional items</td>
    <td class="center">${tail.exceptional.noteNum || ''}</td>
    <td class="right">${fmtINR(exceptCY)}</td>
    <td class="right">${fmtINR(exceptPY)}</td>
  </tr>`

  // Profit before extraordinary items and tax
  rn++
  const romanVII = ROMAN[rn - 1]
  body += `<tr class="subtotal">
    <td><span class="roman">${romanVII}.</span> Profit before extraordinary items and tax (${romanV} - ${romanVI})</td>
    <td></td>
    <td class="right">${fmtINR(pbetCY)}</td>
    <td class="right">${fmtINR(pbetPY)}</td>
  </tr>`

  // Extraordinary items
  rn++
  const romanVIII = ROMAN[rn - 1]
  body += `<tr>
    <td><span class="roman">${romanVIII}.</span> Extraordinary Items</td>
    <td class="center">${tail.extraordinary.noteNum || ''}</td>
    <td class="right">${fmtINR(extraCY)}</td>
    <td class="right">${fmtINR(extraPY)}</td>
  </tr>`

  // Profit before tax
  rn++
  const romanIX = ROMAN[rn - 1]
  body += `<tr class="subtotal">
    <td><span class="roman">${romanIX}.</span> Profit / (Loss) before tax (${romanVII} - ${romanVIII})</td>
    <td></td>
    <td class="right">${fmtINR(pbt)}</td>
    <td class="right">${fmtINR(prevPBT)}</td>
  </tr>`

  // Tax
  rn++
  const romanTax = ROMAN[rn - 1]
  body += `<tr><td colspan="4" class="section-header"><span class="roman">${romanTax}.</span> Tax expense:</td></tr>`
  if (taxSecs.length > 0) {
    taxSecs.forEach(sec => {
      sec.lines.forEach(line => {
        body += `<tr>
          <td class="indent-1">${esc(line.level2 || sec.level1)}</td>
          <td class="center">${line.noteNum || sec.noteNum || ''}</td>
          <td class="right">${fmtINR(line.total)}</td>
          <td class="right">${fmtINR(line.prevTotal)}</td>
        </tr>`
      })
    })
  } else {
    body += `<tr><td class="indent-1">(1) Current tax</td><td></td><td class="right">-</td><td class="right">-</td></tr>`
    body += `<tr><td class="indent-1">(2) Deferred tax</td><td></td><td class="right">-</td><td class="right">-</td></tr>`
  }

  // Profit from continuing operations, the discontinuing operations, and the profit for the period
  // (Schedule III XI - XV — the same lines the screen and Excel carry).
  rn++
  const romanCont = ROMAN[rn - 1]
  body += `<tr class="subtotal">
    <td><span class="roman">${romanCont}.</span> Profit / (Loss) for the period from continuing operations (${romanIX} - ${romanTax})</td>
    <td></td>
    <td class="right">${fmtINR(pat)}</td>
    <td class="right">${fmtINR(prevPAT)}</td>
  </tr>`
  rn++
  const romanDisc = ROMAN[rn - 1]
  body += `<tr>
    <td><span class="roman">${romanDisc}.</span> Profit / (loss) from discontinuing operations</td>
    <td class="center">${tail.discProfit.noteNum || ''}</td>
    <td class="right">${fmtINR(tail.discProfit.cy)}</td>
    <td class="right">${fmtINR(tail.discProfit.py)}</td>
  </tr>`
  rn++
  const romanDiscTax = ROMAN[rn - 1]
  body += `<tr>
    <td><span class="roman">${romanDiscTax}.</span> Tax expense of discontinuing operations</td>
    <td class="center">${tail.discTax.noteNum || ''}</td>
    <td class="right">${fmtINR(tail.discTax.cy)}</td>
    <td class="right">${fmtINR(tail.discTax.py)}</td>
  </tr>`
  rn++
  const romanDiscPat = ROMAN[rn - 1]
  body += `<tr class="subtotal">
    <td><span class="roman">${romanDiscPat}.</span> Profit / (loss) from discontinuing operations (after tax) (${romanDisc} - ${romanDiscTax})</td>
    <td></td>
    <td class="right">${fmtINR(tail.discAfterTax.cy)}</td>
    <td class="right">${fmtINR(tail.discAfterTax.py)}</td>
  </tr>`
  rn++
  body += `<tr class="total-row">
    <td><span class="roman">${ROMAN[rn - 1]}.</span> Profit / (Loss) for the period (${romanCont} + ${romanDiscPat})</td>
    <td></td>
    <td class="right">${fmtINR(pat + tail.discAfterTax.cy)}</td>
    <td class="right">${fmtINR(prevPAT + tail.discAfterTax.py)}</td>
  </tr>`

  // Earnings per equity share — Company only (Schedule III). EPS is a
  // per-share Rupee figure, so it deliberately does NOT go through fmtINR's
  // denomination scaling (Lacs/Crores would make it meaningless) — always
  // plain 2-decimal Rupees. A CA override (data.eps.overrides) always wins
  // over the auto-computed PAT/shares figure; a cell with neither is shown
  // red with a caution note, per the missing-Share-Capital-data warning.
  if (parseInt(constitution) === 3 && data.eps) {
    const fmtEps = (n) => (n === null || n === undefined || isNaN(n)) ? '' : Number(n).toFixed(2)
    const ov = data.eps.overrides || {}
    const basicCY = ov.basicCY ?? data.eps.autoBasicCY
    const basicPY = ov.basicPY ?? data.eps.autoBasicPY
    const dilutedCY = ov.dilutedCY ?? data.eps.autoDilutedCY
    const dilutedPY = ov.dilutedPY ?? data.eps.autoDilutedPY
    const cyRedBasic = data.eps.sharesMissingCY && ov.basicCY == null
    const pyRedBasic = data.eps.sharesMissingPY && ov.basicPY == null
    const cyRedDiluted = data.eps.sharesMissingCY && ov.dilutedCY == null
    const pyRedDiluted = data.eps.sharesMissingPY && ov.dilutedPY == null
    const redCell = (v) => `<td class="right" style="color:#dc2626;font-weight:600;">${v ? esc(v) : '<span style="font-style:italic;">Fill Share Capital</span>'}</td>`
    const cell = (v) => `<td class="right">${esc(v)}</td>`
    // No Previous Year at all (a first year of operation, or switched off): its EPS is a dash, like every other line - not a request to fill anything in.
    const pyCell = (v, overridden) => cell(fmtEps(v) || (data.eps.pyNotApplicable && !overridden ? '—' : ''))
    rn++
    body += `<tr><td colspan="4" class="indent-0"><span class="roman">${ROMAN[rn - 1]}.</span> Earnings per equity share:</td></tr>`
    body += `<tr>
      <td class="indent-1">(1) Basic</td>
      <td></td>
      ${cyRedBasic ? redCell(fmtEps(basicCY)) : cell(fmtEps(basicCY))}
      ${pyRedBasic ? redCell(fmtEps(basicPY)) : pyCell(basicPY, ov.basicPY != null)}
    </tr>`
    body += `<tr>
      <td class="indent-1">(2) Diluted</td>
      <td></td>
      ${cyRedDiluted ? redCell(fmtEps(dilutedCY)) : cell(fmtEps(dilutedCY))}
      ${pyRedDiluted ? redCell(fmtEps(dilutedPY)) : pyCell(dilutedPY, ov.dilutedPY != null)}
    </tr>`
    if (data.eps.sharesMissingCY || data.eps.sharesMissingPY) {
      body += `<tr><td colspan="4" style="color:#dc2626;font-style:italic;font-size:8pt;padding:2pt 5pt;">
        ⚠ Number of Equity Shares Issued &amp; Subscribed not found in the Share Capital note's Fill Details — EPS shown in red above until it is filled in.
      </td></tr>`
    }
  }

  return `
    <div class="print-page compact-page">
      <div class="page-body">
        ${pageHeader(entity, title, `for the year ended ${esc(yearEnd(activeTB?.period || ''))}`)}
        <table class="fs-table compact-table">
          <thead>
            <tr>
              <th style="width:52%"></th>
              <th style="width:8%" class="center">Note</th>
              <th style="width:20%" class="right">${cyLabel}</th>
              <th style="width:20%" class="right" data-py-col>${pyLabel}</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
        <div class="footer-text">The accompanying notes form an integral part of the financial statements.</div>
      </div>
      ${compactSignFooter(entity, auditor, signatories, { enabled: true, signPlace, signDate })}
    </div>`
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOWING SECTIONS (Notes, Annexures) — paged by measured height
// ═══════════════════════════════════════════════════════════════════════════
// These sections are paged inside the PDF window by flowLayoutScript(), which
// measures each block's real rendered height and fills a page before starting
// the next; a long table continues overleaf with Carried / Brought forward
// rows. They used to be paged by counting rows against a fixed budget, which
// ignored detail tables, schedules and wrapped text — pages spilled onto a
// near-empty extra page, or ended half blank. Without the script a section
// still prints correctly, as one long flowing page. Every section starts on a
// fresh page and prints its footer (when it has one) on each of its pages.
function flowSection(headerHtml, footerHtml, blocks) {
  if (!blocks.length) return ''
  return `
    <div class="flow-section">
      <div class="print-page flow-src">
        <div class="page-body">
          <div class="flow-header">${headerHtml}</div>
          <div class="flow-blocks">${blocks.join('\n')}</div>
        </div>
        <div class="flow-footer">${footerHtml}</div>
      </div>
    </div>`
}

// kind 'rows'     — may split between the rows of its [data-flow-table]
//      'children' — may split between the children of its [data-flow-children]
//                   (inside a lone wrapping <div>), or between a table's rows
//      'atomic'   — moves as a whole
// keepNext   — a heading: always stays with the block after it.
// contdTitle — printed as "<title> (contd.)" if this block starts a page.
function flowBlock(kind, html, { keepNext = false, contdTitle = '' } = {}) {
  return `<div class="flow-block" data-flow="${kind}"${keepNext ? ' data-flow-keep-next' : ''}${contdTitle ? ` data-flow-contd-title="${esc(contdTitle)}"` : ''}>${html}</div>`
}

// General Notes are written in a rich-text editor (TipTap) whose resizable
// tables store column widths in pixels — <table style="width: 1120px"> and
// <col style="width: 280px">. A table sized on a wide screen is wider than an
// A4 page, and Chromium then shrinks the ENTIRE PDF to fit it (one entity's
// statements printed at about two-thirds size). Keep the columns' proportions
// as shares of the page width instead.
// Column widths are then worked out from what each column HOLDS (0.1.94): the
// screen's equal-ish pixel widths split "Denominator" and "75,30,546.59" in the
// middle of a word in the PDF. Every column gets room for its longest word, the
// rest of the page goes to the columns with the most text. Tables with merged
// cells keep the proportions of the screen.
export function contentColumnWidths(inner) {
  const rows = inner.match(/<tr\b[\s\S]*?<\/tr>/gi) || []
  const min = [], max = []
  for (const row of rows) {
    const cells = row.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) || []
    let c = 0
    for (const cell of cells) {
      if (/\s(?:col|row)span\s*=\s*["']?(?:[2-9]|\d\d)/i.test(cell.slice(0, cell.indexOf('>') + 1))) return null
      const text = cell.replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
      const longestWord = text.split(' ').reduce((m, w) => Math.max(m, w.length), 0)
      min[c] = Math.max(min[c] || 0, longestWord)
      max[c] = Math.max(max[c] || 0, Math.min(text.length, 70))
      c++
    }
  }
  if (!min.length) return null
  const pad = 2.6   // cell padding, in characters
  const mn = min.map(v => (v || 1) + pad)
  const mx = mn.map((m, i) => Math.max(m, (max[i] || 1) + pad))
  const sumMin = mn.reduce((a, b) => a + b, 0), sumMax = mx.reduce((a, b) => a + b, 0)
  // The page holds about 85 characters of 10pt bold across. If the longest words alone need more, the table's text steps down (8pt at the least)
  // so that no word is split.
  const CAPACITY = 85
  const fontPt = sumMin > CAPACITY ? Math.max(8, Math.floor(10 * CAPACITY / sumMin * 10) / 10) : 10
  const cap = CAPACITY * 10 / fontPt
  let w
  if (sumMax <= cap) w = mx.map(v => v * 100 / sumMax)
  else if (sumMin >= cap) w = mn.map(v => v * 100 / sumMin)
  else { const room = cap - sumMin, want = sumMax - sumMin; w = mn.map((m, i) => (m + room * (mx[i] - m) / want) * 100 / cap) }
  const total = w.reduce((a, b) => a + b, 0)
  const out = w.map(v => v * 100 / total)
  out.fontPt = fontPt
  return out
}

export function fitRichTextTables(html) {
  return String(html || '').replace(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi, (whole, attrs, inner) => {
    const cols = []
    inner.replace(/<col\b[^>]*>/gi, (tag) => {
      const m = /(?:^|[\s;"])width:\s*([\d.]+)px/i.exec(tag)
      cols.push(m ? parseFloat(m[1]) : null)
      return tag
    })
    const known = cols.filter(w => w > 0)
    let innerOut = inner
    const fitted = contentColumnWidths(inner)
    let fontStyle = ''
    if (fitted) {
      innerOut = inner.replace(/<colgroup\b[\s\S]*?<\/colgroup>/gi, '')
      innerOut = `<colgroup>${fitted.map(p => `<col style="width: ${p.toFixed(2)}%">`).join('')}</colgroup>` + innerOut
      if (fitted.fontPt < 10) fontStyle = `font-size: ${fitted.fontPt}pt;`
    } else if (known.length) {
      const avg = known.reduce((a, b) => a + b, 0) / known.length
      const widths = cols.map(w => (w > 0 ? w : avg))
      const total = widths.reduce((a, b) => a + b, 0)
      let k = 0
      innerOut = inner.replace(/<col\b([^>]*)>/gi, (tag, colAttrs) => {
        const pct = ((widths[k++] / total) * 100).toFixed(2)
        return `<col${colAttrs.replace(/\sstyle="[^"]*"/i, '')} style="width: ${pct}%">`
      })
    }
    const attrsOut = attrs.replace(/\sstyle="([^"]*)"/i, (m, style) => {
      const cleaned = style.replace(/(?:min-)?width:\s*[\d.]+px;?\s*/gi, '').trim()
      return cleaned ? ` style="${cleaned}${fontStyle}"` : (fontStyle ? ` style="${fontStyle}"` : '')
    })
    const attrsFinal = fontStyle && !/\sstyle=/.test(attrsOut) ? `${attrsOut} style="${fontStyle}"` : attrsOut
    return `<table${attrsFinal} data-rich-table>${innerOut}</table>`
  })
}

// Runs INSIDE the PDF window — injected as source text, so it must not use
// anything else from this module — once the document has rendered, before
// printing. src/main/ipc/financials.js waits for window.__flowDone.
function flowLayoutScript() {
  var FITTABLE = 'table, img, pre, .sigf-grid, .sign-container, .general-note-body > *'

  // 1. Nothing may be wider than its page: one over-wide element makes
  //    Chromium shrink the whole PDF to fit it. Shrink just that element.
  function fitWide(page) {
    var maxW = page.clientWidth
    if (!maxW) return
    var els = page.querySelectorAll(FITTABLE)
    for (var i = 0; i < els.length; i++) {
      var el = els[i]
      if (el.parentElement && el.parentElement.closest('[data-flow-fitted]')) continue
      var w = el.scrollWidth
      if (w > maxW + 1) {
        el.style.zoom = String(Math.max(0.5, Math.floor((maxW / w) * 1000) / 1000))
        el.setAttribute('data-flow-fitted', '')
      }
    }
  }

  // 2. The Balance Sheet and the Statement of Profit and Loss stay on one page.
  //    Their tables start at 10.5pt with normal spacing; if that overflows,
  //    spacing tightens first (down to none at 10pt: a Company face carries
  //    Trade payables (A)/(B) in full Schedule III wording), then the type steps down — below 10pt only when
  //    nothing else keeps the statement on one page.
  var FACE_STEPS = [
    ['10.5pt', '1.5pt', '1.2'], ['10.5pt', '0.8pt', '1.15'], ['10pt', '0.8pt', '1.15'], ['10pt', '0.3pt', '1.1'], ['10pt', '0.1pt', '1.05'], ['10pt', '0pt', '1'],
    ['9.5pt', '0.3pt', '1.1'], ['9pt', '0.3pt', '1.05'], ['8.5pt', '0.2pt', '1.05'], ['8pt', '0.2pt', '1'],
  ]
  function fitOnePage(page) {
    var body = page.querySelector('.page-body')
    if (!body || !page.querySelector('.compact-table')) return
    page.classList.add('fit-measure')
    var chosen = FACE_STEPS[FACE_STEPS.length - 1]
    for (var i = 0; i < FACE_STEPS.length; i++) {
      page.style.setProperty('--face-font', FACE_STEPS[i][0])
      page.style.setProperty('--face-pad', FACE_STEPS[i][1])
      page.style.setProperty('--face-lh', FACE_STEPS[i][2])
      if (body.scrollHeight <= body.clientHeight + 1) { chosen = FACE_STEPS[i]; break }
    }
    page.style.setProperty('--face-font', chosen[0])
    page.style.setProperty('--face-pad', chosen[1])
    page.style.setProperty('--face-lh', chosen[2])
    page.setAttribute('data-face-font', chosen[0])
    page.classList.remove('fit-measure')
  }

  // 3. Fill Details / schedule tables print at 10pt like the rest of the
  //    statements. Only a table too wide for the page at 10pt steps down, half
  //    a point at a time, to the largest size at which it fits (7pt at the
  //    least; anything still wider is then shrunk by fitWide).
  var FD_STEPS = ['10pt', '9.5pt', '9pt', '8.5pt', '8pt', '7.5pt', '7pt']
  function fitFillDetails(page) {
    var maxW = page.clientWidth
    if (!maxW) return
    var left = page.getBoundingClientRect().left
    var tables = page.querySelectorAll('.fill-details table')
    for (var i = 0; i < tables.length; i++) {
      var t = tables[i]
      var s = 0
      for (; s < FD_STEPS.length; s++) {
        t.style.setProperty('--fd-font', FD_STEPS[s])
        if (t.getBoundingClientRect().right - left <= maxW + 1) break
      }
      t.setAttribute('data-fd-font', FD_STEPS[Math.min(s, FD_STEPS.length - 1)])
    }
  }

  function toArray(list) { return Array.prototype.slice.call(list) }
  var partSeq = 0

  function layoutSection(section) {
    var src = section.querySelector('.flow-src')
    if (!src) return
    var headerEl = src.querySelector('.flow-header')
    var footerEl = src.querySelector('.flow-footer')
    var headerHTML = headerEl ? headerEl.innerHTML : ''
    var footerHTML = footerEl ? footerEl.innerHTML : ''
    var list = src.querySelector('.flow-blocks')
    var blocks = list ? toArray(list.children) : []

    // A heading block travels with the block after it.
    var units = []
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i]
      if (b.hasAttribute('data-flow-keep-next') && i + 1 < blocks.length) {
        var nxt = blocks[i + 1]
        var group = document.createElement('div')
        group.className = 'flow-block flow-group'
        group.setAttribute('data-flow', nxt.getAttribute('data-flow') || 'atomic')
        group.appendChild(b)
        group.appendChild(nxt)
        units.push(group)
        i++
      } else {
        units.push(b)
      }
    }
    section.removeChild(src)

    function newPage() {
      var pg = document.createElement('div')
      pg.className = 'print-page flow-page'
      pg.innerHTML = '<div class="page-body">' + headerHTML + '<div class="flow-page-content"></div></div>' + footerHTML
      section.appendChild(pg)
      return { body: pg.querySelector('.page-body'), content: pg.querySelector('.flow-page-content'), overflowed: false }
    }
    function fits(p) { return p.body.scrollHeight <= p.body.clientHeight + 1 }
    function setShown(els, k, saved) {
      for (var i = 0; i < els.length; i++) els[i].style.display = i < k ? saved[i] : 'none'
    }
    function markContinued(el) {
      var t = el.querySelector('[data-flow-title]')
      if (t && !t.hasAttribute('data-flow-contd')) {
        t.setAttribute('data-flow-contd', '')
        t.appendChild(document.createTextNode(' (contd.)'))
      }
    }
    function carryRow(tpl, fromRow) {
      var cy = (fromRow && fromRow.getAttribute('data-cum-cy')) || ''
      var py = (fromRow && fromRow.getAttribute('data-cum-py')) || ''
      var holder = document.createElement('tbody')
      holder.innerHTML = tpl.innerHTML.replace('{CY}', cy).replace('{PY}', py)
      var tr = holder.firstElementChild
      tr.setAttribute('data-cum-cy', cy)
      tr.setAttribute('data-cum-py', py)
      tr.setAttribute('data-flow-carry', '')
      return tr
    }

    // Keeps as many rows on this page as fit (with a Carried forward row) and
    // returns the rest as a new block that starts with Brought forward.
    function splitRows(p, block, onlyChild) {
      var table = block.querySelector('[data-flow-table]')
      if (!table || !table.tBodies[0]) return null
      var tbody = table.tBodies[0]
      var rows = toArray(tbody.rows)
      var n = rows.length
      var saved = rows.map(function (r) { return r.style.display })
      var cfTpl = block.querySelector('template[data-flow-cf]')
      var bfTpl = block.querySelector('template[data-flow-bf]')
      var minHead = (onlyChild ? 1 : 2) + (n && rows[0].hasAttribute('data-flow-carry') ? 1 : 0)
      var maxK = n - 2                       // never leave the Total row alone overleaf
      if (maxK < minHead) return null
      var cf = null
      var show = function (k) {
        setShown(rows, k, saved)
        if (cf) { cf.remove(); cf = null }
        if (cfTpl) { cf = carryRow(cfTpl, rows[k - 1]); tbody.insertBefore(cf, rows[k]) }
      }
      var lo = 1, hi = maxK, best = 0
      while (lo <= hi) {
        var mid = (lo + hi) >> 1
        show(mid)
        if (fits(p)) { best = mid; lo = mid + 1 } else { hi = mid - 1 }
      }
      while (best > 0 && rows[best - 1].hasAttribute('data-keep-next')) best--
      setShown(rows, n, saved)
      if (cf) { cf.remove(); cf = null }
      if (best < minHead) return null

      if (!block.hasAttribute('data-flow-part')) block.setAttribute('data-flow-part', String(++partSeq))
      var tail = block.cloneNode(true)
      for (var i = best; i < n; i++) rows[i].remove()
      if (cfTpl) tbody.appendChild(carryRow(cfTpl, rows[best - 1]))
      var tBody = tail.querySelector('[data-flow-table]').tBodies[0]
      var tRows = toArray(tBody.rows)
      for (var j = 0; j < best; j++) tRows[j].remove()
      if (bfTpl) tBody.insertBefore(carryRow(bfTpl, rows[best - 1]), tBody.firstChild)
      markContinued(tail)
      return tail
    }

    // Where a 'children' block may break: between the children of its
    // [data-flow-children] box — or, when that box holds a single <div> (the
    // Fill Details renderers wrap all their sub-tables in one), inside it.
    function childBox(block) {
      var box = block.querySelector('[data-flow-children]')
      while (box && box.children.length === 1 && box.firstElementChild.tagName === 'DIV' && box.firstElementChild.children.length) {
        box = box.firstElementChild
      }
      return box
    }
    // A short heading or caption directly above a table, or a titled part, is
    // never left at the foot of a page on its own.
    function isLeadIn(el) {
      if (!el || !el.nextElementSibling || el.tagName === 'TABLE' || el.querySelector('table')) return false
      if (el.hasAttribute('data-flow-title')) return true
      var text = (el.textContent || '').replace(/\s+/g, ' ').trim()
      if (!text || text.length > 160) return false
      if (parseInt(getComputedStyle(el).fontWeight, 10) >= 600) return true
      var strong = el.querySelector('strong, b')
      if (strong && strong.textContent.replace(/\s+/g, ' ').trim().length >= text.length - 2) return true
      var next = el.nextElementSibling
      return text.length <= 80 && (next.tagName === 'TABLE' || !!next.querySelector('table'))
    }
    function tableIn(el) {
      if (!el) return null
      if (el.tagName === 'TABLE') return el
      if (el.tagName === 'DIV' && el.children.length === 1 && el.firstElementChild.tagName === 'TABLE') return el.firstElementChild
      return null
    }
    // Leading body rows made only of <th> cells are header rows (rich-text
    // tables have no <thead>); a table continued overleaf repeats them.
    function tableParts(table) {
      var rows = toArray(table.tBodies[0].rows)
      var head = 0
      if (!table.tHead) {
        while (head < rows.length - 1 && toArray(rows[head].cells).every(function (c) { return c.tagName === 'TH' })) head++
      }
      return { rows: rows, head: head }
    }
    function rowSplittable(table) {
      if (!table || table.tBodies.length !== 1) return false
      var rows = table.tBodies[0].rows
      for (var r = 0; r < rows.length; r++) {
        for (var c = 0; c < rows[r].cells.length; c++) if (rows[r].cells[c].rowSpan > 1) return false
      }
      return true
    }
    // How many body rows of the table fit on this page — at least two, and at
    // least two must continue overleaf; 0 when the table should move whole.
    function fitTableRows(p, table) {
      var parts = tableParts(table), rows = parts.rows, head = parts.head
      var lo = 2, hi = rows.length - head - 2, best = 0
      if (hi < lo) return 0
      var saved = rows.map(function (r) { return r.style.display })
      while (lo <= hi) {
        var mid = (lo + hi) >> 1
        setShown(rows, head + mid, saved)
        if (fits(p)) { best = mid; lo = mid + 1 } else { hi = mid - 1 }
      }
      setShown(rows, rows.length, saved)
      return best
    }

    // A bulleted / numbered list breaks between its items, like a table between
    // its rows (a policy written as a list used to be one unbreakable piece).
    function listIn(el) {
      if (!el) return null
      if (el.tagName === 'UL' || el.tagName === 'OL') return el.children.length >= 2 ? el : null
      if (el.tagName === 'DIV' && el.children.length === 1) return listIn(el.firstElementChild)
      return null
    }
    // How many items of the list fit on this page — at least one, and at least
    // one must continue overleaf; 0 when the list should move whole.
    function fitListItems(p, list) {
      var items = toArray(list.children)
      var saved = items.map(function (it) { return it.style.display })
      var lo = 1, hi = items.length - 1, best = 0
      while (lo <= hi) {
        var mid = (lo + hi) >> 1
        setShown(items, mid, saved)
        if (fits(p)) { best = mid; lo = mid + 1 } else { hi = mid - 1 }
      }
      setShown(items, items.length, saved)
      return best
    }

    // Keeps as many child parts (paragraphs, sub-tables, lists) as fit — and,
    // when the next part is a table or a list, as many of its rows or items as
    // fit — and returns the rest.
    function splitChildren(p, block, onlyChild) {
      var box = childBox(block)
      if (!box) return null
      var kids = toArray(box.children)
      var n = kids.length
      if (!n) return null
      var saved = kids.map(function (k) { return k.style.display })
      var lo = 1, hi = n - 1, best = 0
      while (lo <= hi) {
        var mid = (lo + hi) >> 1
        setShown(kids, mid, saved)
        if (fits(p)) { best = mid; lo = mid + 1 } else { hi = mid - 1 }
      }
      // A closing part flagged data-flow-trailer (the signature block after the
      // last policy) never goes overleaf on its own: the part before it — or
      // the last rows / items of that table or list — goes with it.
      var trailerPulled = false
      if (best > 0 && best === n - 1 && kids[best].hasAttribute('data-flow-trailer')) { best--; trailerPulled = true }
      var table = tableIn(kids[best])
      var keepRows = 0
      if (table && rowSplittable(table)) {
        setShown(kids, best + 1, saved)
        keepRows = fitTableRows(p, table)
      }
      var list = keepRows ? null : listIn(kids[best])
      var keepItems = 0
      if (list) {
        setShown(kids, best + 1, saved)
        keepItems = fitListItems(p, list)
      }
      setShown(kids, n, saved)
      var partial = keepRows > 0 || keepItems > 0
      if (!partial) while (best > 0 && isLeadIn(kids[best - 1])) best--
      if (!partial && best < 1) {
        // Nothing before the trailer can break. Where the block can still move
        // to a fresh page, it moves whole; where it already starts one, the
        // trailer goes overleaf on its own rather than overfilling this page.
        if (!(trailerPulled && onlyChild)) return null
        best = n - 1
      }

      if (!block.hasAttribute('data-flow-part')) block.setAttribute('data-flow-part', String(++partSeq))
      if (keepRows && !table.hasAttribute('data-flow-split')) table.setAttribute('data-flow-split', String(++partSeq))
      box.setAttribute('data-flow-box', '')
      var tail = block.cloneNode(true)
      box.removeAttribute('data-flow-box')
      var tBox = tail.querySelector('[data-flow-box]')
      tBox.removeAttribute('data-flow-box')
      var tKids = toArray(tBox.children)
      for (var i = partial ? best + 1 : best; i < n; i++) kids[i].remove()
      if (keepRows) {
        var parts = tableParts(table)
        var tRows = toArray(tableIn(tKids[best]).tBodies[0].rows)
        for (var a = parts.head + keepRows; a < parts.rows.length; a++) parts.rows[a].remove()
        for (var c = parts.head; c < parts.head + keepRows; c++) tRows[c].remove()
      }
      if (keepItems) {
        var items = toArray(list.children)
        var tList = listIn(tKids[best])
        var tItems = toArray(tList.children)
        for (var e = keepItems; e < items.length; e++) items[e].remove()
        for (var f = 0; f < keepItems; f++) tItems[f].remove()
        // A numbered list carries on from the number it reached.
        if (tList.tagName === 'OL') tList.setAttribute('start', String((parseInt(list.getAttribute('start'), 10) || 1) + keepItems))
      }
      for (var j = 0; j < best; j++) tKids[j].remove()
      markContinued(tail)
      return tail
    }

    // A block that would fit on a page of its own moves to the next page whole
    // rather than being broken — a short note is not started at the foot of
    // one page and finished at the top of the next — as long as that leaves no
    // more than a quarter of this page blank. Anything bigger is split.
    var KEEP_TOGETHER_BLANK = 0.25
    function movesWhole(p, block) {
      var bodyTop = p.body.getBoundingClientRect().top
      var room = p.body.clientHeight - (block.getBoundingClientRect().top - bodyTop)
      var capacity = p.body.clientHeight - (p.content.getBoundingClientRect().top - bodyTop)
      return room <= KEEP_TOGETHER_BLANK * p.body.clientHeight && block.getBoundingClientRect().height <= capacity
    }

    function place(p, block) {
      for (var guard = 0; block && guard < 10000; guard++) {
        var contd = block.getAttribute('data-flow-contd-title')
        var heading = null
        if (contd && p.content.children.length === 0) {
          heading = document.createElement('div')
          heading.className = 'note-block'
          heading.innerHTML = '<div class="note-title"></div>'
          heading.firstChild.textContent = contd + ' (contd.)'
          p.content.appendChild(heading)
        }
        p.content.appendChild(block)
        if (fits(p)) return p
        var onlyChild = p.content.children.length === (heading ? 2 : 1)
        if (!onlyChild && movesWhole(p, block)) {
          p.content.removeChild(block)
          p = newPage()
          continue
        }
        var kind = block.getAttribute('data-flow') || 'atomic'
        var tail = kind === 'rows' ? splitRows(p, block, onlyChild)
          : kind === 'children' ? splitChildren(p, block, onlyChild)
          : null
        if (tail) { p = newPage(); block = tail; continue }
        if (!onlyChild) {
          p.content.removeChild(block)
          if (heading) p.content.removeChild(heading)
          p = newPage()
          continue
        }
        // Taller than a whole page and cannot be split: printed as is; the
        // next block starts on a fresh page.
        p.overflowed = true
        return p
      }
      return p
    }

    var page = newPage()
    for (var u = 0; u < units.length; u++) {
      if (page.overflowed) page = newPage()
      page = place(page, units[u])
    }
  }

  function run() {
    var pages = document.querySelectorAll('.print-page')
    for (var d = 0; d < pages.length; d++) fitFillDetails(pages[d])
    for (var i = 0; i < pages.length; i++) fitWide(pages[i])
    var faces = document.querySelectorAll('.compact-page')
    for (var f = 0; f < faces.length; f++) fitOnePage(faces[f])
    var sections = document.querySelectorAll('.flow-section')
    for (var s = 0; s < sections.length; s++) {
      var before = sections[s].innerHTML
      try {
        layoutSection(sections[s])
      } catch (err) {
        // Put this section back as one long page: it still prints everything.
        sections[s].innerHTML = before
        window.__flowError = String((err && err.stack) || err)
      }
    }
    window.__flowDone = true
  }

  var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()
  fontsReady.then(run, run)
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTES (no ledger names — only Level 3 / Level 4 breakdown for BS, Level 2 for PL)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build note rows WITHOUT ledger-level details.
 * For BS notes, prefers LevelFormat template rows (note.templateRows) if present.
 */
function buildNoteRows(note) {
  const rows = []
  if (note.isPL) {
    // Same lines as the Notes screen and the Excel export (plNoteLines).
    for (const { line, label } of plNoteLines(note)) {
      rows.push({ type: 'l2', label, cy: line.total, py: line.prevTotal, isSubtotal: !!line.isSubtotal })
    }
    return rows
  }

  // PPE note: when the IT Act Block-wise WDV Summary or the Dep (Comp)
  // category-level Schedule II schedule is present, it supersedes the plain
  // "Property, Plant & Equipment / Total" sub-row — same suppression as the
  // live Notes screen and the Excel export. The two are mutually exclusive
  // by construction, so at most one of these is ever non-empty.
  if (note.itBlockSummaryData && note.itBlockSummaryData.length > 0) return rows
  if (note.compScheduleData && note.compScheduleData.length > 0) return rows

  // BS: prefer template rows (from LevelFormat) when available
  if (note.templateRows && note.templateRows.length > 0) {
    // Level 4 / 6 flags are for the Notes screen (Fix), not for print.
    // printNoteRows: a Level 3 with a breakdown prints as a header (no in-note
    // subtotal) and a repeat breakdown of the same figure is dropped.
    for (const r of printNoteRows(note.templateRows.filter(r => !r.screenOnly))) {
      rows.push({ type: r.type, label: r.displayLabel || r.label, cy: r.cy, py: r.py, unclassified: r.unclassified, isSubtotal: r.isSubtotal,
                  header: !!r.header, breakdown: !!r.breakdown, isMSME: !!(r.isMSME || r.isMSMEHeader) })
    }
    return rows
  }

  // Fallback: same lines the Notes screen and the Excel export show
  // (bsNoteFallbackLines) — a ledger with no Level 3 forms no line.
  for (const l of bsNoteFallbackLines(note, rowAmt)) {
    rows.push({ type: 'l3', label: l.label, cy: l.cy, py: l.py, isSubtotal: l.isSubtotal })
  }
  return rows
}

function renderNoteTable(note, rows, { cyShort, pyShort }) {
  // Each row carries the running total through itself (data-cum-cy/py), so the
  // page layout script can print a correct "Carried forward" / "Brought
  // forward" pair wherever it has to split this table across pages. A header
  // (a Level 3 printed without an amount), a breakdown of a figure already
  // counted above it, and a subtotal line are not added.
  let body = ''
  let cumCY = 0, cumPY = 0
  rows.forEach((r, idx) => {
    let cls = ''
    let indent = 'indent-1'
    if (r.type === 'l3') { cls = r.isSubtotal ? 'note-subtotal' : 'note-l3'; indent = 'indent-1' }
    else if (r.type === 'l4') { indent = 'indent-2' }
    else if (r.type === 'option') {
      indent = 'indent-2'
      if (r.unclassified) cls = 'note-unclassified'
    }
    const next = rows[idx + 1]
    const isParent = !!r.header || (r.type === 'l3' && !!next && !!next.breakdown)   // kept with the rows under it
    // The MSME disclosure (principal / interest / total, the amounts under section 22) is a disclosure of the Trade payables above it,
    // not further payables: it was added to the running total, so "Carried forward" showed one figure twice (663.38 for 531.07).
    if (!r.header && !r.breakdown && !r.isSubtotal && !r.isMSME) { cumCY += Number(r.cy) || 0; cumPY += Number(r.py) || 0 }
    // "Less: Closing …" is underlined — Opening minus this = the Change in
    // Inventory subtotal directly below it, same convention as a manual worksheet.
    const closingUnderline = /^less:\s*closing/i.test(r.label || '') ? ' style="text-decoration:underline"' : ''
    body += `<tr class="${cls}" data-cum-cy="${fmtINR(cumCY)}" data-cum-py="${fmtINR(cumPY)}"${isParent ? ' data-keep-next' : ''}>
      <td class="${indent}${r.type === 'option' ? ' option-row' : ''}"${closingUnderline}>${esc(r.label)}</td>
      <td></td>
      <td class="right"${closingUnderline}>${r.header ? '' : fmtINR(r.cy)}</td>
      <td class="right"${closingUnderline}>${r.header ? '' : fmtINR(r.py)}</td>
    </tr>`
  })
  body += `<tr class="total-row">
      <td>Total</td>
      <td></td>
      <td class="right">${fmtINR(note.total)}</td>
      <td class="right">${fmtINR(note.prevTotal)}</td>
    </tr>`
  const carry = (label) => `<tr class="subtotal">
      <td class="indent-1 carryfwd-text">${label}</td>
      <td></td>
      <td class="right carryfwd-text">{CY}</td>
      <td class="right carryfwd-text">{PY}</td>
    </tr>`

  // Compact column header — just the period dates, not the verbose "Particulars / Current Year / Previous Year"
  const cy = cyShort || '(₹)'
  const py = pyShort || '(₹)'
  return `
    <div class="note-block">
      <div class="note-title" data-flow-title>Note ${note.num}: ${esc(note.displayTitle || note.title)}</div>
      <table class="fs-table" data-flow-table>
        <thead class="note-col-hdr">
          <tr>
            <th style="width:60%"></th>
            <th style="width:5%"></th>
            <th style="width:17.5%" class="right">${esc(cy)}</th>
            <th style="width:17.5%" class="right" data-py-col>${esc(py)}</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
      <template data-flow-cf>${carry('Carried forward to next page')}</template>
      <template data-flow-bf>${carry('Brought forward from previous page')}</template>
    </div>`
}

// ── Share Capital note details HTML renderer ──────────────────────────────────
function renderShareCapitalDetails(details, noteNum, cyLabel, pyLabel, cyTotal, pyTotal, isCompany = false) {
  if (!details || !details.classes?.length) return ''
  // Money: always 2 decimals, matching every other figure on the statements.
  // Shares: a count, never fractional — no decimals, ever.
  const fmtN = fmtINR  // module-level, denomination-scaled — see _DENOM_KEY at the top of this file
  const fmtShares = (n) => n != null && n !== '' && !isNaN(n) ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'
  const num = (v) => parseFloat(v) || 0
  const thStyle = 'border:1px solid #ccc;padding:3pt 5pt;font-weight:bold;font-size:8pt;text-align:right;'
  const tdStyle = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;'
  const tdR = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;text-align:right;font-variant-numeric:tabular-nums;'

  // page-break-inside: avoid — if this table doesn't fit in the remaining
  // space on the current page, push the WHOLE table onto the next page
  // rather than letting Chromium's PDF renderer split it mid-table. A table
  // too tall to fit on ANY single page still splits as a fallback — this
  // only prevents splitting when it would otherwise fit on one page.
  let html = `<div style="margin-top:6mm;margin-bottom:4mm;page-break-inside:avoid;break-inside:avoid;">`

  // Section A: Authorised / Issued / Subscribed / Paid-up per class
  html += `<p style="font-weight:bold;font-size:9pt;margin:2mm 0 1mm;">${noteNum}(a) Details of Share Capital</p>`
  html += `<table style="width:100%;border-collapse:collapse;margin-bottom:3mm;">`
  html += `<thead><tr>
    <th style="${thStyle}text-align:left;">Particulars</th>
    <th style="${thStyle}">${cyLabel}<br/>No. of Shares</th>
    <th style="${thStyle}">${cyLabel}<br/>Amount (₹)</th>
    <th style="${thStyle}">${pyLabel}<br/>No. of Shares</th>
    <th style="${thStyle}">${pyLabel}<br/>Amount (₹)</th>
  </tr></thead><tbody>`

  for (const cls of details.classes) {
    html += `<tr><td colspan="5" style="${tdStyle}font-weight:bold;background:#f9fafb;">${esc(cls.name)} (Face Value: ₹${cls.faceValue})</td></tr>`
    for (const [label, field] of [['Authorised','authorised'],['Issued','issued'],['Subscribed','subscribed'],['Subscribed & Fully Paid-up','paidUp']]) {
      const cyS = num(cls.cy[field]); const cyA = cyS * num(cls.faceValue)
      const pyS = num(cls.py[field]); const pyA = pyS * num(cls.faceValue)
      html += `<tr>
        <td style="${tdStyle}padding-left:8pt;">${label}</td>
        <td style="${tdR}">${cyS ? fmtShares(cyS) : '—'}</td>
        <td style="${tdR}">${cyS ? fmtN(cyA) : '—'}</td>
        <td style="${tdR}">${pyS ? fmtShares(pyS) : '—'}</td>
        <td style="${tdR}">${pyS ? fmtN(pyA) : '—'}</td>
      </tr>`
    }
  }
  html += `</tbody></table>`

  // ── BS tally check: form paidUp total vs mapped TB total ─────────────────
  if (cyTotal != null) {
    const formCY = details.classes.reduce((s, cls) => s + num(cls.cy?.paidUp) * num(cls.faceValue), 0)
    const mappedCY = Math.abs(cyTotal)
    const diff = Math.abs(Math.abs(formCY) - mappedCY)
    if (diff > 1) {
      html += `<div style="color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:3pt;padding:4pt 8pt;margin:2mm 0 3mm;font-size:8pt;">
        ⚠&nbsp;<strong>Balance Sheet Tally Mismatch</strong> &mdash;
        Subscribed &amp; Fully Paid-up as per form: <strong>₹${fmtN(formCY)}</strong> &nbsp;|&nbsp;
        As per Mapped Trial Balance: <strong>₹${fmtN(mappedCY)}</strong> &nbsp;|&nbsp;
        Difference: <strong>₹${fmtN(diff)}</strong>
      </div>`
    }
  }

  // Section B: Reconciliation
  html += `<p style="font-weight:bold;font-size:9pt;margin:2mm 0 1mm;">${noteNum}(b) Reconciliation of Number of Shares</p>`
  for (const cls of details.classes) {
    const cyClosing = num(cls.cy.openingShares) + num(cls.cy.issuedDuringYear) - num(cls.cy.deletedDuringYear)
    const pyClosing = num(cls.py.openingShares) + num(cls.py.issuedDuringYear) - num(cls.py.deletedDuringYear)
    html += `<table style="width:100%;border-collapse:collapse;margin-bottom:2mm;">`
    html += `<thead><tr>
      <th style="${thStyle}text-align:left;">${esc(cls.name)}</th>
      <th style="${thStyle}">${cyLabel} Shares</th><th style="${thStyle}">${cyLabel} Amount</th>
      <th style="${thStyle}">${pyLabel} Shares</th><th style="${thStyle}">${pyLabel} Amount</th>
    </tr></thead><tbody>`
    for (const [label, field] of [['Opening Balance','openingShares'],['Issued during the year','issuedDuringYear'],['Deleted / Bought back','deletedDuringYear']]) {
      const cs = num(cls.cy[field]); const ps = num(cls.py[field])
      html += `<tr><td style="${tdStyle}">${label}</td><td style="${tdR}">${fmtShares(cs)}</td><td style="${tdR}">${fmtN(cs*num(cls.faceValue))}</td><td style="${tdR}">${fmtShares(ps)}</td><td style="${tdR}">${fmtN(ps*num(cls.faceValue))}</td></tr>`
    }
    html += `<tr style="font-weight:bold;background:#f0f4ff;"><td style="${tdStyle}">Closing Balance</td>
      <td style="${tdR}">${fmtShares(cyClosing)}</td><td style="${tdR}">${fmtN(cyClosing*num(cls.faceValue))}</td>
      <td style="${tdR}">${fmtShares(pyClosing)}</td><td style="${tdR}">${fmtN(pyClosing*num(cls.faceValue))}</td></tr>`
    html += `</tbody></table>`
  }

  // Section C: 5% shareholders
  if (details.shareholders5pctEquity?.length) {
    html += `<p style="font-weight:bold;font-size:9pt;margin:2mm 0 1mm;">${noteNum}(c) Equity Shareholders holding more than 5%</p>`
    html += `<table style="width:100%;border-collapse:collapse;margin-bottom:3mm;"><thead><tr>
      <th style="${thStyle}text-align:left;">Name of Shareholder</th>
      <th style="${thStyle}">${cyLabel} Shares</th><th style="${thStyle}">${cyLabel} %</th>
      <th style="${thStyle}">${pyLabel} Shares</th><th style="${thStyle}">${pyLabel} %</th>
    </tr></thead><tbody>`
    for (const s of details.shareholders5pctEquity) {
      html += `<tr><td style="${tdStyle}">${esc(s.name)}</td><td style="${tdR}">${fmtShares(s.cyShares)}</td><td style="${tdR}">${s.cyPct}%</td><td style="${tdR}">${fmtShares(s.pyShares)}</td><td style="${tdR}">${s.pyPct}%</td></tr>`
    }
    html += `</tbody></table>`
  }

  // Section D: Promoters
  if (details.promoters?.length) {
    html += `<p style="font-weight:bold;font-size:9pt;margin:2mm 0 1mm;">${noteNum}(d) Shares held by Promoters</p>`
    html += `<table style="width:100%;border-collapse:collapse;margin-bottom:3mm;"><thead><tr>
      <th style="${thStyle}text-align:left;">Name of Promoter</th>
      <th style="${thStyle}text-align:left;">Class</th>
      <th style="${thStyle}">No. of Shares</th><th style="${thStyle}">% of Total</th><th style="${thStyle}">% Change</th>
    </tr></thead><tbody>`
    for (const p of details.promoters) {
      html += `<tr><td style="${tdStyle}">${esc(p.name)}</td><td style="${tdStyle}">${esc(p.class)}</td><td style="${tdR}">${fmtShares(p.shares)}</td><td style="${tdR}">${p.pctTotal}%</td><td style="${tdR}">${p.pctChange || '—'}</td></tr>`
    }
    html += `</tbody></table>`
  }

  // Company: disclosures (e) to (l) (utils/shareCapitalDisclosures.js) —
  // heading, then the text justified and indented under it; "•" lines as
  // bullet points with a hanging indent. Each heading stays with its text.
  if (isCompany) {
    for (const s of printedDisclosures(details)) {
      html += `<p style="font-weight:bold;font-size:9pt;margin:2.5mm 0 0.8mm;">${noteNum}(${s.key}) ${esc(s.heading)}</p>`
      for (const para of disclosureParagraphs(s.text)) {
        html += para.bullet
          ? `<p style="margin:0 0 1mm 28pt;text-indent:-10pt;text-align:justify;">•&nbsp;&nbsp;${esc(para.text)}</p>`
          : `<p style="margin:0 0 1mm 14pt;text-align:justify;">${esc(para.text)}</p>`
      }
    }
  } else if (details.rights) {
    html += `<p style="font-weight:bold;font-size:9pt;margin:2mm 0 0.5mm;">${noteNum}(e) Rights, Preferences and Restrictions</p>`
    html += `<p style="font-size:8pt;margin:0 0 2mm;text-align:justify;">${esc(details.rights)}</p>`
  }

  // Footnotes
  const fns = (details.footnotes || []).filter(f => f?.trim())
  if (fns.length) {
    html += `<p style="font-weight:bold;font-size:9pt;margin:2mm 0 0.5mm;">Notes:</p><ol style="margin:0;padding-left:16pt;">`
    fns.forEach(f => { html += `<li style="font-size:8pt;margin-bottom:1mm;text-align:justify;">${esc(f)}</li>` })
    html += `</ol>`
  }

  html += `</div>`
  return html
}

// ── Owners'/Partners' Capital Account note details HTML renderer ──────────────
// Individual/Proprietorship/Partnership: single roll-forward table.
// LLP: two sub-tables — (a) Partners Contribution Account, (b) Partners Current
// Account — rendered under one note, matching the Share Capital note style.
function closingOfAcct(f) {
  const n = (v) => parseFloat(v) || 0
  return n(f?.opening) + n(f?.introduced) + n(f?.remuneration) + n(f?.interest) - n(f?.withdrawals) + n(f?.shareOfProfit)
}
function renderAcctRoundTable(rows, py, { openLabel, closeLabel, partyLabel, showAgreedContribution = false, isSingleOwner = false }) {
  const num = (v) => parseFloat(v) || 0
  // Always 2 decimals, even for a whole number (34 -> "34.00") — matches the
  // formatting every other figure on the statements uses (fmtINR).
  const fmtN = fmtINR  // module-level, denomination-scaled — see _DENOM_KEY at the top of this file
  const th = 'border:1px solid #ccc;padding:3pt 4pt;font-weight:bold;font-size:7.5pt;text-align:right;'
  const thl = 'border:1px solid #ccc;padding:3pt 4pt;font-weight:bold;font-size:7.5pt;text-align:left;'
  const td = 'border:1px solid #ccc;padding:2pt 4pt;font-size:8pt;text-align:right;font-variant-numeric:tabular-nums;'
  const tdl = 'border:1px solid #ccc;padding:2pt 4pt;font-size:8pt;'
  const tdc = 'border:1px solid #ccc;padding:2pt 4pt;font-size:8pt;text-align:center;'

  const sumField = (field) => rows.reduce((s, r) => s + num(r[field]), 0)
  const sumClosing = () => rows.reduce((s, r) => s + closingOfAcct(r), 0)
  const sumAgreed = () => rows.reduce((s, r) => s + num(r.agreedContribution), 0)
  // Sole owner (Individual/Proprietorship): Share%, Remuneration and Interest
  // don't apply — a single owner takes 100% of the PL net profit directly.
  const leadingCols = 2 + (showAgreedContribution ? 1 : 0) + (isSingleOwner ? 0 : 1)

  let html = `<table style="width:100%;border-collapse:collapse;margin-bottom:2mm;">`
  html += `<thead><tr>
    <th style="${th}width:3%;">Sr.</th>
    <th style="${thl}width:16%;">Name of ${partyLabel}</th>
    ${showAgreedContribution ? `<th style="${th}">Agreed contribution</th>` : ''}
    ${isSingleOwner ? '' : `<th style="${th}">Share of profit/(loss) (%)</th>`}
    <th style="${th}">${openLabel}<br/>(Opening Balance)</th>
    <th style="${th}">Introduced/contributed during the year</th>
    ${isSingleOwner ? '' : `<th style="${th}">Remuneration for the year</th>`}
    ${isSingleOwner ? '' : `<th style="${th}">Interest for the year</th>`}
    <th style="${th}">Withdrawals during the year</th>
    <th style="${th}">Share of Profit/Loss for the year${isSingleOwner ? ' (from P&L)' : ''}</th>
    <th style="${th}">${closeLabel}<br/>(Closing Balance)</th>
  </tr></thead><tbody>`
  rows.forEach((r, i) => {
    const f = r
    html += `<tr>
      <td style="${tdc}">${i + 1}</td>
      <td style="${tdl}">${esc(r.name || '')}</td>
      ${showAgreedContribution ? `<td style="${td}">${r.agreedContribution ? fmtN(r.agreedContribution) : '—'}</td>` : ''}
      ${isSingleOwner ? '' : `<td style="${tdc}">${f.sharePct !== '' && f.sharePct != null ? f.sharePct : '—'}</td>`}
      <td style="${td}">${fmtN(num(f.opening))}</td>
      <td style="${td}">${fmtN(num(f.introduced))}</td>
      ${isSingleOwner ? '' : `<td style="${td}">${fmtN(num(f.remuneration))}</td>`}
      ${isSingleOwner ? '' : `<td style="${td}">${fmtN(num(f.interest))}</td>`}
      <td style="${td}">${fmtN(num(f.withdrawals))}</td>
      <td style="${td}">${fmtN(num(f.shareOfProfit))}</td>
      <td style="${td}font-weight:bold;">${fmtN(closingOfAcct(f))}</td>
    </tr>`
  })
  html += `<tr style="font-weight:bold;background:#f9fafb;">
    <td style="${td}" colspan="2"></td>
    ${showAgreedContribution ? `<td style="${td}">${fmtN(sumAgreed())}</td>` : ''}
    ${isSingleOwner ? '' : `<td style="${td}"></td>`}
    <td style="${td}">${fmtN(sumField('opening'))}</td>
    <td style="${td}">${fmtN(sumField('introduced'))}</td>
    ${isSingleOwner ? '' : `<td style="${td}">${fmtN(sumField('remuneration'))}</td>`}
    ${isSingleOwner ? '' : `<td style="${td}">${fmtN(sumField('interest'))}</td>`}
    <td style="${td}">${fmtN(sumField('withdrawals'))}</td>
    <td style="${td}">${fmtN(sumField('shareOfProfit'))}</td>
    <td style="${td}">${fmtN(sumClosing())}</td>
  </tr>`
  html += `<tr style="background:#f3f4f6;">
    <td style="${tdl}font-weight:bold;" colspan="${leadingCols}">Previous Year (PY)</td>
    <td style="${td}">${fmtN(num(py?.opening))}</td>
    <td style="${td}">${fmtN(num(py?.introduced))}</td>
    ${isSingleOwner ? '' : `<td style="${td}">${fmtN(num(py?.remuneration))}</td>`}
    ${isSingleOwner ? '' : `<td style="${td}">${fmtN(num(py?.interest))}</td>`}
    <td style="${td}">${fmtN(num(py?.withdrawals))}</td>
    <td style="${td}">${fmtN(num(py?.shareOfProfit))}</td>
    <td style="${td}font-weight:bold;">${fmtN(closingOfAcct(py))}</td>
  </tr>`
  html += `</tbody></table>`
  return html
}
function renderOwnersCapitalDetails(details, noteNum, cyLabel, pyLabel, cyTotal, pyTotal, periodStartStr, periodEndStr) {
  if (!details || !details.rows?.length) return ''
  const openLabel = `As at ${fmtOrdinalDate(periodStartStr) || '1st April 20XX'}`
  const closeLabel = `As at ${fmtOrdinalDate(periodEndStr) || '31st March 20XX'}`
  const num = (v) => parseFloat(v) || 0
  const fmtN = fmtINR  // module-level, denomination-scaled — see _DENOM_KEY at the top of this file
  const partyLabel = details.variant === 'llp' ? 'Partner' : (details.partyLabel || 'Owner')

  let html = `<div style="margin-top:6mm;"><div style="text-align:right;font-size:8pt;font-style:italic;margin-bottom:1mm;">(Amount in Rs.)</div>`

  if (details.variant === 'llp') {
    html += `<p style="font-weight:bold;font-size:9pt;margin:2mm 0 1mm;">${noteNum}(a) Partners Contribution Account</p>`
    html += renderAcctRoundTable(details.rows.map(r => ({ name: r.name, agreedContribution: r.agreedContribution, ...r.contrib })), details.pyContrib, { openLabel, closeLabel, partyLabel, showAgreedContribution: true })

    html += `<p style="font-weight:bold;font-size:9pt;margin:3mm 0 1mm;">${noteNum}(b) Partners Current Account</p>`
    html += renderAcctRoundTable(details.rows.map(r => ({ name: r.name, ...r.current })), details.pyCurrent, { openLabel, closeLabel, partyLabel, showAgreedContribution: false })

    if (cyTotal != null) {
      const formCY = details.rows.reduce((s, r) => s + closingOfAcct(r.contrib) + closingOfAcct(r.current), 0)
      const mappedCY = Math.abs(cyTotal)
      const diff = Math.abs(Math.abs(formCY) - mappedCY)
      if (diff > 1) {
        html += `<div style="color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:3pt;padding:4pt 8pt;margin:2mm 0;font-size:8pt;">
          ⚠&nbsp;<strong>Balance Sheet Tally Mismatch</strong> &mdash; Contribution + Current Account (${cyLabel}) as per form: <strong>₹${fmtN(formCY)}</strong>
          &nbsp;|&nbsp; As per Mapped Trial Balance: <strong>₹${fmtN(mappedCY)}</strong> &nbsp;|&nbsp; Difference: <strong>₹${fmtN(diff)}</strong>
        </div>`
      }
    }
  } else {
    html += renderAcctRoundTable(details.rows, details.py, { openLabel, closeLabel, partyLabel, showAgreedContribution: false, isSingleOwner: !!details.isSingleOwner })

    if (cyTotal != null) {
      const formCY = details.rows.reduce((s, r) => s + closingOfAcct(r), 0)
      const mappedCY = Math.abs(cyTotal)
      const diff = Math.abs(Math.abs(formCY) - mappedCY)
      if (diff > 1) {
        html += `<div style="color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:3pt;padding:4pt 8pt;margin:2mm 0;font-size:8pt;">
          ⚠&nbsp;<strong>Balance Sheet Tally Mismatch</strong> &mdash; ${cyLabel} Closing Balance as per form: <strong>₹${fmtN(formCY)}</strong>
          &nbsp;|&nbsp; As per Mapped Trial Balance: <strong>₹${fmtN(mappedCY)}</strong> &nbsp;|&nbsp; Difference: <strong>₹${fmtN(diff)}</strong>
        </div>`
      }
    }
  }

  html += `</div>`
  return html
}

// ── Long-Term Borrowings note details HTML renderer ───────────────────────────
function renderLongTermBorrowingsDetails(details, noteNum, cyLabel, pyLabel) {
  if (!details || !details.loans?.length) return ''
  const fmtN = fmtINR  // module-level, denomination-scaled — see _DENOM_KEY at the top of this file
  const num = (v) => parseFloat(v) || 0
  const th = 'border:1px solid #ccc;padding:3pt 5pt;font-size:8pt;font-weight:bold;text-align:right;'
  const thl = 'border:1px solid #ccc;padding:3pt 5pt;font-size:8pt;font-weight:bold;text-align:left;'
  const td = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;text-align:right;'
  const tdl = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;'
  const loans = details.loans || []

  // Group loans by Lender Print Name for consolidated output
  const byLender = {}
  for (const l of loans) {
    const key = l.lenderPrintName || l.tbLedger || 'Unknown'
    if (!byLender[key]) byLender[key] = { nature: l.nature, su: l.securedUnsecured, grossCY: 0, grossPY: 0, cmCY: 0, cmPY: 0, loans: [] }
    byLender[key].grossCY += num(l.grossCY); byLender[key].cmCY += num(l.currentMaturityCY)
    byLender[key].grossPY += num(l.grossPY); byLender[key].cmPY += num(l.currentMaturityPY)
    byLender[key].loans.push(l)
  }

  // page-break-inside: avoid — if this table doesn't fit in the remaining
  // space on the current page, push the WHOLE table onto the next page
  // rather than letting Chromium's PDF renderer split it mid-table. A table
  // too tall to fit on ANY single page still splits as a fallback — this
  // only prevents splitting when it would otherwise fit on one page.
  let html = `<div style="margin-top:6mm;page-break-inside:avoid;break-inside:avoid;">`

  // Section B: Loan amounts (consolidated by lender)
  html += `<p style="font-weight:bold;font-size:9pt;margin:2mm 0 1mm;">${noteNum}. Details of Long-Term Borrowings</p>`
  html += `<table style="width:100%;border-collapse:collapse;margin-bottom:4mm;">`
  html += `<thead><tr>
    <th style="${thl}">Lender</th>
    <th style="${thl}">Nature</th>
    <th style="${thl}font-style:italic;font-weight:normal;">Sec/Unsec</th>
    <th style="${th}">${cyLabel} Gross</th>
    <th style="${th}">${cyLabel} Current Mat.</th>
    <th style="${th}">${cyLabel} Net LT</th>
    <th style="${th}">${pyLabel} Net LT</th>
  </tr></thead><tbody>`

  let totGrossCY = 0, totCmCY = 0, totCmPY = 0, totNetCY = 0, totNetPY = 0
  for (const [lender, g] of Object.entries(byLender)) {
    const netCY = g.grossCY - g.cmCY, netPY = g.grossPY - g.cmPY
    totGrossCY += g.grossCY; totCmCY += g.cmCY; totCmPY += g.cmPY; totNetCY += netCY; totNetPY += netPY
    html += `<tr>
      <td style="${tdl}">${esc(lender)}</td>
      <td style="${tdl}font-size:8pt;">${esc(g.nature)}</td>
      <td style="${tdl}font-style:italic;">${esc(g.su)}</td>
      <td style="${td}">${fmtN(g.grossCY)}</td>
      <td style="${td}">${g.cmCY ? fmtN(g.cmCY) : '—'}</td>
      <td style="${td}font-weight:bold;">${fmtN(netCY)}</td>
      <td style="${td}">${fmtN(netPY)}</td>
    </tr>`
  }
  html += `<tr style="font-weight:bold;background:#f9fafb;"><td style="${tdl}">Total</td><td style="${td}"></td><td style="${td}"></td>
    <td style="${td}">${fmtN(totGrossCY)}</td><td style="${td}">${totCmCY ? fmtN(totCmCY) : '—'}</td>
    <td style="${td}">${fmtN(totNetCY)}</td><td style="${td}">${fmtN(totNetPY)}</td></tr>`
  html += `</tbody></table>`

  if (totCmCY > 0 || totCmPY > 0) {
    html += `<p style="font-size:8pt;font-style:italic;color:#555;margin:0 0 3mm;">
      Note: Current Maturities of ₹${fmtN(totCmCY)} (${cyLabel}) / ₹${fmtN(totCmPY)} (${pyLabel}) are classified under Short-term borrowings.</p>`
  }

  // Repayment details (tabular loans only; paragraph loans shown separately)
  const tabRepay = loans.filter(l => l.repaymentFormat !== 'paragraph' && (l.roi || l.emi || l.frequency))
  const paraRepay = loans.filter(l => l.repaymentFormat === 'paragraph' && l.repaymentParagraph)
  if ((tabRepay.length || paraRepay.length) && details.printRepayment !== false) {
    html += `<p style="font-weight:bold;font-size:9pt;margin:2mm 0 1mm;">Terms of Repayment</p>`
    if (tabRepay.length) {
      html += `<table style="width:100%;border-collapse:collapse;margin-bottom:3mm;">`
      html += `<thead><tr>
        <th style="${thl}">Lender</th>
        <th style="${thl}font-style:italic;font-weight:normal;">Sec/Unsec</th>
        <th style="${th}">Rate of Interest</th>
        <th style="${th}">Instalment</th>
        <th style="${th}">Frequency</th>
        <th style="${th}">Remaining</th>
        <th style="${th}">Final Maturity</th>
        <th style="${thl}">Remarks</th>
      </tr></thead><tbody>`
      for (const l of tabRepay) {
        const lname = l.lenderPrintName || l.tbLedger
        html += `<tr>
          <td style="${tdl}">${esc(lname)}</td>
          <td style="${tdl}font-style:italic;">${esc(l.securedUnsecured)}</td>
          <td style="${td}">${esc(l.roi || '—')}</td>
          <td style="${td}">${l.emi ? fmtN(l.emi) : '—'}</td>
          <td style="${tdl}">${esc(l.frequency || '—')}</td>
          <td style="${td}">${l.remainingInstalments || '—'}</td>
          <td style="${tdl}">${esc(fmtISOToDMY(l.finalMaturityDate) || '—')}</td>
          <td style="${tdl}">${esc(l.repaymentRemarks || '')}</td>
        </tr>`
      }
      html += `</tbody></table>`
    }
    for (const l of paraRepay) {
      html += `<p style="font-size:8pt;margin:1mm 0;"><strong>${esc(l.lenderPrintName || l.tbLedger)}:</strong> ${esc(l.repaymentParagraph)}</p>`
    }
  }

  // Security details
  const tabSec = loans.filter(l => l.securityFormat !== 'paragraph' && (l.natureOfSecurity || l.guarantee))
  const paraSec = loans.filter(l => l.securityFormat === 'paragraph' && l.securityParagraph)
  if ((tabSec.length || paraSec.length) && details.printSecurity !== false) {
    html += `<p style="font-weight:bold;font-size:9pt;margin:2mm 0 1mm;">Security Details</p>`
    if (tabSec.length) {
      html += `<table style="width:100%;border-collapse:collapse;margin-bottom:3mm;">`
      html += `<thead><tr>
        <th style="${thl}">Lender</th>
        <th style="${thl}font-style:italic;font-weight:normal;">Sec/Unsec</th>
        <th style="${thl}">Nature of Security</th>
        <th style="${thl}">Guarantee</th>
        <th style="${thl}">Charge Ranking</th>
      </tr></thead><tbody>`
      for (const l of tabSec) {
        html += `<tr>
          <td style="${tdl}">${esc(l.lenderPrintName || l.tbLedger)}</td>
          <td style="${tdl}font-style:italic;">${esc(l.securedUnsecured)}</td>
          <td style="${tdl}">${esc(l.natureOfSecurity || '—')}</td>
          <td style="${tdl}">${esc(l.guarantee || '—')}</td>
          <td style="${tdl}">${esc(l.chargeRanking || '—')}</td>
        </tr>`
      }
      html += `</tbody></table>`
    }
    for (const l of paraSec) {
      html += `<p style="font-size:8pt;margin:1mm 0;"><strong>${esc(l.lenderPrintName || l.tbLedger)}:</strong> ${esc(l.securityParagraph)}</p>`
    }
  }

  html += `</div>`
  return html
}

// ── Cash & Bank Balances note details HTML renderer ───────────────────────────
// Only printed when there's actually something to say — either the CA
// ticked "Always include" or at least one item has a non-zero amount (the
// form's own "Default behavior" copy already promises exactly this). The
// form itself has a single Amount field per item (no separate CY/PY), so
// that's the only figure there is to gate on.
function renderCashBankDetails(details, noteNum) {
  if (!details?.items) return ''
  const num = (v) => parseFloat(v) || 0
  const hasCY = CASH_BANK_ITEMS.some(item => num(details.items[item.key]?.amount) !== 0)
  // Previous Year is a later addition to this form — the CA may never have
  // filled it in for an entity's earlier periods, so the column is only
  // shown at all when at least one item actually carries a PY figure,
  // rather than always printing an empty PY column.
  const hasPY = CASH_BANK_ITEMS.some(item => num(details.items[item.key]?.amountPY) !== 0)
  // Only when some item carries a figure — the "Always include" tick no
  // longer prints an all-nil table (CA, 30 Sep 2026).
  if (!hasCY && !hasPY && !details.blankFormat) return ''   // blankFormat: Features > Format shows the empty table

  const th = 'border:1px solid #ccc;padding:3pt 5pt;font-size:8pt;font-weight:bold;text-align:right;'
  const thl = 'border:1px solid #ccc;padding:3pt 5pt;font-size:8pt;font-weight:bold;text-align:left;'
  const td = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;text-align:right;'
  const tdl = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;'

  // Part of the Cash and Bank Balances note: indented under it, and no note
  // number of its own (it read as a separate note).
  let html = `<div style="margin-top:3mm;margin-left:14pt;page-break-inside:avoid;break-inside:avoid;">`
  html += `<p style="font-weight:bold;font-size:9pt;margin:2mm 0 1mm;">Other Details relating to Cash and Bank Balances included above</p>`
  html += `<table style="width:100%;border-collapse:collapse;margin-bottom:4mm;">`
  html += `<thead><tr>
    <th style="${thl}width:6%;white-space:nowrap;">Sl No.</th>
    <th style="${thl}">Particulars</th>
    <th style="${th}">${hasPY ? 'Amount (CY)' : 'Amount'}</th>
    ${hasPY ? `<th style="${th}">Amount (PY)</th>` : ''}
    <th style="${thl}">Remarks</th>
  </tr></thead><tbody>`
  for (const item of CASH_BANK_ITEMS) {
    const row = details.items[item.key] || {}
    html += `<tr>
      <td style="${tdl}text-align:center;">(${item.key})</td>
      <td style="${tdl}">${esc(item.label)}</td>
      <td style="${td}">${fmtINR(num(row.amount))}</td>
      ${hasPY ? `<td style="${td}">${fmtINR(num(row.amountPY))}</td>` : ''}
      <td style="${tdl}">${esc(row.remarks || '')}</td>
    </tr>`
  }
  html += `</tbody></table></div>`
  return html
}

// ── Short-Term Borrowings note details HTML renderer ──────────────────────────
// No "Current Maturities" concept — short-term borrowings are current by
// nature (see Notes/ShortTermBorrowingsForm.jsx's header comment) — so this
// is a trimmed mirror of renderLongTermBorrowingsDetails without the
// gross/current-maturity/net-LT split or the instalment-schedule columns.
function renderShortTermBorrowingsDetails(details, noteNum, cyLabel, pyLabel) {
  if (!details || !details.loans?.length) return ''
  const fmtN = fmtINR  // module-level, denomination-scaled — see _DENOM_KEY at the top of this file
  const num = (v) => parseFloat(v) || 0
  const th = 'border:1px solid #ccc;padding:3pt 5pt;font-size:8pt;font-weight:bold;text-align:right;'
  const thl = 'border:1px solid #ccc;padding:3pt 5pt;font-size:8pt;font-weight:bold;text-align:left;'
  const td = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;text-align:right;'
  const tdl = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;'
  const loans = details.loans || []

  // Group loans by Lender Print Name for consolidated output
  const byLender = {}
  for (const l of loans) {
    const key = l.lenderPrintName || l.tbLedger || 'Unknown'
    if (!byLender[key]) byLender[key] = { nature: l.nature, su: l.securedUnsecured, grossCY: 0, grossPY: 0, loans: [] }
    byLender[key].grossCY += num(l.grossCY)
    byLender[key].grossPY += num(l.grossPY)
    byLender[key].loans.push(l)
  }

  let html = `<div style="margin-top:6mm;page-break-inside:avoid;break-inside:avoid;">`

  html += `<p style="font-weight:bold;font-size:9pt;margin:2mm 0 1mm;">${noteNum}. Details of Short-Term Borrowings</p>`
  html += `<table style="width:100%;border-collapse:collapse;margin-bottom:4mm;">`
  html += `<thead><tr>
    <th style="${thl}">Lender</th>
    <th style="${thl}">Nature</th>
    <th style="${thl}font-style:italic;font-weight:normal;">Sec/Unsec</th>
    <th style="${th}">${cyLabel}</th>
    <th style="${th}">${pyLabel}</th>
  </tr></thead><tbody>`

  let totCY = 0, totPY = 0
  for (const [lender, g] of Object.entries(byLender)) {
    totCY += g.grossCY; totPY += g.grossPY
    html += `<tr>
      <td style="${tdl}">${esc(lender)}</td>
      <td style="${tdl}font-size:8pt;">${esc(g.nature)}</td>
      <td style="${tdl}font-style:italic;">${esc(g.su)}</td>
      <td style="${td}font-weight:bold;">${fmtN(g.grossCY)}</td>
      <td style="${td}">${fmtN(g.grossPY)}</td>
    </tr>`
  }
  html += `<tr style="font-weight:bold;background:#f9fafb;"><td style="${tdl}">Total</td><td style="${td}"></td><td style="${td}"></td>
    <td style="${td}">${fmtN(totCY)}</td><td style="${td}">${fmtN(totPY)}</td></tr>`
  html += `</tbody></table>`

  // Repayment details (tabular loans only; paragraph loans shown separately)
  const tabRepay = loans.filter(l => l.repaymentFormat !== 'paragraph' && (l.roi || l.frequency || l.repaymentRemarks))
  const paraRepay = loans.filter(l => l.repaymentFormat === 'paragraph' && l.repaymentParagraph)
  if ((tabRepay.length || paraRepay.length) && details.printRepayment !== false) {
    html += `<p style="font-weight:bold;font-size:9pt;margin:2mm 0 1mm;">Terms of Repayment</p>`
    if (tabRepay.length) {
      html += `<table style="width:100%;border-collapse:collapse;margin-bottom:3mm;">`
      html += `<thead><tr>
        <th style="${thl}">Lender</th>
        <th style="${thl}font-style:italic;font-weight:normal;">Sec/Unsec</th>
        <th style="${th}">Rate of Interest</th>
        <th style="${thl}">Frequency</th>
        <th style="${thl}">Remarks</th>
      </tr></thead><tbody>`
      for (const l of tabRepay) {
        const lname = l.lenderPrintName || l.tbLedger
        html += `<tr>
          <td style="${tdl}">${esc(lname)}</td>
          <td style="${tdl}font-style:italic;">${esc(l.securedUnsecured)}</td>
          <td style="${td}">${esc(l.roi || '—')}</td>
          <td style="${tdl}">${esc(l.frequency || '—')}</td>
          <td style="${tdl}">${esc(l.repaymentRemarks || '')}</td>
        </tr>`
      }
      html += `</tbody></table>`
    }
    for (const l of paraRepay) {
      html += `<p style="font-size:8pt;margin:1mm 0;"><strong>${esc(l.lenderPrintName || l.tbLedger)}:</strong> ${esc(l.repaymentParagraph)}</p>`
    }
  }

  // Security details
  const tabSec = loans.filter(l => l.securityFormat !== 'paragraph' && (l.natureOfSecurity || l.guarantee))
  const paraSec = loans.filter(l => l.securityFormat === 'paragraph' && l.securityParagraph)
  if ((tabSec.length || paraSec.length) && details.printSecurity !== false) {
    html += `<p style="font-weight:bold;font-size:9pt;margin:2mm 0 1mm;">Security Details</p>`
    if (tabSec.length) {
      html += `<table style="width:100%;border-collapse:collapse;margin-bottom:3mm;">`
      html += `<thead><tr>
        <th style="${thl}">Lender</th>
        <th style="${thl}font-style:italic;font-weight:normal;">Sec/Unsec</th>
        <th style="${thl}">Nature of Security</th>
        <th style="${thl}">Guarantee</th>
        <th style="${thl}">Charge Ranking</th>
      </tr></thead><tbody>`
      for (const l of tabSec) {
        html += `<tr>
          <td style="${tdl}">${esc(l.lenderPrintName || l.tbLedger)}</td>
          <td style="${tdl}font-style:italic;">${esc(l.securedUnsecured)}</td>
          <td style="${tdl}">${esc(l.natureOfSecurity || '—')}</td>
          <td style="${tdl}">${esc(l.guarantee || '—')}</td>
          <td style="${tdl}">${esc(l.chargeRanking || '—')}</td>
        </tr>`
      }
      html += `</tbody></table>`
    }
    for (const l of paraSec) {
      html += `<p style="font-size:8pt;margin:1mm 0;"><strong>${esc(l.lenderPrintName || l.tbLedger)}:</strong> ${esc(l.securityParagraph)}</p>`
    }
  }

  html += `</div>`
  return html
}

// ── Trade Payables / Receivables ageing schedule (Schedule III) ───────────────
function renderAgeingSchedule(details, noteTitle) {
  const t = (noteTitle || '').toLowerCase()
  const isTP = t.includes('trade payable')
  // TP saves under details.ageing (combined with MSME); TR saves at top level
  const ag = isTP ? details.ageing : (details.cy ? details : null)
  if (!ag || !ag.cy) return ''

  const AG_ROWS = isTP ? TP_AGEING_ROWS : TR_AGEING_ROWS
  const AG_BUCKETS = isTP ? TP_AGEING_BUCKETS : TR_AGEING_BUCKETS
  const num = (v) => parseFloat(v) || 0
  const fmtN = fmtINR  // module-level, denomination-scaled — see _DENOM_KEY at the top of this file
  const cellVal = (pd, row, bKey) =>
    row.computed ? trComputedCell(pd, row.computed, bKey) : num(pd?.[row.key]?.[bKey])

  const th  = 'border:0.5pt solid #444;padding:1mm 1.5mm;font-size:8pt;font-weight:bold;text-align:right;'
  const thl = 'border:0.5pt solid #444;padding:1mm 1.5mm;font-size:8pt;font-weight:bold;text-align:left;'
  const thc = 'border:0.5pt solid #444;padding:1mm 1.5mm;font-size:8pt;font-weight:bold;text-align:center;'
  const td  = 'border:0.5pt solid #444;padding:0.8mm 1.5mm;font-size:8pt;text-align:right;'
  const tdl = 'border:0.5pt solid #444;padding:0.8mm 1.5mm;font-size:8pt;text-align:left;'

  const buildPeriod = (pd, heading) => {
    if (!pd) return ''
    const any = AG_ROWS.some(r => AG_BUCKETS.some(b => Math.abs(cellVal(pd, r, b.key)) > 0.005))
    if (!any && !ag.includeInOutput && !details.includeInOutput) return ''
    let html = `<p style="font-weight:bold;font-size:9pt;margin:2.5mm 0 1mm;">${isTP ? 'Trade Payables' : 'Trade Receivables'} ageing schedule (${heading})</p>`
    // Equal-width year columns: left to the browser, the long "Outstanding for
    // following periods…" heading made "More than 3 yrs." twice as wide as the
    // others.
    const colW = (74 / (AG_BUCKETS.length + 1)).toFixed(2)
    html += `<table style="width:100%;border-collapse:collapse;margin-bottom:2mm;">`
    html += `<colgroup><col style="width:26%">${AG_BUCKETS.map(() => `<col style="width:${colW}%">`).join('')}<col style="width:${colW}%"></colgroup>`
    html += `<thead>
      <tr>
        <th rowspan="2" style="${thl}vertical-align:bottom;">Particulars</th>
        <th colspan="${AG_BUCKETS.length}" style="${thc}">Outstanding for following periods from due date of payment</th>
        <th rowspan="2" style="${th}vertical-align:bottom;">Total</th>
      </tr>
      <tr>${AG_BUCKETS.map(b => `<th style="${th}">${esc(b.label)}</th>`).join('')}</tr>
    </thead><tbody>`
    for (const r of AG_ROWS) {
      const vals = AG_BUCKETS.map(b => cellVal(pd, r, b.key))
      const tot = vals.reduce((s, v) => s + v, 0)
      const bold = r.isTotal ? 'font-weight:bold;' : ''
      html += `<tr>
        <td style="${tdl}${bold}">${esc(r.label)}</td>
        ${vals.map(v => `<td style="${td}${bold}white-space:nowrap;">${fmtN(v)}</td>`).join('')}
        <td style="${td}font-weight:bold;white-space:nowrap;">${fmtN(tot)}</td>
      </tr>`
    }
    html += `</tbody></table>`
    return html
  }

  const cyHtml = buildPeriod(ag.cy, 'Current Year')
  const pyHtml = buildPeriod(ag.py, 'Previous Year')
  if (!cyHtml && !pyHtml) return ''
  return `<div style="margin:2mm 0 4mm;">${cyHtml}${pyHtml}</div>`
}

// ── Cost of Materials Consumed: Opening + Purchases − Closing of Raw Materials ──
function renderCostOfMaterialsConsumedDetails(details, noteNum, cyLabel, pyLabel) {
  if (!details || !details.opening) return ''
  const fmtN = (n) => n != null && n !== '' && !isNaN(n) ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'
  const num = (v) => parseFloat(v) || 0
  const thStyle = 'border:1px solid #ccc;padding:3pt 5pt;font-weight:bold;font-size:8pt;text-align:right;'
  const tdStyle = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;'
  const tdR = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;text-align:right;font-variant-numeric:tabular-nums;'

  const totalCY = num(details.opening.cy) + num(details.purchases.cy) - num(details.closing.cy)
  const totalPY = num(details.opening.py) + num(details.purchases.py) - num(details.closing.py)

  // page-break-inside: avoid — if this table doesn't fit in the remaining
  // space on the current page, push the WHOLE table onto the next page
  // rather than letting Chromium's PDF renderer split it mid-table. A table
  // too tall to fit on ANY single page still splits as a fallback — this
  // only prevents splitting when it would otherwise fit on one page.
  let html = `<div style="margin-top:6mm;page-break-inside:avoid;break-inside:avoid;">`
  html += `<table style="width:100%;border-collapse:collapse;margin-bottom:2mm;">`
  html += `<thead><tr>
    <th style="${thStyle}text-align:left;">Particulars</th>
    <th style="${thStyle}">${cyLabel}</th>
    <th style="${thStyle}">${pyLabel}</th>
  </tr></thead><tbody>`
  for (const [label, key] of [['Opening Stock of Raw Materials', 'opening'], ['Add: Purchases of Raw Materials', 'purchases'], ['Less: Closing Stock of Raw Materials', 'closing']]) {
    html += `<tr><td style="${tdStyle}">${label}</td><td style="${tdR}">${fmtN(num(details[key].cy))}</td><td style="${tdR}">${fmtN(num(details[key].py))}</td></tr>`
  }
  html += `<tr style="font-weight:bold;background:#f0f4ff;"><td style="${tdStyle}">Cost of Materials Consumed</td><td style="${tdR}">${fmtN(totalCY)}</td><td style="${tdR}">${fmtN(totalPY)}</td></tr>`
  html += `</tbody></table>`
  if (details.remarks) html += `<p style="font-size:8pt;margin:1mm 0;"><em>${esc(details.remarks)}</em></p>`
  html += `</div>`
  return html
}

// ── Changes in Inventories: category-wise break-up ──────────────────────────
function renderChangesInInventoryDetails(details, noteNum, cyLabel, pyLabel) {
  if (!details || !details.categories?.length) return ''
  const fmtN = (n) => n != null && n !== '' && !isNaN(n) ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'
  const num = (v) => parseFloat(v) || 0
  const thStyle = 'border:1px solid #ccc;padding:3pt 5pt;font-weight:bold;font-size:8pt;text-align:right;'
  const tdStyle = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;'
  const tdR = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;text-align:right;font-variant-numeric:tabular-nums;'

  let totalCY = 0, totalPY = 0
  // page-break-inside: avoid — if this table doesn't fit in the remaining
  // space on the current page, push the WHOLE table onto the next page
  // rather than letting Chromium's PDF renderer split it mid-table. A table
  // too tall to fit on ANY single page still splits as a fallback — this
  // only prevents splitting when it would otherwise fit on one page.
  let html = `<div style="margin-top:6mm;page-break-inside:avoid;break-inside:avoid;">`
  html += `<table style="width:100%;border-collapse:collapse;margin-bottom:2mm;">`
  html += `<thead><tr>
    <th style="${thStyle}text-align:left;">Category</th>
    <th style="${thStyle}">Opening (${cyLabel})</th>
    <th style="${thStyle}">Closing (${cyLabel})</th>
    <th style="${thStyle}">Increase/(Decrease) ${cyLabel}</th>
    <th style="${thStyle}">Opening (${pyLabel})</th>
    <th style="${thStyle}">Closing (${pyLabel})</th>
    <th style="${thStyle}">Increase/(Decrease) ${pyLabel}</th>
  </tr></thead><tbody>`
  for (const c of details.categories) {
    const changeCY = num(c.openingCY) - num(c.closingCY)
    const changePY = num(c.openingPY) - num(c.closingPY)
    totalCY += changeCY; totalPY += changePY
    html += `<tr>
      <td style="${tdStyle}">${esc(c.label || '')}</td>
      <td style="${tdR}">${fmtN(num(c.openingCY))}</td>
      <td style="${tdR}">${fmtN(num(c.closingCY))}</td>
      <td style="${tdR}">${fmtN(changeCY)}</td>
      <td style="${tdR}">${fmtN(num(c.openingPY))}</td>
      <td style="${tdR}">${fmtN(num(c.closingPY))}</td>
      <td style="${tdR}">${fmtN(changePY)}</td>
    </tr>`
  }
  html += `<tr style="font-weight:bold;background:#f0f4ff;">
    <td style="${tdStyle}">Total Increase/(Decrease) in Inventories</td>
    <td style="${tdR}" colspan="2"></td><td style="${tdR}">${fmtN(totalCY)}</td>
    <td style="${tdR}" colspan="2"></td><td style="${tdR}">${fmtN(totalPY)}</td>
  </tr>`
  html += `</tbody></table>`
  if (details.remarks) html += `<p style="font-size:8pt;margin:1mm 0;"><em>${esc(details.remarks)}</em></p>`
  html += `</div>`
  return html
}

// ── IT Act Block-wise WDV Summary — opt-in from Dep (IT) → Block Summary ──────
// Sourced from note.itBlockSummaryData (attached in useFinancials.js), NOT
// from noteDetailsMap, so it's called directly from buildNotesPages below
// rather than through the renderNoteDetails() title dispatcher.
function renderITBlockSummaryTable(blocks, pyTotals, wip) {
  if (!blocks || !blocks.length) return ''
  const num = (v) => parseFloat(v) || 0
  const fmtN = fmtINR  // module-level, denomination-scaled — see _DENOM_KEY at the top of this file
  const th = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;font-weight:bold;'
  const tdl = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;'
  const tdr = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;text-align:right;font-variant-numeric:tabular-nums;'
  // page-break-inside: avoid — if this table doesn't fit in the remaining
  // space on the current page, push the WHOLE table onto the next page
  // rather than letting Chromium's PDF renderer split it mid-table. A table
  // too tall to fit on ANY single page still splits as a fallback — this
  // only prevents splitting when it would otherwise fit on one page.
  let html = `<div style="margin-top:6mm;page-break-inside:avoid;break-inside:avoid;">`
  html += `<table style="width:100%;border-collapse:collapse;">`
  html += `<thead><tr>
    <th style="${th}text-align:left;">Particulars</th>
    <th style="${th}">Rate</th>
    <th style="${th}">Opening WDV</th>
    <th style="${th}">Additions</th>
    <th style="${th}">Deduction</th>
    <th style="${th}">Depreciation</th>
    <th style="${th}">Closing WDV</th>
  </tr></thead><tbody>`
  const totals = { openingWDV: 0, additions: 0, deduction: 0, depreciation: 0, closingWDV: 0 }
  for (const b of blocks) {
    const additions = num(b.addBefore180) + num(b.addAfter180)
    totals.openingWDV += num(b.openingWDV); totals.additions += additions
    totals.deduction += num(b.deduction); totals.depreciation += num(b.depreciation); totals.closingWDV += num(b.closingWDV)
    html += `<tr>
      <td style="${tdl}">${esc(b.block || '')}</td>
      <td style="${tdr}">${b.rate}%</td>
      <td style="${tdr}">${fmtN(num(b.openingWDV))}</td>
      <td style="${tdr}">${fmtN(additions)}</td>
      <td style="${tdr}">${fmtN(num(b.deduction))}</td>
      <td style="${tdr}">${fmtN(num(b.depreciation))}</td>
      <td style="${tdr}">${fmtN(num(b.closingWDV))}</td>
    </tr>`
  }
  const thTot = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;font-weight:bold;'
  const tdrTot = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;font-weight:bold;text-align:right;font-variant-numeric:tabular-nums;'
  html += `<tr>
    <td style="${thTot}">Total</td>
    <td style="${tdrTot}"></td>
    <td style="${tdrTot}">${fmtN(totals.openingWDV)}</td>
    <td style="${tdrTot}">${fmtN(totals.additions)}</td>
    <td style="${tdrTot}">${fmtN(totals.deduction)}</td>
    <td style="${tdrTot}">${fmtN(totals.depreciation)}</td>
    <td style="${tdrTot}">${fmtN(totals.closingWDV)}</td>
  </tr>`
  if (pyTotals && Object.values(pyTotals).some(v => num(v))) {
    const tdlPy = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;font-style:italic;color:#666;'
    const tdrPy = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;text-align:right;font-variant-numeric:tabular-nums;color:#666;'
    html += `<tr>
      <td style="${tdlPy}">Previous Year</td>
      <td style="${tdrPy}"></td>
      <td style="${tdrPy}">${fmtN(num(pyTotals.openingWDV))}</td>
      <td style="${tdrPy}">${fmtN(num(pyTotals.addBefore180) + num(pyTotals.addAfter180))}</td>
      <td style="${tdrPy}">${fmtN(num(pyTotals.deduction))}</td>
      <td style="${tdrPy}">${fmtN(num(pyTotals.depreciation))}</td>
      <td style="${tdrPy}">${fmtN(num(pyTotals.closingWDV))}</td>
    </tr>`
  }
  // Capital WIP / Intangible WIP — no depreciation is charged on assets still
  // under construction/development, so these are manually entered on the Dep
  // (IT) screen rather than derived from a Block. Left out of print entirely
  // (both these rows and the combined grand total below) whenever nothing
  // was actually entered.
  const wipCapital = num(wip?.capitalCY), wipIntangible = num(wip?.intangibleCY), wipPY = num(wip?.prevYearTotal)
  if (wipCapital || wipIntangible || wipPY) {
    const tdlWip = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;'
    const tdrWip = 'border:1px solid #ccc;padding:2pt 5pt;font-size:8pt;text-align:right;font-variant-numeric:tabular-nums;'
    html += `<tr>
      <td style="${tdlWip}">Capital Work in Progress</td>
      <td style="${tdrWip}"></td><td style="${tdrWip}"></td><td style="${tdrWip}"></td><td style="${tdrWip}"></td><td style="${tdrWip}"></td>
      <td style="${tdrWip}">${fmtN(wipCapital)}</td>
    </tr>
    <tr>
      <td style="${tdlWip}">Intangible Work in Progress</td>
      <td style="${tdrWip}"></td><td style="${tdrWip}"></td><td style="${tdrWip}"></td><td style="${tdrWip}"></td><td style="${tdrWip}"></td>
      <td style="${tdrWip}">${fmtN(wipIntangible)}</td>
    </tr>
    <tr>
      <td style="${thTot}">Total (Work in Progress)</td>
      <td style="${tdrTot}"></td><td style="${tdrTot}"></td><td style="${tdrTot}"></td><td style="${tdrTot}"></td><td style="${tdrTot}"></td>
      <td style="${tdrTot}">${fmtN(wipCapital + wipIntangible)}</td>
    </tr>
    <tr>
      <td style="${tdlWip}font-style:italic;color:#666;">Previous Year (Work in Progress)</td>
      <td style="${tdrWip}"></td><td style="${tdrWip}"></td><td style="${tdrWip}"></td><td style="${tdrWip}"></td><td style="${tdrWip}"></td>
      <td style="${tdrWip}font-style:italic;color:#666;">${fmtN(wipPY)}</td>
    </tr>
    <tr>
      <td style="${thTot}">Total PPE &amp; Intangible Assets including work in progress</td>
      <td style="${tdrTot}"></td><td style="${tdrTot}"></td><td style="${tdrTot}"></td><td style="${tdrTot}"></td><td style="${tdrTot}"></td>
      <td style="${tdrTot}">${fmtN(totals.closingWDV + wipCapital + wipIntangible)}</td>
    </tr>
    <tr>
      <td style="${tdlWip}font-style:italic;color:#666;">Previous Year</td>
      <td style="${tdrWip}"></td><td style="${tdrWip}"></td><td style="${tdrWip}"></td><td style="${tdrWip}"></td><td style="${tdrWip}"></td>
      <td style="${tdrWip}font-style:italic;color:#666;">${fmtN((pyTotals ? num(pyTotals.closingWDV) : 0) + wipPY)}</td>
    </tr>`
  }
  html += `</tbody></table>`
  html += `</div>`
  return html
}

// ── Dep (Comp) category-level Schedule II schedule — opt-in from Dep (Comp) ──
// Sourced from note.compScheduleData (attached in useFinancials.js), NOT
// from noteDetailsMap, so it's called directly from buildNotesPages below
// rather than through the renderNoteDetails() title dispatcher. Mirrors the
// exact Gross Block / Depreciation / Net Block column groups shown on the
// live Dep (Comp) screen, plus a Trial-Balance reconciliation footer.
function renderCompScheduleTable(categoryRows, tbCY, tbPY, pyTotals) {
  if (!categoryRows || !categoryRows.length) return ''
  const num = (v) => parseFloat(v) || 0
  const fmtN = fmtINR  // module-level, denomination-scaled — see _DENOM_KEY at the top of this file
  const th = 'border:1px solid #ccc;padding:2pt 4pt;font-size:7.5pt;font-weight:bold;text-align:center;'
  const tdl = 'border:1px solid #ccc;padding:2pt 4pt;font-size:7.5pt;'
  const tdr = 'border:1px solid #ccc;padding:2pt 4pt;font-size:7.5pt;text-align:right;font-variant-numeric:tabular-nums;'
  let html = `<div style="margin-top:6mm;page-break-inside:avoid;break-inside:avoid;">`
  html += `<table style="width:100%;border-collapse:collapse;">`
  html += `<thead>
    <tr>
      <th style="${th}" rowspan="2">Asset Category</th>
      <th style="${th}" colspan="4">Gross Block</th>
      <th style="${th}" colspan="4">Depreciation</th>
      <th style="${th}" colspan="2">Net Block</th>
    </tr>
    <tr>
      <th style="${th}">Opening</th><th style="${th}">Additions</th><th style="${th}">Deductions</th><th style="${th}">Closing</th>
      <th style="${th}">Opening</th><th style="${th}">For Year</th><th style="${th}">On Disposal</th><th style="${th}">Closing</th>
      <th style="${th}">Opening</th><th style="${th}">Closing</th>
    </tr>
  </thead><tbody>`
  const totals = { grossOpen: 0, additions: 0, deductions: 0, grossClose: 0, depOpen: 0, depForYear: 0, depOnDisposal: 0, depClose: 0, netBlockOpen: 0, netBlockClose: 0 }
  for (const r of categoryRows) {
    totals.grossOpen += num(r.grossOpen); totals.additions += num(r.additions); totals.deductions += num(r.deductions)
    totals.grossClose += num(r.grossClose); totals.depOpen += num(r.depOpen); totals.depForYear += num(r.depForYear)
    totals.depOnDisposal += num(r.depOnDisposal); totals.depClose += num(r.depClose)
    totals.netBlockOpen += num(r.netBlockOpen); totals.netBlockClose += num(r.netBlockClose)
    html += `<tr>
      <td style="${tdl}">${esc(r.category || '')}</td>
      <td style="${tdr}">${fmtN(num(r.grossOpen))}</td>
      <td style="${tdr}">${fmtN(num(r.additions))}</td>
      <td style="${tdr}">${fmtN(num(r.deductions))}</td>
      <td style="${tdr}">${fmtN(num(r.grossClose))}</td>
      <td style="${tdr}">${fmtN(num(r.depOpen))}</td>
      <td style="${tdr}">${fmtN(num(r.depForYear))}</td>
      <td style="${tdr}">${fmtN(num(r.depOnDisposal))}</td>
      <td style="${tdr}">${fmtN(num(r.depClose))}</td>
      <td style="${tdr}">${fmtN(num(r.netBlockOpen))}</td>
      <td style="${tdr}">${fmtN(num(r.netBlockClose))}</td>
    </tr>`
  }
  const thTot = 'border:1px solid #ccc;padding:2pt 4pt;font-size:7.5pt;font-weight:bold;'
  const tdrTot = 'border:1px solid #ccc;padding:2pt 4pt;font-size:7.5pt;font-weight:bold;text-align:right;font-variant-numeric:tabular-nums;'
  html += `<tr>
    <td style="${thTot}">Total</td>
    <td style="${tdrTot}">${fmtN(totals.grossOpen)}</td>
    <td style="${tdrTot}">${fmtN(totals.additions)}</td>
    <td style="${tdrTot}">${fmtN(totals.deductions)}</td>
    <td style="${tdrTot}">${fmtN(totals.grossClose)}</td>
    <td style="${tdrTot}">${fmtN(totals.depOpen)}</td>
    <td style="${tdrTot}">${fmtN(totals.depForYear)}</td>
    <td style="${tdrTot}">${fmtN(totals.depOnDisposal)}</td>
    <td style="${tdrTot}">${fmtN(totals.depClose)}</td>
    <td style="${tdrTot}">${fmtN(totals.netBlockOpen)}</td>
    <td style="${tdrTot}">${fmtN(totals.netBlockClose)}</td>
  </tr>`
  // Manually-entered Previous Year totals — mirrors the IT Block Summary's
  // own PY row; there's no separate PY schedule, so this is whatever the
  // preparer typed on the Dep (Comp) screen.
  if (pyTotals && Object.values(pyTotals).some(v => num(v))) {
    const tdlPy = 'border:1px solid #ccc;padding:2pt 4pt;font-size:7.5pt;font-style:italic;color:#666;'
    const tdrPy = 'border:1px solid #ccc;padding:2pt 4pt;font-size:7.5pt;text-align:right;font-variant-numeric:tabular-nums;color:#666;'
    html += `<tr>
      <td style="${tdlPy}">Previous Year</td>
      <td style="${tdrPy}">${fmtN(num(pyTotals.grossOpen))}</td>
      <td style="${tdrPy}">${fmtN(num(pyTotals.additions))}</td>
      <td style="${tdrPy}">${fmtN(num(pyTotals.deductions))}</td>
      <td style="${tdrPy}">${fmtN(num(pyTotals.grossClose))}</td>
      <td style="${tdrPy}">${fmtN(num(pyTotals.depOpen))}</td>
      <td style="${tdrPy}">${fmtN(num(pyTotals.depForYear))}</td>
      <td style="${tdrPy}">${fmtN(num(pyTotals.depOnDisposal))}</td>
      <td style="${tdrPy}">${fmtN(num(pyTotals.depClose))}</td>
      <td style="${tdrPy}">${fmtN(num(pyTotals.netBlockOpen))}</td>
      <td style="${tdrPy}">${fmtN(num(pyTotals.netBlockClose))}</td>
    </tr>`
  }
  // Reconciliation footer — Total as per Trial Balance (the PPE note's own
  // mapped-TB total) + Difference, matching the live Dep (Comp) screen.
  const diffCY = totals.netBlockClose - num(tbCY)
  const diffPY = totals.netBlockOpen - num(tbPY)
  const tdlReco = 'border:1px solid #ccc;padding:2pt 4pt;font-size:7.5pt;color:#555;'
  const tdrReco = 'border:1px solid #ccc;padding:2pt 4pt;font-size:7.5pt;text-align:right;font-variant-numeric:tabular-nums;color:#555;'
  const tdrDiff = (v) => `border:1px solid #ccc;padding:2pt 4pt;font-size:7.5pt;text-align:right;font-variant-numeric:tabular-nums;font-weight:bold;color:${Math.abs(v) < 1 ? '#15803d' : '#b91c1c'};`
  html += `<tr>
    <td style="${tdlReco}">Total as per Trial Balance</td>
    <td style="${tdrReco}" colspan="8"></td>
    <td style="${tdrReco}">${fmtN(num(tbPY))}</td>
    <td style="${tdrReco}">${fmtN(num(tbCY))}</td>
  </tr>`
  html += `<tr>
    <td style="${tdlReco}">Difference</td>
    <td style="${tdrReco}" colspan="8"></td>
    <td style="${tdrDiff(diffPY)}">${fmtN(diffPY)}</td>
    <td style="${tdrDiff(diffCY)}">${fmtN(diffCY)}</td>
  </tr>`
  html += `</tbody></table>`
  html += `</div>`
  return html
}

// ── Trade Receivables ageing table — Proprietorship / Partnership / LLP ───────
// Always printed beneath the Trade receivables note (Company keeps its own
// Schedule III schedule via renderAgeingSchedule). Defaults to everything in
// "less than 6 months / Unsecured, considered good" until edited in Fill
// Details — see utils/tradeReceivablesNonCorp.js.
function renderNcTradeReceivablesAgeing(saved, noteTotal) {
  const { values, total } = ncAgeingResolve(saved, noteTotal)
  const cell = 'border:0.5pt solid #444;padding:1mm 1.5mm;font-size:10pt;'
  const head = cell + 'font-weight:bold;'
  const body = NC_AGEING_BLOCKS.map(b => NC_AGEING_CATEGORIES.map((c, i) => `<tr>
    ${i === 0 ? `<td rowspan="${NC_AGEING_CATEGORIES.length}" style="${cell}text-align:left;vertical-align:middle;">${esc(b.label)}</td>` : ''}
    <td style="${cell}text-align:left;">${esc(c.label)}</td>
    <td style="${cell}text-align:right;white-space:nowrap;">${fmtINR(values[b.key][c.key])}</td>
  </tr>`).join('')).join('')
  return `<table style="width:100%;border-collapse:collapse;margin:2mm 0 4mm;">
    <thead><tr>
      <th style="${head}text-align:left;width:46%;">${esc(NC_AGEING_TITLE)}</th>
      <th style="${head}text-align:center;width:30%;">Category</th>
      <th style="${head}text-align:right;">Amount</th>
    </tr></thead>
    <tbody>${body}<tr>
      <td colspan="2" style="${head}text-align:center;">Total</td>
      <td style="${head}text-align:right;white-space:nowrap;">${fmtINR(total)}</td>
    </tr></tbody>
  </table>`
}

// ── Note details dispatcher — picks the right renderer per note title ─────────
// Ageing schedule (Trade Payables/Receivables) is a Company-only disclosure
// requirement — see Notes/index.jsx's Fill Details gating; isCompany here
// keeps the PDF consistent even for stale ageing data saved before that rule
// existed.
function renderNoteDetails(noteTitle, details, noteNum, cyLabel, pyLabel, cyTotal, pyTotal, periodStartStr, periodEndStr, isCompany = false) {
  if (!details) return ''
  const t = (noteTitle || '').toLowerCase()
  if (t.includes('share capital')) return renderShareCapitalDetails(details, noteNum, cyLabel, pyLabel, cyTotal, pyTotal, isCompany)
  if (t.includes('long-term borrow') || t.includes('long term borrow')) return renderLongTermBorrowingsDetails(details, noteNum, cyLabel, pyLabel)
  if (t.includes('short-term borrow') || t.includes('short term borrow')) return renderShortTermBorrowingsDetails(details, noteNum, cyLabel, pyLabel)
  if (t.includes('cash') && t.includes('bank')) return renderCashBankDetails(details, noteNum)
  if ((t.includes('trade payable') || t.includes('trade receivable')) && isCompany) return renderAgeingSchedule(details, noteTitle)
  if (t.includes("owners' capital") || t.includes('owners capital') || t.includes("partners' capital") || t.includes('partners capital')) {
    return renderOwnersCapitalDetails(details, noteNum, cyLabel, pyLabel, cyTotal, pyTotal, periodStartStr, periodEndStr)
  }
  // "Cost of Materials Consumed" / "Changes in Inventories" are deliberately
  // NOT dispatched here any more — they're auto-computed from the Stock tab
  // (see utils/inventorySplit.js); rendering old saved note_details for them
  // would show stale, possibly-divergent figures alongside the correct
  // auto-computed table.
  return ''  // no renderer for this note type yet
}
// "Cost of Materials Consumed" / "Changes in Inventories" are deliberately
// NOT matched here — they're auto-computed from the Stock tab (see
// utils/inventorySplit.js) and no longer have a Fill Details override, so
// they must always fall through to the normal auto-computed row rendering,
// even if a note_details row for them still exists from before this change.
const isFormDetailNoteTitle = (t) =>
  t.includes('share capital') || t.includes('long-term borrow') || t.includes('long term borrow') ||
  t.includes('short-term borrow') || t.includes('short term borrow') ||
  t.includes("owners' capital") || t.includes('owners capital') || t.includes("partners' capital") || t.includes('partners capital')

function renderDisclosure(text) {
  if (!text || !text.trim()) return ''
  return `<div class="note-disclosure" style="margin:4px 0 10px;padding:4px 0;font-size:10pt;color:#374151;white-space:pre-wrap;">${esc(text.trim())}</div>`
}

function buildNotesPages(entity, activeTB, auditor, signatories, signNotes = false, noteDetailsMap = {}, prevTB = null, noteDisclosureMap = {}, signPlace = '', signDate = '') {
  return (data) => {
    const isCompany = parseInt(entity?.constitution) === 3
    const isNonCorp12 = [1, 2].includes(parseInt(entity?.constitution))
    const header = pageHeader(entity, 'Notes to Financial Statements', `for the year ended ${esc(yearEnd(activeTB?.period || ''))}`)
    const cyLabel = 'Current Year'
    const pyLabel = 'Previous Year'
    const periodStartStr = yearStart(activeTB?.period || '')
    const periodEndStr = yearEnd(activeTB?.period || '')

    // General Notes — a single freeform narrative note (e.g. "Significant
    // Accounting Policies"), made up of internally-numbered — (a), (b), (c)...
    // — points. Note number resolved via data.generalNoteNum: either 1
    // (pushing every other note down) or last (after everything else), per
    // the CA's choice on the General Notes tab. It has pages of its own, and
    // the numbered notes start on a fresh page after it (as Note 1), or it
    // starts on a fresh page after them (as the last note). The signature
    // block comes ONCE, right after the last policy — not at the foot of every
    // page, whatever the page-wide "Sign Notes" toggle says. The CA asked for
    // both on 13 Sep 2026 (0.1.33 ran Note 2 on straight below it; 0.1.34 signed
    // every policies page). The signature sits inside the last point, flagged
    // data-flow-trailer, so it never starts a page on its own. A long point
    // breaks between its paragraphs, or between the rows of a table.
    let generalSection = ''
    if (data.generalNotes?.points?.length) {
      const points = data.generalNotes.points
      const signature = compactSignFooter(entity, auditor, signatories, { enabled: true, signPlace, signDate })
      generalSection = flowSection(header, '', [
        flowBlock('atomic', `<div class="note-block"><div class="note-title" data-flow-title>Note ${data.generalNoteNum}: ${esc(data.generalNotes.title || '')}</div></div>`, { keepNext: true }),
        ...points.map((pt, idx) => flowBlock('children', `
          <div class="general-note-point">
            <div class="general-note-point-header" data-flow-title>${pointLabel(idx)} ${esc(pt.header || '')}</div>
            <div class="general-note-body" data-flow-children>${fitRichTextTables(pointBodyHtml(pt))}${idx === points.length - 1 && signature.trim() ? `<div class="policies-signature" data-flow-trailer>${signature}</div>` : ''}</div>
          </div>`)),
      ])
    }

    const allNotes = data.activeNotes || Object.values(data.notes || {})
    const blocks = []
    for (const note of allNotes) {
      const t = (note.title || '').toLowerCase()
      const details = noteDetailsMap[note.num]
      // For notes with filled form details (Share Capital, LTB, Owners'/Partners'
      // Capital Account), the detail tables carry the breakdown instead of the
      // auto-derived Level 3 rows.
      const hasFormDetails = !!details && isFormDetailNoteTitle(t)
      const titleBlock = flowBlock('atomic', `<div class="note-block"><div class="note-title" data-flow-title>Note ${note.num}: ${esc(note.displayTitle || note.title)}</div></div>`, { keepNext: true })
      // A long set of details breaks between its sub-tables, or between the
      // rows of a table (its header rows repeat overleaf). Fill Details /
      // schedule tables (class fill-details) are the one place type may go
      // below 10pt — and only a table too wide for the page at 10pt does.
      const partsBlock = (html, cls = '') => (html ? flowBlock('children', `<div data-flow-children${cls ? ` class="${cls}"` : ''}>${html}</div>`, { contdTitle: `Note ${note.num}: ${note.displayTitle || note.title || ''}` }) : '')
      const disclosureHtml = renderDisclosure(noteDisclosureMap[note.num])
      const depScheduleHtml = renderITBlockSummaryTable(note.itBlockSummaryData, note.itBlockSummaryPyTotals, note.itWip)
        + renderCompScheduleTable(note.compScheduleData, note.compScheduleTbCY, note.compScheduleTbPY, note.compSchedulePyTotals)
      // PPE note: the IT Act Block-wise WDV Summary or the Dep (Comp)
      // category-level schedule (whichever is opted in — mutually exclusive by
      // construction) supersedes the plain "Property, Plant & Equipment /
      // Total" table entirely — same as the live Notes screen and the Excel export.
      const isPPEWithSchedule = (note.itBlockSummaryData && note.itBlockSummaryData.length > 0)
        || (note.compScheduleData && note.compScheduleData.length > 0)
      const detailHtml = details
        ? renderNoteDetails(note.title, withStbCurrentMaturities(details, note), note.num, cyLabel, pyLabel, note.total, note.prevTotal, periodStartStr, periodEndStr, isCompany)
        : ''
      if (isPPEWithSchedule) {
        blocks.push(titleBlock, partsBlock(depScheduleHtml, 'fill-details'))
      } else if (hasFormDetails && detailHtml) {
        blocks.push(titleBlock, partsBlock(detailHtml, 'fill-details'), partsBlock(depScheduleHtml, 'fill-details'))
      } else {
        const rows = hasFormDetails ? [] : buildNoteRows(note)
        blocks.push(flowBlock('rows', renderNoteTable(note, rows, { cyShort: cyLabel, pyShort: pyLabel })))
        if (details && !hasFormDetails) blocks.push(partsBlock(detailHtml, 'fill-details'))
        // Proprietorship / Partnership / LLP: the Trade Receivables ageing table,
        // beneath the note. Kept whole (rowspans must not be split across pages).
        if (isNonCorp12 && /trade.*receivable/i.test(note.title || '')) {
          // contdTitle: starting a page, it says whose table it is ("Note 18: Trade receivables (contd.)").
          blocks.push(flowBlock('atomic', `<div class="fill-details">${renderNcTradeReceivablesAgeing(details?.ncAgeing, note.total)}</div>`, { contdTitle: `Note ${note.num}: ${note.displayTitle || note.title || ''}` }))
        }
        blocks.push(partsBlock(depScheduleHtml, 'fill-details'))
      }
      blocks.push(partsBlock(disclosureHtml))
    }
    const notesSection = flowSection(header, compactSignFooter(entity, auditor, signatories, { enabled: signNotes, signPlace, signDate }), blocks.filter(Boolean))
    const generalLast = data.generalNotes?.position === 'last'
    return (generalLast ? '' : generalSection) + notesSection + (generalLast ? generalSection : '')
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ANNEXURES — Ledger-level details per note with heading + sub-heading
// ═══════════════════════════════════════════════════════════════════════════

// Ledgers grouped by sub-note (Level 2 for PL / Level 3 for BS — see
// utils/annexureGrouping.js, the SAME helper the live Annexures UI and the
// Excel export use, so all three always agree). Columns: Ledger Name |
// Sub-note | Code | CY Ledger | CY Sub-note Total | PY Ledger | PY Sub-note
// Total — the sub-note subtotal is shown only on the group's last ledger
// row, underlined.
function buildAnnexuresPages(entity, activeTB, data, auditor, signatories, signAnnex = false, prevTB = null, signPlace = '', signDate = '') {
  const hasSeparatePYTB = !!prevTB?.id
  const blocks = []
  const notes = data.activeNotes || Object.values(data.notes)

  for (const note of notes) {
    const isZeroRow = r => Math.abs(rowAmt(r, 'closing_balance')) < 0.005 && Math.abs(rowAmt(r, 'opening_balance')) < 0.005
    const shown = annexureDisplayLabels(note)   // print text only - the grouping above keeps the real labels
    const groups = getSubnoteGroups(note, data.levelFormat)
      .map(g => ({ ...g, rows: g.rows.filter(r => !isZeroRow(r)) }))
      .filter(g => g.rows.length > 0)

    // PPE only: which IT Act, 1961 block each ledger was assigned to (Dep
    // (IT) tab) — an extra transparency column, additional to the existing
    // Sub-note (asset-category) breakdown, never replacing it.
    const itBlockByLedger = note.itBlockByLedger
    const showBlockCol = itBlockByLedger && Object.keys(itBlockByLedger).length > 0

    // Flatten into structured rows, one per ledger, tagging the last row of
    // each group with that group's subtotal.
    const structuredRows = []
    for (const g of groups) {
      // Same figures the live Annexures screen and the Excel export show
      // (subnoteGroupFigures) — this is the document that actually gets
      // filed, so it must not carry a divergent figure even if screens or
      // the Excel export are somehow bypassed.
      const { cy: groupCY, py: groupPY } = subnoteGroupFigures(note, g, { amount: rowAmt, hasSeparatePYTB, prevMapL3: data.prevMapL3 })
      g.rows.forEach((row, ri) => {
        const isLast = ri === g.rows.length - 1
        // Per-ledger PY: a real identity match against the separate PY TB
        // (data.prevRowsByLedger — ledger_code, or name when no code), not
        // this row's own opening_balance which belongs to THIS TB. Matches
        // the live Annexures screen / Excel export.
        const pyLedgerKey = (row.ledger_code || row.ledger_name || row.name || '').trim().toLowerCase()
        const pyLedgerVal = hasSeparatePYTB
          ? (pyLedgerKey ? data.prevRowsByLedger?.get(pyLedgerKey) : undefined)
          : rowAmt(row, 'opening_balance')
        const ledgerNameForRow = row.ledger_name || row.name || ''
        structuredRows.push({
          subnote: ri === 0 ? shown(g.label) : '',
          unclassified: g.label === UNCLASSIFIED_LABEL,
          code: row.ledger_code || '',
          name: shown(ledgerNameForRow),
          itBlock: showBlockCol ? (itBlockByLedger[ledgerNameForRow]?.block || '—') : null,
          cy: rowAmt(row, 'closing_balance'),
          py: pyLedgerVal !== undefined ? pyLedgerVal : null,
          isLast,
          groupCY: isLast ? groupCY : null,
          groupPY: isLast ? groupPY : null,
        })
      })
    }
    // A sub-note only last year had: one line of its own, so the groups add
    // up to the note's Previous Year total (see pyOnlySubnoteLines).
    if (hasSeparatePYTB) {
      for (const l of pyOnlySubnoteLines(note, groups, data.levelFormat)) {
        structuredRows.push({ subnote: l.label, unclassified: false, code: '', name: '(Previous Year only)',
          itBlock: showBlockCol ? '—' : null, cy: null, py: l.py, isLast: true, groupCY: null, groupPY: l.py })
      }
    }

    const leadCols = showBlockCol ? 4 : 3  // Ledger Name + Sub-note + [IT Block] + Code
    let cumCY = 0, cumPY = 0
    let body = ''
    for (const r of structuredRows) {
      cumCY += Number(r.cy) || 0
      cumPY += Number(r.py) || 0
      const ul = r.isLast ? 'text-decoration:underline' : ''
      body += `<tr class="${r.unclassified ? 'note-unclassified' : ''}" data-cum-cy="${fmtINR(cumCY)}" data-cum-py="${fmtINR(cumPY)}">
        <td class="indent-2">${esc(r.name)}</td>
        <td class="${r.unclassified ? 'note-unclassified' : ''}">${esc(r.subnote)}</td>
        ${showBlockCol ? `<td>${esc(r.itBlock)}</td>` : ''}
        <td>${esc(r.code)}</td>
        <td class="right" style="${ul}">${fmtINR(r.cy)}</td>
        <td class="right" style="font-weight:600;${ul}">${r.isLast ? fmtINR(r.groupCY) : ''}</td>
        <td class="right" style="${ul}">${fmtINR(r.py)}</td>
        <td class="right" style="font-weight:600;${ul}">${r.isLast ? fmtINR(r.groupPY) : ''}</td>
      </tr>`
    }
    body += `<tr class="total-row">
      <td colspan="${leadCols}">Total</td>
      <td></td>
      <td class="right">${fmtINR(note.total)}</td>
      <td></td>
      <td class="right">${fmtINR(note.prevTotal)}</td>
    </tr>`
    const carry = (label) => `<tr class="subtotal">
      <td colspan="${leadCols}" class="carryfwd-text">${label}</td>
      <td class="right carryfwd-text">{CY}</td>
      <td></td>
      <td class="right carryfwd-text">{PY}</td>
      <td></td>
    </tr>`

    blocks.push(flowBlock('rows', `
      <div class="note-block">
        <div class="note-title" data-flow-title>Note ${note.num}: ${esc(note.displayTitle || note.title)}</div>
        <table class="fs-table annex-table" data-flow-table>
          <thead>
            <tr>
              <th style="width:${showBlockCol ? 20 : 25}%">Ledger Name</th>
              <th style="width:${showBlockCol ? 12 : 15}%">Sub-note</th>
              ${showBlockCol ? `<th style="width:11%">IT Block</th>` : ''}
              <th style="width:${showBlockCol ? 3 : 4}%">Code</th>
              <th style="width:${showBlockCol ? 13.5 : 14}%" class="right">CY Ledger</th>
              <th style="width:${showBlockCol ? 13.5 : 14}%" class="right">CY Sub-note Total</th>
              <th style="width:${showBlockCol ? 13.5 : 14}%" class="right" data-py-col>PY Ledger</th>
              <th style="width:${showBlockCol ? 13.5 : 14}%" class="right" data-py-col>PY Sub-note Total</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
        <template data-flow-cf>${carry('Carried forward to next page')}</template>
        <template data-flow-bf>${carry('Brought forward from previous page')}</template>
      </div>`))
  }
  // Working of the ratio figure the General Notes use (Net Credit Purchases), below the annexures
  const ncp = data.generalNotes?.points?.length ? netCreditPurchasesWorking(data) : null
  if (ncp && (Math.abs(ncp.numerator.cy) > 0.005 || Math.abs(ncp.numerator.py) > 0.005)) {
    const f = (n) => (Math.abs(n) < 0.005 ? '-' : fmtINR(n))
    const trs = ncp.rows.map(r => r.kind === 'head'
      ? `<tr class="annex-heading"><td colspan="3">${esc(r.label)}</td></tr>`
      : `<tr class="${r.kind === 'total' ? 'total-row' : r.kind === 'sub' ? 'subtotal' : ''}"><td class="${r.kind === 'line' ? 'indent-2' : ''}">${esc(r.label)}</td><td class="right">${f(r.cy)}</td><td class="right">${f(r.py)}</td></tr>`).join('')
    const tail = (ncp.average !== null ? `
      ${ncp.components ? `<tr><td class="indent-2">Trade Payables at the end of the year</td><td class="right">${f(ncp.components.closing)}</td><td></td></tr>
      <tr><td class="indent-2">Trade Payables at the beginning of the year</td><td class="right">${f(ncp.components.opening)}</td><td></td></tr>` : ''}
      <tr class="subtotal"><td>Average Trade Payables</td><td class="right">${f(ncp.average)}</td><td></td></tr>` : '')
      + (ncp.ratio !== null ? `<tr class="total-row"><td>Trade Payables Turnover Ratio (times)</td><td class="right">${Number(ncp.ratio).toFixed(2)}</td><td></td></tr>` : '')
    blocks.push(flowBlock('atomic', `
      <div class="note-block">
        <div class="note-title" data-flow-title>Workings of Ratios — Net Credit Purchases</div>
        <table class="fs-table annex-table">
          <thead><tr><th style="width:60%">Particulars</th><th class="right" style="width:20%">Current Year</th><th class="right" style="width:20%" data-py-col>Previous Year</th></tr></thead>
          <tbody>${trs}${tail}</tbody>
        </table>
        <div style="font-size:9pt;margin-top:2mm;">Net Credit Purchases is taken as the total of the above Profit &amp; Loss captions; cash purchases and purchase returns are not separately identified. Trade Payables Turnover Ratio = Net Credit Purchases / Average Trade Payables.</div>
      </div>`, { keepNext: false }))
  }
  return flowSection(
    pageHeader(entity, 'Annexures — Ledger Details', `for the year ended ${esc(yearEnd(activeTB?.period || ''))}`),
    compactSignFooter(entity, auditor, signatories, { enabled: signAnnex, signPlace, signDate }),
    blocks,
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SIGNING PAGE — Auditor (left) + Management Signatories (right)
// ═══════════════════════════════════════════════════════════════════════════

function buildSigningPage(entity, activeTB, auditor, signatories, signPlace = '', signDate = '') {
  if (!auditor && (!signatories || signatories.length === 0)) return ''

  const placeLine = `<div class="sign-line">Place: ${signPlace ? esc(signPlace) : ''}</div>`
  const dateLine = `<div class="sign-line">Date: ${signDate ? esc(fmtISOToDMY(signDate)) : ''}</div>`

  const auditorBlock = auditor ? `
    <div class="sign-block sign-left">
      ${auditor.firm_name ? `<div class="sign-line sign-bold">For ${esc(auditor.firm_name)}</div>` : ''}
      ${auditor.firm_name ? `<div class="sign-line sign-sub">Chartered Accountants</div>` : '<div class="sign-line sign-bold">Chartered Accountant</div>'}
      ${auditor.frn ? `<div class="sign-line">Firm Registration No.: ${esc(auditor.frn)}</div>` : ''}
      <div class="sign-space"></div>
      <div class="sign-line sign-bold">${esc(auditor.name)}</div>
      ${auditor.designation ? `<div class="sign-line">${esc(auditor.designation)}</div>` : ''}
      <div class="sign-line">Membership No.: ${esc(auditor.membership_number)}</div>
      ${dateLine}
      ${placeLine}
    </div>` : '<div class="sign-block sign-left"></div>'

  const management = signatories && signatories.length > 0 ? `
    <div class="sign-block sign-right">
      <div class="sign-line sign-bold">${esc(signedOnBehalfOf(entity?.constitution))} <span class="sign-upper">${esc(entity?.name || '')}</span></div>
      <div class="sign-space"></div>
      <div class="sign-dir-grid">
        ${signatories.map(s => `
          <div class="sign-dir">
            <div class="sign-line sign-bold">${esc(s.name)}</div>
            ${s.designation ? `<div class="sign-line">${esc(s.designation)}</div>` : ''}
            ${signatoryIdText(entity?.constitution, s) ? `<div class="sign-line">${esc(signatoryIdText(entity?.constitution, s))}</div>` : ''}
          </div>
        `).join('')}
      </div>
      <div class="sign-space-sm"></div>
      ${auditor ? '' : `${dateLine}${placeLine}`}
    </div>` : '<div class="sign-block sign-right"></div>'

  return `
    <div class="print-page">
      ${pageHeader(entity, 'Signatures', `Financial Statements for the year ended ${esc(activeTB?.period || '')}`)}
      ${auditor ? '<div class="sign-note">As per our report of even date attached.</div>' : ''}
      <div class="sign-container">
        ${auditorBlock}
        ${management}
      </div>
    </div>`
}

// ── Cover page ──────────────────────────────────────────────────────────────
function buildCoverPage(entity, activeTB, prevTB) {
  const isCompany = parseInt(entity?.constitution) === 3
  const constitution = entity?.constitution_display || ''
  const period = yearEnd(activeTB?.period || '')
  return `
    <div class="print-page cover-page">
      <div class="cover-inner">
        <div class="cover-title">Financial Statements</div>
        <div class="cover-entity">${esc(entity?.name || '')}</div>
        ${isCompany
          ? (entity?.cin ? `<div class="cover-sub">CIN: ${esc(entity.cin)}</div>` : '')
          : (constitution ? `<div class="cover-sub">(${esc(constitution)})</div>` : '')}
        ${entity?.address ? `<div class="cover-sub">${esc(entity.address)}</div>` : ''}
        ${period ? `<div class="cover-period">For the year ended ${esc(period)}</div>` : ''}
        ${prevTB?.period ? `<div class="cover-sub">(with comparatives for ${esc(yearEnd(prevTB.period))})</div>` : ''}
        <div class="cover-divider"></div>
        <div class="cover-index">
          <div class="cover-index-title">Index</div>
          <div class="cover-index-item"><span>Balance Sheet</span><span>1</span></div>
          <div class="cover-index-item"><span>Statement of Profit &amp; Loss</span><span>2</span></div>
          <div class="cover-index-item"><span>Notes to Financial Statements</span><span>3 →</span></div>
          <div class="cover-index-item"><span>Annexures / Ledger-Level Details</span><span>After notes</span></div>
          <div class="cover-index-item"><span>Signatures</span><span>Last</span></div>
        </div>
      </div>
    </div>`
}

// ═══════════════════════════════════════════════════════════════════════════
// Main document builder
// ═══════════════════════════════════════════════════════════════════════════

// includeIndex / includeAnnexures (both default true): the export writes a second,
// "statements only" PDF with both off — first page the Balance Sheet, last page
// the last Note. Nothing else changes: page layout is per section (flow-section),
// and pages carry no numbers, so leaving the Index or the Annexures out cannot
// shift anything in what remains.
// ── "Previous Year not required - column left out" ───────────────────────────
// Every table whose Previous Year header carries data-py-col (the Balance Sheet, the Profit and Loss, each note and
// each annexure) is rebuilt without those columns: the cell under each is dropped, and a cell that spans them (a
// heading across the whole table, a "Total" label) is one column narrower. The "Carried forward" / "Brought forward"
// rows the page layout keeps beside a note's table follow that table. Tables without the mark are left exactly as
// they are (the Fill Details tables keep their own Previous Year columns).
function dropPyColumns(html) {
  const cellRx = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/g
  const spanOf = (attrs) => { const m = /colspan\s*=\s*"?(\d+)"?/i.exec(attrs); return m ? parseInt(m[1], 10) : 1 }
  const withSpan = (attrs, n) => n > 1
    ? (/colspan\s*=/i.test(attrs) ? attrs.replace(/colspan\s*=\s*"?\d+"?/i, `colspan="${n}"`) : `${attrs} colspan="${n}"`)
    : attrs.replace(/\s*colspan\s*=\s*"?\d+"?/i, '')
  const flaggedColumns = (table) => {
    const drop = new Set()
    for (const tr of table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)) {
      let col = 0
      for (const c of tr[0].matchAll(cellRx)) {
        const span = spanOf(c[2])
        if (/data-py-col/.test(c[2])) for (let k = col; k < col + span; k++) drop.add(k)
        col += span
      }
    }
    return drop
  }
  const trimRow = (tr, drop) => tr.replace(/(<tr\b[^>]*>)([\s\S]*?)(<\/tr>)/, (m, open, inner, close) => {
    let col = 0, out = ''
    for (const c of inner.matchAll(cellRx)) {
      const span = spanOf(c[2])
      let kept = 0
      for (let k = col; k < col + span; k++) if (!drop.has(k)) kept++
      col += span
      if (!kept) continue                                       // sat wholly in a dropped column
      out += `<${c[1]}${withSpan(c[2].replace(/\s*data-py-col/, ''), kept)}>${c[3]}</${c[1]}>`
    }
    return `${open}${out}${close}`
  })
  let drop = null
  return html.replace(/<div class="note-block">|<table\b[^>]*>[\s\S]*?<\/table>|<template\b[^>]*>[\s\S]*?<\/template>/g, (block) => {
    if (block.startsWith('<div')) { drop = null; return block }
    if (/^<table/i.test(block)) {
      drop = /data-py-col/.test(block) ? flaggedColumns(block) : null
      if (!drop || !drop.size) { drop = null; return block }
      return block.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/g, tr => trimRow(tr, drop))
    }
    if (!drop) return block                                      // a <template>: the layout copies of the carried-forward rows
    return block.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/g, tr => trimRow(tr, drop))
  })
}

export function buildFinancialsHTML({ entity, activeTB, prevTB, data, auditor: auditorGiven, signatories, signNotes = false, signAnnex = false, includeSigningPage = false, includeIndex = true, includeAnnexures = true, denomination = 'as_is', noteDetailsMap = {}, noteDisclosureMap = {}, signPlace = '', signDate = '' }) {
  _DENOM_KEY = denomination
  // A Company in absolute figures is signed by the directors only (utils/signingRules.js)
  const auditor = auditorForDenomination(entity, auditorGiven, denomination)
  // The Financial Ratios table's amounts follow the statements' denomination.
  data = { ...data, generalNotes: scaleRatioAmounts(data.generalNotes, (DENOMINATIONS[denomination] || DENOMINATIONS.as_is).divisor, (DENOMINATIONS[denomination] || DENOMINATIONS.as_is).decimals) }
  const css = `
    @page { size: A4; margin: 14mm 14mm 16mm 14mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Calibri', 'Arial', sans-serif;
      font-size: 11.5pt;
      color: #000;
      margin: 0;
      padding: 0;
      background: #fff;
    }
    .print-page {
      page-break-after: always;
      page-break-inside: avoid;
      padding: 0;
      display: flex;
      flex-direction: column;
      min-height: 262mm;
    }
    .print-page:last-child { page-break-after: auto; }
    .page-body { flex: 1 1 auto; }
    .page-signature {
      margin-top: auto;
      padding-top: 4mm;
      border-top: 0.75pt solid #000;
      page-break-inside: avoid;
    }
    .sigf-note { font-size: 10pt; font-style: italic; margin-bottom: 2mm; }
    .sigf-grid { display: flex; justify-content: space-between; gap: 8mm; }
    .sigf-col { flex: 1; }
    /* The auditor column takes only the width it needs, so the directors can
       sit on one row — a second row of directors costs ~13mm of the page. */
    .sigf-left { flex: 0 1 auto; padding-right: 4mm; }
    .sigf-right { flex: 1 1 0; min-width: 0; text-align: right; padding-left: 4mm; }
    .sigf-line { font-size: 10pt; line-height: 1.2; }
    .sigf-bold { font-weight: bold; }
    .sigf-sub { font-size: 10pt; color: #333; }
    .sigf-upper { text-transform: uppercase; letter-spacing: 0.3pt; font-size: 10pt; }
    .sigf-gap { height: 12mm; }
    .sigf-dirs { display: flex; flex-wrap: wrap; gap: 2mm 5mm; justify-content: flex-end; margin-top: 2mm; }
    .sigf-dir { min-width: 30mm; }
    .page-header { text-align: center; margin-bottom: 4mm; border-bottom: 1pt solid #000; padding-bottom: 2mm; }
    .entity-name { font-size: 13pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.4pt; }
    .entity-sub { font-size: 10pt; color: #333; margin-top: 0.5mm; }
    .statement-title { font-size: 11pt; font-weight: bold; margin-top: 2mm; text-transform: uppercase; }
    .denom-unit { font-size: 10pt; color: #555; font-style: italic; margin-top: 0.5mm; text-align: right; }
    .fs-table { width: 100%; border-collapse: collapse; font-size: 10pt; margin-top: 3mm; }
    .fs-table th { border-bottom: 1pt solid #000; padding: 2.5pt 4pt; font-weight: bold; text-align: left; background: #fff; font-size: 10pt; }
    .fs-table th.right { text-align: right; }
    .fs-table th.center { text-align: center; }
    .fs-table td { padding: 1.5pt 4pt; vertical-align: top; background: #fff; }
    .fs-table td, .fs-table th { line-height: 1.25; }
    .fs-table .section-title { font-weight: bold; text-transform: uppercase; padding: 2pt 0; border-top: 1pt solid #000; border-bottom: 0.4pt solid #000; letter-spacing: 0.4pt; }
    .fs-table .section-header { font-weight: bold; padding: 2pt 4pt; border-top: 0.4pt solid #ccc; }
    .fs-table .subtotal td { font-weight: bold; border-top: 0.4pt solid #999; }
    .fs-table .note-l3 td { border-top: 0.3pt solid #d1d5db; }
    .fs-table .note-subtotal td { border-top: 1pt solid #374151; font-weight: bold; background: #eff6ff; }
    .fs-table .total-row td { border-top: 0.75pt solid #000; border-bottom: 2pt double #000; font-weight: bold; background: #fff; }
    .fs-table .spacer { height: 3pt; }
    .fs-table .annex-heading td { font-weight: bold; padding: 2pt 4pt; border-top: 0.4pt solid #000; border-bottom: 0.4pt solid #ccc; }
    .fs-table .annex-subheading td { font-weight: 600; padding: 1.5pt 4pt; }
    .right { text-align: right; font-family: 'Calibri', 'Arial', sans-serif; }
    .center { text-align: center; }
    .indent-1 { padding-left: 9pt !important; }
    .indent-2 { padding-left: 18pt !important; }
    .roman { display: inline-block; width: 22pt; }
    .carryfwd-text { font-style: italic; color: #4b5563; font-size: inherit; }
    .uncat-text { font-style: italic; }
    .note-text { font-size: 10pt; padding: 1.5mm 0; }
    .footer-text { font-size: 10pt; color: #6b7280; font-style: italic; margin-top: 4mm; border-top: 0.25pt solid #d1d5db; padding-top: 1.5mm; text-align: center; }
    .note-block { margin-top: 1.5mm; margin-bottom: 3mm; page-break-inside: avoid; }
    .note-title { font-size: 10.5pt; font-weight: bold; margin-bottom: 1mm; border-bottom: 0.5pt solid #000; padding-bottom: 0.5mm; }
    .general-note-point { margin-bottom: 3mm; page-break-inside: avoid; }
    .general-note-point-header { font-size: 11.5pt; font-weight: bold; margin-bottom: 1mm; }
    .general-note-body { font-size: 11pt; line-height: 1.5; }
    .general-note-body p { margin: 0 0 2mm; }
    .general-note-body ul { list-style: disc; padding-left: 5mm; margin: 0 0 2mm; }
    .general-note-body ol { list-style: decimal; padding-left: 5mm; margin: 0 0 2mm; }
    .general-note-body table { border-collapse: collapse; width: 100%; margin: 2mm 0; }
    .general-note-body td, .general-note-body th { border: 0.5pt solid #999; padding: 1mm 2mm; font-size: 10pt; }
    .general-note-body th { background: #f3f4f6; font-weight: 600; }
    .note-col-hdr th { font-size: 10pt; padding: 1.5pt 4pt !important; border-bottom: 0.5pt solid #ccc !important; color: #444; font-weight: 600; }
    .option-row { color: #333; font-size: 10pt; }
    .note-unclassified td { color: #b91c1c !important; background: #fef2f2; }
    .compact-page { min-height: 255mm; }
    /* Balance Sheet / Profit and Loss face — the page layout script
       (fitOnePage) picks the largest size that keeps the statement on one
       page: 10.5pt with normal spacing whenever it fits. */
    .compact-table { font-size: var(--face-font, 10.5pt) !important; margin-top: 2mm !important; }
    .compact-table th { padding: var(--face-pad, 1.5pt) 4pt !important; }
    .compact-table td { padding: var(--face-pad, 1.5pt) 4pt !important; line-height: var(--face-lh, 1.2); }
    .compact-table .section-title { padding: var(--face-pad, 1.5pt) 0 !important; }
    .compact-table .section-header { padding: var(--face-pad, 1.5pt) 4pt !important; }
    .compact-table .spacer { height: 1.5pt !important; }
    .annex-table { font-size: 10pt; }
    .annex-table td, .annex-table th { padding: 1pt 3pt; }
    .annex-nature { font-style: italic; color: #6b7280; }
    .cover-page { display: flex; flex-direction: row !important; align-items: center; justify-content: center; min-height: 240mm; page-break-after: always; }
    .cover-inner { text-align: center; width: 100%; }
    .cover-title { font-size: 22pt; font-weight: bold; margin-bottom: 8mm; letter-spacing: 2pt; text-transform: uppercase; }
    .cover-entity { font-size: 17pt; font-weight: bold; text-transform: uppercase; letter-spacing: 1pt; margin-bottom: 2mm; }
    .cover-sub { font-size: 10.5pt; color: #444; margin-bottom: 2mm; }
    .cover-period { font-size: 11pt; margin-top: 4mm; font-style: italic; }
    .cover-divider { border-top: 1pt solid #000; margin: 12mm auto; width: 40%; }
    .cover-index { max-width: 120mm; margin: 0 auto; text-align: left; }
    .cover-index-title { font-size: 10pt; font-weight: bold; text-align: center; margin-bottom: 4mm; text-transform: uppercase; }
    .cover-index-item { display: flex; justify-content: space-between; padding: 1.5mm 0; border-bottom: 0.25pt dotted #000; font-size: 10.5pt; }
    .sign-note { font-size: 10pt; font-style: italic; margin-top: 2mm; margin-bottom: 8mm; }
    .sign-container { display: flex; justify-content: space-between; gap: 12mm; margin-top: 8mm; }
    .sign-block { flex: 1; min-height: 70mm; }
    .sign-left { padding-right: 4mm; border-right: 0.25pt solid #e5e7eb; }
    .sign-right { text-align: right; padding-left: 4mm; }
    .sign-line { font-size: 11.5pt; line-height: 1.3; }
    .sign-bold { font-weight: bold; }
    .sign-sub { font-size: 10pt; color: #333; }
    .sign-upper { text-transform: uppercase; letter-spacing: 0.5pt; }
    .sign-space { height: 18mm; }
    .sign-space-sm { height: 8mm; }
    .sign-dir-grid { display: flex; flex-wrap: wrap; gap: 3mm 8mm; justify-content: flex-end; margin-top: 4mm; }
    .sign-dir { min-width: 44mm; }
    .general-note-body table[data-rich-table] { width: 100%; table-layout: fixed; }
    .general-note-body td, .general-note-body th { overflow-wrap: break-word; padding: 1.2mm 1.5mm; vertical-align: top; }
    .general-note-body table[data-rich-table] th { text-align: left; }
    .general-note-body table[data-rich-table] :is(td, th, p) { font-size: inherit !important; }
    /* Fill Details / schedule tables: 10pt like the rest; the layout script
       (fitFillDetails) steps a table down only if it is too wide for the page. */
    .fill-details, .fill-details * { font-size: var(--fd-font, 10pt) !important; }
    /* One light grid for every Fill Details / schedule table, as Share Capital's
       (#ccc) — the ageing schedules and several others drew near-black lines. */
    .fill-details table th, .fill-details table td { border-color: #ccc !important; }
    /* The one signature block after the last policy (General Notes). */
    .policies-signature { margin-top: 8mm; line-height: normal; }
    template { display: none; }
    .flow-section { break-before: page; page-break-before: always; }
    .flow-section + .print-page { break-before: page; page-break-before: always; }
    /* The printed box is A4 less the @page margins: 182mm x 267mm. The layout
       script measures on screen, where text can wrap a hair differently than
       in print — so it measures 2mm narrower and caps pages at 258mm: whatever
       fits on screen then always fits on paper (a page that ran even slightly
       past the box used to print an extra, blank sheet). */
    .flow-page { min-height: 258mm; }
    @media screen {
      .print-page { width: 180mm; }
      .flow-page { height: 258mm; min-height: 0; }
      .flow-page .page-body { overflow: hidden; min-height: 0; }
      /* Balance Sheet / P&L faces: short labels barely wrap and their rows use
         fixed line heights, so they measure against 262mm (their print
         minimum is 255mm, so no blank sheet can follow). */
      .fit-measure { height: 262mm; min-height: 0; }
      .fit-measure .page-body { overflow: hidden; min-height: 0; }
    }
  `

  const buildNotes = buildNotesPages(entity, activeTB, auditor, signatories, signNotes, noteDetailsMap, prevTB, noteDisclosureMap, signPlace, signDate)(data)

  const pagesHtml = [
    includeIndex ? buildCoverPage(entity, activeTB, prevTB) : '',
    buildBSPage(entity, activeTB, prevTB, data, auditor, signatories, signPlace, signDate),
    buildPLPage(entity, activeTB, prevTB, data, auditor, signatories, signPlace, signDate),
    data.cfsSaved?.include ? buildCFSPage(entity, activeTB, data, auditor, signatories, signPlace, signDate) : '',
    buildNotes,
    includeAnnexures ? buildAnnexuresPages(entity, activeTB, data, auditor, signatories, signAnnex, prevTB, signPlace, signDate) : '',
    includeSigningPage ? buildSigningPage(entity, activeTB, auditor, signatories, signPlace, signDate) : '',
  ].join('\n  ')

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Financial Statements</title>
  <style>${css}</style>
</head>
<body>
  ${data?.pyMode === 'none_hide' ? dropPyColumns(pagesHtml) : pagesHtml}
  <script>(${flowLayoutScript.toString()})()</script>
</body>
</html>`
  return html
}

// ── Branch-wise Columnar HTML ─────────────────────────────────────────────────
// branchTBsData: [{ tbId, branchName, period, rows }]
export function buildColumnarHTML({ entity, branchTBsData, auditor: auditorGiven, signatories, denomination = 'as_is', noteDetailsMap = {}, generalNotes = null, signPlace = '', signDate = '' }) {
  _DENOM_KEY = denomination
  const auditor = auditorForDenomination(entity, auditorGiven, denomination)

  const branches = branchTBsData.map(b => ({
    branchName: b.branchName || `Branch ${b.tbId}`,
    period: b.period || '',
    data: processRows(b.rows, null, entity?.constitution, [], entity?.business_type),
  }))

  const constitution = entity?.constitution
  const N = branches.length
  const colPct = Math.max(10, Math.floor(50 / (N + 1)))

  function getAllLevel2Keys(branches, alieKey) {
    const order = []
    const seen = new Set()
    for (const br of branches) {
      const sections = alieKey === 'EL' ? br.data.elSections
        : alieKey === 'ASSETS' ? br.data.assetSections
        : alieKey === 'Income' ? br.data.incomeSections
        : br.data.expenseSections
      for (const sec of (sections || [])) {
        for (const line of (sec.lines || [])) {
          const key = `${sec.level1}||${line.level2}`
          if (!seen.has(key)) { seen.add(key); order.push({ level1: sec.level1, level2: line.level2 }) }
        }
      }
    }
    return order
  }

  function getAllLevel1Keys(branches, alieKey) {
    const order = []; const seen = new Set()
    for (const br of branches) {
      const sections = alieKey === 'Income' ? br.data.incomeSections : br.data.expenseSections
      for (const sec of (sections || [])) {
        if (!seen.has(sec.level1)) { seen.add(sec.level1); order.push(sec.level1) }
      }
    }
    return order
  }

  function buildColumnarBS() {
    const renderBSSection = (alieLabel, alieKey) => {
      const l2keys = getAllLevel2Keys(branches, alieKey)
      let body = `<tr><td colspan="${N + 2}" class="section-title">${esc(alieLabel)}</td></tr>`
      let curL1 = null
      for (const { level1, level2 } of l2keys) {
        if (level1 !== curL1) {
          curL1 = level1
          body += `<tr><td colspan="${N + 2}" class="section-header">${esc(level1)}</td></tr>`
        }
        const cells = branches.map(br => {
          const sec = (alieKey === 'EL' ? br.data.elSections : br.data.assetSections).find(s => s.level1 === level1)
          const line = sec?.lines?.find(l => l.level2 === level2)
          return `<td class="right">${fmtINR(line?.total || 0)}</td>`
        }).join('')
        const total = branches.reduce((s, br) => {
          const sec = (alieKey === 'EL' ? br.data.elSections : br.data.assetSections).find(s => s.level1 === level1)
          return s + (sec?.lines?.find(l => l.level2 === level2)?.total || 0)
        }, 0)
        body += `<tr><td class="indent-1">${esc(level2 || 'Uncategorised')}</td>${cells}<td class="right total-col">${fmtINR(total)}</td></tr>`
      }
      const totals = branches.map(br => (alieKey === 'EL' ? br.data.elSections : br.data.assetSections).reduce((s, sec) => s + sec.total, 0))
      const grand  = totals.reduce((s, t) => s + t, 0)
      body += `<tr class="total-row"><td>TOTAL ${esc(alieLabel)}</td>${totals.map(t => `<td class="right">${fmtINR(t)}</td>`).join('')}<td class="right total-col">${fmtINR(grand)}</td></tr>`
      return body
    }

    const brHdrs = branches.map(br => `<th class="right" style="width:${colPct}%">${esc(br.branchName)}</th>`).join('')
    return `<div class="print-page compact-page">
      <div class="page-body">
        ${pageHeader(entity, 'Balance Sheet — Branch-wise Columnar', '')}
        <table class="fs-table compact-table">
          <thead><tr><th style="width:${100 - (N+1)*colPct}%">Particulars</th>${brHdrs}<th class="right total-col" style="width:${colPct}%">Total</th></tr></thead>
          <tbody>
            ${renderBSSection('EQUITY AND LIABILITIES', 'EL')}
            <tr><td colspan="${N + 2}" class="spacer"></td></tr>
            ${renderBSSection('ASSETS', 'ASSETS')}
          </tbody>
        </table>
        <div class="footer-text">Branch-wise columnar Balance Sheet — figures before inter-branch eliminations.</div>
      </div>
      ${compactSignFooter(entity, auditor, signatories, { enabled: true })}
    </div>`
  }

  function buildColumnarPL() {
    const renderPLSection = (alieKey) => {
      const l1keys = getAllLevel1Keys(branches, alieKey)
      let body = ''
      for (const l1 of l1keys) {
        body += `<tr><td colspan="${N + 2}" class="section-header">${esc(l1)}</td></tr>`
        const l2set = new Set(); const l2order = []
        for (const br of branches) {
          const sec = (alieKey === 'Income' ? br.data.incomeSections : br.data.expenseSections).find(s => s.level1 === l1)
          for (const line of (sec?.lines || [])) {
            if (!l2set.has(line.level2)) { l2set.add(line.level2); l2order.push(line.level2) }
          }
        }
        for (const l2 of l2order) {
          const cells = branches.map(br => {
            const sec = (alieKey === 'Income' ? br.data.incomeSections : br.data.expenseSections).find(s => s.level1 === l1)
            return `<td class="right">${fmtINR(sec?.lines?.find(l => l.level2 === l2)?.total || 0)}</td>`
          }).join('')
          const tot = branches.reduce((s, br) => {
            const sec = (alieKey === 'Income' ? br.data.incomeSections : br.data.expenseSections).find(s => s.level1 === l1)
            return s + (sec?.lines?.find(l => l.level2 === l2)?.total || 0)
          }, 0)
          body += `<tr><td class="indent-1">${esc(l2 || l1)}</td>${cells}<td class="right total-col">${fmtINR(tot)}</td></tr>`
        }
        const subtots = branches.map(br => {
          const sec = (alieKey === 'Income' ? br.data.incomeSections : br.data.expenseSections).find(s => s.level1 === l1)
          return sec?.total || 0
        })
        const subtot = subtots.reduce((s, t) => s + t, 0)
        body += `<tr class="subtotal"><td class="indent-1">${esc(l1)} Total</td>${subtots.map(t => `<td class="right">${fmtINR(t)}</td>`).join('')}<td class="right total-col">${fmtINR(subtot)}</td></tr>`
      }
      return body
    }

    const totInc  = br => (br.data.incomeSections  || []).reduce((s, s2) => s + s2.total, 0)
    const totExp  = br => (br.data.expenseSections || []).reduce((s, s2) => s + s2.total, 0)
    const totPAT  = br => totInc(br) - totExp(br)
    const gInc = branches.reduce((s, br) => s + totInc(br), 0)
    const gExp = branches.reduce((s, br) => s + totExp(br), 0)
    const gPAT = gInc - gExp

    const brHdrs = branches.map(br => `<th class="right" style="width:${colPct}%">${esc(br.branchName)}</th>`).join('')
    const title = constitution === 1 ? 'Profit and Loss Account' : 'Statement of Profit and Loss'
    return `<div class="print-page compact-page">
      <div class="page-body">
        ${pageHeader(entity, title + ' — Branch-wise Columnar', '')}
        <table class="fs-table compact-table">
          <thead><tr><th style="width:${100 - (N+1)*colPct}%">Particulars</th>${brHdrs}<th class="right total-col" style="width:${colPct}%">Total</th></tr></thead>
          <tbody>
            <tr><td colspan="${N + 2}" class="section-title">INCOME</td></tr>
            ${renderPLSection('Income')}
            <tr class="total-row"><td>TOTAL INCOME</td>${branches.map(br => `<td class="right">${fmtINR(totInc(br))}</td>`).join('')}<td class="right total-col">${fmtINR(gInc)}</td></tr>
            <tr><td colspan="${N + 2}" class="spacer"></td></tr>
            <tr><td colspan="${N + 2}" class="section-title">EXPENSES</td></tr>
            ${renderPLSection('Expenses')}
            <tr class="total-row"><td>TOTAL EXPENSES</td>${branches.map(br => `<td class="right">${fmtINR(totExp(br))}</td>`).join('')}<td class="right total-col">${fmtINR(gExp)}</td></tr>
            <tr><td colspan="${N + 2}" class="spacer"></td></tr>
            <tr class="total-row"><td>Profit / (Loss) for the Year</td>${branches.map(br => `<td class="right">${fmtINR(totPAT(br))}</td>`).join('')}<td class="right total-col">${fmtINR(gPAT)}</td></tr>
          </tbody>
        </table>
        <div class="footer-text">Branch-wise columnar P&amp;L — figures before inter-branch eliminations.</div>
      </div>
      ${compactSignFooter(entity, auditor, signatories, { enabled: true })}
    </div>`
  }

  // Notes to accounts of the Auditee as a whole - Significant Accounting Policies and the rest of the General Notes. They are not a
  // branch's, so they stand once, after the Profit & Loss account (the columnar document had no place for them at all).
  function buildColumnarGeneralNotes() {
    const gn = generalNotes
    if (!gn?.points?.length) return ''
    const pts = gn.points.map((pt, idx) => `<div class="note-block general-note-point">
        <div class="note-title">${pointLabel(idx)} ${esc(pt.header || '')}</div>
        <div class="general-note-body">${fitRichTextTables(pointBodyHtml(pt))}</div>
      </div>`).join('')
    return `<div class="general-page">
      <div class="page-body">
        ${pageHeader(entity, `Notes to Accounts — ${gn.title || 'Significant Accounting Policies'}`, '')}
        ${pts}
      </div>
      ${compactSignFooter(entity, auditor, signatories, { enabled: true, signPlace, signDate })}
    </div>`
  }

  function buildBranchAnnexures() {
    return branches.map(br => {
      const allNotes = Object.values(br.data.notes || {}).filter(n => n.rows?.length)
      if (!allNotes.length) return ''
      let noteBlocks = ''
      for (const note of allNotes) {
        const l3map = new Map()
        for (const r of note.rows) {
          const l3 = r.mapping3_resultant || r.level3 || 'Uncategorised'
          if (!l3map.has(l3)) l3map.set(l3, [])
          l3map.get(l3).push(r)
        }
        let tbody = ''
        for (const [l3, rows] of l3map) {
          tbody += `<tr class="annex-heading"><td colspan="2">${esc(l3)}</td></tr>`
          for (const r of rows) {
            tbody += `<tr><td class="indent-1">${esc(r.name || r.ledger_name || '')}</td><td class="right">${fmtINR(rowAmt(r, 'closing_balance'))}</td></tr>`
          }
        }
        noteBlocks += `<div class="note-block">
          <div class="note-title">Note ${note.num}: ${esc(note.displayTitle || note.title)}</div>
          <table class="fs-table annex-table">
            <thead class="note-col-hdr"><tr><th>Ledger / Particulars</th><th class="right">Amount</th></tr></thead>
            <tbody>${tbody}</tbody>
          </table>
        </div>`
      }
      return `<div class="print-page">
        <div class="page-body">
          ${pageHeader(entity, `Annexures — Branch: ${esc(br.branchName)}`, br.period || '')}
          ${noteBlocks}
        </div>
        ${compactSignFooter(entity, auditor, signatories, { enabled: true })}
      </div>`
    }).join('')
  }

  const css = `
    @page { size: A4 landscape; margin: 10mm 10mm 12mm 10mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Calibri', 'Arial', sans-serif; font-size: 8pt; color: #000; margin: 0; padding: 0; background: #fff; }
    .print-page { page-break-after: always; page-break-inside: avoid; display: flex; flex-direction: column; min-height: 185mm; }
    .print-page:last-child { page-break-after: auto; }
    .page-body { flex: 1 1 auto; }
    .page-signature { margin-top: auto; padding-top: 3mm; border-top: 0.75pt solid #000; page-break-inside: avoid; }
    .sigf-note { font-size: 7pt; font-style: italic; margin-bottom: 2mm; }
    .sigf-grid { display: flex; justify-content: space-between; gap: 8mm; }
    .sigf-col { flex: 1; }
    .sigf-left { padding-right: 4mm; }
    .sigf-right { text-align: right; padding-left: 4mm; }
    .sigf-line { font-size: 7.5pt; line-height: 1.2; }
    .sigf-bold { font-weight: bold; }
    .sigf-sub { font-size: 6.5pt; color: #333; }
    .sigf-upper { text-transform: uppercase; }
    .sigf-gap { height: 10mm; }
    .sigf-dirs { display: flex; gap: 6mm; justify-content: flex-end; }
    .sigf-dir { min-width: 30mm; }
    .page-header { text-align: center; margin-bottom: 3mm; border-bottom: 1pt solid #000; padding-bottom: 2mm; }
    .entity-name { font-size: 10pt; font-weight: bold; text-transform: uppercase; }
    .entity-sub { font-size: 7.5pt; color: #333; margin-top: 0.5mm; }
    .statement-title { font-size: 8.5pt; font-weight: bold; margin-top: 2mm; text-transform: uppercase; }
    .denom-unit { font-size: 7pt; color: #555; font-style: italic; margin-top: 0.5mm; text-align: right; }
    .fs-table { width: 100%; border-collapse: collapse; }
    .fs-table th { border-bottom: 1pt solid #000; padding: 1.5pt 3pt; font-weight: bold; text-align: left; }
    .fs-table th.right { text-align: right; }
    .fs-table th.center { text-align: center; }
    .fs-table td { padding: 0.75pt 3pt; vertical-align: top; }
    .fs-table .section-title { font-weight: bold; text-transform: uppercase; padding: 1.5pt 0; border-top: 1pt solid #000; border-bottom: 0.4pt solid #000; }
    .fs-table .section-header { font-weight: bold; padding: 1pt 3pt; border-top: 0.4pt solid #ccc; }
    .fs-table .subtotal td { font-weight: bold; border-top: 0.4pt solid #999; }
    .fs-table .total-row td { border-top: 0.75pt solid #000; border-bottom: 2pt double #000; font-weight: bold; }
    .fs-table .spacer { height: 2pt; }
    .total-col { background: #f5f5f5; }
    .right { text-align: right; }
    .indent-1 { padding-left: 8pt !important; }
    .uncat-text { font-style: italic; }
    .footer-text { font-size: 6.5pt; color: #6b7280; font-style: italic; margin-top: 3mm; border-top: 0.25pt solid #d1d5db; padding-top: 1mm; text-align: center; }
    .note-block { margin: 2mm 0 3mm; page-break-inside: avoid; }
    .note-title { font-size: 8pt; font-weight: bold; margin-bottom: 1mm; border-bottom: 0.5pt solid #000; padding-bottom: 0.5mm; }
    .note-col-hdr th { font-size: 7pt; padding: 1pt 3pt !important; border-bottom: 0.5pt solid #ccc !important; color: #444; }
    .annex-table { font-size: 7pt; }
    .annex-heading td { font-weight: bold; padding: 1pt 3pt; border-top: 0.4pt solid #000; }
    .compact-page { min-height: 180mm; }
    .general-page { page-break-after: always; }
    .general-note-body { font-size: 8pt; line-height: 1.3; }
    .general-note-body p { margin: 0 0 1.5mm; }
    .general-note-body table { border-collapse: collapse; font-size: 7.5pt; }
    .general-note-body td, .general-note-body th { border: 0.4pt solid #666; padding: 1pt 3pt; }
    .compact-table th { font-size: 7.5pt; padding: 1.5pt 3pt !important; }
    .compact-table td { font-size: 7.5pt; padding: 0.75pt 3pt !important; }
    .compact-table .section-header { font-size: 7.5pt; }
  `

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Branch-wise Financial Statements — ${esc(entity?.name || '')}</title>
  <style>${css}</style>
</head>
<body>
  ${buildColumnarBS()}
  ${buildColumnarPL()}
  ${buildColumnarGeneralNotes()}
  ${buildBranchAnnexures()}
</body>
</html>`
}
