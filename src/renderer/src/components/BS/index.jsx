import React, { useState } from 'react'
import { formatPeriodText } from '../../utils/financialPeriodDisplay'
import { useFinancials, fmtINR } from '../../hooks/useFinancials'
import { fixFilterWith } from '../../utils/fixTargets'
import PYTBSelector from '../shared/PYTBSelector'
import ManualPYButton from '../shared/ManualPYButton'
import PYModeSelect from '../shared/PYModeSelect'
import PlClosedToCapitalButton from '../shared/PlClosedToCapitalButton'
import RemarkCell, { useRemarks } from '../shared/RemarkCell'
import { FormatRefButton, SCHEDULE3_SECTIONS } from '../shared/FormatReference'
import {
  computeDynamicBSLayout, BS_STRUCTURE, matchToBuckets, buildUncatBuckets, elGroupOf, assetGroupOf, tradePayablesSplit } from '../../utils/bsStructure'

// Schedule III structure and line matching are shared with the PDF and Excel
// exports (utils/bsStructure.js), so the screen can never disagree with them.

// ── Group-level total ─────────────────────────────────────────────────────────
function groupTotal(buckets, keys) {
  return {
    total:     keys.reduce((s, k) => s + (buckets[k]?.total     || 0), 0),
    prevTotal: keys.reduce((s, k) => s + (buckets[k]?.prevTotal || 0), 0),
  }
}

function Guard({ activeTB, loading, error, children }) {
  if (!activeTB) return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Load a Trial Balance in the Actual TB tab first.</div>
  if (loading)   return <div className="flex items-center justify-center h-full text-gray-400">Loading financial data...</div>
  if (error)     return <div className="flex items-center justify-center h-full text-red-500 text-sm px-8 text-center">{error}</div>
  return children
}

const ALPHA_SEQ = 'abcdefghijklmnopqrstuvwxyz'

// ── A single BS line row ──────────────────────────────────────────────────────
function BsRow({ num, alpha, label, noteNum, total, prevTotal, bold, dark, head, sub, red, indent, onNoteClick, tbId, getRemark, onRemarkSaved, onFix, fixFilter }) {
  const cls = dark ? 'bg-blue-800 text-white'
    : head ? 'bg-blue-50 border-b border-blue-200'
    : bold ? 'bg-white font-semibold border-b border-blue-100'
    : red  ? 'bg-red-50/60 border-b border-gray-100 hover:bg-red-100/60'
    : sub  ? 'border-b border-gray-50 hover:bg-gray-50'
    : 'border-b border-gray-100 hover:bg-gray-50'

  const indentPl = indent === 2 ? 'pl-12' : indent === 1 ? 'pl-8' : 'pl-4'
  const textCls  = dark ? 'text-white font-bold'
    : head  ? 'text-blue-800 font-bold'
    : bold  ? 'text-blue-800 font-semibold'
    : red   ? 'text-red-700'
    : 'text-gray-800'

  return (
    <tr className={cls}>
      <td className={`py-1.5 text-xs w-10 text-center ${dark ? 'text-white' : 'text-gray-500'}`}>{num || ''}</td>
      <td className={`py-1.5 text-xs w-8 text-center ${dark ? 'text-white' : red ? 'text-red-400' : 'text-gray-400'}`}>{alpha || ''}</td>
      <td className={`py-1.5 text-xs ${indentPl} ${textCls}`}>
        {label}
        {red && tbId && onFix && fixFilter && (
          <button onClick={() => onFix(fixFilter, `Fix: ${label}`)}
            className="ml-2 px-1.5 py-0.5 text-[10px] rounded border border-red-400 text-red-700 bg-white hover:bg-red-100 transition font-medium">
            Fix
          </button>
        )}
        {tbId && label && (
          <span className="ml-1 align-middle">
            <RemarkCell tbId={tbId} scope="bs" scopeKey={label}
              initialValue={getRemark?.('bs', label) || ''}
              onSaved={onRemarkSaved} compact />
          </span>
        )}
      </td>
      <td className="py-1.5 text-center text-xs w-16">
        {noteNum ? (
          <button onClick={() => onNoteClick?.(noteNum)}
            className={`font-semibold hover:underline ${dark ? 'text-blue-200' : 'text-blue-600'}`}>
            {noteNum}
          </button>
        ) : ''}
      </td>
      <td className={`py-1.5 text-right font-mono text-xs pr-2 w-32 ${dark ? 'font-bold text-white' : bold ? 'text-blue-900 font-bold border-t-2 border-blue-400' : head ? 'text-gray-400' : red ? 'text-red-600' : 'text-gray-900'}`}>
        {total !== undefined ? fmtINR(total) : ''}
      </td>
      <td className={`py-col py-1.5 text-right font-mono text-xs pr-2 w-32 ${dark ? 'opacity-70 text-white' : bold ? 'text-gray-400 border-t-2 border-blue-400' : 'text-gray-400'}`}>
        {prevTotal !== undefined ? fmtINR(prevTotal) : ''}
      </td>
    </tr>
  )
}

