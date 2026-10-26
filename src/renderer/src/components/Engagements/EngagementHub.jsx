import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { formatPeriodDate, formatPeriodRange } from '../../utils/financialPeriodDisplay'
import EngagementReportingPanel from './EngagementReportingPanel'
import FirmSettingsPanel from './FirmSettingsPanel'

const SCOPE_OPTIONS = [
  ['statutory_audit', 'Statutory audit'],
  ['review', 'Review engagement'],
  ['compilation', 'Compilation'],
  ['tax', 'Tax services'],
]
const LEGAL_FORMS = ['Company', 'LLP', 'Partnership', 'Proprietorship', 'Individual', 'Other']
const COMMON_CURRENCIES = ['INR', 'AED', 'USD', 'EUR', 'GBP', 'SAR', 'AUD', 'CAD', 'CHF', 'CNY', 'JPY', 'NZD', 'SGD', 'ZAR']

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-gray-500">{hint}</span>}
      <span className="mt-1 block">{children}</span>
    </label>
  )
}

function Input({ className = '', ...props }) {
  return <input {...props} className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 ${className}`} />
}

function Select({ className = '', children, ...props }) {
  return <select {...props} className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 ${className}`}>{children}</select>
}

function PrimaryButton({ children, ...props }) {
  return <button {...props} className={`rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-40 ${props.className || ''}`}>{children}</button>
}

function ShieldNotice({ children }) {
  return <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">{children}</div>
}

export function AuthGate({ setupRequired, localDevelopment, requireLoginAfterSetup = false, onAuthenticated }) {
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [showSetup, setShowSetup] = useState(setupRequired)
  const [values, setValues] = useState({ firmName: '', displayName: '', email: '', password: '', setupAuthorizationToken: '' })
  const set = (key, value) => setValues(prev => ({ ...prev, [key]: value }))

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)
    try {
      if (showSetup) {
        const user = await window.api.setupEngagementAdmin(values)
        if (requireLoginAfterSetup) {
          await window.api.logoutEngagementUser()
          setShowSetup(false)
          setValues(current => ({ ...current, password: '', setupAuthorizationToken: '' }))
          setMessage('Administrator account created. Sign in with your new account to continue.')
          return
        }
        onAuthenticated(user)
        return
      }
      const user = await window.api.loginEngagementUser(values)
      onAuthenticated(user)
    } catch (err) {
      setError(err.message || 'Unable to authenticate.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-5">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">{showSetup ? 'Secure first-run setup' : 'Firm access'}</p>
        <h2 className="mt-1 text-xl font-bold text-gray-900">{showSetup ? 'Create the firm administrator' : 'Sign in to FSG Bharat'}</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-500">
          {showSetup
            ? localDevelopment
              ? 'Create the first administrator for this firm workspace. After signing in, the administrator can add or invite firm users.'
              : 'The first account becomes the firm administrator. Enter the one-time setup authorization issued by the firm server administrator.'
            : 'Use your firm account to continue to the workspace.'}
        </p>
        {showSetup && (
          <>
            <div className="mt-5"><Field label="Firm name"><Input required autoComplete="organization" value={values.firmName} onChange={e => set('firmName', e.target.value)} /></Field></div>
            <div className="mt-4"><Field label="Administrator name"><Input required autoComplete="name" value={values.displayName} onChange={e => set('displayName', e.target.value)} /></Field></div>
            {!localDevelopment && <div className="mt-4"><Field label="One-time setup authorization"><Input required autoComplete="off" type="password" value={values.setupAuthorizationToken} onChange={e => set('setupAuthorizationToken', e.target.value)} /></Field></div>}
          </>
        )}
        <div className="mt-4"><Field label="Work email"><Input required type="email" autoComplete="username" value={values.email} onChange={e => set('email', e.target.value)} /></Field></div>
        <div className="mt-4"><Field label="Password" hint={showSetup ? 'Use at least 12 characters.' : undefined}><Input required type="password" autoComplete={showSetup ? 'new-password' : 'current-password'} value={values.password} onChange={e => set('password', e.target.value)} /></Field></div>
        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="mt-4 text-sm text-green-700">{message}</p>}
        <PrimaryButton type="submit" disabled={busy} className="mt-5 w-full">{busy ? 'Please wait…' : showSetup ? 'Create administrator' : 'Sign in'}</PrimaryButton>
      </form>
    </div>
  )
}

export function PasswordChange({ user, onChanged }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async event => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await window.api.changeEngagementPassword(password)
      onChanged({ ...user, mustChangePassword: false })
    } catch (err) {
      setError(err.message || 'Unable to update password.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex min-h-full items-center justify-center p-5">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-gray-900">Set a new password</h2>
        <p className="mt-2 text-sm text-gray-500">The temporary password must be replaced before continuing.</p>
        <div className="mt-5"><Field label="New password" hint="At least 12 characters."><Input required minLength={12} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></Field></div>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        <PrimaryButton type="submit" disabled={busy} className="mt-5 w-full">{busy ? 'Saving…' : 'Update password'}</PrimaryButton>
      </form>
    </div>
  )
}

