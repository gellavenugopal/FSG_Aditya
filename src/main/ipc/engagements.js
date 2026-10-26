import { createHash, randomBytes } from 'node:crypto'
import * as XLSX from 'xlsx'
import { parseTBExcel } from '../services/tb-template.js'
import { runMappingEngine, persistMappingResults } from '../services/mapping-engine.js'
import { createEngagementPasswordRecord, verifyEngagementPassword } from '../services/engagement-password.js'
import { financialPeriodLabel } from '../../shared/financial-periods.mjs'
import {
  canEditEngagement, canFinaliseEngagement, canViewEngagement,
  isValidDateOnly, validateActivation, validateEngagementDraft,
} from '../services/engagement-domain.js'

let query
let runInTransaction
const sessions = new Map()
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000
const BOOTSTRAP_LOCK = 517203841

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return typeof value === 'string' ? value.slice(0, 10) : ''
}

function publicUser(row) {
  return {
    id: Number(row.id),
    firmId: Number(row.firm_id),
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    jobTitle: row.job_title || (row.role === 'partner' ? 'partner' : 'employee'),
    professionalSignatoryId: row.professional_signatory_id == null ? null : Number(row.professional_signatory_id),
    mustChangePassword: !!row.must_change_password,
  }
}

async function authenticated(event, allowPasswordChange = false) {
  const session = sessions.get(event.sender.id)
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(event.sender.id)
    throw new Error('Sign in to use engagement management.')
  }
  const { rows: [row] } = await query(
    `SELECT id,firm_id,email,display_name,role,job_title,professional_signatory_id,must_change_password
     FROM firm_users WHERE id=$1 AND active=TRUE`,
    [session.user.id]
  )
  if (!row) {
    sessions.delete(event.sender.id)
    throw new Error('This firm account is disabled. Contact your firm administrator.')
  }
  session.user = publicUser(row)
  if (session.user.mustChangePassword && !allowPasswordChange) {
    throw new Error('Change your temporary password before continuing.')
  }
  session.expiresAt = Date.now() + SESSION_MAX_AGE
  return session.user
}

async function fetchEngagement(firmId, engagementId) {
  const { rows: [row] } = await query(
    `SELECT e.*, en.name AS client_name, en.constitution, en.constitution_display,
            en.business_type, en.jurisdiction AS client_jurisdiction,
            en.legal_form AS client_legal_form,
            owner.display_name AS owner_name, owner.email AS owner_email,
            partner.display_name AS partner_name, partner.email AS partner_email,
            substitute.display_name AS substitute_name,
            rs.id AS reporting_set_id, rs.jurisdiction, rs.accounting_framework,
            rs.reporting_pack_id, rs.reporting_pack_version, rs.trial_balance_currency,
            rs.presentation_currency, rs.display_scale, rs.decimal_places,
            rs.template_selections, rs.entity_period_id, rs.compatibility_confirmed,
            fp.year_label AS period_label, fp.date_from, fp.date_till, ep.locked, ep.is_final
     FROM engagements e
     JOIN entities en ON en.id = e.entity_id
     JOIN firm_users owner ON owner.id = e.owner_user_id
     LEFT JOIN firm_users partner ON partner.id = e.partner_user_id
     LEFT JOIN firm_users substitute ON substitute.id = e.substitute_user_id
     LEFT JOIN LATERAL (
       SELECT * FROM engagement_reporting_sets WHERE engagement_id=e.id ORDER BY id LIMIT 1
     ) rs ON TRUE
     LEFT JOIN entity_periods ep ON ep.id = rs.entity_period_id
     LEFT JOIN financial_periods fp ON fp.id = ep.financial_period_id
     WHERE e.firm_id=$1 AND e.id=$2`,
    [firmId, engagementId]
  )
  if (!row) throw new Error('Engagement not found.')
  return row
}

async function membershipFor(engagementId, userId) {
  const { rows: [membership] } = await query(
    `SELECT access_level FROM engagement_memberships WHERE engagement_id=$1 AND user_id=$2`,
    [engagementId, userId]
  )
  return membership || null
}

async function assertCanView(user, engagement) {
  const membership = await membershipFor(engagement.id, user.id)
  if (!canViewEngagement(user, engagement, membership)) throw new Error('Engagement not found or access is not permitted.')
  return membership
}

async function assertEngagementTBContext(user, engagementId) {
  const id = Number(engagementId)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Engagement not found or access is not permitted.')
  const engagement = await fetchEngagement(user.firmId, id)
  const membership = await assertCanView(user, engagement)
  const { rows: [period] } = await query(
    `SELECT ep.id,ep.entity_id,ep.locked,ep.is_final,ep.financial_period_id,
            fp.year_label,fp.date_from,fp.date_till
     FROM engagement_reporting_sets rs
     JOIN entity_periods ep ON ep.id=rs.entity_period_id
     JOIN financial_periods fp ON fp.id=ep.financial_period_id
     WHERE rs.engagement_id=$1 AND rs.id=$2`,
    [engagement.id, engagement.reporting_set_id]
  )
  if (!period || Number(period.entity_id) !== Number(engagement.entity_id)) {
    throw new Error('The engagement reporting period is not linked to its client.')
  }
  return { engagement, membership, period }
}

function amountToCents(value) {
  const text = String(value ?? '').trim()
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(text)) throw new Error('Journal amounts must be positive numbers with no more than two decimal places.')
  const [whole, fraction = ''] = text.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Journal amounts must be positive and within the supported range.')
  return cents
}

function validateAuditReportFields(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Audit report fields must be an object.')
  const keys = [
    'addressee', 'opinion', 'basisForOpinion', 'managementResponsibilities',
    'auditorResponsibilities', 'otherMatters', 'reportDate', 'reportPlace',
    'firmName', 'firmAddress', 'firmRegistrationNumber', 'auditorName',
    'auditorMembershipNumber', 'auditorDesignation',
  ]
  const result = {}
  for (const key of keys) {
    const field = value[key] == null ? '' : String(value[key])
    if (field.length > 12000) throw new Error(`Audit report field "${key}" is too long.`)
    result[key] = field.trim()
  }
  if (result.reportDate && !isValidDateOnly(result.reportDate)) throw new Error('Audit report date must use YYYY-MM-DD.')
  return result
}

async function assertAuthorizedEngagementTB(user, engagementId, trialBalanceId) {
  const context = await assertEngagementTBContext(user, engagementId)
  const tbId = Number(trialBalanceId)
  if (!Number.isSafeInteger(tbId) || tbId <= 0) throw new Error('Trial balance not found in this engagement.')
  const { rows: [authorized] } = await query(
    `SELECT tb.id,tb.entity_id,tb.entity_period_id,tb.period,tb.filename,tb.row_count,tb.branch_name
     FROM trial_balances tb
     WHERE tb.id=$1 AND tb.entity_id=$2 AND tb.entity_period_id=$3 AND (
       EXISTS (SELECT 1 FROM engagement_trial_balance_imports i WHERE i.engagement_id=$4 AND i.trial_balance_id=tb.id)
       OR EXISTS (SELECT 1 FROM engagement_legacy_tb_links l WHERE l.engagement_id=$4 AND l.trial_balance_id=tb.id AND l.entity_period_id=$3)
       OR EXISTS (SELECT 1 FROM engagement_final_tb_snapshots s WHERE s.engagement_id=$4 AND s.trial_balance_id=tb.id)
     )`,
    [tbId, context.engagement.entity_id, context.period.id, context.engagement.id]
  )
  if (!authorized) throw new Error('Trial balance not found in this engagement.')
  return { ...context, trialBalance: authorized }
}

async function assertIndiaScheduleIII(engagement) {
  const { rows: [pack] } = await query(
    `SELECT processing_status FROM reporting_pack_catalog WHERE pack_id=$1`,
    [engagement.reporting_pack_id]
  )
  if (engagement.reporting_pack_id !== 'IN_SCHEDULE_III_LEGACY' || pack?.processing_status !== 'implemented') {
    throw new Error('This engagement reporting basis is not implemented in the current workflow. Only the existing India legacy Schedule III pack can be processed.')
  }
  if (engagement.trial_balance_currency !== 'INR' || engagement.presentation_currency !== 'INR') {
    throw new Error('This India reporting workflow formats figures in INR and does not translate currencies. Confirm both engagement currencies as INR before processing.')
  }
}

function assertEngagementEditable(engagement, period) {
  if (engagement.status === 'finalised' || engagement.status === 'archived' || period.locked || period.is_final) {
    throw new Error('This engagement reporting period is locked or finalised and cannot be changed.')
  }
}

function validateTBUpload(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > 8 * 1024 * 1024) {
    throw new Error('Trial Balance uploads must be a non-empty Excel file no larger than 8 MB.')
  }
  let workbook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  } catch {
    throw new Error('The selected file could not be read as an Excel workbook.')
  }
  const worksheet = workbook.Sheets['Trial Balance'] || workbook.Sheets[workbook.SheetNames[0]]
  if (!worksheet) throw new Error('The Excel workbook does not contain a worksheet.')
  const sourceRows = XLSX.utils.sheet_to_json(worksheet, { defval: null })
  const normalizedRows = sourceRows.map(row =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [String(key).trim().replace(/\s*\*$/, ''), value]))
  )
  const required = ['Name', 'OpeningBalance', 'Debit', 'Credit', 'ClosingBalance']
  const headerCells = worksheet['!ref'] ? XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null })[0] || [] : []
  const normalizedHeaders = new Set(headerCells.map(value => String(value ?? '').trim().replace(/\s*\*$/, '')))
  if (required.some(header => !normalizedHeaders.has(header))) {
    throw new Error('The Excel workbook must include Name, OpeningBalance, Debit, Credit and ClosingBalance columns.')
  }
  const populatedRows = normalizedRows.filter(row => Object.values(row).some(value => value !== null && value !== ''))
  if (!populatedRows.length || populatedRows.length > 100000) {
    throw new Error('The Excel file must contain between 1 and 100,000 ledger rows.')
  }
  for (let index = 0; index < populatedRows.length; index++) {
    const row = populatedRows[index]
    if (typeof row.Name !== 'string' || !row.Name.trim()) {
      throw new Error(`Ledger row ${index + 2} must have a Name.`)
    }
    for (const field of ['OpeningBalance', 'Debit', 'Credit', 'ClosingBalance']) {
      const value = row[field]
      if ((typeof value !== 'number' && typeof value !== 'string')
        || String(value).trim() === '' || !Number.isFinite(Number(value))) {
        throw new Error(`Ledger row ${index + 2} has an invalid ${field} amount.`)
      }
    }
  }
  const rows = parseTBExcel(buffer)
  if (rows.length !== populatedRows.length) {
    throw new Error('The Excel file contains rows that could not be imported.')
  }
  return rows
}

async function assertCanEdit(user, engagement) {
  const membership = await membershipFor(engagement.id, user.id)
  if (!canEditEngagement(user, engagement, membership)) throw new Error('Edit access is required for this engagement.')
  return membership
}

