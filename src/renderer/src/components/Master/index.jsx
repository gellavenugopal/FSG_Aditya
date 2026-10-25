import React, { useState } from 'react'
import AuditeeListModal from './AuditeeListModal'
import AuditeeFormModal from './AuditeeFormModal'
import AuditeeReadModal from './AuditeeReadModal'
import FinancialPeriodManageModal from './FinancialPeriodManageModal'
import AuditorManageModal from './AuditorManageModal'
import SignatoryManageModal from './SignatoryManageModal'

const SECTIONS = [
  { label: 'Auditee Details', description: 'Organization profile' },
  { label: 'Financial Period', description: 'Financial years' },
  { label: 'Auditor', description: 'Audit appointments' },
  { label: 'Signatory', description: 'Signing authorities' },
  { label: 'Mapping Rules', description: 'Ledger classification' },
]

function AddButton({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Add ${label}`}
      title={`Add ${label}`}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-white transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5" aria-hidden="true">
        <path d="M12 5v14M5 12h14" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  )
}

function SectionHeading({ eyebrow, title, description, onAdd, addLabel }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">{eyebrow}</p>
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      </div>
      {onAdd && <AddButton label={addLabel} onClick={onAdd} />}
    </div>
  )
}

export default function Master({ entity, onEntityChange, onOpenMappingRules, activeLeaf, onSelectSection }) {
  const [modal, setModal] = useState(null)
  const section = SECTIONS.some(item => item.label === activeLeaf) ? activeLeaf : 'Auditee Details'
  const close = () => setModal(null)

  const handleSelected = (selectedEntity) => {
    onEntityChange(selectedEntity)
    if (modal?.then === 'read') { setModal({ type: 'read' }); return }
    if (modal?.then === 'edit') { setModal({ type: 'edit' }); return }
    close()
  }

  const selectOrCreateEntity = () => setModal({ type: 'select' })

  const renderSection = () => {
    if (section === 'Auditee Details') {
      return (
        <>
          <SectionHeading
            eyebrow="Organization"
            title="Auditee details"
            description="Select an organization to work with or manage its profile."
            addLabel="auditee"
            onAdd={() => setModal({ type: 'create' })}
          />
          <AuditeeListModal
            embedded
            mode="manage"
            selectedId={entity?.id}
            onSelect={handleSelected}
            onEdit={selectedEntity => {
              onEntityChange(selectedEntity)
              setModal({ type: 'edit', entity: selectedEntity })
            }}
            onDetails={selectedEntity => setModal({ type: 'read', entity: selectedEntity })}
            onDeleted={deleted => { if (entity?.id === deleted.id) onEntityChange(null) }}
          />
        </>
      )
    }

    if (section === 'Financial Period') {
      return (
        <>
          <SectionHeading
            eyebrow="Reporting setup"
            title="Financial periods"
            description="Create financial years and manage the periods available across your auditees."
            addLabel="financial period"
            onAdd={() => setModal({ type: 'period-create' })}
          />
          <FinancialPeriodManageModal embedded startInCreate={modal?.type === 'period-create'} onClose={close} />
        </>
      )
    }

    if (section === 'Auditor' || section === 'Signatory') {
      const auditor = section === 'Auditor'
      const title = auditor ? 'Auditors' : 'Signatories'
      const subject = auditor ? 'auditor' : 'signatory'
      const available = !!entity
      return (
        <>
          <SectionHeading
            eyebrow="Engagement details"
            title={title}
            description={auditor
              ? 'Maintain the auditor appointments attached to the selected auditee.'
              : 'Maintain the people authorized to sign this auditee’s financial statements.'}
            addLabel={subject}
            onAdd={available ? () => setModal({ type: auditor ? 'auditor-create' : 'signatory-create' }) : undefined}
          />
          {available ? (
            <div className="mb-5 flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-800" aria-hidden="true">
                {entity.name?.trim()?.charAt(0)?.toUpperCase() || 'A'}
              </span>
              <div className="min-w-0">
                <p className="text-xs text-gray-500">Managing {subject} records for</p>
                <p className="truncate text-sm font-semibold text-gray-900">{entity.name}</p>
              </div>
            </div>
          ) : (
            <div className="mb-5 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-amber-900">Select an auditee first to manage its {subject} records.</p>
              <button onClick={selectOrCreateEntity} className="shrink-0 text-left text-sm font-semibold text-blue-700 hover:text-blue-900">Select auditee →</button>
            </div>
          )}
          {available && (auditor
            ? <AuditorManageModal entity={entity} embedded startInCreate={modal?.type === 'auditor-create'} onClose={close} />
            : <SignatoryManageModal entity={entity} embedded startInCreate={modal?.type === 'signatory-create'} onClose={close} />)}
        </>
      )
    }

    return (
      <>
        <SectionHeading
          eyebrow="Classification"
          title="Mapping rules"
          description="Configure how trial balance ledgers are classified in your financial statements."
        />
        <div className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
          <h3 className="text-sm font-semibold text-gray-900">Review your mapping setup</h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-500">
            Open the mapping workspace to manage rule sets, review mapping levels, and keep ledger classification consistent.
          </p>
          <button
            onClick={onOpenMappingRules}
            title="Open Mapping Rules (Alt+I, then M)"
            className="mt-5 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Open mapping rules <span aria-hidden="true">→</span>
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-50">
      <header className="flex shrink-0 flex-col gap-3 border-b border-gray-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Settings</h1>
          <p className="mt-0.5 text-sm text-gray-500">Manage organizations, reporting setup, and access details.</p>
        </div>
        <div className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${entity ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${entity ? 'bg-emerald-500' : 'bg-gray-400'}`} aria-hidden="true" />
          {entity ? entity.name : 'No auditee selected'}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Settings sections" className="shrink-0 border-b border-gray-200 bg-white md:w-60 md:border-b-0 md:border-r">
          <p className="hidden px-5 pb-2 pt-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400 md:block">Workspace</p>
          <div className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-x-visible md:p-3">
            {SECTIONS.map((item, index) => {
              const selected = item.label === section
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => item.label === 'Mapping Rules' ? onOpenMappingRules?.() : onSelectSection(item.label)}
                  aria-current={selected ? 'page' : undefined}
                  className={`flex min-w-max items-center gap-3 rounded-lg px-3 py-2.5 text-left transition md:w-full md:min-w-0 ${
                    selected ? 'bg-blue-50 text-blue-900 ring-1 ring-inset ring-blue-100' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${selected ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-500'}`} aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0">
                    <span className="block whitespace-nowrap text-sm font-semibold">{item.label}</span>
                    <span className="hidden text-xs text-gray-400 md:block">{item.description}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7 lg:p-9">
          <div className="mx-auto w-full max-w-5xl">{renderSection()}</div>
        </main>
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
        <AuditeeFormModal mode="create" onSaved={(saved) => { onEntityChange(saved); close() }} onClose={close} />
      )}
      {modal?.type === 'edit' && (modal.entity || entity) && (
        <AuditeeFormModal mode="edit" editing={modal.entity || entity} onSaved={(saved) => { onEntityChange(saved); close() }} onClose={close} />
      )}
      {modal?.type === 'read' && (modal.entity || entity) && (
        <AuditeeReadModal entity={modal.entity || entity} onClose={close} />
      )}
    </div>
  )
}
