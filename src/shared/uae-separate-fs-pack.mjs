// Draft, versioned UAE separate-financial-statements pack. Not processing-ready: it only
// defines statement lines and classification rules used by the mapping review screen.
// Reference totals are validation targets and are never inputs to any balance.

const PACK_ID = 'AE_UAE_SEPARATE_FS'
const PACK_VERSION = '0.1-draft'

const LINES = [
  { key: 'ppe_cost', label: 'Property and equipment - cost', statement: 'SFP', section: 'Non-current assets' },
  { key: 'ppe_accumulated_depreciation', label: 'Property and equipment - accumulated depreciation', statement: 'SFP', section: 'Non-current assets' },
  { key: 'rou_asset_cost', label: 'Right-of-use asset - cost', statement: 'SFP', section: 'Non-current assets' },
  { key: 'rou_asset_accumulated_depreciation', label: 'Right-of-use asset - accumulated depreciation', statement: 'SFP', section: 'Non-current assets' },
  { key: 'investment_in_subsidiary', label: 'Investment in subsidiary (at cost)', statement: 'SFP', section: 'Non-current assets' },
  { key: 'advance_capital_expenditure', label: 'Advance for capital expenditure', statement: 'SFP', section: 'Non-current assets' },
  { key: 'contract_receivables', label: 'Contract receivables', statement: 'SFP', section: 'Current assets' },
  { key: 'retentions_receivable', label: 'Retentions receivable', statement: 'SFP', section: 'Current assets' },
  { key: 'contract_assets', label: 'Amounts due from customers for contracts', statement: 'SFP', section: 'Current assets' },
  { key: 'allowance_credit_losses', label: 'Provision for bad debts', statement: 'SFP', section: 'Current assets' },
  { key: 'other_receivables_prepayments', label: 'Advances, deposits, prepayments and other receivables', statement: 'SFP', section: 'Current assets' },
  { key: 'due_from_related_parties', label: 'Due from related parties', statement: 'SFP', section: 'Current assets' },
  { key: 'other_current_financial_assets', label: 'Other current financial assets', statement: 'SFP', section: 'Current assets' },
  { key: 'cash_and_bank', label: 'Cash and cash equivalents', statement: 'SFP', section: 'Current assets' },
  { key: 'share_capital', label: 'Share capital', statement: 'SFP', section: 'Equity' },
  { key: 'statutory_reserve', label: 'Statutory reserve', statement: 'SFP', section: 'Equity' },
  { key: 'retained_earnings', label: 'Retained earnings / (accumulated losses)', statement: 'SFP', section: 'Equity' },
  { key: 'borrowings', label: 'Borrowings', statement: 'SFP', section: 'Liabilities' },
  { key: 'lease_liabilities', label: 'Lease liabilities', statement: 'SFP', section: 'Liabilities' },
  { key: 'employee_end_of_service', label: "Provision for employees' end of service benefits", statement: 'SFP', section: 'Liabilities' },
  { key: 'trade_payables', label: 'Trade payables and accruals', statement: 'SFP', section: 'Liabilities' },
  { key: 'contract_liabilities', label: 'Advances and amounts due to contract customers', statement: 'SFP', section: 'Liabilities' },
  { key: 'retentions_payable', label: 'Retentions payable', statement: 'SFP', section: 'Liabilities' },
  { key: 'other_payables', label: 'Other payables and VAT payable', statement: 'SFP', section: 'Liabilities' },
  { key: 'due_to_related_parties', label: 'Due to related parties', statement: 'SFP', section: 'Liabilities' },
  { key: 'loans_from_related_parties', label: 'Loans from related parties', statement: 'SFP', section: 'Liabilities' },
  { key: 'tax_payable', label: 'Provision for tax', statement: 'SFP', section: 'Liabilities' },
  { key: 'revenue', label: 'Revenue', statement: 'PL', section: 'Profit or loss' },
  { key: 'contract_costs', label: 'Contract costs', statement: 'PL', section: 'Profit or loss' },
  { key: 'contract_costs_employee', label: 'Contract costs - employee costs', statement: 'PL', section: 'Profit or loss' },
  { key: 'other_income', label: 'Other income', statement: 'PL', section: 'Profit or loss' },
  { key: 'administrative_selling_expenses', label: 'Administrative and selling expenses', statement: 'PL', section: 'Profit or loss' },
  { key: 'employee_costs', label: 'Employee costs', statement: 'PL', section: 'Profit or loss' },
  { key: 'directors_remuneration', label: "Directors' remuneration", statement: 'PL', section: 'Profit or loss' },
  { key: 'finance_costs', label: 'Finance costs', statement: 'PL', section: 'Profit or loss' },
  { key: 'finance_costs_lease', label: 'Finance costs - lease liabilities', statement: 'PL', section: 'Profit or loss' },
  { key: 'tax_expense', label: 'Tax expense', statement: 'PL', section: 'Profit or loss' },
]

