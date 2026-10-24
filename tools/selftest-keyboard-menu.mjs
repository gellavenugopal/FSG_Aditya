/**
 * Pre-release self-test (0.1.113): keyboard shortcuts follow the menu. Every top-level tab and every item of every dropdown has its own
 * key (unique where it has to be), and Escape steps back to the screen before.
 *   node tools/selftest-keyboard-menu.mjs
 * (The keystrokes against the real app are an Electron driver; this gate keeps the menu and its keys from drifting apart.)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let fails = 0
const ok = (what, cond, d = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + d}`) }
const rd = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8')
console.log('\nKeyboard shortcuts and the menu')

const nav = rd('src/renderer/src/components/Layout/NavTabs.jsx')
const a = nav.indexOf('export const TOP_SHORTCUTS = ')
const b = nav.indexOf('const shown = ')
ok('the key tables are in NavTabs', a > 0 && b > a)
const { TOP, ITEMS } = new Function(nav.slice(a, b).replace('export const TOP_SHORTCUTS', 'const TOP_SHORTCUTS').replace('const ITEM_SHORTCUTS', 'const ITEMS_X') + '\nreturn { TOP: TOP_SHORTCUTS, ITEMS: ITEMS_X }')()

const app = rd('src/renderer/src/App.jsx')
const t0 = app.indexOf('const TABS = [')
const t1 = app.indexOf('export default function App()')
const { TABS, TAB_GROUPS } = new Function(app.slice(t0, t1).replace(/^const ADJ[\s\S]*?\]\)\n/m, '') + '\nreturn { TABS, TAB_GROUPS }')()

const dupes = (obj) => { const seen = {}; const d = []; for (const [k, v] of Object.entries(obj)) { if (seen[v]) d.push(`${seen[v]} / ${k} = ${v}`); else seen[v] = k } return d }
ok('every top-level tab has a key', TABS.every(t => TOP[t]), TABS.filter(t => !TOP[t]).join(', '))
ok('no two top-level tabs share a key', dupes(TOP).length === 0, dupes(TOP).join('; '))
ok('every key is one letter', Object.values(TOP).every(k => /^[A-Z]$/.test(k)) && Object.values(ITEMS).every(m => Object.values(m).every(k => /^[A-Z]$/.test(k))))
const problems = []
for (const [group, kids] of Object.entries(TAB_GROUPS)) {
  const map = ITEMS[group]
  if (!map) { problems.push(`${group}: no key table`); continue }
  for (const kid of kids) {
    if (!map[kid]) { problems.push(`${group} > ${kid}: no key`); continue }
    const label = kid.replace(/^[^:]+:\s*/, '')
    if (!label.toUpperCase().includes(map[kid])) problems.push(`${group} > ${kid}: key ${map[kid]} is not in the label`)
  }
  for (const d of dupes(map)) problems.push(`${group}: ${d}`)
  for (const k of Object.keys(map)) if (!kids.includes(k)) problems.push(`${group}: key for "${k}", which is not in that menu`)
}
ok('every item of every dropdown (and sub-dropdown) has its own key, found in its label, unique within its dropdown', problems.length === 0, problems.join('; '))
ok('top-level keys are underlined in the labels and shown in Alt tooltips', nav.includes('<KeyLabel text={tab} k={key} />') && nav.includes('Alt+${key'))
ok('an open dropdown answers to letters, arrows, Enter and Escape', nav.includes("k === 'Escape'") && nav.includes("k === 'ArrowDown'") && nav.includes("k === 'Enter'") && nav.includes('map[c] === want'))
ok('App.jsx routes Alt+key to the tab, or opens its dropdown', app.includes('e.altKey || e.ctrlKey || e.metaKey || e.shiftKey') && app.includes('TAB_OF_KEY') && app.includes('setMenuRequest({ tab, n: Date.now() })') && app.includes('openRequest={menuRequest}'))
ok('Escape goes back through the screens visited, but not out of a field, a dropdown or a dialog', app.includes('histRef') && app.includes("key !== 'Escape'") && app.includes('[role="menu"], [role="dialog"]') && app.includes('h.skip = true'))
ok('the old letter map is gone', !app.includes('SHORTCUT_MAP'))
ok('Alt+W opens a new window, and W is not a tab key', app.includes("=== 'W'") && app.includes('openWinRef.current()') && !Object.values(TOP).includes('W'))

console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
