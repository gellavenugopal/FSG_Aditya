// Which Trial Balances make up the Consolidated statements of an Auditee with branches.
//
// An Auditee carries a Trial Balance per branch per Financial Year. The Consolidated view used to add together EVERY Trial Balance of the
// Auditee, whatever year it was for. Now:
//   - Current year  : the Trial Balances of the Financial Year on screen (all branches), unless the CA ticked a different set;
//   - Previous year : the Trial Balances of the Financial Year before it when there are any (its closing balances become the Previous Year
//                     column), unless the CA ticked a different set; with none, the opening balances of the current year are used as before.
// The CA's choice is remembered per Auditee and Financial Year in this browser profile; every screen and export reads it from here.
import React from 'react'

// (guarded: the test harnesses bundle this file with a React stand-in that has no createContext)
export const ConsolidationContext = typeof React.createContext === 'function' ? React.createContext(null) : null

const KEY = (epId) => `fsg-consolidation-${epId == null ? 'latest' : epId}`

export function loadOverride(entityPeriodId) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(entityPeriodId)) || 'null')
    if (v && typeof v === 'object') return { cy: Array.isArray(v.cy) ? v.cy : null, py: Array.isArray(v.py) ? v.py : null }
  } catch {}
  return { cy: null, py: null }
}

export function saveOverride(entityPeriodId, ov) {
  try {
    if (!ov || (ov.cy == null && ov.py == null)) localStorage.removeItem(KEY(entityPeriodId))
    else localStorage.setItem(KEY(entityPeriodId), JSON.stringify({ cy: ov.cy ?? null, py: ov.py ?? null }))
  } catch {}
}

// Pure part (tested): the defaults and the override applied to the list of Trial Balances and Financial Years.
export function chooseConsolidation({ tbs, periods, entityPeriodId, override }) {
  const list = Array.isArray(tbs) ? tbs : []
  const pers = Array.isArray(periods) ? periods : []
  const epId = entityPeriodId != null ? entityPeriodId : (pers[0] ? pers[0].id : null)
  const idx = pers.findIndex(p => p.id === epId)
  const prior = idx >= 0 ? pers[idx + 1] : null
  const ofPeriod = (id) => list.filter(t => id != null && t.entity_period_id === id).map(t => t.id)
  let cyDefault = ofPeriod(epId)
  if (!cyDefault.length) cyDefault = list.filter(t => t.entity_period_id == null).map(t => t.id)   // old Trial Balances not tied to a year
  const pyDefault = prior ? ofPeriod(prior.id) : []
  const known = new Set(list.map(t => t.id))
  const clean = (a) => (Array.isArray(a) ? a.filter(id => known.has(id)) : null)
  const cyO = clean(override && override.cy), pyO = clean(override && override.py)
  const cyIds = cyO != null ? cyO : cyDefault
  // never the same Trial Balance on both sides
  const pyIds = (pyO != null ? pyO : pyDefault).filter(id => !cyIds.includes(id))
  return { entityPeriodId: epId, cyIds, pyIds, cyDefault, pyDefault, customCY: cyO != null, customPY: pyO != null, tbs: list, periods: pers }
}

export async function resolveConsolidationSelection(entityId, entityPeriodId) {
  const [tbs, periods] = await Promise.all([
    Promise.resolve(window.api?.getBranches?.(entityId)).catch(() => []),
    Promise.resolve(window.api?.listEntityPeriods?.(entityId)).catch(() => []),
  ])
  const epId = entityPeriodId != null ? entityPeriodId : ((periods || [])[0] ? periods[0].id : null)
  return chooseConsolidation({ tbs: tbs || [], periods: periods || [], entityPeriodId: epId, override: loadOverride(epId) })
}
