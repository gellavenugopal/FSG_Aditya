import * as XLSX from 'xlsx'
import XLSXStyle from 'xlsx-js-style'

const TB_HEADERS = [
  'Period', 'Branch', 'Ledger Code', 'Name',
  'OpeningBalance', 'Debit', 'Credit', 'ClosingBalance',
  'IsRevenue', 'IsDeemedPositive', 'TrailBalance', 'Parent',
  'Group.$Parent', 'Group.$Parent.1', 'Group.$Parent.2', 'Group.$Parent.3',
  'Group.$Parent.4', 'Group.$Parent.5', 'Group.$Parent.6', 'Group.$Parent.7', 'Group.$Parent.8'
]

const TB_REQUIRED_HEADERS = new Set([
  'Name', 'OpeningBalance', 'Debit', 'Credit', 'ClosingBalance'
])

export function parseTBExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const ws = wb.Sheets['Trial Balance'] || wb.Sheets[wb.SheetNames[0]]
  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: null })

  // Header formatting can add display whitespace, and required headers carry a trailing asterisk.
  const rows = rawRows.map(r =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim().replace(/\s*\*$/, ''), v]))
  )

  return rows.map(r => {
    const clean = (k) => {
      const v = r[k]
      return v === null || v === undefined || v === '' ? null : v
    }
    const num = (k) => {
      const v = r[k]
      if (v === null || v === undefined || v === '') return 0
      const n = parseFloat(v)
      return isNaN(n) ? 0 : n
    }
    const TRUE_VALS = new Set(['true', 'yes', 'y', 't', '1'])
    const FALSE_VALS = new Set(['false', 'no', 'n', 'f', '0'])
    const bool = (k) => {
      const v = r[k]
      if (v === null || v === undefined || v === '') return null
      const s = String(v).trim().toLowerCase()
      if (TRUE_VALS.has(s)) return true
      if (FALSE_VALS.has(s)) return false
      return null
    }

    return {
      period:            clean('Period'),
      branch:            clean('Branch'),
      ledger_code:       clean('Ledger Code'),
      name:              clean('Name'),
      trial_balance_type: clean('TrialBalance'),
      opening_balance:   num('OpeningBalance'),
      debit:             num('Debit'),
      credit:            num('Credit'),
      closing_balance:   num('ClosingBalance'),
      is_revenue:        bool('IsRevenue'),
      is_deemed_positive: bool('IsDeemedPositive'),
      trail_balance:     num('TrailBalance'),
      parent:            clean('Parent'),
      group_parent:      clean('Group.$Parent'),
      group_parent_1:    clean('Group.$Parent.1'),
      group_parent_2:    clean('Group.$Parent.2'),
      group_parent_3:    clean('Group.$Parent.3'),
      group_parent_4:    clean('Group.$Parent.4'),
      group_parent_5:    clean('Group.$Parent.5'),
      group_parent_6:    clean('Group.$Parent.6'),
      group_parent_7:    clean('Group.$Parent.7'),
      group_parent_8:    clean('Group.$Parent.8'),
    }
  })
}

