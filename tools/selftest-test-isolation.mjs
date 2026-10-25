import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  assertDatabaseOptionsMatchDisposableTarget,
  configureDisposableTestUserData,
  getApplicationStartupPlan,
  isDisposableTestMode,
  loadDatabaseConfig,
  resolveDisposableTestTarget,
  shouldInitializeLegacyDatabase,
} from '../src/main/test-isolation.mjs'
import { startLocalEngagementService } from '../src/server/dev-engagement-service.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const { Pool } = require('pg')
const postgresRoot = 'C:\\Program Files\\PostgreSQL'
const versions = fs.existsSync(postgresRoot)
  ? fs.readdirSync(postgresRoot).filter(version => fs.existsSync(path.join(postgresRoot, version, 'bin', 'initdb.exe')))
      .sort((left, right) => parseFloat(right) - parseFloat(left))
  : []
const pgBin = versions[0] && path.join(postgresRoot, versions[0], 'bin')
if (!pgBin) throw new Error('PostgreSQL initdb.exe was not found under C:\\Program Files\\PostgreSQL.')

const run = (executable, args, timeout = 120000) => {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout, windowsHide: true })
  if (result.error || result.status !== 0) {
    const logPath = args.includes('-l') ? args[args.indexOf('-l') + 1] : null
    const logText = logPath && fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').slice(-4000) : ''
    throw new Error(`${path.basename(executable)} failed: ${result.error?.message || result.stderr || result.stdout || result.status}${logText ? `\n${logText}` : ''}`)
  }
  return result.stdout
}
const runQuiet = (executable, args, timeout = 120000) => {
  const result = spawnSync(executable, args, { stdio: 'ignore', timeout, windowsHide: true })
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(executable)} failed: ${result.error?.message || result.status}`)
  }
}
const freePort = () => new Promise((resolvePort, reject) => {
  const listener = net.createServer()
  listener.once('error', reject)
  listener.listen(0, '127.0.0.1', () => {
    const port = listener.address().port
    listener.close(error => error ? reject(error) : resolvePort(port))
  })
})
const sqlLiteral = value => `'${String(value).replace(/'/g, "''")}'`
const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-isolation-'))
const dataDirectory = path.join(rootDirectory, 'postgres-data')
const userDataPath = path.join(rootDirectory, 'electron-user-data')
const targetFile = path.join(rootDirectory, 'disposable-target.json')
const pgPort = await freePort()
const runtimePassword = crypto.randomBytes(24).toString('hex')
const adminPassword = crypto.randomBytes(24).toString('hex')
const instanceId = crypto.randomUUID()
const testDatabase = 'fsg_engagement_test'
const testUser = 'fsg_test_runtime'
const baseEnvironment = {
  FSG_TEST_MODE: 'true',
  FSG_TEST_DB_HOST: '127.0.0.1',
  FSG_TEST_DB_PORT: String(pgPort),
  FSG_TEST_DB_NAME: testDatabase,
  FSG_TEST_DB_USER: testUser,
  FSG_TEST_DB_PASSWORD: runtimePassword,
  FSG_TEST_TARGET_FILE: targetFile,
  FSG_TEST_USER_DATA_PATH: userDataPath,
}
const targetManifest = {
  host: '127.0.0.1',
  port: pgPort,
  database: testDatabase,
  user: testUser,
  instanceId,
  dataDirectory,
  userDataPath,
}

let assertions = 0
let postgresStarted = false
let bootstrapPool = null
let runtimePool = null
let service = null
const savedEnvironment = new Map()

function check(condition, message) {
  assertions++
  assert.ok(condition, message)
}

function rejects(action, pattern, message) {
  assertions++
  assert.throws(action, pattern, message)
}

function setTestEnvironment() {
  const keys = [
    ...Object.keys(baseEnvironment),
    'ENGAGEMENT_SERVICE_URL',
    'ENGAGEMENT_DATABASE_URL',
    'ENGAGEMENT_DB_HOST',
    'ENGAGEMENT_DB_PORT',
    'ENGAGEMENT_DB_NAME',
    'ENGAGEMENT_DB_USER',
    'ENGAGEMENT_DB_PASSWORD',
    'FSG_TEST_STARTUP_PROBE',
  ]
  for (const key of keys) {
    savedEnvironment.set(key, process.env[key])
    delete process.env[key]
  }
  Object.assign(process.env, baseEnvironment)
}

