/**
 * Pre-release self-test: "Pull from Branches" (Consolidated Dep (IT) / Dep
 * (Comp) — see src/renderer/src/utils/depJoin.js and the DepreciationIT/
 * DepreciationComp screens). Sums every branch's own schedule into the
 * Consolidated one: Dep (IT) block-by-block (matched by blockId, entity-
 * scoped so it's a safe join key across branches), Dep (Comp) category-by-
 * category (matched by trimmed/case-folded name, since custom categories
 * are free text with no stable id).
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against
 * that source to prove they fail there (this module did not exist before).
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-dep-join.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = process.env.FSG_SRC_ROOT ? path.resolve(process.env.FSG_SRC_ROOT) : root
const require = createRequire(import.meta.url)
const esbuild = require(path.join(root, 'node_modules', 'esbuild'))

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + detail}`)
}
const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005

async function load(rel) {
  const file = path.join(srcRoot, ...rel.split('/'))
  if (!fs.existsSync(file)) return { __missing: `${rel} does not exist` }
  const built = await esbuild.build({
    stdin: { contents: `export * from ${JSON.stringify(file)}\n`, resolveDir: srcRoot, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    nodePaths: [path.join(root, 'node_modules')],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-depjoin-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  try { return await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
}

const PY_IT = ['openingWDV', 'addBefore180', 'addAfter180', 'deduction', 'stclStcg', 'depreciation', 'closingWDV']
const COMP_FIELDS = ['grossOpen', 'additions', 'deductions', 'grossClose', 'depOpen', 'depForYear', 'depOnDisposal', 'depClose', 'netBlockOpen', 'netBlockClose']

async function main() {
  const mod = await load('src/renderer/src/utils/depJoin.js')
  if (mod.__missing || typeof mod.joinDepITSchedules !== 'function' || typeof mod.joinDepCompSchedules !== 'function') {
    ok('depJoin.js exports joinDepITSchedules and joinDepCompSchedules', false, mod.__missing || 'missing export(s)')
    console.log(fails ? `\n${fails} FAILURE(S)\n` : '\nAll checks passed\n')
    process.exit(1)
  }
  const { joinDepITSchedules, joinDepCompSchedules } = mod

  console.log('\nDep (IT): joining branches block-by-block')
  const branch1IT = {
    rows: {
      'Computer A': { block: 'computers', openingWDV: '100000', addBefore180: '20000', addAfter180: '0', deduction: '0' },
      'Furniture A': { block: 'furniture', openingWDV: '50000', addBefore180: '0', addAfter180: '10000', deduction: '0' },
    },
    pyTotals: { openingWDV: '80000', addBefore180: '', addAfter180: '', deduction: '', stclStcg: '', depreciation: '15000', closingWDV: '65000' },
  }
  const branch2IT = {
    rows: {
      'Computer B': { block: 'computers', openingWDV: '200000', addBefore180: '0', addAfter180: '0', deduction: '5000' },
      'Vehicle A': { block: 'motor-vehicles', openingWDV: '300000', addBefore180: '0', addAfter180: '0', deduction: '0' },
      'Untagged asset (no block yet)': { block: '', openingWDV: '999999', addBefore180: '0', addAfter180: '0', deduction: '0' },
    },
    pyTotals: { openingWDV: '150000', addBefore180: '', addAfter180: '', deduction: '', stclStcg: '', depreciation: '30000', closingWDV: '120000' },
  }
  const { byBlock, pyAgg } = joinDepITSchedules([branch1IT, branch2IT, null, undefined], PY_IT)
  ok('three distinct blocks found (computers, furniture, motor-vehicles)', byBlock.size === 3, String(byBlock.size))
  const computers = byBlock.get('computers')
  ok('computers block: openingWDV summed across both branches (100000+200000)', near(computers?.openingWDV, 300000), String(computers?.openingWDV))
  ok('computers block: addBefore180 only from branch 1 (20000)', near(computers?.addBefore180, 20000), String(computers?.addBefore180))
  ok('computers block: deduction only from branch 2 (5000)', near(computers?.deduction, 5000), String(computers?.deduction))
  const furniture = byBlock.get('furniture')
  ok('furniture block: single-branch figures pass through unchanged', near(furniture?.addAfter180, 10000), String(furniture?.addAfter180))
  ok('a row with no block assigned is ignored, not silently bucketed', !byBlock.has(''), 'byBlock has an empty-string key')
  ok('PY totals summed across branches (openingWDV 80000+150000)', near(pyAgg?.openingWDV, 230000), String(pyAgg?.openingWDV))
  ok('PY totals summed across branches (depreciation 15000+30000)', near(pyAgg?.depreciation, 45000), String(pyAgg?.depreciation))

  const { byBlock: emptyBlocks, pyAgg: emptyPy } = joinDepITSchedules([null, undefined, { rows: {} }], PY_IT)
  ok('no branch has filled anything in -> no blocks, no PY aggregate', emptyBlocks.size === 0 && emptyPy === null,
    `blocks=${emptyBlocks.size} pyAgg=${JSON.stringify(emptyPy)}`)

  console.log('\nDep (Comp): joining branches category-by-category')
  const branch1Comp = {
    categoryRows: [
      { category: 'Plant and Machinery', grossOpen: '500000', additions: '100000', deductions: '0', grossClose: '600000', depOpen: '50000', depForYear: '20000', depOnDisposal: '0', depClose: '70000', netBlockOpen: '450000', netBlockClose: '530000' },
      { category: 'Custom — Solar Panels', grossOpen: '10000', additions: '0', deductions: '0', grossClose: '10000', depOpen: '1000', depForYear: '500', depOnDisposal: '0', depClose: '1500', netBlockOpen: '9000', netBlockClose: '8500' },
    ],
    pyTotals: Object.fromEntries(COMP_FIELDS.map(f => [f, '1000'])),
  }
  const branch2Comp = {
    // Same "Plant and Machinery" category, deliberately different casing and
    // trailing whitespace — must still match branch 1's row, not create a
    // second one.
    categoryRows: [
      { category: '  plant and machinery  ', grossOpen: '300000', additions: '0', deductions: '50000', grossClose: '250000', depOpen: '30000', depForYear: '10000', depOnDisposal: '5000', depClose: '35000', netBlockOpen: '270000', netBlockClose: '215000' },
      { category: 'Furniture and Fixtures', grossOpen: '20000', additions: '0', deductions: '0', grossClose: '20000', depOpen: '2000', depForYear: '1000', depOnDisposal: '0', depClose: '3000', netBlockOpen: '18000', netBlockClose: '17000' },
    ],
    pyTotals: Object.fromEntries(COMP_FIELDS.map(f => [f, '2000'])),
  }
  const { byCategory, pyAgg: compPy } = joinDepCompSchedules([branch1Comp, branch2Comp, null], COMP_FIELDS, COMP_FIELDS)
  ok('three distinct categories found (case/whitespace variants merged)', byCategory.size === 3, String(byCategory.size))
  const pm = byCategory.get('plant and machinery')
  ok('"Plant and Machinery" keeps branch 1\'s original display casing', pm?.category === 'Plant and Machinery', pm?.category)
  ok('"Plant and Machinery" grossOpen summed (500000+300000)', near(pm?.grossOpen, 800000), String(pm?.grossOpen))
  ok('"Plant and Machinery" netBlockClose summed (530000+215000)', near(pm?.netBlockClose, 745000), String(pm?.netBlockClose))
  const solar = byCategory.get('custom — solar panels')
  ok('a custom category present in only one branch is kept, unmerged', near(solar?.grossOpen, 10000), String(solar?.grossOpen))
  ok('Dep (Comp) PY totals summed across branches (1000+2000 per field)', near(compPy?.grossOpen, 3000), String(compPy?.grossOpen))

  console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
  process.exit(fails ? 1 : 0)
}

main()
