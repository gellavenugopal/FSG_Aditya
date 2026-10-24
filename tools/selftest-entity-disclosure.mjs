/**
 * Pre-release self-test (0.1.116): the Disclosure Note under a note is saved and printed in the Consolidated view of a branch entity too
 * (it used to be tried against the virtual '__consolidated__' Trial Balance, which cannot hold it, and the Consolidated PDF / Excel never
 * printed any).
 *   node tools/selftest-entity-disclosure.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let fails = 0
const ok = (what, cond, d = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + d}`) }
const rd = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8')
console.log('\nDisclosure notes in the Consolidated view')
const schema = rd('src/main/db/schema.js'), store = rd('src/main/db/noteStore.js'), ipc = rd('src/main/ipc/masters.js'), pre = rd('src/preload/index.js')
const notes = rd('src/renderer/src/components/Notes/index.jsx'), gen = rd('src/renderer/src/components/GenerateFinancials/index.jsx')
ok('a table holds the Auditee-level disclosure notes, one per note number, removed with the Auditee', /CREATE TABLE IF NOT EXISTS entity_note_disclosures/.test(schema) && /entity_id  INTEGER NOT NULL REFERENCES entities\(id\) ON DELETE CASCADE/.test(schema) && /UNIQUE\(entity_id, note_num\)/.test(schema))
ok('it is read and written by note title, like every other saved note', /entity_note_disclosures: \{ scope: 'entity_id', value: 'text' \}/.test(store))
ok('get / save / list are registered and exposed', ipc.includes("'entityNoteDisclosure:get'") && ipc.includes("'entityNoteDisclosure:save'") && ipc.includes("'entityNoteDisclosure:list'") && pre.includes('getEntityNoteDisclosure') && pre.includes('saveEntityNoteDisclosure') && pre.includes('listEntityNoteDisclosures'))
ok('the Notes screen saves a Consolidated note against the Auditee, and says when it could not save', notes.includes("const entityLevel = tbId === '__consolidated__'") && notes.includes('saveEntityNoteDisclosure') && notes.includes('Could not save this disclosure'))
ok('the Consolidated PDF and Excel both carry the disclosure notes', (gen.match(/listEntityNoteDisclosures\?\.\(entity\.id\)/g) || []).length === 2 && (gen.match(/denomination: denom, noteDetailsMap, noteDisclosureMap/g) || []).length >= 4)
ok('the single Trial Balance path is as it was', notes.includes('window.api?.saveNoteDisclosure({ tbId: scopeId') && gen.includes('listNoteDisclosures(singleTBForExport?.id)'))
console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
