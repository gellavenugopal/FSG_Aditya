import React, { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * NavTabs — keyboard-friendly tab bar with dropdown groups.
 *
 * `groups` maps a top-level tab label to an array of child tab labels (a child may itself be a group).
 * Clicking a grouped top-level tab opens a dropdown of its children; clicking a child navigates to that leaf tab.
 *
 * The dropdown is rendered via a portal (fixed-positioned against the clicked button's own bounding rect) because the tab bar
 * itself scrolls horizontally, which clips an in-flow dropdown.
 *
 * Keyboard (the underlined letter of every menu item is its key):
 *   Alt+<letter of a top-level tab>          go to that tab; a tab with a dropdown opens it
 *   in an open dropdown:  <letter of an item>  choose it (an item with a list of its own opens that list)
 *                         Up / Down + Enter    move and choose;  Right / Left  enter / leave a list
 *                         Escape               closes the list, then the dropdown
 *   Escape (no dropdown or dialog open)        back to the screen that was open before (App.jsx)
 *   ArrowLeft / ArrowRight / Home / End        move between the top-level tabs
 */

// Top-level tab -> its key (Alt+key). Unique across the bar.
export const TOP_SHORTCUTS = {
  'Master': 'M',
  'Trial Balance': 'T',
  'Stock': 'S',
  'Mapping': 'P',
  'Dep': 'D',
  'BS': 'B',
  'PL': 'L',
  'CFS': 'C',
  'Notes': 'N',
  'General Notes': 'G',
  'Annex & Reco': 'X',
  'Features': 'U',
  'Exception': 'E',
  'Generate Financials': 'F',
}

// Item -> its key, per dropdown (unique within the dropdown it is in)
const ITEM_SHORTCUTS = {
  'Master': { 'Auditee Details': 'A', 'Financial Period': 'F', 'Auditor': 'U', 'Signatory': 'S', 'Mapping Rules': 'M' },
  'Trial Balance': { 'Upload TB': 'U', 'Actual TB': 'A', 'Mapped TB': 'M', 'Mapped TB (Remarks)': 'R', 'Journal Entry': 'J' },
  'Mapping': { 'Rectification / Recategorisation': 'R', 'Mapped TB': 'M', 'Mapping Rules': 'U' },
  'Dep': { 'Dep (Comp)': 'C', 'Dep (IT)': 'I', 'Dep (Old)': 'O' },
  'Features': { 'ITR': 'I', 'Tax Computation': 'T', 'Deferred Tax': 'D', 'PPE': 'P', 'Ratio': 'R', 'Format': 'F' },
  'ITR': { 'ITR: BS': 'B', 'ITR: PL': 'P', 'ITR: BS Details': 'D', 'ITR: PL Details': 'L' },
  'Format': { 'Format: Proprietorship': 'R', 'Format: Partnership': 'A', 'Format: LLP': 'L', 'Format: Company': 'C' },
}

const shown = (label) => label.replace(/^[^:]+:\s*/, '')

// The label with its key underlined — a single inline span so it behaves as one flex item.
function KeyLabel({ text, k }) {
  if (!k) return <span>{text}</span>
  const idx = text.toUpperCase().indexOf(k)
  if (idx === -1) return <span>{text}</span>
  return (
    <span>
      {text.slice(0, idx)}
      <u>{text[idx]}</u>
      {text.slice(idx + 1)}
    </span>
  )
}

const typing = () => {
  const el = document.activeElement
  const tag = (el?.tagName || '').toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el?.isContentEditable
}

export default function NavTabs({ tabs, groups, active, onChange, openRequest }) {
  const btnRefs = useRef([])
  const navRef = useRef(null)
  const dropdownRef = useRef(null)
  const closeTimerRef = useRef(null)
  const [openGroup, setOpenGroup] = useState(null)
  const [openSub, setOpenSub] = useState(null)   // a dropdown item that is itself a group (Features > Format)
  const [hi, setHi] = useState(0)                // the highlighted item of the list the keyboard is in
  const [dropdownPos, setDropdownPos] = useState(null) // { left, top }

  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current) }, [])

  const openGroupAt = (tab, idx) => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
    const rect = btnRefs.current[idx]?.getBoundingClientRect()
    if (rect) setDropdownPos({ left: rect.left, top: rect.bottom })
    setOpenGroup(tab)
  }
  const scheduleClose = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => setOpenGroup(null), 150)
  }
  const cancelClose = () => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
  }

  // A top-level shortcut from App.jsx for a tab with a dropdown: open it, first item highlighted
  useEffect(() => {
    if (!openRequest || !openRequest.tab) return
    const idx = tabs.indexOf(openRequest.tab)
    if (idx < 0 || !groups?.[openRequest.tab]) return
    setOpenSub(null); setHi(0)
    openGroupAt(openRequest.tab, idx)
  }, [openRequest?.n])

  // Close the open dropdown on outside click
  useEffect(() => {
    if (!openGroup) return
    const onMouseDown = (e) => {
      if (
        navRef.current && !navRef.current.contains(e.target) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target)
      ) { setOpenGroup(null); setOpenSub(null) }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [openGroup])

  const holdsActive = (tab) => {
    const children = groups?.[tab]
    return children ? children.some(c => c === active || holdsActive(c)) : active === tab
  }
  const isTopActive = (tab) => holdsActive(tab)

  const handleTopClick = (tab, idx) => {
    const children = groups?.[tab]
    if (children) {
      setOpenSub(null); setHi(0)
      setOpenGroup(prev => {
        if (prev === tab) return null
        const rect = btnRefs.current[idx]?.getBoundingClientRect()
        if (rect) setDropdownPos({ left: rect.left, top: rect.bottom })
        return tab
      })
    } else {
      setOpenGroup(null)
      onChange(tab)
    }
  }

  const handleChildClick = (child) => {
    setOpenGroup(null)
    setOpenSub(null)
    onChange(child)
  }

  // Keys inside an open dropdown (letters, arrows, Enter, Escape)
  useEffect(() => {
    if (!openGroup) return
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (typing()) return
      const parent = openSub || openGroup
      const list = groups?.[parent] || []
      if (!list.length) return
      const k = e.key
      const choose = (item) => {
        if (groups?.[item]) { setOpenSub(item); setHi(0) } else handleChildClick(item)
      }
      if (k === 'Escape') {
        e.preventDefault()
        if (openSub) { setOpenSub(null); setHi(Math.max(0, (groups?.[openGroup] || []).indexOf(openSub))) }
        else { setOpenGroup(null) }
        return
      }
      if (k === 'ArrowDown') { e.preventDefault(); setHi(h => (h + 1) % list.length); return }
      if (k === 'ArrowUp')   { e.preventDefault(); setHi(h => (h - 1 + list.length) % list.length); return }
      if (k === 'Enter')     { e.preventDefault(); const item = list[Math.min(hi, list.length - 1)]; if (item) choose(item); return }
      if (k === 'ArrowRight') {
        const item = list[Math.min(hi, list.length - 1)]
        if (item && groups?.[item]) { e.preventDefault(); setOpenSub(item); setHi(0) }
        return
      }
      if (k === 'ArrowLeft' && openSub) { e.preventDefault(); setHi(Math.max(0, (groups?.[openGroup] || []).indexOf(openSub))); setOpenSub(null); return }
      if (k.length === 1) {
        const want = k.toUpperCase()
        const map = ITEM_SHORTCUTS[parent] || {}
        const item = list.find(c => map[c] === want)
        if (item) { e.preventDefault(); choose(item) }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [openGroup, openSub, hi, groups])

  const handleKeyDown = (e, idx) => {
    let nextIdx = null
    if      (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length
    else if (e.key === 'ArrowLeft')  nextIdx = (idx - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home')       nextIdx = 0
    else if (e.key === 'End')        nextIdx = tabs.length - 1

    if (nextIdx !== null) {
      e.preventDefault()
      setOpenGroup(null)
      btnRefs.current[nextIdx]?.focus()
    }
  }

  const openChildren = openGroup ? groups?.[openGroup] : null
  const itemCls = (isActive, isHi) =>
    `w-full text-left px-4 py-2 text-sm transition flex items-center justify-between ${
      isHi ? 'bg-blue-100 text-blue-900' : isActive ? 'bg-blue-50 text-blue-800 font-semibold' : 'hover:bg-blue-50 text-gray-800'
    }`

  return (
    <nav
      ref={navRef}
      role="tablist"
      aria-label="Main navigation"
      className="relative flex items-end gap-0 bg-white border-b border-blue-100 px-4 shrink-0 overflow-x-auto"
    >
      {tabs.map((tab, idx) => {
        const children = groups?.[tab]
        const topActive = isTopActive(tab)
        const key = TOP_SHORTCUTS[tab]
        return (
          <button
            key={tab}
            ref={el => (btnRefs.current[idx] = el)}
            role="tab"
            aria-selected={topActive}
            aria-haspopup={!!children}
            aria-expanded={children ? openGroup === tab : undefined}
            tabIndex={topActive ? 0 : -1}
            title={`${tab} (Alt+${key || '?'})`}
            onClick={() => handleTopClick(tab, idx)}
            onMouseEnter={() => children && openGroupAt(tab, idx)}
            onMouseLeave={() => children && scheduleClose()}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`px-4 py-2.5 text-sm whitespace-nowrap transition-all duration-150 flex items-center gap-1
              focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-inset
              ${topActive ? 'tab-active' : 'tab-inactive'}`}
          >
            <KeyLabel text={tab} k={key} />
            {children && <span className="text-[9px] opacity-70">{openGroup === tab ? '▴' : '▾'}</span>}
          </button>
        )
      })}

      {openGroup && openChildren && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          role="menu"
          style={{ position: 'fixed', left: dropdownPos.left, top: dropdownPos.top }}
          className="bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-60 py-1"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {openChildren.map((child, ci) => {
            const leaves = groups?.[child]
            const ck = ITEM_SHORTCUTS[openGroup]?.[child]
            const hiHere = !openSub && hi === ci
            // An item that is itself a group opens a second list beside it.
            if (leaves) {
              return (
                <div key={child} className="relative"
                  onMouseEnter={() => setOpenSub(child)} onMouseLeave={() => setOpenSub(null)}>
                  <button
                    role="menuitem"
                    aria-haspopup="true"
                    aria-expanded={openSub === child}
                    onClick={() => setOpenSub(prev => (prev === child ? null : child))}
                    className={itemCls(holdsActive(child), hiHere || openSub === child)}
                  >
                    <KeyLabel text={child} k={ck} /><span className="text-[9px] opacity-70">▸</span>
                  </button>
                  {openSub === child && (
                    <div role="menu" className="absolute left-full top-0 -mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-56 py-1">
                      {leaves.map((leaf, li) => (
                        <button
                          key={leaf}
                          role="menuitem"
                          onClick={() => handleChildClick(leaf)}
                          className={itemCls(active === leaf, hi === li)}
                        >
                          <KeyLabel text={shown(leaf)} k={ITEM_SHORTCUTS[child]?.[leaf]} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            }
            return (
              <button
                key={child}
                role="menuitem"
                onClick={() => handleChildClick(child)}
                className={itemCls(active === child, hiHere)}
              >
                <KeyLabel text={child} k={ck} />
              </button>
            )
          })}
        </div>,
        document.body
      )}
    </nav>
  )
}
