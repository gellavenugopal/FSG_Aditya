import React, { useState, useEffect, useMemo } from 'react'

// ── Column definitions per map type ──────────────────────────────────────────

const MAP_CONFIGS = {
  map1: {
    title: 'Map 1 — Stage 1: Tally Group → Level 1',
    description: 'Maps the Pre-Primary Tally group value (value immediately before "Primary" in the hierarchy chain) to a Level 1 (Mapping1 Resultant) classification.',
    columns: [
      { key: 'tally_pre_primary',   label: 'Tally Pre-Primary',   hint: 'Value just before "Primary" in Tally group hierarchy' },
      { key: 'mapping1_resultant',  label: 'Mapping 1 Resultant', hint: 'Resulting Level 1 classification' },
    ],
    emptyMsg: 'No Map 1 rows for this constitution.',
  },
  map2: {
    title: 'Map 2 — Stage 2: Keywords → Level 2',
    description: 'Maps keyword patterns (matched against Tally group hierarchy FIRST, then ledger name as fallback) to a Level 2 classification within a given Level 1.',
    columns: [
      { key: 'mapping1_resultant',  label: 'Level 1 (Scope)',     hint: 'Map2 rule applies only within this Level 1' },
      { key: 'keywords',            label: 'Keywords',             hint: 'Pipe-separated (|) keyword patterns; matched as whole words' },
      { key: 'mapping2_resultant',  label: 'Mapping 2 Resultant', hint: 'Resulting Level 2 classification' },
      { key: 'priority',            label: 'Priority',             hint: 'Lower number = higher priority when multiple rules match' },
      { key: 'notes',               label: 'Notes',                hint: 'Explanation or source reference' },
    ],
    emptyMsg: 'No Map 2 rows for this constitution.',
  },
  map3: {
    title: 'Map 3 — Stage 3: Keywords → Level 3',
    description: 'Maps keyword patterns (matched against Tally group hierarchy FIRST, then ledger name as fallback) to a Level 3 classification within a given Level 1 + Level 2.',
    columns: [
      { key: 'mapping1_resultant',  label: 'Level 1 (Scope)',     hint: 'Map3 rule applies within this Level 1' },
      { key: 'mapping2_resultant',  label: 'Level 2 (Scope)',     hint: 'Map3 rule applies within this Level 2' },
      { key: 'keywords',            label: 'Keywords',             hint: 'Pipe-separated (|) keyword patterns; matched as whole words' },
      { key: 'mapping3_resultant',  label: 'Mapping 3 Resultant', hint: 'Resulting Level 3 classification' },
      { key: 'priority',            label: 'Priority',             hint: 'Lower number = higher priority when multiple rules match' },
      { key: 'notes',               label: 'Notes',                hint: 'Explanation or source reference' },
    ],
    emptyMsg: 'No Map 3 rows for this constitution.',
  },
}

// ── Highlight matching text ────────────────────────────────────────────────────
function Highlight({ text, query }) {
  if (!text || !query) return <span>{text ?? '—'}</span>
  const idx = String(text).toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <span>{text}</span>
  const s = String(text)
  return (
    <span>
      {s.slice(0, idx)}
      <mark className="bg-yellow-200 text-yellow-900 rounded px-0.5">{s.slice(idx, idx + query.length)}</mark>
      {s.slice(idx + query.length)}
    </span>
  )
}

// ── KeywordCell: renders pipe-separated keywords as chips ─────────────────────
function KeywordCell({ val, query }) {
  if (!val) return <span className="text-gray-300">—</span>
  const parts = val.split('|').map(k => k.trim()).filter(Boolean)
  if (parts.length <= 1) return <Highlight text={val} query={query} />
  return (
    <div className="flex flex-wrap gap-1">
      {parts.map((k, i) => (
        <span key={i} className="inline-block bg-blue-50 border border-blue-200 text-blue-800 rounded px-1.5 py-0.5 text-xs whitespace-nowrap">
          <Highlight text={k} query={query} />
        </span>
      ))}
    </div>
  )
}

