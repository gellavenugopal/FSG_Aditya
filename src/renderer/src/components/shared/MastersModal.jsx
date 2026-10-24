import React, { useState, useEffect } from 'react'

// ── Shared field style ────────────────────────────────────────────────────────
const inp = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:outline-none"

// ── Auditor Firm form ─────────────────────────────────────────────────────────
function FirmForm({ editing, onSaved, onCancel }) {
  const [form, setForm] = useState({ id: editing?.id, firm_name: editing?.firm_name || '', frn: editing?.frn || '', pan: editing?.pan || '', address: editing?.address || '', email: editing?.email || '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const f = (k) => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async () => {
    setErr('')
    if (!form.firm_name.trim()) { setErr('Firm Name is required'); return }
    setSaving(true)
    try { await window.api?.saveAuditorFirm(form); onSaved?.() }
    catch (e) { setErr(e.message || 'Failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="border rounded-lg p-4 mb-3" style={{ borderColor: 'var(--color-border-soft)', background: 'var(--color-primary-50)' }}>
      <div className="text-sm font-semibold mb-3" style={{ color: 'var(--color-primary)' }}>
        {editing?.id ? 'Edit Auditor Firm' : 'Add Auditor Firm'}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Firm Name *</label>
          <input value={form.firm_name} onChange={f('firm_name')} placeholder="e.g. ABC & Co." className={inp} autoFocus />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">FRN</label>
          <input value={form.frn} onChange={f('frn')} placeholder="e.g. 123456W" className={inp} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Income Tax PAN of the firm <span className="text-gray-400">(optional)</span></label>
          <input value={form.pan} onChange={e => setForm(p => ({ ...p, pan: e.target.value.toUpperCase() }))} placeholder="e.g. AAAFA1234B" maxLength={10} className={inp} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">E-mail of the firm <span className="text-gray-400">(optional)</span></label>
          <input type="email" value={form.email} onChange={f('email')} placeholder="e.g. office@abcandco.in" className={inp} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Address of the firm <span className="text-gray-400">(optional)</span></label>
          <textarea value={form.address} onChange={f('address')} rows={2} placeholder="Office address" className={inp} />
        </div>
      </div>
      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
      <div className="flex gap-2 mt-3">
        <button onClick={onCancel} className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50">Cancel</button>
        <button onClick={submit} disabled={saving} className="px-3 py-1.5 text-white rounded text-sm font-medium disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
          {saving ? 'Saving...' : 'Save Firm'}
        </button>
      </div>
    </div>
  )
}

// ── Global Signatory form ─────────────────────────────────────────────────────
function GlobalSignatoryForm({ editing, firmId, onSaved, onCancel }) {
  const [form, setForm] = useState({
    id: editing?.id,
    firm_id: editing?.firm_id ?? firmId ?? null,
    name: editing?.name || '',
    din: editing?.din || '',
    designation: editing?.designation || '',
    membership_number: editing?.membership_number || '',
    address: editing?.address || '',
    email: editing?.email || '',
    membership_category: editing?.membership_category || '',
  })
  const [firms, setFirms] = useState([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const f = (k) => e => setForm(p => ({ ...p, [k]: e.target.value }))

  useEffect(() => {
    window.api?.listAuditorFirms().then(r => setFirms(r || [])).catch(() => {})
  }, [])

  const submit = async () => {
    setErr('')
    if (!form.name.trim()) { setErr('Name is required'); return }
    setSaving(true)
    try { await window.api?.saveGlobalSignatory(form); onSaved?.() }
    catch (e) { setErr(e.message || 'Failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="border rounded-lg p-4 mb-3" style={{ borderColor: 'var(--color-border-soft)', background: 'var(--color-primary-50)' }}>
      <div className="text-sm font-semibold mb-3" style={{ color: 'var(--color-primary)' }}>
        {editing?.id ? 'Edit Signatory' : 'Add Signatory'}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Auditor Firm</label>
          <select value={form.firm_id ?? ''} onChange={e => setForm(p => ({ ...p, firm_id: e.target.value || null }))} className={inp}>
            <option value="">— No firm (independent) —</option>
            {firms.map(f => <option key={f.id} value={f.id}>{f.firm_name}{f.frn ? ` (${f.frn})` : ''}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Name *</label>
          <input value={form.name} onChange={f('name')} className={inp} autoFocus />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">DIN / DPIN / PAN</label>
          <input value={form.din} onChange={f('din')} className={inp} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Designation</label>
          <input value={form.designation} onChange={f('designation')} placeholder="e.g. Partner / Director" className={inp} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Membership No.</label>
          <input value={form.membership_number} onChange={f('membership_number')} placeholder="e.g. 123456" className={inp} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Category of membership</label>
          <div className="flex items-center gap-6 text-sm">
            {[['Associate', 'Associate (ACA)'], ['Fellow', 'Fellow (FCA)']].map(([v, l]) => (
              <label key={v} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="membership_category" checked={form.membership_category === v}
                  onChange={() => setForm(p => ({ ...p, membership_category: v }))} />
                {l}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">E-mail of the signing partner <span className="text-gray-400">(optional)</span></label>
          <input type="email" value={form.email} onChange={f('email')} placeholder="e.g. partner@abcandco.in" className={inp} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Address of the signing partner <span className="text-gray-400">(optional)</span></label>
          <textarea value={form.address} onChange={f('address')} rows={2} placeholder="Residential / office address" className={inp} />
        </div>
      </div>
      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
      <div className="flex gap-2 mt-3">
        <button onClick={onCancel} className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50">Cancel</button>
        <button onClick={submit} disabled={saving} className="px-3 py-1.5 text-white rounded text-sm font-medium disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
          {saving ? 'Saving...' : 'Save Signatory'}
        </button>
      </div>
    </div>
  )
}

// ── Entity-level Signatory form (for signing authority on financials) ─────────
// Default designation by constitution_display — Individual/Proprietorship/
// Partnership all share numeric constitution=1, so the display string (not
// the numeric code) is what distinguishes them.
function defaultDesignation(constitutionDisplay) {
  const cd = (constitutionDisplay || '').toLowerCase()
  if (cd === 'individual') return ''
  if (cd === 'proprietorship') return 'Proprietor'
  if (cd === 'partnership') return 'Partner'
  if (cd === 'llp') return 'Designated Partner'
  if (cd === 'company') return 'Director'
  return ''
}
function EntitySignatoryForm({ entityId, editing, onSaved, onCancel, constitution, constitutionDisplay }) {
  const [form, setForm] = useState({ id: editing?.id, name: editing?.name || '', din: editing?.din || '', designation: editing?.designation ?? defaultDesignation(constitutionDisplay) })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const f = (k) => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async () => {
    setErr('')
    if (!form.name.trim()) { setErr('Name is required'); return }
    setSaving(true)
    try { await window.api?.saveSignatory({ ...form, entity_id: entityId }); onSaved?.() }
    catch (e) { setErr(e.message || 'Failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="border rounded-lg p-4 mb-3" style={{ borderColor: 'var(--color-border-soft)', background: 'var(--color-primary-50)' }}>
      <div className="text-sm font-semibold mb-3" style={{ color: 'var(--color-primary)' }}>
        {editing?.id ? 'Edit Signatory' : 'Add Signing Authority'}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Name *</label>
          <input value={form.name} onChange={f('name')} className={inp} autoFocus />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">{constitution === 3 ? 'DIN' : constitution === 2 ? 'DPIN' : 'PAN / ID'}</label>
          <input value={form.din} onChange={f('din')} className={inp} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Designation</label>
          <input value={form.designation} onChange={f('designation')} className={inp} />
        </div>
      </div>
      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
      <div className="flex gap-2 mt-3">
        <button onClick={onCancel} className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50">Cancel</button>
        <button onClick={submit} disabled={saving} className="px-3 py-1.5 text-white rounded text-sm font-medium disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function MastersModal({ entity, onClose }) {
  const [tab, setTab] = useState('firms') // 'firms' | 'signatories' | 'entity_sign'
  // Global firms
  const [firms, setFirms] = useState([])
  const [selectedFirmId, setSelectedFirmId] = useState(null)
  const [editingFirm, setEditingFirm] = useState(null)
  const [showFirmForm, setShowFirmForm] = useState(false)
  // Global signatories (auditor members)
  const [globalSigns, setGlobalSigns] = useState([])
  const [editingGSign, setEditingGSign] = useState(null)
  const [showGSignForm, setShowGSignForm] = useState(false)
  // Entity-level signing authorities
  const [entitySigns, setEntitySigns] = useState([])
  const [editingESign, setEditingESign] = useState(null)
  const [showESignForm, setShowESignForm] = useState(false)

  const loadFirms = () => window.api?.listAuditorFirms().then(r => setFirms(r || [])).catch(() => {})
  const loadGlobalSigns = (firmId) => window.api?.listGlobalSignatories(firmId || null).then(r => setGlobalSigns(r || [])).catch(() => {})
  const loadEntitySigns = () => { if (entity?.id) window.api?.listSignatories(entity.id).then(r => setEntitySigns(r || [])).catch(() => {}) }

  useEffect(() => { loadFirms() }, [])
  useEffect(() => { loadGlobalSigns(selectedFirmId) }, [selectedFirmId])
  useEffect(() => { loadEntitySigns() }, [entity?.id])

  const TABS = [
    { key: 'firms',       label: `Auditor Firms (${firms.length})` },
    { key: 'signatories', label: `Auditor Members (${globalSigns.length})` },
    { key: 'entity_sign', label: `Signing Authorities${entity ? ` — ${entity.name}` : ''}` },
  ]

  const tabBtn = (key, label) => (
    <button key={key} onClick={() => setTab(key)}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === key ? '' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
      style={tab === key ? { color: 'var(--color-primary)', borderColor: 'var(--color-primary)' } : {}}>
      {label}
    </button>
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      {/* text-gray-900: opened from the blue top bar, whose white text every unstyled cell here inherited (names, designations, membership numbers read blank) */}
      <div className="modal-box overflow-y-auto max-h-[92vh] text-gray-900" style={{ maxWidth: '960px', width: '95vw' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold" style={{ color: 'var(--color-primary)' }}>Masters — Auditor &amp; Signatories</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        <div className="flex border-b mb-4" style={{ borderColor: 'var(--color-border-soft)' }}>
          {TABS.map(t => tabBtn(t.key, t.label))}
        </div>

        {/* ── Auditor Firms tab ─────────────────────────────────────────────── */}
        {tab === 'firms' && (
          <div>
            {showFirmForm && (
              <FirmForm editing={editingFirm}
                onSaved={() => { setShowFirmForm(false); setEditingFirm(null); loadFirms() }}
                onCancel={() => { setShowFirmForm(false); setEditingFirm(null) }} />
            )}
            {!showFirmForm && (
              <button onClick={() => { setEditingFirm(null); setShowFirmForm(true) }}
                className="mb-3 px-3 py-1.5 text-sm rounded text-white font-medium"
                style={{ background: 'var(--color-primary)' }}>
                + Add Auditor Firm
              </button>
            )}
            {firms.length === 0 && !showFirmForm && (
              <div className="text-center text-gray-400 text-sm py-8">No auditor firms added yet.</div>
            )}
            {firms.length > 0 && (
              <table className="w-full text-sm border rounded" style={{ borderColor: 'var(--color-border-soft)' }}>
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-700">Firm Name</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-700">FRN</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-700">PAN</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-700">E-mail / Address</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {firms.map(f => (
                    <tr key={f.id} className="border-t" style={{ borderColor: 'var(--color-border-soft)' }}>
                      <td className="px-3 py-2 font-medium">{f.firm_name}</td>
                      <td className="px-3 py-2 text-gray-500">{f.frn || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{f.pan || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{[f.email, f.address].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button onClick={() => { setEditingFirm(f); setShowFirmForm(true) }} className="text-xs mr-3 hover:underline" style={{ color: 'var(--color-primary)' }}>Edit</button>
                        <button onClick={async () => { if (confirm('Remove firm?')) { await window.api?.deleteAuditorFirm(f.id); loadFirms() } }} className="text-xs text-red-600 hover:underline">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Auditor Members tab ───────────────────────────────────────────── */}
        {tab === 'signatories' && (
          <div>
            {/* Filter by firm */}
            <div className="flex items-center gap-3 mb-3">
              <label className="text-xs text-gray-500 font-medium whitespace-nowrap">Filter by firm:</label>
              <select value={selectedFirmId ?? ''} onChange={e => setSelectedFirmId(e.target.value || null)}
                className="border border-gray-300 rounded px-2 py-1 text-sm">
                <option value="">— All firms —</option>
                {firms.map(f => <option key={f.id} value={f.id}>{f.firm_name}</option>)}
              </select>
              {showGSignForm ? null : (
                <button onClick={() => { setEditingGSign(null); setShowGSignForm(true) }}
                  className="ml-auto px-3 py-1.5 text-sm rounded text-white font-medium"
                  style={{ background: 'var(--color-primary)' }}>
                  + Add Member
                </button>
              )}
            </div>

            {showGSignForm && (
              <GlobalSignatoryForm editing={editingGSign} firmId={selectedFirmId ? parseInt(selectedFirmId) : null}
                onSaved={() => { setShowGSignForm(false); setEditingGSign(null); loadGlobalSigns(selectedFirmId) }}
                onCancel={() => { setShowGSignForm(false); setEditingGSign(null) }} />
            )}

            {globalSigns.length === 0 && !showGSignForm && (
              <div className="text-center text-gray-400 text-sm py-8">No auditor members found.</div>
            )}
            {globalSigns.length > 0 && (
              <table className="w-full text-sm border rounded" style={{ borderColor: 'var(--color-border-soft)' }}>
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-700">Firm</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-700">Name</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-700">Designation</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-700">Membership No.</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-700">DIN / PAN</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-700">E-mail / Address</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {globalSigns.map(s => {
                    const firm = firms.find(f => f.id === s.firm_id)
                    return (
                      <tr key={s.id} className="border-t" style={{ borderColor: 'var(--color-border-soft)' }}>
                        <td className="px-3 py-2 text-gray-500 text-xs">{firm?.firm_name || '—'}</td>
                        <td className="px-3 py-2 font-medium">{s.name}</td>
                        <td className="px-3 py-2">{s.designation || '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{s.membership_number || '—'}{s.membership_category ? ` (${s.membership_category === 'Fellow' ? 'FCA' : 'ACA'})` : ''}</td>
                        <td className="px-3 py-2 font-mono text-xs">{s.din || '—'}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">{[s.email, s.address].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={() => { setEditingGSign(s); setShowGSignForm(true) }} className="text-xs mr-3 hover:underline" style={{ color: 'var(--color-primary)' }}>Edit</button>
                          <button onClick={async () => { if (confirm('Remove?')) { await window.api?.deleteGlobalSignatory(s.id); loadGlobalSigns(selectedFirmId) } }} className="text-xs text-red-600 hover:underline">Remove</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Entity Signing Authorities tab ────────────────────────────────── */}
        {tab === 'entity_sign' && (
          <div>
            {!entity && <div className="text-gray-400 text-sm py-4">Select a client first.</div>}
            {entity && (
              <>
                <p className="text-xs text-gray-500 mb-3">
                  Directors / Partners / Proprietors who sign the financial statements for <strong>{entity.name}</strong>.
                </p>
                {showESignForm && (
                  <EntitySignatoryForm entityId={entity.id} editing={editingESign} constitution={entity.constitution} constitutionDisplay={entity.constitution_display}
                    onSaved={() => { setShowESignForm(false); setEditingESign(null); loadEntitySigns() }}
                    onCancel={() => { setShowESignForm(false); setEditingESign(null) }} />
                )}
                {!showESignForm && (
                  <button onClick={() => { setEditingESign(null); setShowESignForm(true) }}
                    className="mb-3 px-3 py-1.5 text-sm rounded text-white font-medium"
                    style={{ background: 'var(--color-primary)' }}>
                    + Add Signing Authority
                  </button>
                )}
                {entitySigns.length === 0 && !showESignForm && (
                  <div className="text-center text-gray-400 text-sm py-8">No signing authorities added yet.</div>
                )}
                {entitySigns.length > 0 && (
                  <table className="w-full text-sm border rounded" style={{ borderColor: 'var(--color-border-soft)' }}>
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-gray-700">Name</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-gray-700">{entity.constitution === 3 ? 'DIN' : entity.constitution === 2 ? 'DPIN' : 'PAN'}</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-gray-700">Designation</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {entitySigns.map(s => (
                        <tr key={s.id} className="border-t" style={{ borderColor: 'var(--color-border-soft)' }}>
                          <td className="px-3 py-2 font-medium">{s.name}</td>
                          <td className="px-3 py-2 font-mono text-xs">{s.din || '—'}</td>
                          <td className="px-3 py-2">{s.designation || '—'}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <button onClick={() => { setEditingESign(s); setShowESignForm(true) }} className="text-xs mr-3 hover:underline" style={{ color: 'var(--color-primary)' }}>Edit</button>
                            <button onClick={async () => { if (confirm('Remove?')) { await window.api?.deleteSignatory(s.id); loadEntitySigns() } }} className="text-xs text-red-600 hover:underline">Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
