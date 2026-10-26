import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installDevOutputGuard } from '../src/main/dev-output-guard.js'

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-dev-output-guard-'))
const logFile = path.join(tempDirectory, 'dev-output.log')
const stdout = new EventEmitter()
const stderr = new EventEmitter()
const calls = []
const consoleObject = Object.fromEntries(
  ['log', 'info', 'debug', 'warn', 'error'].map(method => [method, (...args) => calls.push([method, ...args])])
)

try {
  const state = installDevOutputGuard({ stdout, stderr, consoleObject, getLogFile: () => logFile, maxLogBytes: 1024 })
  stdout.emit('error', Object.assign(new Error('closed stdout'), { code: 'EPIPE' }))
  consoleObject.info('HMR update %s', 'module')
  assert.equal(state.fileFallbackActive.stdout, true)
  assert.equal(state.fileFallbackActive.stderr, false)
  const initialLogs = [logFile, `${logFile}.1`]
    .filter(file => fs.existsSync(file))
    .map(file => fs.readFileSync(file, 'utf8'))
    .join('')
  assert.match(initialLogs, /output consumer disconnected \(EPIPE\)/)
  assert.match(initialLogs, /HMR update module/)
  assert.deepEqual(calls, [])

  const unrelatedError = Object.assign(new Error('unrelated stream failure'), { code: 'EIO' })
  assert.throws(() => stderr.emit('error', unrelatedError), error => error === unrelatedError)

  for (let index = 0; index < 20; index++) consoleObject.log('bounded diagnostic %d %s', index, 'x'.repeat(32))
  assert.ok(fs.statSync(logFile).size <= 1024)
  assert.ok(fs.statSync(`${logFile}.1`).size <= 1024)
  console.log('Development output guard self-test passed.')
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true })
}
