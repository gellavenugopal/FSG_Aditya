// ── Cash Flow Statement (AS 3, indirect method) ──────────────────────────────
// Built from the same figures the Balance Sheet and Profit & Loss print: the
// Current Year column comes from the movement between the BS's Current Year
// and Previous Year balances plus the P&L's non-cash and non-operating lines;
// the Previous Year column is typed by the CA (the Trial Balance of the year
// before it is not in the tool). One pure function serves the CFS screen, the
// PDF and the Excel, so the three always agree.
//
//   buildCashFlow(data, saved) -> { rows, cy, py, checks }
//
// saved = { cy: { rowId: number }, py: { rowId: number } }   (all optional)
//   cy   a typed Current Year figure replaces the one drawn from the BS / P&L for that row
//   custom  rows the CA added: [{ id, section: 'A'|'A1'|'A2'|'B'|'C', label, cy, py }] - each is counted in its activity's total
//           (A1 = under "Adjustments for:", A2 = under "Adjustments for changes in working capital:", A = end of operating activities)
//   hidden  ids of the rows the CA deleted (a row replaced by a row of their own): left out of the statement and of every total
//   py   the Previous Year figures (every figure row); 'cash_open' = cash at the start of the Previous Year
//
// Sign: a figure is the cash effect - positive is an inflow, negative (shown in brackets) an outflow.
import { displayAmt } from '../hooks/useFinancials'

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const sum = (arr, f) => arr.reduce((s, x) => s + num(f(x)), 0)

// The rows, in print order. kind: head / caption (no figure), item (a figure), sub (a subtotal), total (a grand total)
export const CFS_LAYOUT = [
  { id: 'h_op', kind: 'head', label: 'A. Cash flow from operating activities' },
  { id: 'a_pbt', kind: 'item', label: 'Net profit before tax and extraordinary items', calc: true },
  { id: 'h_adj', kind: 'caption', label: 'Adjustments for:' },
  { id: 'a_dep', kind: 'item', label: 'Depreciation and amortisation expense' },
  { id: 'a_fin', kind: 'item', label: 'Finance costs' },
  { id: 'a_int', kind: 'item', label: 'Interest income' },
  { id: 'a_div', kind: 'item', label: 'Dividend income' },
  { id: 'a_gppe', kind: 'item', label: '(Profit) / loss on sale of fixed assets (net)' },
  { id: 'a_ginv', kind: 'item', label: '(Profit) / loss on sale of investments (net)' },
  { id: 's_opbwc', kind: 'sub', label: 'Operating profit before working capital changes', of: ['a_pbt', 'a_dep', 'a_fin', 'a_int', 'a_div', 'a_gppe', 'a_ginv'] },
  { id: 'h_wc', kind: 'caption', label: 'Adjustments for changes in working capital:' },
  { id: 'w_inv', kind: 'item', label: '(Increase) / decrease in inventories' },
  { id: 'w_tr', kind: 'item', label: '(Increase) / decrease in trade receivables' },
  { id: 'w_oa', kind: 'item', label: '(Increase) / decrease in loans, advances and other assets' },
  { id: 'w_tp', kind: 'item', label: 'Increase / (decrease) in trade payables' },
  { id: 'w_ol', kind: 'item', label: 'Increase / (decrease) in other liabilities and provisions' },
  { id: 's_cgo', kind: 'sub', label: 'Cash generated from operations', of: ['s_opbwc', 'w_inv', 'w_tr', 'w_oa', 'w_tp', 'w_ol'] },
  { id: 'a_tax', kind: 'item', label: 'Direct taxes paid (net of refunds)' },
  { id: 't_op', kind: 'total', label: 'Net cash from / (used in) operating activities (A)', of: ['s_cgo', 'a_tax'] },

  { id: 'h_inv', kind: 'head', label: 'B. Cash flow from investing activities' },
  { id: 'b_ppe', kind: 'item', label: 'Purchase of fixed assets (net of sale proceeds)' },
  { id: 'b_inv', kind: 'item', label: 'Purchase of investments (net of sale proceeds)' },
  { id: 'b_fd', kind: 'item', label: 'Investment in / (maturity of) bank deposits not treated as cash equivalents' },
  { id: 'b_int', kind: 'item', label: 'Interest received' },
  { id: 'b_div', kind: 'item', label: 'Dividend received' },
  { id: 't_inv', kind: 'total', label: 'Net cash from / (used in) investing activities (B)', of: ['b_ppe', 'b_inv', 'b_fd', 'b_int', 'b_div'] },

  { id: 'h_fin', kind: 'head', label: 'C. Cash flow from financing activities' },
  { id: 'c_sh', kind: 'item', label: 'Proceeds from issue of share capital' },
  { id: 'c_ltb', kind: 'item', label: 'Proceeds from / (repayment of) long-term borrowings' },
  { id: 'c_stb', kind: 'item', label: 'Proceeds from / (repayment of) short-term borrowings' },
  { id: 'c_fin', kind: 'item', label: 'Finance costs paid' },
  { id: 'c_eq', kind: 'item', label: 'Dividend paid, capital introduced / (drawings) and other movement in owners’ funds' },
  { id: 't_fin', kind: 'total', label: 'Net cash from / (used in) financing activities (C)', of: ['c_sh', 'c_ltb', 'c_stb', 'c_fin', 'c_eq'] },

  { id: 'x_diff', kind: 'item', label: 'Difference to be explained (not drawn from any Balance Sheet line)', calc: true, onlyIfNonZero: true },
  { id: 't_net', kind: 'total', label: 'Net increase / (decrease) in cash and cash equivalents (A + B + C)', of: ['t_op', 't_inv', 't_fin', 'x_diff'] },
  { id: 'cash_open', kind: 'item', label: 'Cash and cash equivalents at the beginning of the year' },
  { id: 'cash_close', kind: 'total', label: 'Cash and cash equivalents at the end of the year', of: ['t_net', 'cash_open'] },
]

