import { randomBytes, pbkdf2, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import {
  canEditEngagement, canFinaliseEngagement, canViewEngagement,
  isValidDateOnly, validateActivation, validateEngagementDraft,
} from '../services/engagement-domain.js'

let query
let runInTransaction
const derivePassword = promisify(pbkdf2)
const sessions = new Map()
const PASSWORD_ITERATIONS = 310000
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000
const BOOTSTRAP_LOCK = 517203841

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return typeof value === 'string' ? value.slice(0, 10) : ''
}

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256) {
    throw new Error('Password must be between 12 and 256 characters.')
  }
}

async function passwordRecord(password, salt = randomBytes(16).toString('hex')) {
  validatePassword(password)
  const hash = await derivePassword(password, Buffer.from(salt, 'hex'), PASSWORD_ITERATIONS, 32, 'sha256')
  return { salt, hash: hash.toString('hex') }
}

async function verifyPassword(password, salt, expectedHex) {
  if (typeof password !== 'string' || password.length > 256) return false
  const actual = await derivePassword(String(password || ''), Buffer.from(salt, 'hex'), PASSWORD_ITERATIONS, 32, 'sha256')
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function publicUser(row) {
  return {
    id: Number(row.id),
    firmId: Number(row.firm_id),
    email: row.email,
    displayName: row.display_name,
    role: row.role,
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
    `SELECT id,firm_id,email,display_name,role,professional_signatory_id,must_change_password
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
    `SELECT e.*, en.name AS client_name, en.constitution_display, en.jurisdiction AS client_jurisdiction,
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

async function attachEntityPeriod(entityId, start, end, name) {
  if (!start || !end) return { entityPeriodId: null, existingWork: false }
  const label = String(name || '').trim() || `Period ${start.slice(0, 4)}`
  const { rows: [fp] } = await query(
    `INSERT INTO financial_periods (year_label, date_from, date_till)
     VALUES ($1,$2,$3)
     ON CONFLICT (date_from, date_till) DO UPDATE SET year_label=financial_periods.year_label
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

  ipcMain.handle('engagementAuth:status', async (event) => {
    const { rows: [result] } = await query(
      `SELECT EXISTS(SELECT 1 FROM firm_users WHERE role='administrator') AS configured`
    )
    const session = sessions.get(event.sender.id)
    let user = null
    if (session && session.expiresAt > Date.now()) {
      const { rows: [activeUser] } = await query(
        `SELECT id,firm_id,email,display_name,role,professional_signatory_id,must_change_password
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
    const { salt, hash } = await passwordRecord(input.password)
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
        `INSERT INTO firm_users (firm_id,email,display_name,password_salt,password_hash,role)
         VALUES ($1,$2,$3,$4,$5,'administrator') RETURNING *`,
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
    if (!row || !(await verifyPassword(input.password, row.password_salt, row.password_hash))) {
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
    const { salt, hash } = await passwordRecord(password)
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
      `SELECT id,firm_id,email,display_name,role,professional_signatory_id,must_change_password
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
    const role = input.role
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid user email.')
    if (!name) throw new Error('User name is required.')
    if (!['partner', 'staff'].includes(role)) throw new Error('Choose a valid firm role.')
    const initialPassword = randomBytes(24).toString('hex')
    const { salt, hash } = await passwordRecord(initialPassword)
    const row = await runInTransaction(async () => {
      const { rows: [created] } = await query(
        `INSERT INTO firm_users (firm_id,email,display_name,password_salt,password_hash,role,must_change_password)
         VALUES ($1,$2,$3,$4,$5,$6,TRUE)
         RETURNING id,firm_id,email,display_name,role,professional_signatory_id,must_change_password`,
        [actor.firmId, email, name, salt, hash, role]
      )
      await logAudit(actor, 'user.created', null, { userId: Number(created.id), email, role })
      return created
    })
    return { user: publicUser(row), initialPassword }
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
    const { rows: periods } = await query(`SELECT id,year_label,date_from,date_till FROM financial_periods ORDER BY date_from DESC`)
    const { rows: packs } = await query(`SELECT * FROM reporting_pack_catalog ORDER BY jurisdiction,framework`)
    const { rows: users } = await query(
      `SELECT id,email,display_name,role FROM firm_users WHERE firm_id=$1 AND active=TRUE ORDER BY display_name`,
      [user.firmId]
    )
    return { entities, periods, packs, users }
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
      const attached = await attachEntityPeriod(entityId, input.periodStart, input.periodEnd, periodName)
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
        const attached = await attachEntityPeriod(engagement.entity_id, periodStart, periodEnd, input.name)
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
