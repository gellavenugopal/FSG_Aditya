// ── Pull the ITR form (BS, Manufacturing / Trading / P&L, and their Details) from the financial statements ─────────────────────────
// For every constitution (Individual / Proprietorship, Partnership / LLP, Company) the figures are taken from the SAME `data` object
// useFinancials() produces for the BS, P&L and Notes screens - so they are exactly what is on the face and in the notes now.
//
//   1. extractITRFigures(data)   -> { fig, details }  what the statements say, in the ITR's own terms (Current Year only)
//   2. pullITRFromFinancials(group, schema, data) -> { values, details, check }
//        PLACE rules put each figure into the form row of that constitution, found by the row's own label and its heading path
//        (so Individual / Partnership / Company, whose rows sit at different cells, each get theirs).
//
// A figure the statements cannot supply reliably (PAN-wise bad debts, forex u/s 43AA, resident / non-resident splits, section 40A(2)(b)
// advances ...) is left blank for the preparer. Lines the form has no row for go to its "specify nature and amount" Details blocks, so
// the form's totals - and its profit - agree with the statements. Always review before filing.
import { displayAmt } from '../hooks/useFinancials'

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
const rowAmt = (r) => num(displayAmt(r, 'closing_balance'))
const textOf = (r) => `${r.mapping3_resultant || r.level3 || ''} ${r.name || r.ledger_name || ''}`
const round2 = (n) => Math.round(n * 100) / 100

const notesBy = (data, rx) => Object.values(data?.notes || {}).filter(n => rx.test(String(n.title || '').trim()))
const noteTotal = (data, rx) => notesBy(data, rx).reduce((s, n) => s + num(n.total), 0)
// a note's ledgers as { amount, text, label }; a line with figures but no ledger rows is one item of its own
function noteItems(data, rx) {
  const out = []
  for (const n of notesBy(data, rx)) {
    const rows = n.rows || []
    let got = 0
    for (const r of rows) {
      if (r.injected && r.injected !== 'current-maturities') { /* profit injected into a capital note: still part of the note */ }
      const a = rowAmt(r); got += a
      out.push({ amount: a, text: textOf(r), label: r.mapping3_resultant || r.level3 || n.title, injected: r.injected || null })
    }
    const rest = num(n.total) - got
    if (Math.abs(rest) >= 0.5) out.push({ amount: rest, text: n.title || '', label: n.title || '', injected: null })
  }
  return out
}
// the ledgers of Profit & Loss sections, one item per ledger, with the line (Level 2) and caption (Level 1) they sit in
function sectionItems(sections, l1rx) {
  const out = []
  for (const sec of (sections || [])) {
    if (!l1rx.test(sec.level1 || '')) continue
    for (const line of (sec.lines || [])) {
      const rows = line.rows || []
      let got = 0
      for (const r of rows) {
        const a = rowAmt(r); got += a
        out.push({ amount: a, text: textOf(r), line: line.level2 || sec.level1, l1: sec.level1, isRM: false })
      }
      const rest = num(line.total) - got
      if (Math.abs(rest) >= 0.5) out.push({ amount: rest, text: line.level2 || '', line: line.level2 || sec.level1, l1: sec.level1 })
    }
  }
  return out
}
// first matching rule wins; what no rule takes is returned as `rest`
function alloc(items, rules) {
  const b = {}; const rest = []
  for (const it of items) {
    const hay = `${it.l1 || ''} ${it.line || ''} ${it.text || ''}`
    const rule = rules.find(r => r[1].test(hay))
    if (rule) b[rule[0]] = (b[rule[0]] || 0) + it.amount
    else rest.push(it)
  }
  return { b, rest }
}
const sumItems = (items) => items.reduce((s, i) => s + i.amount, 0)

