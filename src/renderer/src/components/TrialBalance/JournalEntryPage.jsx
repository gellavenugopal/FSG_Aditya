import React, { useState, useEffect, useMemo } from 'react'

function fmtAmt(n) {
  const v = Math.abs(parseFloat(n) || 0)
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const emptyEntries = () => ([
  { type: 'Dr', ledgerName: '', amount: '', isNew: false, mapping1: '', mapping2: '', mapping3: '' },
  { type: 'Cr', ledgerName: '', amount: '', isNew: false, mapping1: '', mapping2: '', mapping3: '' },
])

export default function JournalEntryPage({ entity, activeTB, activeRsId }) {
  const tbId = activeTB?.id
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [entries, setEntries] = useState(emptyEntries)
  const [existingLedgers, setExistingLedgers] = useState([])
  const [levelFormat, setLevelFormat] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Load existing ledgers + level format whenever the active TB changes
  useEffect(() => {
    if (!tbId) return
    window.api?.getLedgersForTB(tbId).then(data => setExistingLedgers(data || [])).catch(() => {})
    if (entity?.constitution) {
      window.api?.getLevelFormat(entity.constitution, activeRsId || null)
        .then(data => setLevelFormat(data || []))
        .catch(() => {})
    }
  }, [tbId, entity?.constitution, activeRsId])

  useEffect(() => {
    if (!success) return
    const t = setTimeout(() => setSuccess(''), 3000)
    return () => clearTimeout(t)
  }, [success])

  // Build cascading mapping options
  const unique = (arr) => [...new Set(arr.filter(Boolean))]
  const m1Options = useMemo(() => unique(levelFormat.map(r => r.level1)), [levelFormat])
  const m2ByM1 = useMemo(() => {
    const map = {}
    for (const r of levelFormat) {
      if (!r.level1 || !r.level2) continue
      if (!map[r.level1]) map[r.level1] = new Set()
      map[r.level1].add(r.level2)
    }
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]]))
  }, [levelFormat])

  // Mapping 3 under a Mapping 1 + 2; a Level Format cell holding alternates ("Secured, considered good / Unsecured, considered good /
  // Doubtful") is offered one alternate at a time - exactly one is the ledger's.
  const m3ByM1M2 = useMemo(() => {
    const map = {}
    for (const r of levelFormat) {
      if (!r.level1 || !r.level2 || !r.level3) continue
      const key = `${r.level1}||${r.level2}`
      if (!map[key]) map[key] = new Set()
      const parts = String(r.level3).includes('/') ? String(r.level3).split('/').map(s => s.trim()).filter(Boolean) : [r.level3]
      for (const p of (parts.length ? parts : [r.level3])) map[key].add(p)
    }
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]]))
  }, [levelFormat])

  const totalDr = entries.filter(e => e.type === 'Dr').reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
  const totalCr = entries.filter(e => e.type === 'Cr').reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
  const diff = totalDr - totalCr
  const isBalanced = Math.abs(diff) < 0.01 && totalDr > 0

  const updateEntry = (idx, field, value) => {
    setEntries(prev => prev.map((e, i) => {
      if (i !== idx) return e
      const updated = { ...e, [field]: value }
      if (field === 'ledgerName') {
        const existing = existingLedgers.find(l =>
          l.name && l.name.toLowerCase().trim() === value.toLowerCase().trim()
        )
        updated.isNew = !existing && value.trim().length > 0
        if (existing) {
          updated.mapping1 = existing.mapping1_resultant || ''
          updated.mapping2 = existing.mapping2_resultant || ''
          updated.mapping3 = existing.mapping3_resultant || ''
        }
      }
      if (field === 'mapping1') { updated.mapping2 = ''; updated.mapping3 = '' }
      if (field === 'mapping2') {
        // Mapping 3 opens on "Unsecured, considered good" when it is among the alternates (the CA can change it)
        const opts = m3ByM1M2[`${updated.mapping1}||${value}`] || []
        updated.mapping3 = opts.length > 1 ? (opts.find(o => /unsecured.*considered\s*good/i.test(o)) || '') : ''
      }
      return updated
    }))
  }

  const addRow = (type = 'Dr') => {
    setEntries(prev => [...prev, { type, ledgerName: '', amount: '', isNew: false, mapping1: '', mapping2: '', mapping3: '' }])
  }

  const removeRow = (idx) => {
    if (entries.length <= 2) return
    setEntries(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSave = async () => {
    setError('')
    if (!tbId) { setError('Select a Trial Balance first (Trial Balance → Actual TB).'); return }
    if (!isBalanced) {
      setError(`Dr and Cr totals must match. Difference: ${fmtAmt(diff)}`)
      return
    }
    for (const [i, e] of entries.entries()) {
      if (!e.ledgerName.trim()) { setError(`Row ${i + 1}: Ledger name is required`); return }
      if (!e.amount || parseFloat(e.amount) <= 0) { setError(`Row ${i + 1}: Amount must be positive`); return }
      if (e.isNew) {
        if (!e.mapping1) { setError(`Row ${i + 1}: New ledger "${e.ledgerName}" requires Level 1`); return }
        if (!e.mapping2) { setError(`Row ${i + 1}: New ledger "${e.ledgerName}" requires Level 2`); return }
        if ((m3ByM1M2[`${e.mapping1}||${e.mapping2}`] || []).length && !e.mapping3) { setError(`Row ${i + 1}: New ledger "${e.ledgerName}" requires Level 3`); return }
      }
    }

    setSaving(true)
    try {
      await window.api?.saveJournalEntry({
        tbId,
        date,
        entries: entries.map(e => ({
          type: e.type,
          ledgerName: e.ledgerName.trim(),
          amount: parseFloat(e.amount),
          isNew: e.isNew,
          mapping1: e.mapping1 || null,
          mapping2: e.mapping2 || null,
          mapping3: e.mapping3 || null,
        })),
      })
      setSuccess('Journal entry saved.')
      setEntries(emptyEntries())
      window.api?.getLedgersForTB(tbId).then(data => setExistingLedgers(data || [])).catch(() => {})
    } catch (err) {
      setError(err.message || 'Failed to save journal entry')
    } finally {
      setSaving(false)
    }
  }

  if (!tbId) {
    return (
      <div className="flex flex-col h-full p-4">
        <div className="text-amber-600 text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2">
          No Trial Balance selected — go to Trial Balance → Actual TB to select one before adding a Journal Entry.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-4 overflow-y-auto">
      <div className="flex items-start justify-between mb-4">
        <h2 className="text-base font-bold text-blue-900">Add Journal Entry</h2>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Date:</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Entries table */}
      <div className="border border-gray-200 rounded overflow-hidden mb-3" style={{ maxWidth: '1100px' }}>
        <table className="w-full text-xs">
          <thead className="bg-blue-50 border-b border-blue-200">
            <tr>
              <th className="text-left py-1.5 px-2 font-semibold text-blue-900 w-[5%]">#</th>
              <th className="text-left py-1.5 px-2 font-semibold text-blue-900 w-[22%]">Ledger Name</th>
              <th className="text-left py-1.5 px-2 font-semibold text-blue-900 w-[14%]">Level 1</th>
              <th className="text-left py-1.5 px-2 font-semibold text-blue-900 w-[14%]">Level 2</th>
              <th className="text-left py-1.5 px-2 font-semibold text-blue-900 w-[16%]">Level 3</th>
              <th className="text-left py-1.5 px-2 font-semibold text-blue-900 w-[9%]">Dr / Cr</th>
              <th className="text-right py-1.5 px-2 font-semibold text-blue-900 w-[14%]">Amount</th>
              <th className="py-1.5 px-2 w-[6%]"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const m2opts = e.mapping1 ? (m2ByM1[e.mapping1] || []) : []
              const m3opts = (e.mapping1 && e.mapping2) ? (m3ByM1M2[`${e.mapping1}||${e.mapping2}`] || []) : []
              return (
                <tr key={i} className="border-b border-gray-100">
                  <td className="py-1 px-2 text-gray-500">{i + 1}</td>
                  <td className="py-1 px-2">
                    <input
                      type="text"
                      list={`ledger-list-${i}`}
                      value={e.ledgerName}
                      onChange={ev => updateEntry(i, 'ledgerName', ev.target.value)}
                      placeholder="Type or select ledger"
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:ring-2 focus:ring-blue-400 focus:outline-none"
                    />
                    <datalist id={`ledger-list-${i}`}>
                      {existingLedgers.map(l => (
                        <option key={l.name} value={l.name}>{l.mapping1_resultant || ''}</option>
                      ))}
                    </datalist>
                    {e.isNew && (
                      <div className="text-[10px] text-amber-600 mt-0.5">NEW ledger — map Level 1, Level 2 and Level 3</div>
                    )}
                  </td>
                  <td className="py-1 px-2">
                    {e.isNew ? (
                      <select
                        value={e.mapping1}
                        onChange={ev => updateEntry(i, 'mapping1', ev.target.value)}
                        className="w-full border border-gray-300 rounded px-1 py-1 text-xs focus:ring-2 focus:ring-blue-400 focus:outline-none"
                      >
                        <option value="">—</option>
                        {m1Options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs text-gray-500 italic">{e.mapping1 || '-'}</span>
                    )}
                  </td>
                  <td className="py-1 px-2">
                    {e.isNew ? (
                      <select
                        value={e.mapping2}
                        onChange={ev => updateEntry(i, 'mapping2', ev.target.value)}
                        disabled={!e.mapping1}
                        className="w-full border border-gray-300 rounded px-1 py-1 text-xs focus:ring-2 focus:ring-blue-400 focus:outline-none disabled:bg-gray-100"
                      >
                        <option value="">—</option>
                        {m2opts.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs text-gray-500 italic">{e.mapping2 || '-'}</span>
                    )}
                  </td>
                  <td className="py-1 px-2">
                    {e.isNew ? (
                      <select
                        value={e.mapping3}
                        onChange={ev => updateEntry(i, 'mapping3', ev.target.value)}
                        disabled={!e.mapping2 || !m3opts.length}
                        className="w-full border border-gray-300 rounded px-1 py-1 text-xs focus:ring-2 focus:ring-blue-400 focus:outline-none disabled:bg-gray-100"
                      >
                        <option value="">—</option>
                        {m3opts.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs text-gray-500 italic">{e.mapping3 || '-'}</span>
                    )}
                  </td>
                  <td className="py-1 px-2">
                    <select
                      value={e.type}
                      onChange={ev => updateEntry(i, 'type', ev.target.value)}
                      className={`w-full border rounded px-1 py-1 text-xs font-semibold focus:ring-2 focus:ring-blue-400 focus:outline-none
                        ${e.type === 'Dr' ? 'border-blue-400 text-blue-700 bg-blue-50' : 'border-green-400 text-green-700 bg-green-50'}`}
                    >
                      <option value="Dr">Dr (Debit)</option>
                      <option value="Cr">Cr (Credit)</option>
                    </select>
                  </td>
                  <td className="py-1 px-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={e.amount}
                      onChange={ev => updateEntry(i, 'amount', ev.target.value)}
                      placeholder="0.00"
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right font-mono focus:ring-2 focus:ring-blue-400 focus:outline-none"
                    />
                  </td>
                  <td className="py-1 px-2 text-center">
                    {entries.length > 2 && (
                      <button
                        onClick={() => removeRow(i)}
                        className="text-red-500 hover:text-red-700 text-xs"
                        title="Remove row"
                      >
                        &times;
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-blue-50 border-t-2 border-blue-300">
            <tr>
              <td colSpan={4} className="py-1.5 px-2 font-semibold text-gray-700">
                <div className="flex gap-2">
                  <button
                    onClick={() => addRow('Dr')}
                    className="px-2 py-1 text-[11px] border border-blue-400 text-blue-700 rounded hover:bg-blue-50 transition font-medium"
                  >
                    + Add Dr Row
                  </button>
                  <button
                    onClick={() => addRow('Cr')}
                    className="px-2 py-1 text-[11px] border border-green-400 text-green-700 rounded hover:bg-green-50 transition font-medium"
                  >
                    + Add Cr Row
                  </button>
                </div>
              </td>
              <td className="py-1.5 px-2 text-right font-semibold text-blue-900 text-xs">
                <div>Total Dr:</div>
                <div>Total Cr:</div>
                <div className={`mt-0.5 ${isBalanced ? 'text-green-700' : 'text-red-600'}`}>
                  {isBalanced ? 'Balanced' : 'Difference:'}
                </div>
              </td>
              <td className="py-1.5 px-2 text-right font-mono text-xs">
                <div className="text-blue-700 font-semibold">{fmtAmt(totalDr)}</div>
                <div className="text-green-700 font-semibold">{fmtAmt(totalCr)}</div>
                <div className={`mt-0.5 font-bold ${isBalanced ? 'text-green-700' : 'text-red-600'}`}>
                  {isBalanced ? '✓' : fmtAmt(Math.abs(diff))}
                </div>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {error && (
        <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded px-3 py-2 mb-3" style={{ maxWidth: '1100px' }}>
          {error}
        </div>
      )}
      {success && (
        <div className="text-green-700 text-sm bg-green-50 border border-green-200 rounded px-3 py-2 mb-3" style={{ maxWidth: '1100px' }}>
          {success}
        </div>
      )}

      <p className="text-xs text-gray-400 mb-3" style={{ maxWidth: '1100px' }}>
        Dr entries are stored as negative closing balance. Cr entries as positive.
        Totals must match before saving. New ledgers require Level 1 and Level 2 for mapping.
      </p>

      <div className="flex gap-2" style={{ maxWidth: '1100px' }}>
        <button
          onClick={handleSave}
          disabled={saving || !isBalanced}
          className="px-6 py-2 text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-40 transition" style={{ background: 'var(--color-primary)' }}
        >
          {saving ? 'Saving...' : 'Save Journal Entry'}
        </button>
      </div>
    </div>
  )
}