function Spacer() { return <tr><td colSpan={6} className="py-0.5" /></tr> }

// ── Non-company (proprietor / partnership) BS — dynamic layout ────────────────
function DynamicBS({ data, onNoteClick, activeTB, prevTB, getRemark, onRemarkSaved, openFix, entity }) {
  const ALPHA = 'abcdefghijklmnopqrstuvwxyz'
  // computeDynamicBSLayout fills in every statutory Level1/Level2 pair from
  // LevelFormat that has no real ledgers mapped yet (zero total, no Note) —
  // without it, a line with nothing currently mapped to it just vanishes
  // from the face entirely instead of showing as a zero line.
  const layout = computeDynamicBSLayout(data, entity?.constitution)
  const elSections = layout.el
  const assetSections = layout.assets
  const grandPrevEL     = layout.prevEL
  const grandPrevAssets = layout.prevAsset

  function SectionBlock({ index, section }) {
    const l1 = section.level1 || ''
    const isU = !l1 || (l1 || '').toLowerCase().includes('uncategorised')
    if (isU && Math.abs(section.total) < 0.005 && Math.abs(section.prevTotal) < 0.005) return null
    return (
      <>
        <tr className={isU ? 'bg-red-50' : 'bg-blue-50'}>
          <td colSpan={6} className={`py-1.5 px-3 font-bold border-b border-blue-100 text-xs ${isU ? 'text-red-700' : 'text-blue-800'}`}>
            ({index}) {l1 || <span className="italic">Uncategorised</span>}
            {isU && activeTB?.id && openFix && (
              <button onClick={() => openFix(fixFilterWith({ alie: 'EQUITY AND LIABILITIES', uncategorised: true }, section.lines.flatMap(l => l.rows || [])), `Fix: ${l1}`)}
                className="ml-2 px-2 py-0.5 text-[10px] rounded border border-red-400 text-red-700 bg-white hover:bg-red-100 transition font-medium">
                Fix Categorisation
              </button>
            )}
            {activeTB?.id && l1 && (
              <span className="ml-1 align-middle">
                <RemarkCell tbId={activeTB.id} scope="bs" scopeKey={l1}
                  initialValue={getRemark?.('bs', l1) || ''}
                  onSaved={onRemarkSaved} compact />
              </span>
            )}
          </td>
        </tr>
        {section.lines.map((line, li) => {
          const l2 = line.level2 || ''
          const lineU = !l2 || l2.toLowerCase().includes('uncategorised')
          if (lineU && Math.abs(line.total) < 0.005 && Math.abs(line.prevTotal) < 0.005) return null
          return (
            <tr key={l2 + li} className={`border-b border-gray-100 hover:bg-gray-50 ${lineU ? 'bg-red-50/40' : ''}`}>
              <td colSpan={2} />
              <td className={`py-1 pl-8 text-xs ${lineU ? 'text-red-600' : 'text-gray-800'}`}>
                {l2 || <span className="italic">Uncategorised</span>}
                {lineU && activeTB?.id && openFix && (
                  <button
                    onClick={() => openFix(
                      fixFilterWith({ mapping1_resultant: section.level1, uncategorised: true }, line.rows),
                      `Fix: ${l2 || section.level1}`
                    )}
                    className="ml-2 px-1.5 py-0.5 text-[10px] rounded border border-red-400 text-red-700 bg-white hover:bg-red-100 transition font-normal"
                  >Fix</button>
                )}
                {activeTB?.id && (l2 || section.level1) && (
                  <span className="ml-1 align-middle">
                    <RemarkCell tbId={activeTB.id} scope="bs" scopeKey={l2 || section.level1}
                      initialValue={getRemark?.('bs', l2 || section.level1) || ''}
                      onSaved={onRemarkSaved} compact />
                  </span>
                )}
              </td>
              <td className="py-1 text-center text-xs">
                {line.noteNum ? <button onClick={() => onNoteClick?.(line.noteNum)} className="text-blue-600 font-semibold hover:underline">{line.noteNum}</button> : ''}
              </td>
              <td className="py-1 text-right font-mono text-xs text-gray-900 pr-2">{fmtINR(line.total)}</td>
              <td className="py-col py-1 text-right font-mono text-xs text-gray-400 pr-2">{fmtINR(line.prevTotal)}</td>
            </tr>
          )
        })}
        <tr className="border-b border-blue-200 bg-blue-50/50">
          <td colSpan={3} className="py-1 pl-8 font-semibold text-blue-700 italic text-xs">Sub-total: {section.level1}</td>
          <td />
          <td className="py-1 text-right font-mono font-semibold text-blue-800 pr-2 text-xs border-t border-blue-200">{fmtINR(section.total)}</td>
          <td className="py-col py-1 text-right font-mono text-gray-400 pr-2 text-xs border-t border-blue-200">{fmtINR(section.prevTotal)}</td>
        </tr>
      </>
    )
  }

  return (
    <>
      <div className="mb-4">
        <div className="text-xs font-bold text-blue-800 uppercase tracking-wider border-b border-blue-300 pb-1 mb-1">EQUITY AND LIABILITIES</div>
        <table className="w-full text-xs table-fixed">
          <colgroup><col style={{ width: '5%' }} /><col style={{ width: '4%' }} /><col style={{ width: '50%' }} /><col style={{ width: '9%' }} /><col style={{ width: '16%' }} /><col className="py-col" style={{ width: '16%' }} /></colgroup>
          <tbody>
            {elSections.map((sec, si) => <SectionBlock key={sec.level1 + si} index={si + 1} section={sec} />)}
          </tbody>
          <tfoot>
            <tr className="bg-blue-800 text-white">
              <td colSpan={4} className="py-2 px-3 font-bold text-xs uppercase tracking-wide">TOTAL EQUITY AND LIABILITIES</td>
              <td className="py-2 text-right font-mono font-bold pr-2 text-xs">{fmtINR(data.totalEL)}</td>
              <td className="py-col py-2 text-right font-mono opacity-70 pr-2 text-xs">{fmtINR(grandPrevEL)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="mb-4">
        <div className="text-xs font-bold text-blue-800 uppercase tracking-wider border-b border-blue-300 pb-1 mb-1">ASSETS</div>
        <table className="w-full text-xs table-fixed">
          <colgroup><col style={{ width: '5%' }} /><col style={{ width: '4%' }} /><col style={{ width: '50%' }} /><col style={{ width: '9%' }} /><col style={{ width: '16%' }} /><col className="py-col" style={{ width: '16%' }} /></colgroup>
          <tbody>
            {assetSections.map((sec, si) => <SectionBlock key={sec.level1 + si} index={si + 1} section={sec} />)}
          </tbody>
          <tfoot>
            <tr className="bg-blue-800 text-white">
              <td colSpan={4} className="py-2 px-3 font-bold text-xs uppercase tracking-wide">TOTAL ASSETS</td>
              <td className="py-2 text-right font-mono font-bold pr-2 text-xs">{fmtINR(data.totalAssets)}</td>
              <td className="py-col py-2 text-right font-mono opacity-70 pr-2 text-xs">{fmtINR(grandPrevAssets)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  )
}

// ── Company Schedule III BS ───────────────────────────────────────────────────
function CompanyBS({ data, onNoteClick, activeTB, prevTB, getRemark, onRemarkSaved, openFix }) {
  const tbId = activeTB?.id

  // Match all E&L and Asset lines to their Schedule III buckets
  const { buckets: elBuckets, unmatched: elUnmatched } =
    matchToBuckets(data.elSections, BS_STRUCTURE.el)
  const { buckets: aBuckets, unmatched: aUnmatched } =
    matchToBuckets(data.assetSections, BS_STRUCTURE.assets, data)

  // Route unmatched into per-group uncategorised buckets (shown explicitly)
  const { byGroup: elUncatByGroup, topLevel: elUncatTop } =
    buildUncatBuckets(elUnmatched, elGroupOf)
  const { byGroup: aUncatByGroup, topLevel: aUncatTop } =
    buildUncatBuckets(aUnmatched, assetGroupOf)

  // LTB reconciliation — from note.ltbValidation set by Fix #4
  const ltbNote    = Object.values(data.notes || {}).find(n => /long.term borrow/i.test(n.title || ''))
  const ltbUnrecon = ltbNote?.ltbValidation?.mismatchGross
    ? Math.abs(ltbNote.ltbValidation.tbRawCY - ltbNote.ltbValidation.formGrossCY)
    : 0
  const ltbUnreconPY = ltbNote?.ltbValidation?.mismatchGross
    ? Math.abs(ltbNote.ltbValidation.tbRawPY - ltbNote.ltbValidation.formGrossPY)
    : 0

  // Grand totals — include all unmatched amounts so BS still balances
  const elKeys    = BS_STRUCTURE.el.flatMap(g => g.lines.map(l => l.key))
  const assetKeys = BS_STRUCTURE.assets.flatMap(g => g.lines.map(l => l.key))
  const matchedELcy  = elKeys.reduce((s, k) => s + (elBuckets[k]?.total     || 0), 0)
  const matchedELpy  = elKeys.reduce((s, k) => s + (elBuckets[k]?.prevTotal || 0), 0)
  const uncatELcy    = Object.values(elUncatByGroup).reduce((s, v) => s + v.total,     0) + elUncatTop.total
  const uncatELpy    = Object.values(elUncatByGroup).reduce((s, v) => s + v.prevTotal, 0) + elUncatTop.prevTotal
  const totalEL      = matchedELcy + uncatELcy
  const prevEL       = matchedELpy + uncatELpy

  const matchedACy   = assetKeys.reduce((s, k) => s + (aBuckets[k]?.total     || 0), 0)
  const matchedAPy   = assetKeys.reduce((s, k) => s + (aBuckets[k]?.prevTotal || 0), 0)
  const uncatACy     = Object.values(aUncatByGroup).reduce((s, v) => s + v.total,     0) + aUncatTop.total
  const uncatAPy     = Object.values(aUncatByGroup).reduce((s, v) => s + v.prevTotal, 0) + aUncatTop.prevTotal
  const totalAsset   = matchedACy + uncatACy
  const prevAsset    = matchedAPy + uncatAPy

  const colgroup = (
    <colgroup>
      <col style={{ width: '5%' }} />
      <col style={{ width: '5%' }} />
      <col style={{ width: '50%' }} />
      <col style={{ width: '9%' }} />
      <col style={{ width: '15.5%' }} />
      <col className="py-col" style={{ width: '15.5%' }} />
    </colgroup>
  )

  // Renders one E&L or Asset group with its hardcoded sub-lines +
  // an optional extra "(x) Uncategorised <Group>" row for unmatched items
  function Group({ group, buckets, uncatByGroup, alieName }) {
    const keys    = group.lines.map(l => l.key)
    const uncat   = uncatByGroup[group.num]
    const hasUncat= uncat && (Math.abs(uncat.total) > 0.005 || Math.abs(uncat.prevTotal) > 0.005)

    // Next alpha letter after the last hardcoded line
    const nextAlpha = ALPHA_SEQ[group.lines.filter(l => !l.sub).length] || ''

    // Group total includes unmatched items in this group
    const matchedTot = groupTotal(buckets, keys)
    const gTotCy = matchedTot.total     + (hasUncat ? uncat.total     : 0)
    const gTotPy = matchedTot.prevTotal + (hasUncat ? uncat.prevTotal : 0)
    // Optional groups (inter-branch account) print only when they carry a figure
    if (group.optional && Math.abs(gTotCy) < 0.005 && Math.abs(gTotPy) < 0.005) return null

    return (
      <>
        <BsRow num={group.num} label={group.label} bold
          total={gTotCy || undefined} prevTotal={gTotPy || undefined}
          tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />
        {group.lines.map(entry => {
          const b = buckets[entry.key]
          const isLTBEntry = entry.key === 'ltb'
          // (a) Property, Plant and Equipment and Intangible assets: a caption; (i)-(iv) carry the figures
          if (entry.heading) {
            return <BsRow key={entry.key} alpha={entry.alpha} label={entry.label} sub indent={1}
              tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />
          }
          // Trade payables: a caption over (A) MSME / (B) others (Schedule III) — same split as the PDF / Excel.
          const tpSplit = entry.key === 'trade_pay' ? tradePayablesSplit(data, b?.noteNum, b?.total || 0, b?.prevTotal || 0) : null
          return (
            <React.Fragment key={entry.key}>
              <BsRow
                alpha={entry.alpha} label={entry.label}
                noteNum={b?.noteNum}
                total={tpSplit ? undefined : (b?.total || undefined)}
                prevTotal={tpSplit ? undefined : (b?.prevTotal || undefined)}
                sub indent={entry.sub ? 2 : 1}
                onNoteClick={onNoteClick}
                tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved}
              />
              {tpSplit && tpSplit.map(sl => (
                <BsRow key={sl.label} label={sl.label} total={sl.total || undefined} prevTotal={sl.prevTotal || undefined} sub indent={2} />
              ))}
              {/* Unreconciled LTB warning sub-row — shown when form gross ≠ TB value */}
              {isLTBEntry && ltbUnrecon >= 1 && (
                <BsRow
                  alpha="" label="⚠ Unreconciled Long-Term Borrowings (open Fill Details to fix)"
                  total={ltbUnrecon}
                  prevTotal={ltbUnreconPY || undefined}
                  sub indent={2} red
                  onFix={openFix}
                  fixFilter={{ alie: 'EQUITY AND LIABILITIES', ltbMismatch: true }}
                  tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved}
                />
              )}
            </React.Fragment>
          )
        })}
        {/* Extra row for items mapped to this group's L1 but not to any L2 */}
        {hasUncat && (
          <BsRow
            alpha={nextAlpha}
            label={`Uncategorised ${group.label}`}
            noteNum={uncat.lines[0]?.noteNum}
            total={uncat.total}
            prevTotal={uncat.prevTotal}
            sub indent={1} red
            onNoteClick={onNoteClick}
            onFix={openFix}
            // Scope = this Level 1 AND still uncategorised. Without the flag the
            // screen listed every ledger of the Level 1, categorised or not, so
            // a correctly saved row never left the list.
            fixFilter={fixFilterWith({ alie: alieName, level1Pattern: group.label, uncategorised: true }, uncat.lines.flatMap(l => l.rows || []))}
            tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved}
          />
        )}
        <Spacer />
      </>
    )
  }

  return (
    <>
      {/* EQUITY AND LIABILITIES */}
      <div className="mb-4">
        <div className="text-xs font-bold text-blue-800 uppercase tracking-wider border-b border-blue-300 pb-1 mb-1">
          EQUITY AND LIABILITIES
        </div>
        <table className="w-full text-xs table-fixed">
          {colgroup}
          <tbody>
            {BS_STRUCTURE.el.map(grp => (
              <Group key={grp.num} group={grp} buckets={elBuckets}
                uncatByGroup={elUncatByGroup} alieName="EQUITY AND LIABILITIES" />
            ))}
            {/* Top-level uncategorised — ALIE = E&L but L1 unidentifiable */}
            {(Math.abs(elUncatTop.total) > 0.005 || Math.abs(elUncatTop.prevTotal) > 0.005) && (
              <>
                <BsRow bold label="Uncategorised Liabilities"
                  total={elUncatTop.total} prevTotal={elUncatTop.prevTotal}
                  tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />
                <BsRow alpha="—" label="Uncategorised Liabilities"
                  noteNum={elUncatTop.lines[0]?.noteNum}
                  total={elUncatTop.total} prevTotal={elUncatTop.prevTotal}
                  sub indent={1} red
                  onNoteClick={onNoteClick}
                  onFix={openFix}
                  fixFilter={fixFilterWith({ alie: 'EQUITY AND LIABILITIES', uncategorised: true }, elUncatTop.lines.flatMap(l => l.rows || []))}
                  tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved}
                />
                <Spacer />
              </>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-blue-800 text-white">
              <td colSpan={4} className="py-2 px-3 font-bold text-xs uppercase tracking-wide">TOTAL EQUITY AND LIABILITIES</td>
              <td className="py-2 text-right font-mono font-bold pr-2 text-xs">{fmtINR(totalEL)}</td>
              <td className="py-col py-2 text-right font-mono opacity-70 pr-2 text-xs">{fmtINR(prevEL)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ASSETS */}
      <div className="mb-4">
        <div className="text-xs font-bold text-blue-800 uppercase tracking-wider border-b border-blue-300 pb-1 mb-1">
          ASSETS
        </div>
        <table className="w-full text-xs table-fixed">
          {colgroup}
          <tbody>
            {BS_STRUCTURE.assets.map(grp => (
              <Group key={grp.num} group={grp} buckets={aBuckets}
                uncatByGroup={aUncatByGroup} alieName="ASSETS" />
            ))}
            {/* Top-level uncategorised assets */}
            {(Math.abs(aUncatTop.total) > 0.005 || Math.abs(aUncatTop.prevTotal) > 0.005) && (
              <>
                <BsRow bold label="Uncategorised Assets"
                  total={aUncatTop.total} prevTotal={aUncatTop.prevTotal}
                  tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved} />
                <BsRow alpha="—" label="Uncategorised Assets"
                  noteNum={aUncatTop.lines[0]?.noteNum}
                  total={aUncatTop.total} prevTotal={aUncatTop.prevTotal}
                  sub indent={1} red
                  onNoteClick={onNoteClick}
                  onFix={openFix}
                  fixFilter={fixFilterWith({ alie: 'ASSETS', uncategorised: true }, aUncatTop.lines.flatMap(l => l.rows || []))}
                  tbId={tbId} getRemark={getRemark} onRemarkSaved={onRemarkSaved}
                />
                <Spacer />
              </>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-blue-800 text-white">
              <td colSpan={4} className="py-2 px-3 font-bold text-xs uppercase tracking-wide">TOTAL ASSETS</td>
              <td className="py-2 text-right font-mono font-bold pr-2 text-xs">{fmtINR(totalAsset)}</td>
              <td className="py-col py-2 text-right font-mono opacity-70 pr-2 text-xs">{fmtINR(prevAsset)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Balance difference */}
      {Math.abs(totalEL - totalAsset) > 1 && (
        <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Balance Sheet difference: {fmtINR(Math.abs(totalEL - totalAsset))}. Check unmapped or uncategorised ledgers.
        </div>
      )}
    </>
  )
}

// ── Main BS component ─────────────────────────────────────────────────────────
export default function BS({ entity, activeTB, prevTB, activeRsId, onPrevTBChange, onNoteClick, onFixNavigate }) {
  const { data, loading, error, refresh } = useFinancials(activeTB, prevTB, entity, activeRsId)
  const { get: getRemark, set: setRemark } = useRemarks(activeTB?.id)
  const onRemarkSaved = (scope, key, value) => setRemark(scope, key, value)
  // "Fix" jumps to the full Rectification / Recategorisation screen, scoped
  // to just the clicked category — same screen/features as the Mapping menu.
  const openFix = (filter, title) => onFixNavigate?.(filter, title)

  // Branch entities: Manual PY and a real Previous Year TB selection are
  // mutually exclusive — either the PY figures come from a real comparative
  // TB, or they're entered manually, never both at once (per-branch, since
  // Manual PY is a per-TB flag).
  const isBranchEntity = !!entity?.has_branches
  const [manualPyOn, setManualPyOn] = useState(false)

  const isCompany = parseInt(entity?.constitution) === 3
  const cyLabel   = 'Current Year'
  const pyLabel   = 'Previous Year'
  const subtitle  = activeTB?.period ? `Balance Sheet as at ${formatPeriodText(activeTB.period)}` : 'Balance Sheet'
  // Previous Year not required for this Financial Year (PYModeSelect): nothing to pick or type, and - when the CA
  // asked for it - no Previous Year column ('hide-py' hides every .py-col below).
  const pyOff = !!data?.pyMode && data.pyMode !== 'required'
  const pyOffTitle = 'Previous Year figures are switched off for this Financial Year (Previous Year figures: Required).'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-2 border-b border-blue-100 bg-gray-50 shrink-0">
        <span className="text-xs text-gray-500 font-medium">Balance Sheet</span>
        <FormatRefButton entity={entity} url={SCHEDULE3_SECTIONS.BS.url} label={SCHEDULE3_SECTIONS.BS.label} />
        <div className="ml-auto flex items-center gap-2">
          <PYModeSelect activeTB={activeTB} onChanged={refresh} />
          <ManualPYButton tbId={activeTB?.id} entityId={entity?.id} data={data} onChanged={refresh}
            onEnabledChange={isBranchEntity ? setManualPyOn : undefined}
            disabled={(isBranchEntity && !!prevTB?.id) || pyOff}
            disabledTitle={pyOff ? pyOffTitle : 'A Previous Year Trial Balance is already selected for this branch — clear it below to use Manual PY instead.'} />
          <PlClosedToCapitalButton tbId={activeTB?.id} entityId={entity?.id} onChanged={refresh} label={prevTB?.id ? 'CY' : ''} />
          {prevTB?.id && (
            <PlClosedToCapitalButton tbId={prevTB.id} onChanged={refresh} label="PY" />
          )}
          <PYTBSelector entity={entity} currentTBId={activeTB?.id} prevTB={prevTB} onChange={onPrevTBChange}
            disabled={(isBranchEntity && manualPyOn) || pyOff}
            disabledTitle={pyOff ? pyOffTitle : 'Manual PY is ON for this branch — turn it off to select a Previous Year Trial Balance instead.'} />
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto p-5 bg-white ${data?.pyMode === 'none_hide' ? 'hide-py' : ''}`}>
        <Guard activeTB={activeTB} loading={loading} error={error}>
          {data && (
            <>
              {/* Header */}
              <div className="text-center mb-5 pb-3 border-b-2 border-blue-800">
                <h1 className="text-lg font-bold text-blue-900 uppercase tracking-wide">{entity?.name || 'Entity Name'}</h1>
                {entity?.constitution_display && <p className="text-xs text-gray-500 mt-0.5">({entity.constitution_display})</p>}
                <h2 className="text-sm font-bold text-gray-800 mt-2 uppercase tracking-wide">{subtitle}</h2>
                <p className="text-xs text-gray-400 mt-0.5">(Amount in ₹)</p>
              </div>

              {/* Column headers */}
              <table className="w-full text-xs mb-2 table-fixed">
                <colgroup>
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '50%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '15.5%' }} />
                  <col className="py-col" style={{ width: '15.5%' }} />
                </colgroup>
                <thead>
                  <tr className="border-b-2 border-blue-800">
                    <th colSpan={2} className="text-left py-1.5 font-semibold text-blue-900 text-xs">No.</th>
                    <th className="text-left py-1.5 font-semibold text-blue-900 text-xs">Particulars</th>
                    <th className="text-center py-1.5 font-semibold text-blue-900 text-xs">Note No.</th>
                    <th className="text-right py-1.5 font-semibold text-blue-900 pr-2 text-xs">{cyLabel}</th>
                    <th className="py-col text-right py-1.5 font-semibold text-blue-900 pr-2 text-xs">{pyLabel}</th>
                  </tr>
                </thead>
              </table>

              {isCompany ? (
                <CompanyBS
                  data={data}
                  onNoteClick={onNoteClick}
                  activeTB={activeTB}
                  prevTB={prevTB}
                  getRemark={getRemark}
                  onRemarkSaved={onRemarkSaved}
                  openFix={openFix}
                />
              ) : (
                <DynamicBS
                  data={data}
                  onNoteClick={onNoteClick}
                  activeTB={activeTB}
                  prevTB={prevTB}
                  getRemark={getRemark}
                  onRemarkSaved={onRemarkSaved}
                  openFix={openFix}
                  entity={entity}
                />
              )}

              <div className="mt-4 pt-3 border-t border-gray-200 text-xs text-gray-400 flex justify-between">
                <span>The accompanying notes form an integral part of the financial statements.</span>
                <span>Click note numbers to navigate.</span>
              </div>
            </>
          )}
        </Guard>
      </div>
    </div>
  )
}
