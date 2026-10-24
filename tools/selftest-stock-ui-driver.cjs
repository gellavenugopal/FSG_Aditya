// Driver for tools/selftest-stock-ui.mjs: runs INSIDE Electron. Loads the page the test built (the real Stock screen, with a stand-in for window.api that
// behaves like the database), types and clicks like the CA would, and writes what it saw to the result file. It decides nothing itself beyond the
// individual checks; the test prints them.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const results = []
const check = (what, pass, detail) => results.push({ what, pass: !!pass, detail: pass ? '' : String(detail == null ? '' : detail).slice(0, 400) })
const finish = (extra) => { try { fs.writeFileSync(process.env.FSG_UI_RESULT, JSON.stringify({ results, ...extra })) } catch (e) { /* the test reports a missing file */ } }
setTimeout(() => { finish({ timeout: true }); app.exit(1) }, 80000)

const HELPERS = [
  "window.__row = (label) => [...document.querySelectorAll('tbody tr')].find(tr => tr.children[0] && tr.children[0].innerText.trim() === label)",
  "window.__setNum = (label, i, v) => { const el = window.__row(label).querySelectorAll('input[type=number]')[i]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }",
  "window.__box = (label) => window.__row(label).querySelector('[data-head-picker] input')",
  "window.__type = (label, v) => { const el = window.__box(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }",
  "window.__key = (label, key) => window.__box(label).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))",
  "window.__options = () => [...document.querySelectorAll('[role=option]')].map(x => x.innerText.trim())",
  "window.__groups = () => [...document.querySelectorAll('[data-head-picker] .uppercase')].map(x => x.innerText.trim().toLowerCase())",
  "window.__red = (label) => /border-red-400/.test(window.__box(label).className)",
  "window.__btn = (t) => [...document.querySelectorAll('button')].find(b => b.innerText.trim() === t || b.innerText.trim().startsWith(t))",
  "window.__text = () => document.body.innerText",
  'true',
].join('\n')

