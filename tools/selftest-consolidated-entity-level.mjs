/**
 * Pre-release self-test (0.1.109): for an Auditee with branches, General Notes (with the Financial Ratios) and the Cash Flow Statement are
 * the CONSOLIDATED ones - on screen and in the exports - and are not part of a single branch's statements.
 *   node tools/selftest-consolidated-entity-level.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let fails = 0
const ok = (what, cond, d = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + d}`) }
const rd = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8')
console.log('\nConsolidated General Notes / Cash Flow Statement')
const app = rd('src/renderer/src/App.jsx'), fin = rd('src/renderer/src/hooks/useFinancials.js')
ok('General Notes, CFS and the Tax Computation always see the Consolidated TB for an Auditee with branches', /ENTITY_LEVEL_TABS = new Set\(\['General Notes', 'CFS', 'Tax Computation', 'Deferred Tax'\]\)/.test(app) && /if \(isEntityLevelTab\) \{\s*activeTBForDisplay = consolidatedVirtualTB/.test(app))
ok('...and neither is given a Previous Year TB of a branch', (app.match(/\(fsMode === 'consolidated' \|\| isBranchEntity\) \? null : prevTB/g) || []).length === 2)
ok('a single branch\'s statements carry no General Notes and no Cash Flow Statement (so note numbers agree on screen and in the PDF)', /entityLevelHere = !\(entity\?\.has_branches && activeTB\.id !== '__consolidated__'\)/.test(fin) && /fetchGeneralNotes = \(entityLevelHere/.test(fin) && /cfsSaved = \(entityLevelHere/.test(fin))
console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