export function buildTBTemplateWorkbook() {
  const wb = XLSXStyle.utils.book_new()
  const headers = TB_HEADERS.map(header =>
    TB_REQUIRED_HEADERS.has(header) ? `${header} *` : header
  )
  const ws = XLSXStyle.utils.aoa_to_sheet([headers])
  ws['!cols'] = headers.map(header => ({ wch: Math.max(18, header.length + 2) }))
  ws['!freeze'] = { xSplit: 0, ySplit: 1 }
  ws['!autofilter'] = { ref: `A1:${XLSXStyle.utils.encode_col(headers.length - 1)}1` }
  headers.forEach((header, index) => {
    const cell = ws[XLSXStyle.utils.encode_cell({ r: 0, c: index })]
    const required = TB_REQUIRED_HEADERS.has(TB_HEADERS[index])
    cell.s = {
      fill: { patternType: 'solid', fgColor: { rgb: required ? 'FEE2E2' : '1E3A8A' } },
      font: { bold: true, color: { rgb: required ? 'B91C1C' : 'FFFFFF' } },
      alignment: { vertical: 'center', wrapText: true },
      border: { bottom: { style: 'thin', color: { rgb: 'CBD5E1' } } }
    }
  })
  ws['!rows'] = [{ hpt: 30 }]
  XLSXStyle.utils.book_append_sheet(wb, ws, 'Trial Balance')

  const guideRows = [
    ['FSG Bharat - Trial Balance upload template'],
    ['Enter one ledger per row in the "Trial Balance" sheet. Keep the column headers unchanged.'],
    ['Required fields are marked with a red *. Amount fields must contain numbers; enter 0 when there is no amount. Opening and closing balances use the app sign convention: debit-natured balances are negative and credit-natured balances are positive.'],
    [],
    ['Field', 'Required', 'Example', 'What to enter'],
    ['Period', 'No', '2025-26', 'Financial period for this row, if applicable.'],
    ['Branch', 'No', 'Head Office', 'Branch name for this row, if applicable.'],
    ['Ledger Code', 'No', '1001', 'Ledger/account code, if your accounting system has one.'],
    ['Name', 'Yes', 'Cash in Hand', 'Ledger or account name.'],
    ['OpeningBalance', 'Yes', 0, 'Numeric opening balance. Use 0 if there is no opening balance.'],
    ['Debit', 'Yes', 10500, 'Numeric debit movement for the period. Use 0 if none.'],
    ['Credit', 'Yes', 0, 'Numeric credit movement for the period. Use 0 if none.'],
    ['ClosingBalance', 'Yes', -10500, 'Numeric closing balance. Use 0 if the ledger has no closing balance.'],
    ['IsRevenue', 'No', 'FALSE', 'TRUE/FALSE or Yes/No. Optional revenue classification.'],
    ['IsDeemedPositive', 'No', 'TRUE', 'TRUE for debit-natured balances; FALSE for credit-natured balances.'],
    ['TrailBalance', 'No', 0, 'Optional trail-balance value; use 0 if not applicable.'],
    ['Parent', 'No', 'Current Assets', 'Optional immediate parent/group name.'],
    ['Group.$Parent', 'No', 'Current Assets', 'Optional group hierarchy value; include when available.'],
    ['Group.$Parent.1 to Group.$Parent.8', 'No', '', 'Optional higher-level group hierarchy values; leave blank if unavailable.'],
    [],
    ['Sample row (same values shown in the "Trial Balance" sheet format)'],
    headers,
    [
      '2025-26', 'Head Office', '1001', 'Cash in Hand',
      0, 10500, 0, -10500, false, true, 0,
      'Current Assets', 'Current Assets', 'Primary',
      '', '', '', '', '', '', ''
    ]
  ]
  const guide = XLSXStyle.utils.aoa_to_sheet(guideRows)
  guide['!cols'] = [{ wch: 34 }, { wch: 13 }, { wch: 26 }, { wch: 75 }]
  guide['!rows'] = [
    { hpt: 24 }, { hpt: 30 }, { hpt: 48 }, {}, { hpt: 22 },
    ...Array(15).fill({}), { hpt: 24 }, { hpt: 30 }
  ]
  guide['!freeze'] = { xSplit: 0, ySplit: 4 }
  guide['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } },
    { s: { r: 20, c: 0 }, e: { r: 20, c: 3 } }
  ]
  const styleCell = (address, style) => {
    if (guide[address]) guide[address].s = style
  }
  const titleStyle = {
    fill: { patternType: 'solid', fgColor: { rgb: '1E3A8A' } },
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 14 },
    alignment: { vertical: 'center', wrapText: true }
  }
  styleCell('A1', titleStyle)
  styleCell('A21', titleStyle)
  const introStyle = { alignment: { vertical: 'center', wrapText: true } }
  styleCell('A2', introStyle)
  styleCell('A3', introStyle)
  for (let c = 0; c < 4; c++) {
    styleCell(XLSXStyle.utils.encode_cell({ r: 4, c }), {
      fill: { patternType: 'solid', fgColor: { rgb: 'DBEAFE' } },
      font: { bold: true, color: { rgb: '1E3A8A' } },
      alignment: { vertical: 'center', wrapText: true }
    })
    styleCell(XLSXStyle.utils.encode_cell({ r: 21, c }), {
      fill: { patternType: 'solid', fgColor: { rgb: 'FEE2E2' } },
      font: { bold: true, color: { rgb: 'B91C1C' } },
      alignment: { vertical: 'center', wrapText: true }
    })
  }
  XLSXStyle.utils.book_append_sheet(wb, guide, 'Read Me')
  wb.SheetNames = ['Read Me', 'Trial Balance']
  return wb
}

export function generateTBTemplate() {
  return XLSXStyle.write(buildTBTemplateWorkbook(), { type: 'buffer', bookType: 'xlsx' })
}