app.whenReady().then(async () => {
  const state = {}
  try {
    const w = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { backgroundThrottling: false } })
    const js = (s) => w.webContents.executeJavaScript(s, true)
    const wait = (ms) => new Promise(r => setTimeout(r, ms))
    const ready = async (bt) => {
      await w.loadFile(process.env.FSG_UI_HTML, { query: { bt } })   // a different query string is a new page (a different #hash would not reload it)
      for (let i = 0; i < 100 && !(await js("!!document.querySelector('table')")); i++) await wait(100)
      await js(HELPERS)
    }
    const insist = async (what, fn) => { try { await fn() } catch (e) { check(what, false, e && e.message); throw e } }

    // ── a Manufacturer ──
    await ready('Manufacturer')
    check('column heading "Adjusted in (P&L)"', /Adjusted in \(P&L\)/.test(await js('window.__text()')))
    const rm = await js("window.__row('Raw Materials').innerText")
    check('Manufacturer: Raw Materials -> Cost of materials consumed, with the fallback said', /Cost of materials consumed/.test(rm) && /no such line/.test(rm), rm)
    check('the four other fixed rows say Changes in inventories', await js("['Work in Progress', 'Finished Goods', 'Stock-in-Trade', 'Uncategorised Stock'].every(l => /Changes in inventories/.test(window.__row(l).innerText))"))
    check('the five fixed rows have no head box; Stores & Spares, Loose Tools and Others have one', await js("['Raw Materials', 'Work in Progress', 'Finished Goods', 'Stock-in-Trade', 'Uncategorised Stock'].every(l => !window.__row(l).querySelector('[data-head-picker]')) && ['Stores & Spares', 'Loose Tools', 'Others'].every(l => !!window.__box(l))"))
    check('nothing is red while there are no amounts', await js("['Stores & Spares', 'Loose Tools', 'Others'].every(l => !window.__red(l))"))

    // an amount, and no head
    await insist('an amount can be typed', async () => { await js("window.__setNum('Stores & Spares', 0, '50000')"); await wait(150) })
    check('an amount turns that row\'s box red and says what is needed; the other two stay quiet', await js("window.__red('Stores & Spares') && /Needed: the Other expenses line/.test(window.__row('Stores & Spares').innerText) && !window.__red('Loose Tools') && !window.__red('Others')"))
    await js("window.__setNum('Others', 3, '700')"); await wait(150)
    check('a Previous Year amount makes Others ask too', await js("window.__red('Others')"))
    await js("window.__setNum('Others', 3, '')"); await wait(150)
    check('...and clearing the amount takes the red away', await js("!window.__red('Others')"))
    await js("window.__btn('Save Stock Entries').click()"); await wait(400)
    check('Save is held, with a message naming the row, and nothing is sent', /Name the Other Expenses head for Stores & Spares before saving/.test(await js('window.__text()')) && (await js('window.__saved.length')) === 0)

    // the pick-list, opened by a real click (the page is given focus first, as it has when the app is in use)
    w.webContents.focus()
    const at = await js("(() => { const b = window.__box('Stores & Spares').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } })()")
    w.webContents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 })
    w.webContents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 })
    await wait(300)
    if (!(await js('window.__options().length'))) { state.clickNeededFocusEvent = true; await js("window.__box('Stores & Spares').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))"); await wait(300) }
    const opts = await js('window.__options()'), groups = await js('window.__groups()')
    check('clicking the box lists this Trial Balance\'s heads first, then the standard ones, each once',
      JSON.stringify(groups) === JSON.stringify(['in this trial balance', 'standard heads']) && opts[0] === 'Rent' && opts[1] === 'Consumption of stores and spare parts' &&
      opts.filter(o => o === 'Rent').length === 1 && opts.filter(o => /^Consumption/.test(o)).length === 1 && opts.includes('Power and fuel') && opts.length === 8, JSON.stringify({ groups, opts }))
    await js("window.__type('Stores & Spares', 'cons')"); await wait(200)
    const narrowed = await js('window.__options()')
    check('typing narrows it: the match first, then what was typed as a new head', narrowed.length === 2 && narrowed[0] === 'Consumption of stores and spare parts' && /^Use .cons. as a new head$/.test(narrowed[1]), JSON.stringify(narrowed))
    await js("window.__key('Stores & Spares', 'ArrowDown')"); await wait(150)   // separate key presses, as a person makes them
    await js("window.__key('Stores & Spares', 'Enter')"); await wait(250)
    check('Arrow down + Enter picks the match: the box shows it, the list closes, the red is gone', await js("window.__box('Stores & Spares').value === 'Consumption of stores and spare parts' && window.__options().length === 0 && !window.__red('Stores & Spares')"))
    // the box still has focus after a pick: a second click on it must open the list again (no focus event comes)
    await js("window.__box('Stores & Spares').click()"); await wait(250)
    check('clicking the box again (it still has focus) opens the list', (await js('window.__options().length')) > 0)
    await js("document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))"); await wait(250)
    check('...and clicking elsewhere closes it, the head unchanged', await js("window.__options().length === 0 && window.__box('Stores & Spares').value === 'Consumption of stores and spare parts'"))
    await js("window.__setNum('Loose Tools', 0, '10000'); window.__setNum('Loose Tools', 1, '4000')"); await wait(150)
    await js("window.__type('Loose Tools', '  Tools consumed ')"); await wait(250)
    const typed = await js('window.__options()')
    check('a name that is in no list is offered as a new head', /^Use .Tools consumed. as a new head$/.test(typed[typed.length - 1] || ''), JSON.stringify(typed))
    await js("window.__key('Loose Tools', 'Enter')"); await wait(250)
    check('Enter keeps what was typed, tidied of spaces', await js("window.__box('Loose Tools').value === 'Tools consumed' && !window.__red('Loose Tools')"))
    await js("window.__type('Others', 'rent')"); await wait(200)
    await js("document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))"); await wait(250)
    check('clicking elsewhere keeps what was typed, matched to the listed spelling', await js("window.__box('Others').value === 'Rent'"))
    await js("window.__row('Others').querySelector('[data-head-picker] button[title=Clear]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))"); await wait(200)
    check('the × clears a head', await js("window.__box('Others').value === ''"))

    // saving
    await js("window.__btn('Save Stock Entries').click()"); await wait(600)
    const saved = JSON.parse(await js('JSON.stringify(window.__saved)'))
    const s1 = saved[0] || {}
    check('one save: the amounts and exactly the two heads (Others has no amount, so none)', s1.stockData && s1.stockData.opening['Stores & Spares'] === '50000' && s1.stockData.opening['Loose Tools'] === '10000' && s1.stockData.closing['Loose Tools'] === '4000' &&
      JSON.stringify(s1.stockData.heads) === JSON.stringify({ 'Stores & Spares': 'Consumption of stores and spare parts', 'Loose Tools': 'Tools consumed' }), JSON.stringify(saved))
    check('the screen reloads what was saved: heads shown, nothing red, success message', await js("window.__box('Stores & Spares').value === 'Consumption of stores and spare parts' && window.__box('Loose Tools').value === 'Tools consumed' && !window.__red('Stores & Spares') && /Stock entries saved/.test(window.__text())"))
    await js("window.__setNum('Others', 1, '2500')"); await wait(150)
    check('Others asks as soon as it has an amount', await js("window.__red('Others')"))
    await js("window.__type('Others', 'Packing material consumed')"); await wait(150)
    await js("window.__key('Others', 'Enter')"); await wait(250)
    await js("window.__btn('Save Stock Entries').click()"); await wait(600)
    const s2 = JSON.parse(await js('JSON.stringify(window.__saved)'))[1] || {}
    check('a second save carries all three heads', s2.stockData && s2.stockData.heads && s2.stockData.heads.Others === 'Packing material consumed' && s2.stockData.heads['Loose Tools'] === 'Tools consumed' && s2.stockData.heads['Stores & Spares'] === 'Consumption of stores and spare parts')

    // ── a Trader: where Raw Materials lands ──
    await ready('Trader')
    check('Trader: Raw Materials is adjusted in Changes in inventories (no fallback hint)', await js("(() => { const t = window.__row('Raw Materials').innerText; return /Changes in inventories/.test(t) && !/no such line/.test(t) })()"))
  } catch (e) {
    state.error = e && e.message
  }
  finish(state)
  app.exit(0)
})
