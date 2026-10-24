import React from 'react'

export default function DBBanner({ onConfigure }) {
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-5 py-2.5 flex items-center gap-3 text-sm">
      <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      <span className="text-amber-800">
        Database not connected. Please configure your PostgreSQL connection to get started.
      </span>
      <button
        onClick={onConfigure}
        className="ml-auto px-3 py-1 bg-amber-500 text-white rounded text-xs font-medium hover:bg-amber-600 transition"
      >
        Configure Now
      </button>
    </div>
  )
}
