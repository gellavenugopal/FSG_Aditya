// ── Where a depreciation schedule is stored ──────────────────────────────────
// Per-branch (or non-branch) schedules live in dep_it_schedules /
// dep_comp_schedules keyed by the Trial Balance id. A branch entity may also
// keep ONE schedule for the whole entity (the "Consolidated" pill on the Dep
// tabs, 0.1.16): that has no Trial Balance of its own, so it is stored as an
// entity-level note detail under a reserved negative note number — the same
// table the statutory forms shared across branches already use — which
// needs no new table. The consolidated Notes / Exception Report read it from
// listEntityNoteDetails() (see fetchFinancialsData's consolidated branch).
export const CONSOLIDATED_TB_ID = '__consolidated__'
export const CONSOL_DEP_NOTE = { it: -102, comp: -101 }
const TITLE = { it: 'Consolidated Dep (IT) schedule', comp: 'Consolidated Dep (Comp) schedule' }

export const isConsolidatedTB = (tb) => tb?.id === CONSOLIDATED_TB_ID

/** Returns { get(): Promise<data|null>, save(data): Promise } for the schedule of `kind` ('it' | 'comp'). */
export function depStoreFor(activeTB, entity, kind) {
  if (isConsolidatedTB(activeTB)) {
    const entityId = activeTB.entity_id || entity?.id
    return {
      consolidated: true,
      get: () => window.api?.getEntityNoteDetails(entityId, CONSOL_DEP_NOTE[kind], TITLE[kind]),
      save: (data) => window.api?.saveEntityNoteDetails({ entityId, noteNum: CONSOL_DEP_NOTE[kind], noteTitle: TITLE[kind], data }),
    }
  }
  const tbId = activeTB?.id
  return kind === 'it'
    ? { consolidated: false, get: () => window.api?.depITGet(tbId),   save: (data) => window.api?.depITSave({ tbId, data }) }
    : { consolidated: false, get: () => window.api?.depCompGet(tbId), save: (data) => window.api?.depCompSave({ tbId, data }) }
}

// ── Capital WIP / Intangible WIP — Dep (IT) only ─────────────────────────────
// No depreciation is charged on assets still under construction/development,
// so these two figures are entered manually (not derived from a ledger's
// Block/Opening WDV/Additions/Deduction, which only apply once an asset is
// actually in use) and shown as extra rows below the Block Summary's own
// Grand Total, feeding a combined "Total PPE & Intangible Assets including
// work in progress" figure into the PPE note. Kept out of print (UI, PDF,
// Excel) entirely whenever nothing has actually been entered — see
// wipHasFigures.
export const EMPTY_WIP = { capitalCY: '', intangibleCY: '', prevYearTotal: '' }
const wipNum = v => parseFloat(String(v ?? '').replace(/,/g, '')) || 0
export const wipCYTotal = (wip) => wipNum(wip?.capitalCY) + wipNum(wip?.intangibleCY)
export const wipHasFigures = (wip) => !!wip && (wipNum(wip.capitalCY) !== 0 || wipNum(wip.intangibleCY) !== 0 || wipNum(wip.prevYearTotal) !== 0)

/** Pick the consolidated schedules out of an entity's note-details list. */
export function consolidatedDepFromNoteDetails(ndList) {
  const find = (num) => (ndList || []).find(nd => Number(nd.note_num) === num)?.data || null
  return { depITData: find(CONSOL_DEP_NOTE.it), depCompData: find(CONSOL_DEP_NOTE.comp) }
}
