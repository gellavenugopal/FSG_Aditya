import React, { useState, useEffect, useCallback, useRef } from 'react'
import TopBar from './components/Layout/TopBar'
import NavTabs, { TOP_SHORTCUTS } from './components/Layout/NavTabs'
import Master from './components/Master'
import UploadTB from './components/TrialBalance/UploadTB'
import ActualTBTable from './components/TrialBalance/ActualTBTable'
import JournalEntryPage from './components/TrialBalance/JournalEntryPage'
import StockPage from './components/Stock/StockPage'
import TallyTBUpload from './components/TallyTBUpload'
import MappingRules from './components/MappingRules'
import MappedTB from './components/MappedTB'
import MappedTBWithRemarks from './components/MappedTBWithRemarks'
import Exceptions from './components/Exceptions'
import ExceptionReport from './components/ExceptionReport'
import Depreciation from './components/Depreciation'
import DepreciationIT from './components/DepreciationIT'
import DepreciationComp from './components/DepreciationComp'
import BS from './components/BS'
import PL from './components/PL'
import CFS from './components/CFS'
import TaxComputation from './components/TaxComputation'
import DeferredTax from './components/DeferredTax'
import Notes from './components/Notes'
import Annexures from './components/Annexures'
import ITR from './components/ITR'
import { ConsolidationContext } from './utils/consolidationSelection'
import { consolidatedPeriodOf } from './utils/consolidatedPeriod'
import Ratio from './components/Ratio'
import Format from './components/Format'
import PPE from './components/PPE'
import GeneralNotes from './components/GeneralNotes'
import GenerateFinancials from './components/GenerateFinancials'
import { AuthGate, PasswordChange } from './components/Engagements/EngagementHub'
import SettingsModal from './components/shared/SettingsModal'
import DBBanner from './components/shared/DBBanner'
import BranchModeBar from './components/shared/BranchModeBar'
import AdjustmentNotice from './components/shared/AdjustmentNotice'
import { undo as undoCategorisation, redo as redoCategorisation, canUndo as canUndoCat, canRedo as canRedoCat, subscribeUndo, peekUndoLabel, peekRedoLabel } from './utils/undoManager'

const THEME_KEY = 'vera-theme'

