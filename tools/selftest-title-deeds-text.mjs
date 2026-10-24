/**
 * Pre-release self-test: General Notes (Company), "Title Deeds of Immovable Property" (0.1.104). The standard wording is now
 * "The Company does not hold any title deeds of immovable property which is not in its own name."; a saved note still holding the OLD
 * standard wording, word for word, is brought up to it (screen and PDF / Excel); a point the CA edited is left alone.
 *   node tools/selftest-title-deeds-text.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let fails = 0
const ok = (what, cond, d = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + d}`) }
console.log('\nTitle deeds wording')
const rd = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8')
const util = rd('src/renderer/src/utils/generalNoteText.js').replace(/export const/g, 'const').replace(/export function/g, 'function')
const { withCurrentTitleDeedsText, TITLE_DEEDS_OLD, TITLE_DEEDS_NEW, GN_TITLE_OLD, GN_TITLE_COMPANY } = new Function(util + '\nreturn { withCurrentTitleDeedsText, TITLE_DEEDS_OLD, TITLE_DEEDS_NEW, GN_TITLE_OLD, GN_TITLE_COMPANY }')()
const note = (html, header = 'Title Deeds of Immovable Property') => ({ title: GN_TITLE_COMPANY, points: [{ id: 1, header: 'Other', contentHtml: '<p>x</p>' }, { id: 2, header, contentHtml: html }] })
const text = (n) => n.points[1].contentHtml.replace(/<[^>]*>/g, '')
ok('the new wording is the one asked for', TITLE_DEEDS_NEW === 'The Company does not hold any title deeds of immovable property which is not in its own name.')
ok('a saved point on the old standard wording takes the new one', text(withCurrentTitleDeedsText(note(`<p>${TITLE_DEEDS_OLD}</p>`))) === TITLE_DEEDS_NEW)
ok('...also when the editor wrapped it differently (extra tags, spaces)', text(withCurrentTitleDeedsText(note(`<p><span>${TITLE_DEEDS_OLD}</span>&nbsp;</p>`))) === TITLE_DEEDS_NEW)
const edited = note('<p>The Company holds title deeds of a building in the name of its former director.</p>')
ok('a point the CA edited is left exactly as it is', withCurrentTitleDeedsText(edited) === edited)
const current = note(`<p>${TITLE_DEEDS_NEW}</p>`)
ok('a point already on the new wording is not touched (same object, so nothing is saved again)', withCurrentTitleDeedsText(current) === current)
const other = note(`<p>${TITLE_DEEDS_OLD}</p>`, 'Benami Property')
ok('only the Title Deeds point is changed', withCurrentTitleDeedsText(other) === other)
ok('no note / no points: returned as given', withCurrentTitleDeedsText(null) === null && withCurrentTitleDeedsText({}).points === undefined)
const gn = rd('src/renderer/src/components/GeneralNotes/index.jsx'), fin = rd('src/renderer/src/hooks/useFinancials.js')
ok('the default Company template carries the new wording and no longer the old', gn.includes('which is not in its own name.') && !gn.includes('immovable property in its own name.'))
ok('the screen and the PDF / Excel data both bring an old saved point up to date', /withCurrentTitleDeedsText\(clean\)/.test(gn) && /withCurrentTitleDeedsText\(processed\.generalNotes\)/.test(fin))
ok('a Company note headed with the old plain title takes "Significant Accounting Policies & Additional Regulatory Information"', withCurrentTitleDeedsText({ title: GN_TITLE_OLD, points: [] }).title === 'Significant Accounting Policies & Additional Regulatory Information')
ok('a title the CA changed is left alone', withCurrentTitleDeedsText({ title: 'Our policies', points: [] }).title === 'Our policies')
ok('the default title on screen for a Company is the new one', /defaultTitleFor = \(entity\) => \(entityNouns\(entity\)\.isCompany \? GN_TITLE_COMPANY : GN_TITLE_OLD\)/.test(gn))
console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
