import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDisposableTestMode, resolveDisposableTestTarget } from '../src/main/test-isolation.mjs'

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const launcherPath = path.join(repositoryRoot, 'tools', 'dev-launcher.mjs')
const startupTimeoutMs = 120_000
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

if (!isDisposableTestMode()) {
  throw new Error('The launcher disconnect test requires the verified disposable test mode.')
}

const { target } = resolveDisposableTestTarget()
const logFile = path.join(target.userDataPath, 'dev-launcher.log')
const viteLogFile = path.join(target.userDataPath, 'dev-vite-output.log')
const initialLogBytes = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0
const initialViteLogBytes = fs.existsSync(viteLogFile) ? fs.statSync(viteLogFile).size : 0
const child = spawn(process.execPath, [launcherPath], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
  windowsHide: false,
})

let childError = null
child.on('error', error => { childError = error })
let startupOutput = ''
let disconnected = false
let stderrOutput = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', chunk => {
  if (!disconnected) startupOutput = (startupOutput + chunk).slice(-16_384)
})
child.stderr.on('data', chunk => {
  if (!disconnected) stderrOutput = (stderrOutput + chunk).slice(-16_384)
})

function currentRunLog() {
  if (!fs.existsSync(logFile)) return ''
  const contents = fs.readFileSync(logFile)
  return contents.subarray(Math.min(initialLogBytes, contents.length)).toString('utf8')
}

function currentViteLog() {
  if (!fs.existsSync(viteLogFile)) return ''
  const contents = fs.readFileSync(viteLogFile)
  return contents.subarray(Math.min(initialViteLogBytes, contents.length)).toString('utf8')
}

async function waitFor(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (childError) throw childError
    if (child.exitCode !== null) throw new Error(`Development launcher exited early: ${message}`)
    if (predicate()) return
    await delay(250)
  }
  throw new Error(`Timed out waiting for ${message}`)
}

try {
  await waitFor(
    () => startupOutput.includes('start electron app...'),
    startupTimeoutMs,
    `Electron startup output; stderr=${stderrOutput}`,
  )

  await delay(1_000)
  child.stdout.destroy()
  child.stderr.destroy()
  disconnected = true

  await waitFor(
    () => currentRunLog().includes(`"pid":${child.pid}`) &&
      currentRunLog().includes('stdout consumer closed (EPIPE)'),
    15_000,
    'the launcher to switch to bounded file logging after its output consumer closes',
  )
  await waitFor(
    () => currentRunLog().includes('Local development engagement service started'),
    startupTimeoutMs,
    'the isolated desktop service startup',
  )
  await delay(2_000)
  assert.equal(child.exitCode, null, 'the launcher must remain alive while the Electron window is open')
  const viteStartupLine = currentViteLog().split(/\r?\n/).find(line => line.includes('"event":"vite-process-startup"'))
  assert.ok(viteStartupLine, 'the current electron-vite process must record its startup identity')
  const viteStartup = JSON.parse(viteStartupLine.slice(viteStartupLine.indexOf('{')))
  assert.equal(viteStartup.parentPid, child.pid)
  assert.equal(viteStartup.sourceCheckout, repositoryRoot)
  assert.match(viteStartup.commandLine, /electron-vite\.js dev/)

  console.log(`Output consumer disconnected; launcher PID=${child.pid}, electron-vite PID=${viteStartup.pid}, and the isolated desktop remained active.`)
  console.log('Close the isolated FSG Bharat window to complete the normal-shutdown check.')

  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  assert.deepEqual(result, { code: 0, signal: null }, 'the launcher should exit cleanly after closing Electron')
  const finalLog = currentRunLog()
  assert.match(finalLog, /electron-vite exited; code=0; signal=none\./)
  console.log(`Isolated launcher disconnect self-test passed (PID=${child.pid}).`)
} catch (error) {
  if (child.exitCode === null) {
    console.error(`The isolated desktop may still be running; close its window before retrying. ${error.message}`)
  }
  throw error
}
