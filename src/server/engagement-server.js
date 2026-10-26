import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEngagementDatabase } from './engagement-db.js'
import { ensureEngagementSchema } from '../main/db/engagement-schema.js'
import { registerEngagementHandlers } from '../main/ipc/engagements.js'

const SESSION_MAX_AGE = 8 * 60 * 60 * 1000
const BODY_MAX_BYTES = 1024 * 1024
const TB_IMPORT_MAX_BODY_BYTES = 12 * 1024 * 1024
const REPORT_OUTPUT_MAX_BODY_BYTES = 32 * 1024 * 1024
const FIRM_LOGO_MAX_BODY_BYTES = 2 * 1024 * 1024
const SESSION_TOKEN_BYTES = 32

const ROUTES = {
  'auth/status': { channel: 'engagementAuth:status', args: () => [] },
  'auth/setup': { channel: 'engagementAuth:setup', args: body => [body] },
  'auth/login': { channel: 'engagementAuth:login', args: body => [body] },
  'auth/logout': { channel: 'engagementAuth:logout', args: () => [] },
  'auth/change-password': { channel: 'engagementAuth:changePassword', args: body => [body.password] },
  'admin/users': { channel: 'engagementAdmin:listUsers', args: () => [] },
  'admin/users/create': { channel: 'engagementAdmin:createUser', args: body => [body] },
  'admin/firm-settings': { channel: 'engagementAdmin:firmSettings', args: () => [] },
  'admin/firm/save': {
    channel: 'engagementAdmin:saveProfessionalFirm',
    args: body => [body],
    maxBodyBytes: FIRM_LOGO_MAX_BODY_BYTES,
  },
  'admin/office/save': { channel: 'engagementAdmin:saveFirmOffice', args: body => [body] },
  'admin/partner/save': { channel: 'engagementAdmin:savePartnerProfile', args: body => [body] },
  options: { channel: 'engagement:listOptions', args: () => [] },
  clients: { channel: 'engagement:createClient', args: body => [body] },
  list: { channel: 'engagement:list', args: body => [body.scope || 'my'] },
  duplicates: { channel: 'engagement:checkDuplicates', args: body => [body] },
  'access-requests': { channel: 'engagement:requestAccessForPeriod', args: body => [body] },
  create: { channel: 'engagement:create', args: body => [body] },
  'draft/update': { channel: 'engagement:updateDraft', args: body => [body] },
  overview: { channel: 'engagement:overview', args: body => [body.engagementId] },
  'access/update': { channel: 'engagement:updateAccess', args: body => [body] },
  'legacy/confirm': { channel: 'engagement:confirmLegacyLink', args: body => [body] },
  'legacy/trial-balances/link': { channel: 'engagement:linkLegacyTrialBalances', args: body => [body] },
  'access-requests/resolve': { channel: 'engagement:resolveAccessRequest', args: body => [body] },
  activate: { channel: 'engagement:activate', args: body => [body] },
  finalise: { channel: 'engagement:finalise', args: body => [body] },
  reopen: { channel: 'engagement:reopen', args: body => [body.engagementId] },
  'trial-balances': { channel: 'engagement:trialBalances', args: body => [body.engagementId] },
  'trial-balance/rows': { channel: 'engagement:trialBalanceRows', args: body => [body] },
  journals: { channel: 'engagement:journalList', args: body => [body.engagementId] },
  'journal/post': { channel: 'engagement:journalPost', args: body => [body] },
  'final-trial-balances': { channel: 'engagement:finalTrialBalances', args: body => [body.engagementId] },
  'final-trial-balance/create': { channel: 'engagement:finalTrialBalanceCreate', args: body => [body] },
  'final-trial-balance/rows': { channel: 'engagement:finalTrialBalanceRows', args: body => [body] },
  'reporting/data': { channel: 'engagement:reportingData', args: body => [body] },
  'reporting/uae-demo-mappings/save': { channel: 'engagement:uaeDemoMappingsSave', args: body => [body] },
  'reporting/settings/save': { channel: 'engagement:reportingSettingsSave', args: body => [body] },
  'reporting/selections/save': { channel: 'engagement:reportingSelectionsSave', args: body => [body] },
  'reporting/signatory/create': { channel: 'engagement:reportingSignatoryCreate', args: body => [body] },
  'reporting/note-disclosure/save': { channel: 'engagement:noteDisclosureSave', args: body => [body] },
  'reporting/outputs': { channel: 'engagement:reportOutputs', args: body => [body.engagementId] },
  'reporting/output/save': {
    channel: 'engagement:reportOutputSave',
    args: body => [body],
    maxBodyBytes: REPORT_OUTPUT_MAX_BODY_BYTES,
  },
  'reporting/output/read': { channel: 'engagement:reportOutputRead', args: body => [body.outputId] },
  'reporting/output/finalise': { channel: 'engagement:reportOutputFinalise', args: body => [body.outputId] },
  'trial-balance/import': {
    channel: 'engagement:importTrialBalance',
    args: body => [body],
    maxBodyBytes: TB_IMPORT_MAX_BODY_BYTES,
  },
  'trial-balance/comparative/select': { channel: 'engagement:comparativeTrialBalanceSelect', args: body => [body] },
  'mapping/override': { channel: 'engagement:mappingOverride', args: body => [body] },
  'reporting/note-details/save': { channel: 'engagement:noteDetailsSave', args: body => [body] },
}