export function extractITRFigures(data) {
  const f = {}
  const details = {}
  const detail = (block, label, amt) => {
    if (Math.abs(amt) < 0.5) return
    const list = details[block] || (details[block] = [])
    const hit = list.find(x => x.particulars === label)
    if (hit) hit.amount = round2(hit.amount + amt); else list.push({ particulars: label, amount: round2(amt) })
  }
  const add = (k, v) => { f[k] = (f[k] || 0) + v }

  // ── Balance Sheet ────────────────────────────────────────────────────────
  // Proprietor's / partners' capital: the app injects the year's profit into the capital note of a non-corporate entity, so this one
  // figure already carries it (the form's own "credit balance of P&L" is therefore not filled - it would count the profit twice).
  const capitalSecs = [...(data?.elSections || [])].filter(s => /(partners?|owners?|proprietor)\W{0,4}(funds?|capital)|capital account/i.test(s.level1 || ''))
  f.capital = capitalSecs.reduce((s, x) => s + num(x.total), 0)

  f.shareCapital = noteTotal(data, /^share capital$/i)
  {
    const res = alloc(noteItems(data, /^reserves?( and|\s*&)\s*surplus$/i).map(i => ({ ...i, line: i.label })), [
      ['resCapital', /capital reserve/i], ['resCRR', /capital redemption/i], ['resSecPremium', /securities premium|share premium/i],
      ['resDRR', /debenture redemption/i], ['resReval', /revaluation/i], ['resOptions', /share option/i],
      ['resSurplus', /profit|surplus|retained|p\s*&\s*l|balance in/i],
    ])
    for (const [k, v] of Object.entries(res.b)) f[k] = v
    for (const it of res.rest) detail('otherReserve', it.label || it.text || 'Other reserve', it.amount)
  }
  f.shareWarrants = noteTotal(data, /share warrant/i)

  // borrowings
  const BANK = /bank/i, RELATED = /related|director|partner|promoter|shareholder|member|holding|subsidiary|associate/i
  {
    const lt = alloc(noteItems(data, /^long.?term borrowings$/i).map(i => ({ ...i, line: i.label })), [
      ['ltDepRelated', new RegExp('(?=.*deposit)(?=.*(' + RELATED.source + '))', 'i')], ['ltDeposit', /deposit/i],
      ['ltRelated', RELATED], ['ltBank', BANK],
    ])
    f.ltBank = lt.b.ltBank || 0; f.ltOthers = sumItems(lt.rest); f.ltRelated = lt.b.ltRelated || 0
    f.ltDeposit = lt.b.ltDeposit || 0; f.ltDepRelated = lt.b.ltDepRelated || 0
    const stItems = noteItems(data, /^short.?term borrowings$/i)
    const cm = stItems.filter(i => i.injected === 'current-maturities' || /^current maturities of long.?term/i.test(i.text))
    f.currentMaturities = sumItems(cm)
    const st = alloc(stItems.filter(i => !cm.includes(i)).map(i => ({ ...i, line: i.label })), [
      ['stDepRelated', new RegExp('(?=.*deposit)(?=.*(' + RELATED.source + '))', 'i')], ['stDeposit', /deposit/i],
      ['stRelated', RELATED], ['stBank', /bank|overdraft|cash credit|\bo\/?d\b|\bcc\b/i],
    ])
    f.stBank = st.b.stBank || 0; f.stOthers = sumItems(st.rest); f.stRelated = st.b.stRelated || 0
    f.stDeposit = st.b.stDeposit || 0; f.stDepRelated = st.b.stDepRelated || 0
  }
  f.deferredTaxLiab = noteTotal(data, /deferred tax liabilit/i)
  f.deferredTaxAsset = noteTotal(data, /deferred tax asset/i)
  f.otherLtLiab = noteTotal(data, /^other long.?term liabilities$/i)
  f.tradePayables = noteTotal(data, /^trade payables?$/i)
  {
    const ocl = alloc(noteItems(data, /^other current liabilities$/i).map(i => ({ ...i, line: i.label })), [
      ['oclInterestNotDue', /interest.*not due|accrued interest|interest accrued but/i], ['oclInterestDue', /interest.*(accrued|payable).*due/i],
      ['oclAdvanceIncome', /income received in advance|unearned|deferred revenue/i], ['oclUnpaidDiv', /unpaid dividend/i],
      ['oclLeased', /lease/i],
    ])
    for (const [k, v] of Object.entries(ocl.b)) f[k] = v
    f.oclOther = sumItems(ocl.rest)
  }
  {
    const EMP = /gratuity|leave|bonus|employee|provident|\bpf\b|\besi\b|superannuation|salary|salaries|wages/i
    const sp = alloc(noteItems(data, /^short.?term provisions?$/i).map(i => ({ ...i, line: i.label })), [
      ['spEmployee', EMP], ['spTax', /income.?tax|current tax|tax/i], ['spDividend', /dividend/i],
    ])
    f.spEmployee = sp.b.spEmployee || 0; f.spTax = sp.b.spTax || 0; f.spDividend = sp.b.spDividend || 0; f.spOther = sumItems(sp.rest)
    const lp = alloc(noteItems(data, /^long.?term provisions?$/i).map(i => ({ ...i, line: i.label })), [['lpEmployee', EMP]])
    f.lpEmployee = lp.b.lpEmployee || 0; f.lpOther = sumItems(lp.rest)
  }

  // assets
  f.ppe = noteTotal(data, /property.*plant.*equipment|^fixed assets$|^tangible assets$|^PPE$/i)
  f.intangibles = noteTotal(data, /^intangible assets$/i)
  f.cwip = noteTotal(data, /capital work.in.progress/i)
  f.intangiblesDev = noteTotal(data, /intangible assets under development/i)
  const INV = [
    ['property', /propert/i], ['pref', /preference/i], ['govt', /government|trust securit|\bnsc\b|\bkvp\b|\bppf\b/i],
    ['deb', /debenture|bond/i], ['mf', /mutual fund|\bmf\b/i], ['firm', /partnership|firm\b|llp/i],
    ['unlisted', /unlisted|unquoted/i], ['listed', /listed|quoted|equity|shares?\b/i],
  ]
  for (const [pre, rx] of [['nci', /^non.?current investments?$/i], ['ci', /^current investments?$/i]]) {
    const r = alloc(noteItems(data, rx).map(i => ({ ...i, line: i.label })), INV)
    for (const k of ['property', 'pref', 'govt', 'deb', 'mf', 'firm', 'unlisted', 'listed']) f[pre + '_' + k] = r.b[k] || 0
    f[pre + '_other'] = sumItems(r.rest)
  }
  {
    const inv = alloc(noteItems(data, /^inventories$/i).map(i => ({ ...i, line: i.label })), [
      ['invRaw', /raw material/i], ['invWip', /work.?in.?(progress|process)|\bwip\b/i], ['invFg', /finished good/i],
      ['invSit', /stock.?in.?trade|traded good|trading good/i], ['invStores', /stores|spares|consumable|packing/i], ['invLoose', /loose tool/i],
    ])
    for (const [k, v] of Object.entries(inv.b)) f[k] = v
    f.invOther = sumItems(inv.rest)
  }
  f.tradeReceivables = noteTotal(data, /^trade receivables?$/i)
  {
    const cb = alloc(noteItems(data, /cash and (bank|cash equivalents)|cash & bank|cash and bank/i).map(i => ({ ...i, line: i.label })), [
      ['cbCheque', /cheque|draft/i], ['cbCash', /cash (in|on) hand|^cash\b|petty|imprest/i], ['cbBank', /bank|current account|savings|account/i],
    ])
    f.cbBank = cb.b.cbBank || 0; f.cbCheque = cb.b.cbCheque || 0; f.cbCash = cb.b.cbCash || 0; f.cbOther = sumItems(cb.rest)
  }
  f.otherCurrentAssets = noteTotal(data, /^other current assets$/i)
  f.otherNonCurrentAssets = noteTotal(data, /^other non.?current assets$/i)
  {
    const rules = [['laRelated', RELATED], ['laCapital', /capital advance/i], ['laDeposit', /deposit/i],
      ['laRevenue', /gst|tds|tcs|income tax|advance tax|vat|revenue authorit|input credit|balance with|government|cenvat|service tax/i]]
    const st = alloc(noteItems(data, /^short.?term loans( and|\s*&) advances$/i).map(i => ({ ...i, line: i.label })), rules)
    const lt = alloc(noteItems(data, /^long.?term loans( and|\s*&) advances$/i).map(i => ({ ...i, line: i.label })), rules)
    for (const k of ['laRelated', 'laCapital', 'laDeposit', 'laRevenue']) { f['st_' + k] = st.b[k] || 0; f['lt_' + k] = lt.b[k] || 0 }
    f.st_laOther = sumItems(st.rest); f.lt_laOther = sumItems(lt.rest)
  }

  // ── Profit and Loss ──────────────────────────────────────────────────────
  const inc = data?.incomeSections || [], exp = data?.expenseSections || []
  // revenue: sale of goods / services, other operating revenue (a Details block)
  {
    const rev = alloc(sectionItems(inc, /revenue from operation/i), [['svc', /service|commission income|professional|consult|job work|labour charge|contract/i], ['goods', /sale|revenue|turnover|product|goods/i]])
    f.saleServices = rev.b.svc || 0; f.saleGoods = rev.b.goods || 0
    for (const it of rev.rest) detail('tradingOtherOperatingRevenue', it.line || it.text, it.amount)
  }
  // other income
  {
    const oi = alloc(sectionItems(inc, /other income/i), [
      ['inRent', /\brent/i], ['inCommission', /commission/i], ['inDividend', /dividend/i], ['inInterest', /interest/i],
      ['inProfitFA', /(profit|gain).*(sale|disposal|transfer).*(fixed|asset|property|plant|vehicle|machinery)|sale of (fixed )?assets?/i],
      ['inProfitInv', /(profit|gain).*(sale|redemption|transfer).*(invest|shares?|securit|mutual|bond|unit)/i],
      ['inForex', /foreign exchange|exchange (gain|difference|fluctuation)|forex/i], ['inAgri', /agricultur/i],
    ])
    for (const [k, v] of Object.entries(oi.b)) f[k] = v
    for (const it of oi.rest) detail('plAnyOtherIncome', it.line || it.text, it.amount)
  }
  // cost of materials / purchases: Manufacturing Account (a business with raw materials) or the Trading Account (a trader)
  {
    const cogs = sectionItems(exp, /^cost of materials consumed|purchases of stock.in.trade/i)
    const rmOpen = cogs.filter(i => /^opening stock of raw/i.test(i.line))
    const rmClose = cogs.filter(i => /closing stock of raw/i.test(i.line))
    const rest = cogs.filter(i => !rmOpen.includes(i) && !rmClose.includes(i))
    f.rmOpening = sumItems(rmOpen); f.rmClosing = -sumItems(rmClose)   // closing is carried as a "Less:" line (negative)
    const hasMfg = data?.expenseSections?.some(s => /^cost of materials consumed/i.test(s.level1 || '')) && (Math.abs(f.rmOpening) > 0.5 || Math.abs(f.rmClosing) > 0.5 || sumItems(cogs.filter(i => /^cost of materials/i.test(i.l1))) !== 0)
    f.useManufacturing = !!hasMfg
    const a = alloc(rest, [
      ['carriage', /carriage inward|freight inward|cartage inward|inward freight|carriage/i],
      ['powerFuel', /power|fuel|electric/i], ['directWages', /wages|labour|job work/i],
      ['purchases', /purchase|raw material|material|stock.in.trade|goods/i],
    ])
    f.carriageInward = a.b.carriage || 0; f.powerFuelDirect = a.b.powerFuel || 0; f.directWages = a.b.directWages || 0
    f.purchases = a.b.purchases || 0
    for (const it of a.rest) detail('tradingOtherDirectExpenses', it.line || it.text, it.amount)
  }
  // closing and opening stock of finished goods / stock-in-trade (the "Changes in inventories" note carries both)
  {
    const chg = notesBy(data, /changes in inventories/i)[0]
    const lines = chg ? (chg.lines || []) : []
    const open = lines.find(l => /^opening value/i.test(l.level2 || ''))
    const close = lines.find(l => /closing value/i.test(l.level2 || ''))
    f.openingStock = open ? num(open.total) : 0
    f.closingStock = close ? -num(close.total) : 0
  }
  // employee benefits
  {
    const e = alloc(sectionItems(exp, /employee benefit/i), [
      ['salary', /salar|wage|stipend|remuneration/i], ['bonus', /bonus|incentive|ex.?gratia/i], ['medical', /medical/i],
      ['leave', /leave encashment/i], ['pf', /provident|\bpf\b|\besi\b|\bepf\b/i], ['gratuity', /gratuity/i], ['super', /superannuation/i],
      ['welfare', /welfare|workmen|staff/i],
    ])
    for (const [k, v] of Object.entries(e.b)) f['emp_' + k] = v
    for (const it of e.rest) detail('plOtherExpenses', it.line || it.text, it.amount)
  }
  // finance costs, depreciation, tax, partners' remuneration
  {
    const fin = alloc(sectionItems(exp, /finance cost|finance charge/i), [['finPartner', /partner|member/i]])
    f.finPartners = fin.b.finPartner || 0; f.finOthers = sumItems(fin.rest)
    f.depreciation = sumItems(sectionItems(exp, /depreciation|amorti[sz]ation/i))
    f.partnersRemuneration = sumItems(sectionItems(exp, /partners?.{0,3}remuneration|salary.*partner/i))
    const tx = alloc(sectionItems(exp, /tax expense/i), [['txDeferred', /deferred/i], ['txCurrent', /current|income tax|provision for tax/i]])
    f.taxCurrent = (tx.b.txCurrent || 0) + sumItems(tx.rest); f.taxDeferred = tx.b.txDeferred || 0
    // The Current Tax line alone: for the comparison with the Tax Computation (Exception Report, Features > Tax Computation).
    // Deferred tax and tax of earlier years are not current tax.
    const taxLines = sectionItems(exp, /tax expense/i)
    const hayOf = (it) => `${it.line || ''} ${it.text || ''}`
    const notCurrent = /deferred|earlier|prior|previous/i
    const named = taxLines.filter(it => /current/i.test(hayOf(it)) && !notCurrent.test(hayOf(it)))
    f.taxCurrentOnly = named.length ? sumItems(named) : sumItems(taxLines.filter(it => !notCurrent.test(hayOf(it))))
  }
  // other expenses
  {
    const oe = alloc(sectionItems(exp, /^other expenses?$/i), [
      ['freightOut', /freight outward|carriage outward|outward freight|delivery|transport(ation)? (charges|outward)/i],
      ['stores', /stores|spare|consumption of/i], ['power', /power|fuel|electric/i], ['rent', /\brent/i],
      ['repBuilding', /repairs?.*building|building.*repair/i], ['repMachinery', /repairs?.*(machin|plant|equipment)|machinery.*repair/i],
      ['insurance', /insurance/i], ['entertainment', /entertainment/i], ['hospitality', /hospitality/i],
      ['salesPromotion', /sales promotion|business promotion|publicity/i], ['advertisement', /advertis/i],
      ['commission', /commission|brokerage/i], ['professional', /professional|consultancy|legal|technical/i],
      ['hotel', /hotel|boarding|lodging/i], ['foreignTravel', /foreign travel/i], ['travel', /travel/i], ['conveyance', /conveyance/i],
      ['telephone', /telephone|telecom|communication|internet|mobile/i], ['guestHouse', /guest house/i], ['club', /\bclub\b/i],
      ['donation', /donation/i], ['audit', /audit|auditor/i], ['badDebts', /bad debt|doubtful|provision for (bad|doubtful)/i],
      ['gst', /\bcgst\b|\bsgst\b|\bigst\b|\bgst\b/i], ['ratesTaxes', /rates and taxes|rate.*tax|duty|cess|\bstt\b/i],
    ])
    for (const [k, v] of Object.entries(oe.b)) f['oe_' + k] = v
    for (const it of oe.rest) detail('plOtherExpenses', it.line || it.text, it.amount)
  }
  // the figure the form's profit should come to
  const taxTotal = sumItems(sectionItems(exp, /tax expense/i))
  f._profitBeforeTax = num(data?.netProfit) + taxTotal
  return { fig: f, details }
}

