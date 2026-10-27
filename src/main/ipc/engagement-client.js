import { app, ipcMain, safeStorage } from 'electron'
import { request } from 'node:https'
import { dialog } from 'electron'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import os from 'node:os'
import { sanitizePublicSvg } from '../services/branding-domain.mjs'

const SESSION_MAX_AGE = 8 * 60 * 60 * 1000
const sessions = new Map()
const attachedSenders = new Set()

const OPERATIONS = {
  'engagementAuth:status': { path: 'auth/status', args: () => [] },
  'engagementAuth:setup': {
    path: 'auth/setup',
    args: input => {
      const { setupAuthorizationToken, ...payload } = input || {}
      return [payload, setupAuthorizationToken]
    },
  },
  'engagementAuth:login': { path: 'auth/login', args: input => [input] },
  'engagementAuth:logout': { path: 'auth/logout', args: () => [] },
  'engagementAuth:changePassword': { path: 'auth/change-password', args: password => [{ password }] },
  'engagementAuth:passwordResetIssue': { path: 'auth/password-reset/issue', args: targetUserId => [{ targetUserId }] },
  'engagementAuth:passwordResetComplete': { path: 'auth/password-reset/complete', args: input => [input] },
  'engagementAdmin:listUsers': { path: 'admin/users', args: () => [] },
  'engagementAdmin:createUser': { path: 'admin/users/create', args: input => [input] },
  'engagementAdmin:firmSettings': { path: 'admin/firm-settings', args: () => [] },
  'engagementAdmin:fetchPublicProfile': { path: 'admin/firm/source-preview', args: input => [input] },
  'engagementAdmin:getAppearance': { path: 'admin/appearance', args: () => [] },
  'engagementAdmin:saveAppearance': { path: 'admin/appearance/save', args: input => [input] },
  'engagementAdmin:listReportStyles': { path: 'admin/report-styles', args: () => [] },
  'engagementAdmin:saveReportStyle': { path: 'admin/report-styles/save', args: input => [input] },
  'engagementAdmin:saveProfessionalFirm': { path: 'admin/firm/save', args: input => [input] },
  'engagementAdmin:saveFirmOffice': { path: 'admin/office/save', args: input => [input] },
  'engagementAdmin:savePartnerProfile': { path: 'admin/partner/save', args: input => [input] },
  'engagement:listOptions': { path: 'options', args: () => [] },
  'engagement:createClient': { path: 'clients', args: input => [input] },
  'engagement:list': { path: 'list', args: scope => [{ scope: scope || 'my' }] },
  'engagement:checkDuplicates': { path: 'duplicates', args: input => [input] },
  'engagement:requestAccessForPeriod': { path: 'access-requests', args: input => [input] },
  'engagement:create': { path: 'create', args: input => [input] },
  'engagement:updateDraft': { path: 'draft/update', args: input => [input] },
  'engagement:overview': { path: 'overview', args: id => [{ engagementId: id }] },
  'engagement:updateAccess': { path: 'access/update', args: input => [input] },
  'engagement:confirmLegacyLink': { path: 'legacy/confirm', args: input => [input] },
  'engagement:linkLegacyTrialBalances': { path: 'legacy/trial-balances/link', args: input => [input] },
  'engagement:resolveAccessRequest': { path: 'access-requests/resolve', args: input => [input] },
  'engagement:activate': { path: 'activate', args: input => [input] },
  'engagement:finalise': { path: 'finalise', args: input => [input] },
  'engagement:reopen': { path: 'reopen', args: id => [{ engagementId: id }] },
  'engagement:trialBalances': {
    path: 'trial-balances',
    args: (id, options = {}) => [{ engagementId: id, comparative: options?.comparative === true }],
  },
  'engagement:trialBalanceRows': { path: 'trial-balance/rows', args: input => [input] },
  'engagement:importTrialBalance': { path: 'trial-balance/import', args: input => [input], selectFile: true },
  'engagement:comparativeTrialBalanceSelect': { path: 'trial-balance/comparative/select', args: input => [input] },
  'engagement:mappingOverride': { path: 'mapping/override', args: input => [input] },
  'engagement:noteDetailsSave': { path: 'reporting/note-details/save', args: input => [input] },
  'engagement:journalList': { path: 'journals', args: id => [{ engagementId: id }] },
  'engagement:journalPost': { path: 'journal/post', args: input => [input] },
  'engagement:finalTrialBalances': { path: 'final-trial-balances', args: id => [{ engagementId: id }] },
  'engagement:finalTrialBalanceCreate': { path: 'final-trial-balance/create', args: input => [input] },
  'engagement:finalTrialBalanceRows': { path: 'final-trial-balance/rows', args: input => [input] },
  'engagement:reportingData': { path: 'reporting/data', args: input => [input] },
  'engagement:uaeDemoMappingsSave': { path: 'reporting/uae-demo-mappings/save', args: input => [input] },
  'engagement:reportingSettingsSave': { path: 'reporting/settings/save', args: input => [input] },
  'engagement:reportingSelectionsSave': { path: 'reporting/selections/save', args: input => [input] },
  'engagement:reportStyleSelect': { path: 'reporting/style/select', args: input => [input] },
  'engagement:reportingSignatoryCreate': { path: 'reporting/signatory/create', args: input => [input] },
  'engagement:noteDisclosureSave': { path: 'reporting/note-disclosure/save', args: input => [input] },
  'engagement:reportOutputs': { path: 'reporting/outputs', args: id => [{ engagementId: id }] },
  'engagement:reportOutputSave': { path: 'reporting/output/save', args: input => [input] },
  'engagement:reportOutputRead': { path: 'reporting/output/read', args: id => [{ outputId: id }] },
  'engagement:reportOutputFinalise': { path: 'reporting/output/finalise', args: id => [{ outputId: id }] },
}

