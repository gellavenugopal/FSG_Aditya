import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const { installDevOutputGuard } = require('./dev-vite-output-guard.cjs')
const guardPath = path.join(repositoryRoot, 'tools', 'dev-vite-output-guard.cjs')
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-dev-vite-output-guard-'))
const logFile = path.join(tempDirectory, 'dev-vite-output.log')

try {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const consoleCalls = []
  const consoleObject = Object.fromEntries(
    ['log', 'info', 'debug', 'warn', 'error'].map(method => [method, (...args) => consoleCalls.push([method, ...args])])
  )
  const guard = installDevOutputGuard({ stdout, stderr, consoleObject, logFile, maxLogBytes: 1024 })
  assert.equal(guard.fileFallbackActive.stdout, false)
  assert.equal(guard.fileFallbackActive.stderr, false)
  stdout.emit('error', Object.assign(new Error('closed stdout'), { code: 'EPIPE' }))
  consoleObject.info('diagnostic %s', 'routed to file')
  assert.equal(guard.fileFallbackActive.stdout, true)
  assert.match(fs.readFileSync(logFile, 'utf8'), /diagnostic routed to file/)
  const unrelatedError = Object.assign(new Error('unrelated stream failure'), { code: 'EIO' })
  assert.throws(() => stderr.emit('error', unrelatedError), error => error === unrelatedError)
  for (let index = 0; index < 30; index++) {
    consoleObject.info('bounded diagnostic %d %s', index, 'x'.repeat(64))
  }
  assert.ok(fs.statSync(logFile).size <= 1024)
  assert.ok(fs.statSync(`${logFile}.1`).size <= 1024)
  assert.deepEqual(consoleCalls, [])

  const cliLogFile = path.join(tempDirectory, 'cli-dev-vite-output.log')
  const completionFile = path.join(tempDirectory, 'cli-completed')
  const childScript = path.join(tempDirectory, 'hmr-child.cjs')
  fs.writeFileSync(childScript, `
    const fs = require('node:fs')
    const { createLogger } = require('vite')
    const logger = createLogger('info')
    process.stdout.write('READY\\\\n')
    function handleHMRUpdate() {
      logger.info('HMR update after output disconnect')
    }
    function onHMRUpdate() {
      handleHMRUpdate()
    }
    setTimeout(() => {
      onHMRUpdate()
      setTimeout(() => {
        onHMRUpdate()
        fs.writeFileSync(process.env.FSG_TEST_COMPLETION_FILE, 'alive')
        process.exit(0)
      }, 100)
    }, 150)
  `)

  const child = spawn(process.execPath, ['--require', guardPath, childScript], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_PATH: path.join(repositoryRoot, 'node_modules'),
      FSG_DEV_OUTPUT_GUARD_ENABLED: '1',
      FSG_DEV_OUTPUT_GUARD_LOG_FILE: cliLogFile,
      FSG_TEST_COMPLETION_FILE: completionFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdoutBuffer = ''
  let stderrBuffer = ''
  let outputDisconnected = false
  const timeout = setTimeout(() => child.kill(), 5000)

  child.stdout.on('data', chunk => {
    stdoutBuffer += chunk.toString()
    if (!outputDisconnected && stdoutBuffer.includes('READY')) {
      outputDisconnected = true
      child.stdout.destroy()
    }
  })
  child.stderr.on('data', chunk => { stderrBuffer += chunk.toString() })

  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  }).finally(() => clearTimeout(timeout))

  assert.equal(outputDisconnected, true, `child stdout did not disconnect; stderr=${stderrBuffer}`)
  assert.deepEqual(exit, { code: 0, signal: null }, `Vite HMR child did not survive output EPIPE; stderr=${stderrBuffer}`)
  assert.equal(fs.readFileSync(completionFile, 'utf8'), 'alive')
  const cliLogs = fs.readFileSync(cliLogFile, 'utf8')
  assert.match(cliLogs, /output consumer disconnected \(EPIPE\)/)
  assert.match(cliLogs, /HMR update after output disconnect/)
  assert.ok(fs.statSync(cliLogFile).size <= 1024 * 2)
  assert.deepEqual(consoleCalls, [])

  console.log(`Vite CLI output-disconnect self-test passed (PID=${child.pid}, parentPID=${process.pid}).`)
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true })
}
