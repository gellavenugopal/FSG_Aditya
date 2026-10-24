// ── Snapshot of the finalised statements, for Cloudtail MCA (DR and MCA forms) ───────────────────────────────────────
// FSG Bharat works the figures out when it prints; Cloudtail never recalculates them. This builds the document FSG Bharat
// publishes into the table fs_snapshots (src/main/ipc/fs-snapshot.js) - the statements as printed: the Balance Sheet and
// Profit & Loss faces with a stable code per line, the notes, the key figures Cloudtail needs, the share capital details, and
// the auditor and signatories as printed. Layout: Cloudtail_MCA/docs/PLAN.md section 7 (schema_version 1).
//
// Amounts are absolute rupees (the denomination chosen at print time changes only how a figure is displayed).
// Companies (constitution 3) only: that is what Cloudtail serves.
import { computeCompanyBSLayout } from './bsStructure'
import { EXPENSE_LINES, corpFaceTail, TAX_SECTION_RX } from './plStructureCorp'
import { printNoteRows } from './noteRowHeaders'

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const r2 = (n) => Math.round(num(n) * 100) / 100
const note = (n) => (n === null || n === undefined || n === '' ? null : String(n))

// "2025-04-01 To 2026-03-31" -> { from, till }
export function periodDates(period) {
  const m = /(\d{4}-\d{2}-\d{2})\s*(?:to|-)\s*(\d{4}-\d{2}-\d{2})/i.exec(String(period || ''))
  return m ? { from: m[1], till: m[2] } : { from: null, till: null }
}
const yearLabel = (from, till) => (from && till ? `FY ${from.slice(0, 4)}-${till.slice(2, 4)}` : null)

// ── Balance Sheet face: code per line (BS.EL.<group>.<letter>[.<roman>], BS.AS...), as the face is laid out ──
export function snapshotBalanceSheet(data) {
  const layout = computeCompanyBSLayout(data)
  const lines = [], byKey = {}
  const push = (code, label, noteNum, cy, py, level, extra = {}) => lines.push({ code, label, note: note(noteNum), cy: r2(cy), py: r2(py), level, ...extra })
  for (const [S, side, caption] of [['EL', layout.el, 'Equity and liabilities'], ['AS', layout.assets, 'Assets']]) {
    for (const g of side.groups) {
      push(`BS.${S}.${g.num}`, g.label, null, g.total, g.prevTotal, 1)
      let head = null
      for (const l of g.lines) {
        if (l.heading) { head = l.alpha; push(`BS.${S}.${g.num}.${l.alpha}`, l.label, null, 0, 0, 2, { heading: true }); continue }
        const code = l.sub && head ? `BS.${S}.${g.num}.${head}.${l.alpha}` : `BS.${S}.${g.num}.${l.alpha || l.key}`
        if (!l.sub) head = null
        push(code, l.label, l.noteNum, l.total, l.prevTotal, l.sub ? 3 : 2, { key: l.key })
        byKey[l.key] = { cy: num(l.total), py: num(l.prevTotal) }
        ;(l.subLines || []).forEach((s, i) => push(`${code}.${i + 1}`, s.label, null, s.total ?? s.cy, s.prevTotal ?? s.py, 3))
      }
      if (g.uncat) push(`BS.${S}.${g.num}.UNCAT`, g.uncat.label, g.uncat.noteNum, g.uncat.total, g.uncat.prevTotal, 2)
    }
    if (side.uncatTop) push(`BS.${S}.UNCAT`, side.uncatTop.label, side.uncatTop.noteNum, side.uncatTop.total, side.uncatTop.prevTotal, 1)
    push(`BS.${S}.TOTAL`, `Total ${caption.toLowerCase()}`, null, S === 'EL' ? layout.totalEL : layout.totalAsset, S === 'EL' ? layout.prevEL : layout.prevAsset, 0)
  }
  return { lines, byKey, totals: { el: { cy: num(layout.totalEL), py: num(layout.prevEL) }, assets: { cy: num(layout.totalAsset), py: num(layout.prevAsset) } } }
}

