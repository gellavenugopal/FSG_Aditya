import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useFinancials, fmtINR } from '../../hooks/useFinancials'

const ROWS = [
  { id: 'a', label: 'Total turnover of the assessee', numeratorLabel: '', numeratorField: 'turnover', denominatorLabel: '', denominatorField: null, isRatio: false },
  { id: 'b', label: 'Gross profit / Turnover', numeratorLabel: 'GROSS PROFIT', numeratorField: 'gross_profit', denominatorLabel: 'TURNOVER', denominatorField: 'turnover', isRatio: true },
  { id: 'c', label: 'Net profit / Turnover', numeratorLabel: 'NET PROFIT', numeratorField: 'net_profit', denominatorLabel: 'TURNOVER', denominatorField: 'turnover', isRatio: true },
  { id: 'd', label: 'Stock-in-Trade / Turnover', numeratorLabel: 'STOCK IN TRADE', numeratorField: 'stock_in_trade', denominatorLabel: 'TURNOVER', denominatorField: 'turnover', isRatio: true },
  { id: 'e', label: 'Material consumed / Finished goods produced', numeratorLabel: 'MATERIAL CONSUMED', numeratorField: 'material_consumed', denominatorLabel: 'FINISHED GOODS', denominatorField: 'finished_goods', isRatio: true },
]

// ── Gross Profit Trading-Account calculator (feeds row 'b' above) ──────────
// "Cost of materials consumed" and "Changes in inventories" P&L notes carry
// auto-injected Opening/Closing stock movement lines alongside any real
// purchase-ledger lines (see hooks/useFinancials.js's inventory-split pass).
// Those synthetic lines never appear in the selectable Income/Expense picker
// below — they're always pulled automatically into the Trading Account's
// fixed Opening Stock (Dr) / Closing Stock (Cr) rows instead, or they'd be
// double-counted.
const OPENING_LINE_RX = /^opening (stock|value) of/i
const CLOSING_LINE_RX = /^less:\s*closing (stock|value) of/i
const DERIVED_LINE_RX = /^(change in inventory of|net change in inventory)/i
const CHANGES_SECTION_RX = /changes in inventor/i
const UNCAT_RX = /uncategorised/i

const itemKey = (level1, level2) => `${level1}|||${level2 || ''}`

function computeStockTotal(expenseSections) {
  let open = 0, close = 0
  for (const sec of expenseSections || []) {
    for (const line of sec.lines || []) {
      if (OPENING_LINE_RX.test(line.level2 || '')) open += line.total
      else if (CLOSING_LINE_RX.test(line.level2 || '')) close += -line.total
    }
  }
  return { open, close }
}

function buildSelectable(sections, { excludeSection } = {}) {
  const out = []
  for (const sec of sections || []) {
    if (UNCAT_RX.test(sec.level1 || '')) continue
    if (excludeSection && excludeSection.test(sec.level1 || '')) continue
    const items = []
    for (const line of sec.lines || []) {
      if (UNCAT_RX.test(line.level2 || '')) continue
      if (OPENING_LINE_RX.test(line.level2 || '') || CLOSING_LINE_RX.test(line.level2 || '') || DERIVED_LINE_RX.test(line.level2 || '')) continue
      if (Math.abs(line.total) < 0.005) continue
      items.push({ key: itemKey(sec.level1, line.level2), label: line.level2 || 'General', amount: line.total })
    }
    if (items.length) out.push({ level1: sec.level1, items })
  }
  return out
}

function findItem(groups, k) {
  for (const g of groups) {
    const item = g.items.find(i => i.key === k)
    if (item) return item
  }
  return null
}

function computeGP(incomeGroups, expenseGroups, stock, selection) {
  const incTotal = selection.income.reduce((s, k) => s + (findItem(incomeGroups, k)?.amount || 0), 0)
  const expTotal = selection.expense.reduce((s, k) => s + (findItem(expenseGroups, k)?.amount || 0), 0)
  const gp = (incTotal + stock.close) - (stock.open + expTotal)
  return { gp, incTotal, expTotal }
}