function restoreEnvironment() {
  for (const [key, value] of savedEnvironment) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function fixtureReadTarget(_filePath) {
  return targetManifest
}

function verifyFailClosedConfiguration() {
  rejects(
    () => resolveDisposableTestTarget({ FSG_TEST_MODE: 'true' }, () => { throw new Error('manifest must not be read') }),
    /configuration is incomplete/i,
    'missing configuration fails before reading a target or connecting'
  )

  rejects(
    () => resolveDisposableTestTarget({
      ...baseEnvironment,
      ENGAGEMENT_DB_HOST: 'localhost',
    }, fixtureReadTarget),
    /conflicting/i,
    'conflicting engagement database variables fail closed'
  )

  rejects(
    () => resolveDisposableTestTarget({
      ...baseEnvironment,
      ENGAGEMENT_SERVICE_URL: 'https://localhost:8443',
    }, fixtureReadTarget),
    /conflicting/i,
    'a configured remote service is rejected in disposable test mode'
  )

  let savedProfileReads = 0
  const loaded = loadDatabaseConfig(
    baseEnvironment,
    () => {
      savedProfileReads++
      return { host: 'localhost', port: 5432, database: 'vera_financial', user: 'postgres', password: 'redacted' }
    },
    fixtureReadTarget
  )
  check(savedProfileReads === 0, 'test-mode configuration never invokes the saved-profile loader')
  check(loaded.database === testDatabase && loaded.user === testUser && loaded.port === pgPort,
    'test-mode configuration resolves only explicit test credentials')

  const productionTarget = {
    ...targetManifest,
    host: 'localhost',
    port: 5432,
    database: 'vera_financial',
    user: 'postgres',
  }
  let connectionAttempts = 0
  rejects(() => {
    const config = {
      ...baseEnvironment,
      FSG_TEST_DB_HOST: 'localhost',
      FSG_TEST_DB_PORT: '5432',
      FSG_TEST_DB_NAME: 'vera_financial',
      FSG_TEST_DB_USER: 'postgres',
    }
    assertDatabaseOptionsMatchDisposableTarget({
      host: config.FSG_TEST_DB_HOST,
      port: Number(config.FSG_TEST_DB_PORT),
      database: config.FSG_TEST_DB_NAME,
      user: config.FSG_TEST_DB_USER,
      password: config.FSG_TEST_DB_PASSWORD,
    }, config, () => productionTarget)
    connectionAttempts++
  }, /non-default PostgreSQL port|loopback, a dedicated database/i,
  'production-target configuration is rejected before the connection step')
  check(connectionAttempts === 0, 'rejected production target caused zero connection attempts')

  rejects(() => resolveDisposableTestTarget({
    ...baseEnvironment,
    FSG_TEST_DB_NAME: 'vera_financial',
  }, fixtureReadTarget), /dedicated database|does not match/i,
  'production database selection is rejected by target-manifest mismatch')

  check(isDisposableTestMode(baseEnvironment), 'test mode requires explicit mode selection')
  check(!shouldInitializeLegacyDatabase(baseEnvironment), 'test mode disables legacy initialization')
  check(shouldInitializeLegacyDatabase({}), 'normal mode retains legacy initialization behavior')
  const testStartup = getApplicationStartupPlan(baseEnvironment)
  check(testStartup.serviceOnlyMode && testStartup.localDevelopmentService
    && !testStartup.initializeLegacyDatabase && !testStartup.registerLegacyIpc,
  'test startup selects the embedded service and disables legacy initialization and IPC registration')
  const externalServiceStartup = getApplicationStartupPlan({
    ENGAGEMENT_SERVICE_URL: 'https://service.example.test',
  })
  check(externalServiceStartup.serviceOnlyMode
    && !externalServiceStartup.initializeLegacyDatabase
    && !externalServiceStartup.registerLegacyIpc,
  'explicit service-only mode disables legacy initialization and IPC registration')

  const fakeApp = {
    isPackaged: false,
    currentPath: path.join(rootDirectory, 'normal-user-data'),
    getPath(name) {
      assert.equal(name, 'userData')
      return this.currentPath
    },
    setPath(name, value) {
      assert.equal(name, 'userData')
      this.currentPath = value
    },
  }
  const effectivePath = configureDisposableTestUserData(fakeApp, baseEnvironment, fixtureReadTarget)
  check(path.resolve(effectivePath) === path.resolve(userDataPath)
    && path.resolve(fakeApp.getPath('userData')) === path.resolve(userDataPath),
  'Electron userData is explicitly set and its effective value is verified')

  rejects(() => resolveDisposableTestTarget({
    ...baseEnvironment,
    FSG_TEST_DB_USER: 'someone-else',
  }, fixtureReadTarget), /does not match/i, 'service user must match the harness manifest')

  return loaded
}

try {
  fs.mkdirSync(userDataPath, { recursive: true })
  fs.writeFileSync(targetFile, JSON.stringify(targetManifest), 'utf8')
  const testDatabaseConfig = verifyFailClosedConfiguration()
  setTestEnvironment()

  run(path.join(pgBin, 'initdb.exe'), [
    '-D', dataDirectory, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '-N',
  ])
  postgresStarted = true
  runQuiet(path.join(pgBin, 'pg_ctl.exe'), [
    '-D', dataDirectory,
    '-o', `-h 127.0.0.1 -p ${pgPort} -c listen_addresses=127.0.0.1`,
    '-l', path.join(rootDirectory, 'postgres.log'),
    '-w', 'start',
  ])

  bootstrapPool = new Pool({
    host: '127.0.0.1', port: pgPort, database: 'postgres', user: 'postgres',
  })
  await bootstrapPool.query(`ALTER ROLE postgres PASSWORD ${sqlLiteral(adminPassword)}`)
  await bootstrapPool.query(`CREATE ROLE ${testUser} LOGIN PASSWORD ${sqlLiteral(runtimePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`)
  await bootstrapPool.query(`CREATE DATABASE ${testDatabase} OWNER ${testUser}`)
  await bootstrapPool.query(`REVOKE CONNECT ON DATABASE postgres FROM PUBLIC`)
  await bootstrapPool.query(`REVOKE CONNECT ON DATABASE template1 FROM PUBLIC`)
  await bootstrapPool.query(`GRANT CONNECT ON DATABASE postgres TO postgres`)
  await bootstrapPool.query(`GRANT CONNECT ON DATABASE template1 TO postgres`)
  await bootstrapPool.end()
  bootstrapPool = null

  const hbaPath = path.join(dataDirectory, 'pg_hba.conf')
  const hba = fs.readFileSync(hbaPath, 'utf8')
  const hardenedHba = hba.replace(
    /^host\s+all\s+all\s+127\.0\.0\.1\/32\s+trust\s*$/m,
    'host all all 127.0.0.1/32 scram-sha-256'
  )
  if (hardenedHba === hba) throw new Error('Could not harden disposable PostgreSQL host authentication to SCRAM.')
  fs.writeFileSync(hbaPath, hardenedHba, 'utf8')
  runQuiet(path.join(pgBin, 'pg_ctl.exe'), ['-D', dataDirectory, '-m', 'fast', '-w', 'stop'])
  runQuiet(path.join(pgBin, 'pg_ctl.exe'), [
    '-D', dataDirectory,
    '-o', `-h 127.0.0.1 -p ${pgPort} -c listen_addresses=127.0.0.1`,
    '-l', path.join(rootDirectory, 'postgres.log'),
    '-w', 'start',
  ])

  runtimePool = new Pool({
    ...testDatabaseConfig,
    application_name: 'fsg-isolation-harness-bootstrap',
  })
  await runtimePool.query(`
    CREATE TABLE public.fsg_test_instance_identity (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      instance_id TEXT NOT NULL,
      data_directory TEXT NOT NULL
    )
  `)
  await runtimePool.query(
    'INSERT INTO public.fsg_test_instance_identity(singleton, instance_id, data_directory) VALUES (TRUE, $1, $2)',
    [instanceId, dataDirectory]
  )
  await runtimePool.query(`
    CREATE TABLE entities (id SERIAL PRIMARY KEY, name TEXT);
    CREATE TABLE global_signatories (id SERIAL PRIMARY KEY, name TEXT);
    CREATE TABLE financial_periods (id SERIAL PRIMARY KEY, year_label TEXT, date_from DATE, date_till DATE);
    CREATE TABLE entity_periods (id SERIAL PRIMARY KEY, entity_id INTEGER REFERENCES entities(id),
      financial_period_id INTEGER REFERENCES financial_periods(id));
    CREATE TABLE trial_balances (id SERIAL PRIMARY KEY);
    CREATE TABLE mapping_rule_sets (id SERIAL PRIMARY KEY);
  `)

  const target = assertDatabaseOptionsMatchDisposableTarget(testDatabaseConfig)
  check(target.instanceId === instanceId && path.resolve(target.dataDirectory) === path.resolve(dataDirectory),
    'service target is validated against the harness-owned PostgreSQL data directory and instance id')

  const wrongOptions = { ...testDatabaseConfig, port: 5432 }
  rejects(() => assertDatabaseOptionsMatchDisposableTarget(wrongOptions),
    /must use an explicit non-default PostgreSQL port|does not match|credentials do not match/i,
    'mismatched service options are rejected before pool creation')

  service = await startLocalEngagementService(testDatabaseConfig)
  const { rows: [databaseAccess] } = await runtimePool.query(`
    SELECT has_database_privilege(current_user, 'postgres', 'CONNECT') AS can_connect_bootstrap,
           has_database_privilege(current_user, 'template1', 'CONNECT') AS can_connect_template,
           EXISTS (SELECT 1 FROM pg_database WHERE datname = 'vera_financial') AS contains_production_name
  `)
  check(!databaseAccess.can_connect_bootstrap && !databaseAccess.can_connect_template
    && !databaseAccess.contains_production_name,
  'restricted test role can use only the dedicated database in its separate cluster')
  const { rows: [migrated] } = await runtimePool.query(
    `SELECT to_regclass('public.engagements') AS engagements,
            to_regclass('public.fsg_test_instance_identity') AS identity_table`
  )
  check(migrated.engagements === 'engagements' && migrated.identity_table === 'fsg_test_instance_identity',
    'service verified database identity before applying its engagement schema')
  await service.close()
  service = null

  const electronExecutable = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  const desktop = spawnSync(electronExecutable, [root], {
    cwd: root,
    env: { ...process.env, FSG_TEST_STARTUP_PROBE: 'true' },
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
  })
  const escapedUserDataPath = userDataPath.replace(/\\/g, '\\\\')
  if (desktop.error || desktop.status !== 0) {
    throw new Error(`Disposable Electron startup probe failed: ${desktop.error?.message || desktop.stderr || desktop.status}`)
  }
  check(desktop.stdout.includes('Disposable desktop startup probe passed')
    && desktop.stdout.includes(`effectiveUserData: '${escapedUserDataPath}'`)
    && desktop.stdout.includes('serviceOnlyMode: true')
    && desktop.stdout.includes('legacyDatabaseInitialized: false')
    && desktop.stdout.includes('legacyIpcRegistered: false'),
  `Electron uses isolated service-only startup; captured output: ${desktop.stdout}\n${desktop.stderr}`)
  check(!desktop.stdout.includes('DB init error'),
    'disposable desktop startup produced no legacy database initialization error or attempt')

  let deniedPostgresDatabase = false
  const forbiddenPool = new Pool({
    host: testDatabaseConfig.host,
    port: testDatabaseConfig.port,
    database: 'postgres',
    user: testDatabaseConfig.user,
    password: testDatabaseConfig.password,
    connectionTimeoutMillis: 2000,
  })
  try {
    const deniedClient = await forbiddenPool.connect()
    deniedClient.release()
  } catch (error) {
    if (!['3D000', '42501'].includes(error.code)) throw error
    deniedPostgresDatabase = true
  } finally {
    await forbiddenPool.end()
  }
  check(deniedPostgresDatabase, 'dedicated test role cannot connect to the bootstrap postgres database')

  console.log(`Disposable database isolation self-test passed (${assertions} assertions).`)
  console.log('Effective non-secret target:', {
    host: testDatabaseConfig.host,
    port: testDatabaseConfig.port,
    database: testDatabaseConfig.database,
    user: testDatabaseConfig.user,
    dataDirectory,
    userDataPath: path.resolve(userDataPath),
    authentication: 'SCRAM-SHA-256',
  })
} finally {
  if (service) await service.close().catch(() => {})
  if (runtimePool) await runtimePool.end().catch(() => {})
  if (bootstrapPool) await bootstrapPool.end().catch(() => {})
  restoreEnvironment()
  if (postgresStarted) {
    spawnSync(path.join(pgBin, 'pg_ctl.exe'), ['-D', dataDirectory, '-m', 'immediate', '-w', 'stop'], {
      stdio: 'ignore', timeout: 30000, windowsHide: true,
    })
  }
  fs.rmSync(rootDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
}
