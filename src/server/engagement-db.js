import pg from 'pg'
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync } from 'node:fs'
import {
  assertDatabaseOptionsMatchDisposableTarget,
  isDisposableTestMode,
  resolveDisposableTestTarget,
} from '../main/test-isolation.mjs'

const { Pool, types } = pg
const transactionStorage = new AsyncLocalStorage()
types.setTypeParser(1082, value => value)

function poolOptionsFromEnvironment() {
  if (isDisposableTestMode()) return resolveDisposableTestTarget().databaseConfig
  const connectionString = process.env.ENGAGEMENT_DATABASE_URL
  const sslEnabled = process.env.ENGAGEMENT_DATABASE_SSL === 'true'
  const ssl = sslEnabled
    ? { rejectUnauthorized: true, ...(process.env.ENGAGEMENT_DATABASE_SSL_CA_FILE
      ? { ca: readFileSync(process.env.ENGAGEMENT_DATABASE_SSL_CA_FILE, 'utf8') }
      : {}) }
    : undefined
  if (connectionString) {
    const options = { connectionString, max: 15, idleTimeoutMillis: 30000, connectionTimeoutMillis: 8000 }
    if (ssl) options.ssl = ssl
    return options
  }

  const host = process.env.ENGAGEMENT_DB_HOST
  const database = process.env.ENGAGEMENT_DB_NAME
  const user = process.env.ENGAGEMENT_DB_USER
  const password = process.env.ENGAGEMENT_DB_PASSWORD
  if (!host || !database || !user || !password) {
    throw new Error('Set ENGAGEMENT_DATABASE_URL or all of ENGAGEMENT_DB_HOST, ENGAGEMENT_DB_NAME, ENGAGEMENT_DB_USER, and ENGAGEMENT_DB_PASSWORD.')
  }
  return {
    host,
    port: Number(process.env.ENGAGEMENT_DB_PORT || 5432),
    database,
    user,
    password,
    ssl,
    max: 15,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
  }
}

export function createEngagementDatabase(databaseOptions = null) {
  const options = databaseOptions || poolOptionsFromEnvironment()
  const testTarget = isDisposableTestMode()
    ? assertDatabaseOptionsMatchDisposableTarget(options)
    : null
  if (testTarget) {
    console.info('Engagement service disposable database target:', {
      host: options.host,
      port: Number(options.port),
      database: options.database,
      user: options.user,
      dataDirectory: testTarget.dataDirectory,
    })
  }
  const pool = new Pool(options)
  pool.on('error', error => console.error('Engagement database pool reported an idle-client error:', error.message))

  return {
    async connect() {
      const client = await pool.connect()
      try {
        if (testTarget) {
          const { rows: [identity] } = await client.query(`
            SELECT current_database() AS database,
                   current_user AS username,
                   inet_server_addr()::text AS host,
                   inet_server_port() AS port
          `)
          const { rows: [marker] } = await client.query(
            `SELECT instance_id, data_directory
               FROM public.fsg_test_instance_identity
              WHERE singleton = TRUE`
          )
          const normalizePath = value => String(value || '').replace(/[\\/]+$/, '').toLowerCase()
          const connectedHost = String(identity?.host || '').split('/')[0]
          if (!identity || identity.database !== testTarget.database || identity.username !== testTarget.user
            || connectedHost !== testTarget.host || Number(identity.port) !== testTarget.port
            || marker?.instance_id !== testTarget.instanceId
            || normalizePath(marker?.data_directory) !== normalizePath(testTarget.dataDirectory)) {
            throw new Error(`Connected PostgreSQL identity mismatch: ${JSON.stringify({
              actual: {
                host: connectedHost,
                port: identity?.port,
                database: identity?.database,
                user: identity?.username,
                instanceId: marker?.instance_id,
                dataDirectory: marker?.data_directory,
              },
              expected: {
                host: testTarget.host,
                port: testTarget.port,
                database: testTarget.database,
                user: testTarget.user,
                instanceId: testTarget.instanceId,
                dataDirectory: testTarget.dataDirectory,
              },
            })}`)
          }
        }
      } finally {
        client.release()
      }
    },
    query(sql, params = []) {
      const transactionClient = transactionStorage.getStore()
      return transactionClient ? transactionClient.query(sql, params) : pool.query(sql, params)
    },
    async runInTransaction(fn) {
      if (transactionStorage.getStore()) return fn()
      const client = await pool.connect()
      let releaseError = null
      try {
        await client.query('BEGIN')
        const result = await transactionStorage.run(client, fn)
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK').catch(rollbackError => {
          console.error('Engagement transaction rollback failed:', rollbackError.message)
          releaseError = rollbackError
        })
        throw error
      } finally {
        client.release(releaseError)
      }
    },
    async withStartupLock(fn) {
      const client = await pool.connect()
      let releaseError = null
      try {
        await client.query('SELECT pg_advisory_lock($1)', [918273645])
        return await fn()
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [918273645]).catch(error => {
          console.error('Engagement startup lock release failed:', error.message)
          releaseError = error
        })
        client.release(releaseError)
      }
    },
    close() {
      return pool.end()
    },
  }
}
