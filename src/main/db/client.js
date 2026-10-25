import pg from 'pg'
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import electron from 'electron'
import { join } from 'path'
import { isDisposableTestMode, loadDatabaseConfig } from '../test-isolation.mjs'

const { Pool, Client } = pg
const { app, safeStorage } = typeof electron === 'object' ? electron : {}

const CONFIG_PATH = () => join(app.getPath('userData'), 'db-config.json')
const DEFAULT_CFG = { host: 'localhost', port: 5432, database: 'vera_financial', user: 'postgres', password: '' }

// Advisory lock key used to serialize one-time startup schema/seed work
// across all Electron clients connected to the same shared Postgres DB.
// See schema.js's withStartupLock().
export const STARTUP_LOCK_KEY = 918273645

let pool = null

// Routes query()/runInTransaction() calls made *inside* a transaction onto
// the single client that transaction is running on, so every existing call
// site (which just calls the module-level query()) automatically
// participates in the right transaction — no call site needs to change.
const txStorage = new AsyncLocalStorage()

function encryptPassword(password) {
  if (!password) return ''
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(password).toString('base64')
    : Buffer.from(password, 'utf8').toString('base64')
}

function decryptPassword(stored) {
  if (!stored) return ''
  try {
    const buf = Buffer.from(stored, 'base64')
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8')
  } catch (_) {
    return ''
  }
}

export function loadConfig() {
  return loadDatabaseConfig(process.env, () => {
    try {
      if (existsSync(CONFIG_PATH())) {
        const raw = JSON.parse(readFileSync(CONFIG_PATH(), 'utf8'))
        return {
          host: raw.host || DEFAULT_CFG.host,
          port: raw.port || DEFAULT_CFG.port,
          database: raw.database || DEFAULT_CFG.database,
          user: raw.user || DEFAULT_CFG.user,
          password: decryptPassword(raw.password)
        }
      }
    } catch (_) {}
    return { ...DEFAULT_CFG }
  })
}

export function saveConfig(cfg) {
  if (isDisposableTestMode()) throw new Error('Saving legacy database settings is disabled in disposable test mode.')
  writeFileSync(CONFIG_PATH(), JSON.stringify({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: encryptPassword(cfg.password || '')
  }, null, 2), 'utf8')
}

export async function initDB(cfg = null) {
  if (isDisposableTestMode()) throw new Error('Legacy PostgreSQL initialization is disabled in disposable test mode.')
  const c = cfg || loadConfig()
  if (pool) {
    const old = pool
    pool = null
    await old.end().catch(() => {})
  }
  pool = new Pool({
    host: c.host,
    port: c.port,
    database: c.database,
    user: c.user,
    password: c.password,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000
  })
  // Verify connectivity now so a bad config surfaces immediately, not on
  // the first query the renderer happens to trigger.
  const probe = await pool.connect()
  probe.release()
  return true
}

export function getDB() {
  if (!pool) throw new Error('Database not initialised.')
  return pool
}

// Standalone connection test — does not touch the live pool, so testing a
// candidate config from the Settings screen never disrupts an already-
// connected app.
export async function testConnectionWith(cfg) {
  const testClient = new Client({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    connectionTimeoutMillis: 5000
  })
  try {
    await testClient.connect()
    await testClient.query('SELECT 1')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  } finally {
    testClient.end().catch(() => {})
  }
}

// No-op: Postgres commits durably on every statement/transaction — there is
// no in-memory blob to flush. Kept as an export so index.js's
// before-quit/window-all-closed/signal handlers don't need changes.
export function flushDB() {}

export async function query(sql, params = []) {
  const activeClient = txStorage.getStore()
  if (activeClient) return activeClient.query(sql, params)
  if (!pool) throw new Error('Database not initialised.')
  return pool.query(sql, params)
}

export async function runInTransaction(fn) {
  // Reentrant: if a transaction is already active in this async context
  // (e.g. an IPC handler wraps a call that itself calls runInTransaction,
  // as mappedTB:run → persistMappingResults does), just run fn() against the
  // existing client instead of opening a second, unrelated connection/
  // transaction — Postgres has no true nested transactions, and every
  // existing call site only needs "these statements share one transaction",
  // not savepoint semantics.
  const existingClient = txStorage.getStore()
  if (existingClient) return fn()

  if (!pool) throw new Error('Database not initialised.')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await txStorage.run(client, fn)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// Global mutex across every client connected to the database — not just
// within this process — so 15 Electron instances launching around the same
// time don't race each other through one-time schema/seed setup. See
// schema.js's ensureSchema()/withStartupLock().
export async function withStartupLock(fn) {
  if (!pool) throw new Error('Database not initialised.')
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [STARTUP_LOCK_KEY])
    return await fn()
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [STARTUP_LOCK_KEY]).catch(() => {})
    client.release()
  }
}
