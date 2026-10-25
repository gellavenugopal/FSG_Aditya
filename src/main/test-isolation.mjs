import { mkdirSync, readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import path from 'node:path'

const REQUIRED_TEST_DATABASE_FIELDS = [
  'FSG_TEST_DB_HOST',
  'FSG_TEST_DB_PORT',
  'FSG_TEST_DB_NAME',
  'FSG_TEST_DB_USER',
  'FSG_TEST_DB_PASSWORD',
  'FSG_TEST_TARGET_FILE',
  'FSG_TEST_USER_DATA_PATH',
]

function resolvedPath(value) {
  return path.resolve(String(value || ''))
}

function normalizePath(value) {
  return resolvedPath(value).replace(/[\\/]+$/, '').toLowerCase()
}

export function isDisposableTestMode(env = process.env) {
  return env.FSG_TEST_MODE === 'true'
}

export function resolveDisposableTestTarget(env = process.env, readTarget = filePath => JSON.parse(readFileSync(filePath, 'utf8'))) {
  if (!isDisposableTestMode(env)) throw new Error('Disposable test mode must be explicitly enabled with FSG_TEST_MODE=true.')
  if (env.ENGAGEMENT_SERVICE_URL || env.ENGAGEMENT_DATABASE_URL || env.ENGAGEMENT_DB_HOST || env.ENGAGEMENT_DB_PORT
    || env.ENGAGEMENT_DB_NAME || env.ENGAGEMENT_DB_USER || env.ENGAGEMENT_DB_PASSWORD) {
    throw new Error('Conflicting ENGAGEMENT_DATABASE_URL/ENGAGEMENT_DB_* configuration is forbidden in disposable test mode.')
  }

  const missing = REQUIRED_TEST_DATABASE_FIELDS.filter(key => !String(env[key] || '').trim())
  if (missing.length) throw new Error(`Disposable test configuration is incomplete: ${missing.join(', ')}.`)

  const port = Number(env.FSG_TEST_DB_PORT)
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 5432) {
    throw new Error('FSG_TEST_DB_PORT must be an explicit non-default PostgreSQL port between 1024 and 65535.')
  }
  const databaseConfig = {
    host: env.FSG_TEST_DB_HOST.trim(),
    port,
    database: env.FSG_TEST_DB_NAME.trim(),
    user: env.FSG_TEST_DB_USER.trim(),
    password: env.FSG_TEST_DB_PASSWORD,
  }
  if (databaseConfig.host !== '127.0.0.1' || databaseConfig.database === 'vera_financial'
    || databaseConfig.user.toLowerCase() === 'postgres') {
    throw new Error('Disposable test connections must use loopback, a dedicated database, and a non-postgres test user.')
  }

  const targetFile = resolvedPath(env.FSG_TEST_TARGET_FILE)
  if (!path.isAbsolute(env.FSG_TEST_TARGET_FILE)) throw new Error('FSG_TEST_TARGET_FILE must be an absolute path.')
  if (!path.isAbsolute(env.FSG_TEST_USER_DATA_PATH)) throw new Error('FSG_TEST_USER_DATA_PATH must be an absolute path.')
  const target = readTarget(targetFile)
  if (!target || typeof target !== 'object') throw new Error('Disposable test target manifest is invalid.')
  const targetPort = Number(target.port)
  if (target.host !== databaseConfig.host || targetPort !== databaseConfig.port
    || target.database !== databaseConfig.database || target.user !== databaseConfig.user) {
    throw new Error('Disposable test connection does not match the PostgreSQL instance created by the test harness.')
  }
  if (typeof target.instanceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(target.instanceId)
    || !String(target.dataDirectory || '').trim() || !String(target.userDataPath || '').trim()) {
    throw new Error('Disposable test target manifest is missing its instance identity or isolated paths.')
  }
  if (!path.isAbsolute(target.dataDirectory) || !path.isAbsolute(target.userDataPath)) {
    throw new Error('Disposable test PostgreSQL and user-data paths must be absolute.')
  }
  if (normalizePath(env.FSG_TEST_USER_DATA_PATH) !== normalizePath(target.userDataPath)) {
    throw new Error('FSG_TEST_USER_DATA_PATH does not match the isolated user-data path in the test harness manifest.')
  }
  const dataPath = normalizePath(target.dataDirectory)
  const userData = normalizePath(target.userDataPath)
  const pathContains = (parent, child) => child.startsWith(`${parent}\\`) || child.startsWith(`${parent}/`)
  if (dataPath === userData || pathContains(dataPath, userData) || pathContains(userData, dataPath)) {
    throw new Error('PostgreSQL data and Electron user-data directories must be separate.')
  }

  return {
    databaseConfig,
    target: {
      host: target.host,
      port: targetPort,
      database: target.database,
      user: target.user,
      instanceId: target.instanceId,
      dataDirectory: resolvedPath(target.dataDirectory),
      userDataPath: resolvedPath(target.userDataPath),
    },
  }
}

