import fs from 'node:fs'
import path from 'node:path'
import { format } from 'node:util'

const MAX_LOG_BYTES = 1024 * 1024
const STREAM_METHODS = {
  stdout: ['log', 'info', 'debug'],
  stderr: ['warn', 'error'],
}

export function installDevOutputGuard({
  stdout = process.stdout,
  stderr = process.stderr,
  consoleObject = console,
  getLogFile,
  maxLogBytes = MAX_LOG_BYTES,
}) {
  if (typeof getLogFile !== 'function') throw new Error('A development log path resolver is required.')

  const fileFallbackActive = { stdout: false, stderr: false }
  const appendDiagnostic = (streamName, message) => {
    const logFile = getLogFile()
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
    const timestamp = new Date().toISOString()
    let record = Buffer.from(`[${timestamp}] [${streamName}] ${message}\n`)
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

  return { fileFallbackActive }
}
