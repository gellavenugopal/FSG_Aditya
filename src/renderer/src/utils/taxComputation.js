// Computation of Total Income and Income Tax (Features > Tax Computation).
//
//   Profit before tax (from the Profit & Loss)
//   + Additions            (Company: depreciation as per the Companies Act is the first row;
//                           Partnership: partners' remuneration as debited in the P&L is the first row)
//   - Deductions           (Company: depreciation as per the Income Tax Act, from Dep (IT), is the first row)
//   = Total Income         (Partnership: Book Profit, less the allowable remuneration, = Total Income)
//   Tax @ rate, + Surcharge, + Health and Education Cess = Total tax
//   - Advance tax, TDS, TCS = Net tax payable / (refundable)
//   Interest u/s 234A, 234B, 234C (indicative - see the notes on each).
//
// Pure functions only (tested by tools/selftest-tax-computation.mjs). Amounts are rupees; no rounding except where the Act
// rounds: Total Income to the nearest ten rupees (s.288A) and the tax payable to the nearest rupee (s.288B).

export const GROUPS = ['company', 'partnership', 'individual']

// default rates by constitution: Company 22% (s.115BAA), Partnership 30%, Proprietorship left for the CA to enter
export const DEFAULT_RATES = {
  company:     { rate: 22,   surcharge: 10, cess: 4 },
  partnership: { rate: 30,   surcharge: 0,  cess: 4 },
  individual:  { rate: null, surcharge: 0,  cess: 4 },
}

export const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const has = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(parseFloat(v))

// the Book Profit remuneration limit of s.40(b): on the first 6,00,000 the higher of 3,00,000 or 90%, on the balance 60%
export function allowableRemuneration(bookProfit, actual) {
  const bp = num(bookProfit)
  let limit
  if (bp <= 600000) limit = Math.max(300000, bp * 0.9)
  else limit = 600000 * 0.9 + (bp - 600000) * 0.6
  return Math.max(0, Math.min(num(actual), limit))
}

// date helpers (dates as 'YYYY-MM-DD' strings; part of a month counts as a month)
const parse = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''))
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null
}
const addMonths = (d, n) => {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate()
  r.setUTCDate(Math.min(d.getUTCDate(), last))
  return r
}
// months or part of a month in [start, end] (end inclusive); 0 when end is before start
export function monthsOrPart(startStr, endStr) {
  const s = parse(startStr), e = parse(endStr)
  if (!s || !e || e < s) return 0
  let m = 1
  while (addMonths(s, m) <= e && m < 240) m++
  return m
}
const dayAfter = (str) => { const d = parse(str); if (!d) return null; d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }

// The assessment year's dates, from a period label "2025-04-01 To 2026-03-31"
export function yearDates(periodLabel) {
  const m = /(\d{4})-(\d{2})-(\d{2})\s*(?:to|-)\s*(\d{4})-(\d{2})-(\d{2})/i.exec(String(periodLabel || ''))
  if (!m) return null
  const y1 = +m[1], y2 = +m[4]
  return {
    fyStart: `${m[1]}-${m[2]}-${m[3]}`, fyEnd: `${m[4]}-${m[5]}-${m[6]}`,
    ayStart: `${y2}-04-01`,                                   // 1 April after the year end
    instalments: [`${y1}-06-15`, `${y1}-09-15`, `${y1}-12-15`, `${y2}-03-15`],
    defaultDueDate: `${y2}-10-31`,
    ayLabel: `${y2}-${String((y2 + 1) % 100).padStart(2, '0')}`,
  }
}

