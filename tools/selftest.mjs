/**
 * Pre-release self-test — pure functions only. No Electron, no database, no Tally.
 *
 * Exists because 0.1.7 shipped an infinite recursion: a global find-and-replace
 * rewrote a helper's own return statement into a call to itself, so EVERY Tally
 * request died with "Maximum call stack size exceeded". The packaged app still
 * launched perfectly — a window opening proves nothing about code paths that
 * only run during an import.
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const TALLY = path.join(root, 'src/main/services/tally-odbc.js')

let failures = 0
const ok   = (m) => console.log('  PASS  ' + m)
const fail = (m) => { console.log('  FAIL  ' + m); failures++ }

// Source files are CRLF. Every regex below must tolerate \r before \n, or the
// extraction silently finds nothing and the test "passes" by doing nothing.
const readSrc = (f) => fs.readFileSync(f, 'utf8')

// ── 1. No function may return a call to itself ──────────────────────────────
function checkSelfRecursion(file) {
  const src = readSrc(file)
  const re = /function\s+([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{([\s\S]*?)\r?\n\}/g
  const bad = []
  let m
  while ((m = re.exec(src)) !== null) {
    const [, name, body] = m
    // `return name(` or `return \`${name}(` — recursing straight out of the
    // return statement. This is the 0.1.7 shape exactly.
    const selfReturn = new RegExp('return\\s+`?\\$?\\{?' + name + '\\s*\\(')
    if (selfReturn.test(body)) bad.push(name)
  }
  if (bad.length) fail(`${path.basename(file)}: self-recursive return in ${bad.join(', ')}`)
  else ok(`${path.basename(file)}: no self-recursive returns`)
}

// ── 2. Actually EXECUTE the Tally request-header builder ────────────────────
function checkStaticVars() {
  const src = readSrc(TALLY)
  const esc = src.match(/function xmlEscape[\s\S]*?\r?\n\}/)
  const sv  = src.match(/function staticVars[\s\S]*?\r?\n\}/)
  if (!esc || !sv) return fail('could not locate xmlEscape / staticVars in tally-odbc.js')

  let staticVars
  try {
    staticVars = new Function(esc[0] + '\n' + sv[0] + '\nreturn staticVars')()
  } catch (e) {
    return fail('staticVars did not compile: ' + e.message)
  }

  for (const [label, arg] of [['unscoped', null], ['scoped', 'Branch 2 Ltd'], ['escaping', 'A & B <Traders>']]) {
    let out
    try {
      out = staticVars(arg)                 // blows the stack if recursive
    } catch (e) {
      return fail(`staticVars(${label}) threw: ${e.message}`)
    }
    if (!out.includes('<SVEXPORTFORMAT>')) return fail(`staticVars(${label}) lost SVEXPORTFORMAT`)
    if (arg && !out.includes('<SVCURRENTCOMPANY>')) return fail(`staticVars(${label}) lost SVCURRENTCOMPANY`)
    if (!arg && out.includes('<SVCURRENTCOMPANY>')) return fail('staticVars(null) must not scope the request')
  }
  if (staticVars('A & B <Traders>').includes('A & B <Traders>')) {
    return fail('company name is not XML-escaped (breaks on names like "A & B Traders")')
  }
  ok('staticVars: returns, keeps both tags, escapes the company name')
}

// ── 3. Every Tally request must go through the helper ───────────────────────
function checkAllRequestsScoped() {
  const src = readSrc(TALLY)
  const literal   = (src.match(/<SVEXPORTFORMAT>\$\$SysName:XML<\/SVEXPORTFORMAT>/g) || []).length
  const viaHelper = (src.match(/\$\{staticVars\(company\)\}/g) || []).length
  if (literal !== 1) {
    fail(`${literal} raw SVEXPORTFORMAT literals (expected exactly 1, inside staticVars) — a request is unscoped, or the helper lost its own literal`)
  } else if (viaHelper < 5) {
    fail(`only ${viaHelper} requests go through staticVars — expected all of them`)
  } else {
    ok(`all ${viaHelper} Tally requests go through staticVars`)
  }
}

console.log('\nPre-release self-test')
checkSelfRecursion(TALLY)
checkStaticVars()
checkAllRequestsScoped()
console.log(failures ? `\n${failures} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(failures ? 1 : 0)
