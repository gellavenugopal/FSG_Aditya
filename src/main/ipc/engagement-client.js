import { ipcMain } from 'electron'
import { request } from 'node:https'
import { dialog } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'

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
  'engagementAdmin:listUsers': { path: 'admin/users', args: () => [] },
  'engagementAdmin:createUser': { path: 'admin/users/create', args: input => [input] },
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
  'engagement:trialBalances': { path: 'trial-balances', args: id => [{ engagementId: id }] },
  'engagement:trialBalanceRows': { path: 'trial-balance/rows', args: input => [input] },
  'engagement:importTrialBalance': { path: 'trial-balance/import', args: input => [input], selectFile: true },
  'engagement:journalList': { path: 'journals', args: id => [{ engagementId: id }] },
  'engagement:journalPost': { path: 'journal/post', args: input => [input] },
  'engagement:finalTrialBalances': { path: 'final-trial-balances', args: id => [{ engagementId: id }] },
  'engagement:finalTrialBalanceCreate': { path: 'final-trial-balance/create', args: input => [input] },
  'engagement:finalTrialBalanceRows': { path: 'final-trial-balance/rows', args: input => [input] },
  'engagement:reportingData': { path: 'reporting/data', args: input => [input] },
  'engagement:reportingSettingsSave': { path: 'reporting/settings/save', args: input => [input] },
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
          reject(new Error(result.error || `Engagement service request failed (${response.statusCode}).`))
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

export function registerEngagementClientHandlers(handlerRegistry = ipcMain, options = {}) {
  for (const [channel, operation] of Object.entries(OPERATIONS)) {
    handlerRegistry.handle(channel, async (event, input) => {
      if (options.startupError) throw new Error(options.startupError)
      if (!attachedSenders.has(event.sender.id)) {
        attachedSenders.add(event.sender.id)
        event.sender.once('destroyed', () => {
          attachedSenders.delete(event.sender.id)
          sessions.delete(event.sender.id)
        })
      }
      if (operation.selectFile) {
        const selection = await dialog.showOpenDialog({
          title: 'Import Trial Balance',
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
          fileName: basename(filePath),
          fileContentBase64: content.toString('base64'),
        }
      }
      const [payload, setupToken] = operation.args(input)
      const session = sessions.get(event.sender.id)
      const response = await post(
        serviceUrl(operation.path, options.serviceUrl),
        payload,
        session?.expiresAt > Date.now() ? session.token : null,
        setupToken || options.setupToken,
        options.ca,
      )

      if (channel === 'engagementAuth:login' || channel === 'engagementAuth:setup') {
        if (!response.sessionToken || !response.user) throw new Error('Engagement service did not establish a valid session.')
        sessions.set(event.sender.id, { token: response.sessionToken, expiresAt: Date.now() + SESSION_MAX_AGE })
        return response.user
      }
      if (channel === 'engagementAuth:logout') sessions.delete(event.sender.id)
      if (channel === 'engagementAuth:status' && !response.data?.user) sessions.delete(event.sender.id)
      if (session) session.expiresAt = Date.now() + SESSION_MAX_AGE
      if (channel === 'engagementAuth:status' && response.data) {
        return {
          ...response.data,
          ...(options.localDevelopment ? { localDevelopment: true } : {}),
          ...(options.serviceOnlyMode ? { serviceOnlyMode: true } : {}),
        }
      }
      return response.data
    })
  }
}
