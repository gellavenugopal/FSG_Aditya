/**
 * Pre-release self-test (0.1.112): more than one window. "New window" opens another window of the app on the same client / Financial
 * Year / Trial Balance / tab; a save in one window tells the others, which offer a refresh.
 *   node tools/selftest-multiwindow.mjs
 * (The two-window run against the real app is an Electron driver; this gate checks the wiring and which calls count as a save.)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let fails = 0
const ok = (what, cond, d = '') => { if (!cond) fails++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}${cond ? '' : '  -- ' + d}`) }
const rd = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8')
console.log('\nMore than one window')

const pre = rd('src/preload/index.js')
// the helper's source, cut out of the preload between its first and the next blank-line-separated block
const a = pre.indexOf('const WRITE_RX = ')
const b = pre.indexOf('const inv = async')
ok('the preload has the save-detection helper', a > 0 && b > a)
const isWrite = new Function(pre.slice(a, b) + '\nreturn isWrite')()
const saves = ['cfs:save', 'generalNotes:save', 'mappedTB:override', 'mappedTB:overrideMany', 'mappedTB:setAdjustment', 'mappedTB:addManualLedger', 'mappedTB:run',
  'tb:upload', 'tb:saveStock', 'tb:saveJournalEntry', 'tb:delete', 'noteDetails:save', 'manualPyEntries:upsert', 'entityPeriod:finalise', 'entityPeriod:lock',
  'entity:save', 'dep:saveComp', 'financialPeriod:save', 'plClosedToCapital:set', 'notesSaveCashBank', 'savePPELedgers', 'deletePPELedger', 'importPPEFromTally',
  'learnedRules:apply', 'fsSnapshot:publish', 'remarks:save']
const reads = ['cfs:get', 'generalNotes:get', 'mappedTB:rows', 'mappedTB:findByFilter', 'mappedTB:adjustmentSummary', 'tb:list', 'tb:getBranches', 'tb:rows',
  'entity:getAll', 'entityPeriod:list', 'entityPeriod:get', 'financials:getData', 'financials:renderPDF', 'noteDetails:listByTB', 'mapping:levelFormat',
  'mapping:ruleSets', 'notesGetCashBank', 'getForm3CD', 'getPPELedgers', 'app:getVersion', 'settings:get', 'settings:save', 'dialog:saveFile', 'file:write',
  'dep:get', 'dep:parseExcel', 'fsSnapshot:list', 'window:openNew']
const wrongSave = saves.filter(c => !isWrite(c)), wrongRead = reads.filter(c => isWrite(c))
ok('every saving call is recognised as a save', wrongSave.length === 0, wrongSave.join(', '))
ok('reads, dialogs, settings and file writes are not', wrongRead.length === 0, wrongRead.join(', '))

// no handler named like a save is missed
const names = new Set()
for (const f of fs.readdirSync(path.join(root, 'src/main/ipc'))) {
  for (const m of rd('src/main/ipc', f).matchAll(/ipcMain\.handle\('([^']+)'/g)) names.add(m[1])
}
const missed = [...names].filter(n => /(^|:)(save|upsert|override|approve|delete|setAdjustment)/i.test(n) && !/^(dialog|file|settings|db|app|window):/.test(n) && !isWrite(n))
ok('no handler named like a save is missed', missed.length === 0, missed.join(', '))

const raw = pre.split('ipcRenderer.invoke(').length - 1
ok('all api calls go through the helper (only the helper and the new-window call use the raw invoke)', raw === 2, String(raw))

const main = rd('src/main/index.js'), app = rd('src/renderer/src/App.jsx'), top = rd('src/renderer/src/components/Layout/TopBar.jsx')
ok('the main process opens another window on request, carrying only plain values', main.includes("ipcMain.handle('window:openNew'") && main.includes("typeof v === 'string' || typeof v === 'number' || v === null"))
ok('...keeps the list of windows and tells every other window of a save', main.includes('const appWindows = new Set()') && main.includes('for (const w of appWindows)') && main.includes('w.webContents.id === e.sender.id) continue'))
ok('closing one window leaves the others (the app ends with the last)', main.includes('window-all-closed') && main.includes('appWindows.delete(win)'))
ok('a new window starts on the client, Financial Year, Trial Balance, branch view and tab it was opened from', app.includes('const POPOUT = (() =>') && app.includes('POPOUT.entityPeriodId') && app.includes('POPOUT.tbId') && app.includes('POPOUT.selectedBranchTBId') && app.includes('useState((POPOUT && POPOUT.tab)'))
ok('a window offers a refresh when another saved, and redraws the open tab on Refresh', app.includes('changedElsewhere') && app.includes('Refresh this window') && app.includes('key={refreshKey}'))
ok('the title bar names the client and the tab, so windows are told apart', app.includes('document.title = entity ?'))
ok('the top bar has the New window button', top.includes('New window') && top.includes('onNewWindow'))

console.log(fails ? `\n${fails} FAILURE(S) - release aborted\n` : '\nAll checks passed\n')
process.exit(fails ? 1 : 0)