const PATTERNS = {
  cash: /cash and (cash equiv|bank)|cash.{0,6}bank|cash in hand|bank balance/i,
  bankDeposits: /other than cash|fixed deposit|deposits? with (bank|maturity)|margin money|earmarked/i,
  ppe: /tangible|intangible|property.plant|fixed asset|plant.machin|furniture|vehicle|building|equipment|capital work.in.progress|cwip|under development|\bland\b|computer/i,
  invest: /investment/i,
  inventories: /inventor/i,
  tradeRec: /trade receivable|sundry debtor/i,
  shareCapital: /share capital|share warrant|share application/i,
  equity: /reserves?|surplus|capital account|owner|partner|proprietor|profit and loss|^capital/i,
  equityL1: /(shareholder|partner|owner|proprietor)s?.{0,3}\s*(fund|capital)|capital account|share application/i,
  borrowing: /borrow|loan/i,
  tradePay: /trade payable|sundry creditor/i,
  depreciation: /depreciation|amorti[sz]ation/i,
  finance: /finance cost|interest expense/i,
  taxL1: /tax expense|provision for tax|income tax/i,
  interestInc: /interest (income|received|on (fd|fixed|deposit|bank|saving|loan|refund))|interest from|fd interest|bank interest/i,
  dividendInc: /dividend/i,
  saleGain: /(profit|gain|loss).{0,30}(sale|disposal|transfer|discard|sold)|(sale|disposal).{0,30}(profit|gain|loss)/i,
  saleInv: /invest|share|securit|mutual|bond|unit/i,
}

const rowsOf = (section) => (section.lines || []).flatMap(l => l.rows || [])

function classifyEL(sec, line) {
  const l1 = sec.level1 || '', l2 = line.level2 || ''
  if (PATTERNS.shareCapital.test(l2)) return 'shareCapital'
  if (PATTERNS.borrowing.test(l2)) return (/short/i.test(l2) || (/current liab/i.test(l1) && !/non.current/i.test(l1))) ? 'stBorrow' : 'ltBorrow'
  if (PATTERNS.tradePay.test(l2)) return 'tradePay'
  if (PATTERNS.equity.test(l2) || PATTERNS.equityL1.test(l1)) return 'equity'
  return 'otherLiab'
}
function classifyAsset(sec, line) {
  const l2 = line.level2 || ''
  if (PATTERNS.bankDeposits.test(l2)) return 'bankDeposit'
  if (PATTERNS.cash.test(l2)) return 'cash'
  if (PATTERNS.invest.test(l2)) return 'invest'
  if (PATTERNS.inventories.test(l2)) return 'inventory'
  if (PATTERNS.tradeRec.test(l2)) return 'tradeRec'
  if (PATTERNS.ppe.test(l2) && !/advance|deposit|receivable|loans?/i.test(l2)) return 'ppe'
  return 'otherAsset'
}