function getTlsOptions(options = {}) {
  if (options.tlsOptions) return options.tlsOptions
  const pfxPath = process.env.ENGAGEMENT_TLS_PFX_FILE
  if (pfxPath) {
    return {
      pfx: readFileSync(resolve(pfxPath)),
      passphrase: process.env.ENGAGEMENT_TLS_PFX_PASSWORD || undefined,
    }
  }
  const keyPath = process.env.ENGAGEMENT_TLS_KEY_FILE
  const certPath = process.env.ENGAGEMENT_TLS_CERT_FILE
  if (!keyPath || !certPath) throw new Error('Set ENGAGEMENT_TLS_KEY_FILE and ENGAGEMENT_TLS_CERT_FILE to start the HTTPS service.')
  return { key: readFileSync(resolve(keyPath)), cert: readFileSync(resolve(certPath)) }
}

function setupTokenMatches(candidate, configuredToken = process.env.ENGAGEMENT_SETUP_TOKEN || '') {
  const expected = configuredToken
  const provided = String(candidate || '')
  if (Buffer.byteLength(expected) < 32 || Buffer.byteLength(provided) !== Buffer.byteLength(expected)) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(body)
}

async function readJsonBody(request, maximumBytes = BODY_MAX_BYTES) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > maximumBytes) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 })
    chunks.push(chunk)
  }
  if (!total) return {}
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body
  } catch {
    throw Object.assign(new Error('Request body must be a JSON object.'), { statusCode: 400 })
  }
}

function createRateLimiter() {
  const attempts = new Map()
  return {
    assertAllowed(key) {
      const current = attempts.get(key)
      if (current?.blockedUntil > Date.now()) {
        throw Object.assign(new Error('Too many authentication attempts. Try again later.'), { statusCode: 429 })
      }
    },
    failed(key) {
      const now = Date.now()
      const current = attempts.get(key)
      const updated = current && now - current.startedAt < 15 * 60 * 1000
        ? { startedAt: current.startedAt, count: current.count + 1 }
        : { startedAt: now, count: 1 }
      if (updated.count >= 10) updated.blockedUntil = now + 15 * 60 * 1000
      attempts.set(key, updated)
    },
    succeeded(key) {
      attempts.delete(key)
    },
  }
}

function requestSessionToken(request) {
  const authorization = String(request.headers.authorization || '')
  const match = /^Bearer ([0-9a-f]{64})$/i.exec(authorization)
  return match ? match[1] : null
}

