// Duplicated from useFinancials.js's displayAmt() rather than imported, to
// avoid a circular import (useFinancials.js consumes this module).
function displayAmt(row, field = 'closing_balance') {
  const bal = parseFloat(row[field] || 0)
  const isDrSide = (row.alie === 'ASSETS' || row.alie === 'Expenses')
  return isDrSide ? -bal : bal
}

// ── Opening/Closing Stock treatment split ───────────────────────────────────
// Per the CA's Opening/Closing Stock treatment rules:
//   - Raw Materials              → "Cost of materials consumed"
//       (Opening + Purchases − Closing; Purchases routing is unchanged).
//       An entity with no "Cost of materials consumed" line at all (a Service
//       Provider; a Manufacturer with no purchase ledger mapped there) has
//       nowhere to adjust it, so it goes to "Changes in inventories" with the
//       other stock instead (opts.rawToChange, 0.1.93). Before that, the
//       figure was left out of the P&L, and profit and the Balance Sheet were
//       both out by the year's movement in raw-material stock.
//   - Work in Progress / Finished Goods / Stock-in-Trade / anything
//     unclassified → "Changes in inventories of finished goods, WIP and
//     Stock-in-Trade" (Opening − Closing), category-wise
//   - Stores & Spares / Loose Tools / Others → "Other Expenses" (Opening −
//     Closing), in the Other-expenses HEAD the Stock tab asked for (0.1.93:
//     tb_rows.stock_head, carried on the stock rows) - added into that head's
//     own line of the Other-expenses note. A category with no head named keeps
//     the three fixed lines (Opening / Less: Closing / Change) for the three
//     together.
//
// Ledgers are classified per-row using mapped_tb.level5_value, which is set
// automatically at Stock-entry time (see src/main/ipc/tb.js's saveStock and
// mapping-engine.js's Stock Entry special case) to the exact category label
// used on the Stock form — no manual Categorisation step required. A
// Trader entity (per the Auditee's Nature of Business) is presumed to hold
// no Raw Materials at all, so Raw-Materials-labelled rows still fall back to
// the "change" bucket for Traders.
//
// Supports two mapping-file shapes so it works regardless of when an entity's
// (possibly client-specific, never auto-refreshed) rule set was seeded:
//   - Current: a single "Changes in inventories..." L1 bucket holds both
//     Opening Stock and Closing Stock ledgers, distinguished by
//     mapping3_resultant/level3 = "Opening Stock" / "Closing Stock".
//   - Legacy: separate "Opening Stock (PL)" (Expenses) / "Closing Stock (PL)"
//     (Income) L1 buckets — this is what saveStock actually produces today.
//
// CY figures are always computed from the current TB's own rows (accurate
// per-row). PY figures follow the same row-level split UNLESS a separate
// previous-year TB was uploaded (prevMap active), in which case a row-level
// split isn't possible (the prior TB's own rows aren't available here) — the
// "Changes in inventories" section keeps its full prevMap-derived total
// un-split (treated as "change") until per-row PY carry-forward is built.

const RAW_MATERIAL_CATEGORY = 'raw materials'
const OTHER_EXPENSE_CATEGORIES = new Set(['stores & spares', 'loose tools', 'others'])

// The name of an Other-expenses head as the Stock tab stores it on a stock row
// (tb_rows.stock_head): one line of text, single spaces, 120 characters at most.
// Two names are the same head when they differ only in capitals or spacing.
export function cleanHead(h) {
  return String(h == null ? '' : h).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
}
export function headKey(h) { return cleanHead(h).toLowerCase() }

// A row counts as Opening/Closing Stock either because our own Stock tab
// tagged it that way (mapping3_resultant/level3), OR because the ledger
// ITSELF is literally named "Opening Stock"/"Closing Stock" in the uploaded
// Trial Balance — per the CA's litmus-test rule (see tb.js's
// tb:getOpeningStockCheck), a TB whose overall Opening Balance nets to zero
// is presumed to already carry its Opening Stock as a real ledger line, and
// that ledger must feed the same "Opening Value of …" note line as a
// manually-entered Stock-tab figure would — not get stranded as an
// unexplained "Net Change in Inventory" line.
const isOpeningRow = (row) =>
  /^opening stock$/i.test((row.mapping3_resultant || row.level3 || '').trim()) ||
  /^opening stock$/i.test((row.name || '').trim())