// ── Profit and Loss face, same logic as the printed statement (buildPLPage) ──
export function snapshotProfitAndLoss(data) {
  const exp = data.expenseSections || [], inc = data.incomeSections || []
  const buckets = {}
  EXPENSE_LINES.forEach(el => { buckets[el.key] = { total: 0, prevTotal: 0, noteNum: null } })
  const openSec = exp.find(s => /opening stock/i.test(s.level1))
  const closeSec = inc.find(s => /closing stock/i.test(s.level1))
  const changesSec = exp.find(s => /changes in inventor/i.test(s.level1))
  buckets.inv_changes.total = changesSec?.total || 0
  buckets.inv_changes.prevTotal = changesSec?.prevTotal || 0
  buckets.inv_changes.noteNum = changesSec?.noteNum || openSec?.noteNum || closeSec?.noteNum || null
  const skip = new Set([openSec?.level1, closeSec?.level1, changesSec?.level1].filter(Boolean))
  const uncatExp = []
  for (const sec of exp) {
    if (skip.has(sec.level1)) continue
    if (/tax expense/i.test(sec.level1) || /exceptional|extraordinary/i.test(sec.level1) || /discontinuing/i.test(sec.level1)) continue
    if (/uncategorised/i.test(sec.level1)) { uncatExp.push(sec); continue }
    let matched = false
    for (const el of EXPENSE_LINES) {
      if (el.match && el.match.test(sec.level1)) {
        buckets[el.key].total += sec.total; buckets[el.key].prevTotal += sec.prevTotal
        if (!buckets[el.key].noteNum) buckets[el.key].noteNum = sec.noteNum
        matched = true; break
      }
    }
    if (!matched) {
      buckets.other_expenses.total += sec.total; buckets.other_expenses.prevTotal += sec.prevTotal
      if (!buckets.other_expenses.noteNum) buckets.other_expenses.noteNum = sec.noteNum
    }
  }
  const pure = inc.filter(s => !/closing stock/i.test(s.level1) && !/exceptional|extraordinary/i.test(s.level1))
  const rev = pure.find(s => /revenue from operation/i.test(s.level1))
  const uncatInc = pure.filter(s => /uncategorised/i.test(s.level1))
  const other = pure.filter(s => !/revenue from operation/i.test(s.level1) && !/uncategorised/i.test(s.level1))
  const sumC = (a) => a.reduce((s, x) => s + num(x.total), 0), sumP = (a) => a.reduce((s, x) => s + num(x.prevTotal), 0)
  const revCY = num(rev?.total), revPY = num(rev?.prevTotal)
  const otherCY = sumC(other), otherPY = sumP(other), uIncCY = sumC(uncatInc), uIncPY = sumP(uncatInc)
  const incomeCY = revCY + otherCY + uIncCY, incomePY = revPY + otherPY + uIncPY
  const uExpCY = sumC(uncatExp), uExpPY = sumP(uncatExp)
  const expCY = EXPENSE_LINES.reduce((s, el) => s + buckets[el.key].total, 0) + uExpCY
  const expPY = EXPENSE_LINES.reduce((s, el) => s + buckets[el.key].prevTotal, 0) + uExpPY
  const tail = corpFaceTail(exp)
  const taxSecs = exp.filter(s => TAX_SECTION_RX.test((s.level1 || '').trim()))
  const taxCY = sumC(taxSecs), taxPY = sumP(taxSecs)
  const defLines = taxSecs.flatMap(s => s.lines || []).filter(l => /deferred/i.test(l.level2 || ''))
  const defCY = sumC(defLines), defPY = sumP(defLines)
  const pbeetCY = incomeCY - expCY, pbeetPY = incomePY - expPY
  const pbetCY = pbeetCY - tail.exceptional.cy, pbetPY = pbeetPY - tail.exceptional.py
  const pbtCY = pbetCY - tail.extraordinary.cy, pbtPY = pbetPY - tail.extraordinary.py
  const patCY = pbtCY - taxCY, patPY = pbtPY - taxPY
  const lines = []
  const push = (code, label, noteNum, cy, py) => lines.push({ code, label, note: note(noteNum), cy: r2(cy), py: r2(py) })
  push('PL.I', 'Revenue from operations', rev?.noteNum, revCY, revPY)
  push('PL.II', 'Other income', other[0]?.noteNum, otherCY, otherPY)
  if (uIncCY || uIncPY) push('PL.II.UNCAT', 'Uncategorised income', uncatInc[0]?.noteNum, uIncCY, uIncPY)
  push('PL.III', 'Total revenue (I + II)', null, incomeCY, incomePY)
  for (const el of EXPENSE_LINES) push(`PL.IV.${el.key}`, el.label, buckets[el.key].noteNum, buckets[el.key].total, buckets[el.key].prevTotal)
  if (uExpCY || uExpPY) push('PL.IV.UNCAT', 'Uncategorised expenses', uncatExp[0]?.noteNum, uExpCY, uExpPY)
  push('PL.IV', 'Total expenses', null, expCY, expPY)
  push('PL.V', 'Profit before exceptional and extraordinary items and tax (III - IV)', null, pbeetCY, pbeetPY)
  push('PL.VI', 'Exceptional items', tail.exceptional.noteNum, tail.exceptional.cy, tail.exceptional.py)
  push('PL.VII', 'Profit before extraordinary items and tax (V - VI)', null, pbetCY, pbetPY)
  push('PL.VIII', 'Extraordinary items', tail.extraordinary.noteNum, tail.extraordinary.cy, tail.extraordinary.py)
  push('PL.IX', 'Profit before tax (VII - VIII)', null, pbtCY, pbtPY)
  push('PL.X', 'Tax expense', taxSecs[0]?.noteNum, taxCY, taxPY)
  push('PL.X.CURRENT', 'Current tax (and other than deferred)', null, taxCY - defCY, taxPY - defPY)
  push('PL.X.DEFERRED', 'Deferred tax', null, defCY, defPY)
  push('PL.XI', 'Profit from continuing operations (IX - X)', null, patCY, patPY)
  push('PL.DISC', 'Profit / (loss) from discontinuing operations (after tax)', null, tail.discAfterTax.cy, tail.discAfterTax.py)
  push('PL.PAT', 'Profit / (loss) for the period', null, patCY + tail.discAfterTax.cy, patPY + tail.discAfterTax.py)
  return { lines, v: { revCY, revPY, otherCY, otherPY, pbtCY, pbtPY, taxCY, taxPY, defCY, defPY, patCY: patCY + tail.discAfterTax.cy, patPY: patPY + tail.discAfterTax.py } }
}

