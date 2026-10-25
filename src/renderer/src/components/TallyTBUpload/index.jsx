import React, { useState, useEffect, useMemo, useRef } from 'react'
import { parseTallyTB, parseMasterJSON, buildTBRowsFromTally } from '../../utils/tallyParsers'
import { formatPeriodText } from '../../utils/financialPeriodDisplay'

// ─────────────────────────────────────────────────────────────────────────────
// Live Connect Tab
// ─────────────────────────────────────────────────────────────────────────────
function LiveConnect() {
  const [host, setHost]             = useState('localhost')
  const [port, setPort]             = useState('9000')
  const [configSaved, setConfigSaved] = useState(false)

  const [connStatus, setConnStatus] = useState(null)   // null | 'testing' | 'ok' | 'fail'
  const [connError, setConnError]   = useState('')

  const [companies, setCompanies]   = useState([])
  const [company, setCompany]       = useState('')

  const [fromDate, setFromDate]     = useState('')
  const [toDate, setToDate]         = useState('')

  const [entities, setEntities]     = useState([])
  const [entityId, setEntityId]     = useState('')
  const [period, setPeriod]         = useState('')
  const [branchName, setBranchName] = useState('')

  const [importing, setImporting]   = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [importError, setImportError]   = useState('')
  // See schema.js's pl_closed_to_capital: OFF by default (today's behaviour
  // — Tally's "Profit & Loss A/c" ledger is dropped, and the app computes
  // Net Profit itself). Turn ON only when the client has ALREADY passed a
  // real journal entry in Tally closing this year's P&L into Capital —
  // otherwise the app's own Net Profit calculation would double-count it.
  const [plClosedToCapital, setPlClosedToCapital] = useState(false)

  // Load saved config + entities on mount
  useEffect(() => {
    window.api?.tallyGetConfig?.().then(cfg => {
      if (cfg?.host) setHost(cfg.host)
      if (cfg?.port) setPort(String(cfg.port))
    })
    window.api?.getEntities?.().then(list => setEntities(list || []))
  }, [])

  // Default dates to current financial year (April 1 to March 31)
  useEffect(() => {
    const now = new Date()
    const fy  = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
    setFromDate(`${fy}0401`)
    setToDate(`${fy + 1}0331`)
    setPeriod(`FY ${fy}-${String(fy + 1).slice(2)}`)
  }, [])

  const saveConfig = async () => {
    await window.api?.tallySaveConfig?.({ host, port: parseInt(port) || 9000 })
    setConfigSaved(true)
    setTimeout(() => setConfigSaved(false), 2000)
  }

  const [diagSteps, setDiagSteps] = useState([])   // array of { label, status, detail }

  const testConnection = async () => {
    setConnStatus('testing')
    setConnError('')
    setCompanies([])
    setCompany('')
    setDiagSteps([])

    const cfg = { host, port: parseInt(port) || 9000 }

    // Step 1: TCP port check
    setDiagSteps([{ label: `TCP port check (${host}:${port})`, status: 'running' }])
    const ping = await window.api?.tallyTcpPing(cfg)
    if (!ping?.open) {
      setDiagSteps([{ label: `TCP port check (${host}:${port})`, status: 'fail',
        detail: `Port ${port} is CLOSED (${ping?.code || 'unreachable'}). Tally HTTP server is not listening.` }])
      setConnStatus('fail')
      setConnError(ping?.code === 'TIMEOUT'
        ? `Port ${port} is not reachable. Is Tally open? Try restarting Tally after enabling the server.`
        : `Port ${port} is closed. In TallyPrime: F12 → Advanced Configuration → Enable ODBC Server = Yes, Port = ${port}. Open a company, then retry.`)
      return
    }

    setDiagSteps([
      { label: `TCP port check (${host}:${port})`, status: 'ok', detail: 'Port is open.' },
      { label: 'XML handshake with Tally', status: 'running' },
    ])

    // Step 2: Full XML check — now returns detectedCompany directly
    const result = await window.api?.checkTally(cfg)
    if (result?.running) {
      const detected = result.detectedCompany
      const companyList = detected ? [detected] : []
      setCompanies(companyList)
      if (detected) setCompany(detected)
      setDiagSteps([
        { label: `TCP port check (${host}:${port})`, status: 'ok', detail: 'Port is open.' },
        { label: 'XML handshake with Tally', status: 'ok',
          detail: detected
            ? `Connected. Active company: ${detected}`
            : 'Connected. Company name could not be auto-detected — please type it below.' },
      ])
      setConnStatus('ok')
    } else {
      setDiagSteps([
        { label: `TCP port check (${host}:${port})`, status: 'ok', detail: 'Port is open.' },
        { label: 'XML handshake with Tally', status: 'fail', detail: result?.error || 'Unexpected response.' },
      ])
      setConnStatus('fail')
      setConnError(result?.error || 'Port is open but Tally did not return valid XML. Ensure a company is open in TallyPrime.')
    }
  }

  const importTB = async () => {
    if (!company || !fromDate || !toDate || !entityId || !period) return
    setImporting(true)
    setImportError('')
    setImportResult(null)
    try {
      const { tbRows, masterData } = await window.api?.fetchTallyTB({
        companyName: company,
        fromDate,
        toDate,
        host,
        port: parseInt(port) || 9000,
        keepPLLedger: plClosedToCapital,
      })
      const ledgerMap = masterData?.ledgerMap || {}
      const built = buildTBRowsFromTally(tbRows, ledgerMap)
      const res = await window.api?.uploadTallyTB({
        entityId: parseInt(entityId),
        period,
        fileName: `Tally_${company}_${fromDate}_${toDate}.xml`,
        tbRows: built,
        branchName: branchName || '',
        plClosedToCapital,
      })
      setImportResult({
        rowCount: res?.tb?.row_count ?? built.length,
        tbId: res?.tb?.id,
        period,
        company,
      })
    } catch (e) {
      setImportError(e?.message || 'Import failed.')
    } finally {
      setImporting(false)
    }
  }

  const canImport = company && fromDate && toDate && entityId && period && !importing

  // Format YYYYMMDD → YYYY-MM-DD for input[type=date]
  const toInputDate = (d) => d ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : ''
  const fromInputDate = (d) => d ? d.replace(/-/g, '') : ''

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4">

      {/* ── Step 1: Connection Settings ── */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold shrink-0">1</span>
          <h3 className="text-sm font-semibold text-blue-900">Tally Connection Settings</h3>
        </div>
        <div className="grid grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Host / IP Address
              <span className="ml-1 text-gray-400 font-normal">(use <code className="bg-gray-100 px-1 rounded">localhost</code> if Tally is on this machine)</span>
            </label>
            <input
              type="text"
              value={host}
              onChange={e => setHost(e.target.value)}
              placeholder="localhost or 192.168.1.x"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Port</label>
            <input
              type="number"
              value={port}
              onChange={e => setPort(e.target.value)}
              placeholder="9000"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={saveConfig}
              className="flex-1 py-1.5 border border-gray-300 rounded text-xs text-gray-700 hover:bg-gray-50 transition">
              {configSaved ? '✓ Saved' : 'Save Settings'}
            </button>
            <button onClick={testConnection} disabled={connStatus === 'testing'}
              className="flex-1 py-1.5 rounded text-xs text-white font-medium transition disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}>
              {connStatus === 'testing' ? 'Connecting…' : 'Test Connection'}
            </button>
          </div>
        </div>

        {/* Diagnostic steps */}
        {diagSteps.length > 0 && (
          <div className="mt-3 border border-gray-200 rounded overflow-hidden text-xs">
            {diagSteps.map((s, i) => (
              <div key={i} className={`flex items-start gap-2 px-3 py-2 border-b last:border-b-0 ${
                s.status === 'ok' ? 'bg-green-50' : s.status === 'fail' ? 'bg-red-50' : 'bg-gray-50'
              }`}>
                <span className="mt-0.5 shrink-0">
                  {s.status === 'ok' ? '✓' : s.status === 'fail' ? '✗' : '⋯'}
                </span>
                <div>
                  <span className={`font-medium ${s.status === 'ok' ? 'text-green-800' : s.status === 'fail' ? 'text-red-800' : 'text-gray-600'}`}>
                    {s.label}
                  </span>
                  {s.detail && <div className="text-gray-600 mt-0.5">{s.detail}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {connStatus === 'ok' && (
          <div className="mt-2 flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 text-xs font-medium">
            ✓ Connected to TallyPrime at {host}:{port}{companies.length > 0 ? ` — Company: ${companies[0]}` : ' — Type the company name below'}
          </div>
        )}
        {connStatus === 'fail' && (
          <div className="mt-2 bg-red-50 border border-red-200 rounded px-3 py-2 text-xs text-red-800 space-y-1.5">
            <div className="font-semibold">What to check:</div>
            <div>{connError}</div>
            <div className="border-t border-red-100 pt-1.5 text-red-600 space-y-0.5">
              <div>1. Is TallyPrime open on this machine with a <strong>company loaded</strong>?</div>
              <div>2. F12 → Advanced Configuration → <strong>Enable ODBC Server = Yes</strong>, Port = {port}</div>
              <div>3. After saving, <strong>restart TallyPrime</strong> and open a company</div>
              <div>4. Quick test: open Chrome/Edge and go to <strong>http://localhost:{port}</strong> — you should see some response from Tally</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Step 2: Select Company & Period ── */}
      {connStatus === 'ok' && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold shrink-0">2</span>
            <h3 className="text-sm font-semibold text-blue-900">Select Company & Date Range</h3>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tally Company</label>
              {companies.length > 1 ? (
                <select value={company} onChange={e => setCompany(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">— Select company —</option>
                  {companies.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : companies.length === 1 ? (
                <div className="border border-gray-200 rounded px-3 py-1.5 text-sm bg-gray-50 text-gray-700 font-medium">
                  {companies[0]}
                </div>
              ) : (
                <input type="text" value={company} onChange={e => setCompany(e.target.value)}
                  placeholder="Type Tally company name exactly as in Tally"
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">From Date</label>
              <input type="date" value={toInputDate(fromDate)}
                onChange={e => setFromDate(fromInputDate(e.target.value))}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To Date</label>
              <input type="date" value={toInputDate(toDate)}
                onChange={e => setToDate(fromInputDate(e.target.value))}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: Import Into Entity ── */}
      {connStatus === 'ok' && company && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold shrink-0">3</span>
            <h3 className="text-sm font-semibold text-blue-900">Import Into FSG Bharat Entity</h3>
          </div>
          <div className="grid grid-cols-3 gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Entity</label>
              <select value={entityId} onChange={e => setEntityId(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">— Select entity —</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Period <span className="text-gray-400">(e.g. FY 2024-25)</span></label>
              <input type="text" value={period} onChange={e => setPeriod(e.target.value)}
                placeholder="FY 2024-25"
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Branch Name <span className="text-gray-400">(optional)</span></label>
              <input type="text" value={branchName} onChange={e => setBranchName(e.target.value)}
                placeholder="e.g. Head Office"
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>

          <div className="mt-4">
            <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer max-w-xl">
              <input type="checkbox" checked={plClosedToCapital} onChange={e => setPlClosedToCapital(e.target.checked)}
                className="rounded border-gray-300 mt-0.5" />
              <span>
                Has this year's Profit &amp; Loss already been closed to Capital in Tally?
                <span className="block text-gray-400">
                  Leave unticked in the normal case. Tick only if a real journal entry has already transferred
                  this year's P&amp;L into the Capital account inside Tally itself — otherwise the app's own
                  profit calculation will double-count it.
                </span>
              </span>
            </label>
          </div>

          <div className="mt-4">
            <button onClick={importTB} disabled={!canImport}
              className="px-6 py-2 rounded text-sm text-white font-semibold transition disabled:opacity-40"
              style={{ background: 'var(--color-primary)' }}>
              {importing ? 'Importing from Tally…' : `Pull & Import TB from ${company}`}
            </button>
          </div>

          {importError && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded px-3 py-2 text-xs text-red-700">
              {importError}
            </div>
          )}
          {importResult && (
            <div className="mt-3 bg-green-50 border border-green-200 rounded px-3 py-2 text-xs text-green-800 space-y-1">
              <div className="font-semibold text-sm">✓ Trial Balance imported successfully!</div>
              <div>Company: <strong>{importResult.company}</strong> · Period: <strong>{formatPeriodText(importResult.period)}</strong> · {importResult.rowCount} ledgers imported.</div>
              <div className="text-green-600">Go to the Actual TB tab to view and proceed with mapping.</div>
            </div>
          )}
        </div>
      )}

      {/* Setup guide */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-xs text-amber-800">
        <div className="font-semibold mb-1">How to enable Tally HTTP Server (one-time setup on the Tally PC)</div>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Open Tally Prime on the Windows machine</li>
          <li>Press <kbd className="bg-amber-100 border border-amber-300 rounded px-1">F12</kbd> → Advanced Configuration</li>
          <li>Set <strong>Enable HTTP Server</strong> = Yes, Port = <strong>9000</strong></li>
          <li>Save and restart Tally if prompted</li>
          <li>If connecting from another machine (Mac/different PC): ensure both are on the same Wi-Fi/LAN, and allow port 9000 through Windows Firewall on the Tally machine</li>
        </ol>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// File Upload Tab (existing functionality, preserved)
// ─────────────────────────────────────────────────────────────────────────────
function FileUpload() {
  const [tbFile, setTBFile]         = useState(null)
  const [masterFile, setMasterFile] = useState(null)
  const [tbData, setTBData]         = useState(null)
  const [masterData, setMasterData] = useState(null)
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const tbInputRef    = useRef()
  const masterInputRef = useRef()

  const handleTBFile = async (e) => {
    setError('')
    const file = e.target.files?.[0]
    if (!file) return
    setTBFile(file)
    setLoading(true)
    try {
      const buf = await file.arrayBuffer()
      setTBData(parseTallyTB(buf))
    } catch (err) {
      setError('TB parse failed: ' + (err.message || err))
      setTBData(null)
    } finally { setLoading(false) }
  }

  const handleMasterFile = async (e) => {
    setError('')
    const file = e.target.files?.[0]
    if (!file) return
    setMasterFile(file)
    setLoading(true)
    try {
      const buf = await file.arrayBuffer()
      setMasterData(parseMasterJSON(buf))
    } catch (err) {
      setError('Master JSON parse failed: ' + (err.message || err))
      setMasterData(null)
    } finally { setLoading(false) }
  }

  const enriched = useMemo(() => {
    if (!tbData?.rows) return []
    const ledgerMap = masterData?.ledgerMap || {}
    return tbData.rows.map(r => {
      const m = ledgerMap[r.name.trim().toLowerCase()]
      const chain = m?.hierarchy || []
      return {
        ...r,
        parent:         chain[0] || '',
        group_parent_1: chain[1] || '',
        group_parent_2: chain[2] || '',
        group_parent_3: chain[3] || '',
        group_parent_4: chain[4] || '',
        group_parent_5: chain[5] || '',
        primary_group:  chain[chain.length - 1] || '',
        affectsstock:   m?.affectsstock ?? null,
      }
    })
  }, [tbData, masterData])

  const fmt = (n) => {
    const v = parseFloat(n || 0)
    if (!v) return ''
    return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const totals = useMemo(() => {
    const t = { open_dr: 0, open_cr: 0, debit: 0, credit: 0, close_dr: 0, close_cr: 0 }
    for (const r of enriched) {
      t.open_dr  += r.opening_dr; t.open_cr  += r.opening_cr
      t.debit    += r.debit;      t.credit   += r.credit
      t.close_dr += r.closing_dr; t.close_cr += r.closing_cr
    }
    return t
  }, [enriched])

  const matchStats = useMemo(() => {
    if (!tbData || !masterData) return null
    let matched = 0
    for (const r of enriched) if (r.parent) matched++
    return { matched, total: enriched.length }
  }, [enriched, tbData, masterData])

  const COLS = [
    { key: 'name',          label: 'Ledger Name',   width: 240 },
    { key: 'opening_dr',    label: 'Opening Dr',    width: 130, num: true, color: '#1e40af' },
    { key: 'opening_cr',    label: 'Opening Cr',    width: 130, num: true, color: '#065f46' },
    { key: 'debit',         label: 'Debit',         width: 120, num: true },
    { key: 'credit',        label: 'Credit',        width: 120, num: true },
    { key: 'closing_dr',    label: 'Closing Dr',    width: 130, num: true, color: '#1e40af', bold: true },
    { key: 'closing_cr',    label: 'Closing Cr',    width: 130, num: true, color: '#065f46', bold: true },
    { key: 'parent',        label: 'Parent Group',  width: 200 },
    { key: 'group_parent_1',label: 'Level 2 (Up)',  width: 180 },
    { key: 'group_parent_2',label: 'Level 3 (Up)',  width: 180 },
    { key: 'primary_group', label: 'Primary Group', width: 200 },
  ]
  const totalWidth = COLS.reduce((s, c) => s + c.width, 0)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-5 py-3 border-b border-blue-100 shrink-0 bg-blue-50/30">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white border border-gray-200 rounded p-3">
            <label className="block text-xs font-semibold text-blue-900 mb-1">1. Trial Balance (Excel from Tally)</label>
            <input ref={tbInputRef} type="file" accept=".xlsx,.xls" onChange={handleTBFile} className="text-xs" />
            {tbFile && (
              <div className="mt-1 text-[11px] text-gray-600">
                <span className="font-medium">{tbFile.name}</span>
                {tbData && <span className="ml-2 text-green-700">{tbData.rows.length} rows parsed</span>}
              </div>
            )}
          </div>
          <div className="bg-white border border-gray-200 rounded p-3">
            <label className="block text-xs font-semibold text-blue-900 mb-1">2. Master / Chart of Accounts (JSON from Tally)</label>
            <input ref={masterInputRef} type="file" accept=".json" onChange={handleMasterFile} className="text-xs" />
            {masterFile && masterData && (
              <div className="mt-1 text-[11px] text-green-700">
                {masterData.ledgerCount} ledgers · {masterData.groupCount} groups
              </div>
            )}
          </div>
        </div>
        {error && <div className="mt-2 text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 text-xs">{error}</div>}
      </div>

      {matchStats && (
        <div className="px-5 py-2 bg-white border-b border-gray-100 shrink-0 flex items-center gap-4 text-xs">
          <span className={`font-semibold ${matchStats.matched === matchStats.total ? 'text-green-700' : 'text-amber-700'}`}>
            {matchStats.matched} / {matchStats.total} ledgers matched to master
          </span>
          <div className="ml-auto flex items-center gap-3 text-[11px] text-gray-600">
            <span>Σ Cl. Dr: <span className="font-mono font-semibold text-blue-700">{fmt(totals.close_dr)}</span></span>
            <span>Σ Cl. Cr: <span className="font-mono font-semibold text-green-700">{fmt(totals.close_cr)}</span></span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {loading && <div className="p-4 text-gray-500 text-sm">Loading…</div>}
        {!loading && enriched.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2 p-6 text-center">
            <p className="text-sm">Pick the Tally TB Excel and Master JSON above to preview the enriched Trial Balance.</p>
            <p className="text-xs">This is a preview-only screen — use the Live Connect tab to import directly into FSG Bharat.</p>
          </div>
        )}
        {!loading && enriched.length > 0 && (
          <table className="text-xs table-fixed border-collapse" style={{ width: totalWidth, minWidth: totalWidth }}>
            <thead className="bg-blue-50 sticky top-0 z-10">
              <tr>
                {COLS.map(col => (
                  <th key={col.key} style={{ width: col.width }}
                    className="px-2 py-1.5 text-left font-semibold text-blue-900 border-b border-blue-200 border-r border-blue-100">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {enriched.map((row, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-blue-50/20">
                  {COLS.map(col => (
                    <td key={col.key} style={{ width: col.width, color: col.color, fontWeight: col.bold ? 500 : undefined }}
                      className={`px-2 py-1 border-r border-gray-100 truncate ${col.num ? 'text-right font-mono' : ''}`}
                      title={String(row[col.key] ?? '')}>
                      {col.num ? fmt(row[col.key]) : (row[col.key] || '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component with tabs
// ─────────────────────────────────────────────────────────────────────────────
export default function TallyTBUpload() {
  const [tab, setTab] = useState('live')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-blue-100 bg-white shrink-0">
        <h2 className="text-sm font-bold text-blue-900">Tally — Direct Import</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Pull the Trial Balance live from Tally over the network, or upload exported files manually.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 bg-white shrink-0 px-5">
        <button
          onClick={() => setTab('live')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition -mb-px ${
            tab === 'live'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}>
          Live Connect (HTTP)
        </button>
        <button
          onClick={() => setTab('file')}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition -mb-px ${
            tab === 'file'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}>
          File Upload (Excel + JSON)
        </button>
      </div>

      {/* Tab content */}
      {tab === 'live' ? <LiveConnect /> : <FileUpload />}
    </div>
  )
}
