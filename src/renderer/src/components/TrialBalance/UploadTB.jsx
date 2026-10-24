import React, { useState, useEffect } from 'react'
import { useModalKeys } from '../../hooks/useModalKeys'
import { parseTallyTB, parseMasterJSON, buildTBRowsFromTally, parseRealBooksTB, parseRealBooksMaster, buildTBRowsFromRealBooks } from '../../utils/tallyParsers'
import { parseZohoTB, buildTBRowsFromZoho } from '../../utils/zohoParsers'
import { parseBusyTB, buildTBRowsFromBusy } from '../../utils/busyParsers'
import FinancialPeriodPicker from '../shared/FinancialPeriodPicker'

// Every TB is compulsorily tied to a real Financial Period — checks whether
// that period already has a TB (branch entities excepted, since one TB per
// branch per period is the normal, expected shape there) and asks for
// confirmation rather than silently allowing a duplicate. Returns true if
// the caller should proceed with the upload.
async function confirmIfPeriodAlreadyHasTB(entityPeriodId, hasBranches) {
  if (!entityPeriodId || hasBranches) return true
  try {
    const existing = await window.api?.getTBsForEntityPeriod(entityPeriodId) || []
    if (existing.length === 0) return true
    return window.confirm(
      `This Financial Period already has ${existing.length} Trial Balance${existing.length > 1 ? 's' : ''} uploaded ` +
      `(${existing.map(t => t.filename || `#${t.id}`).join(', ')}). Upload another one for the same period anyway?`
    )
  } catch {
    return true  // best-effort check — don't block upload if it fails
  }
}

// Tally can report Opening/Closing Stock from three different places, and they
// do NOT always agree:
//   1. Its own Profit & Loss A/c        — what the client's printed P&L shows.
//   2. A manually-entered Stock-in-Hand ledger — used when F11 "Integrate
//      Accounts and Inventory" is No, which OVERRIDES item-level valuation.
//   3. The Inventory Register           — item-level valuation.
// resolveStockFigures() ranks them and flags `ambiguous` when the ones it found
// materially disagree. Silently picking in that case is how a P&L ends up not
// matching, so ask instead — walking the options in priority order rather than
// guessing. Not ambiguous (or only one source found) → no prompt at all.
async function chooseStockSource(stockTotals) {
  const fallback = {
    opening: stockTotals?.openingStockTotal || 0,
    closing: stockTotals?.closingStockTotal || 0,
    source: stockTotals?.chosenSource || 'none',
  }
  const candidates = stockTotals?.candidates || []
  if (!stockTotals?.ambiguous || candidates.length < 2) return fallback

  const fmt = (n) => (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const summary = candidates
    .map((c, i) => `${i + 1}. ${c.label}\n     Opening ${fmt(c.opening)}   Closing ${fmt(c.closing)}`)
    .join('\n')

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    const isLast = i === candidates.length - 1
    const ok = window.confirm(
      `Tally reports Opening/Closing Stock differently depending on where it is read from:\n\n` +
      `${summary}\n\n` +
      `${stockTotals.manualStockDetected
        ? 'A Stock-in-Hand ledger carries a manually-entered balance, so Tally is NOT using item-level valuation for the P&L.\n\n'
        : ''}` +
      `Use option ${i + 1} — ${c.label}?\n` +
      `     Opening ${fmt(c.opening)}   Closing ${fmt(c.closing)}\n\n` +
      `[OK] use this      [Cancel] ${isLast ? 'use it anyway' : 'see the next option'}`
    )
    if (ok || isLast) return { opening: c.opening, closing: c.closing, source: c.source }
  }
  return fallback
}

