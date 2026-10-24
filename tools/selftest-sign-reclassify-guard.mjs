/**
 * Pre-release self-test: the Trade Payables/Receivables sign-based
 * reclassification in schema.js's ensureSchema() ("Dr-balance Creditor ->
 * Advance to Suppliers", "Cr-balance Debtor -> Advance from Customers") must
 * (1) run at most ONCE per database -- it is a retroactive backfill for
 * entities mapped before this feature existed, not an ongoing enforcement
 * pass (that already lives in mapping-engine.js, protected by
 * mappedTB:run's snapshot/applyCarryForward) -- and (2) even on that one
 * run, never touch a row the CA has already decided on (status
 * 'user_override'/'user_approved' -- which is exactly what a manual
 * re-categorisation OR an applied learned ledger rule sets).
 *
 * Before this fix, this block ran unconditionally on every ensureSchema()
 * call (every app launch) with no status check at all, silently re-flipping
 * a credit-balance Trade Receivable (or debit-balance Trade Payable) a CA
 * had deliberately re-categorised back to Advance from Customers/Suppliers
 * the next time the app happened to restart.
 *
 * Extracts just the guarded block (not the whole multi-hundred-line
 * ensureSchema()) and runs it against a mock tryClaimMigration()/query(), so
 * this stays robust to unrelated changes elsewhere in ensureSchema().
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against
 * that source to prove they fail there (this guard did not exist before).
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-sign-reclassify-guard.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = process.env.FSG_SRC_ROOT ? path.resolve(process.env.FSG_SRC_ROOT) : root

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + detail}`)
}

console.log('\nTrade Payables/Receivables sign-reclassification: runs once, respects status')

const file = path.join(srcRoot, 'src', 'main', 'db', 'schema.js')
if (!fs.existsSync(file)) {
  ok('schema.js exists', false, `${file} does not exist`)
  console.log(fails ? `\n${fails} FAILURE(S)\n` : '\nAll checks passed\n')
  process.exit(1)
}
const src = fs.readFileSync(file, 'utf8')

const START_MARKER = `if (await tryClaimMigration('trade_payables_receivables_sign_reclassify_once')) {`
const startIdx = src.indexOf(START_MARKER)
if (startIdx === -1) {
  ok('ensureSchema() guards the sign-reclassification behind tryClaimMigration', false,
    'marker not found -- this guard does not exist in this source')
  console.log(fails ? `\n${fails} FAILURE(S)\n` : '\nAll checks passed\n')
  process.exit(1)
}
ok('ensureSchema() guards the sign-reclassification behind tryClaimMigration', true)

// Find the matching closing brace by simple depth counting from the opening
// '{' of the if-block (the block's own content has no other top-level braces
// besides template-literal SQL text, which never contains { or }).
const openBraceIdx = src.indexOf('{', startIdx)
let depth = 0, endIdx = -1
for (let i = openBraceIdx; i < src.length; i++) {
  if (src[i] === '{') depth++
  else if (src[i] === '}') { depth--; if (depth === 0) { endIdx = i; break } }
}
if (endIdx === -1) {
  ok('the guarded block has a matching closing brace', false)
  console.log(fails ? `\n${fails} FAILURE(S)\n` : '\nAll checks passed\n')
  process.exit(1)
}
const block = src.slice(startIdx, endIdx + 1)

// Extract the two query(`...`) template literals inside the block.
const queryTexts = [...block.matchAll(/query\(`([\s\S]*?)`\)/g)].map(m => m[1])
ok('exactly two UPDATE queries inside the guarded block', queryTexts.length === 2, String(queryTexts.length))

const payablesQ = queryTexts.find(q => /Trade payables/i.test(q))
const receivablesQ = queryTexts.find(q => /Trade receivables/i.test(q))
ok('found the Trade Payables (-> Advance to Suppliers) query', !!payablesQ)
ok('found the Trade Receivables (-> Advance from Customers) query', !!receivablesQ)

if (payablesQ) {
  ok('Trade Payables query respects a prior manual/learned decision',
    /status\s+NOT\s+IN\s*\(\s*'user_override'\s*,\s*'user_approved'\s*\)/i.test(payablesQ))
  ok('Trade Payables query still keys off the abnormal (debit) sign',
    /closing_balance\s*<\s*0/.test(payablesQ))
}
if (receivablesQ) {
  ok('Trade Receivables query respects a prior manual/learned decision',
    /status\s+NOT\s+IN\s*\(\s*'user_override'\s*,\s*'user_approved'\s*\)/i.test(receivablesQ))
  ok('Trade Receivables query still keys off the abnormal (credit) sign',
    /closing_balance\s*>\s*0/.test(receivablesQ))
}

// ── Behavioural check: run the ACTUAL guard block (not a re-implementation)
// against a mock tryClaimMigration()/query(), proving it only issues the two
// UPDATEs when the migration key is claimed for the FIRST time, and issues
// NONE on a later run (already claimed) -- i.e. it really only runs once.
const harness = new Function('tryClaimMigration', 'query', `
  return (async () => {
    ${block}
  })()
`)

async function runOnce(claimed) {
  const calls = []
  const query = async (sql) => { calls.push(sql); return { rows: [] } }
  const tryClaimMigration = async () => claimed
  await harness(tryClaimMigration, query)
  return calls
}

const firstRunCalls = await runOnce(true)
ok('first-ever run (migration key freshly claimed) issues both UPDATEs', firstRunCalls.length === 2, String(firstRunCalls.length))

const laterRunCalls = await runOnce(false)
ok('every later run (migration key already claimed) issues NO queries -- runs at most once',
  laterRunCalls.length === 0, String(laterRunCalls.length))

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