async function logAudit(user, action, engagementId = null, details = {}) {
  await query(
    `INSERT INTO engagement_audit_log (firm_id, engagement_id, actor_user_id, action, details)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [user.firmId, engagementId, user.id, action, JSON.stringify(details)]
  )
}

function validateUserList(ids, currentUserId) {
  if (!Array.isArray(ids)) return []
  const clean = [...new Set(ids.map(item => Number(item && typeof item === 'object' ? item.userId : item))
    .filter(id => Number.isInteger(id) && id > 0 && id !== currentUserId))]
  return clean.slice(0, 100)
}

async function assertFirmUsers(firmId, ids, requiredRole = null) {
  if (!ids.length) return
  const { rows } = await query(
    `SELECT id, role FROM firm_users WHERE firm_id=$1 AND active=TRUE AND id=ANY($2::int[])`,
    [firmId, ids]
  )
  if (rows.length !== ids.length) throw new Error('One or more selected users are unavailable.')
  if (requiredRole && rows.some(row => row.role !== requiredRole)) {
    throw new Error(`The assigned ${requiredRole} must be an active firm user with that role.`)
  }
}

async function ensureClientBelongsToFirm(firmId, entityId, actorId, allowUnassignedClaim = false) {
  const { rows: [entity] } = await query(`SELECT id FROM entities WHERE id=$1`, [entityId])
  if (!entity) throw new Error('Client not found.')
  const { rows: [claimed] } = await query(`SELECT firm_id FROM firm_entities WHERE entity_id=$1`, [entityId])
  if (claimed && Number(claimed.firm_id) !== firmId) throw new Error('This client belongs to another firm.')
  if (!claimed && !allowUnassignedClaim) throw new Error('Only an administrator can link an existing unassigned client to this firm.')
  await query(
    `INSERT INTO firm_entities (firm_id, entity_id, linked_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [firmId, entityId, actorId]
  )
}

async function attachEntityPeriod(entityId, start, end) {
  if (!start || !end) return { entityPeriodId: null, existingWork: false }
  const label = financialPeriodLabel(end)
  if (!label) throw new Error('The reporting period end date must be a valid ISO date.')
  const { rows: [fp] } = await query(
    `INSERT INTO financial_periods (year_label, date_from, date_till)
     VALUES ($1,$2,$3)
     ON CONFLICT (date_from, date_till) DO UPDATE SET year_label=EXCLUDED.year_label
     RETURNING id`,
    [label, start, end]
  )
  const { rows: [ep] } = await query(
    `INSERT INTO entity_periods (entity_id, financial_period_id) VALUES ($1,$2)
     ON CONFLICT (entity_id, financial_period_id) DO UPDATE SET financial_period_id=EXCLUDED.financial_period_id
     RETURNING id`,
    [entityId, fp.id]
  )
  const { rows: [tb] } = await query(
    `SELECT EXISTS(SELECT 1 FROM trial_balances WHERE entity_period_id=$1) AS linked_work,
            EXISTS(SELECT 1 FROM trial_balances WHERE entity_id=$2 AND entity_period_id IS NULL) AS unlinked_work`,
    [ep.id, entityId]
  )
  return {
    entityPeriodId: Number(ep.id),
    existingWork: !!tb?.linked_work || !!tb?.unlinked_work,
    hasUnlinkedTrialBalances: !!tb?.unlinked_work,
  }
}

async function assertEntityPeriodAvailableForActivation(entityPeriodId) {
  if (!entityPeriodId) throw new Error('Set a reporting period before activating this engagement.')
  const { rows: [period] } = await query(
    `SELECT locked,is_final FROM entity_periods WHERE id=$1 FOR UPDATE`,
    [entityPeriodId]
  )
  if (!period) throw new Error('The linked entity period no longer exists.')
  if (period.locked || period.is_final) {
    throw new Error('The linked entity period is already locked or finalised. Resolve its existing state before activating this engagement.')
  }
}

export function registerEngagementHandlers(ipcMain, database) {
  if (!ipcMain?.handle || typeof database?.query !== 'function' || typeof database?.runInTransaction !== 'function') {
    throw new Error('Engagement handlers require an IPC-compatible handler registry and database adapter.')
  }
  query = database.query
  runInTransaction = database.runInTransaction

  async function reportingIdentity(engagement) {
    const { rows: [selection] } = await query(
      `SELECT responsible_auditor_firm_id,responsible_office_id,branding_auditor_firm_id,management_signatory_ids
       FROM engagement_reporting_sets WHERE id=$1 AND engagement_id=$2`,
      [engagement.reporting_set_id, engagement.id]
    )
    const { rows: firms } = await query(
      `SELECT id,firm_name,frn,pan,address,email,phone,is_active
       FROM auditor_firms WHERE service_firm_id=$1 ORDER BY firm_name,id`,
      [engagement.firm_id]
    )
    const { rows: offices } = await query(
      `SELECT id,auditor_firm_id,office_name,address,phone,email,is_active
       FROM auditor_firm_offices WHERE service_firm_id=$1 ORDER BY office_name,id`,
      [engagement.firm_id]
    )
    const { rows: partners } = await query(
      `SELECT id,display_name,job_title,qualification,registration_number,active
       FROM firm_users WHERE firm_id=$1 AND role='partner' ORDER BY display_name,id`,
      [engagement.firm_id]
    )
    const responsibleFirm = firms.find(item => Number(item.id) === Number(selection?.responsible_auditor_firm_id))
    const office = offices.find(item => Number(item.id) === Number(selection?.responsible_office_id))
    const brandingFirm = firms.find(item => Number(item.id) === Number(selection?.branding_auditor_firm_id))
    const partner = partners.find(item => Number(item.id) === Number(engagement.partner_user_id))
    let logo = { logo_mime_type: null, logo_base64: null }
    if (brandingFirm) {
      const { rows: [branding] } = await query(
        `SELECT logo_mime_type,replace(encode(logo_data,'base64'),E'\\n','') AS logo_base64
         FROM auditor_firms WHERE id=$1 AND service_firm_id=$2`,
        [brandingFirm.id, engagement.firm_id]
      )
      if (branding) logo = branding
    }
    const signatoryIds = Array.isArray(selection?.management_signatory_ids)
      ? selection.management_signatory_ids.map(Number) : []
    return {
      selection: {
        responsibleAuditorFirmId: selection?.responsible_auditor_firm_id == null ? '' : String(selection.responsible_auditor_firm_id),
        responsibleOfficeId: selection?.responsible_office_id == null ? '' : String(selection.responsible_office_id),
        brandingAuditorFirmId: selection?.branding_auditor_firm_id == null ? '' : String(selection.branding_auditor_firm_id),
        managementSignatoryIds: signatoryIds,
      },
      firms,
      offices,
      partners,
      responsibleFirm: responsibleFirm || null,
      office: office || null,
      brandingFirm: brandingFirm ? { ...brandingFirm, ...logo } : null,
      partner: partner || null,
      fields: {
        firmName: responsibleFirm?.firm_name || '',
        firmAddress: office?.address || responsibleFirm?.address || '',
        firmRegistrationNumber: responsibleFirm?.frn || '',
        auditorName: partner?.display_name || '',
        auditorMembershipNumber: partner?.registration_number || '',
        auditorDesignation: partner
          ? [partner.job_title || 'Partner', partner.qualification].filter(Boolean).join(' · ')
          : '',
      },
      identitySnapshot: {
        responsibleFirm: responsibleFirm ? {
          id: Number(responsibleFirm.id), name: responsibleFirm.firm_name, frn: responsibleFirm.frn,
          pan: responsibleFirm.pan, address: responsibleFirm.address, email: responsibleFirm.email,
          phone: responsibleFirm.phone, active: !!responsibleFirm.is_active,
        } : null,
        office: office ? {
          id: Number(office.id), name: office.office_name, address: office.address,
          phone: office.phone, email: office.email, active: !!office.is_active,
        } : null,
        partner: partner ? {
          id: Number(partner.id), name: partner.display_name, designation: partner.job_title,
          qualification: partner.qualification, registrationNumber: partner.registration_number,
        } : null,
        branding: brandingFirm ? {
          id: Number(brandingFirm.id), name: brandingFirm.firm_name,
          logoMimeType: logo.logo_mime_type || null, logoBase64: logo.logo_base64 || null,
        } : null,
      },
    }
  }

  ipcMain.handle('engagementAuth:status', async (event) => {
    const { rows: [result] } = await query(
      `SELECT EXISTS(SELECT 1 FROM firm_users WHERE role='administrator') AS configured`
    )
    const session = sessions.get(event.sender.id)
    let user = null
    if (session && session.expiresAt > Date.now()) {
      const { rows: [activeUser] } = await query(
        `SELECT id,firm_id,email,display_name,role,job_title,professional_signatory_id,must_change_password
         FROM firm_users WHERE id=$1 AND active=TRUE`,
        [session.user.id]
      )
      if (activeUser) {
        user = publicUser(activeUser)
        session.user = user
        session.expiresAt = Date.now() + SESSION_MAX_AGE
      } else {
        sessions.delete(event.sender.id)
      }
    }
    return {
      setupRequired: !result.configured,
      user,
    }
  })

  ipcMain.handle('engagementAuth:setup', async (event, input = {}) => {
    const email = cleanEmail(input.email)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid administrator email.')
    if (!String(input.firmName || '').trim()) throw new Error('Firm name is required.')
    if (!String(input.displayName || '').trim()) throw new Error('Administrator name is required.')
    const { salt, hash } = await createEngagementPasswordRecord(input.password)
    const user = await runInTransaction(async () => {
      await query(`SELECT pg_advisory_xact_lock($1)`, [BOOTSTRAP_LOCK])
      const { rows: [existing] } = await query(
        `SELECT EXISTS(SELECT 1 FROM firm_users WHERE role='administrator') AS configured`
      )
      if (existing.configured) throw new Error('Administrator setup has already been completed.')
      const { rows: [currentFirm] } = await query(`SELECT firm_id FROM firm_users ORDER BY id LIMIT 1`)
      const { rows: [firm] } = currentFirm
        ? await query(`SELECT id FROM firms WHERE id=$1`, [currentFirm.firm_id])
        : await query(`INSERT INTO firms(name) VALUES($1) RETURNING id`, [String(input.firmName).trim()])
      if (!firm) throw new Error('The existing firm record is unavailable; contact the service administrator.')
      const { rows: [row] } = await query(
        `INSERT INTO firm_users (firm_id,email,display_name,job_title,password_salt,password_hash,role)
         VALUES ($1,$2,$3,'partner',$4,$5,'administrator') RETURNING *`,
        [firm.id, email, String(input.displayName).trim(), salt, hash]
      )
      const administrator = publicUser(row)
      await logAudit(administrator, 'firm.admin_bootstrapped')
      return administrator
    })
    sessions.set(event.sender.id, { user, expiresAt: Date.now() + SESSION_MAX_AGE })
    return user
  })

  ipcMain.handle('engagementAuth:login', async (event, input = {}) => {
    const email = cleanEmail(input.email)
    const { rows } = await query(
      `SELECT * FROM firm_users WHERE lower(email)=$1 AND active=TRUE ORDER BY id LIMIT 2`,
      [email]
    )
    const row = rows.length === 1 ? rows[0] : null
    if (!row || !(await verifyEngagementPassword(input.password, row.password_salt, row.password_hash))) {
      throw new Error('Email or password is incorrect.')
    }
    const user = publicUser(row)
    await logAudit(user, 'user.signed_in', null, {})
    sessions.set(event.sender.id, { user, expiresAt: Date.now() + SESSION_MAX_AGE })
    return user
  })

  ipcMain.handle('engagementAuth:logout', async (event) => {
    const session = sessions.get(event.sender.id)
    if (session) await logAudit(session.user, 'user.signed_out')
    sessions.delete(event.sender.id)
    return { ok: true }
  })

  ipcMain.handle('engagementAuth:changePassword', async (event, password) => {
    const user = await authenticated(event, true)
    const { salt, hash } = await createEngagementPasswordRecord(password)
    await runInTransaction(async () => {
      await query(
        `UPDATE firm_users SET password_salt=$1,password_hash=$2,must_change_password=FALSE,updated_at=now() WHERE id=$3`,
        [salt, hash, user.id]
      )
      await logAudit(user, 'user.password_changed')
    })
    for (const [senderId, activeSession] of sessions) {
      if (senderId !== event.sender.id && activeSession.user.id === user.id) sessions.delete(senderId)
    }
    const currentSession = sessions.get(event.sender.id)
    if (currentSession) currentSession.user = { ...user, mustChangePassword: false }
    return { ok: true }
  })

  ipcMain.handle('engagementAdmin:listUsers', async (event) => {
    const user = await authenticated(event)
    if (user.role !== 'administrator') throw new Error('Administrator access is required.')
    const { rows } = await query(
      `SELECT id,firm_id,email,display_name,role,job_title,professional_signatory_id,must_change_password
       FROM firm_users WHERE firm_id=$1 AND active=TRUE ORDER BY display_name`,
      [user.firmId]
    )
    return rows.map(publicUser)
  })

  ipcMain.handle('engagementAdmin:createUser', async (event, input = {}) => {
    const actor = await authenticated(event)
    if (actor.role !== 'administrator') throw new Error('Administrator access is required.')
    const email = cleanEmail(input.email)
    const name = String(input.displayName || '').trim()
    const jobTitle = String(input.jobTitle || 'employee')
    const role = jobTitle === 'partner' ? 'partner' : 'staff'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid user email.')
    if (!name) throw new Error('User name is required.')
    if (!['employee', 'article', 'auditor', 'partner'].includes(jobTitle)) throw new Error('Choose a valid team position.')
    const initialPassword = randomBytes(24).toString('hex')
    const { salt, hash } = await createEngagementPasswordRecord(initialPassword)
    const row = await runInTransaction(async () => {
      const { rows: [created] } = await query(
        `INSERT INTO firm_users (firm_id,email,display_name,job_title,password_salt,password_hash,role,must_change_password)
         VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
         RETURNING id,firm_id,email,display_name,role,job_title,professional_signatory_id,must_change_password`,
        [actor.firmId, email, name, jobTitle, salt, hash, role]
      )
      await logAudit(actor, 'user.created', null, { userId: Number(created.id), email, role, jobTitle })
      return created
    })
    return { user: publicUser(row), initialPassword }
  })

  ipcMain.handle('engagementAdmin:firmSettings', async (event) => {
    const actor = await authenticated(event)
    const { rows: professionalFirms } = await query(
      `SELECT id,firm_name,frn,pan,address,email,phone,is_active,logo_mime_type,
              replace(encode(logo_data,'base64'),E'\\n','') AS logo_base64
       FROM auditor_firms WHERE service_firm_id=$1 ORDER BY firm_name,id`,
      [actor.firmId]
    )
    const { rows: offices } = await query(
      `SELECT id,auditor_firm_id,office_name,address,phone,email,is_active
       FROM auditor_firm_offices WHERE service_firm_id=$1 ORDER BY auditor_firm_id,office_name,id`,
      [actor.firmId]
    )
    const { rows: partners } = await query(
      `SELECT id,display_name,email,job_title,qualification,registration_number,active
       FROM firm_users WHERE firm_id=$1 AND role='partner' ORDER BY display_name,id`,
      [actor.firmId]
    )
    let availableProfessionalFirms = []
    if (actor.role === 'administrator') {
      const { rows } = await query(
        `SELECT id,firm_name,frn,pan,address,email,phone,is_active
         FROM auditor_firms WHERE service_firm_id IS NULL ORDER BY firm_name,id`
      )
      availableProfessionalFirms = rows
    }
    return {
      professionalFirms: professionalFirms.map(row => ({ ...row, id: Number(row.id) })),
      availableProfessionalFirms: availableProfessionalFirms.map(row => ({ ...row, id: Number(row.id) })),
      offices: offices.map(row => ({ ...row, id: Number(row.id), auditor_firm_id: Number(row.auditor_firm_id) })),
      partners: partners.map(row => ({ ...row, id: Number(row.id) })),
      canManage: actor.role === 'administrator',
    }
  })

  ipcMain.handle('engagementAdmin:saveProfessionalFirm', async (event, input = {}) => {
    const actor = await authenticated(event)
    if (actor.role !== 'administrator') throw new Error('Administrator access is required.')
    const firmName = String(input.firmName || '').trim()
    const frn = String(input.frn || '').trim()
    const pan = String(input.pan || '').trim()
    const address = String(input.address || '').trim()
    const email = String(input.email || '').trim()
    const phone = String(input.phone || '').trim()
    const clearLogo = input.clearLogo === true
    if (!firmName || firmName.length > 255 || frn.length > 100 || pan.length > 50
      || address.length > 2000 || email.length > 255 || phone.length > 100) {
      throw new Error('Enter valid firm details within the allowed lengths.')
    }
    const active = input.isActive !== false
    let logo = null
    let logoMime = null
    if (input.logoBase64) {
      const encoded = String(input.logoBase64)
      if (encoded.length > 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
        throw new Error('Choose a PNG or JPEG logo no larger than 750 KB.')
      }
      logo = Buffer.from(encoded, 'base64')
      if (logo.length > 750 * 1024 || logo.toString('base64') !== encoded) throw new Error('Choose a PNG or JPEG logo no larger than 750 KB.')
      if (input.logoMimeType === 'image/png' && logo.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
        logoMime = 'image/png'
      } else if (input.logoMimeType === 'image/jpeg' && logo[0] === 0xff && logo[1] === 0xd8 && logo[2] === 0xff) {
        logoMime = 'image/jpeg'
      } else {
        throw new Error('The selected logo content does not match its PNG or JPEG file type.')
      }
    } else if (input.logoMimeType) {
      throw new Error('Logo data is required when specifying a logo file type.')
    }

    return runInTransaction(async () => {
      let row
      const id = input.id ? Number(input.id) : null
      if (id && Number.isSafeInteger(id)) {
        const { rows: [existing] } = await query(
          `SELECT id,service_firm_id FROM auditor_firms WHERE id=$1 FOR UPDATE`,
          [id]
        )
        if (!existing || (existing.service_firm_id && Number(existing.service_firm_id) !== actor.firmId)) {
          throw new Error('This professional firm is not available to your firm.')
        }
        const { rows: [updated] } = await query(
          `UPDATE auditor_firms SET service_firm_id=$1,firm_name=$2,frn=$3,pan=$4,address=$5,email=$6,phone=$7,
             is_active=$8,logo_mime_type=CASE WHEN $9 THEN $10 WHEN $12 THEN NULL ELSE logo_mime_type END,
             logo_data=CASE WHEN $9 THEN $11::bytea WHEN $12 THEN NULL ELSE logo_data END
           WHERE id=$13 RETURNING id,firm_name,frn,is_active`,
          [actor.firmId, firmName, frn || null, pan || null, address || null, email || null, phone || null,
            active, !!logo, logoMime, logo, clearLogo && !logo, id]
        )
        row = updated
      } else {
        if (id) throw new Error('Choose a valid professional firm.')
        const { rows: [existing] } = await query(
          `SELECT id,service_firm_id FROM auditor_firms
           WHERE lower(btrim(firm_name))=lower(btrim($1))
             AND COALESCE(btrim(frn),'')=COALESCE(btrim($2),'')
           ORDER BY id LIMIT 1 FOR UPDATE`,
          [firmName, frn || null]
        )
        if (existing && existing.service_firm_id && Number(existing.service_firm_id) !== actor.firmId) {
          throw new Error('A matching auditor firm is already associated with another service firm.')
        }
        if (existing) {
          const { rows: [updated] } = await query(
            `UPDATE auditor_firms SET service_firm_id=$1,firm_name=$2,frn=$3,pan=$4,address=$5,email=$6,phone=$7,
               is_active=$8,logo_mime_type=CASE WHEN $9 THEN $10 WHEN $12 THEN NULL ELSE logo_mime_type END,
               logo_data=CASE WHEN $9 THEN $11::bytea WHEN $12 THEN NULL ELSE logo_data END
             WHERE id=$13 RETURNING id,firm_name,frn,is_active`,
            [actor.firmId, firmName, frn || null, pan || null, address || null, email || null, phone || null,
              active, !!logo, logoMime, logo, clearLogo && !logo, existing.id]
          )
          row = updated
        } else {
          const { rows: [created] } = await query(
            `INSERT INTO auditor_firms
               (service_firm_id,firm_name,frn,pan,address,email,phone,is_active,logo_mime_type,logo_data)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING id,firm_name,frn,is_active`,
            [actor.firmId, firmName, frn || null, pan || null, address || null, email || null,
              phone || null, active, logoMime, logo]
          )
          row = created
        }
      }
      await logAudit(actor, 'firm.professional_master_updated', null, { auditorFirmId: Number(row.id), isActive: active })
      return { ...row, id: Number(row.id) }
    })
  })

  ipcMain.handle('engagementAdmin:saveFirmOffice', async (event, input = {}) => {
    const actor = await authenticated(event)
    if (actor.role !== 'administrator') throw new Error('Administrator access is required.')
    const auditorFirmId = Number(input.auditorFirmId)
    const officeName = String(input.officeName || '').trim()
    const address = String(input.address || '').trim()
    const phone = String(input.phone || '').trim()
    const email = String(input.email || '').trim()
    if (!Number.isSafeInteger(auditorFirmId) || auditorFirmId <= 0 || !officeName || officeName.length > 255
      || !address || address.length > 2000 || phone.length > 100 || email.length > 255) {
      throw new Error('Enter a valid office name, address and contact details.')
    }
    const { rows: [professionalFirm] } = await query(
      `SELECT id FROM auditor_firms WHERE id=$1 AND service_firm_id=$2 AND is_active=TRUE`,
      [auditorFirmId, actor.firmId]
    )
    if (!professionalFirm) throw new Error('Choose an active professional firm belonging to your firm.')
    const officeId = input.id ? Number(input.id) : null
    if (officeId && (!Number.isSafeInteger(officeId) || officeId <= 0)) throw new Error('Choose a valid office.')
    const { rows: [office] } = officeId
      ? await query(
        `UPDATE auditor_firm_offices SET auditor_firm_id=$1,office_name=$2,address=$3,phone=$4,email=$5,
           is_active=$6,updated_at=now()
         WHERE id=$7 AND service_firm_id=$8 RETURNING id,auditor_firm_id,office_name,is_active`,
        [auditorFirmId, officeName, address, phone || null, email || null, input.isActive !== false, officeId, actor.firmId]
      )
      : await query(
        `INSERT INTO auditor_firm_offices
           (service_firm_id,auditor_firm_id,office_name,address,phone,email,is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,auditor_firm_id,office_name,is_active`,
        [actor.firmId, auditorFirmId, officeName, address, phone || null, email || null, input.isActive !== false]
      )
    if (!office) throw new Error('This office is not available to your firm.')
    await logAudit(actor, 'firm.office_updated', null, { officeId: Number(office.id), auditorFirmId })
    return { ...office, id: Number(office.id), auditor_firm_id: Number(office.auditor_firm_id) }
  })

  ipcMain.handle('engagementAdmin:savePartnerProfile', async (event, input = {}) => {
    const actor = await authenticated(event)
    if (actor.role !== 'administrator') throw new Error('Administrator access is required.')
    const partnerId = Number(input.partnerId)
    const qualification = String(input.qualification || '').trim()
    const registrationNumber = String(input.registrationNumber || '').trim()
    if (!Number.isSafeInteger(partnerId) || partnerId <= 0 || qualification.length > 255 || registrationNumber.length > 100) {
      throw new Error('Enter valid partner professional details.')
    }
    const { rows: [partner] } = await query(
      `UPDATE firm_users SET qualification=$1,registration_number=$2,active=$3,updated_at=now()
       WHERE id=$4 AND firm_id=$5 AND role='partner'
       RETURNING id,display_name,qualification,registration_number,active`,
      [qualification || null, registrationNumber || null, input.isActive !== false, partnerId, actor.firmId]
    )
    if (!partner) throw new Error('Choose an existing partner in this firm.')
    await logAudit(actor, 'firm.partner_profile_updated', null, { partnerId })
    return { ...partner, id: Number(partner.id) }
  })

  ipcMain.handle('engagement:listOptions', async (event) => {
    const user = await authenticated(event)
    const { rows: entities } = await query(
      `SELECT e.id,e.name,e.constitution,e.constitution_display,e.business_type,e.jurisdiction,e.legal_form
       FROM entities e
       LEFT JOIN firm_entities fe ON fe.entity_id=e.id
       WHERE fe.firm_id=$1 OR ($2='administrator' AND fe.entity_id IS NULL)
       ORDER BY e.name`,
      [user.firmId, user.role]
    )
    const { rows: periods } = await query(`SELECT id,year_label,date_from,date_till FROM financial_periods ORDER BY date_from DESC,date_till DESC,id DESC`)
    const { rows: packs } = await query(`SELECT * FROM reporting_pack_catalog ORDER BY jurisdiction,framework`)
    const { rows: users } = await query(
      `SELECT id,email,display_name,role,job_title FROM firm_users WHERE firm_id=$1 AND active=TRUE ORDER BY display_name`,
      [user.firmId]
    )
    return {
      entities,
      periods,
      packs,
      users: users.map(row => ({
        id: Number(row.id),
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        jobTitle: row.job_title || (row.role === 'partner' ? 'partner' : 'employee'),
      })),
    }
  })

  ipcMain.handle('engagement:createClient', async (event, input = {}) => {
    const user = await authenticated(event)
    const name = String(input.name || '').trim()
    const jurisdiction = String(input.jurisdiction || '').trim().toUpperCase()
    const legalForm = String(input.legalForm || '').trim()
    if (!name) throw new Error('Client name is required.')
    if (!/^[A-Z]{2}$/.test(jurisdiction)) throw new Error('Choose a two-letter jurisdiction code.')
    if (!legalForm) throw new Error('Legal form must be confirmed.')
    const legacyConstitution = legalForm === 'LLP' ? 2 : ['Individual', 'Proprietorship', 'Partnership'].includes(legalForm) ? 1 : 3
    return runInTransaction(async () => {
      const { rows: [entity] } = await query(
        `INSERT INTO entities (name,constitution,constitution_display,jurisdiction,legal_form)
         VALUES ($1,$2,$3,$4,$5) RETURNING id,name,constitution,constitution_display,jurisdiction,legal_form`,
        [name, legacyConstitution, legalForm, jurisdiction, legalForm]
      )
      await query(`INSERT INTO firm_entities (firm_id,entity_id,linked_by) VALUES ($1,$2,$3)`, [user.firmId, entity.id, user.id])
      await logAudit(user, 'client.created', null, { entityId: Number(entity.id), jurisdiction, legalForm })
      return entity
    })
  })

  ipcMain.handle('engagement:list', async (event, scope = 'my') => {
    const user = await authenticated(event)
    if (scope === 'all' && !['administrator', 'partner'].includes(user.role)) {
      throw new Error('All-engagement visibility is restricted to partners and administrators.')
    }
    const all = scope === 'all'
    const { rows } = await query(
      `SELECT e.id,e.reference,e.name,e.entity_id,en.name AS client_name,e.period_start,e.period_end,
              e.status,e.service_scope,e.owner_user_id,owner.display_name AS owner_name,
              e.partner_user_id,partner.display_name AS partner_name,
              rs.jurisdiction,rs.accounting_framework,rs.reporting_pack_id,rs.trial_balance_currency,
              rs.presentation_currency,rs.entity_period_id,rs.compatibility_confirmed,
              CASE WHEN e.owner_user_id=$2 THEN 'Owner'
                   WHEN e.partner_user_id=$2 THEN 'Assigned partner'
                   WHEN e.substitute_user_id=$2 THEN 'Authorised substitute'
                   WHEN m.access_level IS NOT NULL THEN m.access_level
                   WHEN $4::boolean AND $3 IN ('administrator','partner') THEN 'Firm-wide visibility'
                   ELSE 'read' END AS current_access
       FROM engagements e
       JOIN entities en ON en.id=e.entity_id
       JOIN firm_users owner ON owner.id=e.owner_user_id
       LEFT JOIN firm_users partner ON partner.id=e.partner_user_id
       LEFT JOIN LATERAL (
         SELECT * FROM engagement_reporting_sets WHERE engagement_id=e.id ORDER BY id LIMIT 1
       ) rs ON TRUE
       LEFT JOIN engagement_memberships m ON m.engagement_id=e.id AND m.user_id=$2
       WHERE e.firm_id=$1 AND (
         $4::boolean OR e.owner_user_id=$2 OR e.partner_user_id=$2 OR e.substitute_user_id=$2 OR m.user_id IS NOT NULL
       )
       ORDER BY e.updated_at DESC,e.id DESC`,
      [user.firmId, user.id, user.role, all]
    )
    return rows.map(row => ({ ...row, id: Number(row.id), entity_id: Number(row.entity_id) }))
  })

  ipcMain.handle('engagement:checkDuplicates', async (event, input = {}) => {
    const user = await authenticated(event)
    const entityId = Number(input.entityId)
    const start = input.periodStart
    const end = input.periodEnd
    const excludeId = input.excludeEngagementId == null ? null : Number(input.excludeEngagementId)
    if (!Number.isInteger(entityId) || entityId <= 0 || !isValidDateOnly(start) || !isValidDateOnly(end) || start >= end
      || (excludeId !== null && (!Number.isInteger(excludeId) || excludeId <= 0))) {
      throw new Error('Select a client and enter a valid reporting period.')
    }
    const { rows: [client] } = await query(
      `SELECT 1 FROM firm_entities WHERE firm_id=$1 AND entity_id=$2`,
      [user.firmId, entityId]
    )
    if (!client) throw new Error('Client not found or not available to this firm.')
    const { rows } = await query(
      `SELECT e.id,e.reference,e.name,e.status,e.owner_user_id,e.partner_user_id,e.substitute_user_id,
              owner.display_name AS owner_name,rs.accounting_framework,
              m.access_level
       FROM engagements e
       JOIN firm_users owner ON owner.id=e.owner_user_id
       LEFT JOIN LATERAL (
         SELECT * FROM engagement_reporting_sets WHERE engagement_id=e.id ORDER BY id LIMIT 1
       ) rs ON TRUE
       LEFT JOIN engagement_memberships m ON m.engagement_id=e.id AND m.user_id=$5
       WHERE e.firm_id=$1 AND e.entity_id=$2 AND e.period_start=$3::date AND e.period_end=$4::date
         AND ($6::bigint IS NULL OR e.id<>$6::bigint)
       ORDER BY e.created_at`,
      [user.firmId, entityId, start, end, user.id, excludeId]
    )
    const visibleMatches = rows.filter(row => canViewEngagement(user, row, row.access_level ? { access_level: row.access_level } : null))
      .map(({ id, reference, name, status, owner_name, accounting_framework }) => ({
        id: Number(id), reference, name, status, owner_name, accounting_framework,
      }))
    return { visibleMatches, restrictedMatch: visibleMatches.length < rows.length }
  })

  ipcMain.handle('engagement:requestAccessForPeriod', async (event, input = {}) => {
    const user = await authenticated(event)
    const entityId = Number(input.entityId)
    if (!Number.isInteger(entityId) || entityId <= 0 || !isValidDateOnly(input.periodStart)
      || !isValidDateOnly(input.periodEnd) || input.periodStart >= input.periodEnd) {
      throw new Error('Select a client and enter a valid reporting period.')
    }
    const { rows: [client] } = await query(
      `SELECT 1 FROM firm_entities WHERE firm_id=$1 AND entity_id=$2`,
      [user.firmId, entityId]
    )
    if (!client) throw new Error('Client not found or not available to this firm.')
    await runInTransaction(async () => {
      const { rows } = await query(
        `SELECT e.id FROM engagements e
         WHERE e.firm_id=$1 AND e.entity_id=$2 AND e.period_start=$3::date AND e.period_end=$4::date`,
        [user.firmId, entityId, input.periodStart, input.periodEnd]
      )
      for (const row of rows) {
        const membership = await membershipFor(row.id, user.id)
        const full = await fetchEngagement(user.firmId, row.id)
        if (canViewEngagement(user, full, membership)) continue
        await query(
          `INSERT INTO engagement_access_requests (engagement_id,user_id,message)
           VALUES ($1,$2,$3) ON CONFLICT (engagement_id,user_id) DO UPDATE
           SET message=EXCLUDED.message,status='pending',resolved_by=NULL,resolved_at=NULL,created_at=now()`,
          [row.id, user.id, String(input.message || '').trim() || null]
        )
        await logAudit(user, 'access.requested', row.id, {})
      }
    })
    return { message: 'If a matching engagement exists, your access request has been sent to its owner.' }
  })

  ipcMain.handle('engagement:create', async (event, input = {}) => {
    const actor = await authenticated(event)
    const errors = validateEngagementDraft(input)
    if (input.status && !['draft', 'active'].includes(input.status)) errors.push('Choose Draft or Active status.')
    if (input.status === 'active') errors.push(...validateActivation(input))
    if (errors.length) throw new Error([...new Set(errors)].join(' '))

    const entityId = Number(input.entityId)
    const ownerId = Number(input.ownerUserId || actor.id)
    const partnerId = input.partnerUserId ? Number(input.partnerUserId) : null
    const substituteId = input.substituteUserId ? Number(input.substituteUserId) : null
    if (ownerId !== actor.id && !['administrator', 'partner'].includes(actor.role)) {
      throw new Error('Only a partner or administrator can assign another engagement owner.')
    }
    if (!partnerId && input.status === 'active') throw new Error('An engagement partner is required to activate.')
    const participants = validateUserList(input.participants, actor.id)
    const userIds = [...new Set([ownerId, partnerId, substituteId, ...participants].filter(Boolean))]
    await assertFirmUsers(actor.firmId, userIds)
    if (partnerId) await assertFirmUsers(actor.firmId, [partnerId], 'partner')
    if (substituteId) await assertFirmUsers(actor.firmId, [substituteId], 'partner')
    if (substituteId && substituteId === partnerId) throw new Error('The substitute must be different from the assigned partner.')

    const pack = input.reportingPackId ? String(input.reportingPackId) : null
    const { rows: [catalog] } = pack
      ? await query(`SELECT * FROM reporting_pack_catalog WHERE pack_id=$1`, [pack])
      : { rows: [null] }
    if (pack && !catalog) throw new Error('Choose a reporting pack from the catalogue.')
    const reporting = {
      ...input,
      jurisdiction: catalog?.jurisdiction || input.jurisdiction || '',
      framework: catalog?.framework || input.framework || '',
      reportingPackId: pack,
    }
    if (input.status === 'active' && catalog?.processing_status !== 'implemented') {
      throw new Error('This reporting pack is catalogued but its reporting engine is not implemented.')
    }
    if (input.status === 'active' && input.trialBalanceCurrency !== input.presentationCurrency) {
      throw new Error('Currency translation is not implemented; the two currencies must match.')
    }
    const separateReason = String(input.separateReason || '').trim()
    const created = await runInTransaction(async () => {
      await query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [
        `${actor.firmId}:${entityId}`,
        `${input.periodStart || 'draft'}:${input.periodEnd || 'draft'}`,
      ])
      await ensureClientBelongsToFirm(actor.firmId, entityId, actor.id, actor.role === 'administrator')
      let duplicateCount = 0
      if (input.periodStart && input.periodEnd) {
        const { rows: [dupes] } = await query(
          `SELECT COUNT(*)::int AS count FROM engagements
           WHERE firm_id=$1 AND entity_id=$2 AND period_start=$3::date AND period_end=$4::date`,
          [actor.firmId, entityId, input.periodStart, input.periodEnd]
        )
        duplicateCount = dupes.count
        if (duplicateCount && !separateReason) throw new Error('A matching engagement may already exist. Review matches or record why this engagement is separate.')
      }

      const { rows: [ref] } = await query(`SELECT nextval('engagement_reference_seq') AS number`)
      const reference = String(input.reference || '').trim() || `ENG-${String(new Date().getFullYear()).slice(-2)}-${String(ref.number).padStart(5, '0')}`
      const status = input.status === 'active' ? 'active' : 'draft'
      const periodName = String(input.name || '').trim()
      const attached = await attachEntityPeriod(entityId, input.periodStart, input.periodEnd)
      if (status === 'active') await assertEntityPeriodAvailableForActivation(attached.entityPeriodId)
      const compatibilityConfirmed = !!input.compatibilityConfirmed && !attached.hasUnlinkedTrialBalances
      if (input.status === 'active' && !compatibilityConfirmed) {
        throw new Error('Existing unlinked trial balances must be reviewed before activating this engagement.')
      }
      const { rows: [engagement] } = await query(
        `INSERT INTO engagements
           (firm_id,reference,name,entity_id,period_start,period_end,owner_user_id,partner_user_id,
            substitute_user_id,service_scope,status,separate_reason,created_by)
         VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [actor.firmId, reference, periodName, entityId, input.periodStart || null, input.periodEnd || null,
          ownerId, partnerId, substituteId, input.serviceScope, status, separateReason || null, actor.id]
      )
      await query(
        `INSERT INTO engagement_reporting_sets
           (engagement_id,jurisdiction,accounting_framework,reporting_pack_id,reporting_pack_version,
            trial_balance_currency,presentation_currency,display_scale,decimal_places,template_selections,
            entity_period_id,compatibility_confirmed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
        [engagement.id, reporting.jurisdiction, reporting.framework, pack, catalog?.pack_version || null,
          input.trialBalanceCurrency || null, input.presentationCurrency || null, input.displayScale || 'units',
          Number.isInteger(Number(input.decimalPlaces)) ? Number(input.decimalPlaces) : 2,
          JSON.stringify(input.templateSelections || {}), attached.entityPeriodId, compatibilityConfirmed]
      )

      const initialMembers = new Map()
      initialMembers.set(ownerId, 'edit')
      if (partnerId) initialMembers.set(partnerId, 'read')
      if (substituteId) initialMembers.set(substituteId, 'read')
      for (const p of Array.isArray(input.participants) ? input.participants : []) {
        const userId = Number(p.userId)
        const access = p.accessLevel === 'edit' ? 'edit' : 'read'
        if (participants.includes(userId) && ![ownerId, partnerId, substituteId].includes(userId)) {
          initialMembers.set(userId, access)
        }
      }
      for (const [userId, access] of initialMembers) {
        await query(
          `INSERT INTO engagement_memberships (engagement_id,user_id,access_level,granted_by)
           VALUES ($1,$2,$3,$4) ON CONFLICT (engagement_id,user_id) DO UPDATE SET access_level=EXCLUDED.access_level`,
          [engagement.id, userId, access, actor.id]
        )
      }
      if (attached.entityPeriodId) {
        const confirmationStatus = attached.hasUnlinkedTrialBalances || (attached.existingWork && !compatibilityConfirmed)
          ? 'needs_confirmation' : 'confirmed'
        await query(
          `INSERT INTO engagement_legacy_links
             (engagement_id,entity_period_id,confirmation_status,confirmation_note,linked_by,confirmed_by,confirmed_at)
           VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $3='confirmed' THEN now() ELSE NULL END)
           ON CONFLICT (engagement_id,entity_period_id) DO NOTHING`,
          [engagement.id, attached.entityPeriodId, confirmationStatus,
            attached.existingWork ? String(input.legacyConfirmationNote || '').trim() || null : null,
            actor.id, confirmationStatus === 'confirmed' ? actor.id : null]
        )
      }
      await logAudit(actor, 'engagement.created', engagement.id, {
        reference, status, duplicateCount, separateReason: separateReason || null,
        legacyWorkDetected: attached.existingWork, compatibilityConfirmed,
      })
      return engagement
    })
    return { id: Number(created.id), reference: created.reference }
  })

  ipcMain.handle('engagement:updateDraft', async (event, input = {}) => {
    const actor = await authenticated(event)
    const id = Number(input.engagementId)
    const engagement = await fetchEngagement(actor.firmId, id)
    await assertCanEdit(actor, engagement)
    if (engagement.status !== 'draft') throw new Error('Only a Draft engagement can be edited.')
    const errors = validateEngagementDraft({ ...input, entityId: engagement.entity_id })
    if (errors.length) throw new Error(errors.join(' '))
    if (!Array.isArray(input.participants)) throw new Error('Participants must be supplied as a list.')

    const ownerId = Number(input.ownerUserId || engagement.owner_user_id)
    const partnerId = input.partnerUserId ? Number(input.partnerUserId) : null
    const substituteId = input.substituteUserId ? Number(input.substituteUserId) : null
    if (ownerId !== engagement.owner_user_id && !['administrator', 'partner'].includes(actor.role)) {
      throw new Error('Only a partner or administrator can assign another engagement owner.')
    }
    const participants = validateUserList(input.participants, actor.id)
    await assertFirmUsers(actor.firmId, [...new Set([ownerId, partnerId, substituteId, ...participants].filter(Boolean))])
    if (partnerId) await assertFirmUsers(actor.firmId, [partnerId], 'partner')
    if (substituteId) await assertFirmUsers(actor.firmId, [substituteId], 'partner')
    if (substituteId && substituteId === partnerId) throw new Error('The substitute must be different from the assigned partner.')

    const packId = input.reportingPackId ? String(input.reportingPackId) : null
    const { rows: [catalog] } = packId
      ? await query(`SELECT * FROM reporting_pack_catalog WHERE pack_id=$1`, [packId])
      : { rows: [null] }
    if (packId && !catalog) throw new Error('Choose a reporting pack from the catalogue.')
    const periodStart = input.periodStart || null
    const periodEnd = input.periodEnd || null
    if (engagement.entity_period_id
      && (periodStart !== dateOnly(engagement.period_start)
        || periodEnd !== dateOnly(engagement.period_end))) {
      throw new Error('The reporting period is already linked to legacy work and cannot be changed.')
    }
    const separateReason = String(input.separateReason || '').trim()
    const displayScale = input.displayScale || 'units'
    if (!['units', 'thousands', 'millions'].includes(displayScale)) throw new Error('Choose a valid display scale.')
    const decimalPlaces = Number(input.decimalPlaces)
    if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6) {
      throw new Error('Decimal places must be from 0 to 6.')
    }

    const result = await runInTransaction(async () => {
      await query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [
        `${actor.firmId}:${engagement.entity_id}`,
        `${periodStart || 'draft'}:${periodEnd || 'draft'}`,
      ])
      let duplicateCount = 0
      if (periodStart && periodEnd) {
        const { rows: [dupes] } = await query(
          `SELECT COUNT(*)::int AS count FROM engagements
           WHERE firm_id=$1 AND entity_id=$2 AND period_start=$3::date AND period_end=$4::date AND id<>$5`,
          [actor.firmId, engagement.entity_id, periodStart, periodEnd, id]
        )
        duplicateCount = dupes.count
        if (duplicateCount && !separateReason) {
          throw new Error('A matching engagement may already exist. Review matches or record why this engagement is separate.')
        }
      }

      let entityPeriodId = engagement.entity_period_id
      let existingWork = false
      let hasUnlinkedTrialBalances = false
      if (!entityPeriodId && periodStart && periodEnd) {
        const attached = await attachEntityPeriod(engagement.entity_id, periodStart, periodEnd)
        entityPeriodId = attached.entityPeriodId
        existingWork = attached.existingWork
        hasUnlinkedTrialBalances = attached.hasUnlinkedTrialBalances
      }

      const reference = String(input.reference || '').trim() || engagement.reference
      const { rows: [updated] } = await query(
        `UPDATE engagements
         SET reference=$1,name=$2,period_start=$3::date,period_end=$4::date,owner_user_id=$5,
             partner_user_id=$6,substitute_user_id=$7,service_scope=$8,separate_reason=$9,updated_at=now()
         WHERE id=$10 AND firm_id=$11 AND status='draft' RETURNING id`,
        [reference, String(input.name).trim(), periodStart, periodEnd, ownerId, partnerId, substituteId,
          input.serviceScope, separateReason || null, id, actor.firmId]
      )
      if (!updated) throw new Error('This engagement has already changed status. Refresh and try again.')

      const { rows: [legacy] } = await query(
        `SELECT confirmation_status FROM engagement_legacy_links WHERE engagement_id=$1 LIMIT 1`,
        [id]
      )
      const { rows: [unlinked] } = await query(
        `SELECT EXISTS(SELECT 1 FROM trial_balances WHERE entity_id=$1 AND entity_period_id IS NULL) AS has_unlinked`,
        [engagement.entity_id]
      )
      hasUnlinkedTrialBalances ||= !!unlinked?.has_unlinked
      const compatibilityConfirmed = legacy?.confirmation_status === 'needs_confirmation' || hasUnlinkedTrialBalances
        ? false : !!input.compatibilityConfirmed
      if (legacy && hasUnlinkedTrialBalances) {
        await query(
          `UPDATE engagement_legacy_links SET confirmation_status='needs_confirmation',
             confirmed_by=NULL,confirmed_at=NULL WHERE engagement_id=$1`,
          [id]
        )
      }
      await query(
        `UPDATE engagement_reporting_sets
         SET jurisdiction=$1,accounting_framework=$2,reporting_pack_id=$3,reporting_pack_version=$4,
             trial_balance_currency=$5,presentation_currency=$6,display_scale=$7,decimal_places=$8,
             entity_period_id=$9,compatibility_confirmed=$10,updated_at=now()
         WHERE id=$11`,
        [catalog?.jurisdiction || input.jurisdiction || '', catalog?.framework || input.framework || '',
          packId, catalog?.pack_version || null, input.trialBalanceCurrency || null,
          input.presentationCurrency || null, displayScale, decimalPlaces, entityPeriodId,
          compatibilityConfirmed, engagement.reporting_set_id]
      )
      if (!engagement.entity_period_id && entityPeriodId) {
        const confirmationStatus = hasUnlinkedTrialBalances || (existingWork && !compatibilityConfirmed)
          ? 'needs_confirmation' : 'confirmed'
        await query(
          `INSERT INTO engagement_legacy_links
             (engagement_id,entity_period_id,confirmation_status,confirmation_note,linked_by,confirmed_by,confirmed_at)
           VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $3='confirmed' THEN now() ELSE NULL END)
           ON CONFLICT (engagement_id,entity_period_id) DO NOTHING`,
          [id, entityPeriodId, confirmationStatus,
            existingWork ? String(input.legacyConfirmationNote || '').trim() || null : null,
            actor.id, confirmationStatus === 'confirmed' ? actor.id : null]
        )
      }

      const desiredParticipants = new Map()
      for (const item of Array.isArray(input.participants) ? input.participants : []) {
        const userId = Number(item.userId)
        if (participants.includes(userId) && ![ownerId, partnerId, substituteId].includes(userId)) {
          desiredParticipants.set(userId, item.accessLevel === 'edit' ? 'edit' : 'read')
        }
      }
      const { rows: existingMembers } = await query(
        `SELECT user_id,access_level FROM engagement_memberships WHERE engagement_id=$1`,
        [id]
      )
      const actorMembership = existingMembers.find(member => Number(member.user_id) === actor.id)
      if (actorMembership && ![ownerId, partnerId, substituteId].includes(actor.id)) {
        desiredParticipants.set(actor.id, actorMembership.access_level)
      }
      for (const member of existingMembers) {
        const memberId = Number(member.user_id)
        if (![ownerId, partnerId, substituteId].includes(memberId) && !desiredParticipants.has(memberId)) {
          await query(`DELETE FROM engagement_memberships WHERE engagement_id=$1 AND user_id=$2`, [id, memberId])
          await logAudit(actor, 'access.revoked', id, { userId: memberId })
        }
      }
      const grants = new Map(desiredParticipants)
      grants.set(ownerId, 'edit')
      if (partnerId) grants.set(partnerId, 'read')
      if (substituteId) grants.set(substituteId, 'read')
      for (const [userId, accessLevel] of grants) {
        const previous = existingMembers.find(member => Number(member.user_id) === userId)?.access_level
        if (previous === accessLevel) continue
        await query(
          `INSERT INTO engagement_memberships (engagement_id,user_id,access_level,granted_by)
           VALUES ($1,$2,$3,$4) ON CONFLICT (engagement_id,user_id)
           DO UPDATE SET access_level=EXCLUDED.access_level,granted_by=EXCLUDED.granted_by,created_at=now()`,
          [id, userId, accessLevel, actor.id]
        )
        await logAudit(actor, 'access.granted', id, { userId, accessLevel })
      }
      await logAudit(actor, 'engagement.draft_updated', id, {
        duplicateCount, separateReason: separateReason || null, legacyWorkDetected: existingWork,
        unlinkedTrialBalancesDetected: hasUnlinkedTrialBalances,
      })
      return { id, reference }
    })
    return result
  })

  ipcMain.handle('engagement:overview', async (event, engagementId) => {
    const user = await authenticated(event)
    const engagement = await fetchEngagement(user.firmId, Number(engagementId))
    const membership = await assertCanView(user, engagement)
    const { rows: members } = await query(
      `SELECT m.user_id,m.access_level,m.created_at,u.email,u.display_name,u.role
       FROM engagement_memberships m JOIN firm_users u ON u.id=m.user_id
       WHERE m.engagement_id=$1 ORDER BY u.display_name`,
      [engagement.id]
    )
    const { rows: requests } = await query(
      `SELECT r.id,r.user_id,r.message,r.created_at,u.email,u.display_name
       FROM engagement_access_requests r JOIN firm_users u ON u.id=r.user_id
       WHERE r.engagement_id=$1 AND r.status='pending' ORDER BY r.created_at`,
      [engagement.id]
    )
    const canManageAccess = user.role === 'administrator' || engagement.owner_user_id === user.id
    const { rows: history } = await query(
      `SELECT a.action,a.details,a.created_at,u.display_name AS actor_name
       FROM engagement_audit_log a LEFT JOIN firm_users u ON u.id=a.actor_user_id
       WHERE a.engagement_id=$1 ORDER BY a.created_at DESC LIMIT 100`,
      [engagement.id]
    )
    const { rows: [legacy] } = await query(
      `SELECT l.confirmation_status,l.confirmation_note,l.linked_at,l.confirmed_at
       FROM engagement_legacy_links l WHERE l.engagement_id=$1`,
      [engagement.id]
    )
    const { rows: unlinkedTrialBalances } = await query(
      `SELECT id,filename,period,row_count,uploaded_at
       FROM trial_balances WHERE entity_id=$1 AND entity_period_id IS NULL
       ORDER BY uploaded_at DESC,id DESC`,
      [engagement.entity_id]
    )
    return {
      engagement: {
        ...engagement, id: Number(engagement.id), entity_id: Number(engagement.entity_id),
        accessLevel: engagement.owner_user_id === user.id ? 'owner' : membership?.access_level || (['administrator', 'partner'].includes(user.role) ? 'view-only' : 'read'),
        canEdit: canEditEngagement(user, engagement, membership),
        canManageAccess,
        canFinalise: canFinaliseEngagement(user, engagement),
      },
      members: members.map(row => ({ ...row, user_id: Number(row.user_id) })),
      requests: canManageAccess ? requests : [],
      history,
      legacyLink: legacy || null,
      unlinkedTrialBalances: canManageAccess ? unlinkedTrialBalances : [],
    }
  })

  ipcMain.handle('engagement:trialBalances', async (event, engagementId) => {
    const user = await authenticated(event)
    const { engagement, period } = await assertEngagementTBContext(user, engagementId)
    const { rows } = await query(
      `SELECT tb.id,tb.period,tb.filename,tb.row_count,tb.uploaded_at,tb.branch_name,
              i.source_filename,i.source_sha256,i.source_size_bytes,i.imported_at,i.imported_by,
              uploader.display_name AS imported_by_name,'service_import' AS source_type
       FROM engagement_trial_balance_imports i
       JOIN trial_balances tb ON tb.id=i.trial_balance_id
       JOIN firm_users uploader ON uploader.id=i.imported_by
       WHERE i.engagement_id=$1 AND tb.entity_id=$2 AND tb.entity_period_id=$3
       UNION ALL
       SELECT tb.id,tb.period,tb.filename,tb.row_count,tb.uploaded_at,tb.branch_name,
              tb.filename AS source_filename,NULL::text AS source_sha256,NULL::bigint AS source_size_bytes,
              l.linked_at AS imported_at,l.linked_by AS imported_by,linker.display_name AS imported_by_name,
              'legacy_link' AS source_type
       FROM engagement_legacy_tb_links l
       JOIN trial_balances tb ON tb.id=l.trial_balance_id
       JOIN firm_users linker ON linker.id=l.linked_by
       WHERE l.engagement_id=$1 AND l.entity_period_id=$3
         AND tb.entity_id=$2 AND tb.entity_period_id=$3
       ORDER BY uploaded_at DESC,id DESC`,
      [engagement.id, engagement.entity_id, period.id]
    )
    return rows.map(row => ({ ...row, id: Number(row.id), row_count: Number(row.row_count) }))
  })

  ipcMain.handle('engagement:trialBalanceRows', async (event, input = {}) => {
    const user = await authenticated(event)
    const engagementId = Number(input.engagementId)
    const tbId = Number(input.trialBalanceId)
    const offset = Number(input.offset ?? 0)
    const limit = Number(input.limit ?? 500)
    if (!Number.isInteger(tbId) || tbId <= 0 || !Number.isInteger(offset) || offset < 0
      || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('Select a valid trial balance and row range.')
    }
    const { engagement, period } = await assertEngagementTBContext(user, engagementId)
    const { rows: [authorizedTB] } = await query(
      `SELECT tb.id FROM trial_balances tb
       WHERE tb.id=$1 AND tb.entity_id=$2 AND tb.entity_period_id=$3
         AND (
           EXISTS (SELECT 1 FROM engagement_trial_balance_imports i
                   WHERE i.engagement_id=$4 AND i.trial_balance_id=tb.id)
           OR EXISTS (SELECT 1 FROM engagement_legacy_tb_links l
                      WHERE l.engagement_id=$4 AND l.trial_balance_id=tb.id AND l.entity_period_id=$3)
         )`,
      [tbId, engagement.entity_id, period.id, engagement.id]
    )
    if (!authorizedTB) throw new Error('Trial balance not found in this engagement.')
    const { rows } = await query(
      `SELECT id,period,branch,ledger_code,name,opening_balance,debit,credit,closing_balance,
              is_revenue,is_deemed_positive,trail_balance,parent,group_parent,group_parent_1,
              group_parent_2,group_parent_3,group_parent_4,group_parent_5,group_parent_6,
              group_parent_7,group_parent_8,trial_balance_type,upload_nature
       FROM tb_rows WHERE tb_id=$1 ORDER BY id OFFSET $2 LIMIT $3`,
      [tbId, offset, limit]
    )
    return { rows, offset, limit, totalRows: Number((await query(
      `SELECT COUNT(*)::integer AS count FROM tb_rows WHERE tb_id=$1`, [tbId]
    )).rows[0].count) }
  })

  ipcMain.handle('engagement:importTrialBalance', async (event, input = {}) => {
    const user = await authenticated(event)
    const { engagement, period } = await assertEngagementTBContext(user, input.engagementId)
    const comparative = input.comparative === true
    if (engagement.status === 'finalised' || engagement.status === 'archived' || period.locked || period.is_final) {
      throw new Error('This engagement reporting period is locked or finalised and cannot accept a Trial Balance import.')
    }
    await assertCanEdit(user, engagement)
    const fileName = String(input.fileName || '').replace(/[\u0000-\u001f\\/]/g, '').trim().slice(0, 255)
    const encoded = input.fileContentBase64
    if (!/\.(?:xlsx|xls|xlsm)$/i.test(fileName) || typeof encoded !== 'string' || encoded.length > 11_184_812
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new Error('Select a valid Excel file no larger than 8 MB.')
    }
    const buffer = Buffer.from(encoded, 'base64')
    if (buffer.toString('base64') !== encoded) throw new Error('The uploaded Excel file data is invalid.')
    const rows = validateTBUpload(buffer)
    const sourceHash = createHash('sha256').update(buffer).digest('hex')

    try {
      return await runInTransaction(async () => {
        const { rows: [lockedContext] } = await query(
          `SELECT e.status,ep.locked,ep.is_final,fp.date_from,fp.date_till
           FROM engagements e
           JOIN engagement_reporting_sets rs ON rs.engagement_id=e.id
           JOIN entity_periods ep ON ep.id=rs.entity_period_id
           JOIN financial_periods fp ON fp.id=ep.financial_period_id
           WHERE e.id=$1 AND e.firm_id=$2 AND rs.id=$3
           FOR UPDATE OF e,ep`,
          [engagement.id, user.firmId, engagement.reporting_set_id]
        )
        if (!lockedContext) throw new Error('Engagement reporting context is unavailable.')
        if (lockedContext.status === 'finalised' || lockedContext.status === 'archived'
          || lockedContext.locked || lockedContext.is_final) {
          throw new Error('This engagement reporting period is locked or finalised and cannot accept a Trial Balance import.')
        }
        const currentEngagement = await fetchEngagement(user.firmId, engagement.id)
        await assertCanEdit(user, currentEngagement)

        let importPeriodId = period.id
        let importPeriodLabel = period.year_label || ''
        let importDateFrom = dateOnly(period.date_from)
        let importDateTill = dateOnly(period.date_till)
        if (comparative) {
          const { rows: [prior] } = await query(
            `SELECT (date_from - interval '1 year')::date AS date_from,
                    (date_till - interval '1 year')::date AS date_till
             FROM financial_periods WHERE id=$1`,
            [period.financial_period_id]
          )
          if (!prior) throw new Error('The prior-year reporting period could not be resolved.')
          const from = dateOnly(prior.date_from)
          const till = dateOnly(prior.date_till)
          importDateFrom = from
          importDateTill = till
          importPeriodLabel = financialPeriodLabel(till)
          if (!importPeriodLabel) throw new Error('The prior-year reporting period end date is invalid.')
          const { rows: [financialPeriod] } = await query(
            `INSERT INTO financial_periods (year_label,date_from,date_till)
             VALUES ($1,$2,$3)
             ON CONFLICT (date_from,date_till) DO UPDATE SET year_label=EXCLUDED.year_label
             RETURNING id,year_label`,
            [importPeriodLabel, from, till]
          )
          const { rows: [entityPeriod] } = await query(
            `INSERT INTO entity_periods (entity_id,financial_period_id)
             VALUES ($1,$2)
             ON CONFLICT (entity_id,financial_period_id) DO UPDATE SET entity_id=EXCLUDED.entity_id
             RETURNING id,locked,is_final`,
            [engagement.entity_id, financialPeriod.id]
          )
          if (entityPeriod.locked || entityPeriod.is_final) {
            throw new Error('The prior-year reporting period is locked or finalised and cannot accept a Trial Balance import.')
          }
          importPeriodId = entityPeriod.id
        }

        const { rows: [tb] } = await query(
          `INSERT INTO trial_balances
             (entity_id,period,filename,row_count,branch_name,entity_period_id)
           VALUES ($1,$2,$3,$4,'',$5) RETURNING id,period,filename,row_count,uploaded_at,branch_name`,
          [engagement.entity_id, `${importDateFrom} To ${importDateTill}`, fileName, rows.length, importPeriodId]
        )
        const columns = [
          'tb_id','period','branch','ledger_code','name','opening_balance','debit','credit','closing_balance',
          'is_revenue','is_deemed_positive','trail_balance','parent','group_parent','group_parent_1',
          'group_parent_2','group_parent_3','group_parent_4','group_parent_5','group_parent_6','group_parent_7',
          'group_parent_8','trial_balance_type',
        ]
        const chunkSize = 400
        for (let start = 0; start < rows.length; start += chunkSize) {
          const chunk = rows.slice(start, start + chunkSize)
          const values = []
          const parameters = []
          chunk.forEach((row, index) => {
            const base = index * columns.length
            values.push(`(${columns.map((_, column) => `$${base + column + 1}`).join(',')})`)
            parameters.push(
              tb.id,row.period ?? null,row.branch ?? null,row.ledger_code ?? null,row.name,
              row.opening_balance,row.debit,row.credit,row.closing_balance,row.is_revenue,
              row.is_deemed_positive,row.trail_balance,row.parent ?? null,row.group_parent ?? null,
              row.group_parent_1 ?? null,row.group_parent_2 ?? null,row.group_parent_3 ?? null,
              row.group_parent_4 ?? null,row.group_parent_5 ?? null,row.group_parent_6 ?? null,
              row.group_parent_7 ?? null,row.group_parent_8 ?? null,row.trial_balance_type ?? null
            )
          })
          await query(`INSERT INTO tb_rows (${columns.join(',')}) VALUES ${values.join(',')}`, parameters)
        }
        await query(
          `INSERT INTO engagement_trial_balance_imports
             (engagement_id,trial_balance_id,source_filename,source_sha256,source_size_bytes,imported_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [engagement.id, tb.id, fileName, sourceHash, buffer.length, user.id]
        )
        if (comparative) {
          await query(
            `UPDATE engagement_reporting_sets SET prior_trial_balance_id=$1,updated_at=now()
             WHERE id=$2 AND engagement_id=$3`,
            [tb.id, engagement.reporting_set_id, engagement.id]
          )
        }
        await logAudit(user, 'trial_balance.imported', engagement.id, {
          trialBalanceId: Number(tb.id), fileName, sourceSha256: sourceHash,
          sourceSizeBytes: buffer.length, rowCount: rows.length, comparative,
        })
        return {
          trialBalance: { ...tb, id: Number(tb.id), row_count: Number(tb.row_count) },
          source: { fileName, sha256: sourceHash, sizeBytes: buffer.length },
          rowCount: rows.length,
        }
      })
    } catch (error) {
      if (error.code === '23505') {
        throw new Error('This exact Excel file has already been imported into this engagement. Existing imports were not changed.')
      }
      throw error
    }
  })

  ipcMain.handle('engagement:comparativeTrialBalanceSelect', async (event, input = {}) => {
    const user = await authenticated(event)
    const context = await assertEngagementTBContext(user, input.engagementId)
    await assertCanEdit(user, context.engagement)
    assertEngagementEditable(context.engagement, context.period)
    const tbId = input.trialBalanceId == null || input.trialBalanceId === '' ? null : Number(input.trialBalanceId)
    if (tbId != null && (!Number.isSafeInteger(tbId) || tbId <= 0)) {
      throw new Error('Choose a valid prior-year Trial Balance.')
    }
    return runInTransaction(async () => {
      if (tbId != null) {
        const { rows: [prior] } = await query(
          `SELECT tb.id
           FROM trial_balances tb
           JOIN entity_periods priorEp ON priorEp.id=tb.entity_period_id AND priorEp.entity_id=tb.entity_id
           JOIN financial_periods priorFp ON priorFp.id=priorEp.financial_period_id
           JOIN engagement_trial_balance_imports i
             ON i.engagement_id=$1 AND i.trial_balance_id=tb.id
           JOIN engagement_reporting_sets rs ON rs.id=$2 AND rs.engagement_id=i.engagement_id
           JOIN entity_periods currentEp ON currentEp.id=rs.entity_period_id
           JOIN financial_periods currentFp ON currentFp.id=currentEp.financial_period_id
           WHERE tb.id=$3 AND tb.entity_id=$4
             AND priorFp.date_from=(currentFp.date_from - interval '1 year')::date
             AND priorFp.date_till=(currentFp.date_till - interval '1 year')::date`,
          [context.engagement.id, context.engagement.reporting_set_id, tbId, context.engagement.entity_id]
        )
        if (!prior) throw new Error('Select a Trial Balance imported to this engagement for the immediately preceding reporting period.')
      }
      await query(
        `UPDATE engagement_reporting_sets SET prior_trial_balance_id=$1,updated_at=now()
         WHERE id=$2 AND engagement_id=$3`,
        [tbId, context.engagement.reporting_set_id, context.engagement.id]
      )
      if (tbId != null) {
        const { rows: [latestSnapshot] } = await query(
          `SELECT mapping_rule_set_id FROM engagement_final_tb_snapshots
           WHERE engagement_id=$1 ORDER BY version DESC LIMIT 1`,
          [context.engagement.id]
        )
        if (latestSnapshot) {
          const { rows: [existing] } = await query(`SELECT COUNT(*)::integer AS count FROM mapped_tb WHERE tb_id=$1`, [tbId])
          if (Number(existing.count) === 0) {
            let queryQueue = Promise.resolve()
            const mappingDatabase = {
              query(sql, params) {
                const result = queryQueue.then(() => query(sql, params))
                queryQueue = result.then(() => undefined, () => undefined)
                return result
              },
              runInTransaction,
            }
            const priorMapped = await runMappingEngine(
              tbId, Number(latestSnapshot.mapping_rule_set_id), Number(context.engagement.constitution),
              { businessType: context.engagement.business_type, database: mappingDatabase }
            )
            await persistMappingResults(priorMapped, mappingDatabase)
          }
        }
      }
      await logAudit(user, 'report.comparative_trial_balance_selected', context.engagement.id, { trialBalanceId: tbId })
      return { ok: true, trialBalanceId: tbId }
    })
  })

  ipcMain.handle('engagement:journalList', async (event, engagementId) => {
    const user = await authenticated(event)
    const { engagement } = await assertEngagementTBContext(user, engagementId)
    const { rows } = await query(
      `SELECT j.id,j.source_trial_balance_id,j.entry_number,j.journal_date,j.narration,
              j.created_by,j.posted_at,u.display_name AS posted_by,
              COALESCE(json_agg(json_build_object(
                'id',l.id,'lineNumber',l.line_number,'ledgerName',l.ledger_name,
                'ledgerCode',l.ledger_code,'side',l.entry_side,'amount',l.amount
              ) ORDER BY l.line_number) FILTER (WHERE l.id IS NOT NULL),'[]'::json) AS lines
       FROM engagement_journals j
       JOIN firm_users u ON u.id=j.created_by
       LEFT JOIN engagement_journal_lines l ON l.journal_id=j.id
       WHERE j.engagement_id=$1
       GROUP BY j.id,u.display_name
       ORDER BY j.entry_number DESC`,
      [engagement.id]
    )
    return rows
  })

  ipcMain.handle('engagement:journalPost', async (event, input = {}) => {
    const user = await authenticated(event)
    const engagementId = Number(input.engagementId)
    const context = await assertAuthorizedEngagementTB(user, engagementId, input.sourceTrialBalanceId)
    await assertCanEdit(user, context.engagement)
    assertEngagementEditable(context.engagement, context.period)
    const journalDate = String(input.date || '')
    if (!isValidDateOnly(journalDate) || journalDate < dateOnly(context.engagement.period_start) || journalDate > dateOnly(context.engagement.period_end)) {
      throw new Error('Journal date must fall within the engagement reporting period.')
    }
    const narration = String(input.narration || '').trim()
    if (!narration || narration.length > 2000) throw new Error('Enter a journal narration of no more than 2,000 characters.')
    if (!Array.isArray(input.entries) || input.entries.length < 2 || input.entries.length > 500) {
      throw new Error('A journal must contain between 2 and 500 lines.')
    }
    const entries = input.entries.map((entry, index) => {
      const ledgerName = String(entry.ledgerName || '').trim()
      const ledgerCode = String(entry.ledgerCode || '').trim()
      if (!ledgerName || ledgerName.length > 255 || ledgerCode.length > 100) throw new Error(`Journal line ${index + 1} needs a valid ledger name and code.`)
      if (!['Dr', 'Cr'].includes(entry.side)) throw new Error(`Journal line ${index + 1} must be Dr or Cr.`)
      return { ledgerName, ledgerCode: ledgerCode || null, side: entry.side, cents: amountToCents(entry.amount) }
    })
    const debit = entries.filter(entry => entry.side === 'Dr').reduce((total, entry) => total + entry.cents, 0)
    const credit = entries.filter(entry => entry.side === 'Cr').reduce((total, entry) => total + entry.cents, 0)
    if (debit !== credit) throw new Error('Journal entry must balance exactly before it can be posted.')

    return runInTransaction(async () => {
      const { rows: [locked] } = await query(
        `SELECT e.id,e.status,ep.locked,ep.is_final
         FROM engagements e
         JOIN engagement_reporting_sets rs ON rs.engagement_id=e.id
         JOIN entity_periods ep ON ep.id=rs.entity_period_id
         WHERE e.id=$1 AND e.firm_id=$2 AND rs.id=$3
         FOR UPDATE OF e,ep`,
        [context.engagement.id, user.firmId, context.engagement.reporting_set_id]
      )
      if (!locked) throw new Error('Engagement reporting context is unavailable.')
      assertEngagementEditable({ ...context.engagement, status: locked.status }, { locked: locked.locked, is_final: locked.is_final })
      const currentEngagement = await fetchEngagement(user.firmId, context.engagement.id)
      await assertCanEdit(user, currentEngagement)
      const { rows: [sequence] } = await query(
        `SELECT COALESCE(MAX(entry_number),0)::integer+1 AS next_number
         FROM engagement_journals WHERE engagement_id=$1`,
        [context.engagement.id]
      )
      const { rows: [journal] } = await query(
        `INSERT INTO engagement_journals
           (engagement_id,source_trial_balance_id,entry_number,journal_date,narration,created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,entry_number,journal_date,narration,posted_at`,
        [context.engagement.id, context.trialBalance.id, sequence.next_number, journalDate, narration, user.id]
      )
      const lineValues = []
      const lineParams = []
      entries.forEach((entry, index) => {
        const base = index * 6
        lineValues.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`)
        lineParams.push(journal.id, index + 1, entry.ledgerName, entry.ledgerCode, entry.side, (entry.cents / 100).toFixed(2))
      })
      await query(
        `INSERT INTO engagement_journal_lines (journal_id,line_number,ledger_name,ledger_code,entry_side,amount)
         VALUES ${lineValues.join(',')}`,
        lineParams
      )
      await logAudit(user, 'journal.posted', context.engagement.id, {
        journalId: Number(journal.id), entryNumber: journal.entry_number,
        sourceTrialBalanceId: context.trialBalance.id, lineCount: entries.length,
      })
      return { ...journal, id: Number(journal.id), entryNumber: journal.entry_number }
    })
  })

  ipcMain.handle('engagement:finalTrialBalanceCreate', async (event, input = {}) => {
    const user = await authenticated(event)
    const context = await assertAuthorizedEngagementTB(user, input.engagementId, input.sourceTrialBalanceId)
    await assertCanEdit(user, context.engagement)
    assertEngagementEditable(context.engagement, context.period)
    await assertIndiaScheduleIII(context.engagement)
    return runInTransaction(async () => {
      const { rows: [locked] } = await query(
        `SELECT e.status,ep.locked,ep.is_final
         FROM engagements e
         JOIN engagement_reporting_sets rs ON rs.engagement_id=e.id
         JOIN entity_periods ep ON ep.id=rs.entity_period_id
         WHERE e.id=$1 AND e.firm_id=$2 AND rs.id=$3
         FOR UPDATE OF e,ep`,
        [context.engagement.id, user.firmId, context.engagement.reporting_set_id]
      )
      if (!locked) throw new Error('Engagement reporting context is unavailable.')
      assertEngagementEditable({ ...context.engagement, status: locked.status }, { locked: locked.locked, is_final: locked.is_final })
      const currentEngagement = await fetchEngagement(user.firmId, context.engagement.id)
      await assertCanEdit(user, currentEngagement)
      await assertIndiaScheduleIII(currentEngagement)
      const { rows: [sourceLink] } = await query(
        `SELECT 1 FROM engagement_trial_balance_imports WHERE engagement_id=$1 AND trial_balance_id=$2
         UNION ALL
         SELECT 1 FROM engagement_legacy_tb_links WHERE engagement_id=$1 AND trial_balance_id=$2
         LIMIT 1`,
        [context.engagement.id, context.trialBalance.id]
      )
      if (!sourceLink) throw new Error('A final Trial Balance must be based on an imported or explicitly linked source Trial Balance.')
      const { rows: sourceRows } = await query(
        `SELECT period,branch,ledger_code,name,opening_balance,debit,credit,closing_balance,
                is_revenue,is_deemed_positive,trail_balance,parent,group_parent,group_parent_1,
                group_parent_2,group_parent_3,group_parent_4,group_parent_5,group_parent_6,
                group_parent_7,group_parent_8,trial_balance_type
         FROM tb_rows WHERE tb_id=$1 ORDER BY id`,
        [context.trialBalance.id]
      )
      if (!sourceRows.length) throw new Error('The selected source Trial Balance has no ledger rows.')
      const { rows: [versionRow] } = await query(
        `SELECT COALESCE(MAX(version),0)::integer+1 AS next_version
         FROM engagement_final_tb_snapshots WHERE engagement_id=$1`,
        [context.engagement.id]
      )
      const { rows: [watermark] } = await query(
        `SELECT COALESCE(MAX(id),0)::bigint AS journal_id
         FROM engagement_journals WHERE engagement_id=$1 AND source_trial_balance_id=$2`,
        [context.engagement.id, context.trialBalance.id]
      )
      const { rows: [ruleSet] } = await query(
        `SELECT mrs.id
         FROM mapping_rule_sets mrs
         JOIN entities e ON e.id=$1
         WHERE (mrs.entity_id=e.id OR mrs.is_default=TRUE)
         ORDER BY (mrs.entity_id=e.id) DESC,mrs.is_default DESC,mrs.id
         LIMIT 1`,
        [context.engagement.entity_id]
      )
      if (!ruleSet) throw new Error('No India mapping rule set is available for this client. Configure the existing India mapping rules before processing.')

      const { rows: journalRows } = await query(
        `SELECT l.ledger_name,l.ledger_code,l.entry_side,l.amount
         FROM engagement_journals j
         JOIN engagement_journal_lines l ON l.journal_id=j.id
         WHERE j.engagement_id=$1 AND j.source_trial_balance_id=$2 AND j.id<=$3
         ORDER BY j.id,l.line_number`,
        [context.engagement.id, context.trialBalance.id, watermark.journal_id]
      )
      const sourceByName = new Map()
      const sourceByCode = new Map()
      sourceRows.forEach((row, index) => {
        const nameKey = String(row.name || '').trim().toLocaleLowerCase()
        if (!sourceByName.has(nameKey)) sourceByName.set(nameKey, [])
        sourceByName.get(nameKey).push(index)
        const codeKey = String(row.ledger_code || '').trim().toLocaleLowerCase()
        if (codeKey) {
          if (!sourceByCode.has(codeKey)) sourceByCode.set(codeKey, [])
          sourceByCode.get(codeKey).push(index)
        }
      })
      const adjustments = new Map()
      for (const line of journalRows) {
        const nameKey = String(line.ledger_name || '').trim().toLocaleLowerCase()
        const codeKey = String(line.ledger_code || '').trim().toLocaleLowerCase()
        const matches = codeKey ? sourceByCode.get(codeKey) || [] : sourceByName.get(nameKey) || []
        if (matches.length > 1) throw new Error(`Ledger "${line.ledger_name}" is ambiguous in the source Trial Balance; use its ledger code on the journal line.`)
        const key = matches.length ? `row:${matches[0]}` : `new:${codeKey || nameKey}`
        const current = adjustments.get(key) || {
          sourceIndex: matches.length ? matches[0] : null,
          ledgerName: line.ledger_name,
          ledgerCode: line.ledger_code,
          debit: 0,
          credit: 0,
        }
        const amount = Number(line.amount)
        if (line.entry_side === 'Dr') current.debit += amount
        else current.credit += amount
        adjustments.set(key, current)
      }
      const resultRows = sourceRows.map(row => ({ ...row }))
      for (const adjustment of adjustments.values()) {
        let row
        if (adjustment.sourceIndex == null) {
          row = {
            period: `${dateOnly(context.period.date_from)} To ${dateOnly(context.period.date_till)}`,
            branch: '',
            ledger_code: adjustment.ledgerCode,
            name: adjustment.ledgerName,
            opening_balance: 0,
            debit: 0,
            credit: 0,
            closing_balance: 0,
            is_revenue: false,
            is_deemed_positive: true,
            trail_balance: 0,
            parent: null,
            group_parent: null,
            group_parent_1: null,
            group_parent_2: null,
            group_parent_3: null,
            group_parent_4: null,
            group_parent_5: null,
            group_parent_6: null,
            group_parent_7: null,
            group_parent_8: null,
            trial_balance_type: null,
          }
          resultRows.push(row)
        } else {
          row = resultRows[adjustment.sourceIndex]
        }
        row.debit = Number(row.debit || 0) + adjustment.debit
        row.credit = Number(row.credit || 0) + adjustment.credit
        row.closing_balance = Number(row.closing_balance || 0) - adjustment.debit + adjustment.credit
        row.trail_balance = row.closing_balance
        if (adjustment.sourceIndex == null) row.is_deemed_positive = row.closing_balance < 0
      }
      const balanceDifference = resultRows.reduce((sum, row) => sum + Number(row.closing_balance || 0), 0)
      const { rows: [tb] } = await query(
        `INSERT INTO trial_balances (entity_id,period,filename,row_count,branch_name,entity_period_id)
         VALUES ($1,$2,$3,$4,'',$5) RETURNING id,period,filename,row_count,uploaded_at,branch_name,entity_id,entity_period_id`,
        [
          context.engagement.entity_id,
          `${dateOnly(context.period.date_from)} To ${dateOnly(context.period.date_till)}`,
          `Final TB v${versionRow.next_version}`,
          resultRows.length,
          context.period.id,
        ]
      )
      const columns = [
        'tb_id','period','branch','ledger_code','name','opening_balance','debit','credit','closing_balance',
        'is_revenue','is_deemed_positive','trail_balance','parent','group_parent','group_parent_1',
        'group_parent_2','group_parent_3','group_parent_4','group_parent_5','group_parent_6','group_parent_7',
        'group_parent_8','trial_balance_type','upload_nature',
      ]
      const chunkSize = 300
      for (let start = 0; start < resultRows.length; start += chunkSize) {
        const chunk = resultRows.slice(start, start + chunkSize)
        const values = []
        const params = []
        chunk.forEach((row, index) => {
          const base = index * columns.length
          values.push(`(${columns.map((_, column) => `$${base + column + 1}`).join(',')})`)
          params.push(
            tb.id,row.period ?? null,row.branch ?? null,row.ledger_code ?? null,row.name,
            row.opening_balance,row.debit,row.credit,row.closing_balance,row.is_revenue,
            row.is_deemed_positive,row.trail_balance,row.parent ?? null,row.group_parent ?? null,
            row.group_parent_1 ?? null,row.group_parent_2 ?? null,row.group_parent_3 ?? null,
            row.group_parent_4 ?? null,row.group_parent_5 ?? null,row.group_parent_6 ?? null,
            row.group_parent_7 ?? null,row.group_parent_8 ?? null,row.trial_balance_type ?? null,
            'Engagement Final TB'
          )
        })
        await query(`INSERT INTO tb_rows (${columns.join(',')}) VALUES ${values.join(',')}`, params)
      }
      await query(
        `INSERT INTO engagement_final_tb_snapshots
           (engagement_id,source_trial_balance_id,trial_balance_id,version,journal_watermark,mapping_rule_set_id,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [context.engagement.id, context.trialBalance.id, tb.id, versionRow.next_version, watermark.journal_id, ruleSet.id, user.id]
      )
      let queryQueue = Promise.resolve()
      const mappingDatabase = {
        query(sql, params) {
          const result = queryQueue.then(() => query(sql, params))
          queryQueue = result.then(() => undefined, () => undefined)
          return result
        },
        runInTransaction,
      }
      const mapped = await runMappingEngine(
        Number(tb.id),
        Number(ruleSet.id),
        Number(context.engagement.constitution),
        { businessType: context.engagement.business_type, database: mappingDatabase }
      )
      await persistMappingResults(mapped, mappingDatabase)
      const { rows: [priorTb] } = await query(
        `SELECT tb.id,tb.entity_id,tb.entity_period_id,priorFp.date_from,priorFp.date_till,
                currentFp.date_from AS current_date_from,currentFp.date_till AS current_date_till
         FROM engagement_reporting_sets rs
         JOIN trial_balances tb ON tb.id=rs.prior_trial_balance_id
         JOIN entity_periods priorEp ON priorEp.id=tb.entity_period_id AND priorEp.entity_id=tb.entity_id
         JOIN financial_periods priorFp ON priorFp.id=priorEp.financial_period_id
         JOIN entity_periods currentEp ON currentEp.id=rs.entity_period_id
         JOIN financial_periods currentFp ON currentFp.id=currentEp.financial_period_id
         JOIN engagement_trial_balance_imports i
           ON i.engagement_id=rs.engagement_id AND i.trial_balance_id=tb.id
         WHERE rs.engagement_id=$1 AND tb.entity_id=$2
           AND priorFp.date_from=(currentFp.date_from - interval '1 year')::date
           AND priorFp.date_till=(currentFp.date_till - interval '1 year')::date`,
        [context.engagement.id, context.engagement.entity_id]
      )
      if (priorTb) {
        const { rows: [existingPriorMappings] } = await query(
          `SELECT COUNT(*)::integer AS count FROM mapped_tb WHERE tb_id=$1`,
          [priorTb.id]
        )
        if (Number(existingPriorMappings.count) === 0) {
          const priorMapped = await runMappingEngine(
            Number(priorTb.id),
            Number(ruleSet.id),
            Number(context.engagement.constitution),
            { businessType: context.engagement.business_type, database: mappingDatabase }
          )
          await persistMappingResults(priorMapped, mappingDatabase)
        }
      }
      await logAudit(user, 'trial_balance.final_snapshot_created', context.engagement.id, {
        sourceTrialBalanceId: context.trialBalance.id,
        trialBalanceId: Number(tb.id),
        version: versionRow.next_version,
        journalWatermark: Number(watermark.journal_id),
        rowCount: resultRows.length,
        balanceDifference: Number(balanceDifference.toFixed(2)),
        mappingRuleSetId: Number(ruleSet.id),
      })
      return {
        trialBalance: { ...tb, id: Number(tb.id), row_count: Number(tb.row_count) },
        version: versionRow.next_version,
        journalWatermark: Number(watermark.journal_id),
        balanceDifference: Number(balanceDifference.toFixed(2)),
        mappedRows: mapped.length,
      }
    })
  })

  ipcMain.handle('engagement:finalTrialBalances', async (event, engagementId) => {
    const user = await authenticated(event)
    const { engagement } = await assertEngagementTBContext(user, engagementId)
    const { rows } = await query(
      `SELECT s.id AS snapshot_id,s.version,s.source_trial_balance_id,s.trial_balance_id,
              s.journal_watermark,s.mapping_rule_set_id,s.created_at,
              tb.period,tb.filename,tb.row_count,tb.uploaded_at,
              COUNT(mt.id)::integer AS mapped_count,
              COUNT(mt.id) FILTER (WHERE mt.status='unmapped')::integer AS unmapped_count
       FROM engagement_final_tb_snapshots s
       JOIN trial_balances tb ON tb.id=s.trial_balance_id
       LEFT JOIN mapped_tb mt ON mt.tb_id=tb.id
       WHERE s.engagement_id=$1
       GROUP BY s.id,tb.id
       ORDER BY s.version DESC`,
      [engagement.id]
    )
    return rows.map(row => ({
      ...row,
      id: Number(row.trial_balance_id),
      snapshotId: Number(row.snapshot_id),
      version: Number(row.version),
      row_count: Number(row.row_count),
      mapped_count: Number(row.mapped_count),
      unmapped_count: Number(row.unmapped_count),
    }))
  })

  ipcMain.handle('engagement:mappingOverride', async (event, input = {}) => {
    const user = await authenticated(event)
    const context = await assertAuthorizedEngagementTB(user, input.engagementId, input.trialBalanceId)
    await assertCanEdit(user, context.engagement)
    assertEngagementEditable(context.engagement, context.period)
    const rowId = Number(input.trialBalanceRowId)
    const levelFormatId = Number(input.levelFormatId)
    if (!Number.isSafeInteger(rowId) || rowId <= 0 || !Number.isSafeInteger(levelFormatId) || levelFormatId <= 0) {
      throw new Error('Choose a valid final Trial Balance row and mapping.')
    }
    return runInTransaction(async () => {
      const { rows: [snapshot] } = await query(
        `SELECT mapping_rule_set_id FROM engagement_final_tb_snapshots
         WHERE engagement_id=$1 AND trial_balance_id=$2`,
        [context.engagement.id, context.trialBalance.id]
      )
      if (!snapshot) throw new Error('Manual corrections are available only for a final engagement Trial Balance.')
      const { rows: [mapping] } = await query(
        `SELECT id,rule_set_id,constitution,alie,level1,level2,level3,level4,level5,level6,level7
         FROM level_format
         WHERE id=$1 AND rule_set_id=$2 AND constitution=$3 AND alie IS NOT NULL`,
        [levelFormatId, snapshot.mapping_rule_set_id, context.engagement.constitution]
      )
      if (!mapping) throw new Error('The selected mapping is not part of this engagement reporting rule set.')
      const { rows: [mapped] } = await query(
        `UPDATE mapped_tb
         SET alie=$1,mapping1_resultant=$2,mapping2_resultant=$3,mapping3_resultant=$4,
             level_format_id=$5,level4_value=$6,level5_value=$7,level6_value=$8,level7_value=$9,
             status='user_override',confidence='user',override_note='Manual correction from protected reporting workflow',
             mapped_at=now()
         WHERE tb_id=$10 AND tb_row_id=$11 AND rule_set_id=$12
         RETURNING id`,
        [mapping.alie,mapping.level1,mapping.level2,mapping.level3,mapping.id,
          mapping.level4,mapping.level5,mapping.level6,mapping.level7,
          context.trialBalance.id,rowId,snapshot.mapping_rule_set_id]
      )
      if (!mapped) throw new Error('The selected ledger row is not mapped in this final Trial Balance.')
      await logAudit(user, 'report.mapping_corrected', context.engagement.id, {
        trialBalanceId: context.trialBalance.id, trialBalanceRowId: rowId, levelFormatId: mapping.id,
      })
      return { ok: true }
    })
  })

  ipcMain.handle('engagement:finalTrialBalanceRows', async (event, input = {}) => {
    const user = await authenticated(event)
    const context = await assertAuthorizedEngagementTB(user, input.engagementId, input.trialBalanceId)
    const { rows } = await query(
      `SELECT tr.id,tr.period,tr.ledger_code,tr.name,tr.opening_balance,tr.debit,tr.credit,
              tr.closing_balance,tr.is_deemed_positive,tr.upload_nature,mt.level_format_id,
              mt.mapping1_resultant,mt.mapping2_resultant,mt.mapping3_resultant,mt.alie,
              mt.status,mt.confidence,mt.override_note
       FROM tb_rows tr
       LEFT JOIN mapped_tb mt ON mt.tb_row_id=tr.id AND mt.tb_id=tr.tb_id
       WHERE tr.tb_id=$1
       ORDER BY tr.id`,
      [context.trialBalance.id]
    )
    return rows
  })

  ipcMain.handle('engagement:reportingData', async (event, input = {}) => {
    const user = await authenticated(event)
    const context = await assertAuthorizedEngagementTB(user, input.engagementId, input.trialBalanceId)
    const { engagement, trialBalance } = context
    await assertIndiaScheduleIII(engagement)
    const { rows: [snapshot] } = await query(
      `SELECT s.id,s.version,s.source_trial_balance_id,s.trial_balance_id,s.journal_watermark,
              s.mapping_rule_set_id,s.created_at
       FROM engagement_final_tb_snapshots s
       WHERE s.engagement_id=$1 AND s.trial_balance_id=$2`,
      [engagement.id, trialBalance.id]
    )
    if (!snapshot) throw new Error('Generate a final Trial Balance before creating financial statements.')
    const { rows: [priorSelection] } = await query(
      `SELECT rs.prior_trial_balance_id,tb.id,tb.period,tb.filename,tb.row_count,
              tb.entity_period_id,fp.date_from,fp.date_till
       FROM engagement_reporting_sets rs
       LEFT JOIN trial_balances tb ON tb.id=rs.prior_trial_balance_id AND tb.entity_id=$2
       LEFT JOIN engagement_trial_balance_imports i
         ON i.engagement_id=rs.engagement_id AND i.trial_balance_id=tb.id
       LEFT JOIN financial_periods fp ON fp.id=(
         SELECT ep.financial_period_id FROM entity_periods ep WHERE ep.id=tb.entity_period_id
       )
       WHERE rs.id=$1 AND (rs.prior_trial_balance_id IS NULL OR i.trial_balance_id IS NOT NULL)`,
      [engagement.reporting_set_id, engagement.entity_id]
    )
    if (!priorSelection) throw new Error('The selected comparative Trial Balance is not linked to this engagement.')
    const { rows: [entity] } = await query(
      `SELECT id,name,constitution,constitution_display,business_type,address,cin,pan,jurisdiction,legal_form
       FROM entities WHERE id=$1`,
      [engagement.entity_id]
    )
    const { rows: financialRows } = await query(
      `SELECT mt.mapping1_resultant,mt.mapping2_resultant,mt.mapping3_resultant,
              mt.level4_value,mt.level5_value,mt.level6_value,mt.level7_value,
              mt.status,mt.override_note,tr.name AS ledger_name,tr.name,tr.ledger_code,
              mt.id AS mapped_id,mt.tb_row_id,mt.tb_id,tr.opening_balance,tr.closing_balance,
              tr.trail_balance,tr.is_deemed_positive,tr.upload_nature,tr.stock_head,
              lf.id AS lf_id,COALESCE(lf.alie,mt.alie,lf3.alie) AS alie,
              COALESCE(lf.level1,mt.mapping1_resultant) AS level1,
              COALESCE(lf.level2,mt.mapping2_resultant) AS level2,
              COALESCE(lf.level3,mt.mapping3_resultant) AS level3,
              lf.level4,lf.level5 AS lf_level5,lf.level6 AS lf_level6,lf.level7 AS lf_level7,
              COALESCE(lf.sort_order,lf_m2.sort_order,lf3.sort_order) AS sort_order
       FROM mapped_tb mt
       JOIN tb_rows tr ON tr.id=mt.tb_row_id
       LEFT JOIN level_format lf ON lf.id=mt.level_format_id
       LEFT JOIN level_format lf3 ON lf3.id=(
         SELECT id FROM level_format WHERE rule_set_id=mt.rule_set_id
           AND level1=mt.mapping1_resultant AND alie IS NOT NULL LIMIT 1
       ) AND mt.alie IS NULL AND lf.alie IS NULL
       LEFT JOIN level_format lf_m2 ON lf_m2.id=(
         SELECT id FROM level_format WHERE rule_set_id=mt.rule_set_id
           AND lower(level1)=lower(mt.mapping1_resultant)
           AND lower(level2)=lower(mt.mapping2_resultant) LIMIT 1
       ) AND lf.id IS NULL
       WHERE mt.tb_id=$1
         AND mt.status IN ('auto_high','auto_medium','auto_low','user_approved','user_override')
         AND COALESCE(lf.alie,mt.alie,lf3.alie) IS NOT NULL
       ORDER BY COALESCE(lf.sort_order,lf_m2.sort_order,lf3.sort_order) NULLS LAST,
                COALESCE(lf.alie,mt.alie),COALESCE(lf.level1,mt.mapping1_resultant),
                COALESCE(lf.level2,mt.mapping2_resultant),COALESCE(lf.level3,mt.mapping3_resultant)`,
      [trialBalance.id]
    )
    const { rows: levelFormat } = await query(
      `SELECT * FROM level_format WHERE rule_set_id=$1 AND constitution=$2 ORDER BY sort_order`,
      [snapshot.mapping_rule_set_id, entity.constitution]
    )
    let comparativeRows = []
    if (priorSelection.id) {
      const { rows } = await query(
        `SELECT mt.mapping1_resultant,mt.mapping2_resultant,mt.mapping3_resultant,
                mt.level4_value,mt.level5_value,mt.level6_value,mt.level7_value,
                mt.status,mt.override_note,tr.name AS ledger_name,tr.name,tr.ledger_code,
                mt.id AS mapped_id,mt.tb_row_id,mt.tb_id,tr.opening_balance,tr.closing_balance,
                tr.trail_balance,tr.is_deemed_positive,tr.upload_nature,tr.stock_head,
                lf.id AS lf_id,COALESCE(lf.alie,mt.alie) AS alie,
                COALESCE(lf.level1,mt.mapping1_resultant) AS level1,
                COALESCE(lf.level2,mt.mapping2_resultant) AS level2,
                COALESCE(lf.level3,mt.mapping3_resultant) AS level3,
                lf.level4,lf.level5 AS lf_level5,lf.level6 AS lf_level6,lf.level7 AS lf_level7,
                lf.sort_order
         FROM mapped_tb mt
         JOIN tb_rows tr ON tr.id=mt.tb_row_id
         LEFT JOIN level_format lf ON lf.id=mt.level_format_id
         WHERE mt.tb_id=$1
           AND mt.status IN ('auto_high','auto_medium','auto_low','user_approved','user_override')
           AND COALESCE(lf.alie,mt.alie) IS NOT NULL
         ORDER BY lf.sort_order NULLS LAST,COALESCE(lf.alie,mt.alie),lf.level1,lf.level2,lf.level3`,
        [priorSelection.id]
      )
      comparativeRows = rows
    }
    const { rows: details } = await query(
      `SELECT note_num,note_title,data FROM note_details WHERE tb_id=$1 ORDER BY note_num`,
      [trialBalance.id]
    )
    const { rows: disclosures } = await query(
      `SELECT note_num,note_title,text FROM note_disclosures WHERE tb_id=$1 AND text<>'' ORDER BY note_num`,
      [trialBalance.id]
    )
    const { rows: comparativeTrialBalances } = await query(
      `SELECT tb.id,tb.period,tb.filename,tb.row_count,fp.date_from,fp.date_till
       FROM engagement_trial_balance_imports i
       JOIN trial_balances tb ON tb.id=i.trial_balance_id
       JOIN entity_periods ep ON ep.id=tb.entity_period_id AND ep.entity_id=tb.entity_id
       JOIN financial_periods fp ON fp.id=ep.financial_period_id
       WHERE i.engagement_id=$1 AND tb.entity_id=$2 AND fp.date_till < $3
       ORDER BY fp.date_till DESC,tb.uploaded_at DESC`,
      [engagement.id, engagement.entity_id, context.period.date_from]
    )
    const { rows: [reportSettings] } = await query(
      `SELECT template_id,revision,fields,updated_at FROM engagement_audit_report_settings WHERE engagement_id=$1`,
      [engagement.id]
    )
    const identity = await reportingIdentity(engagement)
    const { rows: auditors } = await query(`SELECT * FROM auditors WHERE entity_id=$1 AND is_active=TRUE ORDER BY id`, [entity.id])
    const { rows: signatories } = await query(`SELECT * FROM signatories WHERE entity_id=$1 AND is_active=TRUE ORDER BY id`, [entity.id])
    const { rows: [generalNotes] } = await query(
      `SELECT segments FROM general_notes WHERE entity_id=$1 AND entity_period_id=$2`,
      [entity.id, context.period.id]
    )
    return {
      engagement: {
        id: Number(engagement.id), reference: engagement.reference, name: engagement.name,
        status: engagement.status, periodStart: dateOnly(engagement.period_start),
        periodEnd: dateOnly(engagement.period_end), periodLabel: engagement.period_label,
      },
      entity,
      activeTB: { ...trialBalance, id: Number(trialBalance.id), entity_period_id: context.period.id },
      comparativeTrialBalance: priorSelection.id ? {
        id: Number(priorSelection.id),
        period: priorSelection.period,
        filename: priorSelection.filename,
        dateFrom: dateOnly(priorSelection.date_from),
        dateTill: dateOnly(priorSelection.date_till),
      } : null,
      comparativeTrialBalances: comparativeTrialBalances.map(row => ({ ...row, id: Number(row.id) })),
      comparativeRows,
      snapshot: { ...snapshot, id: Number(snapshot.id), version: Number(snapshot.version) },
      financialRows,
      levelFormat,
      noteDetails: details.map(row => ({ ...row, data: JSON.parse(row.data || '{}') })),
      noteDisclosures: disclosures,
      generalNotes: generalNotes?.segments || null,
      auditors,
      signatories,
      firmSettings: {
        professionalFirms: identity.firms.map(row => ({ ...row, id: Number(row.id) })),
        offices: identity.offices.map(row => ({ ...row, id: Number(row.id), auditor_firm_id: Number(row.auditor_firm_id) })),
        partners: identity.partners.map(row => ({ ...row, id: Number(row.id) })),
        branding: identity.brandingFirm ? {
          id: Number(identity.brandingFirm.id),
          name: identity.brandingFirm.firm_name,
          logoMimeType: identity.brandingFirm.logo_mime_type || null,
          logoBase64: identity.brandingFirm.logo_base64 || null,
        } : null,
      },
      reportingSelections: identity.selection,
      reportIdentitySnapshot: identity.identitySnapshot,
      auditReport: {
        ...(reportSettings || { template_id: 'india-basic-v1', revision: 0, fields: {} }),
        fields: { ...validateAuditReportFields(reportSettings?.fields || {}), ...identity.fields },
      },
    }
  })

  ipcMain.handle('engagement:reportingSelectionsSave', async (event, input = {}) => {
    const user = await authenticated(event)
    const context = await assertEngagementTBContext(user, input.engagementId)
    await assertCanEdit(user, context.engagement)
    assertEngagementEditable(context.engagement, context.period)
    const firmId = input.responsibleAuditorFirmId ? Number(input.responsibleAuditorFirmId) : null
    const officeId = input.responsibleOfficeId ? Number(input.responsibleOfficeId) : null
    const brandingId = input.brandingAuditorFirmId ? Number(input.brandingAuditorFirmId) : firmId
    if ([firmId, brandingId].some(value => value != null && (!Number.isSafeInteger(value) || value <= 0))
      || (officeId != null && (!Number.isSafeInteger(officeId) || officeId <= 0))) {
      throw new Error('Choose valid firm and office selections.')
    }
    const signatoryIds = input.managementSignatoryIds
    if (!Array.isArray(signatoryIds) || signatoryIds.length > 20
      || signatoryIds.some(id => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)
      || new Set(signatoryIds.map(Number)).size !== signatoryIds.length) {
      throw new Error('Select up to 20 unique active management signatories in report order.')
    }
    if (firmId) {
      const { rows: [selectedFirm] } = await query(
        `SELECT id FROM auditor_firms WHERE id=$1 AND service_firm_id=$2 AND is_active=TRUE`,
        [firmId, user.firmId]
      )
      if (!selectedFirm) throw new Error('Choose an active professional firm associated with your firm.')
    }
    if (brandingId) {
      const { rows: [selectedBrand] } = await query(
        `SELECT id FROM auditor_firms WHERE id=$1 AND service_firm_id=$2 AND is_active=TRUE`,
        [brandingId, user.firmId]
      )
      if (!selectedBrand) throw new Error('Choose an active branding profile associated with your firm.')
    }
    if (officeId) {
      const { rows: [selectedOffice] } = await query(
        `SELECT id FROM auditor_firm_offices
         WHERE id=$1 AND service_firm_id=$2 AND auditor_firm_id=$3 AND is_active=TRUE`,
        [officeId, user.firmId, firmId]
      )
      if (!selectedOffice) throw new Error('Choose an active office belonging to the selected responsible firm.')
    }
    if (signatoryIds.length) {
      const { rows: signatories } = await query(
        `SELECT id FROM signatories
         WHERE entity_id=$1 AND is_active=TRUE AND id=ANY($2::int[])`,
        [context.engagement.entity_id, signatoryIds.map(Number)]
      )
      if (signatories.length !== signatoryIds.length) {
        throw new Error('One or more management signatories are no longer active for this engagement.')
      }
    }
    await query(
      `UPDATE engagement_reporting_sets
       SET responsible_auditor_firm_id=$1,responsible_office_id=$2,
           branding_auditor_firm_id=$3,management_signatory_ids=$4::jsonb,updated_at=now()
       WHERE id=$5 AND engagement_id=$6`,
      [firmId, officeId, brandingId, JSON.stringify(signatoryIds.map(Number)),
        context.engagement.reporting_set_id, context.engagement.id]
    )
    await logAudit(user, 'report.identity_selections_updated', context.engagement.id, {
      responsibleFirmId: firmId, officeId, brandingFirmId: brandingId,
      managementSignatoryIds: signatoryIds.map(Number),
    })
    return { ok: true }
  })

  ipcMain.handle('engagement:reportingSettingsSave', async (event, input = {}) => {
    const user = await authenticated(event)
    const { engagement } = await assertEngagementTBContext(user, input.engagementId)
    await assertCanEdit(user, engagement)
    assertEngagementEditable(engagement, { locked: engagement.locked, is_final: engagement.is_final })
    const fields = { ...validateAuditReportFields(input.fields), ...(await reportingIdentity(engagement)).fields }
    return runInTransaction(async () => {
      const { rows: [settings] } = await query(
        `INSERT INTO engagement_audit_report_settings (engagement_id,template_id,revision,fields,updated_by)
         VALUES ($1,'india-basic-v1',1,$2::jsonb,$3)
         ON CONFLICT (engagement_id) DO UPDATE SET
           revision=engagement_audit_report_settings.revision+1,
           fields=EXCLUDED.fields,updated_by=EXCLUDED.updated_by,updated_at=now()
         RETURNING engagement_id,template_id,revision,fields,updated_at`,
        [engagement.id, JSON.stringify(fields), user.id]
      )
      await logAudit(user, 'audit_report.template_updated', engagement.id, { revision: settings.revision })
      return settings
    })
  })

  ipcMain.handle('engagement:reportingSignatoryCreate', async (event, input = {}) => {
    const user = await authenticated(event)
    const { engagement } = await assertEngagementTBContext(user, input.engagementId)
    await assertCanEdit(user, engagement)
    assertEngagementEditable(engagement, { locked: engagement.locked, is_final: engagement.is_final })
    const name = String(input.name || '').trim()
    const designation = String(input.designation || '').trim()
    const din = String(input.din || '').trim()
    if (!name || name.length > 255 || designation.length > 255 || din.length > 50) {
      throw new Error('Enter a valid signatory name, designation and identification number.')
    }
    return runInTransaction(async () => {
      const { rows: [signatory] } = await query(
        `INSERT INTO signatories (entity_id,name,din,designation,id_type)
         VALUES ($1,$2,$3,$4,$5) RETURNING id,name,din,designation,id_type`,
        [engagement.entity_id, name, din || null, designation || null, din ? 'DIN' : null]
      )
      await logAudit(user, 'report.signatory_created', engagement.id, { signatoryId: Number(signatory.id) })
      return { ...signatory, id: Number(signatory.id) }
    })
  })

  ipcMain.handle('engagement:noteDisclosureSave', async (event, input = {}) => {
    const user = await authenticated(event)
    const context = await assertAuthorizedEngagementTB(user, input.engagementId, input.trialBalanceId)
    await assertCanEdit(user, context.engagement)
    assertEngagementEditable(context.engagement, context.period)
    await assertIndiaScheduleIII(context.engagement)
    const noteNum = Number(input.noteNum)
    const noteTitle = String(input.noteTitle || '').trim()
    const text = String(input.text || '')
    if (!Number.isInteger(noteNum) || noteNum < 1 || noteNum > 500 || !noteTitle || noteTitle.length > 500 || text.length > 12000) {
      throw new Error('Enter a valid note number, title and disclosure of no more than 12,000 characters.')
    }
    await runInTransaction(async () => {
      const { rows: [existing] } = await query(
        `SELECT note_num FROM note_disclosures
         WHERE tb_id=$1 AND lower(btrim(note_title))=lower(btrim($2))
         ORDER BY note_num LIMIT 1 FOR UPDATE`,
        [context.trialBalance.id, noteTitle]
      )
      if (existing) {
        await query(
          `UPDATE note_disclosures SET text=$1,updated_at=now()
           WHERE tb_id=$2 AND note_num=$3`,
          [text, context.trialBalance.id, existing.note_num]
        )
      } else {
        const { rows: [last] } = await query(
          `SELECT COALESCE(MAX(note_num),0)::integer AS note_num FROM note_disclosures WHERE tb_id=$1`,
          [context.trialBalance.id]
        )
        await query(
          `INSERT INTO note_disclosures (tb_id,note_num,note_title,text,updated_at)
           VALUES ($1,$2,$3,$4,now())`,
          [context.trialBalance.id, Number(last.note_num) + 1, noteTitle, text]
        )
      }
      await logAudit(user, 'report.note_disclosure_updated', context.engagement.id, {
        trialBalanceId: context.trialBalance.id, noteNum, noteTitle,
      })
    })
    return { ok: true }
  })

  ipcMain.handle('engagement:noteDetailsSave', async (event, input = {}) => {
    const user = await authenticated(event)
    const context = await assertAuthorizedEngagementTB(user, input.engagementId, input.trialBalanceId)
    await assertCanEdit(user, context.engagement)
    assertEngagementEditable(context.engagement, context.period)
    await assertIndiaScheduleIII(context.engagement)
    const noteNum = Number(input.noteNum)
    const noteTitle = String(input.noteTitle || '').trim()
    if (!Number.isInteger(noteNum) || noteNum < 1 || noteNum > 500 || !noteTitle || noteTitle.length > 500
      || !input.data || typeof input.data !== 'object' || Array.isArray(input.data)) {
      throw new Error('Enter a valid structured disclosure for the selected note.')
    }
    let serialized
    try {
      serialized = JSON.stringify(input.data)
    } catch {
      throw new Error('Structured note details must be valid JSON data.')
    }
    if (Buffer.byteLength(serialized) > 65536) throw new Error('Structured note details cannot exceed 64 KB.')
    await runInTransaction(async () => {
      const { rows: [existing] } = await query(
        `SELECT note_num FROM note_details
         WHERE tb_id=$1 AND lower(btrim(note_title))=lower(btrim($2))
         ORDER BY note_num LIMIT 1 FOR UPDATE`,
        [context.trialBalance.id, noteTitle]
      )
      if (existing) {
        await query(
          `UPDATE note_details SET data=$1::text,details=$1::text::jsonb,updated_at=now()
           WHERE tb_id=$2 AND note_num=$3`,
          [serialized, context.trialBalance.id, existing.note_num]
        )
      } else {
        const { rows: [last] } = await query(
          `SELECT COALESCE(MAX(note_num),0)::integer AS note_num FROM note_details WHERE tb_id=$1`,
          [context.trialBalance.id]
        )
        await query(
          `INSERT INTO note_details (tb_id,note_num,note_title,data,details,updated_at)
           VALUES ($1,$2,$3,$4::text,$4::text::jsonb,now())`,
          [context.trialBalance.id, Number(last.note_num) + 1, noteTitle, serialized]
        )
      }
      await logAudit(user, 'report.note_details_updated', context.engagement.id, {
        trialBalanceId: context.trialBalance.id, noteNum, noteTitle,
      })
    })
    return { ok: true }
  })

  ipcMain.handle('engagement:reportOutputSave', async (event, input = {}) => {
    const user = await authenticated(event)
    const context = await assertAuthorizedEngagementTB(user, input.engagementId, input.trialBalanceId)
    await assertCanEdit(user, context.engagement)
    assertEngagementEditable(context.engagement, context.period)
    const pdfBase64 = input.pdfContentBase64
    if (typeof pdfBase64 !== 'string' || pdfBase64.length > 28 * 1024 * 1024
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(pdfBase64)) {
      throw new Error('Combined PDF must be a valid file no larger than 20 MB.')
    }
    const pdf = Buffer.from(pdfBase64, 'base64')
    if (pdf.toString('base64') !== pdfBase64 || pdf.length < 5 || pdf.length > 20 * 1024 * 1024
      || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('The generated report is not a valid PDF or exceeds the 20 MB limit.')
    }
    const signing = input.signingDetails
    if (!signing || typeof signing !== 'object' || Array.isArray(signing)) throw new Error('Financial-statement signing details are required.')
    const approvalDate = String(signing.approvalDate || '')
    const approvalPlace = String(signing.approvalPlace || '').trim()
    if (!isValidDateOnly(approvalDate) || approvalDate < dateOnly(context.engagement.period_end) || approvalPlace.length < 1 || approvalPlace.length > 255) {
      throw new Error('Enter a valid financial-statement approval date and place. These are separate from the audit report date and place.')
    }
    const { rows: [snapshot] } = await query(
      `SELECT id,version,source_trial_balance_id,journal_watermark,mapping_rule_set_id
       FROM engagement_final_tb_snapshots WHERE engagement_id=$1 AND trial_balance_id=$2`,
      [context.engagement.id, context.trialBalance.id]
    )
    if (!snapshot) throw new Error('The selected Trial Balance is not a final engagement snapshot.')
    const { rows: financialRows } = await query(
      `SELECT tr.id,tr.name,tr.opening_balance,tr.closing_balance,mt.mapping1_resultant,
              mt.mapping2_resultant,mt.mapping3_resultant,mt.alie,mt.status
       FROM tb_rows tr LEFT JOIN mapped_tb mt ON mt.tb_row_id=tr.id AND mt.tb_id=tr.tb_id
       WHERE tr.tb_id=$1 ORDER BY tr.id`,
      [context.trialBalance.id]
    )
    const settings = (await query(
      `SELECT template_id,revision,fields FROM engagement_audit_report_settings WHERE engagement_id=$1`,
      [context.engagement.id]
    )).rows[0] || { template_id: 'india-basic-v1', revision: 0, fields: {} }
    const identity = await reportingIdentity(context.engagement)
    const fields = { ...validateAuditReportFields(settings.fields), ...identity.fields }
    if (!fields.opinion || !fields.reportDate || !fields.reportPlace) {
      throw new Error('Complete the auditor-entered opinion, audit report date and place before generating the final PDF.')
    }
    if (!input.reportIdentitySnapshot || JSON.stringify(input.reportIdentitySnapshot) !== JSON.stringify(identity.identitySnapshot)) {
      throw new Error('Firm, office, partner or branding details changed while the PDF was being generated. Refresh the engagement and generate again.')
    }
    if (!input.auditReportFields || JSON.stringify(validateAuditReportFields(input.auditReportFields)) !== JSON.stringify(fields)) {
      throw new Error('Audit report details changed while the PDF was being generated. Refresh the report and generate again.')
    }
    if (!identity.responsibleFirm?.is_active || !identity.partner?.active || !identity.brandingFirm?.is_active
      || (identity.selection.responsibleOfficeId && !identity.office?.is_active)
      || !fields.firmName || !fields.auditorName || !fields.auditorMembershipNumber) {
      throw new Error('Select an active responsible firm, branding profile and engagement partner with a membership or registration number before generating the final PDF.')
    }
    const signatoryIds = Array.isArray(signing.signatoryIds)
      ? [...new Set(signing.signatoryIds.map(Number).filter(value => Number.isSafeInteger(value) && value > 0))]
      : []
    if (!signatoryIds.length || signatoryIds.length > 20
      || signatoryIds.length !== identity.selection.managementSignatoryIds.length
      || signatoryIds.some((id, index) => id !== identity.selection.managementSignatoryIds[index])) {
      throw new Error('Save at least one active management signatory in the displayed order before generating the financial-statement approval page.')
    }
    const { rows: signatoryRows } = await query(
      `SELECT id,name,din,designation,id_type FROM signatories
       WHERE entity_id=$1 AND is_active=TRUE AND id=ANY($2::int[])
       ORDER BY array_position($2::int[],id)`,
      [context.engagement.entity_id, signatoryIds]
    )
    if (signatoryRows.length !== signatoryIds.length) {
      throw new Error('One or more selected client signatories are no longer active for this engagement.')
    }
    const dataHash = createHash('sha256').update(JSON.stringify({
      snapshotId: Number(snapshot.id),
      version: Number(snapshot.version),
      journalWatermark: Number(snapshot.journal_watermark),
      rows: financialRows,
    })).digest('hex')
    return runInTransaction(async () => {
      const { rows: [locked] } = await query(
        `SELECT e.status,ep.locked,ep.is_final
         FROM engagements e
         JOIN engagement_reporting_sets rs ON rs.engagement_id=e.id
         JOIN entity_periods ep ON ep.id=rs.entity_period_id
         WHERE e.id=$1 AND e.firm_id=$2 AND rs.id=$3
         FOR UPDATE OF e,ep`,
        [context.engagement.id, user.firmId, context.engagement.reporting_set_id]
      )
      if (!locked) throw new Error('Engagement reporting context is unavailable.')
      assertEngagementEditable({ ...context.engagement, status: locked.status }, { locked: locked.locked, is_final: locked.is_final })
      const currentEngagement = await fetchEngagement(user.firmId, context.engagement.id)
      await assertCanEdit(user, currentEngagement)
      const { rows: [versionRow] } = await query(
        `SELECT COALESCE(MAX(version),0)::integer+1 AS next_version
         FROM engagement_report_outputs WHERE engagement_id=$1`,
        [context.engagement.id]
      )
      const { rows: [output] } = await query(
        `INSERT INTO engagement_report_outputs
           (engagement_id,final_tb_snapshot_id,version,template_id,template_revision,
            audit_report_fields,signing_details,financial_data_sha256,pdf_content,created_by)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)
         RETURNING id,version,template_id,template_revision,financial_data_sha256,created_at`,
        [
          context.engagement.id, snapshot.id, versionRow.next_version,
          settings.template_id, settings.revision, JSON.stringify(fields),
          JSON.stringify({
            approvalDate,
            approvalPlace,
            signatories: signatoryRows,
            auditReportDate: fields.reportDate,
            auditReportPlace: fields.reportPlace,
            responsibleAuditorFirmId: identity.selection.responsibleAuditorFirmId,
            responsibleOfficeId: identity.selection.responsibleOfficeId,
            brandingAuditorFirmId: identity.selection.brandingAuditorFirmId,
            identitySnapshot: identity.identitySnapshot,
          }), dataHash, pdf, user.id,
        ]
      )
      await logAudit(user, 'report.output_created', context.engagement.id, {
        outputId: Number(output.id), version: output.version, finalTBSnapshotId: Number(snapshot.id),
        templateRevision: settings.revision, financialDataSha256: dataHash,
      })
      return { ...output, id: Number(output.id), version: Number(output.version) }
    })
  })

  ipcMain.handle('engagement:reportOutputs', async (event, engagementId) => {
    const user = await authenticated(event)
    const { engagement } = await assertEngagementTBContext(user, engagementId)
    const { rows } = await query(
      `SELECT o.id,o.version,o.template_id,o.template_revision,o.financial_data_sha256,
              o.created_by,u.display_name AS created_by_name,o.created_at,o.finalised_by,
              o.finalised_at,f.display_name AS finalised_by_name,
              s.version AS final_tb_version,tb.filename AS final_tb_filename
       FROM engagement_report_outputs o
       JOIN firm_users u ON u.id=o.created_by
       LEFT JOIN firm_users f ON f.id=o.finalised_by
       JOIN engagement_final_tb_snapshots s ON s.id=o.final_tb_snapshot_id
       JOIN trial_balances tb ON tb.id=s.trial_balance_id
       WHERE o.engagement_id=$1 ORDER BY o.version DESC`,
      [engagement.id]
    )
    return rows.map(row => ({ ...row, id: Number(row.id), version: Number(row.version) }))
  })

  ipcMain.handle('engagement:reportOutputRead', async (event, outputId) => {
    const user = await authenticated(event)
    const id = Number(outputId)
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Report output not found.')
    const { rows: [output] } = await query(
      `SELECT o.id,o.engagement_id,o.version,o.pdf_content,o.created_at,o.finalised_at
       FROM engagement_report_outputs o
       JOIN engagements e ON e.id=o.engagement_id AND e.firm_id=$2
       WHERE o.id=$1`,
      [id, user.firmId]
    )
    if (!output) throw new Error('Report output not found.')
    const engagement = await fetchEngagement(user.firmId, output.engagement_id)
    const membership = await membershipFor(engagement.id, user.id)
    if (!canViewEngagement(user, engagement, membership)) throw new Error('Report output not found.')
    return {
      id: Number(output.id), version: Number(output.version), createdAt: output.created_at,
      finalisedAt: output.finalised_at, pdfContentBase64: Buffer.from(output.pdf_content).toString('base64'),
      engagement: { id: Number(engagement.id), reference: engagement.reference, name: engagement.name },
    }
  })

  ipcMain.handle('engagement:reportOutputFinalise', async (event, outputId) => {
    const user = await authenticated(event)
    const id = Number(outputId)
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Report output not found.')
    return runInTransaction(async () => {
      const { rows: [output] } = await query(
        `SELECT id,engagement_id,version,finalised_at FROM engagement_report_outputs WHERE id=$1 FOR UPDATE`,
        [id]
      )
      if (!output) throw new Error('Report output not found.')
      const engagement = await fetchEngagement(user.firmId, output.engagement_id)
      if (!canFinaliseEngagement(user, engagement)) throw new Error('Only the assigned engagement partner or authorised substitute may finalise this output.')
      if (output.finalised_at) throw new Error('This report output version is already finalised and cannot be changed.')
      const { rows: [finalised] } = await query(
        `UPDATE engagement_report_outputs SET finalised_by=$1,finalised_at=now()
         WHERE id=$2 AND finalised_at IS NULL
         RETURNING id,version,finalised_by,finalised_at`,
        [user.id, id]
      )
      if (!finalised) throw new Error('This report output was finalised by another request.')
      await logAudit(user, 'report.output_finalised', engagement.id, {
        outputId: Number(id), version: Number(output.version),
      })
      return { ...finalised, id: Number(finalised.id), version: Number(finalised.version) }
    })
  })

  ipcMain.handle('engagement:updateAccess', async (event, input = {}) => {
    const actor = await authenticated(event)
    const engagement = await fetchEngagement(actor.firmId, Number(input.engagementId))
    if (actor.role !== 'administrator' && engagement.owner_user_id !== actor.id) {
      throw new Error('Only the engagement owner or an administrator can manage access.')
    }
    const userId = Number(input.userId)
    const access = input.accessLevel
    if (!Number.isInteger(userId) || userId <= 0 || (!input.remove && !['read', 'edit'].includes(access))) {
      throw new Error('Choose a valid user and access level.')
    }
    await assertFirmUsers(actor.firmId, [userId])
    if ([engagement.owner_user_id, engagement.partner_user_id, engagement.substitute_user_id].includes(userId)) {
      throw new Error('The owner, assigned partner, and substitute have separately defined engagement access.')
    }
    await runInTransaction(async () => {
      if (input.remove) {
        await query(`DELETE FROM engagement_memberships WHERE engagement_id=$1 AND user_id=$2`, [engagement.id, userId])
        await logAudit(actor, 'access.revoked', engagement.id, { userId })
      } else {
        await query(
          `INSERT INTO engagement_memberships (engagement_id,user_id,access_level,granted_by)
           VALUES ($1,$2,$3,$4) ON CONFLICT (engagement_id,user_id)
           DO UPDATE SET access_level=EXCLUDED.access_level,granted_by=EXCLUDED.granted_by,created_at=now()`,
          [engagement.id, userId, access, actor.id]
        )
        await logAudit(actor, 'access.granted', engagement.id, { userId, accessLevel: access })
      }
    })
    return { ok: true }
  })

  ipcMain.handle('engagement:confirmLegacyLink', async (event, input = {}) => {
    const actor = await authenticated(event)
    const engagement = await fetchEngagement(actor.firmId, Number(input.engagementId))
    if (actor.role !== 'administrator' && engagement.owner_user_id !== actor.id) {
      throw new Error('Only the engagement owner or an administrator can confirm legacy setup.')
    }
    if (engagement.status !== 'draft') throw new Error('Legacy setup can only be confirmed while the engagement is a Draft.')
    const note = String(input.note || '').trim()
    if (!note) throw new Error('Record the basis for confirming the existing period data.')
    await runInTransaction(async () => {
      const { rows: [link] } = await query(
        `SELECT confirmation_status FROM engagement_legacy_links
         WHERE engagement_id=$1 FOR UPDATE`,
        [engagement.id]
      )
      if (!link) throw new Error('This engagement has no legacy period link to confirm.')
      await query(
        `UPDATE engagement_legacy_links
         SET confirmation_status='confirmed',confirmation_note=$1,confirmed_by=$2,confirmed_at=now()
         WHERE engagement_id=$3`,
        [note, actor.id, engagement.id]
      )
      await query(
        `UPDATE engagement_reporting_sets SET compatibility_confirmed=TRUE,updated_at=now()
         WHERE id=$1`,
        [engagement.reporting_set_id]
      )
      await logAudit(actor, 'legacy.setup_confirmed', engagement.id, { note })
    })
    return { ok: true }
  })

  ipcMain.handle('engagement:linkLegacyTrialBalances', async (event, input = {}) => {
    const actor = await authenticated(event)
    const engagement = await fetchEngagement(actor.firmId, Number(input.engagementId))
    if (actor.role !== 'administrator' && engagement.owner_user_id !== actor.id) {
      throw new Error('Only the engagement owner or an administrator can link legacy trial balances.')
    }
    if (engagement.status !== 'draft') throw new Error('Legacy trial balances can only be linked while the engagement is a Draft.')
    if (!engagement.entity_period_id) throw new Error('Set the reporting period before linking a trial balance.')
    if (!Array.isArray(input.trialBalanceIds) || !input.trialBalanceIds.length || input.trialBalanceIds.length > 100) {
      throw new Error('Select between 1 and 100 unlinked trial balances.')
    }
    const ids = [...new Set(input.trialBalanceIds.map(Number))]
    if (ids.some(tbId => !Number.isInteger(tbId) || tbId <= 0)) {
      throw new Error('The selected trial balance list is invalid.')
    }
    const note = String(input.note || '').trim()
    if (!note) throw new Error('Record why the selected trial balances belong to this reporting period.')

    await runInTransaction(async () => {
      const { rows } = await query(
        `SELECT id FROM trial_balances
         WHERE id=ANY($1::int[]) AND entity_id=$2 AND entity_period_id IS NULL
         FOR UPDATE`,
        [ids, engagement.entity_id]
      )
      if (rows.length !== ids.length) {
        throw new Error('One or more selected trial balances are no longer available for this client.')
      }
      const { rows: linked } = await query(
        `UPDATE trial_balances SET entity_period_id=$1
         WHERE id=ANY($2::int[]) AND entity_id=$3 AND entity_period_id IS NULL
         RETURNING id`,
        [engagement.entity_period_id, ids, engagement.entity_id]
      )
      for (const row of linked) {
        await query(
          `INSERT INTO engagement_legacy_tb_links
             (engagement_id,trial_balance_id,entity_period_id,linked_by,confirmation_note)
           VALUES ($1,$2,$3,$4,$5)`,
          [engagement.id, row.id, engagement.entity_period_id, actor.id, note]
        )
      }
      await logAudit(actor, 'legacy.trial_balances_linked', engagement.id, {
        trialBalanceIds: linked.map(row => Number(row.id)), entityPeriodId: engagement.entity_period_id, note,
      })
    })
    return { ok: true }
  })

  ipcMain.handle('engagement:resolveAccessRequest', async (event, input = {}) => {
    const actor = await authenticated(event)
    const engagement = await fetchEngagement(actor.firmId, Number(input.engagementId))
    if (actor.role !== 'administrator' && engagement.owner_user_id !== actor.id) {
      throw new Error('Only the engagement owner or an administrator can review access requests.')
    }
    const decision = input.decision
    if (!['approved', 'declined'].includes(decision)) throw new Error('Choose approve or decline.')
    const requestId = Number(input.requestId)
    await runInTransaction(async () => {
      const { rows: [request] } = await query(
        `SELECT * FROM engagement_access_requests WHERE id=$1 AND engagement_id=$2 AND status='pending' FOR UPDATE`,
        [requestId, engagement.id]
      )
      if (!request) throw new Error('Pending access request not found.')
      if (decision === 'approved') {
        await query(
          `INSERT INTO engagement_memberships (engagement_id,user_id,access_level,granted_by)
           VALUES ($1,$2,$3,$4) ON CONFLICT (engagement_id,user_id)
           DO UPDATE SET access_level=EXCLUDED.access_level,granted_by=EXCLUDED.granted_by,created_at=now()`,
          [engagement.id, request.user_id, input.accessLevel === 'edit' ? 'edit' : 'read', actor.id]
        )
      }
      await query(
        `UPDATE engagement_access_requests SET status=$1,resolved_by=$2,resolved_at=now() WHERE id=$3`,
        [decision, actor.id, requestId]
      )
      await logAudit(actor, `access.request_${decision}`, engagement.id, { userId: Number(request.user_id) })
    })
    return { ok: true }
  })

  ipcMain.handle('engagement:activate', async (event, input = {}) => {
    const actor = await authenticated(event)
    const id = Number(input.engagementId)
    const engagement = await fetchEngagement(actor.firmId, id)
    const membership = await assertCanEdit(actor, engagement)
    void membership
    if (engagement.status !== 'draft') throw new Error('Only a Draft engagement can be activated.')
    const validation = validateActivation({
      entityId: engagement.entity_id, name: engagement.name, periodStart: dateOnly(engagement.period_start),
      periodEnd: dateOnly(engagement.period_end), serviceScope: engagement.service_scope,
      partnerUserId: engagement.partner_user_id, jurisdiction: engagement.jurisdiction,
      framework: engagement.accounting_framework, reportingPackId: engagement.reporting_pack_id,
      trialBalanceCurrency: engagement.trial_balance_currency,
      presentationCurrency: engagement.presentation_currency,
      compatibilityConfirmed: engagement.compatibility_confirmed,
    })
    if (validation.length) throw new Error(validation.join(' '))
    const { rows: [pack] } = await query(`SELECT processing_status FROM reporting_pack_catalog WHERE pack_id=$1`, [engagement.reporting_pack_id])
    if (pack?.processing_status !== 'implemented') throw new Error('This reporting pack is not implemented for processing.')
    await runInTransaction(async () => {
      await assertEntityPeriodAvailableForActivation(engagement.entity_period_id)
      const { rows: [updated] } = await query(
        `UPDATE engagements SET status='active',updated_at=now() WHERE id=$1 AND status='draft' RETURNING id`,
        [id]
      )
      if (!updated) throw new Error('This engagement has already changed status. Refresh and try again.')
      await logAudit(actor, 'engagement.activated', id, {})
    })
    return { ok: true }
  })

  ipcMain.handle('engagement:finalise', async (event, input = {}) => {
    const actor = await authenticated(event)
    const id = Number(input.engagementId)
    const engagement = await fetchEngagement(actor.firmId, id)
    if (!canFinaliseEngagement(actor, engagement)) throw new Error('Finalisation is restricted to the assigned engagement partner or authorised substitute.')
    if (engagement.status !== 'active') throw new Error('Only an active engagement can be finalised.')
    const place = String(input.place || '').trim()
    const date = String(input.date || '').trim()
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null
    if (!place || !parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      throw new Error('A valid signing place and date are required.')
    }
    if (!engagement.entity_period_id) throw new Error('This engagement has no linked entity reporting period.')
    await runInTransaction(async () => {
      const { rows: [period] } = await query(
        `SELECT locked,locked_at::text AS locked_at,is_final,finalised_at::text AS finalised_at,
                final_sign_place,final_sign_date
         FROM entity_periods WHERE id=$1 FOR UPDATE`,
        [engagement.entity_period_id]
      )
      if (!period) throw new Error('The linked entity period no longer exists.')
      if (period.locked || period.is_final) {
        throw new Error('The linked entity period is already locked or finalised. Resolve its existing state before finalising this engagement.')
      }
      const priorState = {
        locked: period.locked,
        locked_at: period.locked_at,
        is_final: period.is_final,
        finalised_at: period.finalised_at,
        final_sign_place: period.final_sign_place,
        final_sign_date: period.final_sign_date,
      }
      const { rows: [updated] } = await query(
        `UPDATE entity_periods SET is_final=TRUE,final_sign_place=$1,final_sign_date=$2,finalised_at=now(),
                locked=TRUE,locked_at=now() WHERE id=$3 RETURNING finalised_at::text AS finalised_at`,
        [place, date, engagement.entity_period_id]
      )
      await query(
        `UPDATE engagement_reporting_sets
         SET prior_entity_period_state=$1::jsonb,finalisation_sign_place=$2,finalisation_sign_date=$3,
             engagement_finalised_at=$4,updated_at=now()
         WHERE id=$5`,
        [JSON.stringify(priorState), place, date, updated.finalised_at, engagement.reporting_set_id]
      )
      await query(`UPDATE engagements SET status='finalised',updated_at=now() WHERE id=$1`, [id])
      await logAudit(actor, 'engagement.finalised', id, { place, date })
    })
    return { ok: true }
  })

  ipcMain.handle('engagement:reopen', async (event, engagementId) => {
    const actor = await authenticated(event)
    const id = Number(engagementId)
    const engagement = await fetchEngagement(actor.firmId, id)
    if (!canFinaliseEngagement(actor, engagement)) throw new Error('Reopening is restricted to the assigned engagement partner or authorised substitute.')
    if (engagement.status !== 'finalised') throw new Error('Only a finalised engagement can be reopened.')
    if (!engagement.entity_period_id) throw new Error('This engagement has no linked entity reporting period.')
    await runInTransaction(async () => {
      const { rows: [reporting] } = await query(
        `SELECT prior_entity_period_state,finalisation_sign_place,finalisation_sign_date,
                engagement_finalised_at::text AS engagement_finalised_at
         FROM engagement_reporting_sets WHERE id=$1 FOR UPDATE`,
        [engagement.reporting_set_id]
      )
      const prior = reporting?.prior_entity_period_state
      if (!prior || reporting.engagement_finalised_at == null) {
        throw new Error('The original entity-period state is unavailable; reopening would risk changing legacy data.')
      }
      const { rows: [updated] } = await query(
        `UPDATE entity_periods
         SET is_final=($1::jsonb->>'is_final')::boolean,
             finalised_at=($1::jsonb->>'finalised_at')::timestamptz,
             final_sign_place=$1::jsonb->>'final_sign_place',
             final_sign_date=$1::jsonb->>'final_sign_date',
             locked=($1::jsonb->>'locked')::boolean,
             locked_at=($1::jsonb->>'locked_at')::timestamptz
         WHERE id=$2 AND is_final=TRUE AND locked=TRUE
           AND final_sign_place=$3 AND final_sign_date=$4
           AND finalised_at=$5
         RETURNING id`,
        [JSON.stringify(prior), engagement.entity_period_id, reporting.finalisation_sign_place,
          reporting.finalisation_sign_date, reporting.engagement_finalised_at]
      )
      if (!updated) {
        throw new Error('The linked entity period changed after finalisation. Resolve its current state before reopening.')
      }
      await query(
        `UPDATE engagement_reporting_sets
         SET prior_entity_period_state=NULL,finalisation_sign_place=NULL,finalisation_sign_date=NULL,
             engagement_finalised_at=NULL,updated_at=now()
         WHERE id=$1`,
        [engagement.reporting_set_id]
      )
      await query(`UPDATE engagements SET status='active',updated_at=now() WHERE id=$1`, [id])
      await logAudit(actor, 'engagement.reopened', id, {})
    })
    return { ok: true }
  })
}