function serviceUrl(path, configured = process.env.ENGAGEMENT_SERVICE_URL) {
  if (!configured) throw new Error('Engagement service URL is not configured. Set ENGAGEMENT_SERVICE_URL to the firm HTTPS endpoint.')
  const url = new URL(configured)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Engagement service URL must be an HTTPS origin without embedded credentials, query, or fragment.')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/v1/engagement/${path}`
  return url
}

function describeConnectionError(error, url) {
  const details = error instanceof AggregateError && error.errors?.length
    ? error.errors.map(item => item.code || item.message || String(item)).join(', ')
    : error.code || error.message || String(error)
  return new Error(`Could not connect to the engagement service at ${url.origin}: ${details}`, { cause: error })
}

function configuredServerIdentity(configured) {
  const url = new URL(configured || process.env.ENGAGEMENT_SERVICE_URL)
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

function authStoreDirectory() {
  return join(app.getPath('userData'), 'engagement-auth')
}

function profileBinding() {
  return createHash('sha256')
    .update([app.getPath('userData'), os.homedir(), os.userInfo().username].join('\0'), 'utf8')
    .digest('hex')
}

function serverKey(identity) {
  return createHash('sha256').update(identity, 'utf8').digest('hex')
}

function rememberFile(identity, firmId, userId) {
  return join(authStoreDirectory(), `remember-${serverKey(identity)}-${Number(firmId)}-${Number(userId)}.bin`)
}

async function saveRememberedToken(identity, origin, user, clientBinding, token, storage = safeStorage) {
  if (process.platform !== 'win32' || !storage.isEncryptionAvailable()) {
    throw new Error('Windows-protected secure storage is unavailable on this device.')
  }
  const directory = authStoreDirectory()
  await mkdir(directory, { recursive: true })
  const path = rememberFile(identity, user.firmId, user.id)
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  const encrypted = storage.encryptString(JSON.stringify({
    serverIdentity: identity,
    initialServiceOrigin: origin,
    firmId: Number(user.firmId),
    userId: Number(user.id),
    clientBinding,
    token,
  }))
  try {
    await writeFile(temporaryPath, encrypted, { mode: 0o600 })
    await rename(temporaryPath, path)
  } catch (error) {
    await unlink(temporaryPath).catch(() => {})
    throw error
  }
}

async function readRememberedToken(path, storage = safeStorage) {
  if (process.platform !== 'win32' || !storage.isEncryptionAvailable()) {
    throw new Error('Windows-protected secure storage is unavailable on this device.')
  }
  try {
    return JSON.parse(storage.decryptString(await readFile(path)))
  } catch (error) {
    throw Object.assign(new Error('Saved sign-in data could not be decrypted or parsed.'), { code: 'INVALID_REMEMBERED_TOKEN', cause: error })
  }
}

async function removeRememberedToken(path) {
  await unlink(path).catch(error => {
    if (error.code !== 'ENOENT') throw error
  })
}

async function writeLastUsername(identity, user) {
  const directory = authStoreDirectory()
  await mkdir(directory, { recursive: true })
  const path = join(directory, `last-user-${serverKey(identity)}.json`)
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  const content = JSON.stringify({
    serverIdentity: identity,
    firmId: Number(user.firmId),
    email: String(user.email || ''),
    updatedAt: new Date().toISOString(),
  })
  try {
    await writeFile(temporaryPath, content, { mode: 0o600, encoding: 'utf8' })
    await rename(temporaryPath, path)
  } catch (error) {
    await unlink(temporaryPath).catch(() => {})
    throw error
  }
}

async function readLastUsername(identity) {
  try {
    const record = JSON.parse(await readFile(join(authStoreDirectory(), `last-user-${serverKey(identity)}.json`), 'utf8'))
    return record.serverIdentity === identity && typeof record.email === 'string'
      ? { email: record.email, firmId: Number(record.firmId) }
      : null
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

async function removeFirmRememberedToken(identity, firmId, userId) {
  await removeRememberedToken(rememberFile(identity, firmId, userId))
}

async function removeServerRememberedTokens(identity, preservedPath = null) {
  const directory = authStoreDirectory()
  const prefix = `remember-${serverKey(identity)}-`
  let names
  try {
    names = await readdir(directory)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  await Promise.all(names
    .filter(name => name.startsWith(prefix) && name.endsWith('.bin'))
    .map(name => join(directory, name))
    .filter(path => path !== preservedPath)
    .map(removeRememberedToken))
}

async function removeLegacyLocalTokens(identity, firmId, userId, clientBinding) {
  const directory = authStoreDirectory()
  let names
  try {
    names = await readdir(directory)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  for (const name of names.filter(item => item.startsWith('remember-') && item.endsWith('.bin'))) {
    const path = join(directory, name)
    if (path === rememberFile(identity, firmId, userId)) continue
    let saved
    try {
      saved = await readRememberedToken(path)
    } catch (error) {
      if (error.code === 'INVALID_REMEMBERED_TOKEN') continue
      if (error.message === 'Windows-protected secure storage is unavailable on this device.') return
      throw error
    }
    const previousOrigin = saved.initialServiceOrigin || saved.serverOrigin || ''
    if (saved.serverIdentity !== identity
      && saved.clientBinding === clientBinding
      && Number(saved.firmId) === Number(firmId)
      && Number(saved.userId) === Number(userId)
      && /^https:\/\/127\.0\.0\.1:\d+$/.test(previousOrigin)) {
      await removeRememberedToken(path)
    }
  }
}

function post(url, payload, bearer, setupToken, ca) {
  const body = JSON.stringify(payload ?? {})
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'POST',
      ...(ca ? { ca } : {}),
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(setupToken ? { 'x-engagement-setup-token': setupToken } : {}),
      },
      timeout: 20000,
    }, response => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        raw += chunk
        if (raw.length > 30 * 1024 * 1024) req.destroy(new Error('Engagement service response exceeded the allowed size.'))
      })
      response.on('end', () => {
        let result
        try { result = raw ? JSON.parse(raw) : {} } catch { reject(new Error('Engagement service returned an invalid response.')); return }
        if ((response.statusCode || 500) < 200 || (response.statusCode || 500) >= 300) {
          reject(Object.assign(new Error(result.error || `Engagement service request failed (${response.statusCode}).`), {
            statusCode: response.statusCode || 500,
          }))
          return
        }
        resolve(result)
      })
    })
    req.on('timeout', () => req.destroy(new Error('Engagement service request timed out.')))
    req.on('error', error => reject(describeConnectionError(error, url)))
    req.end(body)
  })
}

