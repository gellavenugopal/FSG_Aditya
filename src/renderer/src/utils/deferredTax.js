// Deferred Tax (Features > Deferred Tax): DTA / DTL by two approaches, each reconciled with the Deferred Tax of the Profit & Loss account.
//
// Sign convention used throughout: a Deferred Tax CHARGE (expense, DTL created / DTA reversed) is positive, a CREDIT (DTA created /
// DTL reversed) is negative - the way the Profit & Loss account shows the Deferred Tax line.
//
// Approach 1 - timing difference of the year (depreciation as per books less as per the Income Tax Act, plus other timing differences):
//     net timing difference > 0  -> books charged more than the Act allowed -> Deferred Tax ASSET (a credit to the P&L)
//     net timing difference < 0  -> Deferred Tax LIABILITY (a charge)
//     deferred tax = |net timing difference| x net tax rate
// Approach 2 - WDV approach (cumulative):
//     cumulative timing difference = WDV as per the Act (B) - WDV as per books (A), plus other cumulative differences
//     > 0 -> closing DTA, < 0 -> closing DTL, each x net tax rate;
//     the movement from the opening DTA / DTL is the creation or reversal, so that the opening becomes the ideal closing.
// Net tax rate = tax rate x (1 + surcharge) x (1 + cess).
// Pure functions only (tested by tools/selftest-deferred-tax.mjs).

import { DEFAULT_RATES, num } from './taxComputation.js'

const has = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(parseFloat(v))

export function netTaxRate(rate, surcharge, cess) {
  return num(rate) * (1 + num(surcharge) / 100) * (1 + num(cess) / 100)   // in per cent
}

//   input: { group, bookDep, itDep, bookWdv, itWdv, openDTA, openDTL, plDeferredTax, bsDTA, bsDTL }   (drawn from the statements)
//   saved: { ov: { bookDep, itDep, bookWdv, itWdv, openDTA, openDTL }, other1: [{id,label,amount}], other2: [...], rate, surcharge, cess }
export function computeDeferredTax(input, saved = {}) {
  const group = ['company', 'partnership', 'individual'].includes(input.group) ? input.group : 'individual'
  const ov = saved.ov || {}
  const pick = (k, auto) => (has(ov[k]) ? num(ov[k]) : num(auto))

  const d = DEFAULT_RATES[group]
  const rate = has(saved.rate) ? num(saved.rate) : (d.rate == null ? 0 : d.rate)
  const surcharge = has(saved.surcharge) ? num(saved.surcharge) : d.surcharge
  const cess = has(saved.cess) ? num(saved.cess) : d.cess
  const net = netTaxRate(rate, surcharge, cess)
  const r = net / 100

  const plDeferred = num(input.plDeferredTax)          // charge positive (DTL), credit negative (DTA)
  const plKind = Math.abs(plDeferred) < 0.5 ? null : (plDeferred > 0 ? 'DTL' : 'DTA')

  // ── Approach 1 ──
  const bookDep = pick('bookDep', input.bookDep), itDep = pick('itDep', input.itDep)
  const depTD = bookDep - itDep
  const other1 = (saved.other1 || []).map(x => ({ id: x.id, label: x.label || '', amount: num(x.amount) }))
  const other1Total = other1.reduce((s, x) => s + x.amount, 0)
  const netTD = depTD + other1Total
  const a1Kind = Math.abs(netTD) < 0.5 ? null : (netTD > 0 ? 'DTA' : 'DTL')
  const a1Amount = Math.abs(netTD) * r
  const a1Charge = -netTD * r                          // DTA is a credit, DTL a charge
  const a1 = { bookDep, itDep, depTD, other: other1, otherTotal: other1Total, netTD, kind: a1Kind, amount: a1Amount, charge: a1Charge, plDeferred, plKind, difference: a1Charge - plDeferred }

  // ── Approach 2 ──
  const bookWdv = pick('bookWdv', input.bookWdv), itWdv = pick('itWdv', input.itWdv)
  const wdvTD = itWdv - bookWdv
  const other2 = (saved.other2 || []).map(x => ({ id: x.id, label: x.label || '', amount: num(x.amount) }))
  const other2Total = other2.reduce((s, x) => s + x.amount, 0)
  const cumTD = wdvTD + other2Total
  const closingDTA = cumTD > 0 ? cumTD * r : 0
  const closingDTL = cumTD < 0 ? -cumTD * r : 0
  const openDTA = pick('openDTA', input.openDTA), openDTL = pick('openDTL', input.openDTL)
  const moveDTA = closingDTA - openDTA                 // + created, - reversed
  const moveDTL = closingDTL - openDTL
  const a2Charge = moveDTL - moveDTA                   // charge (+) / credit (-) to the Profit & Loss account
  const a2 = {
    bookWdv, itWdv, wdvTD, other: other2, otherTotal: other2Total, cumTD,
    kind: Math.abs(cumTD) < 0.5 ? null : (cumTD > 0 ? 'DTA' : 'DTL'),
    closingDTA, closingDTL, openDTA, openDTL, moveDTA, moveDTL, charge: a2Charge,
    plDeferred, plKind, difference: a2Charge - plDeferred,
    bsDTA: num(input.bsDTA), bsDTL: num(input.bsDTL),
    bsDifferenceDTA: closingDTA - num(input.bsDTA), bsDifferenceDTL: closingDTL - num(input.bsDTL),
  }
  return { group, rate, surcharge, cess, netRate: net, a1, a2 }
}
