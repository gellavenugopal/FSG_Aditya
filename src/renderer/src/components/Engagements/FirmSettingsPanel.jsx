import React, { useCallback, useEffect, useState } from 'react'

const EMPTY_FIRM = {
  id: '',
  firmName: '',
  frn: '',
  pan: '',
  address: '',
  email: '',
  phone: '',
  websiteUrl: '',
  profileStatus: 'standard',
  sourceUrls: [],
  sourceRetrievedAt: '',
  createSeparateProfile: false,
  isActive: true,
  logoMimeType: '',
  logoBase64: '',
  clearLogo: false,
}
const EMPTY_OFFICE = { id: '', auditorFirmId: '', officeName: '', address: '', phone: '', email: '', sourceUrl: '', sourceRetrievedAt: '', isActive: true }
const DEFAULT_APPEARANCE = {
  displayName: 'FSG Bharat', logoMimeType: '', logoBase64: '',
  primaryColor: '#243746', accentColor: '#189CD8', navigationColor: '#243746',
  backgroundColor: '#FFFFFF', textColor: '#243746',
  fontFamily: 'Tahoma', fontFallback: 'Arial, sans-serif',
  baseFontSize: 14, headingFontSize: 20, headingWeight: 700, density: 'comfortable',
}
const luminance = hex => [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
  .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
const contrast = (first, second) => {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}
function appearanceWarnings(appearance) {
  const warnings = []
  if (contrast(appearance.textColor, appearance.backgroundColor) < 4.5) warnings.push('Text/background contrast must be at least 4.5:1.')
  if (contrast('#FFFFFF', appearance.primaryColor) < 4.5) warnings.push('Primary action colour must support white text at 4.5:1.')
  if (contrast('#FFFFFF', appearance.navigationColor) < 4.5) warnings.push('Navigation colour must support white text at 4.5:1.')
  if (contrast(appearance.accentColor, appearance.backgroundColor) < 3) warnings.push('Accent/background contrast must be at least 3:1 for visible controls.')
  return warnings
}
const DEFAULT_REPORT_STYLE = {
  fontFamily: 'Tahoma', fontFallback: 'Arial, sans-serif', bodyFontSize: 10, headingFontSize: 14,
  headingWeight: 700, logoPlacement: 'top-center', logoWidthMm: 45, headerText: '', footerText: '',
  tableHeaderColor: '#1e40af', tableHeaderTextColor: '#ffffff', tableStripeColor: '#f3f4f6',
  pageSize: 'A4', pageOrientation: 'portrait', pageMarginMm: 15,
}

function TextField({ label, value, onChange, ...props }) {
  return <label className="block">
    <span className="mb-1 block text-xs font-medium text-gray-700">{label}</span>
    <input {...props} value={value || ''} onChange={event => onChange(event.target.value)}
      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
  </label>
}

function TextBox({ label, value, onChange, ...props }) {
  return <label className="block">
    <span className="mb-1 block text-xs font-medium text-gray-700">{label}</span>
    <textarea {...props} value={value || ''} onChange={event => onChange(event.target.value)}
      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
  </label>
}

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Unable to read the selected logo file.'))
    reader.onload = () => {
      const result = String(reader.result || '')
      const separator = result.indexOf(',')
      if (separator < 0) {
        reject(new Error('The selected logo file could not be encoded.'))
        return
      }
      resolve(result.slice(separator + 1))
    }
    reader.readAsDataURL(file)
  })
}

function firmFromRow(row) {
  return {
    ...EMPTY_FIRM,
    id: String(row.id),
    firmName: row.firm_name || '',
    frn: row.frn || '',
    pan: row.pan || '',
    address: row.address || '',
    email: row.email || '',
    phone: row.phone || '',
    websiteUrl: row.website_url || '',
    profileStatus: row.profile_status || 'standard',
    sourceUrls: Array.isArray(row.source_urls) ? row.source_urls : [],
    sourceRetrievedAt: row.source_retrieved_at || '',
    isActive: row.is_active !== false,
    logoMimeType: row.logo_mime_type || '',
    logoBase64: row.logo_base64 || '',
  }
}

