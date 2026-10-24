import React, { useState, useEffect } from 'react'
import ModelFormat from './ModelFormat'
import MapSheetView from './MapSheetView'

const SUB_TABS = [
  { id: 'Model Format', label: 'Model Format' },
  { id: 'Map 1',        label: 'Map 1' },
  { id: 'Map 2',        label: 'Map 2' },
  { id: 'Map 3',        label: 'Map 3' },
]

const CONSTITUTION_MAP = { 1: 'Individual/Prop./Partnership', 2: 'LLP', 3: 'Company' }

export default function MappingRules({ entity, activeRsId, onRsChange }) {
  const [subTab, setSubTab]       = useState('Model Format')
  const [sharedRsId, setSharedRsId] = useState(activeRsId)
  const [sharedConstitution, setSharedConstitution] = useState(entity?.constitution || 3)
  const [ruleSets, setRuleSets]   = useState([])

  // Keep rsId in sync with parent
  useEffect(() => {
    if (activeRsId) setSharedRsId(activeRsId)
  }, [activeRsId])

  // Keep constitution in sync with entity
  useEffect(() => {
    if (entity?.constitution) setSharedConstitution(entity.constitution)
  }, [entity])

  // Load rule sets for the Map 1/2/3 constitution + rsId toolbar
  useEffect(() => {
    if (!entity) return
    window.api?.getRuleSets(entity.id).then(rs => {
      setRuleSets(rs)
      if (!sharedRsId && rs.length) {
        const def = rs.find(r => r.is_default) || rs[0]
        setSharedRsId(def.id)
        onRsChange?.(def.id)
      }
    }).catch(() => {})
  }, [entity?.id])

  const handleRsChange = (id) => {
    setSharedRsId(id)
    onRsChange?.(id)
  }

  const isMapTab = subTab === 'Map 1' || subTab === 'Map 2' || subTab === 'Map 3'
  const mapType  = subTab === 'Map 1' ? 'map1' : subTab === 'Map 2' ? 'map2' : 'map3'

  return (
    <div className="flex flex-col h-full">
      {/* Entity context banner */}
      {entity?.has_branches && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-50 border-b border-amber-200 shrink-0">
          <span className="text-[10px] text-amber-700 font-semibold uppercase tracking-wide">Scope:</span>
          <span className="text-xs text-amber-800 font-medium">{entity.name}</span>
          <span className="text-[10px] text-amber-600 bg-amber-100 border border-amber-300 rounded px-2 py-0.5">
            Entity-level rules — apply to all branches
          </span>
        </div>
      )}
      {/* Sub-tab bar */}
      <div className="flex items-end gap-0 bg-blue-50 border-b border-blue-100 px-6 shrink-0">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-4 py-2 text-sm transition-all duration-150 ${
              subTab === t.id
                ? 'bg-white border border-b-white border-blue-100 text-blue-800 font-semibold -mb-px rounded-t'
                : 'text-gray-500 hover:text-blue-700'
            }`}
          >
            {t.label}
          </button>
        ))}

        {/* Shared Constitution + Rule Set selectors for Map 1/2/3 tabs */}
        {isMapTab && (
          <div className="ml-auto flex items-center gap-3 pb-1">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-gray-500 whitespace-nowrap">Constitution:</label>
              <select
                value={sharedConstitution}
                onChange={e => setSharedConstitution(parseInt(e.target.value))}
                className="border border-gray-300 rounded px-2 py-1 text-xs focus:ring-2 focus:ring-blue-400 focus:outline-none"
              >
                <option value={1}>1 — Individual / Prop. / Partnership</option>
                <option value={2}>2 — LLP</option>
                <option value={3}>3 — Company</option>
              </select>
            </div>
            {ruleSets.length > 0 && (
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-gray-500">Rule Set:</label>
                <select
                  value={sharedRsId || ''}
                  onChange={e => handleRsChange(parseInt(e.target.value))}
                  className="border border-gray-300 rounded px-2 py-1 text-xs focus:ring-2 focus:ring-blue-400 focus:outline-none max-w-[180px]"
                >
                  {ruleSets.map(rs => (
                    <option key={rs.id} value={rs.id}>
                      {rs.name}{rs.is_default ? ' (Default)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sub-tab content */}
      <div className="flex-1 overflow-hidden">
        {subTab === 'Model Format' && (
          <ModelFormat
            entity={entity}
            activeRsId={sharedRsId}
            onRsChange={handleRsChange}
          />
        )}
        {isMapTab && (
          <MapSheetView
            key={`${mapType}-${sharedRsId}-${sharedConstitution}`}
            mapType={mapType}
            rsId={sharedRsId}
            constitution={sharedConstitution}
          />
        )}
      </div>
    </div>
  )
}
