import React, { useState, useEffect } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'

const CONSTITUTION_OPTIONS = [
  { label: 'Individual', value: 'Individual', code: 1 },
  { label: 'Proprietorship', value: 'Proprietorship', code: 1 },
  { label: 'Partnership', value: 'Partnership', code: 1 },
  { label: 'LLP', value: 'LLP', code: 2 },
  { label: 'Company', value: 'Company', code: 3 },
]

const BUSINESS_TYPE_OPTIONS = [
  'Manufacturer',
  'Trader',
  'Service Provider',
  'Mixed',
]

export default function EntityModal({ current, onSave, onClose }) {
  const [entities, setEntities] = useState([])
  const [mode, setMode] = useState('select')
  const [selectedId, setSelectedId] = useState(current?.id || '')
  const [name, setName] = useState('')
  const [constitutionDisplay, setConstitutionDisplay] = useState('Company')
  const [businessType, setBusinessType] = useState('Trader')
  const [hasBranches, setHasBranches] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const selectedConst = CONSTITUTION_OPTIONS.find(o => o.value === constitutionDisplay)
  const selectedEntity = entities.find(e => e.id === parseInt(selectedId))

  const loadEntities = () => {
    window.api?.getEntities()
      .then(list => setEntities(list || []))
      .catch(() => setError('Database not connected. Please configure database settings first.'))
  }

  useEffect(() => { loadEntities() }, [])

  const fillForm = (e) => {
    setName(e?.name || '')
    setConstitutionDisplay(e?.constitution_display || 'Company')
    setBusinessType(e?.business_type || 'Trader')
    setHasBranches(!!e?.has_branches)
  }

  useEffect(() => {
    if (mode === 'edit' && selectedEntity) fillForm(selectedEntity)
    if (mode === 'create') {
      setName('')
      setConstitutionDisplay('Company')
      setBusinessType('Trader')
      setHasBranches(false)
    }
  }, [mode, selectedId, entities])

  const handleConfirm = () => {
    if (mode === 'select') return handleSelect()
    return handleSave()
  }
  const containerRef = useModalKeys({ onClose, onConfirm: handleConfirm })

  const handleSelect = () => {
    if (selectedEntity) onSave(selectedEntity)
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('Entity name is required.'); return }
    setSaving(true); setError('')
    try {
      const saved = await window.api.saveEntity({
        id: mode === 'edit' ? selectedEntity?.id : undefined,
        name: name.trim(),
        constitution: selectedConst?.code || 3,
        constitution_display: constitutionDisplay,
        business_type: businessType,
        has_branches: hasBranches ? 1 : 0,
      })
      loadEntities()
      onSave(saved)
    } catch (err) {
      setError(err.message || 'Failed to save entity.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedEntity) return
    const ok = window.confirm(
      `Delete client "${selectedEntity.name}"?\n\nThis will delete its trial balances, mappings, notes, remarks, depreciation schedules, auditors and signatories. This action cannot be undone.`
    )
    if (!ok) return
    setDeleting(true); setError('')
    try {
      await window.api?.deleteEntity(selectedEntity.id)
      const wasCurrent = current?.id === selectedEntity.id
      setSelectedId('')
      setMode('select')
      loadEntities()
      if (wasCurrent) onSave(null)
    } catch (err) {
      setError(err.message || 'Failed to delete entity.')
    } finally {
      setDeleting(false)
    }
  }

  const renderForm = () => (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Entity / Client Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          placeholder="e.g. ABC Pvt Ltd"
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Constitution of Entity</label>
        <select
          value={constitutionDisplay}
          onChange={e => setConstitutionDisplay(e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {CONSTITUTION_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p className="text-xs text-gray-400 mt-1">
          Code: {selectedConst?.code} | {selectedConst?.code === 1 ? 'Proprietorship / Partnership rules' :
          selectedConst?.code === 2 ? 'LLP rules' : 'Company (Schedule III) rules'}
        </p>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Nature of Business</label>
        <select
          value={businessType}
          onChange={e => setBusinessType(e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {BUSINESS_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hasBranches}
            onChange={e => setHasBranches(e.target.checked)}
            className="rounded border-gray-300"
          />
          <span className="text-sm text-gray-700">Has Branches</span>
        </label>
        <p className="text-xs text-gray-400 mt-1">
          When enabled, multiple Trial Balances can be uploaded and reported consolidated or branch-wise.
        </p>
      </div>
      {error && <p className="text-red-500 text-xs">{error}</p>}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2 bg-blue-700 text-white rounded font-medium text-sm disabled:opacity-40 hover:bg-blue-800 transition"
        title="Save (Ctrl+Enter)"
      >
        {saving ? 'Saving...' : mode === 'edit' ? 'Save Changes' : 'Create & Select'}
      </button>
    </div>
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" ref={containerRef} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-blue-900">Select / Manage Client</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="flex gap-2 mb-4">
          <button
            className={`px-4 py-1.5 rounded text-sm font-medium transition ${mode === 'select' ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            onClick={() => setMode('select')}
          >
            Select Existing
          </button>
          <button
            className={`px-4 py-1.5 rounded text-sm font-medium transition ${mode === 'create' ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            onClick={() => setMode('create')}
          >
            Create New
          </button>
          <button
            disabled={!selectedId}
            className={`px-4 py-1.5 rounded text-sm font-medium transition disabled:opacity-40 ${mode === 'edit' ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            onClick={() => selectedId && setMode('edit')}
          >
            Edit
          </button>
        </div>

        {mode === 'select' ? (
          <div className="space-y-3">
            {entities.length === 0 ? (
              <p className="text-gray-400 text-sm">No entities found. Create one first.</p>
            ) : (
              <select
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSelect()}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">- Select entity -</option>
                {entities.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.constitution_display}{e.business_type ? `, ${e.business_type}` : ''})
                  </option>
                ))}
              </select>
            )}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handleSelect}
                disabled={!selectedId}
                className="py-2 bg-blue-700 text-white rounded font-medium text-sm disabled:opacity-40 hover:bg-blue-800 transition"
              >
                Select
              </button>
              <button
                onClick={() => selectedId && setMode('edit')}
                disabled={!selectedId}
                className="py-2 border border-gray-300 text-gray-700 rounded font-medium text-sm disabled:opacity-40 hover:bg-gray-50 transition"
              >
                Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={!selectedId || deleting}
                className="py-2 border border-red-300 text-red-700 rounded font-medium text-sm disabled:opacity-40 hover:bg-red-50 transition"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
            {error && <p className="text-red-500 text-xs">{error}</p>}
          </div>
        ) : renderForm()}
        <p className="text-xs text-gray-400 text-center mt-3">Ctrl+Enter to confirm | Esc to close</p>
      </div>
    </div>
  )
}
