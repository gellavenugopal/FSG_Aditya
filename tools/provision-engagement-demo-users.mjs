import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import https from 'node:https'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { startLocalEngagementService } from '../src/server/dev-engagement-service.js'
import { createEngagementPasswordRecord, verifyEngagementPassword } from '../src/main/services/engagement-password.js'
import { resolveDisposableTestTarget } from '../src/main/test-isolation.mjs'
import {
  addMissingDemoUserCredentials,
  createDemoUserCredentials,
  DEMO_USER_DEFINITIONS,
  validateDemoUserCredentials,
} from './engagement-demo-auth-config.mjs'

if (process.versions.electron || process.env.NODE_ENV === 'production') {
  throw new Error('Test-account provisioning is available only from the isolated development harness.')
}
if (process.env.FSG_TEST_MODE !== 'true') {
  throw new Error('Set FSG_TEST_MODE=true through the isolated engagement demo harness before provisioning accounts.')
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const targetFile = path.resolve(process.env.FSG_TEST_TARGET_FILE || '')
const demoHome = path.dirname(targetFile)
const credentialsFile = path.join(demoHome, 'credentials.json')
const profileMarkerFile = path.join(process.env.FSG_TEST_USER_DATA_PATH || '', '.fsg-demo-profile.json')
const packageData = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const { databaseConfig, target } = resolveDisposableTestTarget()

function normalizedPath(value) {
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase()
}

function pathContains(parent, child) {
  const normalizedParent = normalizedPath(parent)
  const normalizedChild = normalizedPath(child)
  return normalizedChild.startsWith(`${normalizedParent}\\`) || normalizedChild.startsWith(`${normalizedParent}/`)
}

function assertIsolatedProfile() {
  const profilePath = target.userDataPath
  const profile = fs.statSync(profilePath)
  if (!profile.isDirectory() || normalizedPath(profilePath) !== normalizedPath(process.env.FSG_TEST_USER_DATA_PATH)) {
    throw new Error('The explicit test application profile does not match the harness-created profile directory.')
  }
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  const normalProfile = path.join(roaming, packageData.name)
  if (normalizedPath(profilePath) === normalizedPath(normalProfile)
    || pathContains(normalProfile, profilePath) || pathContains(profilePath, normalProfile)) {
    throw new Error('Refusing test provisioning because the profile overlaps the normal application profile.')
  }
}

function readCredentials() {
  const credentials = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'))
  for (const key of ['host', 'port', 'database', 'user', 'password']) {
    if (credentials[key] !== databaseConfig[key]) throw new Error('Demo database credentials do not match the explicit test target.')
  }
  return credentials
}

function writeCredentials(credentials) {
  const temporaryFile = `${credentialsFile}.${process.pid}.tmp`
  fs.writeFileSync(temporaryFile, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  fs.renameSync(temporaryFile, credentialsFile)
}

function writeProfileMarker() {
  const expected = {
    instanceId: target.instanceId,
    userDataPath: target.userDataPath,
  }
  if (fs.existsSync(profileMarkerFile)) {
    const existing = JSON.parse(fs.readFileSync(profileMarkerFile, 'utf8'))
    if (existing.instanceId !== expected.instanceId
      || normalizedPath(existing.userDataPath) !== normalizedPath(expected.userDataPath)) {
      throw new Error('The isolated application profile marker belongs to a different test instance.')
    }
    return
  }
  fs.writeFileSync(profileMarkerFile, `${JSON.stringify({ ...expected, verifiedAt: new Date().toISOString() }, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  })
}

function post(service, route, body = {}, token = null) {
  const endpoint = new URL(`/v1/engagement/${route}`, service.clientOptions.serviceUrl)
  const payload = Buffer.from(JSON.stringify(body))
  return new Promise((resolve, reject) => {
    const request = https.request(endpoint, {
      method: 'POST',
      ca: service.clientOptions.ca,
      headers: {
        'content-type': 'application/json',
        'content-length': payload.length,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
        } catch (error) {
          reject(new Error(`The local test service returned an invalid response for ${route}.`, { cause: error }))
        }
      })
    })
    request.on('error', reject)
    request.end(payload)
  })
}

function assertStatus(response, expected, route) {
  if (response.status !== expected) {
    throw new Error(`${route} returned HTTP ${response.status}: ${response.body?.error || 'unexpected response'}`)
  }
}

async function provisionAccounts(database, testUsers) {
  return database.runInTransaction(async () => {
    await database.query('SELECT pg_advisory_xact_lock($1)', [517203842])
    const { rows: existingFirms } = await database.query(
      `SELECT id FROM firms WHERE name='FSG Isolated Demo Firm' ORDER BY id`
    )
    if (existingFirms.length > 1) throw new Error('Multiple isolated demo firms exist; refusing to choose one.')
    const firmId = existingFirms[0]?.id
      || (await database.query(`INSERT INTO firms(name) VALUES ('FSG Isolated Demo Firm') RETURNING id`)).rows[0].id
    const createdUsers = []

    for (const definition of DEMO_USER_DEFINITIONS) {
      const configured = testUsers[definition.key]
      const { rows: existing } = await database.query(
        `SELECT id,firm_id,email,display_name,job_title,role,password_salt,password_hash,active
         FROM firm_users WHERE lower(email)=$1 ORDER BY id`,
        [configured.email]
      )
      if (existing.length > 1) throw new Error(`Multiple isolated accounts use ${configured.email}; no password was changed.`)
      if (existing.length === 1) {
        const user = existing[0]
        if (Number(user.firm_id) !== Number(firmId) || user.role !== definition.role
          || user.job_title !== definition.jobTitle || !user.active) {
          throw new Error(`Existing isolated account ${configured.email} does not match the expected role; it was not changed.`)
        }
        if (!(await verifyEngagementPassword(configured.password, user.password_salt, user.password_hash))) {
          throw new Error(`Existing isolated account ${configured.email} uses a different password; it was not reset.`)
        }
        continue
      }

      const { salt, hash } = await createEngagementPasswordRecord(configured.password)
      const { rows: [user] } = await database.query(
        `INSERT INTO firm_users
           (firm_id,email,display_name,job_title,password_salt,password_hash,role,must_change_password,active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE,TRUE)
         RETURNING id,email,role,job_title`,
        [firmId, configured.email, configured.displayName, definition.jobTitle, salt, hash, definition.role]
      )
      createdUsers.push({ ...user, key: definition.key })
    }

    for (const user of createdUsers) {
      await database.query(
        `INSERT INTO engagement_audit_log(firm_id,actor_user_id,action,details)
         VALUES($1,$2,'test_account.provisioned',$3::jsonb)`,
        [firmId, user.key === 'administrator' ? user.id : createdUsers.find(item => item.key === 'administrator')?.id,
          JSON.stringify({ email: user.email, role: user.role })]
      )
    }
    return { firmId, createdCount: createdUsers.length }
  })
}

async function verifyAuthentication(service, testUsers) {
  const admin = testUsers.administrator
  const wrongPassword = await post(service, 'auth/login', {
    email: admin.email,
    password: randomBytes(32).toString('base64url'),
  })
  assertStatus(wrongPassword, 400, 'incorrect-password login')
  if (wrongPassword.body.error !== 'Email or password is incorrect.') {
    throw new Error('Incorrect-password login did not return the standard authentication rejection.')
  }

  const adminLogin = await post(service, 'auth/login', { email: admin.email, password: admin.password })
  assertStatus(adminLogin, 200, 'administrator login')
  if (adminLogin.body.user.role !== 'administrator') throw new Error('The configured administrator did not receive its admin role.')
  const adminToken = adminLogin.body.sessionToken

  const { status: userListStatus, body: userList } = await post(service, 'admin/users', {}, adminToken)
  assertStatus({ status: userListStatus, body: userList }, 200, 'administrator user list')
  for (const definition of DEMO_USER_DEFINITIONS) {
    const user = userList.data.find(item => item.email === testUsers[definition.key].email)
    if (!user || user.role !== definition.role || user.jobTitle !== definition.jobTitle || user.mustChangePassword) {
      throw new Error(`The configured ${definition.key} account is not available with its expected role.`)
    }
  }

  for (const key of ['contributor', 'reader', 'partner']) {
    const account = testUsers[key]
    const login = await post(service, 'auth/login', { email: account.email, password: account.password })
    assertStatus(login, 200, `${key} login`)
    const expectedRole = DEMO_USER_DEFINITIONS.find(user => user.key === key)?.role
    if (login.body.user.role !== expectedRole) throw new Error(`The ${key} account has an unexpected permission role.`)
    const adminOperation = await post(service, 'admin/users', {}, login.body.sessionToken)
    assertStatus(adminOperation, 400, `${key} administrator-only user list`)
    if (!/administrator access is required/i.test(adminOperation.body.error || '')) {
      throw new Error(`The ${key} account did not receive the standard administrator permission rejection.`)
    }
    const logout = await post(service, 'auth/logout', {}, login.body.sessionToken)
    assertStatus(logout, 200, `${key} logout`)
  }

  const logout = await post(service, 'auth/logout', {}, adminToken)
  assertStatus(logout, 200, 'administrator logout')
  const statusAfterLogout = await post(service, 'auth/status', {}, adminToken)
  assertStatus(statusAfterLogout, 200, 'status after logout')
  if (statusAfterLogout.body.data.user) throw new Error('Administrator session remained active after logout.')

  const relogin = await post(service, 'auth/login', { email: admin.email, password: admin.password })
  assertStatus(relogin, 200, 'administrator relogin after service restart')
  await post(service, 'auth/logout', {}, relogin.body.sessionToken)
}

async function main() {
  if (!fs.existsSync(credentialsFile) || !fs.existsSync(targetFile)) {
    throw new Error('The harness target manifest and credentials file are required.')
  }
  if (!fs.existsSync(path.join(target.dataDirectory, 'PG_VERSION'))) {
    throw new Error('The target PostgreSQL data directory is not the harness-created instance.')
  }
  assertIsolatedProfile()
  const credentials = readCredentials()
  const localService = await startLocalEngagementService(databaseConfig)
  try {
    const { rows: [identity] } = await localService.service.database.query(`
      SELECT current_database() AS database,current_user AS username,
             inet_server_addr()::text AS host,inet_server_port() AS port
    `)
    const { rows: [marker] } = await localService.service.database.query(
      `SELECT instance_id,data_directory FROM fsg_test_instance_identity WHERE singleton=TRUE`
    )
    const normalize = value => normalizedPath(value)
    if (identity.database !== target.database || identity.username !== target.user
      || String(identity.host || '').split('/')[0] !== target.host || Number(identity.port) !== target.port
      || marker?.instance_id !== target.instanceId || normalize(marker.data_directory) !== normalize(target.dataDirectory)) {
      throw new Error('Connected PostgreSQL identity did not match the isolated harness target.')
    }
    writeProfileMarker()

    const configuredUsers = credentials.testUsers || createDemoUserCredentials()
    const { testUsers, added } = addMissingDemoUserCredentials(configuredUsers)
    if (!credentials.testUsers || added) {
      credentials.testUsers = testUsers
      writeCredentials(credentials)
    }
    validateDemoUserCredentials(testUsers)
    const provisioning = await provisionAccounts(localService.service.database, testUsers)
    await verifyAuthentication(localService, testUsers)
    console.info(JSON.stringify({
      result: 'isolated test accounts verified',
      target: `${target.host}:${target.port}/${target.database}`,
      firmId: provisioning.firmId,
      accountsCreated: provisioning.createdCount,
      accounts: DEMO_USER_DEFINITIONS.map(user => ({ role: user.key, email: testUsers[user.key].email })),
      profileVerified: target.userDataPath,
    }))
  } finally {
    await localService.close()
  }
}

await main()