// ── Placement ────────────────────────────────────────────────────────────────
// [groups, sheet, labelRx, pathRx|null, value(fig, group), optional note]. The row is the editable row of that sheet whose label
// matches and whose heading path (ancestors' labels, lowercased, joined by " > ") matches. Each active rule must find exactly one row.
const NC = ['individual', 'partnership'], ALL = ['individual', 'partnership', 'company'], CO = ['company'], IND = ['individual'], PART = ['partnership']
const sum = (...a) => a.reduce((s, x) => s + (x || 0), 0)
export const PLACE = [
  // Balance Sheet - sources of funds
  [IND, 'bs', /proprietor.?s capital/i, null, f => f.capital],
  [PART, 'bs', /partners.*capital/i, null, f => f.capital],
  [CO, 'bs', /^issued, subscribed and fully paid up$/i, null, f => f.shareCapital],
  [CO, 'bs', /^money received against share warrants$/i, null, f => f.shareWarrants],
  [CO, 'bs', /^capital reserve$/i, /reserves and surplus/, f => f.resCapital],
  [CO, 'bs', /^capital redemption reserve$/i, null, f => f.resCRR],
  [CO, 'bs', /^securities premium reserve$/i, null, f => f.resSecPremium],
  [CO, 'bs', /^debentures redemption reserve$/i, null, f => f.resDRR],
  [CO, 'bs', /^revaluation reserve$/i, null, f => f.resReval],
  [CO, 'bs', /^share options outstanding amount$/i, null, f => f.resOptions],
  [CO, 'bs', /^surplus i\.e\./i, null, f => f.resSurplus],
  // borrowings: non-corporate - bank loans secured, others unsecured (the common case; the form's secured / unsecured split needs the loan details)
  [NC, 'bs', /^from banks$/i, /^(?!.*unsecured).*secured loans/, f => sum(f.ltBank, f.stBank, f.currentMaturities)],
  [NC, 'bs', /^from others$/i, /unsecured loans/, f => sum(f.ltOthers, f.stOthers, f.ltRelated, f.stRelated, f.ltDeposit, f.stDeposit, f.ltDepRelated, f.stDepRelated, f.otherLtLiab)],
  [CO, 'bs', /^from banks$/i, /term loans/, f => f.ltBank],
  [CO, 'bs', /^from others$/i, /term loans/, f => f.ltOthers],
  [CO, 'bs', /^deposits from related parties/i, /long-term borrowings/, f => f.ltDepRelated],
  [CO, 'bs', /^other deposits$/i, /long-term borrowings/, f => f.ltDeposit],
  [CO, 'bs', /^loans and advances from related parties/i, /long-term borrowings/, f => f.ltRelated],
  [CO, 'bs', /^deferred tax liabilities \(net\)$/i, null, f => f.deferredTaxLiab],
  [IND, 'bs', /^deferred tax liability$/i, null, f => f.deferredTaxLiab],
  [PART, 'bs', /^deferred tax liability$/i, null, f => f.deferredTaxLiab],
  [CO, 'bs', /^others$/i, /other long-term liabilities/, f => f.otherLtLiab],
  [CO, 'bs', /^provision for employee benefits?$/i, /long-term provisions/, f => f.lpEmployee],
  [CO, 'bs', /^others$/i, /long-term provisions/, f => f.lpOther],
  [CO, 'bs', /^from banks$/i, /loans repayable on demand/, f => f.stBank],
  [CO, 'bs', /^from others$/i, /loans repayable on demand/, f => f.stOthers],
  [CO, 'bs', /^deposits from related parties/i, /short-term borrowings/, f => f.stDepRelated],
  [CO, 'bs', /^loans and advances from related parties/i, /short-term borrowings/, f => f.stRelated],
  [CO, 'bs', /^other deposits$/i, /short-term borrowings/, f => f.stDeposit],
  // current liabilities
  [CO, 'bs', /^others$/i, /trade payables/, f => f.tradePayables],
  [IND, 'bs', /^sundry creditors$/i, null, f => f.tradePayables],
  [PART, 'bs', /^others$/i, /sundry creditors/, f => f.tradePayables],
  [CO, 'bs', /^current maturities of long-term debt$/i, null, f => f.currentMaturities],
  [CO, 'bs', /^interest accrued but not due on borrowings$/i, null, f => f.oclInterestNotDue],
  [CO, 'bs', /^interest accrued and due on borrowings$/i, null, f => f.oclInterestDue],
  [CO, 'bs', /^income received in advance$/i, null, f => f.oclAdvanceIncome],
  [CO, 'bs', /^unpaid dividends$/i, null, f => f.oclUnpaidDiv],
  [CO, 'bs', /^other payables$/i, null, f => f.oclOther + f.oclLeased],
  [IND, 'bs', /^liabilities for leased assets$/i, null, f => f.oclLeased],
  [IND, 'bs', /^interest accrued but not due on loans$/i, null, f => f.oclInterestNotDue + f.oclInterestDue],
  [IND, 'bs', /^from others$/i, /advances/, f => f.oclOther + f.oclAdvanceIncome + f.oclUnpaidDiv],
  [PART, 'bs', /^liabilities for leased assets$/i, null, f => f.oclLeased],
  [PART, 'bs', /^interest accrued and due on borrowings$/i, null, f => f.oclInterestDue],
  [PART, 'bs', /^interest accrued but not due on borrowings$/i, null, f => f.oclInterestNotDue],
  [PART, 'bs', /^income received in advance$/i, null, f => f.oclAdvanceIncome],
  [PART, 'bs', /^other payables$/i, null, f => f.oclOther + f.oclUnpaidDiv],
  // provisions
  [CO, 'bs', /^provision for employee benefit$/i, /short-term provisions/, f => f.spEmployee],
  [CO, 'bs', /^provision for income-tax$/i, null, f => f.spTax],
  [CO, 'bs', /^proposed dividend$/i, null, f => f.spDividend],
  [CO, 'bs', /^other$/i, /short-term provisions/, f => f.spOther],
  [IND, 'bs', /^provision for income tax$/i, null, f => f.spTax],
  [IND, 'bs', /^provision for leave encashment/i, null, f => sum(f.spEmployee, f.lpEmployee)],
  [IND, 'bs', /^other provisions$/i, null, f => sum(f.spOther, f.lpOther, f.spDividend)],
  [PART, 'bs', /^provision for income tax$/i, null, f => f.spTax],
  [PART, 'bs', /^provision for leave encashment/i, null, f => sum(f.spEmployee, f.lpEmployee)],
  [PART, 'bs', /^other provisions$/i, null, f => sum(f.spOther, f.lpOther, f.spDividend)],
  // fixed assets (net block is carried in the gross-block cell, depreciation left nil: the Net Block comes out right)
  [NC, 'bs', /^gross: block$/i, null, f => sum(f.ppe, f.intangibles)],
  [CO, 'bs', /^gross block$/i, /> tangible assets/, f => f.ppe],
  [CO, 'bs', /^gross block$/i, /intangible assets/, f => f.intangibles],
  [NC, 'bs', /^capital work-in-progress$/i, null, f => sum(f.cwip, f.intangiblesDev)],
  [CO, 'bs', /^capital work-in-progress$/i, null, f => f.cwip],
  [CO, 'bs', /^intangible assets under development$/i, null, f => f.intangiblesDev],
  // investments
  [IND, 'bs', /government and other securities - quoted/i, null, f => f.nci_listed + f.nci_govt + f.nci_deb + f.nci_mf + f.nci_pref + f.nci_property],
  [IND, 'bs', /government and other securities - unquoted/i, null, f => f.nci_unlisted + f.nci_firm + f.nci_other],
  [IND, 'bs', /^equity shares, including share application money$/i, null, f => sum(f.ci_listed, f.ci_unlisted, f.ci_govt, f.ci_mf, f.ci_firm, f.ci_other, f.ci_property)],
  [IND, 'bs', /^preference shares$/i, null, f => f.ci_pref],
  [IND, 'bs', /^debenture$/i, null, f => f.ci_deb],
  [PART, 'bs', /^investment in property$/i, null, f => f.nci_property],
  [PART, 'bs', /^listed equities$/i, /long-term investments/, f => f.nci_listed],
  [PART, 'bs', /^unlisted equities$/i, /long-term investments/, f => f.nci_unlisted],
  [PART, 'bs', /^preference shares$/i, /long-term investments/, f => f.nci_pref],
  [PART, 'bs', /^government or trust securities$/i, /long-term investments/, f => f.nci_govt],
  [PART, 'bs', /^debenture or bonds$/i, /long-term investments/, f => f.nci_deb],
  [PART, 'bs', /^mutual funds$/i, /long-term investments/, f => f.nci_mf],
  [PART, 'bs', /^others$/i, /long-term investments/, f => f.nci_firm + f.nci_other],
  [PART, 'bs', /^listed equities$/i, /short-term investments/, f => f.ci_listed],
  [PART, 'bs', /^unlisted equities$/i, /short-term investments/, f => f.ci_unlisted],
  [PART, 'bs', /^preference shares$/i, /short-term investments/, f => f.ci_pref],
  [PART, 'bs', /^government or trust securities$/i, /short-term investments/, f => f.ci_govt],
  [PART, 'bs', /^debenture or bonds$/i, /short-term investments/, f => f.ci_deb],
  [PART, 'bs', /^mutual funds$/i, /short-term investments/, f => f.ci_mf],
  [PART, 'bs', /^others$/i, /short-term investments/, f => f.ci_firm + f.ci_other + f.ci_property],
  [CO, 'bs', /^investment in property$/i, null, f => f.nci_property],
  [CO, 'bs', /^listed equities$/i, /non-current investments/, f => f.nci_listed],
  [CO, 'bs', /^unlisted equities$/i, /non-current investments/, f => f.nci_unlisted],
  [CO, 'bs', /^investments in preference shares$/i, null, f => f.nci_pref],
  [CO, 'bs', /^investments in government or trust securities$/i, null, f => f.nci_govt],
  [CO, 'bs', /^investments in debenture or bonds$/i, null, f => f.nci_deb],
  [CO, 'bs', /^investments in mutual funds$/i, null, f => f.nci_mf],
  [CO, 'bs', /^investments in partnership firms$/i, null, f => f.nci_firm],
  [CO, 'bs', /^others investments$/i, null, f => f.nci_other],
  [CO, 'bs', /^listed equities$/i, /> current investments/, f => f.ci_listed],
  [CO, 'bs', /^unlisted equities$/i, /> current investments/, f => f.ci_unlisted],
  [CO, 'bs', /^investment in preference shares$/i, null, f => f.ci_pref],
  [CO, 'bs', /^investment in government or trust securities$/i, null, f => f.ci_govt],
  [CO, 'bs', /^investment in debenture or bonds$/i, null, f => f.ci_deb],
  [CO, 'bs', /^investment in mutual funds$/i, null, f => f.ci_mf],
  [CO, 'bs', /^investment in partnership firms$/i, null, f => f.ci_firm],
  [CO, 'bs', /^other investment$/i, null, f => f.ci_other + f.ci_property],
  [CO, 'bs', /^deferred tax assets \(net\)$/i, null, f => f.deferredTaxAsset],
  [IND, 'bs', /^deferred tax asset$/i, null, f => f.deferredTaxAsset],
  [PART, 'bs', /^deferred tax asset$/i, null, f => f.deferredTaxAsset],
  // inventories
  [IND, 'bs', /^raw materials$/i, null, f => f.invRaw],
  [IND, 'bs', /^stock-in-process$/i, null, f => f.invWip],
  [IND, 'bs', /^finished goods\/traded goods$/i, null, f => f.invFg + f.invSit],
  [IND, 'bs', /^stores\/consumables including packing material$/i, null, f => f.invStores + f.invLoose + f.invOther],
  [PART, 'bs', /^raw materials$/i, null, f => f.invRaw],
  [PART, 'bs', /^work-in-progress$/i, null, f => f.invWip],
  [PART, 'bs', /^finished goods$/i, null, f => f.invFg],
  [PART, 'bs', /^stock-in-trade/i, null, f => f.invSit],
  [PART, 'bs', /^stores\/consumables/i, null, f => f.invStores],
  [PART, 'bs', /^loose tools$/i, null, f => f.invLoose],
  [PART, 'bs', /^others$/i, /inventories/, f => f.invOther],
  [CO, 'bs', /^raw materials$/i, null, f => f.invRaw],
  [CO, 'bs', /^work-in-progress$/i, null, f => f.invWip],
  [CO, 'bs', /^finished goods$/i, null, f => f.invFg],
  [CO, 'bs', /^stock-in-trade/i, null, f => f.invSit],
  [CO, 'bs', /^stores and spares$/i, null, f => f.invStores],
  [CO, 'bs', /^loose tools$/i, null, f => f.invLoose],
  [CO, 'bs', /^others$/i, /inventories/, f => f.invOther],
  // receivables, cash, other assets
  [IND, 'bs', /^sundry debtors$/i, null, f => f.tradeReceivables],
  [PART, 'bs', /^others$/i, /sundry debtors/, f => f.tradeReceivables],
  [CO, 'bs', /^others$/i, /trade receivables/, f => f.tradeReceivables],
  [IND, 'bs', /^cash-in-hand$/i, null, f => f.cbCash],
  [IND, 'bs', /^balance with banks$/i, null, f => f.cbBank + f.cbCheque + f.cbOther],
  [PART, 'bs', /^balance with banks$/i, null, f => f.cbBank],
  [PART, 'bs', /^cash in hand$/i, null, f => f.cbCash],
  [PART, 'bs', /^others$/i, /cash and bank balances/, f => f.cbCheque + f.cbOther],
  [CO, 'bs', /^balance with banks$/i, null, f => f.cbBank],
  [CO, 'bs', /^cheques, drafts in hand$/i, null, f => f.cbCheque],
  [CO, 'bs', /^cash in hand$/i, null, f => f.cbCash],
  [CO, 'bs', /^others$/i, /cash and cash equivalents/, f => f.cbOther],
  [IND, 'bs', /^other current assets$/i, null, f => f.otherCurrentAssets],
  [PART, 'bs', /^other current assets$/i, null, f => f.otherCurrentAssets],
  [CO, 'bs', /^other current assets$/i, null, f => f.otherCurrentAssets],
  [CO, 'bs', /^others$/i, /other non-current assets/, f => f.otherNonCurrentAssets],
  [IND, 'bs', /^advances recoverable in cash or in kind/i, null, f => sum(f.st_laOther, f.lt_laOther, f.st_laRelated, f.lt_laRelated, f.st_laCapital, f.lt_laCapital)],
  [IND, 'bs', /^deposits, loans and advances to corporate and others$/i, null, f => sum(f.st_laDeposit, f.lt_laDeposit, f.otherNonCurrentAssets)],
  [IND, 'bs', /^balance with revenue authorities$/i, null, f => f.st_laRevenue + f.lt_laRevenue],
  [PART, 'bs', /^advances recoverable in cash or in kind/i, null, f => sum(f.st_laOther, f.lt_laOther, f.st_laRelated, f.lt_laRelated, f.st_laCapital, f.lt_laCapital)],
  [PART, 'bs', /^deposits, loans and advances to corporate and others$/i, null, f => sum(f.st_laDeposit, f.lt_laDeposit, f.otherNonCurrentAssets)],
  [PART, 'bs', /^balance with revenue authorities$/i, null, f => f.st_laRevenue + f.lt_laRevenue],
  [CO, 'bs', /^capital advances$/i, null, f => f.lt_laCapital],
  [CO, 'bs', /^security deposits$/i, null, f => f.lt_laDeposit],
  [CO, 'bs', /^loans and advances to related parties/i, /long-term loans and advances/, f => f.lt_laRelated],
  [CO, 'bs', /^other loans and advances$/i, /long-term loans and advances/, f => f.lt_laOther + f.lt_laRevenue],
  [CO, 'bs', /^loans and advances to related parties/i, /short-term loans and advances/, f => f.st_laRelated],
  [CO, 'bs', /^others$/i, /short-term loans and advances/, f => sum(f.st_laOther, f.st_laRevenue, f.st_laDeposit, f.st_laCapital)],

  // Manufacturing Account (a business that consumes raw materials)
  [ALL, 'mfg', /^opening stock of raw-material$/i, null, f => (f.useManufacturing ? f.rmOpening : 0)],
  [ALL, 'mfg', /^purchases \(net of refunds/i, null, f => (f.useManufacturing ? f.purchases : 0)],
  [ALL, 'mfg', /^carriage inward$/i, null, f => (f.useManufacturing ? f.carriageInward : 0)],
  [ALL, 'mfg', /^power and fuel$/i, null, f => (f.useManufacturing ? f.powerFuelDirect : 0)],
  [ALL, 'mfg', /^direct wages$/i, null, f => (f.useManufacturing ? f.directWages : 0)],
  [ALL, 'mfg', /^raw material$/i, /closing stock/, f => (f.useManufacturing ? f.rmClosing : 0)],
  // Trading Account
  [ALL, 'trading', /^sale of goods$/i, null, f => f.saleGoods],
  [ALL, 'trading', /^sale of services$/i, null, f => f.saleServices],
  [ALL, 'trading', /^closing stock of finished stocks$/i, null, f => f.closingStock],
  [ALL, 'trading', /^opening stock of finished goods/i, null, f => f.openingStock],
  [ALL, 'trading', /^purchases \(net of refunds/i, null, f => (f.useManufacturing ? 0 : f.purchases)],
  [ALL, 'trading', /^carriage inward$/i, null, f => (f.useManufacturing ? 0 : f.carriageInward)],
  [ALL, 'trading', /^power and fuel$/i, null, f => (f.useManufacturing ? 0 : f.powerFuelDirect)],
  // Profit and Loss
  [ALL, 'pl', /^rent$/i, /other income/, f => f.inRent],
  [ALL, 'pl', /^commission$/i, /other income/, f => f.inCommission],
  [ALL, 'pl', /^dividend income$/i, null, f => f.inDividend],
  [ALL, 'pl', /^interest income$/i, null, f => f.inInterest],
  [ALL, 'pl', /^profit on sale of fixed assets$/i, null, f => f.inProfitFA],
  [ALL, 'pl', /^profit on sale of other investment$/i, null, f => f.inProfitInv],
  [ALL, 'pl', /^gain \(loss\) on account of foreign exchange/i, null, f => f.inForex],
  [ALL, 'pl', /^agriculture income$/i, null, f => f.inAgri],
  [ALL, 'pl', /^freight outward$/i, null, f => f.oe_freightOut],
  [ALL, 'pl', /^consumption of stores and spare parts$/i, null, f => f.oe_stores],
  [ALL, 'pl', /^power and fuel$/i, /debits to profit and loss/, f => f.oe_power],
  [ALL, 'pl', /^rents$/i, null, f => f.oe_rent],
  [ALL, 'pl', /^repairs to building$/i, null, f => f.oe_repBuilding],
  [ALL, 'pl', /^repairs to machinery$/i, null, f => f.oe_repMachinery],
  [ALL, 'pl', /^salaries and wages$/i, null, f => f.emp_salary],
  [ALL, 'pl', /^bonus$/i, null, f => f.emp_bonus],
  [ALL, 'pl', /^reimbursement of medical expenses$/i, null, f => f.emp_medical],
  [ALL, 'pl', /^leave encashment$/i, null, f => f.emp_leave],
  [ALL, 'pl', /^contribution to approved superannuation fund$/i, null, f => f.emp_super],
  [ALL, 'pl', /^contribution to recognised provident fund$/i, null, f => f.emp_pf],
  [ALL, 'pl', /^contribution to recognised gratuity fund$/i, null, f => f.emp_gratuity],
  [ALL, 'pl', /^other insurance including/i, null, f => f.oe_insurance],
  [ALL, 'pl', /^workmen and staff welfare expenses$/i, null, f => f.emp_welfare],
  [ALL, 'pl', /^entertainment$/i, null, f => f.oe_entertainment],
  [ALL, 'pl', /^hospitality$/i, null, f => f.oe_hospitality],
  [ALL, 'pl', /^sales promotion including publicity/i, null, f => f.oe_salesPromotion],
  [ALL, 'pl', /^advertisement$/i, null, f => f.oe_advertisement],
  [ALL, 'pl', /^to others$/i, /> commission/, f => f.oe_commission],
  [ALL, 'pl', /^to others$/i, /professional/, f => f.oe_professional],
  [ALL, 'pl', /^hotel, boarding and lodging$/i, null, f => f.oe_hotel],
  [ALL, 'pl', /^traveling expenses other than on foreign traveling$/i, null, f => f.oe_travel],
  [ALL, 'pl', /^foreign traveling expenses$/i, null, f => f.oe_foreignTravel],
  [ALL, 'pl', /^conveyance expenses$/i, null, f => f.oe_conveyance],
  [ALL, 'pl', /^telephone expenses$/i, null, f => f.oe_telephone],
  [ALL, 'pl', /^guest house expenses$/i, null, f => f.oe_guestHouse],
  [ALL, 'pl', /^club expenses$/i, null, f => f.oe_club],
  [ALL, 'pl', /^donation$/i, null, f => f.oe_donation],
  [ALL, 'pl', /^central goods & service tax \(cgst\)$/i, null, f => f.oe_gst],
  [ALL, 'pl', /^any other rate, tax, duty or cess/i, null, f => f.oe_ratesTaxes],
  [ALL, 'pl', /^audit fee$/i, null, f => f.oe_audit],
  [PART, 'pl', /^salary\/remuneration to partners of the firm$/i, null, f => f.partnersRemuneration],
  [PART, 'pl', /^provision for bad and doubtful debts$/i, null, f => f.oe_badDebts],
  [NC.slice(0, 1).concat(CO), 'pl', /^provision for bad and doubtful debts$/i, null, f => f.oe_badDebts],
  [PART, 'pl', /^to partners$/i, /paid in india, or paid to a resident/, f => f.finPartners],
  [PART, 'pl', /^to others$/i, /interest(?!.*non-resident)/, f => f.finOthers],
  [IND.concat(CO), 'pl', /^to others$/i, /interest$/, f => f.finPartners + f.finOthers],
  [PART, 'pl', /^depreciation and amoritisation$/i, null, f => f.depreciation],
  [IND.concat(CO), 'pl', /^depreciation and amoritisation$/i, null, f => f.depreciation],
  [PART, 'pl', /^provision for current tax$/i, null, f => f.taxCurrent],
  [PART, 'pl', /^provision for deferred tax and deferred liability$/i, null, f => f.taxDeferred],
  [IND.concat(CO), 'pl', /^provision for current tax$/i, null, f => f.taxCurrent],
  [IND.concat(CO), 'pl', /^provision for deferred tax and deferred liability$/i, null, f => f.taxDeferred],
]

// editable rows of one sheet, each with its heading path
export function indexSchemaRows(rows) {
  const stack = []
  const out = []
  for (const r of (rows || [])) {
    const d = r.depth || 0
    while (stack.length && stack[stack.length - 1].depth >= d) stack.pop()
    const label = String(r.label || '').replace(/\s+/g, ' ').trim()
    if (r.editable && r.id) out.push({ id: r.id, label, path: stack.map(s => s.label.toLowerCase()).join(' > ') })
    stack.push({ depth: d, label })
  }
  return out
}

// which rows each active rule lands on: [{ rule index, ids: [...] }] - used by the pull and by the self-test
export function resolvePlacements(group, schema) {
  const sheets = { bs: indexSchemaRows(schema.bs.rows), mfg: indexSchemaRows(schema.mfg.rows), trading: indexSchemaRows(schema.trading.rows), pl: indexSchemaRows(schema.pl.rows) }
  return PLACE.map((p, i) => {
    if (!p[0].includes(group)) return null
    const hits = sheets[p[1]].filter(r => p[2].test(r.label) && (!p[3] || p[3].test(r.path)))
    return { index: i, sheet: p[1], label: p[2].source, ids: hits.map(h => h.id) }
  }).filter(Boolean)
}

/**
 * values: { rowId: "amount" } for the form; details: { blockKey: [{ particulars, amount }] } for the Details tables.
 * check: the profit before tax the statements give, for the caller to put beside the form's own.
 */
export function pullITRFromFinancials(group, schema, data) {
  const { fig: raw, details } = extractITRFigures(data)
  // a figure the statements do not carry is nil, never "undefined" (which would turn a sum into NaN)
  const fig = new Proxy(raw, { get: (t, k) => (typeof k === 'string' && !k.startsWith('_') && !(k in t) ? 0 : t[k]) })
  const values = {}
  for (const pl of resolvePlacements(group, schema)) {
    if (pl.ids.length !== 1) continue   // a rule that finds no row (or ambiguous) is never guessed
    const amt = PLACE[pl.index][4](fig, group)
    if (Math.abs(amt) >= 0.005) values[pl.ids[0]] = String(round2(amt))
  }
  const det = {}
  for (const [k, list] of Object.entries(details)) det[k] = list.map(x => ({ particulars: x.particulars, amount: String(x.amount) }))
  return { values, details: det, check: { profitBeforeTax: fig._profitBeforeTax } }
}

// kept for any older caller
export const pullPartnershipFromFinancials = (data, schema) => pullITRFromFinancials('partnership', schema, data).values