// trial_balances.uploaded_at is a TIMESTAMPTZ column — pg parses it into a
// native JS Date on the main-process side, and Electron's IPC structured
// clone preserves it as a real Date instance all the way into the renderer
// (unlike JSON, which would have stringified it). Rendering that object
// directly as a React child throws "Objects are not valid as a React child",
// crashing the whole app with no visible cause — format it explicitly.
function fmtUploadedAt(v) {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(v)
  if (isNaN(d.getTime())) return String(v)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}-${mm}-${d.getFullYear()}`
}

// Top-level menu bar: Settings > Trial Balance > Stock > Mapping > Dep > BS > PL > Notes > Annexures > Exception > Generate Financials
// 'Settings', 'Trial Balance' and 'Mapping' are dropdown groups (hover/click,
// or their Alt mnemonic). Settings' dropdown mirrors its page sections —
// Auditee Details, Financial Period, Auditor, Signatory, Mapping Rules.
// Trial Balance embeds Upload TB / Actual TB / Mapped TB /
// Mapped TB (Remarks) / Journal Entry. Mapping groups the mapping workflow —
// Rectification / Recategorisation (renamed from the old standalone
// "Categorisation" tab) / Mapped TB / Mapping Rules. "Mapped TB" and
// "Mapping Rules" are deliberately reachable from two groups (Trial
// Balance / Settings respectively, as well as from Mapping) — same leaf
// label, same render case, just listed in more than one dropdown.
// Screens whose figures come from the Trial Balance's closing balances: they say when those are revised by Adjustments.
const ADJUSTMENT_NOTICE_TABS = new Set([
  'BS', 'PL', 'CFS', 'Notes', 'Annex & Reco', 'Exception', 'Generate Financials', 'Ratio', 'PPE', 'Stock',
  'Dep (Comp)', 'Dep (IT)', 'Dep (Old)', 'Tax Computation', 'Deferred Tax', 'ITR: BS', 'ITR: PL', 'ITR: BS Details', 'ITR: PL Details',
  'Rectification / Recategorisation', 'Mapped TB (Remarks)',
])
const TABS = ['Settings', 'Trial Balance', 'Stock', 'Mapping', 'Dep', 'BS', 'PL', 'CFS', 'Notes', 'General Notes', 'Annex & Reco', 'Features', 'Exception', 'Generate Financials']
const TAB_GROUPS = {
  'Settings': ['Auditee Details', 'Financial Period', 'Auditor', 'Signatory', 'Mapping Rules', 'Engagements', 'Firm Team'],
  'Trial Balance': ['Upload TB', 'Actual TB', 'Mapped TB', 'Mapped TB (Remarks)', 'Journal Entry'],
  'Mapping': ['Rectification / Recategorisation', 'Mapped TB', 'Mapping Rules'],
  'Dep': ['Dep (Comp)', 'Dep (IT)', 'Dep (Old)'],
  // Features submenu with ITR, PPE, Ratio
  'Features': ['ITR', 'Tax Computation', 'Deferred Tax', 'PPE', 'Ratio', 'Format'],
  // Blank Schedule III format (BS, P&L, notes, Fill Details) per constitution.
  'Format': ['Format: Proprietorship', 'Format: Partnership', 'Format: LLP', 'Format: Company'],
  // ITR-format BS/PL editable form (opens the layout matching the entity's
  // constitution — Individual/HUF/Proprietorship, Partnership/LLP, or Company).
  // Leaf labels are prefixed "ITR: " so they can't collide with the Schedule III
  // 'BS'/'PL' tabs' own switch cases below.
  'ITR': ['ITR: BS', 'ITR: PL', 'ITR: BS Details', 'ITR: PL Details'],
}
// A window opened with "New window" carries the client, Financial Year, Trial Balance and tab it was opened from in its page address.
const POPOUT = (() => {
  try {
    const m = /popout=([^&]+)/.exec(window.location.hash || '')
    return m ? JSON.parse(decodeURIComponent(m[1])) : null
  } catch { return null }
})()

function ApplicationWorkspace({ user, onSignOut, signingOut }) {
  const [activeTab, setActiveTab]     = useState((POPOUT && POPOUT.tab) || 'Auditee Details')
  const [entity, setEntity]           = useState(null)
  const [activeTB, setActiveTB]       = useState(null)
  const [prevTB, setPrevTB]           = useState(null)   // previous year TB
  const [highlightNote, setHighlightNote] = useState(null) // note number to jump to in Notes tab
  const [annexureTarget, setAnnexureTarget] = useState(null) // { noteNum, subnote, key } to jump to in Annexures tab
  const [activeRsId, setActiveRsId]   = useState(null)
  const [dbOk, setDbOk]               = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [theme, setTheme]             = useState(() => localStorage.getItem(THEME_KEY) || 'blue')
  const [numFormat, setNumFormat]     = useState(() => localStorage.getItem('vera-numFormat') || 'as_is')

  // ── Financial Year ↔ Trial Balance linkage ───────────────────────────────
  // Every TB is compulsorily tied to one Auditee↔FY (entity_period_id).
  // Picking a period in the TopBar's FY badge resolves and loads whichever
  // TB belongs to it — automatically if there's exactly one (no repeated
  // "select a TB" prompting once it's been done once), asking only when
  // there's a genuine ambiguity (more than one TB for that period) or
  // nothing uploaded yet for it at all.
  const [entityPeriods, setEntityPeriods]           = useState([])
  const [currentEntityPeriodId, setCurrentEntityPeriodId] = useState(null)
  const [tbChoicePrompt, setTbChoicePrompt]         = useState(null) // { tbs: [...] } when >1 TB matches a period
  const [noTBForPeriod, setNoTBForPeriod]           = useState(false)

  const resolveTBForPeriod = useCallback(async (entityPeriodId) => {
    setTbChoicePrompt(null)
    setNoTBForPeriod(false)
    setPrevTB(null)
    if (!entityPeriodId) { setActiveTB(null); return }
    let resolvedActiveTBId = null
    try {
      const tbs = await window.api?.getTBsForEntityPeriod(entityPeriodId) || []
      if (tbs.length === 1) {
        setActiveTB(tbs[0])
        resolvedActiveTBId = tbs[0].id
      } else if (tbs.length === 0) {
        setActiveTB(null)
        setNoTBForPeriod(true)
      } else {
        setActiveTB(null)
        setTbChoicePrompt({ entityPeriodId, tbs })
      }
    } catch {
      setActiveTB(null)
    }
    // Restore whichever TB was previously picked as "Previous Year" for this
    // exact Auditee↔FY (persisted in entity_periods.prev_tb_id), so switching
    // the FY badge away and back doesn't force a re-pick every time. Still
    // guarded against prevTB === activeTB — the collision this used to avoid
    // by unconditionally nulling instead of restoring per-period.
    try {
      const ep = await window.api?.getEntityPeriod(entityPeriodId)
      if (ep?.prev_tb_id && ep.prev_tb_id !== resolvedActiveTBId && entity?.id) {
        const allTBs = await window.api?.getTBList(entity.id) || []
        const found = allTBs.find(t => t.id === ep.prev_tb_id)
        if (found) setPrevTB(found)
      }
    } catch {}
  }, [entity?.id])

  const handleEntityPeriodChange = useCallback((newId) => {
    setCurrentEntityPeriodId(newId)
    resolveTBForPeriod(newId)
  }, [resolveTBForPeriod])

  // Wraps setPrevTB so a manual pick (via PYTBSelector on any screen) is also
  // persisted per Auditee↔FY — see resolveTBForPeriod's restore logic above.
  const handlePrevTBChange = useCallback((tb) => {
    setPrevTB(tb)
    if (currentEntityPeriodId) {
      window.api?.setEntityPeriodPrevTB(currentEntityPeriodId, tb?.id || null).catch(() => {})
    }
  }, [currentEntityPeriodId])

  // ── Branch mode state ────────────────────────────────────────────────────
  // fsMode: 'single' | 'consolidated' | 'columnar'
  const [fsMode, setFsMode]                   = useState('single')
  const [branchTBList, setBranchTBList]       = useState([])
  const [selectedBranchTBId, setSelectedBranchTBId] = useState(null)

  // Apply theme to <body> and persist
  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('vera-numFormat', numFormat)
  }, [numFormat])

  // Test DB on mount
  useEffect(() => {
    window.api?.getSettings().then(cfg => {
      window.api?.testConnection(cfg).then(r => setDbOk(r.ok)).catch(() => setDbOk(false))
    }).catch(() => setDbOk(false))
  }, [])

  // ── Keyboard ─────────────────────────────────────────────────────────────
  // Alt+<key of a top-level tab> goes to that tab; a tab with a dropdown opens it, and the underlined letter of an item chooses
  // it (NavTabs.jsx). Escape, with no dropdown or dialog open, goes back to the screen that was open before.
  const [menuRequest, setMenuRequest] = useState(null)
  const [consKey, setConsKey] = useState(0)   // bumped when the Trial Balances ticked for the Consolidated view change
  const openWinRef = useRef(null)   // the "New window" action (defined below), reachable from the key handler
  const quitAppRef = useRef(null)
  const TAB_OF_KEY = {}
  for (const [tab, k] of Object.entries(TOP_SHORTCUTS)) TAB_OF_KEY[k] = tab

  useEffect(() => {
    const handler = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if ((e.key || '').toUpperCase() === 'X') {
        e.preventDefault()
        quitAppRef.current?.()
        return
      }
      // Don't trigger while the user is typing or editing content.
      const tag = (document.activeElement?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.isContentEditable) return
      // Alt+W: a new window on this client, Financial Year and tab (also the top bar's "New window" button)
      if ((e.key || '').toUpperCase() === 'W') {
        e.preventDefault()
        if (openWinRef.current) openWinRef.current()
        return
      }
      const tab = TAB_OF_KEY[(e.key || '').toUpperCase()]
      if (!tab) return
      e.preventDefault()
      if (TAB_GROUPS[tab]) setMenuRequest({ tab, n: Date.now() })
      else setActiveTab(tab)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // The screens visited, so Escape can step back
  const histRef = useRef({ last: activeTab, stack: [], skip: false })
  useEffect(() => {
    const h = histRef.current
    if (h.skip) { h.skip = false; h.last = activeTab; return }
    if (h.last !== activeTab) {
      h.stack.push(h.last)
      if (h.stack.length > 30) h.stack.shift()
      h.last = activeTab
    }
  }, [activeTab])

  useEffect(() => {
    const onEscape = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      const el = document.activeElement
      const tag = (el?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return   // Escape there belongs to the field
      // a dropdown menu or a dialog is open: Escape belongs to it
      if (document.querySelector('[role="menu"], [role="dialog"], [aria-modal="true"], .modal-backdrop, .fixed.inset-0')) return
      const h = histRef.current
      while (h.stack.length && h.stack[h.stack.length - 1] === h.last) h.stack.pop()
      if (!h.stack.length) return
      const prev = h.stack.pop()
      h.skip = true
      e.preventDefault()
      setActiveTab(prev)
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [])

  // Categorisation undo/redo via Ctrl+Z / Ctrl+Y
  const [, _bumpUndoUI] = useState(0)
  useEffect(() => subscribeUndo(() => _bumpUndoUI(t => t + 1)), [])
  useEffect(() => {
    const handler = async (e) => {
      // Only trigger when no input/textarea is focused (so user editing fields
      // can still use native Ctrl+Z/Y in their text)
      const tag = (document.activeElement?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) {
        if (canUndoCat()) {
          e.preventDefault()
          const action = await undoCategorisation()
          if (action) setUndoStatus(`↶ Undone: ${action.label}`)
        }
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        if (canRedoCat()) {
          e.preventDefault()
          const action = await redoCategorisation()
          if (action) setUndoStatus(`↷ Redone: ${action.label}`)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const [undoStatus, setUndoStatus] = useState('')
  useEffect(() => {
    if (!undoStatus) return
    const t = setTimeout(() => setUndoStatus(''), 3000)
    return () => clearTimeout(t)
  }, [undoStatus])

  // ── More than one window ─────────────────────────────────────────────────
  // Every window is the whole app on the same database. "New window" opens another one where this one is; when something is saved in
  // one window the others are told, and offer a refresh (their screens are not redrawn under the user's hands).
  const [refreshKey, setRefreshKey]   = useState(0)
  const [changedElsewhere, setChangedElsewhere] = useState(false)

  useEffect(() => {
    if (!POPOUT) return
    let dead = false
    ;(async () => {
      try {
        if (POPOUT.entityId) {
          const all = await window.api?.getEntities?.()
          const e = (all || []).find(x => x.id === POPOUT.entityId)
          if (e && !dead) {
            setEntity(e)
            if (POPOUT.rsId) setActiveRsId(POPOUT.rsId)
            const periods = (await window.api?.listEntityPeriods?.(e.id)) || []
            if (dead) return
            setEntityPeriods(periods)
            if (POPOUT.entityPeriodId) setCurrentEntityPeriodId(POPOUT.entityPeriodId)
            const tbs = (await window.api?.getTBList?.(e.id)) || []
            const act = tbs.find(t => t.id === POPOUT.tbId)
            if (act) setActiveTB(act)
            const prev = tbs.find(t => t.id === POPOUT.prevTbId)
            if (prev) setPrevTB(prev)
            if (e.has_branches) {
              const list = (await window.api?.getBranches?.(e.id)) || []
              setBranchTBList(list)
              setSelectedBranchTBId(POPOUT.selectedBranchTBId != null ? POPOUT.selectedBranchTBId : (list[0] ? list[0].id : null))
              setFsMode(POPOUT.fsMode || 'single')
            }
          }
        }
      } catch {}
    })()
    return () => { dead = true }
  }, [])

  useEffect(() => {
    const off = window.api?.onDataChanged?.(() => setChangedElsewhere(true))
    return () => { if (typeof off === 'function') off() }
  }, [])

  // The window's title says which client and tab it is, so the windows are told apart in the taskbar
  useEffect(() => {
    document.title = entity ? `${entity.name} · ${activeTab} · FSG Bharat` : 'FSG Bharat — Financial Statement Generator'
  }, [entity?.name, activeTab])

  const openInNewWindow = useCallback(() => {
    window.api?.openNewWindow?.({
      tab: activeTab, entityId: entity?.id ?? null, entityPeriodId: currentEntityPeriodId ?? null,
      tbId: activeTB?.id ?? null, prevTbId: prevTB?.id ?? null, fsMode, selectedBranchTBId: selectedBranchTBId ?? null, rsId: activeRsId ?? null,
    })
  }, [activeTab, entity?.id, currentEntityPeriodId, activeTB?.id, prevTB?.id, fsMode, selectedBranchTBId, activeRsId])

  openWinRef.current = openInNewWindow
  quitAppRef.current = () => window.api?.quitApp?.()

  const refreshThisWindow = useCallback(async () => {
    try {
      if (entity?.id) {
        const all = await window.api?.getEntities?.()
        const fresh = (all || []).find(x => x.id === entity.id)
        if (fresh) setEntity(fresh)
        const periods = await window.api?.listEntityPeriods?.(entity.id)
        if (periods) setEntityPeriods(periods)
        if (entity.has_branches) {
          const list = await window.api?.getBranches?.(entity.id)
          if (list) setBranchTBList(list)
        }
      }
    } catch {}
    setChangedElsewhere(false)
    setRefreshKey(k => k + 1)   // the open tab is drawn again from the database
  }, [entity?.id, entity?.has_branches])

  const handleEntityChange = useCallback(async (e) => {
    setEntity(e)
    setActiveTB(null)
    setPrevTB(null)
    setFsMode('single')
    setBranchTBList([])
    setSelectedBranchTBId(null)
    setEntityPeriods([])
    setCurrentEntityPeriodId(null)
    setTbChoicePrompt(null)
    setNoTBForPeriod(false)
    if (e?.id) {
      try {
        const ruleSets = await window.api?.getRuleSets(e.id)
        const def = ruleSets?.find(r => r.is_default) || ruleSets?.[0]
        if (def) setActiveRsId(def.id)
      } catch {}
      // Load branch TB list for branch entities
      if (e.has_branches) {
        try {
          const list = await window.api?.getBranches(e.id)
          setBranchTBList(list || [])
          if (list?.length) setSelectedBranchTBId(list[0].id)
        } catch {}
        // Also load Financial Periods for the FY badge — branch entities still
        // have a FY selected via entity_periods, just not a single TB (that's
        // resolved per-branch above instead of via resolveTBForPeriod).
        try {
          const periods = await window.api?.listEntityPeriods(e.id) || []
          setEntityPeriods(periods)
          if (periods.length) setCurrentEntityPeriodId(periods[0].id)
        } catch {}
      } else {
        // Non-branch entities: resolve the latest FY's TB automatically —
        // branch entities keep their existing BranchModeBar-driven TB
        // selection (one TB per branch per period is normal there, so the
        // "more than one TB for this period" prompt below would fire for
        // essentially every branch entity and just get in the way).
        try {
          const periods = await window.api?.listEntityPeriods(e.id) || []
          setEntityPeriods(periods)
          if (periods.length) {
            const latest = periods[0]  // ordered by date_from DESC
            setCurrentEntityPeriodId(latest.id)
            resolveTBForPeriod(latest.id)
          }
        } catch {}
      }
    }
  }, [resolveTBForPeriod])

  // Refresh branchTBList after a TB is uploaded/deleted in the ActualTB tab
  const refreshBranchTBList = useCallback(async () => {
    if (!entity?.id || !entity?.has_branches) return
    try {
      const list = await window.api?.getBranches(entity.id)
      setBranchTBList(list || [])
    } catch {}
  }, [entity?.id, entity?.has_branches])

  // Compute the TB that view-tabs (BS/PL/Notes/Annexures) will actually see
  const BRANCH_VIEW_TABS = new Set(['BS', 'PL', 'Notes', 'Annex & Reco'])
  // Working tabs also show per-branch data but don't support consolidated/columnar modes
  // 'Dep (Comp)' and 'Dep (Old)' were missing here, so on a branch entity those
  // tabs never received the selected branch TB and showed "Load a Trial
  // Balance" although one was loaded (fixed 0.1.16).
  const BRANCH_WORK_TABS = new Set(['Mapped TB', 'Mapped TB (Remarks)', 'Rectification / Recategorisation', 'Dep', 'Dep (Comp)', 'Dep (Old)', 'Dep (IT)', 'Stock', 'Actual TB', 'Exception', 'ITR: BS', 'ITR: PL', 'ITR: BS Details', 'ITR: PL Details'])
  // Tabs that offer a "Consolidated (all branches)" pill: one depreciation
  // schedule for the whole entity instead of one per branch (see utils/depStore.js).
  const DEP_CONSOL_TABS = new Set(['Dep (Comp)', 'Dep (IT)'])
  const isBranchViewTab = BRANCH_VIEW_TABS.has(activeTab)
  const isBranchWorkTab = BRANCH_WORK_TABS.has(activeTab)
  const isBranchEntity = !!entity?.has_branches

  // Virtual consolidated TB: id='__consolidated__' tells useFinancials to fetch entity-level rows
  const consolidatedVirtualTB = entity ? { id: '__consolidated__', entity_id: entity.id, entity_period_id: currentEntityPeriodId, period: consolidatedPeriodOf(branchTBList, currentEntityPeriodId), consKey } : null
  const consolidationCtx = { entityId: entity?.id ?? null, entityPeriodId: currentEntityPeriodId, consKey, bump: () => setConsKey(k => k + 1) }

  // General Notes (with the Financial Ratios) and the Cash Flow Statement belong to the entity as a whole: for an Auditee with branches they
  // are always the Consolidated ones, never a branch's.
  const ENTITY_LEVEL_TABS = new Set(['General Notes', 'CFS', 'Tax Computation', 'Deferred Tax'])
  const ITR_TABS = new Set(['ITR: BS', 'ITR: PL', 'ITR: BS Details', 'ITR: PL Details'])
  const isEntityLevelTab = isBranchEntity && ENTITY_LEVEL_TABS.has(activeTab)

  // activeTBForDisplay: what financial/working tabs see
  let activeTBForDisplay = activeTB
  if (isEntityLevelTab) {
    activeTBForDisplay = consolidatedVirtualTB
  } else if (isBranchEntity && (isBranchViewTab || isBranchWorkTab)) {
    // The Exception tab shows the Consolidated mode switch too, so it must see
    // the virtual consolidated TB in that mode (its inter-branch / GST /
    // consolidated-depreciation checks only exist there).
    if ((isBranchViewTab || activeTab === 'Exception') && fsMode === 'consolidated') {
      activeTBForDisplay = consolidatedVirtualTB
    } else if (DEP_CONSOL_TABS.has(activeTab) && selectedBranchTBId === '__consolidated__') {
      activeTBForDisplay = consolidatedVirtualTB
    } else {
      // single / columnar / work tabs: show selected branch TB (a tab that has
      // no consolidated pill falls back to the first branch when the
      // consolidated pill is the current selection)
      // The ITR is one form for the whole Auditee: always kept against the first branch's Trial Balance, whichever branch was last picked
      const branchTB = ITR_TABS.has(activeTab) ? branchTBList[0] : branchTBList.find(t => t.id === selectedBranchTBId)
        || (selectedBranchTBId === '__consolidated__' ? branchTBList[0] : null)
      if (branchTB) activeTBForDisplay = branchTB
    }
  }

  // Called from BS/PL when user clicks a note number
  const handleNoteClick = useCallback((noteNum) => {
    setHighlightNote(noteNum)
    setActiveTab('Notes')
  }, [])

  // Called from Notes when user clicks a sub-note line's "→ Annexure" link
  const handleAnnexureClick = useCallback((noteNum, subnote) => {
    setAnnexureTarget({ noteNum, subnote, key: Date.now() })
    setActiveTab('Annex & Reco')
  }, [])

  // Called from BS/PL/Notes' "Fix" buttons — instead of opening the old
  // stripped-down FixCategorisationModal, jump straight to the full
  // Rectification / Recategorisation screen pre-scoped to just the ledgers
  // for whichever category/segment was clicked (same `filter` shape already
  // used by mappedTB:findByFilter — alie / mapping1_resultant /
  // mapping2_resultant / mapping3_resultant / level5_unclassified /
  // uncategorised / level1Pattern), so the CA gets every feature of that
  // screen (bulk apply, PY toggle, Diagnose, undo/redo, etc.) instead of a
  // cut-down dialog.
  const [rectificationFilter, setRectificationFilter] = useState(null)
  const handleFixClick = useCallback((filter, title) => {
    setRectificationFilter({ ...filter, title, key: Date.now() })
    setActiveTab('Rectification / Recategorisation')
  }, [])
  // The scope belongs to that one Fix. Left in place it was applied again the next time
  // Recategorisation was opened from the Mapping menu (or after switching entity / TB) and
  // showed a fully-fixed category as "No exceptions".
  useEffect(() => {
    if (activeTab !== 'Rectification / Recategorisation') setRectificationFilter(null)
  }, [activeTab])

  // Called from Notes' "Changes in Inventories" / "Cost of Materials
  // Consumed" notes — these are auto-computed from Stock tab entries (see
  // utils/inventorySplit.js), not separately Fill-Details-editable, so their
  // action button sends the CA straight to the single place that's actually
  // editable.
  const handleGoToStock = useCallback(() => setActiveTab('Stock'), [])

  // When a TB is loaded/deleted in ActualTB, also refresh branch list
  const handleTBLoaded = useCallback((tb) => {
    setActiveTB(tb)
    setTbChoicePrompt(null)
    setNoTBForPeriod(false)
    // Keep the FY badge in sync with whichever TB just became active — a
    // fresh upload (compulsorily tied to a period, see UploadTB.jsx) or a
    // pick from the "more than one TB for this period" prompt should both
    // be reflected there, not just changes made via the badge itself.
    if (tb?.entity_period_id && tb.entity_period_id !== currentEntityPeriodId) {
      setCurrentEntityPeriodId(tb.entity_period_id)
    }
    if (entity?.has_branches && tb) {
      setSelectedBranchTBId(tb.id)
      refreshBranchTBList()
    }
  }, [entity?.has_branches, refreshBranchTBList, currentEntityPeriodId])

  const renderTab = () => {
    if (!dbOk) return null
    switch (activeTab) {
      case 'Engagements':
      case 'Firm Team':
      case 'Auditee Details':
      case 'Financial Period':
      case 'Auditor':
      case 'Signatory':
        return (
          <Master
            entity={entity}
            onEntityChange={handleEntityChange}
            onOpenMappingRules={() => setActiveTab('Mapping Rules')}
            activeLeaf={activeTab}
            onSelectSection={setActiveTab}
            user={user}
          />
        )
      case 'Upload TB':
        return (
          <UploadTB
            entity={entity}
            activeTB={activeTB}
            activeRsId={activeRsId}
            onTBLoaded={handleTBLoaded}
            onGoToStock={() => setActiveTab('Stock')}
          />
        )
      case 'Actual TB':
        return (
          <ActualTBTable
            entity={entity}
            activeTB={activeTB}
          />
        )
      case 'Journal Entry':
        return (
          <JournalEntryPage
            entity={entity}
            activeTB={activeTB}
            activeRsId={activeRsId}
          />
        )
      case 'Stock':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {isBranchEntity && (
              <BranchModeBar hideModes fsMode={fsMode} onFsModeChange={setFsMode}
                branchTBList={branchTBList} selectedBranchTBId={selectedBranchTBId}
                onBranchSelect={setSelectedBranchTBId} />
            )}
            <StockPage
              entity={entity}
              activeTB={activeTBForDisplay}
              prevTB={prevTB}
              onPrevTBChange={handlePrevTBChange}
            />
          </div>
        )
      case 'Mapping Rules':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="flex items-center px-4 py-1.5 bg-blue-50 border-b border-blue-100 shrink-0">
              <button
                onClick={() => setActiveTab('Auditee Details')}
                className="text-xs text-blue-700 hover:text-blue-900 font-medium"
              >← Back to Settings</button>
            </div>
            <MappingRules
              entity={entity}
              activeRsId={activeRsId}
              onRsChange={setActiveRsId}
            />
          </div>
        )
      case 'Mapped TB':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {isBranchEntity && (
              <BranchModeBar hideModes fsMode={fsMode} onFsModeChange={setFsMode}
                branchTBList={branchTBList} selectedBranchTBId={selectedBranchTBId}
                onBranchSelect={setSelectedBranchTBId} />
            )}
            <MappedTB
              entity={entity}
              activeTB={activeTBForDisplay}
              prevTB={prevTB}
              onPrevTBChange={handlePrevTBChange}
              activeRsId={activeRsId}
              numFormat={numFormat}
              onNumFormatChange={setNumFormat}
              onOpenMappingRules={() => setActiveTab('Mapping Rules')}
            />
          </div>
        )
      case 'Mapped TB (Remarks)':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {isBranchEntity && (
              <BranchModeBar hideModes fsMode={fsMode} onFsModeChange={setFsMode}
                branchTBList={branchTBList} selectedBranchTBId={selectedBranchTBId}
                onBranchSelect={setSelectedBranchTBId} />
            )}
            <MappedTBWithRemarks
              entity={entity}
              activeTB={activeTBForDisplay}
              prevTB={prevTB}
              onPrevTBChange={handlePrevTBChange}
            />
          </div>
        )
      case 'Rectification / Recategorisation':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {isBranchEntity && (
              <BranchModeBar hideModes fsMode={fsMode} onFsModeChange={setFsMode}
                branchTBList={branchTBList} selectedBranchTBId={selectedBranchTBId}
                onBranchSelect={setSelectedBranchTBId} />
            )}
            <Exceptions
              entity={entity}
              activeTB={activeTBForDisplay}
              activeRsId={activeRsId}
              prevTB={prevTB}
              onPrevTBChange={handlePrevTBChange}
              initialFilter={rectificationFilter}
            />
          </div>
        )
      case 'Dep (Comp)':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {isBranchEntity && (
              <BranchModeBar hideModes allowConsolidated fsMode={fsMode} onFsModeChange={setFsMode}
                branchTBList={branchTBList} selectedBranchTBId={selectedBranchTBId}
                onBranchSelect={setSelectedBranchTBId} />
            )}
            <DepreciationComp
              entity={entity}
              activeTB={activeTBForDisplay}
            />
          </div>
        )
      case 'Dep (Old)':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {isBranchEntity && (
              <BranchModeBar hideModes fsMode={fsMode} onFsModeChange={setFsMode}
                branchTBList={branchTBList} selectedBranchTBId={selectedBranchTBId}
                onBranchSelect={setSelectedBranchTBId} />
            )}
            <Depreciation
              entity={entity}
              activeTB={activeTBForDisplay}
            />
          </div>
        )
      case 'Dep (IT)':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {isBranchEntity && (
              <BranchModeBar hideModes allowConsolidated fsMode={fsMode} onFsModeChange={setFsMode}
                branchTBList={branchTBList} selectedBranchTBId={selectedBranchTBId}
                onBranchSelect={setSelectedBranchTBId} />
            )}
            <DepreciationIT
              entity={entity}
              activeTB={activeTBForDisplay}
            />
          </div>
        )
      case 'BS':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {isBranchEntity && (
              <BranchModeBar fsMode={fsMode} onFsModeChange={setFsMode}
                branchTBList={branchTBList} selectedBranchTBId={selectedBranchTBId}
                onBranchSelect={setSelectedBranchTBId} />
            )}
            <BS
              entity={entity}
              activeTB={activeTBForDisplay}
              prevTB={fsMode === 'consolidated' ? null : prevTB}
              activeRsId={activeRsId}
              onPrevTBChange={handlePrevTBChange}
              onNoteClick={handleNoteClick}
              onFixNavigate={handleFixClick}
            />
          </div>
        )
      case 'PL':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {isBranchEntity && (
              <BranchModeBar fsMode={fsMode} onFsModeChange={setFsMode}
                branchTBList={branchTBList} selectedBranchTBId={selectedBranchTBId}
                onBranchSelect={setSelectedBranchTBId} />
            )}
            <PL
              entity={entity}
              activeTB={activeTBForDisplay}
              prevTB={fsMode === 'consolidated' ? null : prevTB}
              activeRsId={activeRsId}
              onPrevTBChange={handlePrevTBChange}
              onNoteClick={handleNoteClick}
              onFixNavigate={handleFixClick}
            />
          </div>
        )
      case 'Deferred Tax':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {isBranchEntity && (
              <div className="shrink-0 border-b border-blue-100 bg-blue-50 px-3 py-1.5 text-[11px] text-blue-800">
                🔀 <strong>Consolidated</strong> deferred tax — the Profit &amp; Loss, Balance Sheet and depreciation schedules of all branches together.
              </div>
            )}
            <DeferredTax
              entity={entity}
              activeTB={activeTBForDisplay}
              prevTB={null}
              activeRsId={activeRsId}
            />
          </div>
        )
      case 'Tax Computation':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {isBranchEntity && (
              <div className="shrink-0 border-b border-blue-100 bg-blue-50 px-3 py-1.5 text-[11px] text-blue-800">
                🔀 <strong>Consolidated</strong> computation — Profit before tax and the other figures are those of all branches together.
              </div>
            )}
            <TaxComputation
              entity={entity}
              activeTB={activeTBForDisplay}
              prevTB={null}
              activeRsId={activeRsId}
              onPrevTBChange={handlePrevTBChange}
            />
          </div>
        )
      case 'CFS':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {isBranchEntity && (
              <div className="shrink-0 border-b border-blue-100 bg-blue-50 px-3 py-1.5 text-[11px] text-blue-800">
                🔀 <strong>Consolidated</strong> Cash Flow Statement — all branches summed, drawn from the Consolidated Balance Sheet and Profit &amp; Loss.
              </div>
            )}
            <CFS
              entity={entity}
              activeTB={activeTBForDisplay}
              prevTB={(fsMode === 'consolidated' || isBranchEntity) ? null : prevTB}
              activeRsId={activeRsId}
              onPrevTBChange={handlePrevTBChange}
            />
          </div>
        )
      case 'Notes':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {isBranchEntity && (
              <BranchModeBar fsMode={fsMode} onFsModeChange={setFsMode}
                branchTBList={branchTBList} selectedBranchTBId={selectedBranchTBId}
                onBranchSelect={setSelectedBranchTBId} />
            )}
            <Notes
              entity={entity}
              activeTB={activeTBForDisplay}
              prevTB={fsMode === 'consolidated' ? null : prevTB}
              activeRsId={activeRsId}
              onPrevTBChange={handlePrevTBChange}
              highlightNote={highlightNote}
              onHighlightClear={() => setHighlightNote(null)}
              onGoToAnnexure={handleAnnexureClick}
              onGoToStock={handleGoToStock}
              onFixNavigate={handleFixClick}
            />
          </div>
        )
      case 'Annex & Reco':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {isBranchEntity && (
              <BranchModeBar fsMode={fsMode} onFsModeChange={setFsMode}
                branchTBList={branchTBList} selectedBranchTBId={selectedBranchTBId}
                onBranchSelect={setSelectedBranchTBId} />
            )}
            <Annexures
              entity={entity}
              activeTB={activeTBForDisplay}
              prevTB={fsMode === 'consolidated' ? null : prevTB}
              activeRsId={activeRsId}
              onPrevTBChange={handlePrevTBChange}
              jumpTarget={annexureTarget}
              onJumpHandled={() => setAnnexureTarget(null)}
              onFixNavigate={handleFixClick}
            />
          </div>
        )
      case 'ITR: BS':
      case 'ITR: PL':
      case 'ITR: BS Details':
      case 'ITR: PL Details':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {isBranchEntity && (
              <div className="px-4 py-1.5 text-xs bg-blue-50 border-b border-blue-200 text-blue-800">
                ITR of the Auditee as a whole: figures are pulled from the Consolidated BS, PL and Notes of all branches.
              </div>
            )}
            <ITR
              entity={entity}
              activeTB={activeTBForDisplay}
              activeRsId={activeRsId}
              activeLeaf={activeTab}
            />
          </div>
        )
      case 'Format: Proprietorship':
      case 'Format: Partnership':
      case 'Format: LLP':
      case 'Format: Company':
        return <Format key={activeTab} kind={activeTab.replace(/^Format:\s*/, '')} />
      case 'Ratio':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            <Ratio
              entity={entity}
              activeTB={activeTB}
              prevTB={prevTB}
              onPrevTBChange={handlePrevTBChange}
            />
          </div>
        )
      case 'Exception':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {isBranchEntity && (
              <BranchModeBar fsMode={fsMode} onFsModeChange={setFsMode}
                branchTBList={branchTBList} selectedBranchTBId={selectedBranchTBId}
                onBranchSelect={setSelectedBranchTBId} />
            )}
            <ExceptionReport
              entity={entity}
              activeTB={activeTBForDisplay}
              prevTB={fsMode === 'consolidated' ? null : prevTB}
              activeRsId={activeRsId}
              onPrevTBChange={handlePrevTBChange}
            />
          </div>
        )
      case 'Generate Financials':
        return (
          <GenerateFinancials
            entity={entity}
            activeTB={activeTB}
            prevTB={prevTB}
            activeRsId={activeRsId}
            numFormat={numFormat}
            onNumFormatChange={setNumFormat}
            fsMode={fsMode}
            onFsModeChange={setFsMode}
            branchTBList={branchTBList}
            selectedBranchTBId={selectedBranchTBId}
            onBranchSelect={setSelectedBranchTBId}
          />
        )
      case 'General Notes':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            {isBranchEntity && (
              <div className="shrink-0 border-b border-blue-100 bg-blue-50 px-3 py-1.5 text-[11px] text-blue-800">
                🔀 <strong>Consolidated</strong> General Notes — the Financial Ratios are worked out from the Consolidated Balance Sheet and Profit &amp; Loss.
              </div>
            )}
            <GeneralNotes
              entity={entity}
              activeTB={activeTBForDisplay}
              prevTB={(fsMode === 'consolidated' || isBranchEntity) ? null : prevTB}
              activeRsId={activeRsId}
            />
          </div>
        )
      case 'PPE':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            <PPE
              entity={entity}
              activeTB={activeTB}
            />
          </div>
        )
      default:
        return (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-lg">
            {activeTab} — coming soon
          </div>
        )
    }
  }

  return (
    <ConsolidationContext.Provider value={consolidationCtx}>
    <div className="flex flex-col h-screen bg-white overflow-hidden">
      <TopBar
        onNewWindow={openInNewWindow}
        onQuit={() => window.api?.quitApp?.()}
        entity={entity}
        onEntityChange={handleEntityChange}
        onOpenSettings={() => setActiveTab('Auditee Details')}
        onManageFinancialPeriods={() => setActiveTab('Financial Period')}
        onSettings={() => setShowSettings(true)}
        dbOk={dbOk}
        theme={theme}
        onThemeChange={setTheme}
        entityPeriods={entityPeriods}
        currentEntityPeriodId={currentEntityPeriodId}
        onEntityPeriodChange={handleEntityPeriodChange}
      />

      <div className="flex shrink-0 items-center justify-end gap-3 border-b border-gray-100 bg-white px-4 py-1.5 text-xs text-gray-500">
        <span>{user.displayName} <span className="capitalize">({user.jobTitle || user.role})</span></span>
        <button disabled={signingOut} onClick={onSignOut} className="font-medium text-gray-600 hover:text-red-700 disabled:opacity-50">{signingOut ? 'Signing out…' : 'Sign out'}</button>
      </div>

      {dbOk && <NavTabs tabs={TABS} groups={TAB_GROUPS} active={activeTab} onChange={setActiveTab} openRequest={menuRequest} />}

      {!dbOk && (
        <DBBanner onConfigure={() => setShowSettings(true)} />
      )}

      {dbOk && changedElsewhere && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-1.5 bg-blue-50 border-b border-blue-200 text-blue-900 text-xs shrink-0">
          <span>
            Something was saved in another FSG Bharat window. Refresh this window to see the latest figures. Before you edit General Notes,
            the Cash Flow Statement or Fill Details here, refresh first - otherwise you may overwrite what the other window saved.
          </span>
          <button onClick={refreshThisWindow} className="px-2.5 py-1 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 transition">Refresh this window</button>
          <button onClick={() => setChangedElsewhere(false)} className="px-2 py-1 rounded border border-blue-300 hover:bg-blue-100">Dismiss</button>
        </div>
      )}

      {dbOk && !entity?.has_branches && noTBForPeriod && !['Engagements', 'Firm Team', 'Upload TB', 'Auditee Details', 'Financial Period', 'Auditor', 'Signatory', 'Mapping Rules'].includes(activeTab) && (
        <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm shrink-0">
          <span>No Trial Balance uploaded yet for {entityPeriods.find(p => p.id === currentEntityPeriodId)?.year_label || 'this Financial Year'}.</span>
          <button
            onClick={() => setActiveTab('Upload TB')}
            className="px-2.5 py-1 text-xs rounded bg-amber-600 text-white font-medium hover:bg-amber-700 transition"
          >Upload now</button>
        </div>
      )}

      {dbOk && activeTBForDisplay && ADJUSTMENT_NOTICE_TABS.has(activeTab) && (
        <AdjustmentNotice entity={entity} activeTB={activeTBForDisplay} prevTB={prevTB} refreshKey={activeTab} onOpen={() => setActiveTab('Mapped TB')} />
      )}

      <div className="flex-1 overflow-hidden" key={refreshKey}>
        {renderTab()}
      </div>

      {tbChoicePrompt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[480px] max-w-[90vw] p-5">
            <h3 className="font-bold text-blue-900 text-sm mb-1">More than one Trial Balance for this Financial Year</h3>
            <p className="text-xs text-gray-500 mb-3">Pick which one to work with — you can switch again later from the Financial Year badge.</p>
            <div className="max-h-72 overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">
              {tbChoicePrompt.tbs.map(tb => (
                <button
                  key={tb.id}
                  onClick={() => handleTBLoaded(tb)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition"
                >
                  <div className="font-medium text-gray-800">{tb.filename || `Trial Balance #${tb.id}`}</div>
                  <div className="text-xs text-gray-400">{tb.branch_name ? `${tb.branch_name} · ` : ''}Uploaded {fmtUploadedAt(tb.uploaded_at)} · {tb.row_count || 0} ledgers</div>
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setTbChoicePrompt(null); setActiveTab('Upload TB') }}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50"
              >Upload another instead</button>
              <button
                onClick={() => setTbChoicePrompt(null)}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50"
              >Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Undo/Redo toast */}
      {undoStatus && (
        <div className="fixed bottom-4 right-4 px-3 py-2 rounded shadow-lg bg-blue-700 text-white text-xs font-medium z-50">
          {undoStatus}
        </div>
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onConnected={() => { setDbOk(true); setShowSettings(false) }}
        />
      )}
    </div>
    </ConsolidationContext.Provider>
  )
}

