// Small evaluator that replicates the ITR reference workbook's own Excel
// formulas verbatim (SUM ranges/lists, +/-, optional 'Sheet Name'!cell
// cross-sheet refs) so the app's numbers stay faithful to the source
// spreadsheet instead of a hand-rebuilt total tree.
import { detailsBlockFor, ITR_DETAILS_BLOCKS } from './itrDetailsBlocks'

const CELLREF_RE = /^(?:'([^']+)'!)?([A-Z]+)(\d+)$/

function parseCellRef(token, defaultSheet) {
  const m = CELLREF_RE.exec(token.trim())
  if (!m) return null
  return { sheet: m[1] || defaultSheet, col: m[2], row: parseInt(m[3], 10) }
}

function splitTopLevel(str, seps) {
  const parts = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (depth === 0 && seps.includes(ch)) {
      parts.push(cur)
      cur = ch
    } else {
      cur += ch
    }
  }
  if (cur) parts.push(cur)
  return parts
}

function splitArgs(str) {
  const parts = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (depth === 0 && ch === ',') {
      parts.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim()) parts.push(cur)
  return parts
}

// resolve() : (sheet, col, row) -> number
function sumRange(refA, refB, resolve) {
  const block = detailsBlockFor(refA.sheet, refA.col)
  if (block) return resolve.detailsSum(block.key)
  let total = 0
  const r1 = Math.min(refA.row, refB ? refB.row : refA.row)
  const r2 = Math.max(refA.row, refB ? refB.row : refA.row)
  for (let r = r1; r <= r2; r++) total += resolve.cell(refA.sheet, refA.col, r)
  return total
}

function evalArg(arg, defaultSheet, resolve) {
  const parts = arg.split(':')
  if (parts.length === 2) {
    const a = parseCellRef(parts[0], defaultSheet)
    const b = parseCellRef(parts[1], a ? a.sheet : defaultSheet)
    if (!a || !b) return 0
    return sumRange(a, b, resolve)
  }
  const ref = parseCellRef(parts[0], defaultSheet)
  if (!ref) return 0
  const block = detailsBlockFor(ref.sheet, ref.col)
  if (block) return resolve.detailsSum(block.key)
  return resolve.cell(ref.sheet, ref.col, ref.row)
}

function evalTerm(term, defaultSheet, resolve) {
  const t = term.trim()
  const sumMatch = /^SUM\((.*)\)$/i.exec(t)
  if (sumMatch) {
    const args = splitArgs(sumMatch[1])
    return args.reduce((acc, a) => acc + evalArg(a, defaultSheet, resolve), 0)
  }
  return evalArg(t, defaultSheet, resolve)
}

// formula: raw string starting with '='. defaultSheet: the sheet the formula lives on.
// resolve: { cell(sheet,col,row)->number, detailsSum(blockKey)->number }
export function evaluateFormula(formula, defaultSheet, resolve) {
  const body = formula.startsWith('=') ? formula.slice(1) : formula
  const terms = splitTopLevel(body, '+-')
  let total = 0
  for (let term of terms) {
    let sign = 1
    if (term[0] === '+') { term = term.slice(1) }
    else if (term[0] === '-') { sign = -1; term = term.slice(1) }
    total += sign * evalTerm(term, defaultSheet, resolve)
  }
  return total
}

// Builds an id -> row-def index across a set of {sheetKey, rows} schema sheets.
export function buildRowIndex(sheets) {
  const index = {}
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      if (row.id) index[row.id] = { ...row, sheetKey: sheet.sheetKey }
    }
  }
  return index
}

// Computes numeric values for every row id in the index.
// formValues: { [id]: number } user-entered values for editable rows.
// detailsData: { [blockKey]: Array<{ [colKey]: any }> } dynamic table rows.
export function computeITRValues(index, formValues, detailsData) {
  const cache = {}
  const detailsSumCache = {}

  const detailsSum = (blockKey) => {
    if (detailsSumCache[blockKey] != null) return detailsSumCache[blockKey]
    const block = ITR_DETAILS_BLOCKS.find((b) => b.key === blockKey)
    const rows = detailsData?.[blockKey] || []
    const sum = rows.reduce((acc, r) => acc + (parseFloat(r?.[block?.amountKey]) || 0), 0)
    detailsSumCache[blockKey] = sum
    return sum
  }

  const cellValue = (sheet, col, row) => {
    const id = `${sheet}!${col}${row}`
    return getValue(id)
  }

  const resolve = { cell: cellValue, detailsSum }

  function getValue(id) {
    if (id in cache) return cache[id]
    const def = index[id]
    if (!def) { cache[id] = 0; return 0 }
    cache[id] = 0 // guard against accidental cycles
    let val = 0
    if (def.formula) {
      val = evaluateFormula(def.formula, def.sheetKey, resolve)
    } else if (def.editable) {
      val = parseFloat(formValues?.[id]) || 0
    }
    cache[id] = val
    return val
  }

  Object.keys(index).forEach(getValue)
  return cache
}
