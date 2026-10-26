import React, { useCallback, useEffect, useState } from 'react'

const EMPTY_FIRM = {
  id: '',
  firmName: '',
  frn: '',
  pan: '',
  address: '',
  email: '',
  phone: '',
  isActive: true,
  logoMimeType: '',
  logoBase64: '',
  clearLogo: false,
}
const EMPTY_OFFICE = { id: '', auditorFirmId: '', officeName: '', address: '', phone: '', email: '', isActive: true }

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

  const load = useCallback(async (preferredId = '') => {
    setLoading(true)
    setError('')
    try {
      const result = await window.api.getEngagementFirmSettings()
      setData(result)
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

  const saveFirm = async event => {
    event.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)
    try {
      const saved = await window.api.saveEngagementProfessionalFirm(firm)
      setSelectedFirmId(String(saved.id))
      setMessage('Firm details and branding saved.')
      await load(String(saved.id))
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
  }

  const updateFirm = (key, value) => setFirm(current => ({ ...current, [key]: value }))
  const updateOffice = (key, value) => setOffice(current => ({ ...current, [key]: value }))
  const updatePartner = (id, key, value) => setPartnerValues(current => ({
    ...current,
    [id]: { ...current[id], [key]: value },
  }))
  const selectedOfficeFirm = data.professionalFirms.find(item => String(item.id) === selectedFirmId)
  const offices = data.offices.filter(item => String(item.auditor_firm_id) === selectedFirmId)
  const partnerLabel = item => `${item.display_name} · ${item.email}${item.active ? '' : ' · inactive'}`

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
              <p className="mt-1 text-xs text-gray-500">Select an existing auditor-firm master or add one when no matching record exists.</p>
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
            <TextBox label="Main office address" rows={3} value={firm.address} onChange={value => updateFirm('address', value)} disabled={!data.canManage} />
            <div className="flex flex-col gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">Firm logo (PNG/JPEG, max 750 KB)</span>
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
              {firm.logoBase64 && <img alt="Selected firm logo" src={`data:${firm.logoMimeType};base64,${firm.logoBase64}`} className="max-h-20 max-w-48 object-contain object-left" />}
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
                phone: selected.phone || '', email: selected.email || '', isActive: selected.is_active !== false,
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
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={office.isActive} disabled={!data.canManage || !selectedFirmId} onChange={event => updateOffice('isActive', event.target.checked)} />
              Active office
            </label>
            {data.canManage && <button type="submit" disabled={busy || !selectedFirmId} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 disabled:opacity-40">Save office</button>}
          </form>
        </section>
      </div>

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
