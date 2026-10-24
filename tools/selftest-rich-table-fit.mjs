/**
 * Pre-release self-test: General Notes tables in the PDF (0.1.94). The Financial Ratios table (8 columns) and the Remarks-on-ratios table
 * (3 columns) printed with the screen's pixel widths: words split mid-way ("Denominato|r", "75,30,546.5|9") and the Ratio / Variance columns
 * as wide as the Comments. Columns are now sized from their content. Runs the real fitRichTextTables from buildHTML.js.
 *   node tools/selftest-rich-table-fit.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const src = fs.readFileSync(path.join(root, 'src/renderer/src/components/GenerateFinancials/buildHTML.js'), 'utf8').replace(/\r\n/g, '\n')
const a = src.indexOf('export function contentColumnWidths'), b = src.indexOf('// Runs INSIDE the PDF window')
let fails = 0
const ok = (what, cond, d = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + d}`) }
console.log('\nGeneral Notes tables in the PDF')
if (a < 0 || b < a) { ok('the table-fit code is there', false); process.exit(1) }
const { fitRichTextTables } = new Function(src.slice(a, b).replace(/export function/g, 'function') + '\nreturn { fitRichTextTables }')()
const cell = (t, tag) => `<${tag}><p>${t}</p></${tag}>`
const table = (rows, colPx, extra = '') => `<table style="width: ${colPx * rows[0].length}px"><colgroup>${rows[0].map(() => `<col style="width: ${colPx}px">`).join('')}</colgroup><tbody>${rows.map((r, i) => `<tr>${r.map(x => cell(x, i ? 'td' : 'th')).join('')}</tr>`).join('')}</tbody></table>`
const widths = (html) => [...html.matchAll(/<col style="width: ([\d.]+)%">/g)].map(m => parseFloat(m[1]))
const mm = 180
const ratio = [['Particulars', 'Numerator', 'Numerator Value', 'Denominator', 'Denominator Value', 'Current Year', 'Previous Year', 'Variance %'],
  ['Trade Receivables Turnover Ratio', 'Net Credit Sales', '75,30,546.59', 'Average Trade Receivable', '45,871.95', '0.00', '0.00', '0.00'],
  ['Current Ratio', 'Current Assets', '5,94,027.39', 'Current Liabilities', '22,039.43', '26.95', '3.55', '658.46%']]
const fitted = fitRichTextTables(table(ratio, 140))
const w = widths(fitted)
const pt = parseFloat((/font-size:\s*([\d.]+)pt/.exec(fitted) || [0, 10])[1]), charMm = pt * 0.3528 * 0.6   // average bold glyph ~0.6 em
ok('ratios: text steps down to fit but stays readable (8-10pt)', pt >= 8 && pt <= 10, pt)
ok('ratios: one width per column, adding to 100%', w.length === 8 && Math.abs(w.reduce((x, y) => x + y, 0) - 100) < 0.2, JSON.stringify(w))
const need = ratio[0].map((_, c) => Math.max(...ratio.map(r => Math.max(...r[c].split(' ').map(x => x.length)))) * charMm + 3)
ok('ratios: every column is wide enough for its longest word (no word split)', w.every((p, i) => p / 100 * mm >= need[i]), JSON.stringify(w.map((p, i) => [Math.round(p / 100 * mm), Math.round(need[i])])))
const rem = [['Ratio', 'Variance', 'Comments'], ['Current Ratio', '658.46%', 'The increase is mainly due to growth in current assets, chiefly cash and bank balances and other current assets, from profits retained during the year. Current liabilities did not rise in proportion.']]
const w3 = widths(fitRichTextTables(table(rem, 300)))
ok('remarks: Comments takes most of the page, Ratio and Variance stay narrow', w3.length === 3 && w3[2] > 60 && w3[0] < 20 && w3[1] < 15, JSON.stringify(w3))
const html = fitRichTextTables(table(rem, 300))
ok('the pixel width of the table is gone (it cannot push the page wider)', !/width:\s*\d+px/.test(html), html.slice(0, 120))
const merged = '<table><colgroup><col style="width: 100px"><col style="width: 300px"></colgroup><tbody><tr><th colspan="2">Heading</th></tr><tr><td>a</td><td>b</td></tr></tbody></table>'
const wm = widths(fitRichTextTables(merged))
ok('a table with merged cells keeps the proportions of the screen (25 / 75)', wm.length === 2 && Math.abs(wm[0] - 25) < 0.1 && Math.abs(wm[1] - 75) < 0.1, JSON.stringify(wm))
console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
