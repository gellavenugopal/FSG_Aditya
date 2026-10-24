/**
 * Pre-release self-test: Zoho Books Trial Balance upload.
 *
 * Zoho's export is Debit = POSITIVE / Credit = NEGATIVE with the Assets, Liabilities,
 * Equities, Income and Expense sections, indented sub-accounts and "Total for X" rows.
 * FSG Bharat stores Dr NEGATIVE / Cr POSITIVE with is_deemed_positive by ledger nature.
 * This proves, against a workbook laid out exactly like a real Zoho export:
 *   1. the parser reads sections / indentation / totals / title correctly and skips the
 *      "Total for ..." rows and empty accounts;
 *   2. every balance is sign-flipped, and a ledger's nature comes from its SECTION
 *      (a creditor with a debit balance stays a liability);
 *   3. the integrity checks fire (Total row mismatch, TB out of balance, closing != opening +
 *      Dr - Cr, unknown section, not a Zoho file);
 *   4. the rows go through the REAL mapping engine + the REAL Mapping_v2.xlsx rules and land
 *      sensibly - in particular an Accounts Payable does NOT flip to Assets and a genuine
 *      debit-balance creditor does (a wrong sign flip would do the opposite).
 * If a real Zoho export is found at ZOHO_SAMPLE (or the user's Desktop), it is checked too.
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-zoho-tb.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const esbuild = require(path.join(root, 'node_modules', 'esbuild'))
const XLSX = require(path.join(root, 'node_modules', 'xlsx'))

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + detail}`)
}
const near = (a, b) => Math.abs(a - b) < 0.005

console.log('\nZoho Books Trial Balance upload')

const bundle = async (entry, plugins = []) => {
  const built = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins,
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-zoho-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try { return await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
}

// The in-memory database the mapping engine reads its rules from = the real Mapping_v2.xlsx.
const mwb = XLSX.readFile(path.join(root, 'Mapping_v2.xlsx'))
const sheet = (n) => XLSX.utils.sheet_to_json(mwb.Sheets[n], { defval: null })
const rules = {
  level_format: sheet('LevelFormat').map((r, i) => ({ id: i + 1, constitution: parseInt(r['Constitution']), alie: r['ALIE'], level1: r['Level 1'], level2: r['Level 2'], level3: r['Level 3'], level4: r['Level 4'], level5: r['Level 5'], level6: r['Level 6'], level7: r['Level 7'], sort_order: i })),
  map1: sheet('Map1').map((r, i) => ({ id: i + 1, constitution: parseInt(r['Constitution']), tally_pre_primary: r['Tally Pre-Primary'], mapping1_resultant: r['Mapping1 Resultant'] })),
  map2: sheet('Map2').map((r, i) => ({ id: i + 1, constitution: parseInt(r['Constitution']), keywords: r['Keyword'], mapping2_resultant: r['Mapping2 Resultant'], mapping1_resultant: r['Mapping1 Resultant'], priority: parseInt(r['Priority']) || 1 })),
  map3: sheet('Map3').map((r, i) => ({ id: i + 1, constitution: parseInt(r['Constitution']), keywords: r['Keyword'], mapping1_resultant: r['Mapping1 Resultant'], mapping2_resultant: r['Mapping2 Resultant'], mapping3_resultant: r['Mapping3 Resultant'], priority: parseInt(r['Priority']) || 1 })),
}
let TB_ROWS = []
globalThis.__zohoTestQuery = async (sql, params = []) => {
  const c = params[1]
  if (/FROM tb_rows/i.test(sql)) return { rows: TB_ROWS }
  if (/FROM map1/i.test(sql)) return { rows: rules.map1.filter(r => r.constitution === c) }
  if (/FROM map2/i.test(sql)) return { rows: rules.map2.filter(r => r.constitution === c) }
  if (/FROM map3/i.test(sql)) return { rows: rules.map3.filter(r => r.constitution === c) }
  if (/FROM level_format/i.test(sql)) return { rows: rules.level_format.filter(r => r.constitution === c) }
  return { rows: [] }
}
const dbShim = { name: 'db-shim', setup(b) {
  b.onResolve({ filter: /client\.js$/ }, () => ({ path: 'db-client', namespace: 'shim' }))
  b.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({ contents: 'export const query = (...a) => globalThis.__zohoTestQuery(...a); export const runInTransaction = async (f) => f()', loader: 'js' }))
} }

let parseZohoTB, buildTBRowsFromZoho, runMappingEngine
try {
  ;({ parseZohoTB, buildTBRowsFromZoho } = await bundle(path.join(root, 'src', 'renderer', 'src', 'utils', 'zohoParsers.js')))
  ;({ runMappingEngine } = await bundle(path.join(root, 'src', 'main', 'services', 'mapping-engine.js'), [dbShim]))
} catch (e) {
  ok('parser and mapping engine load', false, e.message)
  console.log(`\n${fails} FAILURE(S)\n`)
  process.exit(1)
}
ok('parser and mapping engine load', true)

// ── A workbook laid out exactly like a Zoho Books export ─────────────────────
// mutate(rowsByName) lets a case tamper with figures before the workbook is written.
function zohoWorkbook({ extraSection = null, dropHeader = false, tamper = () => {} } = {}) {
  const sp = (n) => ' '.repeat(n)
  const lines = []                              // { kind: 'sec'|'acc'|'tot', ... }
  const sec = (name) => lines.push({ kind: 'sec', name })
  const acc = (ind, name, code, o, d, c) => lines.push({ kind: 'acc', ind, name, code, o, d, c })
  const tot = (name, parentName) => lines.push({ kind: 'tot', name, parentName })

  sec('Assets')
  acc(10, 'Accounts Receivable', '', 1000, 500, 0)
  acc(10, 'Employee Advance', '', 0, 0, 0)
  acc(20, 'ED7307\tRiya Singh', '', 0, 90, 0)
  tot('Employee Advance')
  acc(10, 'Inventory Asset', '', 0, 0, 0)
  acc(10, 'Security Deposit', '', 0, 0, 0)
  acc(20, 'Security-A', '', 0, 300, 0)
  acc(20, 'Security-B', '', 0, 100, 0)
  tot('Security Deposit')
  acc(10, 'Sundry Debtors-TDS Receivable', '', -200, 50, 0)
  sec('Liabilities')
  acc(10, 'Accounts Payable', '', -700, 0, 300)
  acc(10, 'Advance Creditor', '', 0, 250, 0)                 // a liability with a DEBIT balance
  acc(10, 'TDS Payable', '', 0, 0, 0)
  acc(20, 'TDS ON Salary', '', -40, 0, 10)
  tot('TDS Payable')
  sec('Equities')
  acc(10, 'Capital Stock', '', 0, 0, 0)
  acc(20, 'Owner A', '', -1000, 0, 0)
  tot('Capital Stock')
  acc(10, 'Retained Earnings', '', 300, 0, 0)                // a DEBIT (deficit) in Equities
  sec('Income')
  acc(10, 'Sales', '', 0, 0, 2000)
  acc(10, 'Discount', '', 0, 0, 30)
  sec('Expense')
  acc(10, 'Rent Expense', '', 0, 400, 0)
  acc(10, 'Salary', '', 0, 0, 0)
  acc(20, 'GROSS SALARY EARNED', '', 0, 1200, 0)
  acc(20, 'DBT Deduction', '', 0, 0, 20)
  tot('Salary')
  acc(10, 'Telephone Expense', '', 0, 205, 0)
  if (extraSection) { sec(extraSection); acc(10, 'Whatever', '', 0, 1, 0) }

  // balance the book with a Bank row so opening/debit/credit all net to zero
  const accs = lines.filter(l => l.kind === 'acc')
  const so = accs.reduce((s, l) => s + l.o, 0), sd = accs.reduce((s, l) => s + l.d, 0), sc = accs.reduce((s, l) => s + l.c, 0)
  const bank = { kind: 'acc', ind: 10, name: 'HDFC Bank', code: 'HDFC0001', o: -so, d: Math.max(0, sc - sd), c: Math.max(0, sd - sc) }
  lines.splice(lines.findIndex(l => l.kind === 'sec' && l.name === 'Liabilities'), 0, bank)
  tamper(lines)

  // "Total for X" rows are computed from the account rows so the file is internally consistent
  const out = [
    ['Acme Traders Pvt Ltd\n            Trial Balance\n            Basis: Accrual\n                        From 01/04/2025 To 31/03/2026'],
    dropHeader ? ['Foo', 'Bar'] : ['Account ', 'Account Code ', 'Opening Balance ', 'Net Debit ', 'Net Credit ', 'Closing Balance '],
    [],
  ]
  for (const l of lines) {
    if (l.kind === 'sec') { out.push([l.name, '', '']); continue }
    if (l.kind === 'acc') { out.push([sp(l.ind) + l.name, l.code, l.o, l.d, l.c, l.o + l.d - l.c]); continue }
    // total: sum of the parent (the last row at indent 10 named parentName) and its sub-accounts
    const idx = out.map(r => String(r[0]).trim()).lastIndexOf(l.name)
    let o = 0, d = 0, c = 0, cl = 0
    for (let k = idx; k < out.length; k++) { o += out[k][2]; d += out[k][3]; c += out[k][4]; cl += out[k][5] }
    out.push([sp(10) + 'Total for ' + l.name, '', o, d, c, cl]); out.push([])
  }
  const all = out.filter(r => r.length >= 6 && typeof r[2] === 'number' && !/^\s*Total for /.test(String(r[0])))
  out.push(['Total for Trial Balance', '', '', all.reduce((s, r) => s + r[3], 0), all.reduce((s, r) => s + r[4], 0), ''])
  const ws = XLSX.utils.aoa_to_sheet(out)
  ws['!merges'] = out.map((r, k) => (r.length === 3 && r[0] && !r[0].startsWith(' ') ? { s: { r: k, c: 2 }, e: { r: k, c: 5 } } : null)).filter(Boolean)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Trial Balance_Raw')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(out), 'Trial Balance_Workedd')   // Zoho users keep a "worked" copy alongside
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

// ── 1. reading the layout ────────────────────────────────────────────────────
const parsed = parseZohoTB(zohoWorkbook())
ok('no warnings on a consistent Zoho file', parsed.warnings.length === 0, JSON.stringify(parsed.warnings))
ok('entity name and period read from the title cell', parsed.entityName === 'Acme Traders Pvt Ltd' && parsed.from === '2025-04-01' && parsed.to === '2026-03-31', `${parsed.entityName} ${parsed.from} ${parsed.to}`)
const names = parsed.rows.map(r => r.name)
ok('"Total for ..." rows and section headings are not imported as ledgers', !names.some(n => /^total for|^assets$|^expense$/i.test(n)), names.join(' | '))
ok('accounts with nothing in them are left out, but counted', !names.includes('Inventory Asset') && parsed.stats.zeroSkipped >= 4, `zeroSkipped=${parsed.stats.zeroSkipped}`)
ok('a tab inside an account name is read as a space', names.includes('ED7307 Riya Singh'))
const byName = (n) => parsed.rows.find(r => r.name === n)
ok('sub-account keeps its parent account', JSON.stringify(byName('Security-A')?.parents) === JSON.stringify(['Security Deposit']), JSON.stringify(byName('Security-A')?.parents))
ok('top-level account has no parent', byName('Sales')?.parents.length === 0)
ok('figures stay in Zoho signs in the parsed rows (Sales Cr = -2000)', byName('Sales')?.closing === -2000 && byName('Accounts Receivable')?.closing === 1500)
ok('Zoho control totals agree (Dr = Cr, Total for Trial Balance)', near(parsed.stats.sumDebit, parsed.stats.sumCredit) && near(parsed.stats.sumDebit, parsed.stats.grandDebit) && near(parsed.stats.sumClosing, 0))

// ── 2. the plus/minus ────────────────────────────────────────────────────────
const built = buildTBRowsFromZoho(parsed, { constitution: 3 })
const row = (n) => built.find(r => r.name === n)
const bal = (n) => Number(row(n).closing_balance)
ok('Debit balance is stored NEGATIVE (Accounts Receivable Dr 1500 -> -1500)', near(bal('Accounts Receivable'), -1500))
ok('opening balance is flipped too (Dr 1000 -> -1000)', near(Number(row('Accounts Receivable').opening_balance), -1000))
ok('Credit balance is stored POSITIVE (Sales Cr 2000 -> +2000)', near(bal('Sales'), 2000))
ok('Credit balance under Assets is stored positive (TDS Receivable Cr 150 -> +150), ledger stays Dr-natured', near(bal('Sundry Debtors-TDS Receivable'), 150) && row('Sundry Debtors-TDS Receivable').is_deemed_positive === true)
ok('Debit balance under Liabilities is stored negative (Advance Creditor Dr 250 -> -250), ledger stays Cr-natured', near(bal('Advance Creditor'), -250) && row('Advance Creditor').is_deemed_positive === false)
ok('Equities deficit (Retained Earnings Dr 300 -> -300), Cr-natured', near(bal('Retained Earnings'), -300) && row('Retained Earnings').is_deemed_positive === false)
ok('Dr-natured sections (Assets, Expense) are is_deemed_positive; Cr-natured (Liabilities, Equities, Income) are not',
  row('Rent Expense').is_deemed_positive === true && row('Accounts Receivable').is_deemed_positive === true &&
  row('Accounts Payable').is_deemed_positive === false && row('Owner A').is_deemed_positive === false && row('Sales').is_deemed_positive === false)
ok('trial_balance_type carries the section (drives ALIE)', row('Accounts Receivable').trial_balance_type === 'Assets' && row('Accounts Payable').trial_balance_type === 'Liabilities' && row('Owner A').trial_balance_type === 'Liabilities' && row('Sales').trial_balance_type === 'Income' && row('Rent Expense').trial_balance_type === 'Expenses')
ok('the whole uploaded Trial Balance still nets to zero after the flip', near(built.reduce((s, r) => s + Number(r.closing_balance), 0), 0) && near(built.reduce((s, r) => s + Number(r.opening_balance), 0), 0))
ok('movements are not signed (net debit / net credit kept as in the file)', row('Rent Expense').debit === 400 && row('Sales').credit === 2000)
const chain = (n) => [row(n).parent, row(n).group_parent, row(n).group_parent_1].join(' > ')
ok('top-level ledger: synthetic group then Primary', chain('Sales') === 'Sales Accounts > Primary > ', chain('Sales'))
ok('sub-account: parent account, group, Primary', chain('GROSS SALARY EARNED') === 'Salary > Indirect Expenses > Primary', chain('GROSS SALARY EARNED'))
ok('Company capital sits under Capital; reserves under Reserves & Surplus', row('Owner A').group_parent === 'Capital' && row('Retained Earnings').parent === 'Reserves & Surplus')
ok('non-corporate capital sits under Capital Account', buildTBRowsFromZoho(parsed, { constitution: 1 }).find(r => r.name === 'Owner A').group_parent === 'Capital Account')

// ── 3. integrity checks ──────────────────────────────────────────────────────
const tampered = (fn) => parseZohoTB(zohoWorkbook({ tamper: fn }))
const w1 = tampered(lines => { const x = lines.find(l => l.name === 'Security-A'); x.d += 5 })   // parent's Total row is computed before? -> tamper after: unbalance instead
ok('an out-of-balance file is flagged', /does not balance|differs from/i.test(w1.warnings.join(' ')), JSON.stringify(w1.warnings))
{
  // break a "Total for ..." row after the workbook is written
  const buf = zohoWorkbook()
  const wb = XLSX.read(buf, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rng = XLSX.utils.decode_range(ws['!ref'])
  for (let r = rng.s.r; r <= rng.e.r; r++) {
    const a = ws[XLSX.utils.encode_cell({ r, c: 0 })]
    if (a && /Total for Security Deposit/.test(a.v)) ws[XLSX.utils.encode_cell({ r, c: 5 })].v = 999999
  }
  const w2 = parseZohoTB(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
  ok('a "Total for X" row that does not equal parent + sub-accounts is flagged', w2.warnings.some(w => /Total for Security Deposit/.test(w)), JSON.stringify(w2.warnings))
}
{
  const buf = zohoWorkbook()
  const wb = XLSX.read(buf, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rng = XLSX.utils.decode_range(ws['!ref'])
  for (let r = rng.s.r; r <= rng.e.r; r++) {
    const a = ws[XLSX.utils.encode_cell({ r, c: 0 })]
    if (a && String(a.v).trim() === 'Rent Expense') ws[XLSX.utils.encode_cell({ r, c: 5 })].v = -400   // sign inverted: closing != opening + dr - cr
  }
  const w3 = parseZohoTB(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
  ok('a row whose closing contradicts opening + debit - credit is flagged (wrong sign convention)', w3.warnings.some(w => /Closing = Opening/.test(w)), JSON.stringify(w3.warnings))
}
let threw = ''
try { parseZohoTB(zohoWorkbook({ extraSection: 'Mystery' })) } catch (e) { threw = e.message }
ok('an unrecognised section heading is an error, not a guess', /unrecognised section/i.test(threw), threw)
threw = ''
try { parseZohoTB(zohoWorkbook({ dropHeader: true })) } catch (e) { threw = e.message }
ok('a workbook without the Zoho header row is rejected with a clear message', /Zoho Books Trial Balance/i.test(threw), threw)

// ── 4. through the real mapping engine ───────────────────────────────────────
async function mapAll(constitution) {
  const rows = buildTBRowsFromZoho(parsed, { constitution })
  TB_ROWS = rows.map((r, i) => ({ id: i + 1, tb_id: 1, ...r, upload_nature: 'Zoho Format' }))
  const res = await runMappingEngine(1, 1, constitution, { excludeZero: true, businessType: 'Service' })
  const byId = new Map(TB_ROWS.map(r => [r.id, r]))
  return new Map(res.map(r => [byId.get(r.tb_row_id).name, r]))
}
const m3 = await mapAll(3)
ok('no ledger is left unmapped', [...m3.values()].every(r => r.status !== 'unmapped'), [...m3.values()].filter(r => r.status === 'unmapped').map(r => r.tb_row_id).join(','))
ok('Sales -> Revenue from operations', m3.get('Sales')?.mapping1_resultant === 'Revenue from operations', JSON.stringify(m3.get('Sales')))
ok('Salary sub-account -> Employee benefits expense (parent account acts as the sub-group)', m3.get('GROSS SALARY EARNED')?.mapping1_resultant === 'Employee benefits expense', JSON.stringify(m3.get('GROSS SALARY EARNED')))
ok('Retained Earnings -> Reserves and surplus (not Share capital)', /reserves and surplus/i.test(m3.get('Retained Earnings')?.mapping2_resultant || ''), JSON.stringify(m3.get('Retained Earnings')))
ok('Accounts Receivable stays on the Assets side as Trade receivables', m3.get('Accounts Receivable')?.alie === 'ASSETS' && /trade receivables/i.test(m3.get('Accounts Receivable')?.mapping2_resultant || ''), JSON.stringify(m3.get('Accounts Receivable')))
ok('Accounts Payable stays on the Liabilities side as Trade payables (a wrong flip would move it to Assets)', m3.get('Accounts Payable')?.alie === 'EQUITY AND LIABILITIES' && /trade payables/i.test(m3.get('Accounts Payable')?.mapping2_resultant || ''), JSON.stringify(m3.get('Accounts Payable')))
ok('a creditor with a genuine DEBIT balance is moved to Assets by the existing abnormal-balance rule', m3.get('Advance Creditor')?.alie === 'ASSETS' && /abnormal/i.test(m3.get('Advance Creditor')?.override_note || ''), JSON.stringify(m3.get('Advance Creditor')))
ok('a debtor-side ledger with a genuine CREDIT balance is moved to Liabilities the same way', m3.get('Sundry Debtors-TDS Receivable')?.alie === 'EQUITY AND LIABILITIES', JSON.stringify(m3.get('Sundry Debtors-TDS Receivable')))
const m1 = await mapAll(1)
ok('Proprietorship / Partnership: every ledger maps and capital goes to Owners\' Funds', [...m1.values()].every(r => r.status !== 'unmapped') && m1.get('Owner A')?.mapping1_resultant === "Owners' Funds", JSON.stringify(m1.get('Owner A')))

// ── 5. a real Zoho export, when one is around ────────────────────────────────
const samplePath = process.env.ZOHO_SAMPLE || path.join(os.homedir(), 'Desktop', 'Trial Balance.xlsx')
if (fs.existsSync(samplePath)) {
  let real = null, err = ''
  try { real = parseZohoTB(fs.readFileSync(samplePath)) } catch (e) { err = e.message }
  if (real && /trial balance/i.test(real.entityName + ' ' + samplePath) && real.stats.ledgerRows > 100) {
    ok(`real export "${path.basename(samplePath)}" parses with no warnings`, real.warnings.length === 0, JSON.stringify(real.warnings))
    ok('...balances to zero and agrees with its own control totals', near(real.stats.sumClosing, 0) && near(real.stats.sumDebit, real.stats.grandDebit) && near(real.stats.sumCredit, real.stats.grandCredit))
    const rb = buildTBRowsFromZoho(real, { constitution: 3 })
    ok('...and still nets to zero after the sign flip', near(rb.reduce((s, r) => s + Number(r.closing_balance), 0), 0))
    TB_ROWS = rb.map((r, i) => ({ id: i + 1, tb_id: 1, ...r, upload_nature: 'Zoho Format' }))
    const rr = await runMappingEngine(1, 1, 3, { excludeZero: true, businessType: 'Service' })
    ok('...every one of its ledgers maps to something', rr.length === rb.length && rr.every(r => r.status !== 'unmapped'))
  } else {
    console.log('  (skipped: the file found is not a recognisable Zoho export' + (err ? ': ' + err : '') + ')')
  }
} else {
  console.log('  (real Zoho export not found here - skipped; set ZOHO_SAMPLE to check one)')
}

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
