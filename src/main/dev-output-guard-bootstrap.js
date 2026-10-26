import { app } from 'electron'
import path from 'node:path'
import { installDevOutputGuard } from './dev-output-guard.js'

if (process.env.NODE_ENV === 'development') {
  installDevOutputGuard({
    getLogFile: () => path.join(
      process.env.FSG_TEST_USER_DATA_PATH || app.getPath('userData'),
      'dev-output.log'
    ),
  })
}