const isClosingRow = (row) =>
  /^closing stock$/i.test((row.mapping3_resultant || row.level3 || '').trim()) ||
  /^closing stock$/i.test((row.name || '').trim())

function categoryLabel(row) {
  return (row.level5_value || '').trim()
}

// rawToChange: the entity has no "Cost of materials consumed" line to adjust Raw
// Materials in (the caller looked), so they are treated like the other stock.
function classify(row, businessType, rawToChange = false) {
  const cat = categoryLabel(row).toLowerCase()
  if (businessType !== 'Trader' && !rawToChange && cat === RAW_MATERIAL_CATEGORY) return 'raw'
  if (OTHER_EXPENSE_CATEGORIES.has(cat)) return 'otherExpense'
  return 'change'
}

// A real TB ledger literally named "Opening Stock"/"Closing Stock" and the
// Stock tab's own category entries for the SAME TB must never both be counted:
// if the Stock tab has been filled in at all, its entries are a *bifurcation*
// of whatever the TB already carries (the real ledger is superseded, not
// additive); the real ledger stands alone only while the Stock tab is empty.
const isStockTabRow = (row) => row.upload_nature === 'Stock Entry'
function pickAuthoritative(candidates) {
  const stockTabRows = candidates.filter(isStockTabRow)
  return stockTabRows.length ? stockTabRows : candidates.filter(r => !isStockTabRow(r))
}

// Split a FLAT mapped-row list into opening / closing / net-change stock rows,
// applying the same two mapping shapes and the same supersede rule used for the
// current year below. The previous-year TB's rows are only ever available as a
// flat list (its sections are never built), so this is how the PY side gets the
// identical treatment instead of being written off as 0.
function collectStockRowsFlat(rows) {
  const openingCandidates = [], closingCandidates = [], netRows = []
  for (const row of rows || []) {
    const l1 = row.level1 || ''
    // Legacy shape: whole Level-1 bucket is opening (or closing), regardless of L3.
    if (/^opening stock/i.test(l1)) { openingCandidates.push(row); continue }
    if (/^closing stock/i.test(l1)) { closingCandidates.push(row); continue }
    if (!/changes in inventor/i.test(l1)) continue
    // Current shape: one bucket, split by the L3 caption / ledger name.
    if (isOpeningRow(row)) openingCandidates.push(row)
    else if (isClosingRow(row)) closingCandidates.push(row)
    else netRows.push(row)
  }
  return {
    openRows: pickAuthoritative(openingCandidates),
    closeRows: pickAuthoritative(closingCandidates),
    netRows,
  }
}

