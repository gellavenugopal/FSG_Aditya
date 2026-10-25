const path = require('node:path')
const { app } = require('electron')
const { writeFileSync } = require('node:fs')

const logPath = path.resolve(__dirname, '..', '..', 'artifacts', 'synthetic-report-render.log')
const log = message => {
  writeFileSync(logPath, `${new Date().toISOString()} ${message}\n`, { flag: 'a' })
}

app.whenReady().then(() => import('../render-synthetic-engagement-report.mjs'))
  .catch(error => {
    log(error?.stack || String(error))
    app.exit(1)
  })
