// Offline check that screen model, HTML (PDF source), Word and Excel carry identical figures (synthetic data only).
//   node tools/selftest-uae-draft-report-model.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { buildDraftReportModel, buildDraftReportHtml, canonicalJson, formatAmount } from '../src/shared/uae-draft-report-model.mjs'
import { buildDraftWordDocument, buildDraftWorkbook } from '../src/main/services/uae-draft-report.js'

const require = createRequire(import.meta.url)
const JSZip = require('jszip')
const ExcelJS = require('exceljs')

let passed = 0
const check = (condition, message) => { assert.ok(condition, message); passed += 1; console.log('PASS', message) }

const pack = {
  id: 'AE_UAE_SEPARATE_FS', version: '0.1-draft', status: 'draft',
  metadata: [{ label: 'Legal name', value: 'Synthetic LLC', confirmed: false }],
  lines: [
    { key: 'cash', label: 'Cash', statement: 'SFP', section: 'Current assets' },
    { key: 'capital', label: 'Share capital', statement: 'SFP', section: 'Equity' },
    { key: 're', label: 'Retained earnings', statement: 'SFP', section: 'Equity' },
    { key: 'payables', label: 'Payables', statement: 'SFP', section: 'Liabilities' },
    { key: 'revenue', label: 'Revenue', statement: 'PL', section: 'Profit or loss' },
    { key: 'costs', label: 'Costs', statement: 'PL', section: 'Profit or loss' },
  ],
}
const row = (id, balance, extra = {}) => ({ id, code: `A${id}`, name: `Ledger ${id}`, balance, status: 'unresolved', suggestedLineKey: null, lineKey: null, references: [], ...extra })
const sug = (id, balance, lineKey) => row(id, balance, { status: 'suggested', suggestedLineKey: lineKey })
const engagement = { id: 99, reference: 'SYN-1', name: 'Synthetic', clientName: 'Synthetic LLC', periodStart: '2024-01-01', periodEnd: '2024-12-31' }
const review = rows => ({ pack, rows, finalVersion: 1, trialBalanceId: 7 })
const rows = [sug(1, -1234567.5, 'cash'), sug(2, 60000, 'capital'), sug(3, 10000, 're'), sug(4, 1500000, 'revenue'), sug(5, -335432.5, 'costs'), row(6, -5000), row(7, 8000), row(8, -3000)]

const model = buildDraftReportModel({ review: review(rows), engagement })
check(model.identity.reference === 'SYN-1' && model.source.finalTbVersion === 1 && model.source.packVersion === '0.1-draft', 'model carries identity, final-TB version and pack version')
check(model.coverage.unresolvedCount === 3 && model.unresolved.length === 3, 'three unresolved accounts listed')
check(model.pending.length > 0 && model.validationEvidence.items.length === 0, 'pending list present; no Interior reference evidence on a non-Interior engagement')
check(canonicalJson(model) === canonicalJson(JSON.parse(JSON.stringify(model))), 'model hash input is stable across JSON round-trip')

// Every non-zero account is counted once across statement lines and placeholders.
const lineAccounts = [...model.sfp, ...model.pl].filter(item => item.accounts).flatMap(item => item.accounts.map(account => account.id))
check(lineAccounts.length === rows.length && new Set(lineAccounts).size === rows.length, 'each ledger appears exactly once in the statements')

// A mapping change produces a different model hash (basis for a new revision) without touching the original model.
const changed = buildDraftReportModel({ review: review(rows.map(item => item.id === 6 ? { ...item, status: 'confirmed', lineKey: 'cash' } : item)), engagement })
check(canonicalJson(changed) !== canonicalJson(model) && changed.coverage.unresolvedCount === 2 && model.coverage.unresolvedCount === 3, 'a mapping correction changes the next model only; the earlier model is unchanged')

const figures = [model.totals.totalAssets, model.totals.totalEquityAndLiabilities, model.totals.profit, model.totals.difference].map(formatAmount)
const html = buildDraftReportHtml(model)
check(figures.every(text => html.includes(text)), 'HTML (PDF source) shows the totals')
check(html.includes('Unclassified debit balances') && html.includes('Action required') && html.includes('0.1-draft') && html.includes('SYN-1'), 'HTML has red placeholders, action label, pack version and identity')

const docBuffer = await buildDraftWordDocument(model)
const zip = await JSZip.loadAsync(docBuffer)
const xml = (await zip.file('word/document.xml').async('string')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
check(figures.every(text => xml.includes(text.replace(/,/g, ',')) || xml.includes(text)), 'Word shows the same totals')
check(/Unclassified debit balances/.test(xml) && /Action required/i.test(xml) && /0\.1-draft/.test(xml), 'Word carries placeholders, warning and pack version')

const wb = new ExcelJS.Workbook()
await wb.xlsx.load(await buildDraftWorkbook(model))
const cells = []
wb.eachSheet(sheet => sheet.eachRow(r => r.eachCell(c => cells.push(c.value))))
const text = cells.map(v => (v && typeof v === 'object' ? (v.richText ? v.richText.map(t => t.text).join('') : String(v.result ?? v.text ?? '')) : String(v ?? ''))).join('|')
const numeric = new Set(cells.filter(v => typeof v === 'number').map(v => Math.round(v * 100) / 100))
check([model.totals.totalAssets, model.totals.totalEquityAndLiabilities, model.totals.profit].every(v => numeric.has(Math.round(v * 100) / 100)), 'Excel holds the same totals as numbers')
check(/Unclassified debit balances/.test(text) && wb.getWorksheet('Ledger detail') && wb.getWorksheet('Checks'), 'Excel has placeholders, ledger detail and checks sheets')

console.log(`\n${passed} checks passed`)
