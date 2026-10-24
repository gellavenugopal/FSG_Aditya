import assert from 'node:assert/strict'
import XLSX from 'xlsx-js-style'
import { buildTBTemplateWorkbook, generateTBTemplate, parseTBExcel } from '../src/main/services/tb-template.js'

const wb = buildTBTemplateWorkbook()
assert.deepEqual(wb.SheetNames, ['Read Me', 'Trial Balance'])

const trialBalance = wb.Sheets['Trial Balance']
const headers = XLSX.utils.sheet_to_json(trialBalance, { header: 1 })[0]
const required = ['Name *', 'OpeningBalance *', 'Debit *', 'Credit *', 'ClosingBalance *']
for (const header of required) {
  const column = headers.indexOf(header)
  assert.notEqual(column, -1, `Missing required marker: ${header}`)
  const cell = trialBalance[XLSX.utils.encode_cell({ r: 0, c: column })]
  assert.equal(cell.s.font.color.rgb, 'B91C1C', `${header} should be red`)
}

const readMeRows = XLSX.utils.sheet_to_json(wb.Sheets['Read Me'], { header: 1, defval: '' })
assert.ok(readMeRows.some(row => row[0] === 'Field' && row[1] === 'Required'))
assert.ok(readMeRows.some(row => row[3] === 'Cash in Hand' && row[7] === -10500))

XLSX.utils.sheet_add_aoa(trialBalance, [[
  '2025-26', 'Head Office', '1001', 'Cash in Hand',
  0, 10500, 0, -10500, false, true, 0,
  'Current Assets', 'Current Assets', 'Primary'
]], { origin: 'A2' })
const imported = parseTBExcel(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
assert.equal(imported.length, 1)
assert.equal(imported[0].name, 'Cash in Hand')
assert.equal(imported[0].opening_balance, 0)
assert.equal(imported[0].debit, 10500)
assert.equal(imported[0].closing_balance, -10500)

assert.ok(generateTBTemplate().length > 0)
console.log('PASS: Read Me content, required red headers, and Trial Balance import round-trip')