// Matching is exact on normalised (trimmed, case-folded, whitespace-collapsed) labels.
// Similar-looking labels are listed separately and deliberately; classifications without
// a rule stay unresolved. "main|sub" rules take precedence over "main" rules.
const RULES = [
  ['property and equipment', 'ppe_cost'],
  ['accumulated depreciation', 'ppe_accumulated_depreciation'],
  ['right of use asset|right-of-use asset-cost', 'rou_asset_cost'],
  ['right of use asset|acc. depreciation rou', 'rou_asset_accumulated_depreciation'],
  ['investment in subsidiary', 'investment_in_subsidiary'],
  ['adv for capital exp', 'advance_capital_expenditure'],
  ['contract and other receivables|contract receivables', 'contract_receivables'],
  ['contract and other receivables|retentions receivable', 'retentions_receivable'],
  ['contract and other receivables|amounts due from customers for contracts', 'contract_assets'],
  ['contract and other receivables|provision for bad debts', 'allowance_credit_losses'],
  ['contract and other receivables|advance to employees', 'other_receivables_prepayments'],
  ['contract and other receivables|advance to suppliers and sub-contractors', 'other_receivables_prepayments'],
  ['contract and other receivables|prepayments', 'other_receivables_prepayments'],
  ['contract and other receivables|refundable deposits', 'other_receivables_prepayments'],
  ['due from related parties', 'due_from_related_parties'],
  ['other current financial assets', 'other_current_financial_assets'],
  ['cash and cash equivalents', 'cash_and_bank'],
  ['share capital', 'share_capital'],
  ['statutory reserve', 'statutory_reserve'],
  ['retained earnings', 'retained_earnings'],
  ['borrowings', 'borrowings'],
  ['lease liability', 'lease_liabilities'],
  ["provision for employees' end of service benefits", 'employee_end_of_service'],
  ['trade and other payables|trade payables', 'trade_payables'],
  ['trade and other payables|accrued expenses', 'trade_payables'],
  ['trade and other payables|advance from customers', 'contract_liabilities'],
  ['trade and other payables|due to contract customers', 'contract_liabilities'],
  ['trade and other payables|retention payables', 'retentions_payable'],
  ['trade and other payables|other payables', 'other_payables'],
  ['trade and other payables|value added tax payable', 'other_payables'],
  ['due to related party', 'loans_from_related_parties'],
  ['due to related parties', 'due_to_related_parties'],
  ['ct', 'tax_payable'],
  ['revenue', 'revenue'],
  ['contract costs|employee costs', 'contract_costs_employee'],
  ['contract costs', 'contract_costs'],
  ['other income', 'other_income'],
  ['administrative and selling expenses', 'administrative_selling_expenses'],
  ['employee costs', 'employee_costs'],
  ["directors' remuneration", 'directors_remuneration'],
  ['interest expenses - lease liabilities', 'finance_costs_lease'],
  ['other finance costs', 'finance_costs'],
  ['tax expense', 'tax_expense'],
]

// Classifications deliberately left without a rule; the reviewer must decide.
const DELIBERATELY_UNRULED = [
  "shareholders' current account (shareholders' dividend): dividend versus current-account nature is not established",
  'trade and other payables | loan from a third party: borrowing versus payable is not established',
]

const VALIDATION_ITEMS = [
  {
    key: 'receivables_difference',
    title: 'Contract and other receivables: 2024 comparative difference',
    detail: 'Reference 2024 comparative 58,066,770 against the Interior final TB classification aggregate 58,023,610 (difference 43,160). Cause not established.',
    status: 'unresolved',
  },
  {
    key: 'contract_cost_difference',
    title: 'Contract costs: 2024 comparative difference',
    detail: 'Reference 2024 comparative 151,281,564 against the "CONTRACT COSTS" classification aggregate 152,538,865 plus a separately labelled 1,126 and unmapped balances. Not yet comparable.',
    status: 'unresolved',
  },
  {
    key: 'rounding_9363_10',
    title: 'Rounding difference AED 1 - account 9363-10',
    detail: 'App final balance 471,921 against workbook Final 471,920. Documented; treatment awaiting confirmation. No balancing journal.',
    status: 'documented',
  },
  {
    key: 'rounding_tb_round_off',
    title: 'Rounding difference AED 1 - "TB round off"',
    detail: 'App final balance -7 against workbook Final -6. Documented; treatment awaiting confirmation. No balancing journal.',
    status: 'documented',
  },
]

const METADATA = [
  { key: 'legal_name', label: 'Legal entity name', value: 'Not confirmed: workbook headers say "INC INTERIORS LLC"; the reference documents say "Interiors L.L.C".', confirmed: false },
  { key: 'framework', label: 'Reporting framework', value: 'IFRS Accounting Standards, separate financial statements (IAS 27) - taken from reference notes, not confirmed for the engagement.', confirmed: false },
  { key: 'currency', label: 'Currency', value: 'AED - assumed, not stated in the 2024 workbook.', confirmed: false },
]

function normaliseLabel(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

const RULE_MAP = new Map(RULES.map(([key, line]) => [key, line]))
const LINE_KEYS = new Set(LINES.map(line => line.key))

function lineForClassification(main, sub) {
  const m = normaliseLabel(main)
  const s = normaliseLabel(sub)
  if (!m) return null
  return RULE_MAP.get(`${m}|${s}`) || RULE_MAP.get(m) || null
}

function getPackDefinition() {
  return {
    id: PACK_ID, version: PACK_VERSION, status: 'draft', lines: LINES,
    deliberatelyUnruled: DELIBERATELY_UNRULED, validationItems: VALIDATION_ITEMS, metadata: METADATA,
  }
}

export { PACK_ID, PACK_VERSION, LINE_KEYS, normaliseLabel, lineForClassification, getPackDefinition }