// ── Small modal to capture period (and branch name) before upload ─────────
function UploadModal({ entity, filePath, hasBranches, onConfirm, onCancel }) {
  const [periodPick, setPeriodPick] = useState(null)
  const [branchName, setBranchName] = useState('')
  const [checking, setChecking] = useState(false)
  const doConfirm = async () => {
    if (!periodPick?.entityPeriodId) return
    setChecking(true)
    const proceed = await confirmIfPeriodAlreadyHasTB(periodPick.entityPeriodId, hasBranches)
    setChecking(false)
    if (!proceed) return
    onConfirm(periodPick.periodText || '', branchName, periodPick.entityPeriodId)
  }
  const containerRef = useModalKeys({ onClose: onCancel, onConfirm: doConfirm })
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box max-w-sm" ref={containerRef} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-blue-900">Upload Trial Balance</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <p className="text-xs text-gray-500 mb-3 truncate">
          File: <span className="font-medium text-gray-700">{filePath.split(/[\\/]/).pop()}</span>
        </p>
        <div className="mb-4">
          <FinancialPeriodPicker entity={entity} value={periodPick} onChange={setPeriodPick} allowCustom={false} />
        </div>
        {hasBranches && (
          <div className="mb-4">
            <label className="block text-xs text-gray-500 mb-1">Branch Name <span className="text-gray-400">(e.g. Head Office, Delhi Branch)</span></label>
            <input
              type="text"
              value={branchName}
              onChange={e => setBranchName(e.target.value)}
              placeholder="e.g. Head Office"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50 transition">
            Cancel
          </button>
          <button
            onClick={doConfirm}
            disabled={!periodPick?.entityPeriodId || checking}
            className="flex-1 py-2 text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-40 transition" style={{ background: 'var(--color-primary)' }}
          >
            {checking ? 'Checking…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Format chooser: ODBC vs Tally dual-file ──────────────────────────────
function FormatChooserModal({ onChoose, onCancel }) {
  const containerRef = useModalKeys({ onClose: onCancel })
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box max-w-md" ref={containerRef} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-blue-900">Choose Trial Balance Format</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <p className="text-xs text-gray-500 mb-4">Select the source format of your Trial Balance.</p>
        <div className="space-y-2">
          <button
            onClick={() => onChoose('odbc')}
            className="w-full text-left border border-gray-300 rounded p-3 hover:border-blue-500 hover:bg-blue-50 transition"
          >
            <div className="text-sm font-semibold text-blue-900">ODBC Format</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Single Excel file with full ODBC schema (Period, Branch, Ledger Code, OpeningBalance,
              Debit, Credit, ClosingBalance, IsDeemedPositive, Parent, Group.$Parent, …).
            </div>
          </button>
          <button
            onClick={() => onChoose('tally')}
            className="w-full text-left border border-gray-300 rounded p-3 hover:border-blue-500 hover:bg-blue-50 transition"
          >
            <div className="text-sm font-semibold text-blue-900">Tally Trial Balance &amp; Chart of Accounts</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Two files: a Tally TB Excel (Particulars · Opening · Debit · Credit · Closing with
              Dr/Cr suffixes) and a Tally Master JSON (chart of accounts → builds the Level 1–7
              hierarchy automatically).
            </div>
          </button>
          <button
            onClick={() => onChoose('realbooks')}
            className="w-full text-left border border-gray-300 rounded p-3 hover:border-blue-500 hover:bg-blue-50 transition"
          >
            <div className="text-sm font-semibold text-blue-900">Real Books Format</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Two files: a Real Books Trial Balance Excel (Ledger Group Details Pivot Structure) and
              a Real Books Ledger Master Excel.
            </div>
          </button>
          <button
            onClick={() => onChoose('zoho')}
            className="w-full text-left border border-gray-300 rounded p-3 hover:border-blue-500 hover:bg-blue-50 transition"
          >
            <div className="text-sm font-semibold text-blue-900">Zoho Books Format</div>
            <div className="text-xs text-gray-500 mt-0.5">
              One Excel file — Zoho Books&apos; Trial Balance report (Account · Account Code · Opening
              Balance · Net Debit · Net Credit · Closing Balance). Zoho shows Debit as + and Credit as −;
              it is converted automatically. Suitable for a branch&apos;s Trial Balance too.
            </div>
          </button>
          <button
            onClick={() => onChoose('busy')}
            className="w-full text-left border border-gray-300 rounded p-3 hover:border-blue-500 hover:bg-blue-50 transition"
          >
            <div className="text-sm font-semibold text-blue-900">Busy Accounting Software Format</div>
            <div className="text-xs text-gray-500 mt-0.5">
              One Excel file — Busy&apos;s Trial Balance (Account/Group Name · Opening Bal. · Debit · Credit · Closing Bal.,
              balances with Dr / Cr). The group tree is read from Busy&apos;s own indentation and checked against every
              group total. Suitable for a branch&apos;s Trial Balance too.
            </div>
          </button>
          <button
            onClick={() => onChoose('tally_auto')}
            className="w-full text-left border border-green-300 rounded p-3 hover:border-green-500 hover:bg-green-50 transition"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-green-800">⚡ Tally Auto-Import (Live)</span>
              <span className="text-[10px] bg-green-100 text-green-700 border border-green-400 rounded px-1 py-0.5 font-medium">NEW</span>
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              Connect directly to Tally while it is open. TB and Chart of Accounts are imported
              automatically — no file export needed. Tally must be running on this computer.
            </div>
          </button>
        </div>
        <div className="mt-4 flex">
          <button onClick={onCancel} className="ml-auto px-3 py-1.5 border border-gray-300 text-gray-600 rounded text-xs hover:bg-gray-50 transition">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Tally dual-file upload modal ─────────────────────────────────────────
function TallyUploadModal({ entity, entityId, hasBranches, onUploaded, onCancel }) {
  const [tbFile, setTBFile]         = useState(null)
  const [masterFile, setMasterFile] = useState(null)
  const [tbData, setTBData]         = useState(null)
  const [masterData, setMasterData] = useState(null)
  const [periodPick, setPeriodPick] = useState(null)
  const [branchName, setBranchName] = useState('')
  const [error, setError]           = useState('')
  const [busy, setBusy]             = useState(false)
  const containerRef = useModalKeys({ onClose: onCancel })

  const handleTB = async (e) => {
    setError(''); const f = e.target.files?.[0]; if (!f) return
    setTBFile(f)
    try {
      const buf = await f.arrayBuffer()
      const parsed = parseTallyTB(buf)
      setTBData(parsed)
    } catch (err) { setError('TB parse failed: ' + (err.message || err)); setTBData(null) }
  }
  const handleMaster = async (e) => {
    setError(''); const f = e.target.files?.[0]; if (!f) return
    setMasterFile(f)
    try {
      const buf = await f.arrayBuffer()
      const parsed = parseMasterJSON(buf)
      setMasterData(parsed)
    } catch (err) { setError('Master JSON parse failed: ' + (err.message || err)); setMasterData(null) }
  }

  const matchStats = React.useMemo(() => {
    if (!tbData || !masterData) return null
    const ledgerMap = masterData.ledgerMap || {}
    let matched = 0
    for (const r of tbData.rows) {
      if (ledgerMap[r.name.trim().toLowerCase()]) matched++
    }
    return { matched, total: tbData.rows.length }
  }, [tbData, masterData])

  const canUpload = !!(tbData?.rows?.length && masterData?.ledgerMap && entityId && periodPick?.entityPeriodId)

  const handleUpload = async () => {
    if (!canUpload) return
    const proceed = await confirmIfPeriodAlreadyHasTB(periodPick.entityPeriodId, hasBranches)
    if (!proceed) return
    setBusy(true); setError('')
    try {
      const rows = buildTBRowsFromTally(tbData.rows, masterData.ledgerMap)
      const res = await window.api?.uploadTallyTB({
        entityId, period: periodPick.periodText || '',
        fileName: tbFile?.name || 'Tally_TB.xlsx',
        tbRows: rows,
        branchName: branchName || '',
        entityPeriodId: periodPick.entityPeriodId,
      })
      onUploaded(res.tb)
    } catch (err) {
      setError(err.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box max-w-xl" ref={containerRef} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-blue-900">Upload Tally Trial Balance &amp; Chart of Accounts</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div className="space-y-3">
          <div>
            <FinancialPeriodPicker entity={entity} value={periodPick} onChange={setPeriodPick} allowCustom={false} />
          </div>
          {hasBranches && (
            <div>
              <label className="block text-xs text-gray-600 mb-1">Branch Name <span className="text-gray-400">(e.g. Head Office, Delhi Branch)</span></label>
              <input
                type="text" value={branchName} onChange={e => setBranchName(e.target.value)}
                placeholder="e.g. Head Office"
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
              />
            </div>
          )}
          <div className="border border-gray-200 rounded p-3 bg-gray-50">
            <label className="block text-xs font-semibold text-blue-900 mb-1">1. Tally Trial Balance (Excel)</label>
            <input type="file" accept=".xlsx,.xls" onChange={handleTB} className="text-xs" />
            {tbFile && (
              <div className="mt-1 text-[11px] text-gray-600">
                <span className="font-medium">{tbFile.name}</span>
                {tbData && <span className="ml-2 text-green-700">{tbData.rows.length} rows parsed</span>}
              </div>
            )}
          </div>
          <div className="border border-gray-200 rounded p-3 bg-gray-50">
            <label className="block text-xs font-semibold text-blue-900 mb-1">2. Chart of Accounts (Tally Master JSON)</label>
            <input type="file" accept=".json" onChange={handleMaster} className="text-xs" />
            {masterFile && (
              <div className="mt-1 text-[11px] text-gray-600">
                <span className="font-medium">{masterFile.name}</span>
                {masterData && (
                  <span className="ml-2 text-green-700">
                    {masterData.ledgerCount} ledgers · {masterData.groupCount} groups
                  </span>
                )}
              </div>
            )}
          </div>
          {matchStats && (
            <div className={`text-xs px-2 py-1 rounded border ${matchStats.matched === matchStats.total ? 'bg-green-50 text-green-800 border-green-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
              {matchStats.matched} / {matchStats.total} ledgers matched to master
              {matchStats.matched < matchStats.total && ' — unmatched ledgers will upload without hierarchy.'}
            </div>
          )}
          {error && <div className="text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 text-xs">{error}</div>}
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} disabled={busy} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50 transition">
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!canUpload || busy}
            className="flex-1 py-2 text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-40 transition" style={{ background: 'var(--color-primary)' }}
          >
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Tally Auto-Import modal ───────────────────────────────────────────────────
function TallyAutoModal({ entity, entityId, hasBranches, onUploaded, onCancel }) {
  const [status, setStatus] = React.useState('checking') // checking | ready | error | importing | done
  const [message, setMessage] = React.useState('Connecting to Tally...')
  const [companies, setCompanies] = React.useState([])
  const [selectedCompany, setSelectedCompany] = React.useState('')
  const [fromDate, setFromDate] = React.useState('')
  const [toDate, setToDate] = React.useState('')
  const [periodPick, setPeriodPick] = React.useState(null)
  const [branchName, setBranchName] = React.useState('')
  const containerRef = useModalKeys({ onClose: onCancel })

  React.useEffect(() => {
    window.api?.checkTally().then(async result => {
      if (!result.running) throw new Error(result.error || 'Tally not found on port 9000')
      const detected = result.detectedCompany

      // Ask Tally for EVERY loaded company, not just the one it happens to
      // report first. Keeping two branches open at once is normal practice,
      // and in that state "the active company" is ambiguous — importing
      // Branch 2 while Branch 1 was still open produced Branch 2's ledgers
      // with Branch 1's stock figures. Naming the company explicitly is the
      // only reliable way to scope the export.
      let coms = []
      try { coms = await window.api?.listTallyCompanies() || [] } catch (_) {}
      if (!coms.length && detected) coms = [detected]

      setCompanies(coms)
      const initial = (detected && coms.includes(detected)) ? detected : (coms[0] || '')
      setSelectedCompany(initial)
      setStatus('ready')
      setMessage(
        coms.length > 1
          ? `Connected. ${coms.length} companies are open in Tally — choose which one to import below.`
          : coms.length === 1
            ? `Connected. Company: ${coms[0]}. Importing pulls whatever period is currently open in Tally.`
            : 'Connected to Tally. Importing pulls whatever company/period is currently open in Tally.'
      )
    }).catch(err => {
      setStatus('error')
      setMessage(err.message)
    })
  }, [])

  const handleImport = async () => {
    if (!entityId) {
      setMessage('Please select an entity first.'); return
    }
    if (!periodPick?.entityPeriodId) {
      setMessage('Please select a Financial Period first.'); return
    }
    const proceed = await confirmIfPeriodAlreadyHasTB(periodPick.entityPeriodId, hasBranches)
    if (!proceed) return
    setStatus('importing')
    setMessage('Fetching Trial Balance and Chart of Accounts from Tally (whatever company/period is currently open there)...')
    try {
      // No company name or date range is sent to Tally — it exports
      // whichever company + period is currently active in the Tally UI.
      // multipleCompanies tells the backend whether this company choice was
      // actually a disambiguation between several open in Tally, or just the
      // single company that happened to be loaded — see tb.js's tally:fetchTB
      // handler: the ODBC fallback cannot target a specific company at all,
      // so it must refuse rather than silently substitute whichever company
      // Tally's ODBC layer considers "current" when there was a real choice
      // to honour.
      const { tbRows, masterData, stockTotals, company } = await window.api?.fetchTallyTB({
        company: selectedCompany || undefined,
        multipleCompanies: companies.length > 1,
      })
      if (!tbRows?.length) throw new Error('No TB rows returned from Tally.')
      // Build rows using the same Tally parser (reuse buildTBRowsFromTally)
      const { buildTBRowsFromTally } = await import('../../utils/tallyParsers')
      const rows = buildTBRowsFromTally(tbRows, masterData.ledgerMap)

      // CA logic: Tally almost never carries an "Opening Stock" ledger with a
      // balance, which is exactly why the TB's Dr/Cr often doesn't net to
      // zero on import. If Tally's own Stock Items give us an aggregate
      // Opening Stock value and the TB doesn't already have a ledger for it,
      // embed it directly as a synthetic "Opening Stock" ledger row — same
      // as if the books themselves had one. tb:uploadTally's existing
      // isOpeningStock detection picks this up automatically (tags it
      // 'Opening Stock (Tally)', auto-maps it into PL), so the TB now
      // reconciles without the CA having to type anything first.
      // Which of Tally's three stock sources to trust — asks the CA only when
      // the sources materially disagree (see chooseStockSource above).
      const stock = await chooseStockSource(stockTotals)

      // ONLY inject when the TB is actually out of balance. The comment above
      // states the premise plainly — "which is exactly why the TB's Dr/Cr often
      // doesn't net to zero on import" — but the condition never tested it, so
      // the row was embedded whenever no Opening Stock ledger was present.
      //
      // For a Tally TB whose opening balances ALREADY net to zero, that
      // one-sided expense row *creates* an imbalance equal to the opening
      // stock. Downstream, saveStockEntries sees the now-unbalanced TB and
      // adds its own reconciling 'Opening Stock' row on top — which is how a
      // 42,75,620 opening stock came to display as 85,51,240 in the Stock
      // form (confirmed on TB 37: raw TB summed to exactly 0.00, then
      // -42,75,620 after import, then -85,51,240 after the Stock tab save).
      //
      // A TB that already balances needs nothing embedded: the Stock tab is
      // the correct route for opening stock there, and it posts BOTH sides
      // (P&L expense + BS inventory) instead of one.
      const openingLitmus = rows.reduce((s, r) => s + (parseFloat(r.opening_balance) || 0), 0)
      const tbAlreadyBalances = Math.abs(openingLitmus) < 1

      const hasOpeningStockRow = rows.some(r => /opening\s*stock/i.test((r.name || '').trim()))
      if (!hasOpeningStockRow && stock.opening > 1 && !tbAlreadyBalances) {
        const v = stock.opening
        rows.push({
          period: '', branch: '', ledger_code: '', name: 'Opening Stock',
          opening_balance: -v, debit: 0, credit: 0, closing_balance: -v,
          is_revenue: null, is_deemed_positive: true, trail_balance: 0,
          parent: '', group_parent: '', group_parent_1: '', group_parent_2: '',
          group_parent_3: '', group_parent_4: '', group_parent_5: '',
          group_parent_6: '', group_parent_7: '',
        })
      }

      const labelCompany = selectedCompany || 'Tally'
      const labelPeriod = fromDate && toDate ? `${fromDate}_${toDate}` : new Date().toISOString().slice(0, 10)
      const res = await window.api?.uploadTallyTB({
        entityId, period: periodPick.periodText || '',
        fileName: `Tally_${labelCompany}_${labelPeriod}.auto`,
        tbRows: rows,
        branchName: branchName || '',
        entityPeriodId: periodPick.entityPeriodId,
        // Closing Stock is deliberately NOT inserted as a ledger row (Tally
        // never has one for it, and giving it one risks the mapping engine
        // double-counting it into the financial statements). It's stored as
        // plain reference data instead, surfaced in the Stock form's "Total
        // as per Trial Balance" column for the CA to manually bifurcate.
        closingStockTotal: stock.closing > 1 ? stock.closing : null,
        // Opening Stock is stored as reference data too now, rather than being
        // embedded as a synthetic ledger row — see schema.js's
        // tally_opening_stock_total comment for why that embedding was wrong.
        openingStockTotal: stock.opening > 1 ? stock.opening : null,
        // Recorded so a branch TB can be checked against the company it
        // really came from, rather than the one you meant to export.
        tallyCompany: company || null,
      })
      setStatus('done')
      const srcLabel = (stockTotals?.candidates || []).find(c => c.source === stock.source)?.label
      setMessage(`✓ Imported ${rows.length} ledgers`
        + (company ? ` from Tally company “${company}”` : ' from Tally')
        + '.'
        + (srcLabel ? ` Stock taken from: ${srcLabel}.` : ''))
      setTimeout(() => onUploaded(res.tb), 1500)
    } catch (err) {
      setStatus('error')
      setMessage('Import failed: ' + err.message)
    }
  }

  const statusColor = { checking: 'text-gray-600', ready: 'text-green-700', error: 'text-red-600', importing: 'text-blue-600', done: 'text-green-700' }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box max-w-md" ref={containerRef} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-green-800">⚡ Tally Auto-Import</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        <div className={`text-xs mb-4 p-2 rounded border ${status === 'error' ? 'bg-red-50 border-red-300' : 'bg-gray-50 border-gray-200'} ${statusColor[status]}`}>
          {status === 'checking' && <span className="animate-pulse">⏳ </span>}
          {message}
        </div>

        {status === 'ready' && (
          <div className="space-y-3">
            <div className="text-[11px] text-gray-500 bg-blue-50 border border-blue-200 rounded p-2">
              Import pulls whatever company and period are currently open in Tally — no need to match names or dates here. The fields below only label how this import is saved in FSG Bharat.
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Company in Tally <span className="text-gray-400">(label only, optional)</span></label>
              {companies.length > 1 ? (
                <select value={selectedCompany} onChange={e => setSelectedCompany(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none">
                  {companies.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : companies.length === 1 ? (
                <div className="border border-gray-200 rounded px-2 py-1.5 text-sm bg-gray-50 font-medium text-gray-800">
                  {companies[0]}
                </div>
              ) : (
                <input type="text" value={selectedCompany} onChange={e => setSelectedCompany(e.target.value)}
                  placeholder="(optional) name for your records"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none" />
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">From Date <span className="text-gray-400">(label only)</span></label>
                <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To Date <span className="text-gray-400">(label only)</span></label>
                <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none" />
              </div>
            </div>
            {companies.length > 1 && (
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Tally Company <span className="text-red-600 font-medium">({companies.length} are open — pick the one to import)</span>
                </label>
                <select
                  value={selectedCompany}
                  onChange={e => setSelectedCompany(e.target.value)}
                  className="w-full border border-amber-400 bg-amber-50 rounded px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  {companies.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <p className="text-[10px] text-amber-700 mt-1">
                  With more than one company open, Tally cannot be relied on to answer every
                  request from the same one — that is what made a branch import pick up another
                  branch's stock. The import is locked to whichever you choose here.
                </p>
              </div>
            )}
            <div>
              <FinancialPeriodPicker entity={entity} value={periodPick} onChange={setPeriodPick} allowCustom={false} />
              <p className="text-[10px] text-gray-400 mt-1">Required — every import is tied to a real Financial Period, not a free-text label.</p>
            </div>
            {hasBranches && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Branch Name <span className="text-gray-400">(e.g. Head Office)</span></label>
                <input type="text" value={branchName} onChange={e => setBranchName(e.target.value)}
                  placeholder="e.g. Head Office"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none" />
              </div>
            )}
            <div className="text-[10px] text-gray-400 bg-yellow-50 border border-yellow-200 rounded p-2">
              ℹ Tally must have HTTP Server enabled: Tally → F12 → Advanced Configuration → Enable HTTP Server = Yes (Port 9000)
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50">
            Cancel
          </button>
          {status === 'ready' && (
            <button onClick={handleImport} disabled={!entityId || !periodPick?.entityPeriodId}
              className="flex-1 py-2 text-white rounded text-sm font-medium disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}>
              Import from Tally
            </button>
          )}
          {status === 'importing' && (
            <button disabled className="flex-1 py-2 text-white rounded text-sm font-medium opacity-60"
              style={{ background: 'var(--color-primary)' }}>
              Importing…
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Real Books dual-file upload modal ────────────────────────────────────────
function RealBooksUploadModal({ entity, entityId, hasBranches, onUploaded, onCancel }) {
  const [tbFile, setTBFile]         = useState(null)
  const [masterFile, setMasterFile] = useState(null)
  const [tbData, setTBData]         = useState(null)
  const [masterData, setMasterData] = useState(null)
  const [period, setPeriod]         = useState('')  // auto-detected from file, used as fallback
  const [periodPick, setPeriodPick] = useState(null)
  const [branchName, setBranchName] = useState('')
  const [error, setError]           = useState('')
  const [busy, setBusy]             = useState(false)
  const containerRef = useModalKeys({ onClose: onCancel })

  const handleTB = async (e) => {
    setError(''); const f = e.target.files?.[0]; if (!f) return
    setTBFile(f)
    try {
      const buf = await f.arrayBuffer()
      const parsed = parseRealBooksTB(buf)
      setTBData(parsed)
      if (parsed.period && !period) setPeriod(parsed.period)
    } catch (err) { setError('TB parse failed: ' + (err.message || err)); setTBData(null) }
  }

  const handleMaster = async (e) => {
    setError(''); const f = e.target.files?.[0]; if (!f) return
    setMasterFile(f)
    try {
      const buf = await f.arrayBuffer()
      const parsed = parseRealBooksMaster(buf)
      setMasterData(parsed)
    } catch (err) { setError('Master parse failed: ' + (err.message || err)); setMasterData(null) }
  }

  const matchStats = React.useMemo(() => {
    if (!tbData || !masterData) return null
    const map = masterData.masterMap || {}
    let matched = 0
    for (const r of tbData.rows) {
      if (map[r.name.toLowerCase()]) matched++
    }
    return { matched, total: tbData.rows.length }
  }, [tbData, masterData])

  const canUpload = !!(tbData?.rows?.length && masterData?.masterMap && entityId && periodPick?.entityPeriodId)

  const handleUpload = async () => {
    if (!canUpload) return
    const proceed = await confirmIfPeriodAlreadyHasTB(periodPick.entityPeriodId, hasBranches)
    if (!proceed) return
    setBusy(true); setError('')
    try {
      const rows = buildTBRowsFromRealBooks(tbData.rows, masterData.masterMap, masterData.groupHierarchyMap, masterData.groupNatureMap)
      const res = await window.api?.uploadRealBooksTB({
        entityId, period: periodPick.periodText || period || tbData.period || '',
        fileName: tbFile?.name || 'RealBooks_TB.xlsx',
        tbRows: rows,
        branchName: branchName || '',
        entityPeriodId: periodPick.entityPeriodId,
      })
      onUploaded(res.tb)
    } catch (err) {
      setError(err.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box max-w-xl" ref={containerRef} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-blue-900">Upload Real Books Trial Balance</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div className="space-y-3">
          <div>
            <FinancialPeriodPicker entity={entity} value={periodPick} onChange={setPeriodPick} allowCustom={false} />
            {period && !periodPick && (
              <p className="text-[10px] text-gray-400 mt-1">File suggests period: <strong>{period}</strong> — still requires selecting a real Financial Period above.</p>
            )}
          </div>
          {hasBranches && (
            <div>
              <label className="block text-xs text-gray-600 mb-1">Branch Name <span className="text-gray-400">(e.g. Head Office, Delhi Branch)</span></label>
              <input
                type="text" value={branchName} onChange={e => setBranchName(e.target.value)}
                placeholder="e.g. Head Office"
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
              />
            </div>
          )}
          <div className="border border-gray-200 rounded p-3 bg-gray-50">
            <label className="block text-xs font-semibold text-blue-900 mb-1">
              1. Trial Balance Excel <span className="font-normal text-gray-400">(Ledger Group Details Pivot Structure)</span>
            </label>
            <input type="file" accept=".xlsx,.xls" onChange={handleTB} className="text-xs" />
            {tbFile && (
              <div className="mt-1 text-[11px] text-gray-600">
                <span className="font-medium">{tbFile.name}</span>
                {tbData && <span className="ml-2 text-green-700">{tbData.rows.length} ledger rows parsed</span>}
              </div>
            )}
          </div>
          <div className="border border-gray-200 rounded p-3 bg-gray-50">
            <label className="block text-xs font-semibold text-blue-900 mb-1">
              2. Ledger Master Excel <span className="font-normal text-gray-400">(Chart of Accounts with Nature &amp; Group Hierarchy)</span>
            </label>
            <input type="file" accept=".xlsx,.xls" onChange={handleMaster} className="text-xs" />
            {masterFile && (
              <div className="mt-1 text-[11px] text-gray-600">
                <span className="font-medium">{masterFile.name}</span>
                {masterData && (
                  <span className="ml-2 text-green-700">{masterData.ledgerCount} ledgers in master</span>
                )}
              </div>
            )}
          </div>
          {matchStats && (
            <div className={`text-xs px-2 py-1.5 rounded border ${matchStats.matched === matchStats.total ? 'bg-green-50 text-green-800 border-green-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
              <span className="font-semibold">{matchStats.matched} / {matchStats.total}</span> TB ledgers matched in master
              {matchStats.matched < matchStats.total && (
                <span className="ml-1">— {matchStats.total - matchStats.matched} unmatched ledgers will upload without hierarchy (mapping may be less accurate).</span>
              )}
            </div>
          )}
          {error && <div className="text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 text-xs">{error}</div>}
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} disabled={busy} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50 transition">Cancel</button>
          <button
            onClick={handleUpload}
            disabled={!canUpload || busy}
            className="flex-1 py-2 text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-40 transition" style={{ background: 'var(--color-primary)' }}
          >
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Zoho Books single-file upload modal ──────────────────────────────────────
const fmtInr = (n) => Math.abs(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const drCr = (n) => (Math.abs(n) < 0.005 ? '' : n > 0 ? ' Dr' : ' Cr')

// Dates found in a Financial Period label ("2025-04-01 To 2026-03-31", "01/04/2025 To 31/03/2026"…)
// as ISO strings, so the file's period can be compared with the period the user picked.
function isoDatesIn(text) {
  const out = []
  const rx = /(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/g
  let m
  while ((m = rx.exec(text || ''))) {
    out.push(m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[6]}-${m[5].padStart(2, '0')}-${m[4].padStart(2, '0')}`)
  }
  return out
}

const ZOHO_SECTION_ORDER = ['Assets', 'Liabilities', 'Equities', 'Income', 'Expense']

// One modal for the two single-file formats that arrive with a Dr + / Cr − (Zoho) or Dr / Cr suffixed (Busy) balance.
const SINGLE_FILE_FLAVORS = {
  zoho: {
    label: 'Zoho Books', fileName: 'Zoho_TB.xlsx', hint: 'Zoho Books — Reports → Trial Balance → Export',
    parse: parseZohoTB, build: buildTBRowsFromZoho, api: 'uploadZohoTB', order: ZOHO_SECTION_ORDER,
    signNote: 'Zoho shows a Debit balance as + and a Credit balance as −; FSG Bharat stores the opposite. Every opening and closing balance is converted on upload — nothing to change by hand. A ledger’s side (asset / liability / income / expense) comes from the Zoho section it sits in, not from the sign of its balance.',
  },
  busy: {
    label: 'Busy', fileName: 'Busy_TB.xlsx', hint: 'Busy — Display → Trial Balance → Export to Excel',
    parse: parseBusyTB, build: buildTBRowsFromBusy, api: 'uploadBusyTB', order: ['Assets', 'Liabilities', 'Equities', 'Income', 'Expense'],
    signNote: 'Busy shows balances with Dr / Cr; FSG Bharat stores a Debit as − and a Credit as +. Every balance is converted on upload. The group tree comes from Busy’s indentation and each group is checked against the accounts under it; a ledger’s side comes from the Busy primary group it sits in. Busy’s Trial Balance carries no closing stock — enter Opening / Closing Stock and its categories (Raw Materials, WIP, Finished Goods, Stock-in-Trade, Stores & Spares) in the Stock menu.',
  },
}

function ZohoUploadModal({ entity, entityId, hasBranches, onUploaded, onCancel, flavor = 'zoho' }) {
  const FL = SINGLE_FILE_FLAVORS[flavor] || SINGLE_FILE_FLAVORS.zoho
  const [file, setFile]             = useState(null)
  const [parsed, setParsed]         = useState(null)
  const [periodPick, setPeriodPick] = useState(null)
  const [branchName, setBranchName] = useState('')
  const [error, setError]           = useState('')
  const [busy, setBusy]             = useState(false)
  const containerRef = useModalKeys({ onClose: onCancel })

  const handleFile = async (e) => {
    setError(''); const f = e.target.files?.[0]; if (!f) return
    setFile(f)
    try {
      setParsed(FL.parse(await f.arrayBuffer()))
    } catch (err) { setError(err.message || String(err)); setParsed(null) }
  }

  const canUpload = !!(parsed?.rows?.length && entityId && periodPick?.entityPeriodId)

  // The file's own period vs the Financial Period the user picked — advisory only.
  const periodNote = React.useMemo(() => {
    if (!parsed?.from || !parsed?.to || !periodPick?.periodText) return null
    const d = isoDatesIn(periodPick.periodText)
    if (d.length < 2) return null
    return (d[0] === parsed.from && d[1] === parsed.to) ? null
      : `The file covers ${parsed.periodLabel}, but the selected Financial Period is ${periodPick.periodText}.`
  }, [parsed, periodPick])

  const handleUpload = async () => {
    if (!canUpload) return
    const proceed = await confirmIfPeriodAlreadyHasTB(periodPick.entityPeriodId, hasBranches)
    if (!proceed) return
    setBusy(true); setError('')
    try {
      const rows = FL.build(parsed, { constitution: entity?.constitution })
      const res = await window.api?.[FL.api]({
        entityId, period: periodPick.periodText || parsed.periodLabel || '',
        fileName: file?.name || FL.fileName,
        tbRows: rows,
        branchName: branchName || '',
        entityPeriodId: periodPick.entityPeriodId,
      })
      onUploaded(res.tb)
    } catch (err) {
      setError(err.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  const st = parsed?.stats
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box max-w-xl" ref={containerRef} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-blue-900">Upload {FL.label} Trial Balance</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div className="space-y-3">
          <FinancialPeriodPicker entity={entity} value={periodPick} onChange={setPeriodPick} allowCustom={false} />
          {hasBranches && (
            <div>
              <label className="block text-xs text-gray-600 mb-1">Branch Name <span className="text-gray-400">(e.g. Head Office, Delhi Branch)</span></label>
              <input
                type="text" value={branchName} onChange={e => setBranchName(e.target.value)}
                placeholder="e.g. Head Office"
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
              />
            </div>
          )}
          <div className="border border-gray-200 rounded p-3 bg-gray-50">
            <label className="block text-xs font-semibold text-blue-900 mb-1">
              Trial Balance Excel <span className="font-normal text-gray-400">({FL.hint})</span>
            </label>
            <input type="file" accept=".xlsx,.xls" onChange={handleFile} className="text-xs" />
            {file && parsed && (
              <div className="mt-1 text-[11px] text-gray-600">
                <span className="font-medium">{file.name}</span>
                <span className="ml-2 text-green-700">{st.imported} ledgers with figures (of {parsed.allRowCount} accounts; {st.zeroSkipped} with nothing in them skipped)</span>
              </div>
            )}
          </div>

          {parsed && (
            <div className="border border-gray-200 rounded p-2 text-[11px] text-gray-700">
              <div className="mb-1">
                {parsed.entityName && <span className="font-semibold">{parsed.entityName}</span>}
                {parsed.periodLabel && <span className="ml-2 text-gray-500">{parsed.periodLabel}</span>}
              </div>
              <table className="w-full">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-200">
                    <th className="text-left font-medium py-0.5">Section</th>
                    <th className="text-right font-medium">Accounts</th>
                    <th className="text-right font-medium">Closing per {FL.label} <span className="text-gray-400">(Dr +, Cr −)</span></th>
                    <th className="text-right font-medium">Stored in FSG Bharat <span className="text-gray-400">(Dr −, Cr +)</span></th>
                  </tr>
                </thead>
                <tbody>
                  {FL.order.map(k => {
                    const sec = st.sections[k]
                    if (!sec || !sec.count) return null
                    const zohoSigned = sec.closing
                    const fsg = -sec.closing
                    return (
                      <tr key={k} className="border-b border-gray-100">
                        <td className="py-0.5">{k}</td>
                        <td className="text-right">{sec.count}</td>
                        <td className="text-right tabular-nums">{zohoSigned < 0 ? '−' : ''}{fmtInr(zohoSigned)}{drCr(zohoSigned)}</td>
                        <td className="text-right tabular-nums">{fsg < 0 ? '−' : ''}{fmtInr(fsg)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                <span className={Math.abs(st.sumClosing) < 0.01 ? 'text-green-700' : 'text-red-600'}>
                  {Math.abs(st.sumClosing) < 0.01 ? '✓ Trial Balance balances (Dr = Cr)' : `✗ Out of balance by ${fmtInr(st.sumClosing)}`}
                </span>
                {st.grandDebit != null && (
                  <span className={Math.abs(st.sumDebit - st.grandDebit) < 0.01 && Math.abs(st.sumCredit - st.grandCredit) < 0.01 ? 'text-green-700' : 'text-red-600'}>
                    {Math.abs(st.sumDebit - st.grandDebit) < 0.01 && Math.abs(st.sumCredit - st.grandCredit) < 0.01
                      ? '✓ Agrees with the file’s own “Total for Trial Balance”'
                      : '✗ Does not agree with the file’s own “Total for Trial Balance”'}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[10px] text-gray-400">
                {FL.signNote}
              </p>
            </div>
          )}

          {parsed?.warnings?.length > 0 && (
            <div className="text-xs px-2 py-1.5 rounded border bg-amber-50 text-amber-800 border-amber-200 space-y-0.5">
              {parsed.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
          {periodNote && (
            <div className="text-xs px-2 py-1.5 rounded border bg-amber-50 text-amber-800 border-amber-200">⚠ {periodNote} Upload only if this is intended.</div>
          )}
          {error && <div className="text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 text-xs">{error}</div>}
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} disabled={busy} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50 transition">Cancel</button>
          <button
            onClick={handleUpload}
            disabled={!canUpload || busy}
            className="flex-1 py-2 text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-40 transition" style={{ background: 'var(--color-primary)' }}
          >
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Upload TB — manages the list of uploaded Trial Balances, the upload flow
// itself, and TB-level housekeeping (delete). The Actual TB tab reads whatever
// TB this tab makes active. ──────────────────────────────────────────────
export default function UploadTB({ entity, activeTB, activeRsId, onTBLoaded, onGoToStock }) {
  const [tbList, setTbList]         = useState([])
  const [selectedTBId, setSelectedTBId] = useState(activeTB?.id || '')
  const [uploading, setUploading]   = useState(false)
  const [error, setError]           = useState('')
  const [pendingFile, setPendingFile] = useState(null)   // file path waiting for period input
  const [showFormatChooser, setShowFormatChooser] = useState(false)
  const [showTallyModal, setShowTallyModal] = useState(false)
  const [showRealBooksModal, setShowRealBooksModal] = useState(false)
  const [showZohoModal, setShowZohoModal] = useState(false)
  const [showBusyModal, setShowBusyModal] = useState(false)
  const [showTallyAutoModal, setShowTallyAutoModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [balanceWarning, setBalanceWarning] = useState(null)
  const [stockMode, setStockMode] = useState(null) // 'prompt' | null
  const [deleting, setDeleting]     = useState(false)

  useEffect(() => {
    if (!entity) return
    window.api?.getTBList(entity.id).then(setTbList).catch(() => {})
  }, [entity])

  useEffect(() => {
    if (activeTB) setSelectedTBId(activeTB.id)
  }, [activeTB])

  // We defer making the TB active until the user dismisses the stock prompt.
  const [pendingTB, setPendingTB] = useState(null)

  const handleTBSelect = (e) => {
    const id = parseInt(e.target.value)
    if (!id) return
    setSelectedTBId(id)
    const tb = tbList.find(t => t.id === id)
    if (tb) {
      setPendingTB(tb)
      setStockMode('prompt')
    }
  }

  const finalizePendingTB = () => {
    if (pendingTB) {
      onTBLoaded(pendingTB)
      setPendingTB(null)
    }
  }

  const handleUpload = () => {
    if (!entity) { setError('Please select an entity first.'); return }
    setError('')
    setShowFormatChooser(true)
  }

  const handleFormatChosen = async (format) => {
    setShowFormatChooser(false)
    if (format === 'tally') {
      setShowTallyModal(true)
      return
    }
    if (format === 'realbooks') {
      setShowRealBooksModal(true)
      return
    }
    if (format === 'zoho') {
      setShowZohoModal(true)
      return
    }
    if (format === 'busy') {
      setShowBusyModal(true)
      return
    }
    if (format === 'tally_auto') {
      setShowTallyAutoModal(true)
      return
    }
    // ODBC format — existing flow
    try {
      const result = await window.api?.openFileDialog({
        filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
        properties: ['openFile'],
        title: 'Select Trial Balance Excel (ODBC Format)'
      })
      if (result?.canceled || !result?.filePaths?.length) return
      setPendingFile(result.filePaths[0])
    } catch (err) {
      setError(err.message || 'Failed to open file.')
    }
  }

  // First-run auto-mapping — fires once right after a genuinely fresh
  // upload/import (not when the user just re-selects an existing TB from
  // the dropdown, and not on delete). Best-effort: a failure here shouldn't
  // block the upload from being reported as successful — the user can
  // still run it manually from Mapped TB.
  //
  // Deliberately does NOT trust the `activeRsId` prop here — it's set
  // asynchronously in App.jsx right after an entity is created/selected
  // (awaits getRuleSets() before calling setActiveRsId), so a fresh
  // "create entity → immediately upload TB" flow can race ahead of it and
  // run mapping against a stale or not-yet-set rule set, silently
  // corrupting classification (e.g. a caption resolved against the wrong
  // rule set's data). Re-fetching the entity's actual default rule set
  // right here, at the moment of upload, closes that race regardless of
  // whatever state App.jsx currently holds.
  const runAutoMapping = async (tbId) => {
    if (!tbId || !entity?.id) return
    try {
      const ruleSets = await window.api?.getRuleSets(entity.id)
      const rsId = ruleSets?.find(r => r.is_default)?.id || ruleSets?.[0]?.id || activeRsId
      if (!rsId) return
      // Zero-in-both-years ledgers excluded by default (see MappedTB's Run
      // Auto-Mapping) — "Include Zero Balance" there is the opt-in path.
      await window.api?.runMapping(tbId, rsId, { excludeZero: true })
    } catch { /* non-fatal — user can re-run manually from Mapped TB */ }
  }

  const checkBalance = async (tbId) => {
    const rowData = await window.api?.getTBRows(tbId)
    if (rowData && rowData.length > 0) {
      const totalOpening = rowData.reduce((s, r) => s + (parseFloat(r.opening_balance) || 0), 0)
      const totalClosing = rowData.reduce((s, r) => s + (parseFloat(r.closing_balance) || 0), 0)
      if (Math.abs(totalOpening) > 0.01 || Math.abs(totalClosing) > 0.01) {
        setBalanceWarning({ opening: totalOpening, closing: totalClosing })
      }
    }
  }

  const handleZohoUploaded = async (newTB) => {
    setShowZohoModal(false)
    setShowBusyModal(false)
    await handleRealBooksUploaded(newTB, { keepRealBooksModal: true })
  }

  // Shared by every single-step "prepared rows" upload (Real Books, Zoho).
  const handleRealBooksUploaded = async (newTB, { keepRealBooksModal = false } = {}) => {
    if (!keepRealBooksModal) setShowRealBooksModal(false)
    if (!newTB) return
    try {
      const newTBList = await window.api?.getTBList(entity.id)
      setTbList(newTBList)
      onTBLoaded(newTB)
      setSelectedTBId(newTB.id)
      await runAutoMapping(newTB.id)
      await checkBalance(newTB.id)
      setStockMode('prompt')
    } catch (err) {
      setError(err.message || 'Post-upload load failed.')
    }
  }

  const handleTallyUploaded = async (newTB) => {
    setShowTallyModal(false)
    if (!newTB) return
    try {
      const newTBList = await window.api?.getTBList(entity.id)
      setTbList(newTBList)
      onTBLoaded(newTB)
      setSelectedTBId(newTB.id)
      await runAutoMapping(newTB.id)
      await checkBalance(newTB.id)
      // Stock prompt — same as ODBC
      setStockMode('prompt')
    } catch (err) {
      setError(err.message || 'Post-upload load failed.')
    }
  }

  const handleUploadConfirm = async (period, branchName, entityPeriodId) => {
    if (!pendingFile) return
    const filePath = pendingFile
    setPendingFile(null)
    setUploading(true)
    setError('')
    try {
      const res = await window.api?.uploadTB({ entityId: entity.id, filePath, period: period || '', branchName: branchName || '', entityPeriodId })
      const newTBList = await window.api?.getTBList(entity.id)
      setTbList(newTBList)
      onTBLoaded(res.tb)
      setSelectedTBId(res.tb.id)
      await runAutoMapping(res.tb.id)
      await checkBalance(res.tb.id)
      // Prompt for stock entry
      setStockMode('prompt')
    } catch (err) {
      setError(err.message || 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  // Escape closes confirmDelete
  useEffect(() => {
    if (!confirmDelete) return
    const handler = (e) => { if (e.key === 'Escape') setConfirmDelete(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [confirmDelete])

  // Adjustments typed on the Mapped TB go with the Trial Balance - say so before it is deleted.
  const [deleteAdjCount, setDeleteAdjCount] = useState(0)
  useEffect(() => {
    if (!confirmDelete || !activeTB?.id) { setDeleteAdjCount(0); return }
    Promise.resolve(window.api?.getAdjustmentSummary?.(activeTB.id))
      .then(s => setDeleteAdjCount(s?.rows_adjusted || 0)).catch(() => setDeleteAdjCount(0))
  }, [confirmDelete, activeTB?.id])

  const handleDeleteTB = async () => {
    if (!activeTB) return
    setDeleting(true)
    setError('')
    try {
      await window.api?.deleteTB(activeTB.id)
      const newList = await window.api?.getTBList(entity.id)
      setTbList(newList || [])
      setSelectedTBId('')
      onTBLoaded(null)
    } catch (err) {
      setError(err.message || 'Delete failed.')
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const handleDownloadTemplate = async () => {
    try {
      const buf = await window.api?.downloadTBTemplate()
      const result = await window.api?.saveFileDialog({
        defaultPath: 'TrialBalance_Template.xlsx',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }]
      })
      if (result?.canceled || !result?.filePath) return
      await window.api?.writeFile(result.filePath, buf)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        {/* TB selector */}
        {tbList.length > 0 && (
          <select
            value={selectedTBId}
            onChange={handleTBSelect}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
          >
            <option value="">— Select Trial Balance —</option>
            {tbList.map(t => (
              <option key={t.id} value={t.id}>
                {t.period || 'No period'}{t.branch_name ? ` [${t.branch_name}]` : ''} — {t.filename} ({t.row_count} rows)
              </option>
            ))}
          </select>
        )}

        <button
          onClick={handleUpload}
          disabled={uploading || !entity}
          className="flex items-center gap-2 px-3 py-1.5 text-white text-sm rounded hover:opacity-90 disabled:opacity-40 transition" style={{ background: 'var(--color-primary)' }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          {uploading ? 'Uploading…' : 'Upload Trial Balance'}
        </button>

        <button
          onClick={handleDownloadTemplate}
          className="flex items-center gap-2 px-3 py-1.5 border border-blue-600 text-blue-700 text-sm rounded hover:bg-blue-50 transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download Template
        </button>

        {activeTB && (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-red-300 text-red-600 text-sm rounded hover:bg-red-50 disabled:opacity-40 transition"
            title="Delete this Trial Balance and all its mappings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete TB
          </button>
        )}
      </div>

      {!entity && (
        <div className="text-amber-600 text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Please select or create an entity from the top bar before uploading a Trial Balance.
        </div>
      )}

      {error && <div className="text-red-500 text-sm bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      {activeTB && (
        <div className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded px-3 py-2">
          Active Trial Balance: <span className="font-semibold">{activeTB.period || activeTB.filename}</span>{activeTB.branch_name ? ` [${activeTB.branch_name}]` : ''} — see it in the <span className="font-semibold">Actual TB</span> tab.
        </div>
      )}

      {/* Format chooser modal */}
      {showFormatChooser && (
        <FormatChooserModal
          onChoose={handleFormatChosen}
          onCancel={() => setShowFormatChooser(false)}
        />
      )}

      {/* Real Books dual-file upload modal */}
      {showRealBooksModal && (
        <RealBooksUploadModal
          entity={entity}
          entityId={entity?.id}
          hasBranches={!!entity?.has_branches}
          onUploaded={handleRealBooksUploaded}
          onCancel={() => setShowRealBooksModal(false)}
        />
      )}

      {/* Zoho Books single-file upload modal */}
      {showZohoModal && (
        <ZohoUploadModal
          entity={entity}
          entityId={entity?.id}
          hasBranches={!!entity?.has_branches}
          onUploaded={handleZohoUploaded}
          onCancel={() => setShowZohoModal(false)}
        />
      )}

      {/* Busy single-file upload modal (same flow as Zoho) */}
      {showBusyModal && (
        <ZohoUploadModal
          flavor="busy"
          entity={entity}
          entityId={entity?.id}
          hasBranches={!!entity?.has_branches}
          onUploaded={handleZohoUploaded}
          onCancel={() => setShowBusyModal(false)}
        />
      )}

      {/* Tally dual-file upload modal */}
      {showTallyModal && (
        <TallyUploadModal
          entity={entity}
          entityId={entity?.id}
          hasBranches={!!entity?.has_branches}
          onUploaded={handleTallyUploaded}
          onCancel={() => setShowTallyModal(false)}
        />
      )}

      {/* Tally Auto-Import modal */}
      {showTallyAutoModal && (
        <TallyAutoModal
          entity={entity}
          entityId={entity?.id}
          hasBranches={!!entity?.has_branches}
          onUploaded={(tb) => { handleTallyUploaded(tb); setShowTallyAutoModal(false) }}
          onCancel={() => setShowTallyAutoModal(false)}
        />
      )}

      {/* Period input modal */}
      {pendingFile && (
        <UploadModal
          entity={entity}
          filePath={pendingFile}
          hasBranches={!!entity?.has_branches}
          onConfirm={handleUploadConfirm}
          onCancel={() => setPendingFile(null)}
        />
      )}

      {/* Delete TB confirmation */}
      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(false)}>
          <div className="modal-box max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-red-700 mb-2">Delete Trial Balance?</h2>
            <p className="text-sm text-gray-600 mb-1">
              This will permanently delete:
            </p>
            <ul className="text-sm text-gray-700 list-disc list-inside mb-4 space-y-0.5">
              <li>Trial Balance: <span className="font-semibold">{activeTB?.period || activeTB?.filename}</span></li>
              <li>All {activeTB?.row_count || ''} ledger rows</li>
              <li>All mapping results for this TB</li>
              {deleteAdjCount > 0 && (
                <li className="text-red-700 font-semibold">All {deleteAdjCount} Trial Balance adjustment{deleteAdjCount === 1 ? '' : 's'} (Adjustments Dr / Cr) typed on the Mapped TB</li>
              )}
            </ul>
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mb-4">
              This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteTB}
                disabled={deleting}
                className="flex-1 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-40 transition"
              >
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stock prompt */}
      {stockMode === 'prompt' && (
        <div className="modal-backdrop" onClick={() => { setStockMode(null); finalizePendingTB() }}>
          <div className="modal-box max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-blue-900 mb-3">Opening & Closing Stock</h2>
            <p className="text-sm text-gray-600 mb-4">
              Do you want to enter Opening Stock and Closing Stock details for this Trial Balance?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { setStockMode(null); finalizePendingTB() }}
                className="flex-1 py-2 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50 transition"
              >
                No, Skip
              </button>
              <button
                onClick={() => { finalizePendingTB(); setStockMode(null); onGoToStock?.() }}
                className="flex-1 py-2 text-white rounded text-sm font-medium hover:opacity-90 transition" style={{ background: 'var(--color-primary)' }}
              >
                Yes, Open Stock
              </button>
            </div>
          </div>
        </div>
      )}

      {balanceWarning && (
        <div className="modal-backdrop" onClick={() => setBalanceWarning(null)}>
          <div className="modal-box max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-amber-700 mb-3">Balance Notice</h2>
            <p className="text-sm text-gray-600 mb-3">
              The uploaded Trial Balance has non-zero totals:
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-600">Total Opening Balance:</span>
                <span className="font-mono font-semibold text-amber-800">
                  {balanceWarning.opening.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total Closing Balance:</span>
                <span className="font-mono font-semibold text-amber-800">
                  {balanceWarning.closing.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Non-zero totals may indicate that the Trial Balance is not balanced.
              Please verify the uploaded data.
            </p>
            <button
              onClick={() => setBalanceWarning(null)}
              className="w-full py-2 text-white rounded text-sm font-medium hover:opacity-90 transition" style={{ background: 'var(--color-primary)' }}
            >
              OK, Got It
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