// Auto-figures the screen draws from the statements; saved overrides replace them.
//   input: { group, pbt, depCompanies, depIT, remuneration, periodLabel }
//   input.today: 'YYYY-MM-DD' - the date of filing taken when none is typed (the screen passes the current date)
//   saved: { ov: {pbt, dep_co, dep_it, remun, allowable}, additions: [{id,label,amount}], deductions: [...], rate, surcharge, cess,
//            advance: [n,n,n,n], advanceTotal, tds, tcs, dueDate, filingDate, presumptive }
//   Advance tax dates (s.211) are the same for a company, firm, LLP and proprietor: 15% by 15 June, 45% by 15 September, 75% by
//   15 December, 100% by 15 March. Only an assessee on presumptive taxation (s.44AD / 44ADA - a firm other than an LLP, or a
//   proprietor) pays the whole by 15 March, in one instalment: saved.presumptive.
export function computeTax(input, saved = {}) {
  const group = GROUPS.includes(input.group) ? input.group : 'individual'
  const ov = saved.ov || {}
  const pick = (k, auto) => (has(ov[k]) ? num(ov[k]) : num(auto))
  const pbt = pick('pbt', input.pbt)

  const additions = [], deductions = []
  if (group === 'company') {
    additions.push({ id: 'dep_co', label: 'Depreciation as per Companies Act, 2013 (as per Profit & Loss account)', amount: pick('dep_co', input.depCompanies), fixed: true, auto: num(input.depCompanies) })
    deductions.push({ id: 'dep_it', label: 'Depreciation as per Income Tax Act, 1961 (as per WDV (IT))', amount: pick('dep_it', input.depIT), fixed: true, auto: num(input.depIT) })
  }
  if (group === 'partnership') {
    additions.push({ id: 'remun', label: "Partners' remuneration as debited in the Profit & Loss account", amount: pick('remun', input.remuneration), fixed: true, auto: num(input.remuneration) })
  }
  for (const r of (saved.additions || [])) additions.push({ id: r.id, label: r.label || '', amount: num(r.amount), fixed: false })
  for (const r of (saved.deductions || [])) deductions.push({ id: r.id, label: r.label || '', amount: num(r.amount), fixed: false })

  const addTotal = additions.reduce((s, r) => s + r.amount, 0)
  const dedTotal = deductions.reduce((s, r) => s + r.amount, 0)
  const afterAdjustments = pbt + addTotal - dedTotal

  let bookProfit = null, allowable = null, allowableAuto = null
  let totalIncomeRaw = afterAdjustments
  if (group === 'partnership') {
    bookProfit = afterAdjustments
    const remun = additions.find(r => r.id === 'remun').amount
    allowableAuto = allowableRemuneration(bookProfit, remun)
    allowable = pick('allowable', allowableAuto)
    totalIncomeRaw = bookProfit - allowable
  }
  const totalIncome = Math.round(totalIncomeRaw / 10) * 10            // s.288A (a loss is left as it is)

  const d = DEFAULT_RATES[group]
  const rate = has(saved.rate) ? num(saved.rate) : (d.rate == null ? 0 : d.rate)
  const surchargePct = has(saved.surcharge) ? num(saved.surcharge) : d.surcharge
  const cessPct = has(saved.cess) ? num(saved.cess) : d.cess

  const taxable = Math.max(0, totalIncome)
  const tax = taxable * rate / 100
  const surcharge = tax * surchargePct / 100
  const cess = (tax + surcharge) * cessPct / 100
  const totalTax = Math.round(tax + surcharge + cess)                   // s.288B

  const adv = [0, 1, 2, 3].map(i => num((saved.advance || [])[i]))
  const advanceInstalments = adv.reduce((s, v) => s + v, 0)
  const advanceTotal = has(saved.advanceTotal) ? num(saved.advanceTotal) : advanceInstalments
  const tds = num(saved.tds), tcs = num(saved.tcs)
  const prepaid = advanceTotal + tds + tcs
  const netPayable = totalTax - prepaid

  // ── Interest ─────────────────────────────────────────────────────────────
  const dates = yearDates(input.periodLabel)
  const assessedTax = Math.max(0, totalTax - tds - tcs)                // tax on the return, after TDS / TCS
  const dueDate = saved.dueDate || (dates ? dates.defaultDueDate : '')
  const filingDate = saved.filingDate || input.today || ''
  const presumptive = group !== 'company' && !!saved.presumptive
  const interest = { a: 0, b: 0, c: 0, aMonths: 0, bMonths: 0, cDetail: [], notes: [] }

  // 234A: 1% a month (or part) on the tax unpaid when the return is filed, from the day after the due date to the filing date
  if (filingDate && dueDate) {
    interest.aMonths = monthsOrPart(dayAfter(dueDate), filingDate)
    const unpaid = Math.max(0, totalTax - prepaid)
    interest.a = Math.round(unpaid * 0.01 * interest.aMonths)
  } else interest.notes.push('234A: enter the due date and the date of filing the return.')

  // 234B: advance tax paid in the year below 90% of the assessed tax (only when that is 10,000 or more):
  // 1% a month (or part) from 1 April of the assessment year to the date of filing, on assessed tax less advance tax paid
  if (assessedTax >= 10000 && advanceTotal < assessedTax * 0.9) {
    if (filingDate && dates) {
      interest.bMonths = monthsOrPart(dates.ayStart, filingDate)
      interest.b = Math.round(Math.max(0, assessedTax - advanceTotal) * 0.01 * interest.bMonths)
    } else interest.notes.push('234B: enter the date of filing the return.')
  }

  // 234C: shortfall on each instalment (15% by 15 June, 45% by 15 September, 75% by 15 December, 100% by 15 March):
  // 1% a month for 3 months on the first three, 1 month on the last. No interest when 12% / 36% was paid by the first two dates.
  if (assessedTax >= 10000) {
    const pct = presumptive ? [0, 0, 0, 1] : [0.15, 0.45, 0.75, 1]
    const months = [3, 3, 3, 1]
    const relax = presumptive ? [null, null, null, null] : [0.12, 0.36, null, null]
    let cum = 0
    if (advanceInstalments === 0 && advanceTotal > 0) interest.notes.push('234C: type the advance tax instalment-wise to compute it.')
    else {
      for (let i = 0; i < 4; i++) {
        cum += adv[i]
        const required = assessedTax * pct[i]
        let short = Math.max(0, required - cum)
        if (relax[i] != null && cum >= assessedTax * relax[i]) short = 0
        const amt = Math.round(short * 0.01 * months[i])
        interest.c += amt
        interest.cDetail.push({ upTo: dates ? dates.instalments[i] : '', required, paid: cum, shortfall: short, months: months[i], interest: amt })
      }
    }
  }

  const interestTotal = interest.a + interest.b + interest.c
  return {
    group, pbt, additions, deductions, addTotal, dedTotal, afterAdjustments, bookProfit, allowable, allowableAuto,
    totalIncome, rate, surchargePct, cessPct, tax, surcharge, cess, totalTax,
    advanceTotal, advanceInstalments, advance: adv, tds, tcs, prepaid, netPayable,
    assessedTax, dueDate, filingDate, filingDateIsToday: !saved.filingDate && !!input.today, presumptive, dates, interest, interestTotal,
    grandPayable: netPayable + interestTotal,
  }
}