function EngagementList({ user, onCreate, onOpen }) {
  const [scope, setScope] = useState('my')
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRows(await window.api.listEngagements(scope))
    } catch (err) {
      setError(err.message || 'Unable to load engagements.')
    } finally {
      setLoading(false)
    }
  }, [scope, user.role])
  useEffect(() => { load() }, [load])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter(row => (status === 'all' || row.status === status)
      && (!term || [row.client_name, row.reference, row.name, row.accounting_framework, row.owner_name, row.partner_name]
        .some(value => String(value || '').toLowerCase().includes(term))))
  }, [rows, search, status])

  return (
    <div className="mx-auto max-w-7xl p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">Firm workspace</p>
          <h2 className="mt-1 text-2xl font-bold text-gray-900">Engagements</h2>
          <p className="mt-1 text-sm text-gray-500">Your client work, reporting basis, ownership and access in one place.</p>
        </div>
        <PrimaryButton onClick={onCreate}>+ Create engagement</PrimaryButton>
      </div>
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
        Foundation only — desktop clients still connect directly to PostgreSQL, and legacy financial IPC operations do not enforce these engagement permissions. This is not secure firm-wide isolation; a firm-hosted API and migration of legacy operations are required before multi-user production use.
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-gray-200">
        <button onClick={() => setScope('my')} className={`border-b-2 px-3 py-2 text-sm font-medium ${scope === 'my' ? 'border-blue-700 text-blue-800' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>My Engagements</button>
        {['administrator', 'partner'].includes(user.role) && (
          <button onClick={() => setScope('all')} className={`border-b-2 px-3 py-2 text-sm font-medium ${scope === 'all' ? 'border-blue-700 text-blue-800' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>All Engagements</button>
        )}
        <span className="ml-auto text-xs text-gray-500">Signed in as {user.displayName} · {user.jobTitle || user.role}</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <Input className="min-w-[220px] flex-1" aria-label="Search engagements" placeholder="Search client, reference, owner or basis…" value={search} onChange={e => setSearch(e.target.value)} />
        <Select className="w-44" aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All statuses</option><option value="draft">Draft</option><option value="active">Active</option><option value="finalised">Finalised</option><option value="archived">Archived</option>
        </Select>
      </div>

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
        {loading ? <p className="p-8 text-center text-sm text-gray-500">Loading engagements…</p>
          : visible.length === 0 ? <div className="p-10 text-center"><p className="text-sm font-semibold text-gray-800">No engagements found</p><p className="mt-1 text-sm text-gray-500">Create an engagement or adjust your search and filters.</p></div>
            : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>{['Client / engagement', 'Reference', 'Reporting period', 'Basis', 'Owner', 'Partner', 'Status', 'Your access'].map(label => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visible.map(row => (
                      <tr key={row.id} className="cursor-pointer hover:bg-blue-50/40" onClick={() => onOpen(row.id)}>
                        <td className="px-4 py-3"><span className="block font-semibold text-gray-900">{row.client_name}</span><span className="text-xs text-gray-500">{row.name}</span></td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">{row.reference}</td>
                        <td className="px-4 py-3 text-gray-700">{row.period_start && row.period_end ? formatPeriodRange(row.period_start, row.period_end) : 'Not set'}</td>
                        <td className="px-4 py-3"><span className="block text-gray-800">{row.accounting_framework || 'Not selected'}</span><span className="text-xs text-gray-500">{row.trial_balance_currency || '—'} / {row.presentation_currency || '—'}</span></td>
                        <td className="px-4 py-3 text-gray-700">{row.owner_name}</td>
                        <td className="px-4 py-3 text-gray-700">{row.partner_name || 'Unassigned'}</td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${row.status === 'active' ? 'bg-emerald-50 text-emerald-800' : row.status === 'finalised' ? 'bg-violet-50 text-violet-800' : 'bg-gray-100 text-gray-700'}`}>{row.status}</span></td>
                        <td className="px-4 py-3 text-xs text-gray-600">{row.current_access}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </div>

    </div>
  )
}

export function FirmTeam({ user }) {
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ displayName: '', email: '', jobTitle: 'employee' })
  const [createdUser, setCreatedUser] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setUsers(await window.api.listEngagementUsers())
    } catch (err) {
      setError(err.message || 'Unable to load the firm team.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user.role === 'administrator') load()
    else setLoading(false)
  }, [load, user.role])

  const addUser = async event => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setCreatedUser(null)
    try {
      const result = await window.api.createEngagementUser(form)
      setCreatedUser(result)
      setForm({ displayName: '', email: '', jobTitle: 'employee' })
      await load()
    } catch (err) {
      setError(err.message || 'Unable to add the team member.')
    } finally {
      setSaving(false)
    }
  }

  if (user.role !== 'administrator') {
    return <div className="mx-auto max-w-3xl p-5 sm:p-7"><ShieldNotice>Only a firm administrator can manage the firm team.</ShieldNotice></div>
  }

  return (
    <div className="mx-auto max-w-5xl p-5 sm:p-7">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">Settings · Firm Team</p>
        <h2 className="mt-1 text-2xl font-bold text-gray-900">People in your firm</h2>
        <p className="mt-1 text-sm text-gray-500">Add a colleague once, then assign them to the engagements they work on.</p>
      </div>

      <form onSubmit={addUser} className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900">Add a team member</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Full name"><Input required autoComplete="name" value={form.displayName} onChange={event => setForm(current => ({ ...current, displayName: event.target.value }))} /></Field>
          <Field label="Work email"><Input required type="email" autoComplete="email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} /></Field>
          <Field label="Position">
            <Select value={form.jobTitle} onChange={event => setForm(current => ({ ...current, jobTitle: event.target.value }))}>
              <option value="employee">Employee</option>
              <option value="article">Article assistant</option>
              <option value="auditor">Auditor</option>
              <option value="partner">Partner</option>
            </Select>
          </Field>
        </div>
        <p className="mt-3 text-xs text-gray-500">Employee, Article assistant, and Auditor are directory positions. Partner is an application permission role; only the assigned engagement partner or substitute can finalise.</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-xs leading-relaxed text-gray-500">The app creates a temporary password for you to share securely. The colleague must change it at first sign-in. Email invitations are not sent automatically.</p>
          <PrimaryButton type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add member'}</PrimaryButton>
        </div>
      </form>

      {createdUser && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">Share this temporary password securely</p>
        <p className="mt-1 text-xs text-amber-800">{createdUser.user.displayName} · {createdUser.user.email}</p>
        <p className="mt-2 select-all break-all font-mono text-sm text-amber-950">{createdUser.initialPassword}</p>
      </div>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <section className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-3"><h3 className="text-sm font-semibold text-gray-900">Firm team</h3></div>
        {loading ? <p className="p-6 text-center text-sm text-gray-500">Loading team…</p>
          : users.length === 0 ? <p className="p-6 text-center text-sm text-gray-500">No team members have been added.</p>
            : <div className="divide-y divide-gray-100">{users.map(member => <div key={member.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <div><p className="text-sm font-medium text-gray-900">{member.displayName}</p><p className="text-xs text-gray-500">{member.email}</p></div>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs capitalize text-gray-700">{member.jobTitle || member.role}</span>
            </div>)}</div>}
      </section>
    </div>
  )
}

function formFromEngagement(data, currentUserId) {
  const engagement = data.engagement
  const assignedIds = [engagement.owner_user_id, engagement.partner_user_id, engagement.substitute_user_id]
    .filter(Boolean).map(Number)
  return {
    entityId: String(engagement.entity_id),
    name: engagement.name || '',
    reference: engagement.reference || '',
    periodStart: engagement.period_start ? String(engagement.period_start).slice(0, 10) : '',
    periodEnd: engagement.period_end ? String(engagement.period_end).slice(0, 10) : '',
    serviceScope: engagement.service_scope || [],
    reportingPackId: engagement.reporting_pack_id || '',
    jurisdiction: engagement.jurisdiction || '',
    framework: engagement.accounting_framework || '',
    trialBalanceCurrency: engagement.trial_balance_currency || '',
    presentationCurrency: engagement.presentation_currency || '',
    displayScale: engagement.display_scale || 'units',
    decimalPlaces: engagement.decimal_places ?? 2,
    ownerUserId: String(engagement.owner_user_id || currentUserId),
    partnerUserId: engagement.partner_user_id ? String(engagement.partner_user_id) : '',
    substituteUserId: engagement.substitute_user_id ? String(engagement.substitute_user_id) : '',
    participants: (data.members || []).filter(member => !assignedIds.includes(Number(member.user_id)))
      .map(member => ({ userId: Number(member.user_id), accessLevel: member.access_level })),
    status: 'draft',
    separateReason: engagement.separate_reason || '',
    compatibilityConfirmed: !!engagement.compatibility_confirmed,
    legacyConfirmationNote: data.legacyLink?.confirmation_note || '',
  }
}

function CreateEngagement({ user, onCancel, onCreated, onOpen, initialEngagement, onUpdated }) {
  const isEditing = !!initialEngagement
  const linkedPeriodIsFixed = !!initialEngagement?.engagement?.entity_period_id
  const [step, setStep] = useState(0)
  const [options, setOptions] = useState({ entities: [], periods: [], packs: [], users: [] })
  const [form, setForm] = useState(() => initialEngagement
    ? formFromEngagement(initialEngagement, user.id)
    : ({
    entityId: '', name: '', reference: '', periodStart: '', periodEnd: '', serviceScope: [],
    reportingPackId: '', jurisdiction: '', framework: '',
    trialBalanceCurrency: '', presentationCurrency: '', displayScale: 'units', decimalPlaces: 2,
    ownerUserId: String(user.id), partnerUserId: '', substituteUserId: '', participants: [],
    status: 'draft', separateReason: '', compatibilityConfirmed: false, legacyConfirmationNote: '',
  }))
  const [newClient, setNewClient] = useState({ name: '', jurisdiction: '', legalForm: '' })
  const [showNewClientForm, setShowNewClientForm] = useState(false)
  const [creatingClient, setCreatingClient] = useState(false)
  const [duplicates, setDuplicates] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const loadOptions = useCallback(async () => {
    setOptions(await window.api.listEngagementOptions())
  }, [])
  useEffect(() => { loadOptions().catch(err => setError(err.message || 'Unable to load engagement setup data.')) }, [loadOptions])

  const set = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }))
    if (['entityId', 'periodStart', 'periodEnd'].includes(key)) setDuplicates(null)
  }
  const selectedEntity = options.entities.find(entity => String(entity.id) === String(form.entityId))
  const selectedPack = options.packs.find(pack => pack.pack_id === form.reportingPackId)
  const partners = options.users.filter(candidate => candidate.role === 'partner')
  const ownerOptions = ['administrator', 'partner'].includes(user.role) ? options.users : [user]

  const createClient = async () => {
    setError('')
    setCreatingClient(true)
    try {
      const client = await window.api.createEngagementClient(newClient)
      await loadOptions()
      set('entityId', String(client.id))
      setShowNewClientForm(false)
      setCreatingClient(false)
      setNewClient({ name: '', jurisdiction: '', legalForm: '' })
    } catch (err) {
      setError(err.message || 'Unable to create client.')
    } finally {
      setCreatingClient(false)
    }
  }

  const checkMatches = async () => {
    if (!form.entityId || !form.periodStart || !form.periodEnd) { setDuplicates({ visibleMatches: [], restrictedMatch: false }); return }
    try {
      setDuplicates(await window.api.checkEngagementDuplicates({
        entityId: Number(form.entityId), periodStart: form.periodStart, periodEnd: form.periodEnd,
        excludeEngagementId: initialEngagement?.engagement?.id,
      }))
    } catch (err) {
      setError(err.message || 'Unable to check for existing engagements.')
    }
  }

  const toggleScope = key => setForm(prev => ({
    ...prev, serviceScope: prev.serviceScope.includes(key) ? prev.serviceScope.filter(value => value !== key) : [...prev.serviceScope, key],
  }))
  const updateParticipant = (userId, accessLevel) => setForm(prev => {
    const exists = prev.participants.some(participant => Number(participant.userId) === Number(userId))
    return {
      ...prev,
      participants: exists
        ? prev.participants.map(participant => Number(participant.userId) === Number(userId) ? { ...participant, accessLevel } : participant)
        : [...prev.participants, { userId: Number(userId), accessLevel }],
    }
  })
  const removeParticipant = userId => setForm(prev => ({ ...prev, participants: prev.participants.filter(item => Number(item.userId) !== Number(userId)) }))

  const submit = async status => {
    setError('')
    setSaving(true)
    try {
      if (form.periodStart && form.periodEnd && !duplicates) await checkMatches()
      if (duplicates?.restrictedMatch && !form.separateReason.trim()) {
        setError('A restricted matching engagement may exist. Request access or record a reason to create separately.')
        setStep(3)
        return
      }
      if (duplicates?.visibleMatches.length && !form.separateReason.trim()) {
        setError('Review the existing match. Record a reason to create this engagement separately.')
        setStep(3)
        return
      }
      const payload = {
        ...form, entityId: Number(form.entityId), status,
        ownerUserId: Number(form.ownerUserId || user.id),
        partnerUserId: form.partnerUserId ? Number(form.partnerUserId) : null,
        substituteUserId: form.substituteUserId ? Number(form.substituteUserId) : null,
        decimalPlaces: Number(form.decimalPlaces),
      }
      if (isEditing) {
        const result = await window.api.updateEngagementDraft({
          ...payload, engagementId: initialEngagement.engagement.id,
        })
        if (status === 'active') await window.api.activateEngagement({ engagementId: result.id })
        onUpdated(result.id)
      } else {
        const result = await window.api.createEngagement(payload)
        onCreated(result.id)
      }
    } catch (err) {
      setError(err.message || 'Unable to create engagement.')
      setStep(3)
    } finally {
      setSaving(false)
    }
  }

  const activateEligible = selectedPack?.processing_status === 'implemented'
    && form.entityId && form.name.trim() && form.serviceScope.length > 0
    && form.periodStart && form.periodEnd && form.partnerUserId
    && /^[A-Z]{3}$/.test(form.trialBalanceCurrency) && /^[A-Z]{3}$/.test(form.presentationCurrency)
    && form.trialBalanceCurrency === form.presentationCurrency && form.compatibilityConfirmed
  const labels = ['Client & period', 'Reporting basis', 'People & access', 'Review']

  return (
    <div className="mx-auto max-w-5xl p-5 sm:p-7">
      <button onClick={onCancel} className="mb-4 text-sm font-medium text-blue-700 hover:text-blue-900">← Engagements</button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">{isEditing ? 'Draft setup' : 'New work'}</p><h2 className="mt-1 text-2xl font-bold text-gray-900">{isEditing ? 'Complete draft engagement' : 'Create engagement'}</h2></div>
        <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700">Saved as Draft unless activated</span>
      </div>
      <div className="mt-5 grid grid-cols-4 gap-2" aria-label="Engagement setup steps">
        {labels.map((label, index) => <button key={label} onClick={() => { setStep(index); if (index === 3) checkMatches() }} className={`rounded-lg px-3 py-2 text-left text-xs font-semibold ${step === index ? 'bg-blue-700 text-white' : index < step ? 'bg-blue-50 text-blue-800' : 'bg-white text-gray-500 ring-1 ring-gray-200'}`}><span className="mr-1 opacity-70">{index + 1}</span>{label}</button>)}
      </div>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="mt-5 rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
        {step === 0 && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[240px] flex-1"><Field label="Client entity"><Select required disabled={isEditing} value={form.entityId} onChange={e => set('entityId', e.target.value)}><option value="">Select a client…</option>{options.entities.map(entity => <option key={entity.id} value={entity.id}>{entity.name} {entity.jurisdiction ? `· ${entity.jurisdiction}` : '· Legacy setup required'}</option>)}</Select></Field></div>
              {!isEditing && <button onClick={() => setShowNewClientForm(value => !value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">{showNewClientForm ? 'Cancel new client' : '+ Create client'}</button>}
            </div>
            {showNewClientForm && (
              <div className="grid gap-3 rounded-lg bg-gray-50 p-4 sm:grid-cols-3">
                <Field label="Legal client name"><Input value={newClient.name} onChange={e => setNewClient({ ...newClient, name: e.target.value })} /></Field>
                <Field label="Jurisdiction code" hint="Use the ISO 3166-1 alpha-2 code, such as IN, AE or US."><Input required maxLength={2} pattern="[A-Za-z]{2}" value={newClient.jurisdiction} onChange={e => setNewClient({ ...newClient, jurisdiction: e.target.value.toUpperCase() })} /></Field>
                <Field label="Legal form"><Select required value={newClient.legalForm} onChange={e => setNewClient({ ...newClient, legalForm: e.target.value })}><option value="">Choose legal form…</option>{LEGAL_FORMS.map(form => <option key={form}>{form}</option>)}</Select></Field>
                <button onClick={createClient} disabled={!newClient.name.trim() || !/^[A-Za-z]{2}$/.test(newClient.jurisdiction) || !newClient.legalForm || creatingClient} className="sm:col-span-3 justify-self-start rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 disabled:opacity-40">{creatingClient ? 'Creating…' : 'Save client'}</button>
              </div>
            )}
            {selectedEntity && <p className="text-xs text-gray-500">Legal form: {selectedEntity.legal_form || 'Not confirmed'} · Jurisdiction: {selectedEntity.jurisdiction || 'Not confirmed'} · Legacy constitution code: {selectedEntity.constitution} (retained separately for existing statements)</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Engagement name"><Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Annual statutory audit" /></Field>
              <Field label="Reference" hint="Leave blank to assign a unique firm reference automatically."><Input value={form.reference} onChange={e => set('reference', e.target.value)} placeholder="Auto-generated" /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Reporting period start"><Input type="date" disabled={linkedPeriodIsFixed} value={form.periodStart} onChange={e => set('periodStart', e.target.value)} /></Field>
              <Field label="Reporting period end"><Input type="date" disabled={linkedPeriodIsFixed} value={form.periodEnd} onChange={e => set('periodEnd', e.target.value)} /></Field>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">Service scope</p>
              <div className="mt-2 flex flex-wrap gap-3">{SCOPE_OPTIONS.map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.serviceScope.includes(key)} onChange={() => toggleScope(key)} />{label}</label>)}</div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <p className="text-sm leading-relaxed text-gray-600">Select a reporting pack and currencies. A catalogue entry is not proof that its processing engine is implemented.</p>
            <Field label="Reporting pack">
              <Select value={form.reportingPackId} onChange={e => {
                const pack = options.packs.find(item => item.pack_id === e.target.value)
                setForm(prev => ({ ...prev, reportingPackId: e.target.value, jurisdiction: pack?.jurisdiction || '', framework: pack?.framework || '' }))
              }}>
                <option value="">Choose a reporting pack…</option>
                {options.packs.map(pack => <option key={pack.pack_id} value={pack.pack_id}>{pack.jurisdiction} · {pack.framework}{pack.processing_status !== 'implemented' ? ' — not implemented' : ' — legacy workflow'}</option>)}
              </Select>
            </Field>
            {selectedPack && <ShieldNotice>{selectedPack.processing_status === 'implemented' ? 'Existing India workflow selected. Confirm that it is appropriate for this client and engagement; India-specific output is not being asserted as validated for another framework.' : `${selectedPack.framework} is catalogue-only. Drafts may record this basis, but this reporting pack cannot be activated or processed.`}</ShieldNotice>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Trial balance currency" hint="ISO 4217 three-letter code."><Input required maxLength={3} pattern="[A-Za-z]{3}" list="engagement-currency-codes" value={form.trialBalanceCurrency} onChange={e => set('trialBalanceCurrency', e.target.value.toUpperCase())} placeholder="INR" /></Field>
              <Field label="Presentation currency" hint="ISO 4217 three-letter code."><Input required maxLength={3} pattern="[A-Za-z]{3}" list="engagement-currency-codes" value={form.presentationCurrency} onChange={e => set('presentationCurrency', e.target.value.toUpperCase())} placeholder="INR" /></Field>
              <datalist id="engagement-currency-codes">{COMMON_CURRENCIES.map(currency => <option key={currency} value={currency} />)}</datalist>
            </div>
            {form.trialBalanceCurrency && form.presentationCurrency && form.trialBalanceCurrency !== form.presentationCurrency && <ShieldNotice>Currency translation is deferred. Values imported in {form.trialBalanceCurrency} cannot be relabelled as {form.presentationCurrency}; keep this engagement as a Draft until translation is implemented.</ShieldNotice>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display scale"><Select value={form.displayScale} onChange={e => set('displayScale', e.target.value)}><option value="units">Units</option><option value="thousands">Thousands</option><option value="millions">Millions</option></Select></Field>
              <Field label="Decimal places"><Select value={form.decimalPlaces} onChange={e => set('decimalPlaces', e.target.value)}>{[0,1,2,3,4,5,6].map(number => <option key={number} value={number}>{number}</option>)}</Select></Field>
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.compatibilityConfirmed} onChange={e => set('compatibilityConfirmed', e.target.checked)} /><span>I have confirmed the reporting basis and checked that any existing India legacy data is appropriate to link. Unknown legacy ownership/framework will not be inferred.</span></label>
            <Field label="Legacy setup note (optional)" hint="Record setup uncertainty or the basis used to confirm existing period data."><Input value={form.legacyConfirmationNote} onChange={e => set('legacyConfirmationNote', e.target.value)} /></Field>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Engagement owner"><Select value={form.ownerUserId} onChange={e => set('ownerUserId', e.target.value)}>{ownerOptions.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.displayName} · {candidate.role}</option>)}</Select></Field>
              <Field label="Assigned engagement partner"><Select value={form.partnerUserId} onChange={e => set('partnerUserId', e.target.value)}><option value="">Unassigned (Draft only)</option>{partners.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.displayName} · {candidate.email}</option>)}</Select></Field>
              <Field label="Authorised substitute (optional)"><Select value={form.substituteUserId} onChange={e => set('substituteUserId', e.target.value)}><option value="">None</option>{partners.filter(candidate => String(candidate.id) !== form.partnerUserId).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>)}</Select></Field>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">Invite existing firm users</p>
              <p className="mt-1 text-xs text-gray-500">Read/edit access grants engagement visibility and work access only; it never grants finalisation authority.</p>
              <div className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
                {options.users.filter(candidate => Number(candidate.id) !== Number(form.ownerUserId) && Number(candidate.id) !== Number(form.partnerUserId) && Number(candidate.id) !== Number(form.substituteUserId)).map(candidate => {
                  const participant = form.participants.find(item => Number(item.userId) === Number(candidate.id))
                  return <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={!!participant} onChange={e => e.target.checked ? updateParticipant(candidate.id, 'read') : removeParticipant(candidate.id)} /><span>{candidate.displayName}</span><span className="text-xs text-gray-400">{candidate.role}</span></label>
                    {participant && <Select className="w-28 py-1" value={participant.accessLevel} onChange={e => updateParticipant(candidate.id, e.target.value)}><option value="read">Read</option><option value="edit">Edit</option></Select>}
                  </div>
                })}
                {options.users.length <= 1 && <p className="p-3 text-sm text-gray-500">No other firm users are set up yet. An administrator can provision users from the engagement list.</p>}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Summary label="Client" value={selectedEntity?.name || 'Not selected'} />
              <Summary label="Engagement" value={form.name || 'Untitled draft'} />
              <Summary label="Reference" value={form.reference || 'Generated when saved'} />
              <Summary label="Reporting period" value={form.periodStart && form.periodEnd ? formatPeriodRange(form.periodStart, form.periodEnd) : 'Not set (Draft only)'} />
              <Summary label="Service scope" value={SCOPE_OPTIONS.filter(([key]) => form.serviceScope.includes(key)).map(([, label]) => label).join(', ') || 'None selected'} />
              <Summary label="Reporting basis" value={`${form.jurisdiction || '—'} · ${form.framework || 'Not selected'} · ${selectedPack?.processing_status === 'implemented' ? 'legacy engine' : 'not implemented'}`} />
              <Summary label="Currencies" value={`${form.trialBalanceCurrency || '—'} / ${form.presentationCurrency || '—'}`} />
              <Summary label="Owner / partner" value={`${ownerOptions.find(candidate => String(candidate.id) === form.ownerUserId)?.displayName || user.displayName} / ${partners.find(candidate => String(candidate.id) === form.partnerUserId)?.displayName || 'Unassigned'}`} />
              <Summary label="Participants" value={form.participants.map(p => `${options.users.find(candidate => Number(candidate.id) === Number(p.userId))?.displayName || 'Firm user'} (${p.accessLevel})`).join(', ') || 'None'} />
            </div>
            {duplicates && duplicates.visibleMatches.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <h3 className="text-sm font-semibold text-amber-900">Matching engagements are already visible to you</h3>
                <ul className="mt-2 space-y-2">{duplicates.visibleMatches.map(match => <li key={match.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-950"><span>{match.reference} · {match.name} · {match.owner_name} · {match.accounting_framework || 'Basis not set'} · {match.status}</span><button onClick={() => onOpen(match.id)} className="font-semibold text-blue-800 hover:underline">Open existing</button></li>)}</ul>
                {!duplicates.restrictedMatch && <Input className="mt-3" placeholder="Reason for creating a separate engagement (required)" value={form.separateReason} onChange={e => set('separateReason', e.target.value)} />}
              </div>
            )}
            {duplicates?.restrictedMatch && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <h3 className="text-sm font-semibold text-amber-900">A matching engagement may exist</h3>
                <p className="mt-1 text-sm text-amber-900">Its details are restricted. Request access from its owner, or record a reason if this is a separate engagement.</p>
                <div className="mt-3 flex flex-wrap gap-2"><button onClick={async () => {
                  try {
                    const result = await window.api.requestEngagementAccess({ entityId: Number(form.entityId), periodStart: form.periodStart, periodEnd: form.periodEnd })
                    setError(result.message)
                  } catch (err) { setError(err.message || 'Unable to request access.') }
                }} className="rounded-lg border border-amber-400 px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100">Request access</button>
                <Input className="max-w-md" placeholder="Reason for a separate engagement (required to create)" value={form.separateReason} onChange={e => set('separateReason', e.target.value)} /></div>
              </div>
            )}
            {form.periodStart && form.periodEnd && !duplicates && <p className="text-sm text-gray-500">Checking for a duplicate engagement…</p>}
            <ShieldNotice>Legacy financial screens have not yet been migrated to engagement authorization. Opening the existing India workflow from this overview is intentionally disabled until those IPC operations are permission-enforced.</ShieldNotice>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => step === 0 ? onCancel() : setStep(step - 1)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">{step === 0 ? 'Cancel' : 'Back'}</button>
        <div className="flex gap-2">
          {step === 3 && <button disabled={saving} onClick={() => submit('draft')} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">{saving ? 'Saving…' : isEditing ? 'Save changes' : 'Save Draft'}</button>}
          {step < 3 ? <PrimaryButton onClick={async () => { if (step === 2) await checkMatches(); setStep(step + 1) }}>Continue</PrimaryButton>
            : <PrimaryButton disabled={!activateEligible || saving} title={!activateEligible ? 'Complete required parameters and choose an implemented pack to activate.' : undefined} onClick={() => submit('active')}>{saving ? 'Saving…' : isEditing ? 'Save & activate' : 'Create & activate'}</PrimaryButton>}
        </div>
      </div>
    </div>
  )
}

function Summary({ label, value }) {
  return <div><p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p><p className="mt-1 text-sm font-medium text-gray-900">{value}</p></div>
}

function EngagementOverview({ user, id, onBack, onEdit, serviceOnlyMode = false }) {
  const [data, setData] = useState(null)
  const [trialBalanceRefresh, setTrialBalanceRefresh] = useState(0)
  const [options, setOptions] = useState({ users: [] })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [grant, setGrant] = useState({ userId: '', accessLevel: 'read' })
  const [signing, setSigning] = useState({ place: '', date: '' })
  const [legacyNote, setLegacyNote] = useState('')
  const [legacyTbNote, setLegacyTbNote] = useState('')
  const [selectedLegacyTbIds, setSelectedLegacyTbIds] = useState([])

  const load = useCallback(async () => {
    try {
      const [overview, setup] = await Promise.all([window.api.getEngagementOverview(id), window.api.listEngagementOptions()])
      setData(overview)
      setOptions(setup)
      setError('')
    } catch (err) {
      setError(err.message || 'Unable to load engagement.')
    }
  }, [id])
  useEffect(() => { load() }, [load])
  const engagement = data?.engagement
  const memberIds = new Set((data?.members || []).map(member => Number(member.user_id)))
  const candidates = options.users.filter(candidate => !memberIds.has(Number(candidate.id))
    && ![engagement?.owner_user_id, engagement?.partner_user_id, engagement?.substitute_user_id].includes(Number(candidate.id)))

  const action = async fn => {
    setError('')
    setBusy(true)
    try { await fn(); await load() } catch (err) { setError(err.message || 'Operation failed.') } finally { setBusy(false) }
  }
  const toggleLegacyTB = (tbId, checked) => setSelectedLegacyTbIds(current => checked
    ? [...new Set([...current, Number(tbId)])]
    : current.filter(idValue => idValue !== Number(tbId)))
  const periodLabel = engagement?.period_start && engagement?.period_end ? formatPeriodRange(engagement.period_start, engagement.period_end) : 'Not set'

  return (
    <div className="mx-auto max-w-6xl p-5 sm:p-7">
      <button onClick={onBack} className="mb-4 text-sm font-medium text-blue-700 hover:text-blue-900">← Engagements</button>
      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!engagement ? <p className="p-8 text-center text-sm text-gray-500">Loading engagement…</p> : (
        <>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">{engagement.reference} · {engagement.status}</p><h2 className="mt-1 text-2xl font-bold text-gray-900">{engagement.client_name}</h2><p className="mt-1 text-sm text-gray-500">{engagement.name}</p></div>
              <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800">{engagement.accessLevel}{engagement.canEdit ? ' · edit' : ' · view-only'}</span>
            </div>
            <div className="mt-6 grid gap-5 border-t border-gray-100 pt-5 sm:grid-cols-2 lg:grid-cols-4">
              <Summary label="Reporting period" value={periodLabel} />
              <Summary label="Jurisdiction / legal form" value={`${engagement.client_jurisdiction || 'Not confirmed'} · ${engagement.client_legal_form || 'Not confirmed'}`} />
              <Summary label="Reporting basis" value={`${engagement.jurisdiction || '—'} · ${engagement.accounting_framework || 'Not selected'}`} />
              <Summary label="Reporting pack version" value={`${engagement.reporting_pack_id || 'Not selected'} · ${engagement.reporting_pack_version || '—'}`} />
              <Summary label="Trial balance / presentation" value={`${engagement.trial_balance_currency || '—'} / ${engagement.presentation_currency || '—'}`} />
              <Summary label="Display" value={`${engagement.display_scale || 'units'} · ${engagement.decimal_places ?? 2} decimals`} />
              <Summary label="Owner" value={engagement.owner_name} />
              <Summary label="Assigned partner" value={engagement.partner_name || 'Unassigned'} />
              <Summary label="Authorised substitute" value={engagement.substitute_name || 'None'} />
              <Summary label="Service scope" value={(engagement.service_scope || []).join(', ') || 'Not set'} />
              <Summary label="Current access" value={engagement.accessLevel} />
              <Summary label="Legacy data setup" value={data.legacyLink?.confirmation_status || 'No legacy period linked'} />
            </div>
            {data.legacyLink?.confirmation_status === 'needs_confirmation' && (
              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <h3 className="text-sm font-semibold text-amber-900">Existing period data needs setup confirmation</h3>
                <p className="mt-1 text-sm text-amber-900">Review ownership and reporting-basis suitability. Link any listed trial balances that belong to this period before confirming; unrelated records must remain unlinked. No amounts or rows are changed.</p>
                {data.canManageAccess && <div className="mt-3 flex flex-wrap gap-2">
                  <Input className="min-w-[240px] flex-1" placeholder="Record the basis for confirmation" value={legacyNote} onChange={e => setLegacyNote(e.target.value)} />
                  <button disabled={!legacyNote.trim() || busy} onClick={() => action(() => window.api.confirmEngagementLegacyLink({ engagementId: id, note: legacyNote }))} className="rounded-lg border border-amber-400 px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-40">Confirm legacy setup</button>
                </div>}
              </div>
            )}
            {data.canManageAccess && data.unlinkedTrialBalances.length > 0 && (
              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <h3 className="text-sm font-semibold text-amber-900">Unlinked legacy trial balances</h3>
                <p className="mt-1 text-sm text-amber-900">These records have no reporting-period link. They are not automatically associated by date or filename. Select only records you have verified belong to this engagement’s period; amounts and rows remain unchanged.</p>
                <div className="mt-3 divide-y divide-amber-100 rounded-lg border border-amber-200 bg-white">
                  {data.unlinkedTrialBalances.map(tb => <label key={tb.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                    <input type="checkbox" disabled={busy || !engagement.entity_period_id || engagement.status !== 'draft'} checked={selectedLegacyTbIds.includes(Number(tb.id))} onChange={e => toggleLegacyTB(tb.id, e.target.checked)} />
                    <span className="min-w-[180px] flex-1 font-medium text-gray-800">{tb.filename || `Trial Balance #${tb.id}`}</span>
                    <span className="text-xs text-gray-500">{tb.period || 'Period unknown'} · {tb.row_count || 0} rows</span>
                  </label>)}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Input className="min-w-[240px] flex-1" placeholder="Why these selected TBs belong to this period" value={legacyTbNote} onChange={e => setLegacyTbNote(e.target.value)} />
                  <button disabled={!selectedLegacyTbIds.length || !legacyTbNote.trim() || busy || !engagement.entity_period_id || engagement.status !== 'draft'} onClick={() => action(async () => {
                    await window.api.linkEngagementLegacyTrialBalances({ engagementId: id, trialBalanceIds: selectedLegacyTbIds, note: legacyTbNote })
                    setSelectedLegacyTbIds([])
                    setLegacyTbNote('')
                  })} className="rounded-lg border border-amber-400 px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-40">Link selected to this period</button>
                </div>
                {!engagement.entity_period_id && <p className="mt-2 text-xs text-amber-800">Set a reporting period in Draft setup before linking legacy trial balances.</p>}
              </div>
            )}
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-center justify-between"><h3 className="font-semibold text-gray-900">Participants & access</h3>{data.canManageAccess && <span className="text-xs text-gray-500">Owner/admin controls</span>}</div>
              <div className="mt-3 divide-y divide-gray-100">
                {data.members.map(member => <div key={member.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2"><div><p className="text-sm font-medium text-gray-800">{member.display_name} <span className="text-xs font-normal text-gray-400">· {member.role}</span></p><p className="text-xs text-gray-500">{member.email}</p></div><div className="flex items-center gap-2"><span className="text-xs capitalize text-gray-600">{member.access_level}</span>{data.canManageAccess && ![engagement.owner_user_id, engagement.partner_user_id, engagement.substitute_user_id].includes(Number(member.user_id)) && <><select aria-label={`Access for ${member.display_name}`} disabled={busy} value={member.access_level} onChange={e => action(() => window.api.updateEngagementAccess({ engagementId: id, userId: member.user_id, accessLevel: e.target.value }))} className="rounded border border-gray-300 px-2 py-1 text-xs"><option value="read">Read</option><option value="edit">Edit</option></select><button aria-label={`Remove access for ${member.display_name}`} title="Remove access" disabled={busy} onClick={() => action(() => window.api.updateEngagementAccess({ engagementId: id, userId: member.user_id, remove: true }))} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-40">Remove</button></>}</div></div>)}
              </div>
              {data.canManageAccess && <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-4"><Select className="min-w-[180px] flex-1" aria-label="Firm user to add" value={grant.userId} onChange={e => setGrant({ ...grant, userId: e.target.value })}><option value="">Select firm user…</option>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.displayName} · {candidate.email}</option>)}</Select><Select className="w-28" value={grant.accessLevel} onChange={e => setGrant({ ...grant, accessLevel: e.target.value })}><option value="read">Read</option><option value="edit">Edit</option></Select><button disabled={!grant.userId || busy} onClick={() => action(() => window.api.updateEngagementAccess({ engagementId: id, userId: Number(grant.userId), accessLevel: grant.accessLevel }))} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 disabled:opacity-40">Grant access</button></div>}
              {data.canManageAccess && data.requests.length > 0 && <div className="mt-5 border-t border-gray-100 pt-4"><h4 className="text-sm font-semibold text-gray-800">Pending requests</h4>{data.requests.map(request => <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span>{request.display_name} · {request.email}</span><span className="flex gap-2"><button disabled={busy} onClick={() => action(() => window.api.resolveEngagementAccessRequest({ engagementId: id, requestId: request.id, decision: 'approved', accessLevel: 'read' }))} className="text-blue-700 hover:underline">Approve read</button><button disabled={busy} onClick={() => action(() => window.api.resolveEngagementAccessRequest({ engagementId: id, requestId: request.id, decision: 'declined' }))} className="text-gray-500 hover:underline">Decline</button></span></div>)}</div>}
            </section>
            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-gray-900">Status & workflow</h3>{engagement.status === 'draft' && engagement.canEdit && <button onClick={() => onEdit(data)} className="text-sm font-semibold text-blue-700 hover:text-blue-900">Edit draft</button>}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {engagement.status === 'draft' && engagement.canEdit && <button disabled={busy} onClick={() => action(() => window.api.activateEngagement({ engagementId: id }))} className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Activate engagement</button>}
                {engagement.status === 'active' && engagement.canFinalise && <><div className="w-full grid gap-2 sm:grid-cols-2"><Field label="Signing place"><Input value={signing.place} onChange={e => setSigning({ ...signing, place: e.target.value })} /></Field><Field label="Signing date"><Input type="date" value={signing.date} onChange={e => setSigning({ ...signing, date: e.target.value })} /></Field></div><button disabled={busy || !signing.place || !signing.date} onClick={() => action(() => window.api.finaliseEngagement({ engagementId: id, ...signing }))} className="rounded-lg bg-violet-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Finalise</button></>}
                {engagement.status === 'finalised' && engagement.canFinalise && <button disabled={busy} onClick={() => action(() => window.api.reopenEngagement(id))} className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-40">Reopen engagement</button>}
              </div>
              <ShieldNotice>India legacy workflow entry is disabled here. Existing financial IPC operations are not yet permission-enforced; using them from an engagement view would bypass this access model.</ShieldNotice>
            </section>
          </div>

          {serviceOnlyMode && <>
            <ProtectedTrialBalancePanel engagement={engagement} onImported={() => setTrialBalanceRefresh(value => value + 1)} />
            <EngagementReportingPanel engagement={engagement} user={user} trialBalanceRefresh={trialBalanceRefresh} />
          </>}

          <section className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="font-semibold text-gray-900">Engagement history</h3>
            {data.history.length ? <ol className="mt-3 divide-y divide-gray-100">{data.history.map((entry, index) => {
              const createdAt = new Date(entry.created_at)
              const detailText = Object.entries(entry.details || {}).map(([key, value]) => `${key}: ${value}`).join(' · ')
              return <li key={`${entry.created_at}-${index}`} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span className="text-gray-800">{entry.action.replaceAll('.', ' ')} <span className="text-gray-500">by {entry.actor_name || 'former user'}</span>{detailText && <span className="ml-2 text-xs text-gray-500">{detailText}</span>}</span><time className="text-xs text-gray-400">{`${formatPeriodDate(createdAt.toISOString().slice(0, 10))} ${createdAt.toLocaleTimeString()}`}</time></li>
            })}</ol> : <p className="mt-2 text-sm text-gray-500">No history recorded yet.</p>}
          </section>
        </>
      )}
    </div>
  )
}