const pendingRememberedSignIns = new Map()

async function tryResumeRememberedSignIn(senderId, identity, options) {
  const binding = profileBinding()
  const directory = authStoreDirectory()
  const prefix = `remember-${serverKey(identity)}-`
  let filenames = []
  try {
    filenames = (await readdir(directory)).filter(name => name.startsWith(prefix) && name.endsWith('.bin'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  for (const filename of filenames) {
    const path = join(directory, filename)
    let saved
    try {
      saved = await readRememberedToken(path)
      if (saved.serverIdentity !== identity || saved.clientBinding !== binding
        || !Number.isSafeInteger(Number(saved.firmId)) || !Number.isSafeInteger(Number(saved.userId))
        || typeof saved.token !== 'string') {
        await removeRememberedToken(path)
        continue
      }
      const resumed = await post(
        serviceUrl('auth/remember/resume', options.serviceUrl),
        { token: saved.token, clientBinding: binding },
        null,
        null,
        options.ca,
      )
      if (!resumed.sessionToken || !resumed.user
        || Number(resumed.user.firmId) !== Number(saved.firmId)
        || Number(resumed.user.id) !== Number(saved.userId)) {
        await removeRememberedToken(path)
        continue
      }
      sessions.set(senderId, {
        token: resumed.sessionToken,
        firmId: Number(resumed.user.firmId),
        userId: Number(resumed.user.id),
        rememberToken: saved.token,
        expiresAt: Date.now() + SESSION_MAX_AGE,
      })
      return resumed.user
    } catch (error) {
      if (error.code === 'INVALID_REMEMBERED_TOKEN'
        || error.statusCode === 400 || error.statusCode === 401 || error.statusCode === 403) {
        await removeRememberedToken(path)
        continue
      }
      if (error.message === 'Windows-protected secure storage is unavailable on this device.') return null
      throw error
    }
  }
  return null
}

export function registerEngagementClientHandlers(handlerRegistry = ipcMain, options = {}) {
  handlerRegistry.handle('engagementAdmin:getCachedLogo', async (event, profileId) => {
    const session = sessions.get(event.sender.id)
    const id = Number(profileId)
    if (!session?.firmId || !Number.isSafeInteger(id) || id < 0) return null
    const directory = join(app.getPath('userData'), 'approved-brand-logos', String(session.firmId))
    for (const [mimeType, extension] of [['image/svg+xml', 'svg'], ['image/png', 'png'], ['image/jpeg', 'jpg']]) {
      try {
        const content = await readFile(join(directory, `${id}.${extension}`))
        return { mimeType, contentBase64: content.toString('base64') }
      } catch {}
    }
    return null
  })
  for (const [channel, operation] of Object.entries(OPERATIONS)) {
    handlerRegistry.handle(channel, async (event, input, ...additionalArgs) => {
      if (options.startupError) throw new Error(options.startupError)
      if (!attachedSenders.has(event.sender.id)) {
        attachedSenders.add(event.sender.id)
        event.sender.once('destroyed', () => {
          attachedSenders.delete(event.sender.id)
          sessions.delete(event.sender.id)
          pendingRememberedSignIns.delete(event.sender.id)
        })
      }
      if (operation.selectFile) {
        const selection = await dialog.showOpenDialog({
          title: input?.comparative ? 'Import Prior-year Trial Balance' : 'Import Trial Balance',
          properties: ['openFile'],
          filters: [{ name: 'Excel workbooks', extensions: ['xlsx', 'xls', 'xlsm'] }],
        })
        if (selection.canceled || !selection.filePaths[0]) return { cancelled: true }
        const filePath = selection.filePaths[0]
        const fileInfo = await stat(filePath)
        if (!fileInfo.isFile() || fileInfo.size < 1 || fileInfo.size > 8 * 1024 * 1024) {
          throw new Error('Select a non-empty Excel file no larger than 8 MB.')
        }
        const content = await readFile(filePath)
        input = {
          engagementId: input?.engagementId,
          comparative: input?.comparative === true,
          fileName: basename(filePath),
          fileContentBase64: content.toString('base64'),
        }
      }
      const [payload, setupToken] = operation.args(input, ...additionalArgs)
      const session = sessions.get(event.sender.id)
      const requestUrl = serviceUrl(operation.path, options.serviceUrl)
      const serverIdentity = options.authIdentity || configuredServerIdentity(options.serviceUrl)
      const response = await post(
        requestUrl,
        payload,
        session?.expiresAt > Date.now() ? session.token : null,
        setupToken || options.setupToken,
        options.ca,
      )
      let clientNotice = ''

      if (channel === 'engagementAuth:login' || channel === 'engagementAuth:setup') {
        if (!response.sessionToken || !response.user) throw new Error('Engagement service did not establish a valid session.')
        const user = response.user
        sessions.set(event.sender.id, { token: response.sessionToken, firmId: Number(user.firmId), userId: Number(user.id), expiresAt: Date.now() + SESSION_MAX_AGE })
        if (channel === 'engagementAuth:login') {
          const warnings = []
          try { await writeLastUsername(serverIdentity, user) } catch { warnings.push('The username could not be saved on this Windows profile.') }
          const binding = profileBinding()
          if (input?.keepSignedIn === true) {
            let storedSuccessfully = false
            try {
              const issued = await post(
                serviceUrl('auth/remember/create', options.serviceUrl),
                { clientBinding: binding },
                response.sessionToken,
                null,
                options.ca,
              )
              if (!issued.data?.token) throw new Error('The service did not issue a remembered sign-in token.')
              await saveRememberedToken(serverIdentity, requestUrl.origin, user, binding, issued.data.token)
              storedSuccessfully = true
            } catch (error) {
              await removeFirmRememberedToken(serverIdentity, user.firmId, user.id)
              try {
                await post(
                  serviceUrl('auth/remember/revoke', options.serviceUrl),
                  { clientBinding: binding },
                  response.sessionToken,
                  null,
                  options.ca,
                )
              } catch (revokeError) {
                warnings.push(`The unpersisted remembered sign-in could not be revoked: ${revokeError.message}`)
              }
              warnings.push(`Keep me signed in was not saved: ${error.message}`)
            }
            if (storedSuccessfully && options.localDevelopment) {
              try { await removeLegacyLocalTokens(serverIdentity, user.firmId, user.id, binding) } catch (error) {
                warnings.push(`An older local remembered sign-in file could not be removed: ${error.message}`)
              }
            }
            try {
              await removeServerRememberedTokens(
                serverIdentity,
                storedSuccessfully ? rememberFile(serverIdentity, user.firmId, user.id) : null,
              )
            } catch (error) {
              warnings.push(`Other remembered sign-in files could not be removed from this Windows profile: ${error.message}`)
            }
          } else {
            try {
              await post(
                serviceUrl('auth/remember/revoke', options.serviceUrl),
                { clientBinding: binding },
                response.sessionToken,
                null,
                options.ca,
              )
              await removeFirmRememberedToken(serverIdentity, user.firmId, user.id)
              if (options.localDevelopment) await removeLegacyLocalTokens(serverIdentity, user.firmId, user.id, binding)
            } catch (error) {
              warnings.push(`An earlier remembered sign-in could not be revoked: ${error.message}`)
            }
            try {
              await removeServerRememberedTokens(serverIdentity)
            } catch (error) {
              warnings.push(`Remembered sign-in files could not be cleared from this Windows profile: ${error.message}`)
            }
          }
          return warnings.length ? { ...user, signInStorageWarning: warnings.join(' ') } : user
        }
        return user
      }
      if (channel === 'engagementAuth:logout') {
        const current = sessions.get(event.sender.id)
        sessions.delete(event.sender.id)
        if (current?.firmId) {
          try {
            await removeFirmRememberedToken(serverIdentity, current.firmId, current.userId)
            if (options.localDevelopment) await removeLegacyLocalTokens(serverIdentity, current.firmId, current.userId, profileBinding())
            await removeServerRememberedTokens(serverIdentity)
          } catch (error) {
            clientNotice = `You are signed out, but the encrypted local sign-in file could not be removed: ${error.message}`
          }
        }
      }
      if (channel === 'engagementAuth:changePassword') {
        const current = sessions.get(event.sender.id)
        if (current?.firmId) {
          try {
            await removeFirmRememberedToken(serverIdentity, current.firmId, current.userId)
            if (options.localDevelopment) await removeLegacyLocalTokens(serverIdentity, current.firmId, current.userId, profileBinding())
          } catch (error) {
            clientNotice = `Password changed, but the local remembered sign-in file could not be removed: ${error.message}`
          }
        }
      }
      if (channel === 'engagementAuth:passwordResetComplete') {
        const resetTarget = response.data
        if (Number.isSafeInteger(Number(resetTarget?.firmId)) && Number.isSafeInteger(Number(resetTarget?.userId))) {
          try {
            await removeFirmRememberedToken(serverIdentity, resetTarget.firmId, resetTarget.userId)
            if (options.localDevelopment) {
              await removeLegacyLocalTokens(serverIdentity, resetTarget.firmId, resetTarget.userId, profileBinding())
            }
          } catch (error) {
            clientNotice = `Password reset succeeded, but the user's local remembered sign-in file could not be removed: ${error.message}`
          }
        }
      }
      if (channel === 'engagementAuth:status' && !response.data?.user) sessions.delete(event.sender.id)
      if (session) session.expiresAt = Date.now() + SESSION_MAX_AGE
      if (channel === 'engagementAuth:status' && response.data) {
        let user = response.data.user
        if (user && session) session.firmId = Number(user.firmId)
        if (!user) {
          let attempt = pendingRememberedSignIns.get(event.sender.id)
          if (!attempt) {
            attempt = tryResumeRememberedSignIn(event.sender.id, serverIdentity, options)
            pendingRememberedSignIns.set(event.sender.id, attempt)
          }
          try {
            user = await attempt
          } finally {
            if (pendingRememberedSignIns.get(event.sender.id) === attempt) pendingRememberedSignIns.delete(event.sender.id)
          }
        }
        const loginHint = await readLastUsername(serverIdentity)
        return {
          ...response.data,
          user,
          loginHint,
          ...(options.localDevelopment ? { localDevelopment: true } : {}),
          ...(options.serviceOnlyMode ? { serviceOnlyMode: true } : {}),
        }
      }
      const currentSession = sessions.get(event.sender.id)
      const logoEntries = [
        ...(channel === 'engagementAdmin:firmSettings' ? response.data?.professionalFirms || [] : []),
        ...(channel === 'engagement:reportingData' && response.data?.firmSettings?.branding
          ? [response.data.firmSettings.branding] : []),
      ]
      for (const item of logoEntries) {
        const profileId = Number(item.id)
        const mimeType = item.logoMimeType || item.logo_mime_type
        const encoded = item.logoBase64 || item.logo_base64
        if (!currentSession?.firmId || !Number.isSafeInteger(profileId) || profileId <= 0
          || !encoded || encoded.length > 1024 * 1024 || !['image/png', 'image/jpeg', 'image/svg+xml'].includes(mimeType)) continue
        try {
          const bytes = Buffer.from(encoded, 'base64')
          if (bytes.toString('base64') !== encoded || bytes.length > 750 * 1024) continue
          if (mimeType === 'image/svg+xml') sanitizePublicSvg(bytes.toString('utf8'))
          else if (mimeType === 'image/png' && !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) continue
          else if (mimeType === 'image/jpeg' && !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) continue
          const directory = join(app.getPath('userData'), 'approved-brand-logos', String(currentSession.firmId))
          await mkdir(directory, { recursive: true })
          await writeFile(join(directory, `${profileId}.${mimeType === 'image/svg+xml' ? 'svg' : mimeType === 'image/png' ? 'png' : 'jpg'}`), bytes)
        } catch {}
      }
      return clientNotice && response.data && typeof response.data === 'object'
        ? { ...response.data, clientNotice }
        : response.data
    })
  }
}
