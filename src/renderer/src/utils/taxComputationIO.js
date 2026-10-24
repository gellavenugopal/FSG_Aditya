// What the Tax Computation screen, the Exception Report and the Excel save / upload share.
//   buildTaxInput(data, depIT, periodLabel, today, group) : the figures drawn from the statements
//   loadTaxComputationSaved / loadDepIT                    : what is saved / the Dep (IT) depreciation (Consolidated for a branch Auditee)
//   buildSavedWorkbook / parseSavedWorkbook                : the Excel with the computation, and its restorable inputs sheet
import * as XLSX from 'xlsx-js-style'
import { extractITRFigures } from './itrPull'
import { consolidatedDepFromNoteDetails } from './depStore'
import { computeTax, num } from './taxComputation'

export function resolveGroup(entity) {
  const disp = (entity?.constitution_display || '').toLowerCase()
  if (disp.includes('company')) return 'company'
  if (disp.includes('partnership') || disp.includes('llp')) return 'partnership'
  if (disp.includes('individual') || disp.includes('huf') || disp.includes('proprietor')) return 'individual'
  const c = parseInt(entity?.constitution)
  if (c === 3) return 'company'
  if (c === 2) return 'partnership'
  return 'individual'
}

export function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function figuresOf(data) {
  if (!data) return null
  try { return extractITRFigures(data).fig } catch { return null }
}

export function buildTaxInput(group, fig, depIT, periodLabel, today) {
  return {
    group, today, periodLabel: periodLabel || '',
    pbt: fig ? fig._profitBeforeTax : 0,
    depCompanies: fig ? fig.depreciation : 0,
    depIT: depIT || 0,
    remuneration: fig ? fig.partnersRemuneration : 0,
    currentTaxPL: fig ? fig.taxCurrentOnly : 0,
  }
}

export async function loadDepIT(entity, activeTB) {
  const sum = (dd) => (Array.isArray(dd?.blockSummary) ? dd.blockSummary.reduce((s, b) => s + num(b.depreciation), 0) : 0)
  try {
    if (!activeTB?.id) return 0
    if (activeTB.id === '__consolidated__') {
      const nd = await window.api?.listEntityNoteDetails?.(entity.id)
      return sum(consolidatedDepFromNoteDetails(nd).depITData)
    }
    return sum(await window.api?.depITGet?.(activeTB.id))
  } catch { return 0 }
}

export async function loadTaxComputationSaved(entityId, periodId) {
  if (!entityId || !periodId) return null
  try { return (await window.api?.getTaxComputation?.(entityId, periodId)) || null } catch { return null }
}

// ── Excel: the computation (to read) and an inputs sheet (to restore) ──────────────────────────────
const INPUT_SHEET = 'Inputs (do not edit)'
const SCALARS = ['rate', 'surcharge', 'cess', 'advanceTotal', 'tds', 'tcs', 'dueDate', 'filingDate', 'presumptive']
const OVERRIDES = ['pbt', 'dep_co', 'dep_it', 'remun', 'allowable']

