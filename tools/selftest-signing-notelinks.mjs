/**
 * Pre-release self-test (0.1.126): (1) a Company's statements in absolute figures carry no auditor's name, in Hundreds / Lakhs / Crores
 * they do; (2) a note number on the Balance Sheet / Profit & Loss always lands on its note.
 *   node tools/selftest-signing-notelinks.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let fails = 0
const ok = (what, cond, d = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + d}`) }
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
console.log('\nAuditor by denomination')
const { auditorForDenomination, isCompany } = await import(pathToFileURL(path.join(root, 'src/renderer/src/utils/signingRules.js')).href)
const aud = { name: 'CA X', firm_name: 'X & Co', frn: '123' }
const co = { constitution: 3 }, firm = { constitution: 2 }, prop = { constitution: 1 }
ok('a Company in As Is: no auditor', auditorForDenomination(co, aud, 'as_is') === null)
ok('a Company in No Decimals: no auditor', auditorForDenomination(co, aud, 'no_dec') === null)
ok('a Company in Hundreds / Lakhs / Crores: the auditor signs', ['hundreds', 'lakhs', 'crores'].every(d => auditorForDenomination(co, aud, d) === aud))
ok('a Partnership and a Proprietorship are not affected, in any denomination', ['as_is', 'no_dec', 'lakhs'].every(d => auditorForDenomination(firm, aud, d) === aud && auditorForDenomination(prop, aud, d) === aud))
ok('a Company is recognised by its constitution or its display name', isCompany({ constitution: 3 }) && isCompany({ constitution_display: 'Company' }) && !isCompany({ constitution: 1 }))
ok('no denomination given means As Is', auditorForDenomination(co, aud, undefined) === null)
const html = read('src/renderer/src/components/GenerateFinancials/buildHTML.js'), xl = read('src/renderer/src/components/GenerateFinancials/buildExcel.js')
ok('the PDF builders (single / consolidated and columnar) apply it', (html.match(/auditorForDenomination\(entity, auditorGiven, denomination\)/g) || []).length === 2)
ok('the Excel builder applies it', xl.includes('auditorForDenomination(entity, auditorGiven, denomination)'))

ok('with no auditor, Place and Date stand under the directors and there is no "as per our report" line (PDF and Excel)',
  html.includes("${auditor ? '' : `<div class=\"sigf-gap\"></div>${dateLine}${placeLine}`}") && html.includes("auditor ? '<div class=\"sigf-note\">As per our report") && xl.includes("if (!auditor) { mgmt.push(dateText); mgmt.push(placeText) }") && xl.includes("if (auditor) rows.push(['As per our report of even date attached.'])"))

console.log('\nNote number links')
const notes = read('src/renderer/src/components/Notes/index.jsx')
ok('the request stays alive while the notes load (no 3-second timer started at once)', !/if \(!highlightNote\) return\s*\n\s*const t = setTimeout\(\(\) => onHighlightClear/.test(notes) && notes.includes('if (!data) return'))
ok('numbers are compared as text (5 and "5" are the same note)', notes.includes('const isHl = (num)') && !/highlightNote === note\.num/.test(notes) && !/highlightNote === generalNoteNum/.test(notes))
ok('a note that is not on the list widens it (empty notes shown, search cleared)', notes.includes('setShowEmpty(true)') && notes.includes("if (search) setSearch('')"))
ok('the page scrolls to the note once it is on the screen, and again after it has settled', notes.includes('getElementById(`note-${wanted}`)') && notes.includes("behavior: 'auto'"))
ok('a number the notes do not carry says so', notes.includes('is not among the notes of this view'))
console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