// ── Cell renderer ─────────────────────────────────────────────────────────────
function Cell({ col, val, query }) {
  if (val === null || val === undefined || val === '') {
    return <span className="text-gray-300">—</span>
  }
  if (col.key === 'keywords') return <KeywordCell val={val} query={query} />
  if (col.key === 'priority') {
    return (
      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
        val <= 1 ? 'bg-green-100 text-green-800' :
        val <= 3 ? 'bg-amber-100 text-amber-800' :
                   'bg-gray-100 text-gray-600'
      }`}>{val}</span>
    )
  }
  return <Highlight text={String(val)} query={query} />
}

// ── Main MapSheetView ─────────────────────────────────────────────────────────
export default function MapSheetView({ mapType, rsId, constitution }) {
  const config = MAP_CONFIGS[mapType]
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch]   = useState('')

  useEffect(() => {
    if (!rsId) return
    setLoading(true)
    window.api?.getMapSheets(rsId, constitution)
      .then(data => setRows(data?.[mapType] || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [rsId, constitution, mapType])

  // ── Grouping by Level 1 (Map2) or Level 1+Level 2 (Map3) ─────────────────
  const filtered = useMemo(() => {
    if (!search) return rows
    const q = search.toLowerCase()
    return rows.filter(r =>
      config.columns.some(col => {
        const v = r[col.key]
        return v && String(v).toLowerCase().includes(q)
      })
    )
  }, [rows, search, config.columns])

  // ── Group rows for Map2 and Map3 ──────────────────────────────────────────
  const grouped = useMemo(() => {
    if (mapType === 'map1') return null
    const groups = []
    const seen = {}
    for (const row of filtered) {
      const key = mapType === 'map2'
        ? (row.mapping1_resultant || '(no Level 1)')
        : `${row.mapping1_resultant || ''}||${row.mapping2_resultant || ''}`
      if (!seen[key]) {
        seen[key] = { key, label1: row.mapping1_resultant, label2: row.mapping2_resultant, rows: [] }
        groups.push(seen[key])
      }
      seen[key].rows.push(row)
    }
    return groups
  }, [filtered, mapType])

  if (!config) return null

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      {/* Header */}
      <div className="shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-blue-900">{config.title}</h3>
            <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">{config.description}</p>
          </div>
          {/* Stats */}
          <div className="shrink-0 flex gap-4 text-xs text-gray-500">
            <span className="bg-blue-50 border border-blue-100 rounded px-2 py-1">
              <strong className="text-blue-800">{filtered.length}</strong>
              {search ? ` of ${rows.length}` : ''} rule{rows.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Info banner: group-first explanation for Map2/Map3 */}
        {(mapType === 'map2' || mapType === 'map3') && (
          <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-800">
            <span className="shrink-0 mt-0.5">⚡</span>
            <span>
              <strong>Keyword matching order:</strong> Keywords are checked against the Tally group
              hierarchy chain <em>first</em> (group-based priority). The ledger name is only used as
              a fallback if no group match is found.
            </span>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="shrink-0 flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
          </svg>
          <input
            type="text"
            placeholder={`Search ${mapType === 'map1' ? 'Map 1' : mapType === 'map2' ? 'Map 2' : 'Map 3'}…`}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-8 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-400 focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >✕</button>
          )}
        </div>
        {search && filtered.length === 0 && (
          <span className="text-xs text-amber-600">No matches for "{search}"</span>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto border border-blue-100 rounded">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
            <svg className="w-10 h-10 text-blue-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm">{config.emptyMsg}</p>
            <p className="text-xs text-gray-400">Upload a mapping file in the Model Format tab to populate rules.</p>
          </div>
        ) : mapType === 'map1' ? (
          // ── Map 1: flat table ────────────────────────────────────────────
          <FlatTable rows={filtered} columns={config.columns} search={search} />
        ) : (
          // ── Map 2/3: grouped view ────────────────────────────────────────
          <GroupedTable groups={grouped} columns={config.columns} search={search} mapType={mapType} />
        )}
      </div>
    </div>
  )
}

// ── Flat table (Map 1) ────────────────────────────────────────────────────────
function FlatTable({ rows, columns, search }) {
  return (
    <table className="w-full text-xs border-collapse" style={{ minWidth: 600 }}>
      <thead className="sticky top-0 z-10">
        <tr>
          <th className="bg-blue-800 text-white px-3 py-2 text-left font-semibold border-r border-blue-700 w-10">#</th>
          {columns.map(col => (
            <th key={col.key} title={col.hint}
              className="bg-blue-800 text-white px-3 py-2 text-left font-semibold border-r border-blue-700 whitespace-nowrap cursor-help">
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={row.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-blue-50/30'} hover:bg-blue-50 transition-colors`}>
            <td className="px-3 py-2 text-gray-400 border-r border-gray-100 text-center">{idx + 1}</td>
            {columns.map(col => (
              <td key={col.key} className="px-3 py-2 border-r border-gray-100 max-w-xs align-top">
                <Cell col={col} val={row[col.key]} query={search} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Grouped table (Map 2 / Map 3) ─────────────────────────────────────────────
function GroupedTable({ groups, columns, search, mapType }) {
  const [collapsed, setCollapsed] = useState({})
  const toggleGroup = key => setCollapsed(p => ({ ...p, [key]: !p[key] }))

  // Columns to show inside each group (exclude grouping columns from the inline header)
  const groupingKeys = mapType === 'map2'
    ? ['mapping1_resultant']
    : ['mapping1_resultant', 'mapping2_resultant']
  const innerColumns = columns.filter(c => !groupingKeys.includes(c.key))

  let rowNum = 0

  return (
    <table className="w-full text-xs border-collapse" style={{ minWidth: 700 }}>
      <thead className="sticky top-0 z-10">
        <tr>
          <th className="bg-blue-800 text-white px-3 py-2 text-left font-semibold border-r border-blue-700 w-10">#</th>
          {innerColumns.map(col => (
            <th key={col.key} title={col.hint}
              className="bg-blue-800 text-white px-3 py-2 text-left font-semibold border-r border-blue-700 whitespace-nowrap cursor-help">
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map(group => {
          const isCollapsed = collapsed[group.key]
          return (
            <React.Fragment key={group.key}>
              {/* Group header row */}
              <tr
                className="bg-blue-700 cursor-pointer select-none hover:bg-blue-600 transition-colors"
                onClick={() => toggleGroup(group.key)}
              >
                <td colSpan={innerColumns.length + 1} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <svg
                      className={`w-3.5 h-3.5 text-blue-200 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    {mapType === 'map2' ? (
                      <span className="text-white font-semibold text-xs">
                        Level 1: <span className="text-blue-200">{group.label1 || '—'}</span>
                        <span className="ml-3 text-blue-300 font-normal">{group.rows.length} rule{group.rows.length !== 1 ? 's' : ''}</span>
                      </span>
                    ) : (
                      <span className="text-white font-semibold text-xs">
                        Level 1: <span className="text-blue-200">{group.label1 || '—'}</span>
                        <span className="mx-2 text-blue-400">›</span>
                        Level 2: <span className="text-blue-200">{group.label2 || '—'}</span>
                        <span className="ml-3 text-blue-300 font-normal">{group.rows.length} rule{group.rows.length !== 1 ? 's' : ''}</span>
                      </span>
                    )}
                  </div>
                </td>
              </tr>

              {/* Group data rows */}
              {!isCollapsed && group.rows.map((row, idx) => {
                rowNum++
                const n = rowNum
                return (
                  <tr key={row.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-blue-50/30'} hover:bg-blue-50 transition-colors`}>
                    <td className="px-3 py-2 text-gray-400 border-r border-gray-100 text-center">{n}</td>
                    {innerColumns.map(col => (
                      <td key={col.key} className="px-3 py-2 border-r border-gray-100 max-w-xs align-top">
                        <Cell col={col} val={row[col.key]} query={search} />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </React.Fragment>
          )
        })}
      </tbody>
    </table>
  )
}