export async function createEngagementServer(options = {}) {
  const tlsOptions = getTlsOptions(options)
  const database = createEngagementDatabase(options.databaseOptions)
  try {
    await database.connect()
    await database.withStartupLock(() => ensureEngagementSchema(database.query))
  } catch (error) {
    await database.close()
    throw error
  }

  const handlers = new Map()
  registerEngagementHandlers({
    handle(channel, handler) {
      if (handlers.has(channel)) throw new Error(`Duplicate engagement handler registered: ${channel}`)
      handlers.set(channel, handler)
    },
  }, database)

  const sessions = new Map()
  const limiter = createRateLimiter()
  const server = createServer({ ...tlsOptions, maxHeaderSize: 16 * 1024 }, async (request, response) => {
    const startedAt = Date.now()
    let routeName = 'unknown'
    let statusCode = 500
    try {
      const path = new URL(request.url || '/', 'https://engagement.local').pathname
      if (request.method === 'GET' && path === '/health') {
        statusCode = 200
        sendJson(response, statusCode, { status: 'ok' })
        return
      }
      const prefix = '/v1/engagement/'
      if (request.method !== 'POST' || !path.startsWith(prefix)) {
        statusCode = 404
        sendJson(response, statusCode, { error: 'Route not found.' })
        return
      }
      routeName = path.slice(prefix.length)
      const route = ROUTES[routeName]
      if (!route) {
        statusCode = 404
        sendJson(response, statusCode, { error: 'Route not found.' })
        return
      }
      const remoteAddress = request.socket.remoteAddress || 'unknown'
      const isLogin = routeName === 'auth/login' || routeName === 'auth/setup'
      if (isLogin) limiter.assertAllowed(remoteAddress)
      if (routeName === 'auth/setup' && !setupTokenMatches(
        request.headers['x-engagement-setup-token'],
        options.setupToken,
      )) {
        limiter.failed(remoteAddress)
        statusCode = 403
        sendJson(response, statusCode, { error: 'Server setup authorization is invalid or unavailable.' })
        return
      }

      let token = null
      let senderId
      if (['auth/status', 'auth/login', 'auth/setup'].includes(routeName)) {
        token = requestSessionToken(request)
        senderId = (token && sessions.get(token)?.expiresAt > Date.now() && sessions.get(token)?.senderId) || randomUUID()
      } else {
        token = requestSessionToken(request)
        const session = token && sessions.get(token)
        if (!session || session.expiresAt <= Date.now()) {
          if (token) sessions.delete(token)
          statusCode = 401
          sendJson(response, statusCode, { error: 'Sign in to use engagement management.' })
          return
        }
        senderId = session.senderId
        session.expiresAt = Date.now() + SESSION_MAX_AGE
      }

      const body = await readJsonBody(request, route.maxBodyBytes)
      const handler = handlers.get(route.channel)
      if (!handler) throw new Error(`Engagement operation is not registered: ${route.channel}`)
      let result
      try {
        result = await handler({ sender: { id: senderId } }, ...route.args(body))
      } catch (error) {
        if (isLogin) limiter.failed(remoteAddress)
        throw error
      }
      if (isLogin) limiter.succeeded(remoteAddress)

      if (routeName === 'auth/login' || routeName === 'auth/setup') {
        const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString('hex')
        sessions.set(sessionToken, { senderId, expiresAt: Date.now() + SESSION_MAX_AGE })
        statusCode = 200
        sendJson(response, statusCode, { user: result, sessionToken })
      } else {
        if (routeName === 'auth/logout' && token) sessions.delete(token)
        statusCode = 200
        sendJson(response, statusCode, { data: result })
      }
    } catch (error) {
      statusCode = error.statusCode || (error.code ? 500 : 400)
      const message = error.code ? 'The engagement service could not complete this operation.' : error.message
      if (statusCode >= 500) console.error('Engagement service operation failed:', routeName, error)
      sendJson(response, statusCode, { error: message })
    } finally {
      console.info(`engagement-api ${request.method} ${routeName} ${statusCode} ${Date.now() - startedAt}ms`)
    }
  })
  server.requestTimeout = 30000
  server.headersTimeout = 15000
  server.keepAliveTimeout = 5000

  return {
    server,
    database,
    async listen() {
      const host = options.host || process.env.ENGAGEMENT_BIND_HOST || '127.0.0.1'
      const port = options.port ?? Number(process.env.ENGAGEMENT_PORT || 8443)
      await new Promise((resolveListen, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          server.removeListener('error', reject)
          resolveListen()
        })
      })
      return server.address()
    },
    async close() {
      for (const token of sessions.keys()) sessions.delete(token)
      try {
        if (server.listening) {
          await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
        }
      } finally {
        await database.close()
      }
    },
  }
}

const invokedPath = process.argv[1] && resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) {
  const startStandaloneService = async () => {
    const service = await createEngagementServer()
    const address = await service.listen()
    console.info(`Engagement HTTPS service listening on ${address.address}:${address.port}`)

    const shutdown = async () => {
      try {
        await service.close()
        process.exit(0)
      } catch (error) {
        console.error('Engagement service shutdown failed:', error)
        process.exit(1)
      }
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  }
  startStandaloneService().catch(error => {
    console.error('Engagement service startup failed:', error)
    process.exitCode = 1
  })
}
