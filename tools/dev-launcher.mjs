import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isDisposableTestMode, resolveDisposableTestTarget } from '../src/main/test-isolation.mjs'

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const electronViteCli = path.join(repositoryRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const outputGuardPreload = path.join(repositoryRoot, 'tools', 'dev-vite-output-guard.cjs')
const maximumLogBytes = 4 * 1024 * 1024
const maximumLogFiles = 3
const launcherVersion = 3

if (!fs.existsSync(electronViteCli)) throw new Error(`electron-vite CLI was not found at ${electronViteCli}`)
if (!fs.existsSync(outputGuardPreload)) throw new Error(`Development output guard was not found at ${outputGuardPreload}`)

const logDirectory = isDisposableTestMode()
  ? resolveDisposableTestTarget().target.userDataPath
  : path.resolve(process.env.FSG_DEV_LOG_DIRECTORY || path.join(os.tmpdir(), 'fsg-bharat-dev'))
fs.mkdirSync(logDirectory, { recursive: true })
const logFile = path.join(logDirectory, 'dev-launcher.log')
const outputGuardLogFile = path.join(logDirectory, 'dev-vite-output.log')
let child

function rotateLog(incomingBytes) {
  let currentBytes = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0
  if (currentBytes + incomingBytes <= maximumLogBytes) return
  for (let index = maximumLogFiles - 1; index >= 1; index--) {
    const source = index === 1 ? logFile : `${logFile}.${index - 1}`
    const destination = `${logFile}.${index}`
    if (fs.existsSync(destination)) fs.unlinkSync(destination)
    if (fs.existsSync(source)) fs.renameSync(source, destination)
  }
}

function appendLog(streamName, chunk) {
  const prefix = Buffer.from(`[${new Date().toISOString()}] [${streamName}] `)
  let remaining = Buffer.from(chunk)
  while (remaining.length) {
    rotateLog(prefix.length + Math.min(remaining.length, maximumLogBytes))
    const available = maximumLogBytes - (fs.existsSync(logFile) ? fs.statSync(logFile).size : 0)
    const end = Math.min(remaining.length, Math.max(1, available - prefix.length))
    fs.appendFileSync(logFile, Buffer.concat([prefix, remaining.subarray(0, end)]))
    remaining = remaining.subarray(end)
  }
}

const consoleAvailable = { stdout: true, stderr: true }
const waitingForDrain = { stdout: false, stderr: false }
const drainHandlers = {}

function markConsoleUnavailable(streamName) {
  if (!consoleAvailable[streamName]) return
  consoleAvailable[streamName] = false
  if (drainHandlers[streamName]) process[streamName].removeListener('drain', drainHandlers[streamName])
  waitingForDrain[streamName] = false
  child?.[streamName]?.resume()
  appendLog('launcher', `${streamName} consumer closed (EPIPE); continuing with bounded file logging.\n`)
}

function handleConsoleStreamError(streamName, error) {
  if (error?.code === 'EPIPE') {
    markConsoleUnavailable(streamName)
    return
  }
  setImmediate(() => { throw error })
}

process.stdout.on('error', error => handleConsoleStreamError('stdout', error))
process.stderr.on('error', error => handleConsoleStreamError('stderr', error))

function forwardOutput(streamName, chunk) {
  appendLog(streamName, chunk)
  if (!consoleAvailable[streamName] || waitingForDrain[streamName]) return
  try {
    const canContinue = process[streamName].write(chunk, error => {
      if (error) handleConsoleStreamError(streamName, error)
    })
    if (!canContinue) {
      waitingForDrain[streamName] = true
      drainHandlers[streamName] = () => {
        waitingForDrain[streamName] = false
        child?.[streamName]?.resume()
      }
      process[streamName].once('drain', drainHandlers[streamName])
      child?.[streamName]?.pause()
    }
  } catch (error) {
    handleConsoleStreamError(streamName, error)
  }
}

const packageVersion = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')).version
appendLog('launcher', `${JSON.stringify({
  event: 'startup',
  pid: process.pid,
  parentPid: process.ppid,
  timestamp: new Date().toISOString(),
  sourceCheckout: repositoryRoot,
  launcherVersion,
  packageVersion,
})}\n`)
const childEnvironment = {
  ...process.env,
  FSG_DEV_OUTPUT_GUARD_ENABLED: '1',
  FSG_DEV_OUTPUT_GUARD_LOG_FILE: outputGuardLogFile,
  FSG_DEV_SOURCE_CHECKOUT: repositoryRoot,
  FSG_DEV_LAUNCHER_VERSION: String(launcherVersion),
  FSG_DEV_PACKAGE_VERSION: packageVersion,
}
child = spawn(process.execPath, ['--require', outputGuardPreload, electronViteCli, 'dev'], {
  cwd: repositoryRoot,
  env: childEnvironment,
  stdio: ['inherit', 'pipe', 'pipe'],
  windowsHide: false,
})

child.stdout.on('data', chunk => forwardOutput('stdout', chunk))
child.stderr.on('data', chunk => forwardOutput('stderr', chunk))
let spawnFailed = false
child.on('error', error => {
  spawnFailed = true
  appendLog('launcher', `electron-vite spawn error: ${error.stack || error.message}\n`)
  forwardOutput('stderr', Buffer.from(`electron-vite failed to start: ${error.message}\n`))
  process.exitCode = 1
})

let shutdownRequested = false
function forwardSignal(signal) {
  if (shutdownRequested) return
  shutdownRequested = true
  appendLog('launcher', `Forwarding ${signal} to electron-vite pid=${child.pid || 'not-started'}.\n`)
  if (child.exitCode == null && !child.killed) child.kill(signal)
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => forwardSignal(signal))
}

child.on('close', (code, signal) => {
  appendLog('launcher', `electron-vite exited; code=${code}; signal=${signal || 'none'}.\n`)
  process.exitCode = spawnFailed ? 1 : (code ?? (signal ? 1 : 0))
})
