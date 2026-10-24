/**
 * Pre-release self-test: PAN on the auditee (0.1.96). Optional; when given, five letters + four digits + one letter.
 *   node tools/selftest-pan.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let fails = 0
const ok = (what, cond, d = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + d}`) }
console.log('\nPAN on the auditee')
const src = fs.readFileSync(path.join(root, 'src/renderer/src/utils/pan.js'), 'utf8').replace(/export const/g, 'const')
const { isValidPan, normalizePan } = new Function(src + '\nreturn { isValidPan, normalizePan }')()
ok('blank is fine (the field is optional)', isValidPan('') && isValidPan(null) && isValidPan(undefined) && isValidPan('   '))
ok('a proper PAN is accepted, typed in capitals or not', isValidPan('ABCDE1234F') && isValidPan('abcde1234f') && isValidPan(' abcde 1234 f '))
for (const bad of ['ABCD1234F', 'ABCDE12345', '1BCDE1234F', 'ABCDE123F4', 'ABCDE1234', 'ABCDE1234FG', 'ABCDEABCDE', '1234512345'])
  ok(`${bad} is refused`, !isValidPan(bad), bad)
ok('typing is tidied: capitals, no spaces or symbols, at most 10 characters', normalizePan(' ab-cde 1234fxyz ') === 'ABCDE1234F')
const tb = fs.readFileSync(path.join(root, 'src/main/ipc/tb.js'), 'utf8')
ok('the save handler checks it too, and stores it', /\[A-Z\]\{5\}\[0-9\]\{4\}\[A-Z\]/.test(tb) && /pan=\$8/.test(tb) && /cin, pan\) VALUES/.test(tb))
const schema = fs.readFileSync(path.join(root, 'src/main/db/schema.js'), 'utf8')
ok('the database column exists', /ALTER TABLE entities ADD COLUMN IF NOT EXISTS pan TEXT/.test(schema))
const form = fs.readFileSync(path.join(root, 'src/renderer/src/components/Master/AuditeeFormModal.jsx'), 'utf8')
ok('the form has the PAN box for every constitution, and sends it', /PAN <span/.test(form) && /pan: normalizePan\(pan\)/.test(form) && !/constitutionDisplay === 'Company' && \(\s*<div>\s*<label[^>]*>PAN/.test(form))
console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