const effectiveEps = (eps, kind, year) => {
  if (!eps) return null
  const ov = eps.overrides?.[`${kind}${year}`]
  if (ov !== null && ov !== undefined) return r2(ov)
  const auto = eps[`auto${kind === 'basic' ? 'Basic' : 'Diluted'}${year}`]
  return auto === null || auto === undefined || !Number.isFinite(auto) ? null : r2(auto)
}

// noteDetailsMap: Map / object of note number -> the saved Fill Details of that note (as the PDF is given them)
// periodInfo: the Financial Year of the Auditee (financial_periods: year_label, date_from, date_till) - authoritative; the Trial Balance's own period text is the fallback
export function buildFsSnapshotPayload({ entity, activeTB, data, auditor = null, signatories = [], signPlace = '', signDate = '', noteDetailsMap = null, denomination = 'as_is', appVersion = null, periodInfo = null }) {
  const bs = snapshotBalanceSheet(data)
  const pl = snapshotProfitAndLoss(data)
  const ymd = (x) => (x ? String(x).slice(0, 10) : null)
  const fromTB = periodDates(activeTB?.period)
  const dates = periodInfo && periodInfo.date_from && periodInfo.date_till ? { from: ymd(periodInfo.date_from), till: ymd(periodInfo.date_till) } : fromTB
  const label = periodInfo && periodInfo.year_label ? (/^FY/i.test(periodInfo.year_label) ? periodInfo.year_label : `FY ${periodInfo.year_label}`) : yearLabel(dates.from, dates.till)
  const details = (n) => {
    if (!noteDetailsMap) return null
    const v = typeof noteDetailsMap.get === 'function' ? noteDetailsMap.get(Number(n)) : noteDetailsMap[n]
    return v === undefined ? null : v
  }
  const notes = (data.activeNotes || Object.values(data.notes || {})).map(nt => ({
    num: String(nt.num),
    title: nt.title,
    side: nt.isPL ? 'PL' : 'BS',
    total: r2(nt.total), prev_total: r2(nt.prevTotal),
    rows: printNoteRows((nt.templateRows || []).filter(r => !r.screenOnly)).map(r => ({
      label: r.label ?? '', cy: r.cy === undefined || r.cy === null ? null : r2(r.cy), py: r.py === undefined || r.py === null ? null : r2(r.py), depth: r.indent || 0,
    })),
    fill_details: details(nt.num),
  }))
  const scNote = notes.find(n => /share capital/i.test(n.title || '') && n.fill_details)
  const sc = scNote ? scNote.fill_details : null
  const k = (cy, py) => ({ cy: r2(cy), py: r2(py) })
  const paid = bs.byKey.share_capital || { cy: 0, py: 0 }, res = bs.byKey.reserves || { cy: 0, py: 0 }
  const ltb = bs.byKey.ltb || { cy: 0, py: 0 }, stb = bs.byKey.stb || { cy: 0, py: 0 }
  const v = pl.v
  const firm = auditor?.firm_name || ''
  return {
    schema_version: 1,
    entity: { id: entity?.id ?? null, name: entity?.name || '', constitution: parseInt(entity?.constitution) || null, cin: entity?.cin || null, address: entity?.address || null, pan: entity?.pan || null },
    period: { entity_period_id: activeTB?.entity_period_id ?? null, year_label: label, date_from: dates.from, date_till: dates.till },
    basis: { consolidated: false, branches: [], rounding: 'rupees', decimals: 2, printed_denomination: denomination },
    balance_sheet: bs.lines,
    profit_and_loss: pl.lines,
    notes,
    key_figures: {
      turnover: k(v.revCY, v.revPY), revenue_from_operations: k(v.revCY, v.revPY), other_income: k(v.otherCY, v.otherPY),
      pbt: k(v.pbtCY, v.pbtPY), tax_current: k(v.taxCY - v.defCY, v.taxPY - v.defPY), tax_deferred: k(v.defCY, v.defPY), pat: k(v.patCY, v.patPY),
      paid_up_capital: k(paid.cy, paid.py), reserves_and_surplus: k(res.cy, res.py), net_worth: k(paid.cy + res.cy, paid.py + res.py),
      long_term_borrowings: k(ltb.cy, ltb.py), short_term_borrowings: k(stb.cy, stb.py),
      eps_basic: { cy: effectiveEps(data.eps, 'basic', 'CY'), py: effectiveEps(data.eps, 'basic', 'PY') },
      eps_diluted: { cy: effectiveEps(data.eps, 'diluted', 'CY'), py: effectiveEps(data.eps, 'diluted', 'PY') },
    },
    definitions: {
      turnover: 'Revenue from operations (PL.I), as printed - Companies Act s.2(91)',
      net_worth: 'Paid-up share capital (BS.EL.1.a) + reserves and surplus (BS.EL.1.b), as printed; a revaluation reserve is not separately identified',
      tax_current: 'Tax expense (PL.X) less the lines of its note captioned deferred tax',
    },
    share_capital: {
      classes: sc?.classes || [], shareholders5pctEquity: sc?.shareholders5pctEquity || [], shareholders5pctPreference: sc?.shareholders5pctPreference || [],
      promoters: sc?.promoters || [], rights: sc?.rights || '', footnotes: sc?.footnotes || [],
    },
    signatories_as_printed: (signatories || []).map(s => ({ name: s.name || '', id_type: 'DIN', id: s.din || '', designation: s.designation || '' })),
    auditor_as_printed: {
      firm_name: firm, frn: auditor?.frn || auditor?.firm_frn || '', partner: auditor?.name || '', membership_number: auditor?.membership_number || '',
      udin: null, place: signPlace || null, date: signDate || null,
    },
    app_version: appVersion,
  }
}
