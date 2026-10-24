import React, { useState, useEffect } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'

// Default designation + ID-field label by constitution, per constitution_display
// (Individual/Proprietorship/Partnership all share numeric constitution=1, so
// the display string — not the numeric code — is what distinguishes them).
// idType is persisted so the exporters know WHICH identifier the number is,
// rather than assuming DIN and printing a partner's PAN under a "DIN:" label.
// An LLP may sign with either a DIN or an LLPIN, so it chooses; everyone else
// has exactly one applicable identifier.
function defaultsFor(constitutionDisplay) {
  const cd = (constitutionDisplay || '').toLowerCase()
  if (cd === 'individual')      return { designation: '',                  idLabel: 'PAN',   idType: 'PAN' }
  if (cd === 'proprietorship')  return { designation: 'Proprietor',        idLabel: 'PAN',   idType: 'PAN' }
  if (cd === 'partnership')     return { designation: 'Partner',           idLabel: 'PAN',   idType: 'PAN' }
  if (cd === 'llp')             return { designation: 'Designated Partner', idLabel: 'DIN / LLPIN', idType: 'DIN', choose: ['DIN', 'LLPIN'], required: true }
  if (cd === 'company')         return { designation: 'Director',          idLabel: 'DIN',   idType: 'DIN' }
  return { designation: '', idLabel: 'ID', idType: '' }
}

// PAN is captured because it is useful in Masters, but it is never printed on
// the statements — see utils/signatoryFormat.js.
const NOT_PRINTED = new Set(['PAN'])

function SignatoryForm({ entityId, constitutionDisplay, editing, onSaved, onCancel }) {
  const defaults = defaultsFor(constitutionDisplay)
  const [name, setName] = useState(editing?.name || '')
  const [designation, setDesignation] = useState(editing?.designation ?? defaults.designation)
  const [din, setDin] = useState(editing?.din || '')
  const [idType, setIdType] = useState(editing?.id_type || defaults.idType)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    setErr('')
    if (!name.trim()) { setErr('Name is required.'); return }
    if (defaults.required && !din.trim()) { setErr(`${idType || 'DIN'} is required for an LLP signatory.`); return }
    setSaving(true)
    try {
      const saved = await window.api?.saveSignatory({
        id: editing?.id, entity_id: entityId,
        name: name.trim(), designation: designation.trim(), din: din.trim(),
        id_type: idType || null,
      })
      onSaved(saved)
    } catch (e) {
      setErr(e.message || 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-blue-200 rounded-lg p-3 mb-3 bg-blue-50/40">
      <div className="text-xs font-semibold text-blue-900 mb-2">{editing ? 'Edit Signatory' : 'New Signing Authority'}</div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="col-span-2">
          <label className="block text-[10px] text-gray-500 mb-0.5">Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white" autoFocus />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">Designation</label>
          <input value={designation} onChange={e => setDesignation(e.target.value)} placeholder={defaults.designation || '—'}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">
            {defaults.idLabel}{defaults.required ? ' *' : ''}
          </label>
          <div className="flex gap-1">
            {defaults.choose && (
              <select value={idType} onChange={e => setIdType(e.target.value)}
                className="border border-gray-300 rounded px-1 py-1.5 text-xs bg-white">
                {defaults.choose.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            <input value={din} onChange={e => setDin(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white" />
          </div>
          {NOT_PRINTED.has(idType) && (
            <p className="text-[10px] text-gray-400 mt-0.5">Kept for reference — not printed on the statements.</p>
          )}
        </div>
      </div>
      {err && <p className="text-red-500 text-xs mb-2">{err}</p>}
      <div className="flex gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded text-xs hover:bg-gray-50">Cancel</button>
        <button onClick={submit} disabled={saving} className="px-3 py-1.5 bg-blue-700 text-white rounded text-xs font-medium hover:bg-blue-800 disabled:opacity-40">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}

export default function SignatoryManageModal({ entity, startInCreate = false, onClose }) {
  const [signatories, setSignatories] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const containerRef = useModalKeys({ onClose })
  const defaults = defaultsFor(entity?.constitution_display)

  const load = () => {
    if (!entity?.id) { setLoading(false); return }
    setLoading(true)
    window.api?.listSignatories(entity.id)
      .then(list => setSignatories(list || []))
      .catch(() => setError('Failed to load Signatories.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [entity?.id])
  useEffect(() => { if (startInCreate) setEditing({}) }, [startInCreate])

  const handleDelete = async (s) => {
    if (!window.confirm(`Remove Signatory "${s.name}"?`)) return
    setError('')
    try {
      await window.api?.deleteSignatory(s.id)
      setSignatories(prev => prev.filter(x => x.id !== s.id))
    } catch (e) {
      setError(e.message || 'Failed to delete.')
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl p-6 flex flex-col"
        style={{ width: '560px', maxWidth: '92vw', maxHeight: '82vh' }}
        ref={containerRef}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h2 className="text-base font-bold text-blue-900">Signing Authorities{entity ? ` — ${entity.name}` : ''}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {!entity && <p className="text-gray-400 text-sm py-6 text-center">Select an Auditee first.</p>}

        {entity && (editing ? (
          <SignatoryForm
            entityId={entity.id}
            constitutionDisplay={entity.constitution_display}
            editing={editing.id ? editing : null}
            onSaved={() => { setEditing(null); load() }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <div className="flex items-center justify-end mb-3 shrink-0">
            <button
              onClick={() => setEditing({})}
              className="px-3 py-2 bg-blue-700 text-white rounded text-sm font-medium hover:bg-blue-800 whitespace-nowrap"
            >
              + Add Signatory
            </button>
          </div>
        ))}

        {error && <p className="text-red-500 text-xs mb-2 shrink-0">{error}</p>}

        {entity && (
          <div className="flex-1 overflow-y-auto -mx-2 px-2">
            {loading ? (
              <p className="text-gray-400 text-sm py-6 text-center">Loading...</p>
            ) : signatories.length === 0 ? (
              <p className="text-gray-400 text-sm py-6 text-center">No signing authorities added yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {signatories.map(s => (
                  <li key={s.id} className="flex items-center justify-between py-2.5 px-1 hover:bg-gray-50 rounded">
                    <div>
                      <div className="text-sm font-medium text-gray-800">{s.name}</div>
                      <div className="text-xs text-gray-400">
                        {s.designation || '—'}{s.din ? ` · ${s.id_type || defaults.idType || defaults.idLabel}: ${s.din}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEditing(s)} className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50">Edit</button>
                      <button onClick={() => handleDelete(s)} className="px-2 py-1 text-xs border border-red-300 rounded text-red-700 hover:bg-red-50">Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <p className="text-xs text-gray-400 text-center mt-3 shrink-0">Esc to close</p>
      </div>
    </div>
  )
}
