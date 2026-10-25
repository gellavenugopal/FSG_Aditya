import pg from 'pg'
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync } from 'node:fs'

const { Pool, types } = pg
const transactionStorage = new AsyncLocalStorage()
types.setTypeParser(1082, value => value)

function poolOptionsFromEnvironment() {
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
  const pool = new Pool(databaseOptions || poolOptionsFromEnvironment())
  pool.on('error', error => console.error('Engagement database pool reported an idle-client error:', error.message))

  return {
    async connect() {
      const client = await pool.connect()
      client.release()
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
