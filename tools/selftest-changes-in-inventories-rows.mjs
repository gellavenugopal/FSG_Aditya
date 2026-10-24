/**
 * Pre-release self-test (0.1.111): the P&L note "Changes in inventories of finished goods, WIP and Stock-in-Trade" has the Opening and the
 * Less: Closing rows and its Total - no third "Change in Inventory of ..." row repeating the Total.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let fails = 0
const ok = (what, cond, d = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + d}`) }
console.log('\nChanges in inventories note rows')
const src = fs.readFileSync(path.join(root, 'src/renderer/src/hooks/useFinancials.js'), 'utf8')
const i = src.indexOf('const WIP_LABEL = split.changeIncludesRaw')
const block = src.slice(i, i + 2200)
ok('the note builds an Opening row and a Less: Closing row', i > 0 && /level2: `Opening Value of \$\{WIP_LABEL\}`/.test(block) && /level2: `Less: Closing Value of \$\{WIP_LABEL\}`/.test(block))
ok('...and no "Change in Inventory of" row (its figure is the Total)', !/level2: `Change in Inventory of/.test(block))
ok('the note total is still the net change (opening less closing)', /n\.total = split\.otherStockDelta\.cy/.test(block))
console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