// Group a set of opening/closing rows by their category label (level5_value),
// returning [{ label, openingCY, closingCY, openingPY, closingPY, changeCY, changePY, openRows, closeRows }],
// sorted by label. Rows without a category label are grouped under "Uncategorised Stock".
function groupByCategory(openRows, closeRows, hasSeparatePYTB, pyOpenRows = null, pyCloseRows = null) {
  const sumAbs = (row, field) => Math.abs(displayAmt(row, field))
  const byLabel = new Map()
  const bucket = (label) => {
    if (!byLabel.has(label)) {
      byLabel.set(label, { label, openRows: [], closeRows: [], pyOpenRows: [], pyCloseRows: [] })
    }
    return byLabel.get(label)
  }
  for (const row of openRows) bucket(categoryLabel(row) || 'Uncategorised Stock').openRows.push(row)
  for (const row of closeRows) bucket(categoryLabel(row) || 'Uncategorised Stock').closeRows.push(row)
  // A category present only last year still deserves its own comparative line.
  const hasPyRowSplit = !!(pyOpenRows || pyCloseRows)
  for (const row of pyOpenRows || []) bucket(categoryLabel(row) || 'Uncategorised Stock').pyOpenRows.push(row)
  for (const row of pyCloseRows || []) bucket(categoryLabel(row) || 'Uncategorised Stock').pyCloseRows.push(row)

  return [...byLabel.values()]
    .map(b => {
      const openingCY = b.openRows.reduce((s, r) => s + sumAbs(r, 'closing_balance'), 0)
      const closingCY = b.closeRows.reduce((s, r) => s + sumAbs(r, 'closing_balance'), 0)
      const openingPY = hasPyRowSplit
        ? b.pyOpenRows.reduce((s, r) => s + sumAbs(r, 'closing_balance'), 0)
        : hasSeparatePYTB ? 0 : b.openRows.reduce((s, r) => s + sumAbs(r, 'opening_balance'), 0)
      const closingPY = hasPyRowSplit
        ? b.pyCloseRows.reduce((s, r) => s + sumAbs(r, 'closing_balance'), 0)
        : hasSeparatePYTB ? 0 : b.closeRows.reduce((s, r) => s + sumAbs(r, 'opening_balance'), 0)
      return {
        label: b.label,
        openingCY, closingCY, openingPY, closingPY,
        changeCY: openingCY - closingCY, changePY: openingPY - closingPY,
        openRows: b.openRows, closeRows: b.closeRows,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * @param {object} data - output of processRows() (expenseSections, incomeSections)
 * @param {string} businessType - entity.business_type ('Trader'|'Manufacturer'|'Service Provider'|'Mixed')
 * @param {boolean} hasSeparatePYTB - true when prevMap was active (a separate PY TB was uploaded)
 * @param {object[]|null} pyRows - the previous-year TB's mapped rows (prevMap.rows), when there is one
 * @param {{ rawToChange?: boolean }} opts - rawToChange: the entity has no "Cost of materials consumed"
 *   line, so Raw Materials stock is adjusted in "Changes in inventories" with the rest (it is
 *   not "raw" any more: rawMaterial* below are then empty and the change* figures include it)
 * @returns {{
 *   rawMaterialDelta: {cy:number, py:number}, otherStockDelta: {cy:number, py:number}, otherExpenseDelta: {cy:number, py:number},
 *   rawMaterialOpeningRows: object[], rawMaterialOpening: {cy:number, py:number},
 *   rawMaterialClosingRows: object[], rawMaterialClosing: {cy:number, py:number},
 *   otherStockOpeningRows: object[], otherStockOpening: {cy:number, py:number},
 *   otherStockClosingRows: object[], otherStockClosing: {cy:number, py:number},
 *   otherStockNetRows: object[], otherStockNet: {cy:number, py:number},
 *   otherStockRows: object[], otherStockCategories: object[],
 *   otherExpenseOpeningRows: object[], otherExpenseOpening: {cy:number, py:number},
 *   otherExpenseClosingRows: object[], otherExpenseClosing: {cy:number, py:number},
 *   otherExpenseRows: object[], otherExpenseCategories: object[],
 *   otherExpenseHeads: object[], otherExpenseUnnamed: object|null,
 *   changeIncludesRaw: boolean, rawToChange: boolean,
 *   changesSec: object|null, legacyOpenSec: object|null, legacyCloseSec: object|null,
 * }}
 *   otherExpenseHeads: one entry per Other-expenses head the Stock tab named, { head, key, openingCY, closingCY,
 *     openingPY, closingPY, deltaCY, deltaPY, openRows, closeRows, entryRows } - entryRows being the stock rows as
 *     that head's line shows them (Opening Stock adds, Closing Stock is taken off). otherExpenseUnnamed: the same
 *     figures for the stock rows with no head named (null when there are none). Between them they cover exactly
 *     what otherExpenseOpening / otherExpenseClosing / otherExpenseDelta total.
 */
export function computeInventorySplit(data, businessType, hasSeparatePYTB = false, pyRows = null, opts = {}) {
  const exp = data.expenseSections || []
  const inc = data.incomeSections || []
  const rawToChange = !!(opts && opts.rawToChange)

  const changesSec = exp.find(s => /changes in inventor/i.test(s.level1 || ''))
  const legacyOpenSec = exp.find(s => /^opening stock/i.test(s.level1 || ''))
  const legacyCloseSec = inc.find(s => /^closing stock/i.test(s.level1 || ''))

  const rawOpenRows = [], rawCloseRows = []
  const otherOpenRows = [], otherCloseRows = [], otherNetRows = []
  const expOpenRows = [], expCloseRows = []

  const sumAbs = (row, field) => Math.abs(displayAmt(row, field))

  const addOpening = (row) => {
    const kind = classify(row, businessType, rawToChange)
    if (kind === 'raw') rawOpenRows.push(row)
    else if (kind === 'otherExpense') expOpenRows.push(row)
    else otherOpenRows.push(row)
  }
  const addClosing = (row) => {
    const kind = classify(row, businessType, rawToChange)
    if (kind === 'raw') rawCloseRows.push(row)
    else if (kind === 'otherExpense') expCloseRows.push(row)
    else otherCloseRows.push(row)
  }

  // Collect every opening/closing candidate row first (from both mapping
  // shapes), THEN decide which set is authoritative — a real TB ledger
  // literally named "Opening Stock"/"Closing Stock" and the Stock tab's own
  // category entries for the SAME TB must never both be counted: per the
  // CA's rule, if the Stock tab has been filled in at all, its entries are a
  // *bifurcation* of whatever the TB already carries (the real ledger is
  // superseded, not additive); the real ledger's value is only ever used on
  // its own when the Stock tab hasn't been filled in yet.
  const openingCandidates = []
  const closingCandidates = []
  if (changesSec) {
    for (const line of changesSec.lines) {
      for (const row of line.rows) {
        if (isOpeningRow(row)) openingCandidates.push(row)
        else if (isClosingRow(row)) closingCandidates.push(row)
        else {
          // Genuine "change in inventory" ledger entries (not stock-balance
          // ledgers) — already a net figure, not an opening/closing pair to
          // subtract. Not category-classifiable, so always "change".
          otherNetRows.push(row)
        }
      }
    }
  }
  // Legacy mapping shape: separate Opening Stock (PL) / Closing Stock (PL) buckets.
  // This is what src/main/ipc/tb.js's saveStock actually produces today.
  if (legacyOpenSec) {
    for (const line of legacyOpenSec.lines) for (const row of line.rows) openingCandidates.push(row)
  }
  if (legacyCloseSec) {
    for (const line of legacyCloseSec.lines) for (const row of line.rows) closingCandidates.push(row)
  }

  for (const row of pickAuthoritative(openingCandidates)) addOpening(row)
  for (const row of pickAuthoritative(closingCandidates)) addClosing(row)

  // ── Previous year, when a separate PY TB is loaded ────────────────────────
  // That TB's own mapped rows carry the PY figures in their closing_balance,
  // so classify them exactly as the CY rows were classified above. Before this,
  // every PY bucket here was simply written off as 0 and only the "change"
  // bucket got a crude section-level fallback — which silently dropped the
  // previous year's raw-material opening/closing adjustment altogether,
  // overstating PY "Cost of materials consumed" by the year's stock movement
  // and understating PY profit by the identical amount. Nothing downstream
  // recovers it either: reconcilePrevTotals() in useFinancials.js deliberately
  // skips every stock label, treating this function as the sole owner of them.
  const pyRawOpenRows = [], pyRawCloseRows = []
  const pyOtherOpenRows = [], pyOtherCloseRows = [], pyOtherNetRows = []
  const pyExpOpenRows = [], pyExpCloseRows = []
  const hasPyRowSplit = hasSeparatePYTB && !!(pyRows && pyRows.length)
  if (hasPyRowSplit) {
    const py = collectStockRowsFlat(pyRows)
    for (const row of py.openRows) {
      const kind = classify(row, businessType, rawToChange)
      if (kind === 'raw') pyRawOpenRows.push(row)
      else if (kind === 'otherExpense') pyExpOpenRows.push(row)
      else pyOtherOpenRows.push(row)
    }
    for (const row of py.closeRows) {
      const kind = classify(row, businessType, rawToChange)
      if (kind === 'raw') pyRawCloseRows.push(row)
      else if (kind === 'otherExpense') pyExpCloseRows.push(row)
      else pyOtherCloseRows.push(row)
    }
    pyOtherNetRows.push(...py.netRows)
  }

  const sumRows = (rowsArr, field) => rowsArr.reduce((s, r) => s + sumAbs(r, field), 0)
  const sumRowsSigned = (rowsArr, field) => rowsArr.reduce((s, r) => s + displayAmt(r, field), 0)
  // PY for a bucket: the PY TB's own rows when we have them, else the CY rows'
  // opening_balance (single-TB comparative), else nothing to go on.
  const pySum = (pyRowsArr, cyRowsArr) =>
    hasPyRowSplit ? sumRows(pyRowsArr, 'closing_balance')
      : hasSeparatePYTB ? 0
        : sumRows(cyRowsArr, 'opening_balance')
  const pySumSigned = (pyRowsArr, cyRowsArr) =>
    hasPyRowSplit ? sumRowsSigned(pyRowsArr, 'closing_balance')
      : hasSeparatePYTB ? 0
        : sumRowsSigned(cyRowsArr, 'opening_balance')

  const rawMaterialOpening = {
    cy: sumRows(rawOpenRows, 'closing_balance'),
    py: pySum(pyRawOpenRows, rawOpenRows),
  }
  const rawMaterialClosing = {
    cy: sumRows(rawCloseRows, 'closing_balance'),
    py: pySum(pyRawCloseRows, rawCloseRows),
  }
  const otherStockOpening = {
    cy: sumRows(otherOpenRows, 'closing_balance'),
    py: pySum(pyOtherOpenRows, otherOpenRows),
  }
  const otherStockClosing = {
    cy: sumRows(otherCloseRows, 'closing_balance'),
    py: pySum(pyOtherCloseRows, otherCloseRows),
  }
  const otherStockNet = {
    cy: sumRowsSigned(otherNetRows, 'closing_balance'),
    py: pySumSigned(pyOtherNetRows, otherNetRows),
  }
  const otherExpenseOpening = {
    cy: sumRows(expOpenRows, 'closing_balance'),
    py: pySum(pyExpOpenRows, expOpenRows),
  }
  const otherExpenseClosing = {
    cy: sumRows(expCloseRows, 'closing_balance'),
    py: pySum(pyExpCloseRows, expCloseRows),
  }

  let otherCY = otherStockOpening.cy - otherStockClosing.cy + otherStockNet.cy
  let otherPY = otherStockOpening.py - otherStockClosing.py + otherStockNet.py

  // When a separate PY TB is active, the "change" bucket keeps the full
  // prevMap-derived comparative (row-level split isn't available for the
  // prior TB) — fold in whatever changesSec/legacy sections' prevTotal
  // already resolved to, instead of the row-derived (CY-only, zeroed above) figure.
  // The "otherExpense" bucket has no separate PY-TB fallback (it never had a
  // dedicated section of its own before this split existed) — its PY stays
  // row-derived, i.e. 0 whenever hasSeparatePYTB is true, until per-row PY
  // carry-forward is built for it too.
  if (hasSeparatePYTB && !hasPyRowSplit) {
    const legacyOpenPY = legacyOpenSec?.prevTotal || 0
    const legacyClosePY = legacyCloseSec?.prevTotal || 0
    // The Opening/Closing split (unlike a per-CATEGORY RM/WIP/FG/etc. split)
    // doesn't need the prior TB's individual rows — legacyOpenSec/
    // legacyCloseSec are already separate Level-1 sections, each with its
    // own prevMap-derived prevTotal (see buildPrevMap), so the true PY
    // Opening Value and PY Closing Value are both directly available, not
    // just their net difference. Surface them on the note face instead of
    // leaving those two lines blank while only the Total carries a figure.
    otherStockOpening.py = legacyOpenPY
    otherStockClosing.py = legacyClosePY
    const changesPY = changesSec?.prevTotal || 0
    otherPY = changesPY + (legacyOpenPY - legacyClosePY)
  }

  // ── Stores & Spares / Loose Tools / Others: the head each is adjusted in ───
  // The Stock tab asks, for each of these categories, which line of the Other-
  // expenses note its Opening and Closing stock is adjusted in (stock_head on
  // the stock rows). Rows are grouped by that head, so processRows() can add
  // each group's (Opening - Closing) into the head's own line. A category the
  // CA named in the current year keeps that head for the previous year's rows
  // too (a comparative sits on the same line as the figure it compares with);
  // a category only last year's TB has uses the head that TB carries. Rows with
  // no head at all (stock saved before the Stock tab asked) form the "unnamed"
  // group, which keeps the three fixed lines.
  const catKey = (r) => categoryLabel(r).toLowerCase()
  const ownHeadByCategory = new Map()
  for (const r of [...expOpenRows, ...expCloseRows]) {
    const h = cleanHead(r.stock_head)
    if (h && !ownHeadByCategory.has(catKey(r))) ownHeadByCategory.set(catKey(r), h)
  }
  const headOfCY = (r) => cleanHead(r.stock_head) || ownHeadByCategory.get(catKey(r)) || ''
  const headOfPY = (r) => ownHeadByCategory.get(catKey(r)) || cleanHead(r.stock_head) || ''
  const headGroups = new Map()
  const headGroup = (head) => {
    const k = headKey(head)
    if (!headGroups.has(k)) headGroups.set(k, { key: k, head: cleanHead(head), cyOpen: [], cyClose: [], pyOpen: [], pyClose: [] })
    return headGroups.get(k)
  }
  for (const r of expOpenRows) headGroup(headOfCY(r)).cyOpen.push(r)
  for (const r of expCloseRows) headGroup(headOfCY(r)).cyClose.push(r)
  for (const r of pyExpOpenRows) headGroup(headOfPY(r)).pyOpen.push(r)
  for (const r of pyExpCloseRows) headGroup(headOfPY(r)).pyClose.push(r)

  // The stock rows of a named head as that head's own line shows them: Opening
  // Stock adds to the head, Closing Stock is taken off it. The Closing Stock row
  // sits on the Income side of the Trial Balance (a credit); inside an expense
  // line it is a credit entry, a negative figure - so the line's ledgers add up
  // to the line, in the note's drill-down and in the Annexures.
  const asHeadEntry = (row, sign) => {
    const amt = Math.abs(parseFloat(row.closing_balance) || 0)
    return { ...row, alie: 'Expenses', closing_balance: String(sign > 0 ? -amt : amt), is_deemed_positive: sign > 0 }
  }
  const otherExpenseHeads = []
  let otherExpenseUnnamed = null
  for (const g of headGroups.values()) {
    const openingCY = sumRows(g.cyOpen, 'closing_balance')
    const closingCY = sumRows(g.cyClose, 'closing_balance')
    const openingPY = pySum(g.pyOpen, g.cyOpen)
    const closingPY = pySum(g.pyClose, g.cyClose)
    const totals = {
      head: g.head, key: g.key,
      openingCY, closingCY, openingPY, closingPY,
      deltaCY: openingCY - closingCY, deltaPY: openingPY - closingPY,
      openRows: g.cyOpen, closeRows: g.cyClose,
    }
    if (g.key === '') otherExpenseUnnamed = totals
    else otherExpenseHeads.push({ ...totals, entryRows: [...g.cyOpen.map(r => asHeadEntry(r, 1)), ...g.cyClose.map(r => asHeadEntry(r, -1))] })
  }
  otherExpenseHeads.sort((a, b) => a.head.localeCompare(b.head))

  // Does the "change" bucket carry Raw Materials (a Trader's, or an entity with no
  // Cost of materials consumed line)? Its note lines then say so.
  const changeIncludesRaw = [...otherOpenRows, ...otherCloseRows, ...pyOtherOpenRows, ...pyOtherCloseRows]
    .some(r => catKey(r) === RAW_MATERIAL_CATEGORY)

  return {
    rawMaterialDelta: {
      cy: rawMaterialOpening.cy - rawMaterialClosing.cy,
      py: rawMaterialOpening.py - rawMaterialClosing.py,
    },
    otherStockDelta: { cy: otherCY, py: otherPY },
    otherExpenseDelta: {
      cy: otherExpenseOpening.cy - otherExpenseClosing.cy,
      py: otherExpenseOpening.py - otherExpenseClosing.py,
    },
    rawMaterialOpeningRows: rawOpenRows, rawMaterialOpening,
    rawMaterialClosingRows: rawCloseRows, rawMaterialClosing,
    otherStockOpeningRows: otherOpenRows, otherStockOpening,
    otherStockClosingRows: otherCloseRows, otherStockClosing,
    otherStockNetRows: otherNetRows, otherStockNet,
    otherStockRows: [...otherOpenRows, ...otherCloseRows, ...otherNetRows],
    otherStockCategories: groupByCategory(otherOpenRows, otherCloseRows, hasSeparatePYTB,
      hasPyRowSplit ? pyOtherOpenRows : null, hasPyRowSplit ? pyOtherCloseRows : null),
    otherExpenseOpeningRows: expOpenRows, otherExpenseOpening,
    otherExpenseClosingRows: expCloseRows, otherExpenseClosing,
    otherExpenseRows: [...expOpenRows, ...expCloseRows],
    otherExpenseCategories: groupByCategory(expOpenRows, expCloseRows, hasSeparatePYTB,
      hasPyRowSplit ? pyExpOpenRows : null, hasPyRowSplit ? pyExpCloseRows : null),
    otherExpenseHeads, otherExpenseUnnamed,
    changeIncludesRaw, rawToChange,
    // PY-side row sets, so callers can tell a bucket that exists only in the
    // comparative year apart from one that is genuinely empty.
    prevRawMaterialRows: [...pyRawOpenRows, ...pyRawCloseRows],
    prevOtherStockRows: [...pyOtherOpenRows, ...pyOtherCloseRows, ...pyOtherNetRows],
    prevOtherExpenseRows: [...pyExpOpenRows, ...pyExpCloseRows],
    changesSec, legacyOpenSec, legacyCloseSec,
  }
}
