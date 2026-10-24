// Definitions for the dynamic "add a row" Particulars/Amount sub-schedules
// referenced from the main ITR BS/PL sheets via SUM() formulas, e.g.
// =SUM('Trading Other Details'!B3:B50). Each block is rendered as an
// editable table in the "PL Details" / "BS Details" leaf, and its total
// (sum of the amount column) feeds back into the linked cell on BS/PL.
//
// `startRow` + each column's `col` letter are the exact coordinates used
// in the reference workbook (see the Trading/P&L Other Details sheets) —
// the Excel export writes rows back into these same cells.

export const ITR_DETAILS_BLOCKS = [
  {
    key: 'tradingOtherOperatingRevenue',
    sheet: 'Trading Other Details',
    amountCol: 'B',
    startRow: 3,
    group: 'plDetails',
    title: 'Other operating revenues (specify nature and amount)',
    columns: [
      { key: 'particulars', label: 'Particulars', type: 'text', col: 'A' },
      { key: 'amount', label: 'Amount', type: 'number', col: 'B' },
    ],
    amountKey: 'amount',
  },
  {
    key: 'tradingOtherDirectExpenses',
    sheet: 'Trading Other Details',
    amountCol: 'E',
    startRow: 3,
    group: 'plDetails',
    title: 'Other direct expenses (specify nature and amount)',
    columns: [
      { key: 'particulars', label: 'Particulars', type: 'text', col: 'D' },
      { key: 'amount', label: 'Amount', type: 'number', col: 'E' },
    ],
    amountKey: 'amount',
  },
  {
    key: 'plAnyOtherIncome',
    sheet: 'P&L Other Details',
    amountCol: 'B',
    startRow: 3,
    group: 'plDetails',
    title: 'Any other income (specify nature and amount)',
    columns: [
      { key: 'particulars', label: 'Particulars', type: 'text', col: 'A' },
      { key: 'amount', label: 'Amount', type: 'number', col: 'B' },
    ],
    amountKey: 'amount',
  },
  {
    key: 'plOtherExpenses',
    sheet: 'P&L Other Details',
    amountCol: 'E',
    startRow: 3,
    group: 'plDetails',
    title: 'Other expenses (Specify amount and nature)',
    columns: [
      { key: 'particulars', label: 'Particulars', type: 'text', col: 'D' },
      { key: 'amount', label: 'Amount', type: 'number', col: 'E' },
    ],
    amountKey: 'amount',
  },
  {
    key: 'plBadDebtPanAvailable',
    sheet: 'P&L Other Details',
    amountCol: 'I',
    startRow: 3,
    group: 'plDetails',
    title: 'Bad Debt for amount of Rs. 1 lakh or more, where PAN is available',
    columns: [
      { key: 'pan', label: 'PAN of person', type: 'text', col: 'G' },
      { key: 'aadhaar', label: 'AADHAAR of person', type: 'text', col: 'H' },
      { key: 'amount', label: 'Amount', type: 'number', col: 'I' },
    ],
    amountKey: 'amount',
  },
  {
    key: 'plBadDebtPanNotAvailable',
    sheet: 'P&L Other Details',
    amountCol: 'T',
    startRow: 3,
    group: 'plDetails',
    title: 'Bad Debt for amount of Rs. 1 lakh or more, where PAN is not available (provide name and complete address)',
    columns: [
      { key: 'name', label: 'Name of person', type: 'text', col: 'K' },
      { key: 'flatDoorBlock', label: 'Flat/ Door /Block No.', type: 'text', col: 'L' },
      { key: 'premises', label: 'Name of premises/ building/ village', type: 'text', col: 'M' },
      { key: 'road', label: 'Road/ Street/ Post office', type: 'text', col: 'N' },
      { key: 'area', label: 'Area/ Locality', type: 'text', col: 'O' },
      { key: 'town', label: 'Town/ City/ District', type: 'text', col: 'P' },
      { key: 'state', label: 'State', type: 'text', col: 'Q' },
      { key: 'country', label: 'Country', type: 'text', col: 'R' },
      { key: 'pin', label: 'PIN/ZIP Code', type: 'text', col: 'S' },
      { key: 'amount', label: 'Amount', type: 'number', col: 'T' },
    ],
    amountKey: 'amount',
  },
  {
    key: 'plBadDebtOthers',
    sheet: 'P&L Other Details',
    amountCol: 'W',
    startRow: 3,
    group: 'plDetails',
    title: 'Others (amounts less than Rs. 1 lakh)',
    columns: [
      { key: 'particulars', label: 'Particulars', type: 'text', col: 'V' },
      { key: 'amount', label: 'Amount', type: 'number', col: 'W' },
    ],
    amountKey: 'amount',
  },
  {
    key: 'otherReserve',
    sheet: 'Other reserve',
    amountCol: 'B',
    startRow: 2,
    group: 'bsDetails',
    companyOnly: true,
    title: 'Other reserve (specify nature and amount)',
    columns: [
      { key: 'particulars', label: 'Particulars', type: 'text', col: 'A' },
      { key: 'amount', label: 'Amount', type: 'number', col: 'B' },
    ],
    amountKey: 'amount',
  },
]

export function detailsBlockFor(sheet, col) {
  return ITR_DETAILS_BLOCKS.find((b) => b.sheet === sheet && b.amountCol === col)
}
