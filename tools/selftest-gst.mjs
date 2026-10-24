// GST one-net-balance presentation (netGstRows in useFinancials.js).
//   node tools/selftest-gst.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const src = fs.readFileSync(path.join(root, 'src/renderer/src/hooks/useFinancials.js'), 'utf8')
function grab(name) {
  const m = new RegExp('(?:export )?function ' + name + '\\b').exec(src)
  if (!m) throw new Error('cannot find ' + name)
  const rest = src.slice(m.index); const e = /\r?\n\}(?=\r?\n)/g.exec(rest)
  return rest.slice(0, e.index + e[0].length).replace(/^export /, '')
}
const consts = ['GST_LEDGER_RX', 'GST_NOT_BALANCE_RX', 'GST_HOME', 'GST_HOME_L3', 'GST_DR_L5', 'isGstBalanceRow'].map(n => {
  const m = src.match(new RegExp('^(?:export )?const ' + n + ' = [\\s\\S]*?(?=\\n(?:export )?(?:const|function) )', 'm'))
  if (!m) throw new Error('cannot find const ' + n)
  return m[0].replace(/^export /, '')
}).join('\n')
const netGstRows = new Function(consts + '\n' + grab('netGstRows') + '\nreturn netGstRows')()

let fails = 0
const check = (what, got, want) => { const ok = (typeof got === 'number' && typeof want === 'number') ? Math.abs(got - want) < 0.005 : got === want; if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}: ${got}${ok ? '' : '  (expected ' + want + ')'}`) }
const CL = { alie: 'EQUITY AND LIABILITIES', level1: 'Current liabilities', level2: 'Other current liabilities' }
const rows = [
  { ...CL, ledger_name: 'Output CGST',  closing_balance: '30000' },
  { ...CL, ledger_name: 'Output SGST',  closing_balance: '30000' },
  { ...CL, ledger_name: 'Input CGST',   closing_balance: '-25000' },
  { ...CL, ledger_name: 'Input SGST',   closing_balance: '-25000' },
  { ...CL, ledger_name: 'TDS Payable',  closing_balance: '4000' },
  { alie: 'Expenses', level1: 'Other expenses', ledger_name: 'GST Late Fee', closing_balance: '-500' },
  { alie: 'Expenses', level1: 'Other expenses', ledger_name: 'Interest on GST', closing_balance: '-200' },
]
console.log('\nGST net-balance self-test')
let r = netGstRows(rows)
check('four GST balance ledgers picked up', r.summary.count, 4)
check('net is a Cr 10,000', r.summary.net, 10000)
check('side = liability', r.summary.side, 'liability')
check('all GST rows on Statutory dues payable', r.rows.filter(x => x.gst_netted).every(x => x.level3 === 'Statutory dues payable' && x.alie === 'EQUITY AND LIABILITIES'), true)
check('TDS Payable untouched', r.rows.find(x => x.ledger_name === 'TDS Payable').gst_netted, undefined)
check('GST late fee / interest (P&L) untouched', r.rows.filter(x => x.alie === 'Expenses' && x.gst_netted).length, 0)
const rows2 = rows.map(x => x.ledger_name === 'Input CGST' ? { ...x, closing_balance: '-50000' } : x)
r = netGstRows(rows2)
check('net Dr 15,000 → asset', r.summary.side, 'asset')
check('…all GST rows on Balances with government authorities', r.rows.filter(x => x.gst_netted).every(x => /government authorities/.test(x.level3) && x.alie === 'ASSETS'), true)
check('no GST ledgers → summary null', netGstRows([rows[4]]).summary, null)
// A GST-named ledger the CA moved elsewhere by hand (Fix Categorisation sets
// status 'user_override') stays where it was put — it used to be forced back
// into Balances with government authorities on every render.
const moved = { alie: 'ASSETS', level1: 'Non-current assets', level2: 'Other non-current assets', level3: 'Others', mapping3_resultant: 'Others', ledger_name: 'GST NETT', closing_balance: '-123622.5', status: 'user_override' }
r = netGstRows([...rows, moved])
check('GST ledger recategorised by hand stays where the CA put it', r.rows.find(x => x.ledger_name === 'GST NETT').level1, 'Non-current assets')
check('…and is left out of the GST net', r.summary.count, 4)
const confirmed = { ...CL, level3: 'Statutory dues payable', mapping3_resultant: 'Statutory dues payable', ledger_name: 'IGST Payable', closing_balance: '5000', status: 'user_override' }
r = netGstRows([...rows, confirmed])
check('GST ledger confirmed by hand AT a GST home is still netted', r.summary.count, 5)
console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