function ItemColumn({ title, groups, selected, onToggle, onToggleAll, accent }) {
  return (
    <div className="border border-gray-300 rounded overflow-hidden">
      <div className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${accent}`}>{title}</div>
      <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
        {groups.length === 0 && (
          <div className="px-3 py-3 text-xs text-gray-400 italic">No note items available.</div>
        )}
        {groups.map(g => {
          const allKeys = g.items.map(i => i.key)
          const allSelected = allKeys.length > 0 && allKeys.every(k => selected.has(k))
          return (
            <div key={g.level1}>
              <div className="flex items-center gap-2 px-3 py-1 bg-gray-50 border-b border-gray-100">
                <input type="checkbox" checked={allSelected}
                  onChange={() => onToggleAll(allKeys, !allSelected)}
                  className="accent-blue-600" />
                <span className="text-xs font-semibold text-gray-700">{g.level1}</span>
              </div>
              {g.items.map(item => (
                <label key={item.key} className="flex items-center gap-2 px-3 pl-7 py-1 text-xs hover:bg-blue-50 cursor-pointer">
                  <input type="checkbox" checked={selected.has(item.key)}
                    onChange={() => onToggle(item.key)}
                    className="accent-blue-600 shrink-0" />
                  <span className="flex-1 text-gray-700">{item.label}</span>
                  <span className="font-mono text-gray-500 w-24 text-right">{fmtINR(item.amount)}</span>
                </label>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function LedgerRow({ label, amount, bold, indent }) {
  return (
    <tr className={bold ? 'bg-blue-50 font-semibold border-t border-b border-blue-200' : 'border-b border-gray-100'}>
      <td className={`py-1 text-xs ${indent ? 'pl-6' : 'pl-2'} ${bold ? 'text-blue-900' : 'text-gray-700'}`}>{label}</td>
      <td className={`py-1 text-right font-mono text-xs pr-2 ${bold ? 'text-blue-900' : 'text-gray-900'}`}>{fmtINR(amount)}</td>
    </tr>
  )
}

function LedgerSide({ title, rows, total }) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b-2 border-blue-800">
          <th colSpan={2} className="text-left py-1 pl-2 text-xs font-bold text-blue-900 uppercase">{title}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => <LedgerRow key={i} {...r} />)}
        <LedgerRow label="Total" amount={total} bold />
      </tbody>
    </table>
  )
}

export default function Form3CD({ entity, activeTB, prevTB, onPrevTBChange }) {
  const [formData, setFormData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')

  const { data: cyData } = useFinancials(activeTB, prevTB, entity)
  const { data: pyData } = useFinancials(prevTB, null, entity)

  useEffect(() => {
    if (!entity?.id || !activeTB?.id) return
    const fetchForm = async () => {
      try {
        const data = await window.api?.getForm3CD(entity.id, activeTB.entity_period_id)
        setFormData(data || {})
      } catch (err) {
        console.error('Failed to fetch Form 3CD:', err)
        setFormData({})
      }
    }
    fetchForm()
  }, [entity?.id, activeTB?.id])

  useEffect(() => {
    if (!formData || !cyData) return
    const updated = { ...formData }
    let changed = false

    if (!formData.cy_turnover) {
      const cyRevenue = cyData.incomeSections?.find(s => /revenue from operations/i.test(s.level1))?.total
      if (cyRevenue && updated.cy_turnover !== cyRevenue) {
        updated.cy_turnover = Math.round(cyRevenue)
        changed = true
      }
    }

    if (!formData.cy_net_profit && cyData.netProfit) {
      updated.cy_net_profit = Math.round(cyData.netProfit)
      changed = true
    }

    if (!formData.cy_stock_in_trade) {
      // Try to find Inventories in assetSections (Current Assets)
      let cyStock = cyData.assetSections?.find(s => {
        const l1 = (s.level1 || '').toLowerCase()
        return /inventories|stock in trade|stock|current asset/i.test(l1)
      })?.total

      // Try different level properties if level1 not found
      if (!cyStock && cyData.assetSections) {
        for (const section of cyData.assetSections) {
          const text = `${section.level1 || ''} ${section.level2 || ''} ${section.level3 || ''}`.toLowerCase()
          if (/inventories|stock in trade/.test(text)) {
            cyStock = section.total
            break
          }
        }
      }

      // Also try in elSections if not found in assets
      if (!cyStock && cyData.elSections) {
        cyStock = cyData.elSections.find(s => {
          const l1 = (s.level1 || '').toLowerCase()
          return /inventories|stock in trade|stock/i.test(l1)
        })?.total
      }

      if (cyStock !== null && cyStock !== undefined && updated.cy_stock_in_trade !== cyStock) {
        updated.cy_stock_in_trade = Math.round(cyStock)
        changed = true
      }
    }

    if (changed) {
      setFormData(updated)
    }
  }, [cyData])

  useEffect(() => {
    if (!formData || !pyData) return
    const updated = { ...formData }
    let changed = false

    if (!formData.py_turnover) {
      const pyRevenue = pyData.incomeSections?.find(s => /revenue from operations/i.test(s.level1))?.total
      if (pyRevenue && updated.py_turnover !== pyRevenue) {
        updated.py_turnover = Math.round(pyRevenue)
        changed = true
      }
    }

    if (!formData.py_net_profit && pyData.netProfit) {
      updated.py_net_profit = Math.round(pyData.netProfit)
      changed = true
    }

    if (!formData.py_stock_in_trade) {
      // Try to find Inventories in assetSections (Current Assets)
      let pyStock = pyData.assetSections?.find(s => /inventories|stock/i.test(s.level1))?.total
      // Also try in elSections if not found in assets
      if (!pyStock) {
        pyStock = pyData.elSections?.find(s => /inventories|stock/i.test(s.level1))?.total
      }
      if (pyStock !== null && pyStock !== undefined && updated.py_stock_in_trade !== pyStock) {
        updated.py_stock_in_trade = Math.round(pyStock)
        changed = true
      }
    }

    if (changed) {
      setFormData(updated)
    }
  }, [pyData])

  // ── Gross Profit Trading-Account calculator ───────────────────────────────
  const [gpExpanded, setGpExpanded] = useState(false)
  const [gpSelection, setGpSelection] = useState({ income: [], expense: [] })
  const [gpSaving, setGpSaving] = useState(false)

  useEffect(() => {
    if (!entity?.id || !activeTB?.entity_period_id) { setGpSelection({ income: [], expense: [] }); return }
    window.api?.ratioGetGPSelection(entity.id, activeTB.entity_period_id).then(sel => {
      setGpSelection(sel && (sel.income || sel.expense) ? { income: sel.income || [], expense: sel.expense || [] } : { income: [], expense: [] })
    }).catch(() => setGpSelection({ income: [], expense: [] }))
  }, [entity?.id, activeTB?.entity_period_id])

  const persistGpSelection = useCallback((next) => {
    setGpSelection(next)
    if (!entity?.id || !activeTB?.entity_period_id) return
    setGpSaving(true)
    window.api?.ratioSaveGPSelection(entity.id, activeTB.entity_period_id, next)
      .catch(err => console.error('Failed to save GP selection:', err))
      .finally(() => setGpSaving(false))
  }, [entity?.id, activeTB?.entity_period_id])

  const cyIncomeGroups  = useMemo(() => buildSelectable(cyData?.incomeSections),  [cyData?.incomeSections])
  const cyExpenseGroups = useMemo(() => buildSelectable(cyData?.expenseSections, { excludeSection: CHANGES_SECTION_RX }), [cyData?.expenseSections])
  const cyStock         = useMemo(() => computeStockTotal(cyData?.expenseSections), [cyData?.expenseSections])

  const pyIncomeGroups  = useMemo(() => buildSelectable(pyData?.incomeSections),  [pyData?.incomeSections])
  const pyExpenseGroups = useMemo(() => buildSelectable(pyData?.expenseSections, { excludeSection: CHANGES_SECTION_RX }), [pyData?.expenseSections])
  const pyStock         = useMemo(() => computeStockTotal(pyData?.expenseSections), [pyData?.expenseSections])

  const gpIncomeSelected  = useMemo(() => new Set(gpSelection.income),  [gpSelection.income])
  const gpExpenseSelected = useMemo(() => new Set(gpSelection.expense), [gpSelection.expense])

  const hasGpSelection = gpSelection.income.length > 0 || gpSelection.expense.length > 0
  const cyGP = useMemo(() => computeGP(cyIncomeGroups, cyExpenseGroups, cyStock, gpSelection), [cyIncomeGroups, cyExpenseGroups, cyStock, gpSelection])
  const pyGP = useMemo(() => computeGP(pyIncomeGroups, pyExpenseGroups, pyStock, gpSelection), [pyIncomeGroups, pyExpenseGroups, pyStock, gpSelection])

  // Selections drive the Gross Profit figure once the user has ticked
  // anything — same as the auto-fill effects above, but this one is allowed
  // to overwrite a previously-set value, since the Trading Account is the
  // authoritative source once in use. Clearing every checkbox hands the
  // field back to free manual entry.
  useEffect(() => {
    if (!formData || !hasGpSelection) return
    const updated = { ...formData }
    let changed = false
    if (updated.cy_gross_profit !== Math.round(cyGP.gp)) { updated.cy_gross_profit = Math.round(cyGP.gp); changed = true }
    if (prevTB && updated.py_gross_profit !== Math.round(pyGP.gp)) { updated.py_gross_profit = Math.round(pyGP.gp); changed = true }
    if (changed) setFormData(updated)
  }, [hasGpSelection, cyGP.gp, pyGP.gp, prevTB])

  const toggleGp = (side) => (k) => {
    const cur = new Set(gpSelection[side])
    if (cur.has(k)) cur.delete(k); else cur.add(k)
    persistGpSelection({ ...gpSelection, [side]: [...cur] })
  }
  const toggleAllGp = (side) => (keys, on) => {
    const cur = new Set(gpSelection[side])
    keys.forEach(k => on ? cur.add(k) : cur.delete(k))
    persistGpSelection({ ...gpSelection, [side]: [...cur] })
  }

  const cyDebitRows = [
    { label: 'Opening Stock', amount: cyStock.open },
    ...gpSelection.expense.map(k => { const it = findItem(cyExpenseGroups, k); return { label: it?.label || k, amount: it?.amount || 0, indent: true } }),
  ]
  if (cyGP.gp > 0) cyDebitRows.push({ label: 'Gross Profit c/d', amount: cyGP.gp, indent: true })
  const cyDebitTotal = cyStock.open + cyGP.expTotal + Math.max(cyGP.gp, 0)

  const cyCreditRows = [
    ...gpSelection.income.map(k => { const it = findItem(cyIncomeGroups, k); return { label: it?.label || k, amount: it?.amount || 0, indent: true } }),
    { label: 'Closing Stock', amount: cyStock.close },
  ]
  if (cyGP.gp < 0) cyCreditRows.push({ label: 'Gross Loss c/d', amount: -cyGP.gp, indent: true })
  const cyCreditTotal = cyGP.incTotal + cyStock.close + Math.max(-cyGP.gp, 0)
  // ── end Gross Profit Trading-Account calculator ───────────────────────────

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value ? parseFloat(value) : null }))
    setSaveStatus('')
  }

  const saveForm = async () => {
    if (!entity?.id || !activeTB?.id) return
    setLoading(true)
    setSaveStatus('')
    try {
      await window.api?.saveForm3CD(entity.id, activeTB.entity_period_id, formData)
      setSaveStatus('Saved successfully')
      setTimeout(() => setSaveStatus(''), 3000)
    } catch (err) {
      console.error('Failed to save Form 3CD:', err)
      setSaveStatus('Error saving')
    }
    setLoading(false)
  }

  const getFieldValue = (field, year) => {
    const key = year === 'cy' ? `cy_${field}` : `py_${field}`
    const val = formData?.[key]
    return val !== null && val !== undefined ? val : ''
  }

  const calculateRatio = (numeratorField, denominatorField, year) => {
    if (!denominatorField) return '-'
    const numKey = year === 'cy' ? `cy_${numeratorField}` : `py_${numeratorField}`
    const denomKey = year === 'cy' ? `cy_${denominatorField}` : `py_${denominatorField}`
    const num = formData?.[numKey]
    const denom = formData?.[denomKey]
    if (num === null || num === undefined || denom === null || denom === undefined || denom === 0) return '-'
    return ((num / denom) * 100).toFixed(2) + '%'
  }

  if (!formData) return <div className="p-8 text-gray-400">Loading...</div>

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      <div className="flex-shrink-0 bg-white border-b border-gray-300 p-6">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-lg font-bold text-gray-900">Form 3CD : Details regarding turnover, gross profit, etc., for the previous year and preceding previous year:</h1>
          <div className="flex items-center gap-3">
            {saveStatus && <span className={`text-sm font-medium ${saveStatus.includes('Error') ? 'text-red-600' : 'text-green-600'}`}>{saveStatus}</span>}
            <button
              onClick={saveForm}
              disabled={loading}
              className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 transition font-medium"
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-6 min-h-full">
          <div style={{ overflowX: 'auto', display: 'inline-block', width: '100%' }}>
            <table className="border-collapse" style={{ minWidth: '1400px', marginBottom: '20px' }}>
              <thead>
                {/* First header row - Major columns */}
                <tr>
                  <th className="border border-gray-400 p-2 text-center font-bold text-xs bg-gray-200" style={{ width: '6%', minWidth: '60px' }}>S.no</th>
                  <th className="border border-gray-400 p-2 text-center font-bold text-xs bg-gray-200" style={{ width: '20%', minWidth: '200px' }}>Particulars</th>
                  <th colSpan="5" className="border border-gray-400 p-2 text-center font-bold text-xs bg-yellow-100" style={{ width: '37%' }}>Previous Year (i.e. Current Year)</th>
                  <th colSpan="5" className="border border-gray-400 p-2 text-center font-bold text-xs bg-yellow-100" style={{ width: '37%' }}>Preceding Previous Year (i.e. Previous Year)</th>
                </tr>

                {/* Second header row - Sub columns */}
                <tr>
                  <th className="border border-gray-400 p-1 bg-gray-100" style={{ width: '6%' }}></th>
                  <th className="border border-gray-400 p-1 bg-gray-100" style={{ width: '20%' }}></th>

                  {/* Current Year Headers */}
                  <th className="border border-gray-400 p-1 text-center font-semibold text-xs bg-gray-100" style={{ width: '12%' }}>Numerator Label</th>
                  <th className="border border-gray-400 p-1 text-center font-semibold text-xs bg-gray-100" style={{ width: '10%' }}>Numerator Amount</th>
                  <th className="border border-gray-400 p-1 text-center font-semibold text-xs bg-gray-100" style={{ width: '10%' }}>Denominator Label</th>
                  <th className="border border-gray-400 p-1 text-center font-semibold text-xs bg-gray-100" style={{ width: '10%' }}>Denominator Amount</th>
                  <th className="border border-gray-400 p-1 text-center font-semibold text-xs bg-gray-100" style={{ width: '5%' }}>%</th>

                  {/* Previous Year Headers */}
                  <th className="border border-gray-400 p-1 text-center font-semibold text-xs bg-gray-100" style={{ width: '12%' }}>Numerator Label</th>
                  <th className="border border-gray-400 p-1 text-center font-semibold text-xs bg-gray-100" style={{ width: '10%' }}>Numerator Amount</th>
                  <th className="border border-gray-400 p-1 text-center font-semibold text-xs bg-gray-100" style={{ width: '10%' }}>Denominator Label</th>
                  <th className="border border-gray-400 p-1 text-center font-semibold text-xs bg-gray-100" style={{ width: '10%' }}>Denominator Amount</th>
                  <th className="border border-gray-400 p-1 text-center font-semibold text-xs bg-gray-100" style={{ width: '5%' }}>%</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row, idx) => (
                  <tr key={row.id} style={{ backgroundColor: idx % 2 === 0 ? '#f9fafb' : '#ffffff' }}>
                    {/* S.No */}
                    <td className="border border-gray-400 p-2 text-center font-bold text-xs" style={{ width: '6%' }}>{row.id}</td>

                    {/* Particulars */}
                    <td className="border border-gray-400 p-2 text-xs" style={{ width: '20%' }}>
                      {row.label}
                      {row.id === 'b' && (
                        <button
                          onClick={() => setGpExpanded(e => !e)}
                          className="ml-2 text-[11px] text-blue-600 hover:underline font-medium"
                        >
                          {gpExpanded ? '▾ Hide Trading A/c' : '▸ Calculate via Trading A/c'}
                        </button>
                      )}
                    </td>

                    {/* Current Year - Numerator Label */}
                    <td className="border border-gray-400 p-1 text-center text-xs" style={{ width: '12%' }}>
                      {row.numeratorLabel}
                    </td>

                    {/* Current Year - Numerator Amount */}
                    <td className="border border-gray-400 p-1" style={{ width: '10%' }}>
                      <input
                        type="number"
                        value={getFieldValue(row.numeratorField, 'cy')}
                        onChange={(e) => handleChange(`cy_${row.numeratorField}`, e.target.value)}
                        readOnly={row.id === 'b' && hasGpSelection}
                        title={row.id === 'b' && hasGpSelection ? 'Auto-calculated from the Trading Account below — clear all ticks there to edit manually' : undefined}
                        className={`w-full px-1 py-1 text-xs text-right border rounded focus:outline-none focus:ring-1 focus:ring-blue-400 ${row.id === 'b' && hasGpSelection ? 'bg-blue-50 border-blue-300 text-blue-800 font-medium' : 'border-gray-300'}`}
                        step="0.01"
                      />
                    </td>

                    {/* Current Year - Denominator Label */}
                    <td className="border border-gray-400 p-1 text-center text-xs" style={{ width: '10%' }}>
                      {row.denominatorLabel}
                    </td>

                    {/* Current Year - Denominator Amount */}
                    <td className="border border-gray-400 p-1" style={{ width: '10%' }}>
                      {row.denominatorField ? (
                        <input
                          type="number"
                          value={getFieldValue(row.denominatorField, 'cy')}
                          onChange={(e) => handleChange(`cy_${row.denominatorField}`, e.target.value)}
                          className="w-full px-1 py-1 text-xs text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                          step="0.01"
                        />
                      ) : null}
                    </td>

                    {/* Current Year - % */}
                    <td className="border border-gray-400 p-1 text-center text-xs font-medium" style={{ width: '5%' }}>
                      {calculateRatio(row.numeratorField, row.denominatorField, 'cy')}
                    </td>

                    {/* Previous Year - Numerator Label */}
                    <td className="border border-gray-400 p-1 text-center text-xs" style={{ width: '12%' }}>
                      {row.numeratorLabel}
                    </td>

                    {/* Previous Year - Numerator Amount */}
                    <td className="border border-gray-400 p-1" style={{ width: '10%' }}>
                      <input
                        type="number"
                        value={getFieldValue(row.numeratorField, 'py')}
                        onChange={(e) => handleChange(`py_${row.numeratorField}`, e.target.value)}
                        readOnly={row.id === 'b' && hasGpSelection && !!prevTB}
                        title={row.id === 'b' && hasGpSelection && prevTB ? 'Auto-calculated from the Trading Account below — clear all ticks there to edit manually' : undefined}
                        className={`w-full px-1 py-1 text-xs text-right border rounded focus:outline-none focus:ring-1 focus:ring-blue-400 ${row.id === 'b' && hasGpSelection && prevTB ? 'bg-blue-50 border-blue-300 text-blue-800 font-medium' : 'border-gray-300'}`}
                        step="0.01"
                      />
                    </td>

                    {/* Previous Year - Denominator Label */}
                    <td className="border border-gray-400 p-1 text-center text-xs" style={{ width: '10%' }}>
                      {row.denominatorLabel}
                    </td>

                    {/* Previous Year - Denominator Amount */}
                    <td className="border border-gray-400 p-1" style={{ width: '10%' }}>
                      {row.denominatorField ? (
                        <input
                          type="number"
                          value={getFieldValue(row.denominatorField, 'py')}
                          onChange={(e) => handleChange(`py_${row.denominatorField}`, e.target.value)}
                          className="w-full px-1 py-1 text-xs text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                          step="0.01"
                        />
                      ) : null}
                    </td>

                    {/* Previous Year - % */}
                    <td className="border border-gray-400 p-1 text-center text-xs font-medium" style={{ width: '5%' }}>
                      {calculateRatio(row.numeratorField, row.denominatorField, 'py')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {gpExpanded && (
            <div className="mt-2 mb-6 border-t-2 border-blue-100 pt-4" style={{ maxWidth: '1400px' }}>
              <h3 className="text-sm font-bold text-blue-900 mb-1">Gross Profit — Trading Account Calculation</h3>
              <p className="text-xs text-gray-500 mb-3">
                Tick the note items that belong to Gross Profit. Selected Expense items go to the Debit side, selected Income items to the Credit side.
                Opening/Closing Stock are pulled in automatically from the Cost of Materials/Changes in Inventories notes.
                {gpSaving && <span className="ml-2 italic text-gray-400">Saving…</span>}
              </p>

              <div className="grid grid-cols-2 gap-3 mb-5">
                <ItemColumn title="Expense Side (→ Debit)" groups={cyExpenseGroups}
                  selected={gpExpenseSelected} onToggle={toggleGp('expense')} onToggleAll={toggleAllGp('expense')}
                  accent="bg-red-50 text-red-700" />
                <ItemColumn title="Income Side (→ Credit)" groups={cyIncomeGroups}
                  selected={gpIncomeSelected} onToggle={toggleGp('income')} onToggleAll={toggleAllGp('income')}
                  accent="bg-green-50 text-green-700" />
              </div>

              <h4 className="text-xs font-bold text-blue-900 mb-2 uppercase tracking-wide">Trading Account {activeTB?.period ? `for the year ended ${activeTB.period}` : ''}</h4>
              <div className="grid grid-cols-2 border border-gray-300 rounded overflow-hidden divide-x divide-gray-300">
                <LedgerSide title="Dr." rows={cyDebitRows} total={cyDebitTotal} />
                <LedgerSide title="Cr." rows={cyCreditRows} total={cyCreditTotal} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="summary-card text-center border border-gray-200 rounded p-3">
                  <div className="text-xs text-gray-500 mb-0.5">{cyGP.gp >= 0 ? 'Gross Profit (Current Year)' : 'Gross Loss (Current Year)'}</div>
                  <div className={`font-bold text-sm font-mono ${cyGP.gp >= 0 ? 'text-blue-800' : 'text-red-700'}`}>{fmtINR(Math.abs(cyGP.gp))}</div>
                </div>
                {prevTB && (
                  <div className="summary-card text-center border border-gray-200 rounded p-3">
                    <div className="text-xs text-gray-500 mb-0.5">{pyGP.gp >= 0 ? 'Gross Profit (Previous Year)' : 'Gross Loss (Previous Year)'}</div>
                    <div className={`font-bold text-sm font-mono ${pyGP.gp >= 0 ? 'text-blue-800' : 'text-red-700'}`}>{fmtINR(Math.abs(pyGP.gp))}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
