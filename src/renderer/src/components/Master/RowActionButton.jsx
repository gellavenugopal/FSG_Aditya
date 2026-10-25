import React from 'react'

export default function RowActionButton({ action, onClick, disabled = false }) {
  const isDelete = action === 'delete'
  const isInfo = action === 'info'
  const label = isDelete ? 'Delete' : isInfo ? 'View auditee and period details' : 'Edit'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 ${
        isDelete ? 'text-gray-500 hover:bg-red-50 hover:text-red-700' : 'text-gray-500 hover:bg-blue-50 hover:text-blue-700'
      }`}
    >
      {isDelete ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4" aria-hidden="true">
          <path d="M4 7h16M10 11v6m4-6v6M5 7l1 13h12l1-13M9 7V4h6v3" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : isInfo ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4" aria-hidden="true">
          <circle cx="12" cy="12" r="9" strokeWidth="1.7" />
          <path d="M12 11v5m0-8h.01" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4" aria-hidden="true">
          <path d="m14 5 5 5M4 20l4.5-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.5 16 4 20Z" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