export function loadDatabaseConfig(env, loadSavedConfig, readTarget) {
  if (isDisposableTestMode(env)) return resolveDisposableTestTarget(env, readTarget).databaseConfig
  return loadSavedConfig()
}

export function configureDisposableTestUserData(app, env = process.env, readTarget) {
  if (!isDisposableTestMode(env)) return null
  if (app.isPackaged) throw new Error('Disposable test mode cannot run in a packaged application.')
  const { target } = resolveDisposableTestTarget(env, readTarget)
  const previous = normalizePath(app.getPath('userData'))
  const isolated = normalizePath(target.userDataPath)
  if (previous === isolated || isolated.startsWith(`${previous}\\`) || isolated.startsWith(`${previous}/`)) {
    throw new Error('Disposable test user-data path must be separate from the normal application profile.')
  }
  mkdirSync(target.userDataPath, { recursive: true })
  app.setPath('userData', target.userDataPath)
  const effective = normalizePath(app.getPath('userData'))
  if (effective !== isolated) throw new Error('Electron did not apply the explicitly configured disposable user-data path.')
  return target.userDataPath
}

export function assertDatabaseOptionsMatchDisposableTarget(databaseOptions, env = process.env, readTarget) {
  const { databaseConfig, target } = resolveDisposableTestTarget(env, readTarget)
  for (const key of ['host', 'database', 'user']) {
    if (databaseOptions?.[key] !== databaseConfig[key]) {
      throw new Error(`Engagement service ${key} does not match the disposable test target.`)
    }
  }
  if (Number(databaseOptions?.port) !== databaseConfig.port
    || databaseOptions?.password !== databaseConfig.password) {
    throw new Error('Engagement service credentials do not match the explicit disposable test configuration.')
  }
  return target
}

export function shouldInitializeLegacyDatabase(env = process.env) {
  return !isDisposableTestMode(env)
}

function isLoopbackServiceUrl(value) {
  if (!value) return false
  try {
    const hostname = new URL(value).hostname.replace(/^\[|\]$/g, '').toLowerCase()
    return hostname === 'localhost' || hostname === '::1' || (isIP(hostname) === 4 && hostname.startsWith('127.'))
  } catch {
    return false
  }
}

export function getApplicationStartupPlan(env = process.env, isPackaged = false) {
  const testMode = isDisposableTestMode(env)
  const development = !isPackaged
    && (env.NODE_ENV_ELECTRON_VITE === 'development' || env.NODE_ENV === 'development')
  const localDevelopmentService = testMode || (development
    && (!env.ENGAGEMENT_SERVICE_URL || isLoopbackServiceUrl(env.ENGAGEMENT_SERVICE_URL)))
  const serviceOnlyMode = testMode
    || String(env.ENGAGEMENT_SERVICE_ONLY || '').toLowerCase() === 'true'
    || Boolean(env.ENGAGEMENT_SERVICE_URL && !localDevelopmentService)
  return {
    testMode,
    localDevelopmentService,
    serviceOnlyMode,
    initializeLegacyDatabase: !serviceOnlyMode && shouldInitializeLegacyDatabase(env),
    registerLegacyIpc: !serviceOnlyMode && shouldInitializeLegacyDatabase(env),
  }
}