export default function App() {
  const [auth, setAuth] = useState({ loading: true, setupRequired: false, localDevelopment: false, localSetupAvailable: false, user: null, error: '' })
  const [signingOut, setSigningOut] = useState(false)
  const [showDatabaseSetup, setShowDatabaseSetup] = useState(false)

  const refreshAuth = useCallback(async () => {
    let localSetupAvailable = false
    try {
      localSetupAvailable = await window.api.canConfigureLocalEngagement()
      const result = await window.api.engagementAuthStatus()
      setAuth({ loading: false, setupRequired: result.setupRequired, localDevelopment: !!result.localDevelopment, localSetupAvailable, user: result.user, error: '' })
    } catch (error) {
      setAuth(current => ({ ...current, loading: false, localSetupAvailable, user: null, error: error.message || 'Unable to connect to the firm sign-in service.' }))
    }
  }, [])

  useEffect(() => { refreshAuth() }, [refreshAuth])

  const signOut = async () => {
    setSigningOut(true)
    try {
      await window.api.logoutEngagementUser()
      setAuth(current => ({ ...current, user: null }))
    } catch (error) {
      setAuth(current => ({ ...current, error: error.message || 'Unable to sign out.' }))
    } finally {
      setSigningOut(false)
    }
  }

  if (auth.loading) {
    return <div className="flex h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">Connecting to firm sign-in…</div>
  }
  if (!auth.user && auth.error) {
    return (
      <>
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-gray-50 p-5">
          <p role="alert" className="max-w-md text-center text-sm text-red-700">{auth.error}</p>
          <div className="flex gap-3">
            {auth.localSetupAvailable && <button onClick={() => setShowDatabaseSetup(true)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Configure database</button>}
            <button onClick={refreshAuth} className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)]">Retry connection</button>
          </div>
        </div>
        {showDatabaseSetup && <SettingsModal
          initialSetupOnly
          onClose={() => setShowDatabaseSetup(false)}
          onConnected={async () => {
            try {
              await window.api.restartLocalEngagement()
              setShowDatabaseSetup(false)
              await refreshAuth()
            } catch (error) {
              setShowDatabaseSetup(false)
              setAuth(current => ({ ...current, error: error.message || 'Unable to start the local engagement service.' }))
            }
          }}
        />}
      </>
    )
  }
  if (!auth.user) {
    return (
      <div className="flex h-screen flex-col overflow-y-auto bg-gray-50">
        <AuthGate
          setupRequired={auth.setupRequired}
          localDevelopment={auth.localDevelopment}
          requireLoginAfterSetup
          onAuthenticated={user => setAuth(current => ({ ...current, user, error: '' }))}
        />
        <p className="mx-auto max-w-md px-5 pb-5 text-center text-xs leading-relaxed text-gray-500">
          Sign-in currently controls access to the workspace and engagement service. Legacy financial operations still require migration to permission-enforced server APIs.
        </p>
      </div>
    )
  }
  if (auth.user.mustChangePassword) {
    return <div className="h-screen overflow-y-auto bg-gray-50"><PasswordChange user={auth.user} onChanged={user => setAuth(current => ({ ...current, user }))} /></div>
  }

  return <ApplicationWorkspace key={auth.user.id} user={auth.user} onSignOut={signOut} signingOut={signingOut} />
}