export function buildSavedWorkbook({ entityName, title, subtitle, lines, saved }) {
  const aoa = [[entityName || ''], [title], [subtitle || ''], [], ['Particulars', 'Amount (Rs.)']]
  for (const r of lines) aoa.push([r.a, r.b == null ? '' : Math.round(r.b * 100) / 100])
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 84 }, { wch: 20 }]
  const inp = [['FSG Bharat - Tax Computation: saved inputs. Upload this file in Features > Tax Computation to put them back. Do not change the first column.'], ['key', 'value', 'amount']]
  const s = saved || {}
  for (const k of OVERRIDES) if (s.ov && s.ov[k] !== null && s.ov[k] !== undefined) inp.push(['ov.' + k, s.ov[k]])
  for (const k of SCALARS) if (s[k] !== null && s[k] !== undefined && s[k] !== '') inp.push([k, typeof s[k] === 'boolean' ? (s[k] ? 1 : 0) : s[k]])
  ;(s.advance || []).forEach((v, i) => { if (v !== null && v !== undefined) inp.push(['advance.' + (i + 1), v]) })
  for (const r of (s.additions || [])) inp.push(['addition', r.label || '', r.amount])
  for (const r of (s.deductions || [])) inp.push(['deduction', r.label || '', r.amount])
  const wi = XLSX.utils.aoa_to_sheet(inp)
  wi['!cols'] = [{ wch: 22 }, { wch: 50 }, { wch: 18 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Tax Computation')
  XLSX.utils.book_append_sheet(wb, wi, INPUT_SHEET)
  return wb
}

// returns the saved document, or null when the file is not a saved Tax Computation
export function parseSavedWorkbook(wb) {
  const sh = wb && wb.Sheets && wb.Sheets[INPUT_SHEET]
  if (!sh) return null
  const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '' })
  const out = { ov: {}, additions: [], deductions: [], rate: null, surcharge: null, cess: null, advance: [null, null, null, null], advanceTotal: null, tds: null, tcs: null, dueDate: '', filingDate: '', presumptive: false }
  const n = (v) => { if (v === '' || v === null || v === undefined) return null; const x = parseFloat(String(v).replace(/,/g, '')); return Number.isFinite(x) ? x : null }
  let id = 0, any = false
  for (const r of rows) {
    const k = String(r[0] || '').trim()
    if (!k || k === 'key') continue
    if (k.startsWith('ov.')) { const v = n(r[1]); if (v !== null && OVERRIDES.includes(k.slice(3))) { out.ov[k.slice(3)] = v; any = true } }
    else if (k.startsWith('advance.')) { const i = parseInt(k.slice(8), 10) - 1; if (i >= 0 && i < 4) { out.advance[i] = n(r[1]); any = true } }
    else if (k === 'addition' || k === 'deduction') {
      const list = k === 'addition' ? out.additions : out.deductions
      list.push({ id: 'u' + (++id), label: String(r[1] || ''), amount: n(r[2]) || 0 }); any = true
    } else if (SCALARS.includes(k)) {
      if (k === 'dueDate' || k === 'filingDate') out[k] = String(r[1] || '').slice(0, 10)
      else if (k === 'presumptive') out[k] = n(r[1]) === 1
      else out[k] = n(r[1])
      any = true
    }
  }
  return any ? out : null
}

// the lines of the computation, in the order they are printed
export function computationLines(m) {
  const L = []
  const add = (a, b, bold = false) => L.push({ a, b, bold })
  add('Profit before tax as per Profit & Loss account', m.pbt, true)
  add('Add:', null, true)
  m.additions.forEach(r => add('   ' + r.label, r.amount))
  add('Total additions', m.addTotal, true)
  add('Less:', null, true)
  m.deductions.forEach(r => add('   ' + r.label, r.amount))
  add('Total deductions', m.dedTotal, true)
  if (m.group === 'partnership') {
    add('Book Profit', m.bookProfit, true)
    add("Less: Allowable partners' remuneration (s.40(b))", m.allowable)
  }
  add('Total Income (rounded off u/s 288A)', m.totalIncome, true)
  add(`Tax @ ${m.rate}%`, m.tax)
  add(`Surcharge @ ${m.surchargePct}%`, m.surcharge)
  add(`Health and Education Cess @ ${m.cessPct}%`, m.cess)
  add('Total tax (rounded off u/s 288B)', m.totalTax, true)
  add('Less: Advance tax', m.advanceTotal)
  add('Less: TDS', m.tds)
  add('Less: TCS', m.tcs)
  add('Net tax payable / (refundable)', m.netPayable, true)
  add('Interest u/s 234A', m.interest.a)
  add('Interest u/s 234B', m.interest.b)
  add('Interest u/s 234C', m.interest.c)
  add('Total payable / (refundable) including interest', m.grandPayable, true)
  return L
}

export { computeTax }
