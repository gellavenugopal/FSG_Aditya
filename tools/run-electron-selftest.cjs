const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')

// Runs an ES-module self-test inside Electron's main process (the legacy DB modules import Electron APIs),
// with a throwaway userData folder so no real profile is read or written.
const script = path.resolve(process.argv[2] || '')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-selftest-userdata-'))
app.setPath('userData', userData)
app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  let code = 0
  try {
    // The app's .js sources use ESM syntax without "type":"module"; bundle them as electron-vite does.
    const bundle = path.join(userData, 'selftest-bundle.mjs')
    await require('esbuild').build({
      entryPoints: [script], outfile: bundle, bundle: true, platform: 'node', format: 'esm',
      external: ['electron', 'pg-native'], logLevel: 'error', absWorkingDir: process.cwd(),
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    })
    await import(pathToFileURL(bundle).href)
  } catch (error) {
    console.error('FAIL', error && error.stack || error)
    code = 1
  }
  try { fs.rmSync(userData, { recursive: true, force: true }) } catch { /* temp folder only */ }
  app.exit(code)
})
