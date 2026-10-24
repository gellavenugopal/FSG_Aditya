import React, { useState, useRef, useEffect } from 'react'
import AuditeeListModal from './AuditeeListModal'
import AuditeeFormModal from './AuditeeFormModal'
import AuditeeReadModal from './AuditeeReadModal'
import FinancialPeriodManageModal from './FinancialPeriodManageModal'
import AuditorManageModal from './AuditorManageModal'
import SignatoryManageModal from './SignatoryManageModal'

// Hover-first flyout menu (click also toggles, for accessibility/touch).
function FlyoutMenu({ label, items }) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef(null)

  const openNow = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setOpen(true)
  }
  const closeSoon = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }

  return (
    <div className="relative" onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`px-5 py-3 text-sm font-semibold rounded-lg transition ${
          open ? 'bg-blue-700 text-white' : 'bg-white text-blue-900 border border-blue-200 hover:bg-blue-50'
        }`}
      >
        {label} <span className="text-xs ml-1">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-56 py-1" onMouseEnter={openNow} onMouseLeave={closeSoon}>
          {items.map(item => (
            <button
              key={item.label}
              onClick={() => { setOpen(false); item.onClick() }}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 text-gray-800 transition"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Master menu-bar dropdown leaf name → the modal it should open immediately
// (see App.jsx's TAB_GROUPS['Master']). 'Auditee Details' opens no modal —
// the page itself IS the Auditee Details view.
const LEAF_MODAL_TYPE = {
  'Financial Period': 'period-manage',
  'Auditor': 'auditor-manage',
  'Signatory': 'signatory-manage',
}

export default function Master({ entity, onEntityChange, onOpenMappingRules, activeLeaf }) {
  const [modal, setModal] = useState(null) // { type: 'select'|'create'|'edit'|'read'|'delete'|'period-create'|'period-manage' }

  const close = () => setModal(null)

  // Opens the matching modal when navigated here via a specific Master
  // dropdown item (Financial Period / Auditor / Signatory) — re-fires
  // whenever the leaf changes, even though Master itself doesn't remount.
  useEffect(() => {
    const type = LEAF_MODAL_TYPE[activeLeaf]
    if (type) setModal({ type })
  }, [activeLeaf])

  const auditeeItems = [
    { label: 'Select', onClick: () => setModal({ type: 'select' }) },
    { label: 'Create', onClick: () => setModal({ type: 'create' }) },
    { label: 'Read', onClick: () => entity ? setModal({ type: 'read' }) : setModal({ type: 'select', then: 'read' }) },
    { label: 'Edit', onClick: () => entity ? setModal({ type: 'edit' }) : setModal({ type: 'select', then: 'edit' }) },
    { label: 'Delete', onClick: () => setModal({ type: 'delete' }) },
  ]

  const periodItems = [
    { label: 'Create', onClick: () => setModal({ type: 'period-create' }) },
    { label: 'Manage List', onClick: () => setModal({ type: 'period-manage' }) },
  ]

  const auditorItems = [
    { label: 'Add', onClick: () => setModal({ type: 'auditor-create' }) },
    { label: 'Manage List', onClick: () => setModal({ type: 'auditor-manage' }) },
  ]

  const signatoryItems = [
    { label: 'Add', onClick: () => setModal({ type: 'signatory-create' }) },
    { label: 'Manage List', onClick: () => setModal({ type: 'signatory-manage' }) },
  ]

  const handleSelected = (e) => {
    onEntityChange(e)
    if (modal?.then === 'read') { setModal({ type: 'read' }); return }
    if (modal?.then === 'edit') { setModal({ type: 'edit' }); return }
    close()
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-8 bg-gray-50">
      <div className="max-w-3xl mx-auto w-full">
        <h1 className="text-2xl font-bold text-blue-900 mb-1">Master</h1>
        <p className="text-sm text-gray-500 mb-6">Manage Auditees and Financial Periods. Hover a heading for actions.</p>

        <div className="flex items-center gap-4 mb-8">
          <FlyoutMenu label="Auditee Details" items={auditeeItems} />
          <FlyoutMenu label="Financial Period" items={periodItems} />
          <FlyoutMenu label="Auditor" items={auditorItems} />
          <FlyoutMenu label="Signatory" items={signatoryItems} />
          {onOpenMappingRules && (
            <button
              onClick={onOpenMappingRules}
              title="Open Mapping Rules (Alt+M, then M)"
              className="px-5 py-3 text-sm font-semibold rounded-lg bg-white text-blue-900 border border-blue-200 hover:bg-blue-50 transition"
            >
              ⚙ Mapping Rules
            </button>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Current Context</h2>
          {entity ? (
            <div className="space-y-1">
              <div className="text-lg font-bold text-gray-900">{entity.name}</div>
              <div className="text-sm text-gray-500">
                {entity.constitution_display}{entity.business_type ? ` · ${entity.business_type}` : ''}
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => setModal({ type: 'read' })} className="px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-700 hover:bg-gray-50">View Details</button>
                <button onClick={() => setModal({ type: 'edit' })} className="px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-700 hover:bg-gray-50">Edit</button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No Auditee selected. Use <strong>Auditee → Select</strong> or <strong>Create</strong> above to get started.</p>
          )}
        </div>
      </div>

      {modal?.type === 'select' && (
        <AuditeeListModal mode="select" onSelect={handleSelected} onClose={close} />
      )}
      {modal?.type === 'delete' && (
        <AuditeeListModal
          mode="delete"
          onDeleted={(deleted) => { if (entity?.id === deleted.id) onEntityChange(null) }}
          onClose={close}
        />
      )}
      {modal?.type === 'create' && (
        <AuditeeFormModal mode="create" onSaved={(e) => { onEntityChange(e); close() }} onClose={close} />
      )}
      {modal?.type === 'edit' && entity && (
        <AuditeeFormModal mode="edit" editing={entity} onSaved={(e) => { onEntityChange(e); close() }} onClose={close} />
      )}
      {modal?.type === 'read' && entity && (
        <AuditeeReadModal entity={entity} onClose={close} />
      )}
      {modal?.type === 'period-create' && (
        <FinancialPeriodManageModal startInCreate onClose={close} />
      )}
      {modal?.type === 'period-manage' && (
        <FinancialPeriodManageModal onClose={close} />
      )}
      {modal?.type === 'auditor-create' && (
        <AuditorManageModal entity={entity} startInCreate onClose={close} />
      )}
      {modal?.type === 'auditor-manage' && (
        <AuditorManageModal entity={entity} onClose={close} />
      )}
      {modal?.type === 'signatory-create' && (
        <SignatoryManageModal entity={entity} startInCreate onClose={close} />
      )}
      {modal?.type === 'signatory-manage' && (
        <SignatoryManageModal entity={entity} onClose={close} />
      )}
    </div>
  )
}