export default function FirmSettingsPanel({ user }) {
  const [data, setData] = useState({ professionalFirms: [], availableProfessionalFirms: [], offices: [], partners: [], canManage: false })
  const [selectedFirmId, setSelectedFirmId] = useState('')
  const [firm, setFirm] = useState(EMPTY_FIRM)
  const [office, setOffice] = useState(EMPTY_OFFICE)
  const [partnerValues, setPartnerValues] = useState({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [appearance, setAppearance] = useState(DEFAULT_APPEARANCE)
  const [savedAppearance, setSavedAppearance] = useState(DEFAULT_APPEARANCE)
  const [reportStyles, setReportStyles] = useState([])
  const [styleName, setStyleName] = useState('Default report style')
  const [reportStyle, setReportStyle] = useState(DEFAULT_REPORT_STYLE)
  const [savedReportStyle, setSavedReportStyle] = useState(DEFAULT_REPORT_STYLE)
  const [savedStyleName, setSavedStyleName] = useState('Default report style')
  const [previewFormat, setPreviewFormat] = useState('PDF')
  const [publicPreview, setPublicPreview] = useState(null)
  const [fetchingPublic, setFetchingPublic] = useState(false)
  const [cachedLogo, setCachedLogo] = useState(null)

  const load = useCallback(async (preferredId = '') => {
    setLoading(true)
    setError('')
    try {
      const [result, appearanceResult, styles] = await Promise.all([
        window.api.getEngagementFirmSettings(),
        window.api.getFirmAppearance(),
        window.api.listFirmReportStyles(),
      ])
      setData(result)
      setAppearance(appearanceResult.settings || DEFAULT_APPEARANCE)
      setSavedAppearance(appearanceResult.settings || DEFAULT_APPEARANCE)
      setReportStyles(styles || [])
      const currentStyle = styles?.[0]
      setReportStyle(currentStyle?.settings || DEFAULT_REPORT_STYLE)
      setSavedReportStyle(currentStyle?.settings || DEFAULT_REPORT_STYLE)
      setStyleName(currentStyle?.name || 'Default report style')
      setSavedStyleName(currentStyle?.name || 'Default report style')
      setPartnerValues(Object.fromEntries(result.partners.map(item => [item.id, {
        qualification: item.qualification || '',
        registrationNumber: item.registration_number || '',
        isActive: item.active !== false,
      }])))
      const currentId = preferredId && result.professionalFirms.some(item => String(item.id) === preferredId)
        ? preferredId
        : selectedFirmId && result.professionalFirms.some(item => String(item.id) === selectedFirmId)
          ? selectedFirmId : String(result.professionalFirms[0]?.id || '')
      setSelectedFirmId(currentId)
      if (currentId) {
        const selected = result.professionalFirms.find(item => String(item.id) === currentId)
        setFirm(firmFromRow(selected))
        setOffice(current => current.id && result.offices.some(item => String(item.id) === current.id)
          ? current : { ...EMPTY_OFFICE, auditorFirmId: currentId })
      } else {
        setFirm(EMPTY_FIRM)
        setOffice({ ...EMPTY_OFFICE, auditorFirmId: '' })
      }
    } catch (loadError) {
      setError(loadError.message || 'Unable to load firm settings.')
    } finally {
      setLoading(false)
    }
  }, [selectedFirmId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let active = true
    if (!firm.id) { setCachedLogo(null); return undefined }
    window.api.getCachedFirmLogo(firm.id)
      .then(result => { if (active) setCachedLogo(result) })
      .catch(() => { if (active) setCachedLogo(null) })
    return () => { active = false }
  }, [firm.id, user.firmId])

  const saveFirm = async event => {
    event.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)
    try {
      const officeDraft = office
      const saved = await window.api.saveEngagementProfessionalFirm(firm)
      setSelectedFirmId(String(saved.id))
      setOffice(current => ({ ...current, auditorFirmId: String(saved.id) }))
      setMessage('Firm details and branding saved.')
      await load(String(saved.id))
      if (officeDraft.officeName || officeDraft.address) {
        setOffice({ ...officeDraft, auditorFirmId: String(saved.id) })
      }
    } catch (saveError) {
      setError(saveError.message || 'Unable to save firm details.')
    } finally {
      setBusy(false)
    }
  }

  const saveOffice = async event => {
    event.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)
    try {
      await window.api.saveEngagementFirmOffice(office)
      setOffice({ ...EMPTY_OFFICE, auditorFirmId: selectedFirmId })
      setMessage('Office saved.')
      await load()
    } catch (saveError) {
      setError(saveError.message || 'Unable to save office.')
    } finally {
      setBusy(false)
    }
  }

  const savePartner = async partnerId => {
    setError('')
    setMessage('')
    setBusy(true)
    try {
      await window.api.saveEngagementPartnerProfile({ partnerId, ...partnerValues[partnerId] })
      setMessage('Partner profile saved.')
      await load()
    } catch (saveError) {
      setError(saveError.message || 'Unable to save partner profile.')
    } finally {
      setBusy(false)
    }

    const fetchPublicPreview = async () => {
      setError('')
      setMessage('')
      setFetchingPublic(true)
      try {
        const response = await window.api.fetchPublicFirmProfilePreview({ websiteUrl: firm.websiteUrl || 'https://www.krestonmenon.com/' })
        setPublicPreview(response)
        setMessage(`Public details fetched ${new Date(response.preview.retrievedAt).toLocaleString()}. Review every field before applying.`)
      } catch (fetchError) {
        setError(fetchError.message || 'Unable to fetch public firm details.')
      } finally {
        setFetchingPublic(false)
      }
    }

    const applyPublicPreview = () => {
      if (!publicPreview) return
      const hasDraftContent = firm.id || firm.firmName.trim() || firm.address.trim() || firm.email.trim()
      if (hasDraftContent && !window.confirm('Start a new Kreston Menon demo-profile draft? Your current form edits will not be saved or overwritten.')) return
      const preview = publicPreview.preview
      setSelectedFirmId('')
      setFirm({
        ...EMPTY_FIRM,
        firmName: preview.firmName,
        address: preview.address,
        email: preview.email,
        phone: preview.phone,
        websiteUrl: preview.websiteUrl,
        profileStatus: 'demo',
        sourceUrls: preview.sourceUrls,
        sourceRetrievedAt: preview.retrievedAt,
        createSeparateProfile: true,
        logoMimeType: publicPreview.logoMimeType,
        logoBase64: publicPreview.logoBase64,
      })
      setOffice({
        ...EMPTY_OFFICE,
        officeName: preview.office.officeName,
        address: preview.office.address,
        phone: preview.office.phone,
        email: preview.office.email,
        sourceUrl: preview.office.sourceUrl,
        sourceRetrievedAt: preview.retrievedAt,
      })
      setMessage('An editable Kreston Menon draft is ready. Save creates a separate firm record; no signing partner or registration credential was inferred.')
    }

    const saveAppearance = async () => {
      setBusy(true); setError(''); setMessage('')
      try {
        const result = await window.api.saveFirmAppearance({ settings: appearance })
        setAppearance(result.settings); setSavedAppearance(result.settings)
        window.dispatchEvent(new CustomEvent('fsg:appearance-updated', { detail: result.settings }))
        setMessage('Application appearance saved for this authenticated firm.')
      } catch (saveError) { setError(saveError.message || 'Unable to save appearance.') }
      finally { setBusy(false) }
    }

    const saveReportStyle = async () => {
      setBusy(true); setError(''); setMessage('')
      try {
        const saved = await window.api.saveFirmReportStyle({ name: styleName, settings: reportStyle })
        setReportStyles(current => [saved, ...current])
        setReportStyle(saved.settings); setSavedReportStyle(saved.settings)
        setStyleName(saved.name); setSavedStyleName(saved.name)
        setMessage(`Saved immutable report style version ${saved.version}. Select it for an engagement in Reports and Exports.`)
      } catch (saveError) { setError(saveError.message || 'Unable to save report style.') }
      finally { setBusy(false) }
    }
  }

  const updateFirm = (key, value) => setFirm(current => ({ ...current, [key]: value }))
  const updateOffice = (key, value) => setOffice(current => ({ ...current, [key]: value }))
  const updatePartner = (id, key, value) => setPartnerValues(current => ({
    ...current,
    [id]: { ...current[id], [key]: value },
  }))
  const updateAppearance = (key, value) => setAppearance(current => ({ ...current, [key]: value }))
  const updateStyle = (key, value) => setReportStyle(current => ({ ...current, [key]: value }))
  const selectedOfficeFirm = data.professionalFirms.find(item => String(item.id) === selectedFirmId)
  const offices = data.offices.filter(item => String(item.auditor_firm_id) === selectedFirmId)
  const partnerLabel = item => `${item.display_name} · ${item.email}${item.active ? '' : ' · inactive'}`
  const appearanceContrastIssues = appearanceWarnings(appearance)

  return (
    <div className="mx-auto max-w-6xl p-5 sm:p-7">
      <header className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">Settings</p>
        <h2 className="mt-1 text-2xl font-bold text-gray-900">Firm settings</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">Maintain the existing auditor firm and partner records used by engagement reports. Saved report outputs retain the exact details and logo used when generated.</p>
      </header>
      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
      {loading && <p className="mb-4 text-sm text-gray-500">Loading firm records…</p>}
      {!data.canManage && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Firm master edits are restricted to administrators. Your assigned engagement partner and current reporting details remain available to you.</p>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-semibold text-gray-900">Professional firm</h3>
              <p className="mt-1 text-xs text-gray-500">Reusable firm and office masters are separate from client entities, engagement membership and signing authority.</p>
            </div>
            <button type="button" onClick={() => { setFirm(EMPTY_FIRM); setSelectedFirmId('') }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700" disabled={!data.canManage}>+ New firm</button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-gray-700">Existing firm</span>
              <select value={firm.id || ''} disabled={!data.canManage} onChange={event => {
                const id = event.target.value
                const linked = data.professionalFirms.find(item => String(item.id) === id)
                const available = data.availableProfessionalFirms.find(item => String(item.id) === id)
                setSelectedFirmId(linked ? id : '')
                setFirm(linked ? firmFromRow(linked) : available ? { ...firmFromRow(available), id } : EMPTY_FIRM)
                setOffice({ ...EMPTY_OFFICE, auditorFirmId: id })
              }} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">New professional firm…</option>
                {data.professionalFirms.map(item => <option key={`linked-${item.id}`} value={item.id}>{item.firm_name} · {item.frn || 'No FRN'}</option>)}
                {data.availableProfessionalFirms.map(item => <option key={`available-${item.id}`} value={item.id}>Link existing: {item.firm_name} · {item.frn || 'No FRN'}</option>)}
              </select>
            </label>
            <TextField label="Firm name" required value={firm.firmName} onChange={value => updateFirm('firmName', value)} disabled={!data.canManage} />
            <TextField label="Firm Registration Number (FRN)" value={firm.frn} onChange={value => updateFirm('frn', value)} disabled={!data.canManage} />
            <TextField label="PAN" value={firm.pan} onChange={value => updateFirm('pan', value)} disabled={!data.canManage} />
            <TextField label="Email" type="email" value={firm.email} onChange={value => updateFirm('email', value)} disabled={!data.canManage} />
            <TextField label="Phone" value={firm.phone} onChange={value => updateFirm('phone', value)} disabled={!data.canManage} />
            <TextField label="Website" type="url" value={firm.websiteUrl} onChange={value => updateFirm('websiteUrl', value)} disabled={!data.canManage} />
            <TextBox label="Main office address" rows={3} value={firm.address} onChange={value => updateFirm('address', value)} disabled={!data.canManage} />
            <div className="flex flex-col gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">Firm logo (PNG/JPEG; fetched official SVG is safely cached)</span>
                <input type="file" accept="image/png,image/jpeg" disabled={!data.canManage} onChange={async event => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  try {
                    if (file.size > 750 * 1024 || !['image/png', 'image/jpeg'].includes(file.type)) {
                      throw new Error('Choose a PNG or JPEG logo no larger than 750 KB.')
                    }
                    updateFirm('logoMimeType', file.type)
                    updateFirm('logoBase64', await fileAsBase64(file))
                    updateFirm('clearLogo', false)
                  } catch (fileError) {
                    setError(fileError.message)
                  }
                }} className="w-full text-xs text-gray-600 file:mr-2 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-2 file:py-1.5" />
              </label>
              {(firm.logoBase64 || cachedLogo?.contentBase64) && <img alt="Selected firm logo"
                src={`data:${firm.logoMimeType || cachedLogo?.mimeType};base64,${firm.logoBase64 || cachedLogo?.contentBase64}`}
                className="h-20 w-48 object-contain object-left" />}
              {firm.logoBase64 && data.canManage && <button type="button" onClick={() => {
                updateFirm('logoMimeType', '')
                updateFirm('logoBase64', '')
                updateFirm('clearLogo', true)
              }} className="self-start text-xs font-medium text-red-700">Remove logo</button>}
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={firm.isActive} disabled={!data.canManage} onChange={event => updateFirm('isActive', event.target.checked)} />
              Active firm
            </label>
            <div className="sm:col-span-2 rounded-lg border border-blue-100 bg-blue-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-blue-950">Public website detail preview</p>
                  <p className="mt-1 text-xs text-blue-900">Only the official Kreston Menon website is fetched. Preview is editable, never saves automatically, and does not infer a signing partner, registration number or professional credential.</p>
                </div>
                <button type="button" disabled={!data.canManage || fetchingPublic} onClick={fetchPublicPreview}
                  className="rounded-md border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-900 disabled:opacity-50">
                  {fetchingPublic ? 'Fetching public details…' : 'Fetch Kreston Menon details'}
                </button>
              </div>
              {publicPreview && <div className="mt-3 rounded-md bg-white p-3 text-xs text-gray-700">
                <p className="font-semibold">{publicPreview.preview.firmName} · Draft/demo only</p>
                <p>{publicPreview.preview.address}</p>
                <p>{publicPreview.preview.phone} · {publicPreview.preview.email}</p>
                <p>Retrieved {new Date(publicPreview.preview.retrievedAt).toLocaleString()}</p>
                <p className="mt-1">Sources: {publicPreview.preview.sourceUrls.join(' · ')}</p>
                <p className="mt-1">{publicPreview.preview.disclaimer}</p>
                <button type="button" onClick={applyPublicPreview} className="mt-2 rounded-md bg-blue-700 px-3 py-1.5 font-semibold text-white">
                  Start separate editable demo-profile draft
                </button>
              </div>}
              {firm.profileStatus === 'demo' && <p className="mt-2 font-semibold text-amber-800">DRAFT / DEMO PROFILE — not verified; no registration or signing authority recorded.</p>}
              {firm.sourceRetrievedAt && <p className="mt-1 text-xs text-gray-500">Source retrieval: {new Date(firm.sourceRetrievedAt).toLocaleString()} · {(firm.sourceUrls || []).join(' · ')}</p>}
            </div>
          </div>
          {data.canManage && <button type="button" onClick={saveFirm} disabled={busy || !firm.firmName.trim()}
            className="mt-4 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save firm'}</button>}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="font-semibold text-gray-900">Offices</h3>
          <p className="mt-1 text-xs text-gray-500">Office addresses can be selected for each engagement and report.</p>
          <label className="mt-4 block">
            <span className="mb-1 block text-xs font-medium text-gray-700">Edit office</span>
            <select value={office.id || ''} disabled={!data.canManage || !selectedFirmId} onChange={event => {
              const selected = offices.find(item => String(item.id) === event.target.value)
              setOffice(selected ? {
                id: String(selected.id), auditorFirmId: String(selected.auditor_firm_id),
                officeName: selected.office_name, address: selected.address,
                phone: selected.phone || '', email: selected.email || '', sourceUrl: selected.source_url || '',
                sourceRetrievedAt: selected.source_retrieved_at || '', isActive: selected.is_active !== false,
              } : { ...EMPTY_OFFICE, auditorFirmId: selectedFirmId })
            }} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="">New office…</option>
              {offices.map(item => <option key={item.id} value={item.id}>{item.office_name}{item.is_active ? '' : ' · inactive'}</option>)}
            </select>
          </label>
          {!selectedOfficeFirm && <p className="mt-3 rounded-md bg-gray-50 p-3 text-xs text-gray-600">Save or select a firm before adding its offices.</p>}
          <form onSubmit={saveOffice} className="mt-3 space-y-3">
            <TextField label="Office name" required value={office.officeName} onChange={value => updateOffice('officeName', value)} disabled={!data.canManage || !selectedFirmId} />
            <TextBox label="Address" rows={3} required value={office.address} onChange={value => updateOffice('address', value)} disabled={!data.canManage || !selectedFirmId} />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Phone" value={office.phone} onChange={value => updateOffice('phone', value)} disabled={!data.canManage || !selectedFirmId} />
              <TextField label="Email" type="email" value={office.email} onChange={value => updateOffice('email', value)} disabled={!data.canManage || !selectedFirmId} />
            </div>
            {office.sourceUrl && <p className="text-xs text-gray-500">Source: {office.sourceUrl} · retrieved {office.sourceRetrievedAt ? new Date(office.sourceRetrievedAt).toLocaleString() : 'date unavailable'}</p>}
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={office.isActive} disabled={!data.canManage || !selectedFirmId} onChange={event => updateOffice('isActive', event.target.checked)} />
              Active office
            </label>
            {data.canManage && <button type="submit" disabled={busy || !selectedFirmId} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 disabled:opacity-40">Save office</button>}
          </form>
        </section>
      </div>

      <section className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-900">Application appearance</h3>
            <p className="mt-1 text-xs text-gray-600">Distinct from report styles. Changes preview immediately and save to this authenticated service firm; no renderer-supplied firm or user identity is accepted.</p>
          </div>
          {data.canManage && <div className="flex gap-2">
            <button type="button" onClick={() => setAppearance(savedAppearance)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">Cancel</button>
            <button type="button" onClick={() => setAppearance(DEFAULT_APPEARANCE)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">Reset draft</button>
            <button type="button" disabled={busy || appearanceContrastIssues.length > 0} onClick={saveAppearance} className="rounded-md bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Save appearance</button>
          </div>}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <TextField label="Application display name" maxLength={100} value={appearance.displayName}
            onChange={value => updateAppearance('displayName', value)} disabled={!data.canManage} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">Application logo (PNG/JPEG/sanitized SVG, max 750 KB)</span>
            <input type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" disabled={!data.canManage}
              onChange={async event => {
                const file = event.target.files?.[0]
                if (!file) return
                try {
                  if (file.size > 750 * 1024) throw new Error('Choose an application logo no larger than 750 KB.')
                  const extension = file.name.split('.').pop()?.toLowerCase()
                  const mimeType = file.type || (extension === 'svg' ? 'image/svg+xml' : '')
                  if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(mimeType)) throw new Error('Choose a PNG, JPEG, or SVG application logo.')
                  updateAppearance('logoMimeType', mimeType)
                  updateAppearance('logoBase64', await fileAsBase64(file))
                } catch (uploadError) {
                  setError(uploadError.message || 'Unable to load application logo.')
                } finally { event.target.value = '' }
              }}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-50" />
          </label>
          {firm.logoBase64 || cachedLogo?.contentBase64
            ? <button type="button" disabled={!data.canManage}
              onClick={() => {
                updateAppearance('logoMimeType', firm.logoMimeType || cachedLogo?.mimeType || '')
                updateAppearance('logoBase64', firm.logoBase64 || cachedLogo?.contentBase64 || '')
                if (firm.firmName) updateAppearance('displayName', firm.firmName)
              }}
              className="justify-self-start rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-50">
              Use selected professional firm name and logo
            </button>
            : <p className="text-xs text-gray-500">Save a professional firm profile to reuse its reviewed name/logo here.</p>}
          {appearance.logoBase64 && <div className="flex items-center gap-3">
            <img alt={`${appearance.displayName || 'Application'} logo preview`}
              src={`data:${appearance.logoMimeType};base64,${appearance.logoBase64}`}
              className="h-12 max-w-48 object-contain" />
            {data.canManage && <button type="button" onClick={() => {
              updateAppearance('logoMimeType', '')
              updateAppearance('logoBase64', '')
            }} className="text-xs font-medium text-red-700">Remove application logo</button>}
          </div>}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField label="Primary action colour" type="color" value={appearance.primaryColor} onChange={value => updateAppearance('primaryColor', value)} disabled={!data.canManage} />
          <TextField label="Accent / focus colour" type="color" value={appearance.accentColor} onChange={value => updateAppearance('accentColor', value)} disabled={!data.canManage} />
          <TextField label="Navigation colour" type="color" value={appearance.navigationColor} onChange={value => updateAppearance('navigationColor', value)} disabled={!data.canManage} />
          <TextField label="Workspace background colour" type="color" value={appearance.backgroundColor} onChange={value => updateAppearance('backgroundColor', value)} disabled={!data.canManage} />
          <TextField label="Body text colour" type="color" value={appearance.textColor} onChange={value => updateAppearance('textColor', value)} disabled={!data.canManage} />
          <TextField label="Typeface" value={appearance.fontFamily} onChange={value => updateAppearance('fontFamily', value)} disabled={!data.canManage} />
          <TextField label="Font fallback" value={appearance.fontFallback} onChange={value => updateAppearance('fontFallback', value)} disabled={!data.canManage} />
          <TextField label="Base size (px)" type="number" min="11" max="20" value={appearance.baseFontSize} onChange={value => updateAppearance('baseFontSize', Number(value))} disabled={!data.canManage} />
          <TextField label="Heading size (px)" type="number" min="14" max="32" value={appearance.headingFontSize} onChange={value => updateAppearance('headingFontSize', Number(value))} disabled={!data.canManage} />
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-700">Heading weight</span><select value={appearance.headingWeight} disabled={!data.canManage} onChange={event => updateAppearance('headingWeight', Number(event.target.value))} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option><option value="800">Extra bold</option><option value="900">Black</option></select></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-700">Workspace density</span><select value={appearance.density} disabled={!data.canManage} onChange={event => updateAppearance('density', event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
        </div>
        {appearanceContrastIssues.length > 0 && <div role="status" aria-live="polite" className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          Contrast warning: {appearanceContrastIssues.join(' ')} Saving is blocked until the palette meets these checks.
        </div>}
        <div className="mt-4 rounded-lg border border-gray-200 p-4" style={{ fontFamily: `${appearance.fontFamily}, ${appearance.fontFallback}`, fontSize: `${appearance.baseFontSize}px`, background: appearance.backgroundColor, color: appearance.textColor }}>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md p-3 text-white" style={{ background: appearance.navigationColor }}>
            <span className="flex items-center gap-3" style={{ fontSize: `${appearance.headingFontSize}px`, fontWeight: appearance.headingWeight }}>
              {appearance.logoBase64 && <img alt="" src={`data:${appearance.logoMimeType};base64,${appearance.logoBase64}`} className="h-8 max-w-32 object-contain" />}
              {appearance.displayName || 'Live workspace preview'}
            </span>
            <button type="button" className="rounded px-3 py-1.5 text-sm" style={{ background: appearance.primaryColor, color: '#FFFFFF' }}>Navigation · Reports · Save</button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="rounded-md px-3 py-2 text-white" style={{ background: appearance.primaryColor, color: '#FFFFFF' }}>Primary action</span>
            <span className="rounded-md border-2 px-3 py-2" style={{ borderColor: appearance.accentColor, color: appearance.textColor }}>Active tab / focus accent</span>
            <span className="text-gray-700">Login, navigation, tabs and controls inherit application appearance.</span>
            <span className="rounded border border-gray-200 px-2 py-1 text-xs">{appearance.density} spacing</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded px-2 py-1" style={{ background: 'var(--semantic-warning-background)', color: 'var(--semantic-warning-text)' }}>Warning: review required</span>
            <span className="rounded px-2 py-1" style={{ background: 'var(--semantic-error-background)', color: 'var(--semantic-error-text)' }}>Error: action failed</span>
            <span className="self-center text-gray-500">Warning/error colours remain semantic and independent of firm palette.</span>
          </div>
        </div>
      </section>

      <section className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-900">Report styles · versioned and separate</h3>
            <p className="mt-1 text-xs text-gray-600">Each save creates an immutable firm-owned version. Existing engagements keep their selected version; previously saved PDFs keep their original bytes and style snapshot.</p>
            <p className="mt-1 text-xs text-gray-500">{reportStyles.map(item => `${item.name} v${item.version}`).join(' · ') || 'No saved report style versions yet.'}</p>
          </div>
          {data.canManage && <div className="flex gap-2">
            <button type="button" onClick={() => { setReportStyle(savedReportStyle); setStyleName(savedStyleName) }} className="rounded-md border border-gray-300 px-3 py-2 text-sm">Cancel</button>
            <button type="button" onClick={() => { setReportStyle(DEFAULT_REPORT_STYLE); setStyleName('Default report style') }} className="rounded-md border border-gray-300 px-3 py-2 text-sm">Reset draft</button>
            <button type="button" disabled={busy} onClick={saveReportStyle} className="rounded-md bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Save new version</button>
          </div>}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField label="Style name" value={styleName} onChange={setStyleName} disabled={!data.canManage} />
          <TextField label="Report typeface" value={reportStyle.fontFamily} onChange={value => updateStyle('fontFamily', value)} disabled={!data.canManage} />
          <TextField label="Font fallback" value={reportStyle.fontFallback} onChange={value => updateStyle('fontFallback', value)} disabled={!data.canManage} />
          <TextField label="Body size (pt)" type="number" min="8" max="14" value={reportStyle.bodyFontSize} onChange={value => updateStyle('bodyFontSize', Number(value))} disabled={!data.canManage} />
          <TextField label="Heading size (pt)" type="number" min="10" max="24" value={reportStyle.headingFontSize} onChange={value => updateStyle('headingFontSize', Number(value))} disabled={!data.canManage} />
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-700">Heading weight</span><select value={reportStyle.headingWeight} disabled={!data.canManage} onChange={event => updateStyle('headingWeight', Number(event.target.value))} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option><option value="800">Extra bold</option><option value="900">Black</option></select></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-700">Logo placement</span><select value={reportStyle.logoPlacement} disabled={!data.canManage} onChange={event => updateStyle('logoPlacement', event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"><option value="top-left">Top left</option><option value="top-center">Top centre</option><option value="top-right">Top right</option></select></label>
          <TextField label="Logo width (mm)" type="number" min="20" max="90" value={reportStyle.logoWidthMm} onChange={value => updateStyle('logoWidthMm', Number(value))} disabled={!data.canManage} />
          <TextField label="Header text" value={reportStyle.headerText} onChange={value => updateStyle('headerText', value)} disabled={!data.canManage} />
          <TextField label="Footer text" value={reportStyle.footerText} onChange={value => updateStyle('footerText', value)} disabled={!data.canManage} />
          <TextField label="Table header colour" type="color" value={reportStyle.tableHeaderColor} onChange={value => updateStyle('tableHeaderColor', value)} disabled={!data.canManage} />
          <TextField label="Table header text colour" type="color" value={reportStyle.tableHeaderTextColor} onChange={value => updateStyle('tableHeaderTextColor', value)} disabled={!data.canManage} />
          <TextField label="Table stripe colour" type="color" value={reportStyle.tableStripeColor} onChange={value => updateStyle('tableStripeColor', value)} disabled={!data.canManage} />
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-700">Page size / orientation</span><select value={reportStyle.pageSize} disabled={!data.canManage} onChange={event => updateStyle('pageSize', event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"><option>A4</option><option>Letter</option></select><select value={reportStyle.pageOrientation} disabled={!data.canManage} onChange={event => updateStyle('pageOrientation', event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
          <TextField label="Page margin (mm)" type="number" min="8" max="30" value={reportStyle.pageMarginMm} onChange={value => updateStyle('pageMarginMm', Number(value))} disabled={!data.canManage} />
        </div>
        <div className="mt-4 flex gap-2" role="tablist" aria-label="Report preview format">
          {['PDF', 'Word', 'Excel'].map(format => <button key={format} type="button" role="tab" aria-selected={previewFormat === format} onClick={() => setPreviewFormat(format)} className={`rounded-md px-3 py-1.5 text-sm ${previewFormat === format ? 'text-white' : 'border border-gray-300 text-gray-700'}`} style={previewFormat === format ? { background: reportStyle.tableHeaderColor } : {}}>{format} preview</button>)}
        </div>
        <div className="mt-2 rounded-lg border border-gray-300 p-4" style={{ fontFamily: `${reportStyle.fontFamily}, ${reportStyle.fontFallback}`, fontSize: `${reportStyle.bodyFontSize}pt` }}>
          <div className="flex items-center justify-between gap-2 border-b pb-2" style={{ borderColor: reportStyle.tableHeaderColor }}>
            {reportStyle.logoPlacement === 'top-left' && firm.logoBase64 && <img alt="Report logo preview" src={`data:${firm.logoMimeType};base64,${firm.logoBase64}`} style={{ width: `${reportStyle.logoWidthMm}mm`, maxHeight: '18mm', objectFit: 'contain' }} />}
            <div className="flex-1 text-center">
              {reportStyle.headerText && <p className="text-xs">{reportStyle.headerText}</p>}
              <strong style={{ color: reportStyle.tableHeaderColor, fontSize: `${reportStyle.headingFontSize}pt`, fontWeight: reportStyle.headingWeight }}>Illustrative financial statement</strong>
            </div>
            {reportStyle.logoPlacement === 'top-right' && firm.logoBase64 && <img alt="Report logo preview" src={`data:${firm.logoMimeType};base64,${firm.logoBase64}`} style={{ width: `${reportStyle.logoWidthMm}mm`, maxHeight: '18mm', objectFit: 'contain' }} />}
          </div>
          {reportStyle.logoPlacement === 'top-center' && firm.logoBase64 && <img alt="Report logo preview" src={`data:${firm.logoMimeType};base64,${firm.logoBase64}`} className="mx-auto my-2 max-h-14 object-contain" style={{ width: `${reportStyle.logoWidthMm}mm` }} />}
          <table className="mt-3 w-full border-collapse text-left"><thead style={{ background: reportStyle.tableHeaderColor, color: reportStyle.tableHeaderTextColor }}><tr><th className="p-2">Description</th><th className="p-2 text-right">Amount</th></tr></thead><tbody><tr><td className="p-2">Illustrative line item · {previewFormat} preview</td><td className="p-2 text-right">0.00</td></tr><tr style={{ background: reportStyle.tableStripeColor }}><td className="p-2">No client values shown in style preview</td><td className="p-2 text-right">—</td></tr></tbody></table>
          {reportStyle.footerText && <p className="mt-3 border-t pt-2 text-xs">{reportStyle.footerText}</p>}
        </div>
        <p className="mt-2 text-xs text-amber-800">Preview is synthetic. Versioned settings are applied to protected combined-PDF output. Word/Excel layout application remains export-specific and does not change financial data.</p>
      </section>

      <section className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="font-semibold text-gray-900">Engagement partners</h3>
        <p className="mt-1 text-xs text-gray-500">Partner accounts are the existing firm-user records. Inactive accounts cannot sign in or be selected for new engagements.</p>
        {!data.partners.length ? <p className="mt-4 text-sm text-gray-500">No partner accounts are configured. Add one under Firm Team.</p> : (
          <div className="mt-4 divide-y divide-gray-100">
            {data.partners.map(item => <div key={item.id} className="grid gap-3 py-4 md:grid-cols-[minmax(180px,1fr)_1fr_1fr_auto] md:items-end">
              <div><p className="text-sm font-semibold text-gray-900">{partnerLabel(item)}</p><p className="text-xs text-gray-500">{item.job_title || 'Partner'}</p></div>
              <TextField label="Qualification" value={partnerValues[item.id]?.qualification || ''} onChange={value => updatePartner(item.id, 'qualification', value)} disabled={!data.canManage} placeholder="e.g. FCA" />
              <TextField label="Membership / registration number" value={partnerValues[item.id]?.registrationNumber || ''} onChange={value => updatePartner(item.id, 'registrationNumber', value)} disabled={!data.canManage} />
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-gray-700">
                  <input type="checkbox" checked={partnerValues[item.id]?.isActive !== false} disabled={!data.canManage} onChange={event => updatePartner(item.id, 'isActive', event.target.checked)} />
                  Active
                </label>
                {data.canManage && <button type="button" disabled={busy} onClick={() => savePartner(item.id)} className="rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-800 disabled:opacity-40">Save</button>}
              </div>
            </div>)}
          </div>
        )}
      </section>
      <p className="mt-4 text-xs text-gray-500">Signed in as {user.displayName}. Firm master updates are recorded in the firm audit log.</p>
    </div>
  )
}
