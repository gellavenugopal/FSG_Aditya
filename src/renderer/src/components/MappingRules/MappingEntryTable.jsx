import React, { useState, useMemo } from 'react'

const CONSTITUTION_OPTIONS = [
  { value: 1, label: '1 — Individual / Prop. / Partnership' },
  { value: 2, label: '2 — LLP' },
  { value: 3, label: '3 — Company' },
]

const LEVEL_KEYS = ['alie', 'level1', 'level2', 'level3', 'level4', 'level5', 'level6', 'level7']
const LEVEL_HEADERS = ['ALIE', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6', 'Level 7']

function unique(arr) { return [...new Set(arr.filter(Boolean))] }

function parseSlashOptions(val) {
  if (!val || !val.includes('/')) return null
  return val.split('/').map(s => s.trim()).filter(Boolean)
}

function isSpecifyNature(val) {
  if (!val) return false
  return val.toLowerCase().includes('specify nature')
}

function needsSpecifyNature(levelFormatData, rowValues) {
  // Check if the current row's path in LevelFormat has "Specify Nature" in level7
  const { constitution, alie, level1, level2, level3, level4, level5, level6 } = rowValues
  const match = levelFormatData.find(r => {
    if (r.constitution !== constitution) return false
    const checks = [
      [r.alie,   alie],   [r.level1, level1], [r.level2, level2],
      [r.level3, level3], [r.level4, level4], [r.level5, level5 && !r.level5?.includes('/') ? level5 : null],
    ]
    return checks.every(([a, b]) => !b || !a || a === b)
  })
  return match ? isSpecifyNature(match.level7) : false
}

function CascadeCell({ col, value, onChange, options, isSpecify, isSlash, slashOptions }) {
  if (isSpecify) {
    return (
      <input
        type="text"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder="Specify nature…"
        className="w-full text-xs border border-gray-200 rounded px-2 py-1 text-gray-500 placeholder-gray-300 italic focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
    )
  }
  if (isSlash && slashOptions) {
    return (
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        <option value="">—</option>
        {slashOptions.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
    >
      <option value="">—</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function getOptions(levelFormatData, rowValues, col) {
  const { constitution } = rowValues
  let filtered = levelFormatData.filter(r => r.constitution === constitution)

  if (col === 'alie') return unique(filtered.map(r => r.alie))

  if (rowValues.alie) filtered = filtered.filter(r => r.alie === rowValues.alie)
  if (col === 'level1') return unique(filtered.map(r => r.level1))

  if (rowValues.level1) filtered = filtered.filter(r => r.level1 === rowValues.level1)
  if (col === 'level2') return unique(filtered.map(r => r.level2))

  if (rowValues.level2) filtered = filtered.filter(r => r.level2 === rowValues.level2)
  if (col === 'level3') return unique(filtered.map(r => r.level3))

  if (rowValues.level3) filtered = filtered.filter(r => r.level3 === rowValues.level3)
  if (col === 'level4') return unique(filtered.map(r => r.level4))

  if (rowValues.level4) filtered = filtered.filter(r => r.level4 === rowValues.level4)

  // level5 — check for slash options
  if (col === 'level5') {
    const raw = unique(filtered.map(r => r.level5))
    const allSlash = filtered.find(r => r.level5?.includes('/'))
    if (allSlash) return null  // handled as slash dropdown
    return raw
  }

  if (rowValues.level5) filtered = filtered.filter(r => !r.level5 || r.level5.includes(rowValues.level5))
  if (col === 'level6') {
    const allSlash = filtered.find(r => r.level6?.includes('/'))
    if (allSlash) return null
    return unique(filtered.map(r => r.level6))
  }

  if (col === 'level7') {
    const match = filtered[0]
    if (match && isSpecifyNature(match.level7)) return null  // handled as text input
    return unique(filtered.map(r => r.level7))
  }

  return []
}

function getSlashOptions(levelFormatData, rowValues, col) {
  const { constitution } = rowValues
  let filtered = levelFormatData.filter(r => r.constitution === constitution)
  if (rowValues.alie)   filtered = filtered.filter(r => r.alie === rowValues.alie)
  if (rowValues.level1) filtered = filtered.filter(r => r.level1 === rowValues.level1)
  if (rowValues.level2) filtered = filtered.filter(r => r.level2 === rowValues.level2)
  if (rowValues.level3) filtered = filtered.filter(r => r.level3 === rowValues.level3)
  if (rowValues.level4) filtered = filtered.filter(r => r.level4 === rowValues.level4)

  const raw = unique(filtered.map(r => r[col])).find(v => v?.includes('/'))
  return raw ? raw.split('/').map(s => s.trim()).filter(Boolean) : null
}

function EntryRow({ row, index, levelFormatData, onChange, onDelete }) {
  const updateField = (col, val) => {
    // Reset downstream columns when upstream changes
    const updated = { ...row, [col]: val || null }
    const colIdx = LEVEL_KEYS.indexOf(col)
    LEVEL_KEYS.slice(colIdx + 1).forEach(k => { updated[k] = null })
    onChange(index, updated)
  }

  const cells = LEVEL_KEYS.map(col => {
    const options = col === 'alie' || col.startsWith('level')
      ? getOptions(levelFormatData, row, col)
      : []
    const slashOptions = getSlashOptions(levelFormatData, row, col)
    const isSlash = slashOptions !== null
    const isSpecify = col === 'level7' && needsSpecifyNature(levelFormatData, row)

    return (
      <td key={col} className="px-2 py-1 border-r border-gray-100" style={{ minWidth: col === 'alie' ? 160 : 130 }}>
        <CascadeCell
          col={col}
          value={row[col]}
          onChange={v => updateField(col, v)}
          options={options || []}
          isSpecify={isSpecify}
          isSlash={isSlash}
          slashOptions={slashOptions}
        />
      </td>
    )
  })

  return (
    <tr className={index % 2 === 0 ? 'bg-white' : 'bg-blue-50/20'}>
      <td className="px-2 py-1 border-r border-gray-100 text-center">
        <select
          value={row.constitution || ''}
          onChange={e => updateField('constitution', parseInt(e.target.value))}
          className="text-xs border border-gray-200 rounded px-1 py-1 w-full focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          <option value="">—</option>
          {CONSTITUTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.value}</option>)}
        </select>
      </td>
      {cells}
      <td className="px-2 py-1 text-center">
        <button onClick={() => onDelete(index)} className="text-red-400 hover:text-red-600 text-xs px-1">✕</button>
      </td>
    </tr>
  )
}

const BLANK_ROW = () => ({
  constitution: null, alie: null, level1: null, level2: null, level3: null,
  level4: null, level5: null, level6: null, level7: null
})

export default function MappingEntryTable({ entity, rsId, constitution, levelFormatData }) {
  const [rows, setRows]           = useState([BLANK_ROW(), BLANK_ROW(), BLANK_ROW(), BLANK_ROW(), BLANK_ROW()])
  const [multiCount, setMultiCount] = useState(5)
  const [showMulti, setShowMulti]   = useState(false)
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)

  const updateRow = (idx, updated) => {
    setRows(prev => prev.map((r, i) => i === idx ? updated : r))
  }

  const deleteRow = (idx) => setRows(prev => prev.filter((_, i) => i !== idx))

  const addRows = (n) => {
    setRows(prev => [...prev, ...Array.from({ length: n }, BLANK_ROW)])
  }

  const handleSave = async () => {
    const filled = rows.filter(r => r.constitution && r.alie)
    if (!filled.length) return alert('Add at least one row with Constitution and ALIE filled.')
    setSaving(true)
    try {
      await window.api?.saveUserMapping({ entityId: entity?.id, rows: filled })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      alert('Save failed: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col">
      {/* Table header toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border-b border-blue-100">
        <span className="text-xs font-semibold text-blue-800">Custom Mapping Entry Table</span>
        <span className="text-xs text-gray-400">— Add rows below and save as custom mapping rules</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => addRows(1)}
            className="px-2 py-1 text-xs bg-blue-700 text-white rounded hover:bg-blue-800 transition"
          >
            + Add Row
          </button>
          <button
            onClick={() => setShowMulti(p => !p)}
            className="px-2 py-1 text-xs border border-blue-600 text-blue-700 rounded hover:bg-blue-50 transition"
          >
            + Add Multiple Rows
          </button>
          {showMulti && (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1} max={100}
                value={multiCount}
                onChange={e => setMultiCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none"
              />
              <button
                onClick={() => { addRows(multiCount); setShowMulti(false) }}
                className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition"
              >
                Add {multiCount}
              </button>
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-3 py-1 text-xs rounded font-medium transition ${
              saved ? 'bg-green-600 text-white' : 'bg-blue-700 text-white hover:bg-blue-800'
            } disabled:opacity-40`}
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save as Custom Mapping'}
          </button>
        </div>
      </div>

      {/* Scrollable table */}
      <div className="overflow-auto max-h-64">
        <table className="w-full text-xs border-collapse" style={{ minWidth: 1300 }}>
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="bg-blue-700 text-white px-2 py-2 text-left border-r border-blue-600 w-28">Constitution</th>
              {LEVEL_HEADERS.map(h => (
                <th key={h} className="bg-blue-700 text-white px-2 py-2 text-left border-r border-blue-600 whitespace-nowrap">{h}</th>
              ))}
              <th className="bg-blue-700 text-white px-2 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <EntryRow
                key={idx}
                row={row}
                index={idx}
                levelFormatData={levelFormatData}
                onChange={updateRow}
                onDelete={deleteRow}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
