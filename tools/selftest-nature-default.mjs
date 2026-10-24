/**
 * Pre-release self-test (0.1.127): wherever a ledger's nature is chosen among Secured / Unsecured / Doubtful, it defaults to
 * "Unsecured, considered good" - every constitution.
 *   node tools/selftest-nature-default.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let fails = 0
const ok = (what, cond, d = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + d}`) }
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
console.log('\nNature default: Unsecured, considered good')
const eng = read('src/main/services/mapping-engine.js')
ok('mapping engine: a head with Secured / Unsecured / Doubtful alternates (not only Trade receivables) defaults to Unsecured, considered good',
  eng.includes('Any other head offering "Secured, considered good / Unsecured, considered good / Doubtful"') && /UNSEC\s*=\s*\/unsecured\.\*considered/.test(eng) && eng.includes("pickAssumptionDefault(lfRow.level3, 'general')") && eng.includes("pickAssumptionDefault(lfRow.level5, 'general')"))
ok('...a Mapping 3 / Level 5 the ledger name already settled is not overwritten', eng.includes('const open = (v) => !v || String(v).includes(\'/\')'))
ok('...the Trade receivables / payables rules are as before', eng.includes("kind === 'receivable'") && eng.includes("kind === 'payable'") && eng.includes("result.override_note = 'On assumption'"))
const notes = read('src/renderer/src/components/Notes/index.jsx')
ok("Notes: the Trade Receivables suggestion is 'Unsecured, Considered Good'", /label: 'Trade Receivables',\s*\n\s*defaultNature: 'Unsecured, Considered Good'/.test(notes))
const ov = read('src/renderer/src/components/MappedTB/OverrideModal.jsx')
ok('Override Mapping: Mapping 3 and Levels 4-7 open on Unsecured, considered good when it is among the choices', ov.includes('defaultsFor') && ov.includes('setM3(d)') && ov.includes('setL5(d)') && ov.includes('unsecured.*considered'))
const je = read('src/renderer/src/components/TrialBalance/JournalEntryPage.jsx')
ok('Journal Entry: Mapping 3 opens on it as well', je.includes('Mapping 3 opens on "Unsecured, considered good"') && je.includes('unsecured.*considered'))
console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
