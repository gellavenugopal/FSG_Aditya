/**
 * Pre-release self-test (0.1.108): the Short-term borrowings Fill Details table (PDF / Excel) agrees with the note on the
 * "Current maturities of long-term borrowings" - Current Year AND Previous Year.
 *   node tools/selftest-stb-cm-details.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let fails = 0
const ok = (what, cond, d = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + d}`) }
const { withStbCurrentMaturities: w } = await import(pathToFileURL(path.join(root, 'src/renderer/src/utils/stbCurrentMaturities.js')).href)
console.log('\nShort-term borrowings details: current maturities')
const cm = { name: 'Current maturities of long-term borrowings', closing_balance: 819009.28, opening_balance: 727050.56, injected: 'current-maturities' }
const note = { title: 'Short-term borrowings', rows: [cm] }
const sum = (d, k) => d.loans.reduce((s, l) => s + (parseFloat(l[k]) || 0), 0)
const base = [{ lenderPrintName: 'Axis OD', grossCY: 310905.4, grossPY: 1858588.4 }, { lenderPrintName: 'Current Maturity of Term Loan', grossCY: 819009.28, grossPY: 0 }]
const a = w({ loans: base }, note)
ok('the saved row for the current maturities gets its missing Previous Year figure (the case on screen)', a.loans[1].grossPY === 727050.56 && a.loans.length === 2, JSON.stringify(a.loans[1]))
ok('...and the table total now agrees with the note (CY and PY)', Math.abs(sum(a, 'grossCY') - 1129914.68) < 0.01 && Math.abs(sum(a, 'grossPY') - 2585638.96) < 0.01)
ok('the saved loans are not altered in place', base[1].grossPY === 0)
const b = w({ loans: [base[0]] }, note)
ok('no such row saved: one is added with both years', b.loans.length === 2 && b.loans[1].grossCY === 819009.28 && b.loans[1].grossPY === 727050.56, JSON.stringify(b.loans))
const done = { loans: [base[0], { ...base[1], grossPY: 727050.56 }] }
ok('a row that already has both years is left alone (same object)', w(done, note) === done)
const plain = { loans: base }
ok('a note without current maturities is untouched', w(plain, { title: 'Short-term borrowings', rows: [] }) === plain)
ok('another note is untouched', w(plain, { title: 'Long-term borrowings', rows: [cm] }) === plain)
ok('no details: returned as given', w(null, note) === null)
const h = fs.readFileSync(path.join(root, 'src/renderer/src/components/GenerateFinancials/buildHTML.js'), 'utf8')
const x = fs.readFileSync(path.join(root, 'src/renderer/src/components/GenerateFinancials/buildExcel.js'), 'utf8')
ok('the PDF and the Excel both use it', /renderNoteDetails\(note\.title, withStbCurrentMaturities\(details, note\)/.test(h) && (x.match(/withStbCurrentMaturities\(noteDetailsMap\[note\.num\], note\)/g) || []).length === 2)
console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
