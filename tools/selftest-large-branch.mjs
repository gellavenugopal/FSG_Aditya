/**
 * Pre-release self-test: a branch with tens of thousands of ledgers must never blank the window.
 *
 * What happened (0.1.91, a branch with 67,000 ledgers): ticking "Show all mapped rows" on the Rectification / Recategorisation
 * screen drew every ledger at once - several dropdowns in each row, about 13 million characters of page for even 7,500 rows -
 * the window froze for minutes and then the screen's process ran out of memory, leaving the title bar over an empty white window
 * that stayed blank for as long as the app was open. Two causes, both fixed:
 *   - every ledger was checked against the whole Level Format (about 1,500 rows, each caption cleaned with a regular
 *     expression) - roughly 95 s of pure computing for 67,000 ledgers - so the format is now indexed once;
 *   - the list was drawn in full; it is now drawn a page at a time.
 *
 *  1. The indexed Level Format helpers (utils/fixTargets.js) answer EXACTLY as the scanning ones they replace did
 *     (tools/fixtures/fixTargets.scan-reference.js), over thousands of random ledgers and a random 1,500-row format, and
 *     handle 67,000 ledgers in seconds.
 *  2. The real Rectification screen, handed 67,000 ledgers, draws one page of them (a bounded number of rows and bytes) and
 *     says where it is; a short list is drawn whole, with no pager.
 *  3. A screen whose process dies or hangs is announced and reloaded (src/main/screen-guard.js), never left blank.
 *  4. The dropdowns' custom captions come from a small DISTINCT query, not from every ledger of the Trial Balance, and it
 *     returns exactly the captions the full list held (real handlers, throw-away PostgreSQL).
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source (a smaller list is used there, so an old
 * source fails fast instead of drawing 67,000 ledgers for minutes).
 *
 * Run by tools\Release.ps1 before packaging. A failure aborts the release.
 *   node tools/selftest-large-branch.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { register, createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcRoot = process.env.FSG_SRC_ROOT ? path.resolve(process.env.FSG_SRC_ROOT) : root
const oldSource = srcRoot !== root
register(pathToFileURL(path.join(root, 'tools', 'e2e-learned-rules', 'hooks.mjs')).href)
const xlsxShim = path.join(os.tmpdir(), `fsg-selftest-xlsx-large-${process.pid}.mjs`)
fs.writeFileSync(xlsxShim, `import { createRequire } from 'node:module'
const X = createRequire(${JSON.stringify(pathToFileURL(path.join(root, 'package.json')).href)})('xlsx')
export const { read, readFile, utils, write, writeFile } = X
export default X
`)
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === 'xlsx') return { url: ${JSON.stringify(pathToFileURL(xlsxShim).href)}, shortCircuit: true }
  return next(specifier, context)
}`))
const require = createRequire(import.meta.url)
const esbuild = require(path.join(root, 'node_modules', 'esbuild'))
const React = require(path.join(root, 'node_modules', 'react'))
const { renderToString } = require(path.join(root, 'node_modules', 'react-dom', 'server'))

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + String(detail).slice(0, 300)}`)
}
const finish = () => { console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n') }
const BIG = oldSource ? 4000 : 67000
console.log(`\nA branch with ${BIG.toLocaleString('en-IN')} ledgers${oldSource ? `  (source: ${srcRoot})` : ''}`)

const bundleModule = async (file, tag) => {
  const out = await esbuild.build({ entryPoints: [file], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-large-${tag}-${process.pid}.mjs`)
  fs.writeFileSync(tmp, out.outputFiles[0].text)
  try { return await import(pathToFileURL(tmp).href) } finally { fs.rmSync(tmp, { force: true }) }
}

// ── random Level Format and ledgers (seeded, so every run is the same) ─────────────────────────────────────
let seed = 20261004
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const pick = (a) => a[Math.floor(rnd() * a.length)]
const noise = (s) => {
  if (s == null) return s
  const r = rnd()
  if (r < 0.15) return s.toUpperCase()
  if (r < 0.25) return s.toLowerCase()
  if (r < 0.35) return '  ' + s + ' '
  if (r < 0.42) return s + ' (specify nature)'
  return s
}
const L1 = Array.from({ length: 70 }, (_, i) => `Level one caption ${i}`).concat(['Uncategorised assets', 'Finance Costs', 'Other expenses'])
const L2 = Array.from({ length: 220 }, (_, i) => `Level two caption ${i}`).concat(['Uncategorised', 'uncategorized other'])
const L3 = Array.from({ length: 300 }, (_, i) => `Level three caption ${i}`).concat(['Uncategorised'])
const ALIE = ['ASSETS', 'EQUITY AND LIABILITIES', 'Income', 'Expenses', 'Assets', null, 'OTHER', ' income ']
const NAT = ['Secured, considered good / Unsecured, considered good / Doubtful', 'Specify nature', 'A / B', 'Single option', 'Term loans / Loans repayable on demand', null, '', 'Specify nature / X']
const lf = []
for (let i = 1; i <= 1500; i++) {
  lf.push({ id: i, alie: pick(ALIE), level1: noise(pick(L1)), level2: rnd() < 0.2 ? null : noise(pick(L2)), level3: rnd() < 0.5 ? (rnd() < 0.1 ? '' : null) : noise(pick(L3)),
    level4: pick(NAT), level5: pick(NAT), level6: rnd() < 0.8 ? null : pick(NAT), level7: rnd() < 0.9 ? null : pick(NAT) })
}
lf.push({ id: 7, alie: 'ASSETS', level1: 'dup id row', level2: 'x', level3: 'y' })   // an id used twice: the first row wins, as before
lf.push({ alie: 'ASSETS', level1: 'no id row', level2: null, level3: null })
const STAT = [null, '', 'auto_high', 'auto_low', 'discrepancy', 'Conflict', 'user_override', 'unmapped', 'needs_review']
const makeLedger = (i) => {
  const base = rnd() < 0.8 ? pick(lf) : null
  const junk = rnd() < 0.1
  return {
    id: i + 1, name: `Ledger ${i + 1}`, alie: pick(ALIE), closing_balance: String(-(i % 997) - 1.5), opening_balance: '-10', status: pick(STAT),
    mapping1_resultant: junk ? pick(['', null, 'Uncategorised', 'unknown caption', 'Uncategorised assets']) : noise(base ? base.level1 : pick(L1)),
    mapping2_resultant: rnd() < 0.2 ? pick(['', null, 'Uncategorised']) : noise(base ? base.level2 : pick(L2)),
    mapping3_resultant: rnd() < 0.3 ? pick(['', null, 'Uncategorised']) : noise(base ? base.level3 : pick(L3)),
    level_format_id: rnd() < 0.3 ? (rnd() < 0.2 ? 99999 : pick(lf).id) : null,
    level4_value: rnd() < 0.5 ? null : pick(['Secured, considered good', 'unsecured, considered good', 'A', 'B', 'junk', '']),
    level5_value: rnd() < 0.5 ? null : pick(['Secured, considered good', 'unsecured, considered good', 'Doubtful', 'A', 'junk', '']),
    level6_value: rnd() < 0.5 ? null : pick(['Term loans', 'A', '']),
    level7_value: rnd() < 0.8 ? null : 'free text',
    parent: 'Sundry Debtors', group_parent: 'Current Assets', group_parent_1: '', group_parent_2: '', group_parent_3: '', ledger_code: '',
  }
}
const ledgers = Array.from({ length: BIG }, (_, i) => makeLedger(i))

// ═════ 1. the Level Format helpers: same answers, indexed ═════
console.log('\n1. Level Format helpers')
{
  const ref = await bundleModule(path.join(root, 'tools', 'fixtures', 'fixTargets.scan-reference.js'), 'ref')
  const cur = await bundleModule(path.join(srcRoot, 'src', 'renderer', 'src', 'utils', 'fixTargets.js'), 'cur')
  let n = 0, bad = 0, first = ''
  const same = (what, a, b, row) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; if (!first) first = `${what} on ${JSON.stringify(row).slice(0, 160)}: ${JSON.stringify(a).slice(0, 100)} vs ${JSON.stringify(b).slice(0, 100)}` } }
  for (const r of ledgers.slice(0, 2500)) {
    same('lfRowsFor', ref.lfRowsFor(lf, r), cur.lfRowsFor(lf, r), r)
    same('natureLevelsFor', ref.natureLevelsFor(lf, r), cur.natureLevelsFor(lf, r), r)
    same('ledgerNeeds', ref.ledgerNeeds(lf, r), cur.ledgerNeeds(lf, r), r)
    same('isComplete', ref.isComplete(lf, r), cur.isComplete(lf, r), r)
  }
  for (let k = 0; k < 30; k++) { const sub = ledgers.slice(k * 40, k * 40 + 40); same('bulkNaturePlan', ref.bulkNaturePlan(lf, sub), cur.bulkNaturePlan(lf, sub), { subset: k }) }
  ok(`${n.toLocaleString('en-IN')} answers (nature levels, what is still to fix, complete or not, bulk plans) identical to the scanning helpers`, bad === 0, first)
  // an array of rows edited in place is noticed (the index is keyed by the array and its length)
  const small = [{ id: 1, alie: 'ASSETS', level1: 'Cash', level2: 'Bank', level3: null }]
  const probe = { mapping1_resultant: 'Cash', mapping2_resultant: 'Bank', mapping3_resultant: '' }
  const before = cur.lfRowsFor(small, probe).length
  small.push({ id: 2, alie: 'ASSETS', level1: 'Cash', level2: 'Bank', level3: '' })
  ok('a Level Format array that gains a row is re-read, not served stale', before === 1 && cur.lfRowsFor(small, probe).length === 2)
  ok('no format at all (null / undefined) still answers', cur.ledgerNeeds(null, { mapping1_resultant: '' }).length === 1 && cur.natureLevelsFor(undefined, probe).length === 0)
  // speed: what a branch of 67,000 ledgers costs, projected from a sample so an old source fails fast instead of computing for minutes
  const sample = ledgers.slice(0, 3000)
  const t0 = performance.now()
  let sink = 0
  for (const r of sample) { sink += cur.ledgerNeeds(lf, r).length + cur.natureLevelsFor(lf, r).length + (cur.isComplete(lf, r) ? 1 : 0) }
  const projected = (performance.now() - t0) / sample.length * 67000 / 1000
  ok(`67,000 ledgers through the three checks take about ${projected.toFixed(1)} s (limit 15 s; scanning took about 95 s)`, projected < 15, `${projected.toFixed(1)} s`)
}

// ═════ 2. the real screen, handed a very long list ═════
console.log('\n2. Rectification / Recategorisation screen')
{
  globalThis.window = { api: {} }
  globalThis.__ledgers = []
  globalThis.__lf = lf
  const screenFile = path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'Exceptions', 'index.jsx')
  const built = await esbuild.build({
    entryPoints: [screenFile], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    loader: { '.js': 'jsx', '.jsx': 'jsx' }, jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [{
      name: 'inject',
      setup(b) {
        b.onResolve({ filter: /^react(\/jsx-runtime|\/jsx-dev-runtime)?$/ }, (a) => { const p = require.resolve(a.path, { paths: [root] }); return { path: a.kind === 'require-call' ? p : pathToFileURL(p).href, external: true } })
        b.onLoad({ filter: /Exceptions[\\/]index\.jsx$/ }, (args) => ({
          contents: fs.readFileSync(args.path, 'utf8')
            .replace('const [ledgers, setLedgers] = useState([])', 'const [ledgers, setLedgers] = useState(globalThis.__ledgers)')
            .replace('const [levelFormat, setLevelFormat] = useState([])', 'const [levelFormat, setLevelFormat] = useState(globalThis.__lf)'),
          loader: 'jsx', resolveDir: path.dirname(args.path),
        }))
      },
    }],
  })
  const tmp = path.join(os.tmpdir(), `fsg-selftest-large-screen-${process.pid}.mjs`)
  fs.writeFileSync(tmp, built.outputFiles[0].text)
  const Screen = (await import(pathToFileURL(tmp).href)).default
  fs.rmSync(tmp, { force: true })
  const render = (list) => {
    globalThis.__ledgers = list
    const t0 = performance.now()
    const html = renderToString(React.createElement(Screen, { entity: { id: 1, constitution: 3 }, activeTB: { id: 1 }, prevTB: null, activeRsId: 1 })).replace(/<!-- -->/g, '')
    return { html, ms: performance.now() - t0 }
  }
  const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const rowsOf = (h) => (h.match(/<tr[\s>]/g) || []).length

  const big = render(ledgers)
  const bigText = text(big.html)
  ok(`${BIG.toLocaleString('en-IN')} ledgers: one page of rows is drawn (${rowsOf(big.html)} table rows incl. 2 heading rows; limit 110)`, rowsOf(big.html) <= 110, `${rowsOf(big.html)} rows`)
  ok(`...the page is small (${(big.html.length / 1048576).toFixed(1)} MB of markup; limit 8 MB - drawing every row took 120 MB)`, big.html.length < 8 * 1048576, `${(big.html.length / 1048576).toFixed(1)} MB`)
  ok(`...and is ready in ${(big.ms / 1000).toFixed(1)} s (limit 30 s)`, big.ms < 30000, `${(big.ms / 1000).toFixed(1)} s`)
  const bigFmt = BIG.toLocaleString('en-IN')
  ok('...it says which rows these are, out of how many, and on which page', new RegExp(`Rows 1.100 of ${bigFmt} · page 1 of ${Math.ceil(BIG / 100).toLocaleString('en-IN')}`).test(bigText), bigText.slice(0, 200))
  ok('...and that the heading tick box selects every row, not only this page', new RegExp(`selects all ${bigFmt} rows, not only this page`).test(bigText))
  ok('...the counts still cover every ledger (the "Showing ... rows" line)', new RegExp(`Showing ${BIG} of ${BIG} rows`).test(bigText))

  const mid = render(ledgers.slice(0, 250))
  ok('250 ledgers: pager on page 1 of 3, 100 rows drawn', /Rows 1.100 of 250 · page 1 of 3/.test(text(mid.html)) && rowsOf(mid.html) <= 102, `${rowsOf(mid.html)} rows`)
  const small = render(ledgers.slice(0, 60))
  ok('60 ledgers: all drawn, no pager (a normal list looks exactly as before)', rowsOf(small.html) === 62 && !/rect-pager/.test(small.html), `${rowsOf(small.html)} rows`)

  // The Notes screen opens "Assumption Followed in Categorisation" by itself, listing every Trade Payables / Receivables ledger whose nature
  // was assumed - most of a branch's customers and suppliers. That list is drawn only as far as the first rows. (The real dialog's own lines are
  // compiled here, so the check is on the code that ships.)
  const notesSrc = fs.readFileSync(path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'Notes', 'index.jsx'), 'utf8').replace(/\r\n/g, '\n')
  const fnAt = notesSrc.indexOf('function AssumptionDisclosureModal')
  const endAt = notesSrc.indexOf('export default function Notes(')
  const constAt = notesSrc.indexOf('const ASSUMPTION_ROWS_SHOWN')
  ok('the assumption dialog is in the Notes screen', fnAt > 0 && endAt > fnAt)
  if (fnAt > 0 && endAt > fnAt) {
    const snippet = notesSrc.slice(constAt >= 0 && constAt < fnAt ? constAt : fnAt, endAt).replace(/^function AssumptionDisclosureModal/m, 'export function AssumptionDisclosureModal')
    const dlg = await esbuild.build({
      stdin: { contents: `import React from 'react'\nconst fmtINR = (n) => String(n)\n${snippet}`, resolveDir: root, loader: 'jsx' },
      bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')],
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
      plugins: [{ name: 'one-react', setup(b) { b.onResolve({ filter: /^react(\/jsx-runtime|\/jsx-dev-runtime)?$/ }, (a) => { const p = require.resolve(a.path, { paths: [root] }); return { path: a.kind === 'require-call' ? p : pathToFileURL(p).href, external: true } }) } }],
    })
    const dlgTmp = path.join(os.tmpdir(), `fsg-selftest-large-dialog-${process.pid}.mjs`)
    fs.writeFileSync(dlgTmp, dlg.outputFiles[0].text)
    const { AssumptionDisclosureModal } = await import(pathToFileURL(dlgTmp).href)
    fs.rmSync(dlgTmp, { force: true })
    const items = (n) => Array.from({ length: n }, (_, i) => ({ name: `Customer ${i}`, noteTitle: 'Trade Receivables', assumedAs: 'Unsecured, considered good', cy: i }))
    const bigDlg = renderToString(React.createElement(AssumptionDisclosureModal, { items: items(5000), onClose: () => {} })).replace(/<!-- -->/g, '')
    ok(`5,000 assumed ledgers: the dialog draws ${rowsOf(bigDlg)} table rows (limit 301 incl. the heading)`, rowsOf(bigDlg) <= 301, `${rowsOf(bigDlg)} rows`)
    ok('...and says how many there are in all, and where to see them', /Showing the first 300 of 5,000 ledgers/.test(text(bigDlg)) && /Rectification \/ Recategorisation/.test(text(bigDlg)))
    const smallDlg = renderToString(React.createElement(AssumptionDisclosureModal, { items: items(40), onClose: () => {} })).replace(/<!-- -->/g, '')
    ok('40 assumed ledgers: all listed, no cut-off note', rowsOf(smallDlg) === 41 && !/Showing the first/.test(text(smallDlg)), `${rowsOf(smallDlg)} rows`)
  }
}

// ═════ 3. a dead or hung screen is announced and reloaded ═════
console.log('\n3. A dead or hung screen')
{
  let guard = null
  try { guard = await import(pathToFileURL(path.join(srcRoot, 'src', 'main', 'screen-guard.js')).href) } catch (e) { guard = null }
  ok('the screen guard exists (src/main/screen-guard.js)', !!guard && typeof guard.guardScreen === 'function')
  const indexSrc = fs.readFileSync(path.join(srcRoot, 'src', 'main', 'index.js'), 'utf8')
  ok('...and the main window uses it', /guardScreen\((?:mainWindow|win)\b/.test(indexSrc))
  if (guard && typeof guard.guardScreen === 'function') {
    const tick = () => new Promise(r => setTimeout(r, 20))
    const logFile = path.join(os.tmpdir(), `fsg-selftest-guard-${process.pid}.log`)
    const mk = (response = 0) => {
      const wc = new EventEmitter(); wc.calls = []
      wc.reload = () => wc.calls.push('reload'); wc.forcefullyCrashRenderer = () => wc.calls.push('crash')
      const win = new EventEmitter(); win.webContents = wc; win.destroyed = false; win.isDestroyed = () => win.destroyed
      const shown = []
      const dialog = { showMessageBox: async (_w, o) => { shown.push(o); return { response } } }
      const logged = []
      guard.guardScreen(win, { dialog, logFile, log: (m) => logged.push(m) })
      return { win, wc, shown, logged }
    }
    let t = mk()
    t.wc.emit('render-process-gone', {}, { reason: 'oom', exitCode: -536870904 }); await tick()
    ok('a screen that ran out of memory: the user is told, in plain words', t.shown.length === 1 && /stopped working/.test(t.shown[0].message) && /ran out of memory/.test(t.shown[0].detail), JSON.stringify(t.shown[0] || null))
    ok('...the screen is reloaded, not left white', t.wc.calls.includes('reload'))
    ok('...and the reason is written to the log file', /screen process gone: oom/.test(fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''))
    t = mk()
    t.wc.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 }); await tick()
    ok('a normal exit of the screen process is not an alarm', t.shown.length === 0 && t.wc.calls.length === 0)
    t = mk(1)
    t.win.emit('unresponsive'); await tick()
    ok('a hung screen: the user is asked, and "Reload the screen" stops it', t.shown.length === 1 && /taking a very long time/.test(t.shown[0].message) && t.wc.calls.includes('crash'))
    t.wc.emit('render-process-gone', {}, { reason: 'killed', exitCode: 1 }); await tick()
    ok('...the restart the user asked for is carried out without a second alarm', t.shown.length === 1 && t.wc.calls.includes('reload'))
    t = mk(0)
    t.win.emit('unresponsive'); await tick()
    ok('"Keep waiting" leaves the screen alone', t.shown.length === 1 && t.wc.calls.length === 0)
    t = mk()
    t.win.destroyed = true
    t.wc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 }); await tick()
    ok('a window that is already closed is left alone', t.shown.length === 0 && t.wc.calls.length === 0)
    const broken = new EventEmitter(); broken.webContents = new EventEmitter(); broken.isDestroyed = () => false; broken.webContents.calls = []
    broken.webContents.reload = () => broken.webContents.calls.push('reload')
    guard.guardScreen(broken, { dialog: { showMessageBox: () => { throw new Error('no dialog available') } }, logFile: null, log: () => {} })
    broken.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 }); await tick()
    ok('even if the message box itself fails, the screen is still reloaded', broken.webContents.calls.includes('reload'))
    fs.rmSync(logFile, { force: true })
  }
}

// ═════ 4. the dropdowns' captions come from a small query ═════
console.log('\n4. Custom captions for the dropdowns')
const preloadText = fs.readFileSync(path.join(srcRoot, 'src', 'preload', 'index.js'), 'utf8')
const screenText = fs.readFileSync(path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'Exceptions', 'index.jsx'), 'utf8')
ok('the screen asks for the distinct captions (preload listMappedCaptions -> mappedTB:captionTuples)', /listMappedCaptions:\s*\(tbId\)\s*=>\s*(?:ipcRenderer\.invoke|inv)\('mappedTB:captionTuples'/.test(preloadText) && /window\.api\.listMappedCaptions\(tbId\)/.test(screenText))

const pgRoot = 'C:\\Program Files\\PostgreSQL'
const ver = fs.existsSync(pgRoot) ? fs.readdirSync(pgRoot).filter(d => fs.existsSync(path.join(pgRoot, d, 'bin', 'initdb.exe'))).sort((a, b) => parseFloat(b) - parseFloat(a))[0] : null
if (!ver) { ok('PostgreSQL binaries found (C:\\Program Files\\PostgreSQL\\<ver>\\bin)', false); finish(); process.exit(1) }
const bin = (x) => path.join(pgRoot, ver, 'bin', x)
const port = await new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) }) })
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-selftest-pg-large-'))
const run = (exe, args, quiet = false) => spawnSync(bin(exe), args, quiet ? { stdio: 'ignore', timeout: 60000 } : { encoding: 'utf8', timeout: 120000 })
let started = false
const cleanup = () => {
  if (started) run('pg_ctl.exe', ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], true)
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.rmSync(xlsxShim, { force: true })
}
try {
  let r = run('initdb.exe', ['-D', dataDir, '-U', 'selftest', '-A', 'trust', '-E', 'UTF8'])
  if (r.status !== 0) throw new Error('initdb failed: ' + (r.stderr || r.stdout))
  r = run('pg_ctl.exe', ['-D', dataDir, '-o', `-p ${port}`, '-l', path.join(dataDir, 'log.txt'), '-w', 'start'], true)
  if (r.status !== 0) throw new Error('pg_ctl start failed (status ' + r.status + ')')
  started = true
  process.chdir(srcRoot)
  const imp = (rel) => import(pathToFileURL(path.join(srcRoot, 'src', 'main', ...rel.split('/'))).href)
  const { initDB, query } = await imp('db/client.js')
  const { ensureSchema } = await imp('db/schema.js')
  const { seedDefaultMapping, ensureStockCategories } = await imp('services/excel.js')
  const mig = await imp('db/mapping-v3-migration.js')
  const { applyMappingPatches } = await imp('ipc/mapping.js')
  const { registerTBHandlers } = await imp('ipc/tb.js')
  const { registerMappedTBHandlers } = await imp('ipc/mapped-tb.js')
  await initDB({ host: 'localhost', port, database: 'postgres', user: 'selftest', password: '' })
  await ensureSchema(); await seedDefaultMapping(); await ensureStockCategories()
  await mig.migrateMappingV3Captions(); await mig.migrateMappingV3CaptionsPass2(); await applyMappingPatches()
  registerTBHandlers(); registerMappedTBHandlers()
  const ipc = (name, ...args) => globalThis.__ipc[name](null, ...args)
  const one = async (sql, p) => (await query(sql, p)).rows[0]
  const rs = (await one(`SELECT id FROM mapping_rule_sets WHERE is_default LIMIT 1`)).id
  const ent = (await one(`INSERT INTO entities (name, constitution, constitution_display, business_type) VALUES ('Large Branch Co', 3, 'Company', 'Trader') RETURNING id`)).id
  const fp = (await one(`SELECT id FROM financial_periods WHERE date_from='2025-04-01' AND date_till='2026-03-31'`))?.id
    || (await one(`INSERT INTO financial_periods (year_label, date_from, date_till) VALUES ('Mar2026','2025-04-01','2026-03-31') RETURNING id`)).id
  const ep = (await one(`INSERT INTO entity_periods (entity_id, financial_period_id) VALUES ($1,$2) RETURNING id`, [ent, fp])).id
  const groups = [['Sundry Debtors', 'Current Assets', true, -1], ['Sundry Creditors', 'Current Liabilities', false, 1], ['Indirect Expenses', 'Indirect Expenses', true, -1], ['Sales Accounts', 'Sales Accounts', false, 1],
    ['Purchase Accounts', 'Purchase Accounts', true, -1], ['Bank Accounts', 'Current Assets', true, -1], ['Duties & Taxes', 'Current Liabilities', false, 1], ['Fixed Assets', 'Fixed Assets', true, -1]]
  const tbRows = Array.from({ length: 400 }, (_, i) => {
    const g = groups[i % groups.length]
    return { period: '', branch: 'B', ledger_code: 'L' + i, name: `Ledger ${i} ${g[0]}`, opening_balance: g[3] * 90, debit: 0, credit: 0, closing_balance: g[3] * (100 + i), is_revenue: null, is_deemed_positive: g[2], trail_balance: 0,
      parent: g[0], group_parent: g[1], group_parent_1: '', group_parent_2: '', group_parent_3: '', group_parent_4: '', group_parent_5: '', group_parent_6: '', group_parent_7: g[1] }
  })
  const up = await ipc('tb:uploadRealBooks', { entityId: ent, period: '2025-26', fileName: 'large.xlsx', tbRows, branchName: 'B', entityPeriodId: ep })
  await ipc('mappedTB:run', up.tb.id, rs, { excludeZero: true })
  // one custom caption typed by the user, as a Fix would leave it
  await query(`UPDATE mapped_tb SET mapping1_resultant = 'Custom head', mapping2_resultant = 'Custom line', mapping3_resultant = NULL WHERE id = (SELECT MIN(id) FROM mapped_tb WHERE tb_id = $1)`, [up.tb.id])
  ok('the handler is registered (mappedTB:captionTuples)', typeof globalThis.__ipc['mappedTB:captionTuples'] === 'function')
  if (typeof globalThis.__ipc['mappedTB:captionTuples'] === 'function') {
    const all = await ipc('mappedTB:findByFilter', up.tb.id, {})
    const want = new Set(all.map(x => JSON.stringify([x.mapping1_resultant ?? null, x.mapping2_resultant ?? null, x.mapping3_resultant ?? null])))
    const got = await ipc('mappedTB:captionTuples', up.tb.id)
    const have = new Set(got.map(x => JSON.stringify([x.mapping1_resultant ?? null, x.mapping2_resultant ?? null, x.mapping3_resultant ?? null])))
    ok(`${all.length} mapped ledgers: the same ${want.size} distinct Mapping 1/2/3 captions, in ${got.length} small rows instead of ${all.length} full ones`,
      want.size === have.size && [...want].every(k => have.has(k)) && got.length === want.size && got.length < all.length, `want ${want.size} got ${have.size} of ${got.length}`)
    ok('...including the custom caption', got.some(x => x.mapping1_resultant === 'Custom head' && x.mapping2_resultant === 'Custom line'))
    ok('a Trial Balance with nothing mapped has none', (await ipc('mappedTB:captionTuples', 999999)).length === 0)
  }

  // ── the default list's own query ──
  // Its tests (does this ledger still lack a Mapping 2 / Level 4 / Level 5, is it flagged by the engine, does its Level 2 belong to the other
  // statement) each search the Level Format, and were run once per LEDGER: about a minute for 67,000. They now run once per DISTINCT
  // combination of captions, and every ledger is matched to the answer for its combination. Same ledgers, far faster.
  console.log('\n5. The default Rectification list\'s query')
  const mkTB = async (label, n) => {
    const id = (await one(`INSERT INTO trial_balances (entity_id, period, filename, row_count, branch_name, entity_period_id) VALUES ($1,'2025-26',$2,$3,$2,$4) RETURNING id`, [ent, label, n, ep])).id
    await query(`INSERT INTO tb_rows (tb_id, name, ledger_code, closing_balance, opening_balance, is_deemed_positive, parent, group_parent)
                 SELECT $1, 'Ledger ' || g, 'L' || g, -g, -g, true, 'Sundry Debtors', 'Current Assets' FROM generate_series(1, $2::int) g`, [id, n])
    return id
  }
  const idsOf = (rows) => rows.map(x => x.id).sort((a, b) => a - b).join(',')

  // (a) the same ledgers as the one-ledger-at-a-time query, on awkward data: every ledger has its own mixture of captions - taken from a
  // random Level Format row, then blanked, made "Uncategorised", given Level 4 / 5 values or flagged (hash-driven, so every run is the same)
  const NQ = 4000
  const tbQ = await mkTB('awkward', NQ)
  await query(`INSERT INTO mapped_tb (tb_id, tb_row_id, rule_set_id, alie, mapping1_resultant, mapping2_resultant, mapping3_resultant, level4_value, level5_value, status)
               SELECT $1, r.id, CASE WHEN r.k % 17 = 0 THEN NULL ELSE $2::int END, pick.alie,
                      CASE WHEN r.k % 23 = 0 THEN NULL WHEN r.k % 29 = 0 THEN 'Uncategorised assets' ELSE pick.level1 END,
                      CASE WHEN r.k % 7 = 0 THEN NULL WHEN r.k % 31 = 0 THEN 'Uncategorised' ELSE pick.level2 END,
                      CASE WHEN r.k % 5 = 0 THEN NULL ELSE pick.level3 END,
                      CASE WHEN r.k % 11 = 0 THEN 'x' END, CASE WHEN r.k % 13 = 0 THEN 'Secured, considered good' END,
                      (ARRAY['auto_high','auto_low','discrepancy','conflict','user_override','user_approved','unmapped'])[1 + r.k % 7]
               FROM (SELECT id, abs(hashtext(id::text)) AS k FROM tb_rows WHERE tb_id = $1) r
               JOIN LATERAL (SELECT alie, level1, level2, level3 FROM level_format WHERE rule_set_id = $2::int ORDER BY id OFFSET (r.k % 600) LIMIT 1) pick ON true`, [tbQ, rs])
  const mappedQ = (await one(`SELECT COUNT(*) AS c FROM mapped_tb WHERE tb_id = $1`, [tbQ])).c
  ok(`${NQ.toLocaleString('en-IN')} ledgers with mixed, partly incomplete captions are mapped`, Number(mappedQ) === NQ, mappedQ)
  const queue = await ipc('mappedTB:findByFilter', tbQ, { uncategorised: true })
  const perLedger = await ipc('mappedTB:findByFilter', tbQ, { uncategorised: true, perLedger: true })
  ok(`the list holds ${queue.length.toLocaleString('en-IN')} of ${NQ.toLocaleString('en-IN')} ledgers - some, not all, so the comparison means something`, queue.length > 200 && queue.length < NQ - 200, queue.length)
  ok('...exactly the ledgers the one-ledger-at-a-time query lists', idsOf(queue) === idsOf(perLedger), `${queue.length} vs ${perLedger.length}`)
  const scoped = await ipc('mappedTB:findByFilter', tbQ, { uncategorised: true, alie: 'ASSETS' })
  const scopedRef = await ipc('mappedTB:findByFilter', tbQ, { uncategorised: true, alie: 'ASSETS', perLedger: true })
  ok('a list scoped to one Balance Sheet side agrees too', idsOf(scoped) === idsOf(scopedRef) && scoped.length > 0 && scoped.length < queue.length, `${scoped.length} vs ${scopedRef.length}`)
  const byId = await ipc('mappedTB:findByFilter', tbQ, { uncategorised: true, mappedIds: queue.slice(0, 5).map(x => x.id) })
  ok('a Fix that names its ledgers by id still gets exactly those', byId.length === 5 && idsOf(byId) === idsOf(queue.slice(0, 5)), byId.length)
  const everything = await ipc('mappedTB:findByFilter', tbQ, {})
  ok('with no filter, every mapped ledger is listed', everything.length === NQ, everything.length)

  // (b) the speed, on data shaped like a real branch: thousands of customers and suppliers sharing a dozen caption combinations
  const NR = 20000
  const tbR = await mkTB('branch', NR)
  await query(`INSERT INTO mapped_tb (tb_id, tb_row_id, rule_set_id, alie, mapping1_resultant, mapping2_resultant, mapping3_resultant, status)
               SELECT $1, r.id, $2::int, pick.alie, pick.level1, pick.level2, pick.level3, CASE WHEN r.k % 97 = 0 THEN 'discrepancy' ELSE 'auto_high' END
               FROM (SELECT id, abs(hashtext(id::text)) AS k FROM tb_rows WHERE tb_id = $1) r
               JOIN LATERAL (SELECT alie, level1, level2, level3 FROM level_format WHERE rule_set_id = $2::int ORDER BY id OFFSET (r.k % 12) LIMIT 1) pick ON true`, [tbR, rs])
  const t0 = performance.now()
  const branchQueue = await ipc('mappedTB:findByFilter', tbR, { uncategorised: true })
  const branchSecs = (performance.now() - t0) / 1000
  ok(`${NR.toLocaleString('en-IN')} ledgers sharing a dozen caption combinations: the list (${branchQueue.length.toLocaleString('en-IN')} ledgers) is ready in ${branchSecs.toFixed(1)} s (limit 5 s; one ledger at a time took about 17 s)`, branchSecs < 5, branchSecs.toFixed(1))
} catch (e) {
  ok('the database checks ran', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e))
} finally {
  process.chdir(root)
  cleanup()
}
finish()
process.exit(fails ? 1 : 0)
