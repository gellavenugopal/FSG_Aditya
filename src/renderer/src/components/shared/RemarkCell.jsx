import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * Inline remark icon/preview. Click → opens a modal textarea for editing.
 * Using a modal instead of a popover avoids clipping inside AG Grid cells and
 * other overflow containers, and works consistently across tabs.
 */
export default function RemarkCell({
  tbId, scope, scopeKey, initialValue = '', onSaved, compact = false, label,
}) {
  const [value, setValue]   = useState(initialValue || '')
  const [open, setOpen]     = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setValue(initialValue || '') }, [initialValue])

  const save = async () => {
    if (value === (initialValue || '')) { setOpen(false); return }
    setSaving(true)
    try {
      await window.api?.saveRemark({ tbId, scope, scope_key: scopeKey, remark: value })
      onSaved?.(scope, scopeKey, value)
    } catch (e) {
      alert('Failed to save remark: ' + (e?.message || e))
    } finally {
      setSaving(false)
      setOpen(false)
    }
  }

  const hasValue = !!(value && value.trim())

  return (
    <>
      <button
        type="button"
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          if (!tbId) return
          setOpen(true)
        }}
        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] transition
          ${hasValue
            ? 'bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200'
            : 'text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100'}`}
        title={hasValue ? value : 'Click to add a remark'}
      >
        {hasValue ? (
          <>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {!compact && <span className="max-w-[140px] truncate">{value}</span>}
          </>
        ) : (
          <>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            {!compact && <span>Add remark</span>}
          </>
        )}
      </button>

      {open && createPortal(
        <div
          className="modal-backdrop"
          style={{ zIndex: 10000 }}
          onClick={(e) => { e.stopPropagation(); setOpen(false); setValue(initialValue || '') }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className="modal-box max-w-md"
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-blue-900">Remark</h3>
              <button
                onClick={(e) => { e.stopPropagation(); setOpen(false); setValue(initialValue || '') }}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >&times;</button>
            </div>
            {label && (
              <div className="mb-2 text-xs text-gray-500">
                <span className="uppercase tracking-wider mr-2">{scope}:</span>
                <span className="font-medium text-gray-700">{label}</span>
              </div>
            )}
            <textarea
              autoFocus
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="Enter your remark here..."
              rows={5}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none resize-none"
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Escape') { setValue(initialValue || ''); setOpen(false) }
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
              }}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Ctrl+Enter to save · Esc to cancel. Leaving the field empty deletes the remark.
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => { setValue(initialValue || ''); setOpen(false) }}
                className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50 transition"
              >Cancel</button>
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 py-2 rounded text-white text-sm font-medium transition disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >{saving ? 'Saving...' : 'Save Remark'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

/**
 * Hook: load all remarks for a TB and return a lookup helper.
 */
export function useRemarks(tbId) {
  const [remarks, setRemarks] = useState({})

  const refresh = async () => {
    if (!tbId) { setRemarks({}); return }
    try {
      const rows = await window.api?.listRemarks(tbId)
      const map = {}
      for (const r of (rows || [])) {
        map[`${r.scope}|${r.scope_key}`] = r.remark
      }
      setRemarks(map)
    } catch {}
  }

  useEffect(() => { refresh() }, [tbId])

  const get = (scope, key) => remarks[`${scope}|${key}`] || ''
  const set = (scope, key, val) => {
    setRemarks(prev => {
      const next = { ...prev }
      const k = `${scope}|${key}`
      if (val && val.trim()) next[k] = val
      else delete next[k]
      return next
    })
  }

  return { remarks, refresh, get, set }
}
