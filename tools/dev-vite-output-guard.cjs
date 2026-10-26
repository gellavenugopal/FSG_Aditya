'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { format } = require('node:util')

const MAX_LOG_BYTES = 1024 * 1024
const STREAM_METHODS = {
  stdout: ['log', 'info', 'debug'],
  stderr: ['warn', 'error'],
}

function installDevOutputGuard({
  stdout = process.stdout,
  stderr = process.stderr,
  consoleObject = console,
  logFile,
  maxLogBytes = MAX_LOG_BYTES,
}) {
  if (typeof logFile !== 'string' || logFile.length === 0) {
    throw new Error('A development output log path is required.')
  }

  const fileFallbackActive = { stdout: false, stderr: false }
  const appendDiagnostic = (streamName, message) => {
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
    let record = Buffer.from(`[${new Date().toISOString()}] [${streamName}] ${message}\n`)
    if (record.length > maxLogBytes) record = record.subarray(record.length - maxLogBytes)

    if (fs.existsSync(logFile) && fs.statSync(logFile).size + record.length > maxLogBytes) {
      const previousLog = `${logFile}.1`
      if (fs.existsSync(previousLog)) fs.unlinkSync(previousLog)
      fs.renameSync(logFile, previousLog)
    }
    fs.appendFileSync(logFile, record)
  }

  for (const [streamName, stream] of Object.entries({ stdout, stderr })) {
    stream.on('error', error => {
      if (error?.code !== 'EPIPE') throw error
      if (fileFallbackActive[streamName]) return
      fileFallbackActive[streamName] = true
      appendDiagnostic(streamName, `output consumer disconnected (EPIPE): ${error.stack || error.message}`)
      for (const method of STREAM_METHODS[streamName]) {
        consoleObject[method] = (...args) => appendDiagnostic(streamName, format(...args))
      }
    })
  }

  return { fileFallbackActive, appendDiagnostic }
}

if (process.env.FSG_DEV_OUTPUT_GUARD_ENABLED === '1') {
  const { appendDiagnostic } = installDevOutputGuard({
    logFile: process.env.FSG_DEV_OUTPUT_GUARD_LOG_FILE,
  })
  appendDiagnostic('launcher', JSON.stringify({
    event: 'vite-process-startup',
    pid: process.pid,
    parentPid: process.ppid,
    timestamp: new Date().toISOString(),
    executable: process.execPath,
    commandLine: process.argv.join(' '),
    sourceCheckout: process.env.FSG_DEV_SOURCE_CHECKOUT,
    launcherVersion: process.env.FSG_DEV_LAUNCHER_VERSION,
    packageVersion: process.env.FSG_DEV_PACKAGE_VERSION,
    cwd: process.cwd(),
  }))
}

module.exports = { installDevOutputGuard }