function ProtectedTrialBalancePanel({ engagement, onImported }) {
  const [trialBalances, setTrialBalances] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [page, setPage] = useState(0)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pageSize = 500
  const canImport = engagement.canEdit && engagement.status !== 'finalised' && engagement.status !== 'archived'
    && !engagement.locked && !engagement.is_final

  const loadTrialBalances = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await window.api.listEngagementTrialBalances(engagement.id)
      setTrialBalances(rows)
      setSelectedId(current => rows.some(row => String(row.id) === current) ? current : String(rows[0]?.id || ''))
      setError('')
    } catch (loadError) {
      setError(loadError.message || 'Unable to load this engagement’s trial balances.')
    } finally {
      setLoading(false)
    }
  }, [engagement.id])

  useEffect(() => { loadTrialBalances() }, [loadTrialBalances])

  const loadRows = useCallback(async () => {
    if (!selectedId) { setResult(null); return }
    setLoading(true)
    try {
      const data = await window.api.getEngagementTrialBalanceRows({
        engagementId: engagement.id,
        trialBalanceId: Number(selectedId),
        offset: page * pageSize,
        limit: pageSize,
      })
      setResult(data)
      setError('')
    } catch (loadError) {
      setResult(null)
      setError(loadError.message || 'Unable to load trial-balance rows.')
    } finally {
      setLoading(false)
    }
  }, [engagement.id, page, pageSize, selectedId])

  useEffect(() => { loadRows() }, [loadRows])

  const importFile = async () => {
    setBusy(true)
    setError('')
    try {
      const imported = await window.api.importEngagementTrialBalance({ engagementId: engagement.id })
      if (imported?.cancelled) return
      await loadTrialBalances()
      setSelectedId(String(imported.trialBalance.id))
      setPage(0)
      onImported?.()
    } catch (importError) {
      setError(importError.message || 'Trial Balance import failed.')
    } finally {
      setBusy(false)
    }
  }

  const number = value => value == null ? '' : Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const activeTB = trialBalances.find(row => String(row.id) === selectedId)

  return (
    <section className="mt-5 rounded-xl border border-blue-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900">Trial Balance</h3>
          <p className="mt-1 text-sm text-gray-500">Protected engagement import and read-only inspection. Mapping, journals and reporting remain disabled in service-only mode.</p>
        </div>
        {canImport && <button disabled={busy} onClick={importFile} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{busy ? 'Importing…' : '+ Import Excel'}</button>}
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-gray-700" htmlFor="engagement-tb-select">Imported trial balances</label>
        <select id="engagement-tb-select" value={selectedId} onChange={event => { setSelectedId(event.target.value); setPage(0) }} disabled={loading || trialBalances.length === 0} className="min-w-[260px] rounded-lg border border-gray-300 px-3 py-2 text-sm">
          {!trialBalances.length && <option value="">No trial balance imported or linked</option>}
          {trialBalances.map(tb => <option key={tb.id} value={tb.id}>{tb.source_filename || tb.filename} · {tb.row_count} rows</option>)}
        </select>
        {activeTB && <span className="text-xs text-gray-500">{activeTB.source_type === 'service_import' ? 'Service import' : 'Explicit legacy link'} · {activeTB.imported_at ? new Date(activeTB.imported_at).toLocaleString() : ''}</span>}
      </div>
      {activeTB?.source_sha256 && <p className="mt-2 break-all text-xs text-gray-500">Source SHA-256: {activeTB.source_sha256}</p>}
      {activeTB && <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
        <span>{result?.totalRows ?? activeTB.row_count} ledger rows{result?.totalRows > 0 ? ` · ${page * pageSize + 1}–${Math.min((page + 1) * pageSize, result.totalRows)}` : ''}</span>
        <div className="flex gap-2">
          <button disabled={page === 0 || loading} onClick={() => setPage(value => Math.max(0, value - 1))} className="rounded border px-2 py-1 disabled:opacity-40">Previous</button>
          <button disabled={loading || !result || (page + 1) * pageSize >= result.totalRows} onClick={() => setPage(value => value + 1)} className="rounded border px-2 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>}
      {activeTB && <div className="mt-2 max-h-[420px] overflow-auto rounded-lg border border-gray-200">
        <table className="min-w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-gray-50 text-gray-600"><tr>
            <th className="px-3 py-2">Period</th><th className="px-3 py-2">Ledger code</th><th className="px-3 py-2">Ledger</th>
            <th className="px-3 py-2 text-right">Opening</th><th className="px-3 py-2 text-right">Debit</th>
            <th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Closing</th>
            <th className="px-3 py-2">Parent</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {(result?.rows || []).map(row => <tr key={row.id} className="text-gray-700">
              <td className="whitespace-nowrap px-3 py-2">{row.period}</td><td className="px-3 py-2">{row.ledger_code}</td>
              <td className="min-w-[220px] px-3 py-2">{row.name}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right">{number(row.opening_balance)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right">{number(row.debit)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right">{number(row.credit)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right">{number(row.closing_balance)}</td>
              <td className="min-w-[160px] px-3 py-2">{row.parent || row.group_parent}</td>
            </tr>)}
            {!loading && result?.rows.length === 0 && <tr><td colSpan="8" className="px-3 py-6 text-center text-gray-500">No ledger rows in this trial balance.</td></tr>}
          </tbody>
        </table>
        {loading && <p className="p-4 text-center text-xs text-gray-500">Loading trial-balance rows…</p>}
      </div>}
    </section>
  )
}

export default function EngagementHub({ user, initialView = 'engagements', serviceOnlyMode = false }) {
  const [screen, setScreen] = useState({ type: 'list' })
  const [section, setSection] = useState(initialView === 'team' ? 'team' : 'engagements')
  const [error, setError] = useState('')
  if (!user) return <div role="alert" className="p-6 text-sm text-red-700">Sign in to access firm settings.</div>

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-gray-50">
      <nav aria-label="Firm workspace" className="sticky top-0 z-10 flex shrink-0 items-center gap-1 border-b border-gray-200 bg-white px-4 py-2 shadow-sm">
        <button type="button" aria-current={section === 'engagements' ? 'page' : undefined}
          onClick={() => setSection('engagements')}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${section === 'engagements' ? 'bg-blue-50 text-blue-800' : 'text-gray-600 hover:bg-gray-50'}`}>Engagements</button>
        {user.role === 'administrator' && <button type="button" aria-current={section === 'firm-settings' ? 'page' : undefined}
          onClick={() => setSection('firm-settings')}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${section === 'firm-settings' ? 'bg-blue-50 text-blue-800' : 'text-gray-600 hover:bg-gray-50'}`}>Firm Settings</button>}
        <button type="button" aria-current={section === 'team' ? 'page' : undefined}
          onClick={() => setSection('team')}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${section === 'team' ? 'bg-blue-50 text-blue-800' : 'text-gray-600 hover:bg-gray-50'}`}>Firm Team</button>
      </nav>
      <main className="min-h-0 flex-1">
        {section === 'firm-settings' && user.role === 'administrator' && <FirmSettingsPanel user={user} />}
        {section === 'team' && <div className="mx-auto max-w-6xl p-5 sm:p-7"><FirmTeam user={user} /></div>}
        {section === 'engagements' && <>
          {screen.type === 'list' && <EngagementList user={user} onCreate={() => { setError(''); setScreen({ type: 'create' }) }} onOpen={id => { setError(''); setScreen({ type: 'overview', id }) }} />}
          {(screen.type === 'create' || screen.type === 'edit') && <CreateEngagement
            user={user}
            initialEngagement={screen.type === 'edit' ? screen.initialEngagement : null}
            onCancel={() => setScreen({ type: 'list' })}
            onCreated={id => setScreen({ type: 'overview', id })}
            onUpdated={id => setScreen({ type: 'overview', id })}
            onOpen={id => setScreen({ type: 'overview', id })}
          />}
          {screen.type === 'overview' && <EngagementOverview
            user={user}
            id={screen.id}
            serviceOnlyMode={serviceOnlyMode}
            onBack={() => setScreen({ type: 'list' })}
            onEdit={data => setScreen({ type: 'edit', initialEngagement: data })}
          />}
        </>}
      </main>
    </div>
  )
}