// Components of cash and cash equivalents (AS 3, paras 45-48): what the Balance Sheet cash is made of, reconciled to the Balance Sheet.
export const CC_ITEMS = [
  { id: 'cc_cash', label: 'Cash on hand' },
  { id: 'cc_bank', label: 'Balances with banks in current and savings accounts' },
  { id: 'cc_dep', label: 'Deposits with banks with an original maturity of three months or less' },
  { id: 'cc_oth', label: 'Cheques and drafts on hand and other cash equivalents' },
]
export const CC_RESTRICTED = { id: 'cc_restricted', label: 'Of which: balances not available for use by the enterprise (earmarked, held as margin money or under restriction)' }
const CC_RX = {
  other: /cheque|draft|in transit|remittance/i,
  deposit: /deposit|\bfdr?\b|fixed dep/i,
  bank: /bank|current a|savings|\bo\/?d\b|overdraft/i,
  cash: /cash|petty|imprest|float/i,
}

export function buildCashFlow(data, saved = {}) {
  const d = data || {}
  const cyOver = (saved && saved.cy) || {}, pyIn = (saved && saved.py) || {}
  const els = d.elSections || [], assets = d.assetSections || []
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== null && o[k] !== ''
  // Rows added by the CA to Operating (A), Investing (B) or Financing (C) activities
  const custom = (saved && Array.isArray(saved.custom) ? saved.custom : []).filter(c => c && c.id && /^(A1|A2|A|B|C)$/.test(c.section))
  const SECTION_TOTAL = { A: 't_op', A1: 's_opbwc', A2: 's_cgo', B: 't_inv', C: 't_fin' }
  // Rows deleted by the CA: only a figure row that is drawn / typed can go (not a calculated row, nor the opening cash)
  const deletable = new Set(CFS_LAYOUT.filter(r => r.kind === 'item' && !r.calc && r.id !== 'cash_open').map(r => r.id))
  const hiddenIds = new Set((saved && Array.isArray(saved.hidden) ? saved.hidden : []).filter(id => deletable.has(id)))
  const withoutHidden = (v) => { const o = { ...v }; for (const id of hiddenIds) o[id] = 0; return o }
  const customOf = (totalId) => custom.filter(c => SECTION_TOTAL[c.section] === totalId)
  const ofFor = (row) => { const extra = customOf(row.id).map(c => 'u_' + c.id); return extra.length ? row.of.concat(extra) : row.of }

  // ── Balance Sheet movements: [closing, opening] ──
  const mv = { shareCapital: [0, 0], equity: [0, 0], ltBorrow: [0, 0], stBorrow: [0, 0], tradePay: [0, 0], otherLiab: [0, 0],
    cash: [0, 0], bankDeposit: [0, 0], invest: [0, 0], inventory: [0, 0], tradeRec: [0, 0], ppe: [0, 0], otherAsset: [0, 0] }
  for (const sec of els) for (const line of sec.lines || []) { const k = classifyEL(sec, line); mv[k][0] += num(line.total); mv[k][1] += num(line.prevTotal) }
  for (const sec of assets) for (const line of sec.lines || []) { const k = classifyAsset(sec, line); mv[k][0] += num(line.total); mv[k][1] += num(line.prevTotal) }
  const dl = (k) => mv[k][0] - mv[k][1]

  // ── Profit & Loss ──
  const exp = d.expenseSections || [], inc = d.incomeSections || []
  const taxSecs = exp.filter(s => PATTERNS.taxL1.test(s.level1 || ''))
  const tax = sum(taxSecs, s => s.total)
  const netProfit = num(d.netProfit)
  const pbt = netProfit + tax
  const bySectionOrLine = (secs, rx) => {
    let t = 0
    for (const s of secs) {
      if (rx.test(s.level1 || '')) { t += num(s.total); continue }
      for (const l of s.lines || []) if (rx.test(l.level2 || '')) t += num(l.total)
    }
    return t
  }
  const dep = bySectionOrLine(exp, PATTERNS.depreciation)
  const finCost = bySectionOrLine(exp, PATTERNS.finance)
  const incRows = inc.filter(s => !/revenue from operation|closing stock/i.test(s.level1 || '')).flatMap(rowsOf)
  const expRows = exp.filter(s => !taxSecs.includes(s)).flatMap(rowsOf)
  const amt = (r) => num(displayAmt(r, 'closing_balance'))
  const sumRows = (rows, rx) => rows.filter(r => rx.test(r.name || '')).reduce((s, r) => s + amt(r), 0)
  const interestInc = sumRows(incRows, PATTERNS.interestInc)
  const dividendInc = sumRows(incRows, PATTERNS.dividendInc)
  const gainRows = incRows.filter(r => PATTERNS.saleGain.test(r.name || ''))
  const lossRows = expRows.filter(r => PATTERNS.saleGain.test(r.name || ''))
  const total = (rows) => rows.reduce((s, r) => s + amt(r), 0)
  const isInv = (r) => PATTERNS.saleInv.test(r.name || '')
  const gainInv = total(gainRows.filter(isInv)) - total(lossRows.filter(isInv))
  const gainPpe = total(gainRows.filter(r => !isInv(r))) - total(lossRows.filter(r => !isInv(r)))

  // ── Current Year, drawn from the statements ──
  const drawn = {
    a_pbt: pbt, a_dep: dep, a_fin: finCost, a_int: -interestInc, a_div: -dividendInc, a_gppe: -gainPpe, a_ginv: -gainInv,
    w_inv: -dl('inventory'), w_tr: -dl('tradeRec'), w_oa: -dl('otherAsset'), w_tp: dl('tradePay'), w_ol: dl('otherLiab'),
    a_tax: -tax,
    b_ppe: gainPpe - (dl('ppe') + dep), b_inv: gainInv - dl('invest'), b_fd: -dl('bankDeposit'), b_int: interestInc, b_div: dividendInc,
    c_sh: dl('shareCapital'), c_ltb: dl('ltBorrow'), c_stb: dl('stBorrow'), c_fin: -finCost, c_eq: dl('equity') - netProfit,
    cash_open: mv.cash[1],
  }
  const cy = {}
  for (const row of CFS_LAYOUT) if (row.kind === 'item' && !row.calc) cy[row.id] = has(cyOver, row.id) ? num(cyOver[row.id]) : num(drawn[row.id])
  cy.a_pbt = num(drawn.a_pbt)
  for (const c of custom) cy['u_' + c.id] = num(c.cy)

  const totals = (v) => {
    const s = {}
    for (const row of CFS_LAYOUT) if (row.of) s[row.id] = ofFor(row).reduce((t, id) => t + num(s[id] != null ? s[id] : v[id]), 0)
    return s
  }
  // What is left to explain between the Balance Sheet's own cash movement and the statement
  const closingCash = mv.cash[0]
  // Rows the CA added are NOT absorbed by the difference line: they move the net cash, and the closing cash, as typed
  // (a deleted row keeps its figure in this baseline: deleting a row, in order to put the same item in a row of your own, must not
  // turn that figure into a "difference")
  const noCustom = { ...cy, x_diff: 0 }
  for (const c of custom) noCustom['u_' + c.id] = 0
  const before = totals(noCustom)
  cy.x_diff = (closingCash - mv.cash[1]) - (before.t_net || 0)
  if (Math.abs(cy.x_diff) < 0.5) cy.x_diff = 0
  const cyShown = withoutHidden(cy)
  const cyAll = { ...cyShown, ...totals(cyShown) }

  // ── Previous Year, typed ──
  const py = {}
  for (const row of CFS_LAYOUT) if (row.kind === 'item') py[row.id] = (has(pyIn, row.id) && !hiddenIds.has(row.id)) ? num(pyIn[row.id]) : 0
  for (const c of custom) py['u_' + c.id] = num(c.py)
  const pyAll = { ...py, ...totals(py) }

  const anyPrev = els.some(s => num(s.prevTotal) !== 0) || assets.some(s => num(s.prevTotal) !== 0)
  const checks = {
    closingCashBS: closingCash,
    closingCashCFS: cyAll.cash_close,
    agrees: Math.abs(closingCash - cyAll.cash_close) < 1,
    noPreviousBalances: !anyPrev,
    pyClosingVsCyOpening: pyAll.cash_close - cyAll.cash_open,
  }
  const noFigure = (r) => r.kind === 'head' || r.kind === 'caption'
  const customRow = (c) => ({ id: 'u_' + c.id, kind: 'item', label: String(c.label || '').trim() || 'Other (specify)', custom: true, customId: c.id, section: c.section,
    cy: cyAll['u_' + c.id], py: pyAll['u_' + c.id], drawn: null, typed: false, cyEditable: true, pyEditable: true })
  const rows = CFS_LAYOUT
    .filter(r => !hiddenIds.has(r.id))
    .filter(r => !(r.onlyIfNonZero && Math.abs(cyAll[r.id] || 0) < 0.5 && Math.abs(pyAll[r.id] || 0) < 0.5))
    .flatMap(r => (r.of && customOf(r.id).length ? [...customOf(r.id).map(customRow), r] : [r]))
    .map(r => r.custom ? r : ({ ...r,
      of: r.of ? ofFor(r) : undefined,
      cy: noFigure(r) ? null : cyAll[r.id],
      py: noFigure(r) ? null : pyAll[r.id],
      drawn: r.kind === 'item' && !r.calc ? num(drawn[r.id]) : null,
      typed: r.kind === 'item' && !r.calc && has(cyOver, r.id),
      deletable: deletable.has(r.id),
      cyEditable: r.kind === 'item' && !r.calc,
      pyEditable: r.kind === 'item' && r.id !== 'x_diff',
    }))

  // ── Components of cash and cash equivalents ──
  const ccDrawn = { cc_cash: 0, cc_bank: 0, cc_dep: 0, cc_oth: 0 }
  for (const sec of assets) for (const line of sec.lines || []) {
    if (classifyAsset(sec, line) !== 'cash') continue
    for (const r of line.rows || []) {
      const t = `${r.mapping3_resultant || r.level3 || ''} ${r.name || ''}`
      const k = CC_RX.other.test(t) ? 'cc_oth' : CC_RX.deposit.test(t) ? 'cc_dep' : CC_RX.bank.test(t) ? 'cc_bank' : CC_RX.cash.test(t) ? 'cc_cash' : 'cc_bank'
      ccDrawn[k] += amt(r)
    }
  }
  const ccRow = (it, drawnV) => ({ id: it.id, kind: 'item', label: it.label, cc: true, drawn: drawnV,
    cy: has(cyOver, it.id) ? num(cyOver[it.id]) : drawnV, py: has(pyIn, it.id) ? num(pyIn[it.id]) : 0,
    typed: has(cyOver, it.id), cyEditable: true, pyEditable: true })
  const ccRows = CC_ITEMS.map(it => ccRow(it, ccDrawn[it.id]))
  const restricted = ccRow(CC_RESTRICTED, 0)
  const ccTotalCY = ccRows.reduce((s, r) => s + r.cy, 0), ccTotalPY = ccRows.reduce((s, r) => s + r.py, 0)
  const anyCcPY = ccRows.some(r => Math.abs(r.py) > 0.005)
  const cc = {
    rows: [...ccRows, restricted], items: ccRows, restricted,
    totalCY: ccTotalCY, totalPY: ccTotalPY, bsCY: mv.cash[0], bsPY: mv.cash[1],
    diffCY: Math.abs(ccTotalCY - mv.cash[0]) < 0.5 ? 0 : ccTotalCY - mv.cash[0],
    diffPY: !anyCcPY || Math.abs(ccTotalPY - mv.cash[1]) < 0.5 ? 0 : ccTotalPY - mv.cash[1],
    note: String((saved && saved.ccNote) || ''),
  }
  const hiddenRows = CFS_LAYOUT.filter(r => hiddenIds.has(r.id)).map(r => ({ id: r.id, label: r.label }))
  return { rows, cy: cyAll, py: pyAll, checks, cc, hiddenRows }
}
