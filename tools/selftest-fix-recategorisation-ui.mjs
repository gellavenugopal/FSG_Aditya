/**
 * Pre-release self-test: the Rectification / Recategorisation screen, as a "Fix" button leaves it.
 * Renders the real component (server-side) with injected state:
 *   1. a Fix that has no ledger to open says so, and offers a way out -- it must never claim
 *      "every ledger is fully categorised" (which is what hid the reported problem);
 *   2. a ledger whose captions do not lead to a Level Format row (old wording, blank Level 3)
 *      still gets its nature column (Secured / Unsecured / Doubtful, PPE class...), through its
 *      own level_format_id -- that column used to stay shut for exactly such ledgers.
 *
 * FSG_SRC_ROOT=<folder holding another src/> runs the same checks against that source.
 *
 *   node tools/selftest-fix-recategorisation-ui.mjs
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
const React = require(path.join(root, 'node_modules', 'react'))
const { renderToString } = require(path.join(root, 'node_modules', 'react-dom', 'server'))

let fails = 0
const ok = (what, cond, detail = '') => {
  if (!cond) fails++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond || !detail ? '' : '  -- ' + String(detail).slice(0, 300)}`)
}

console.log(`\nRecategorisation screen as a Fix leaves it${srcRoot !== root ? `  (source: ${srcRoot})` : ''}`)

globalThis.window = { api: {} }
globalThis.__ledgers = []
globalThis.__lf = []
const screenFile = path.join(srcRoot, 'src', 'renderer', 'src', 'components', 'Exceptions', 'index.jsx')
if (!fs.existsSync(screenFile)) { ok('the screen exists', false, screenFile); process.exit(1) }
const built = await esbuild.build({
  entryPoints: [screenFile], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  loader: { '.js': 'jsx', '.jsx': 'jsx' }, jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: [{
    name: 'inject',
    setup(b) {
      // one React shared with the renderer used below
      b.onResolve({ filter: /^react(\/jsx-runtime|\/jsx-dev-runtime)?$/ }, (a) => { const p = require.resolve(a.path, { paths: [root] }); return { path: a.kind === 'require-call' ? p : pathToFileURL(p).href, external: true } })
      // state a plain render cannot reach: the loaded ledgers and Level Format
      b.onLoad({ filter: /Exceptions[\\/]index\.jsx$/ }, (args) => ({
        contents: fs.readFileSync(args.path, 'utf8')
          .replace('const [ledgers, setLedgers] = useState([])', 'const [ledgers, setLedgers] = useState(globalThis.__ledgers)')
          .replace('const [levelFormat, setLevelFormat] = useState([])', 'const [levelFormat, setLevelFormat] = useState(globalThis.__lf)'),
        loader: 'jsx', resolveDir: path.dirname(args.path),
      }))
    },
  }],
})
const tmp = path.join(os.tmpdir(), `fsg-selftest-fixui-${process.pid}.mjs`)
fs.writeFileSync(tmp, built.outputFiles[0].text)
const Screen = (await import(pathToFileURL(tmp).href)).default
fs.rmSync(tmp, { force: true })
const render = (props) => renderToString(React.createElement(Screen, { entity: { id: 1, constitution: 3 }, activeTB: { id: 1 }, prevTB: { id: 2 }, activeRsId: 1, ...props })).replace(/<!-- -->/g, '')
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

// 1. nothing to open
{
  const scoped = text(render({ initialFilter: { alie: 'ASSETS', mappedIds: [999], title: 'Fix Unclassified — Other loans and advances', key: 1 } }))
  ok('a Fix with no ledger to open says so - never "every ledger is fully categorised"', /No ledgers to open for/.test(scoped) && !/every ledger is fully categorised/.test(scoped), scoped.slice(0, 300))
  ok('...and offers the way out (look in the other year / clear the scope)', /Look in the Previous Year instead/.test(scoped) && /Clear scope/.test(scoped))
  const idle = text(render({ prevTB: null }))
  ok('the screen opened from the menu with nothing to fix still says all categorised', /every ledger is fully categorised/.test(idle))
}

// 2. the nature column
{
  globalThis.__ledgers = [
    // captions of an older wording: no Level Format row by text, but the ledger still points at its row (level_format_id 3)
    { id: 1, name: 'Loan to Party B', alie: 'ASSETS', mapping1_resultant: 'Current assets', mapping2_resultant: 'Loans and advances (old caption)', mapping3_resultant: null, level_format_id: 3, level5_value: 'Unsecured', status: 'auto_medium', closing_balance: '-30000', opening_balance: '0' },
  ]
  globalThis.__lf = [{ id: 3, alie: 'ASSETS', level1: 'Current assets', level2: 'Short-term loans and advances', level3: 'Other loans and advances', level5: 'Secured, considered good / Unsecured, considered good / Doubtful' }]
  const grid = render({})
  ok('the ledger is listed', grid.includes('Loan to Party B'))
  ok('its nature column opens (Secured / Unsecured / Doubtful) even though its captions match no Level Format row', /<option[^>]*value="Doubtful"/.test(grid) && /<option[^>]*value="Secured, considered good"/.test(grid))
  // captions that DO match still work, including a different letter case
  globalThis.__ledgers = [{ ...globalThis.__ledgers[0], mapping2_resultant: 'SHORT-TERM LOANS AND ADVANCES', mapping3_resultant: 'other loans and advances', level_format_id: null }]
  const grid2 = render({})
  ok('captions that differ only in letter case still find the Level Format row', /<option[^>]*value="Doubtful"/.test(render({})) && grid2.includes('Loan to Party B'))
}

console.log(fails ? `\n${fails} FAILURE(S) — release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
