import { appendFileSync } from 'fs'

// A screen that dies or stops answering must never leave a blank white window with nothing written on it. When the
// Rectification screen was asked to draw 67,000 ledgers at once, its process ran out of memory and Windows kept the title bar
// and an empty white window for as long as the app stayed open. Now the user is told what happened and the screen is reloaded,
// and a line is kept in screen-problems.log (in the app's data folder) so the screen and the reason can be traced afterwards.
// Kept apart from index.js so tools/selftest-large-branch.mjs can drive it with a stand-in window.
export function guardScreen(win, { dialog, logFile, log = console.error }) {
  let restartingScreen = false
  const note = (text) => {
    log(text)
    if (!logFile) return
    try { appendFileSync(logFile, `${new Date().toISOString()}  ${text}\n`) } catch (_) {}
  }

  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit' || win.isDestroyed()) return
    const asked = restartingScreen
    restartingScreen = false
    note(`screen process gone: ${details.reason} (exit code ${details.exitCode})${asked ? ' - restarted by the user' : ''}`)
    if (!asked) {
      try {
        Promise.resolve(dialog.showMessageBox(win, {
          type: 'error', title: 'FSG Bharat', buttons: ['OK'], defaultId: 0,
          message: 'The screen stopped working and is being reloaded.',
          detail: `Reason: ${details.reason === 'oom' ? 'it ran out of memory' : details.reason}.\n\nEverything already saved is safe; anything typed on that screen but not yet saved is lost. If this happens again, please note which screen it was and how many ledgers it was showing.`,
        })).catch(() => {})
      } catch (_) {}
    }
    win.webContents.reload()
  })

  win.on('unresponsive', async () => {
    note('screen not responding')
    let response = 0
    try {
      ;({ response } = await dialog.showMessageBox(win, {
        type: 'warning', title: 'FSG Bharat', buttons: ['Keep waiting', 'Reload the screen'], defaultId: 0, cancelId: 0,
        message: 'This screen is taking a very long time.',
        detail: 'A screen with tens of thousands of ledgers can take a minute or more. Choose "Keep waiting" to give it more time, or "Reload the screen" to stop it and start again (anything on this screen that is not yet saved is lost).',
      }))
    } catch (_) {}
    if (response === 1 && !win.isDestroyed()) { restartingScreen = true; win.webContents.forcefullyCrashRenderer() }
  })
}
