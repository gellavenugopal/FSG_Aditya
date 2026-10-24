import React, { useState, useEffect } from 'react'

export default function PPE({ entity, activeTB }) {
  const [ledgers, setLedgers] = useState([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  const [tallyCompany, setTallyCompany] = useState('')
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [tallyHost, setTallyHost] = useState('localhost')
  const [tallyPort, setTallyPort] = useState('9000')

  // Fetch PPE ledgers on mount/change
  useEffect(() => {
    if (!entity?.id || !activeTB?.id) return
    const fetchPPE = async () => {
      try {
        setLoading(true)
        const data = await window.api?.getPPELedgers(entity.id, activeTB.entity_period_id)
        setLedgers(data || [])
      } catch (err) {
        console.error('Failed to fetch PPE ledgers:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchPPE()
  }, [entity?.id, activeTB?.id])

  const handleImportFromTally = async () => {
    if (!tallyCompany.trim()) {
      setSaveStatus('Please enter Tally company name')
      return
    }
    if (!entity?.id || !activeTB?.id) return

    setImporting(true)
    setSaveStatus('')
    try {
      const result = await window.api?.importPPEFromTally(
        tallyCompany.trim(),
        tallyHost,
        parseInt(tallyPort)
      )

      if (result.success) {
        setLedgers(result.ledgers)
        setSaveStatus(`Imported ${result.count} Fixed Assets ledgers`)
        setShowImportDialog(false)
        setTallyCompany('')
        setTimeout(() => setSaveStatus(''), 3000)
      } else {
        setSaveStatus(`Import failed: ${result.error}`)
      }
    } catch (err) {
      console.error('Import failed:', err)
      setSaveStatus('Import failed: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  const handleSave = async () => {
    if (!entity?.id || !activeTB?.id) return
    setLoading(true)
    setSaveStatus('')
    try {
      await window.api?.savePPELedgers(entity.id, activeTB.entity_period_id, ledgers)
      setSaveStatus('Saved successfully')
      setTimeout(() => setSaveStatus(''), 3000)
    } catch (err) {
      console.error('Save failed:', err)
      setSaveStatus('Save failed')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (index, field, value) => {
    const updated = [...ledgers]
    updated[index] = { ...updated[index], [field]: value ? parseFloat(value) : null }
    setLedgers(updated)
  }

  const handleDeleteLedger = async (index) => {
    const ledger = ledgers[index]
    if (ledger.id && window.confirm('Delete this ledger?')) {
      try {
        await window.api?.deletePPELedger(ledger.id)
        setLedgers(ledgers.filter((_, i) => i !== index))
      } catch (err) {
        console.error('Delete failed:', err)
      }
    } else {
      setLedgers(ledgers.filter((_, i) => i !== index))
    }
  }

  // Group ledgers by group
  const groupedLedgers = {}
  ledgers.forEach((ledger, index) => {
    const group = ledger.ledger_group || 'Ungrouped'
    if (!groupedLedgers[group]) groupedLedgers[group] = []
    groupedLedgers[group].push({ ...ledger, _index: index })
  })

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      <div className="flex-shrink-0 bg-white border-b border-gray-300 p-6">
        <div className="flex justify-between items-center">
          <h1 className="text-xl font-bold text-gray-900">PPE (Property, Plant & Equipment)</h1>
          <div className="flex items-center gap-3">
            {saveStatus && <span className={`text-sm font-medium ${saveStatus.includes('failed') ? 'text-red-600' : 'text-green-600'}`}>{saveStatus}</span>}
            <button
              onClick={() => {
                console.log('Import button clicked')
                setShowImportDialog(true)
              }}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400 transition font-medium"
            >
              Import from Tally
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 transition font-medium"
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-6">
          {ledgers.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              No PPE ledgers. Click "Import from Tally" to load Fixed Assets.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', display: 'inline-block', width: '100%' }}>
              <table className="border-collapse min-w-full" style={{ marginBottom: '20px' }}>
                <thead>
                  <tr>
                    <th className="border border-gray-400 p-2 text-left font-bold text-xs bg-gray-200" style={{ width: '25%' }}>Ledger Name</th>
                    <th className="border border-gray-400 p-2 text-center font-bold text-xs bg-gray-200" style={{ width: '15%' }}>Opening Balance</th>
                    <th className="border border-gray-400 p-2 text-center font-bold text-xs bg-gray-200" style={{ width: '15%' }}>Additions (Dr)</th>
                    <th className="border border-gray-400 p-2 text-center font-bold text-xs bg-gray-200" style={{ width: '15%' }}>Credits</th>
                    <th className="border border-gray-400 p-2 text-center font-bold text-xs bg-gray-200" style={{ width: '15%' }}>Closing Balance</th>
                    <th className="border border-gray-400 p-2 text-center font-bold text-xs bg-gray-200" style={{ width: '10%' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(groupedLedgers).map(([group, groupLedgers]) => (
                    <React.Fragment key={group}>
                      <tr style={{ backgroundColor: '#f0f0f0' }}>
                        <td colSpan="6" className="border border-gray-400 p-2 font-bold text-sm bg-gray-100">
                          {group}
                        </td>
                      </tr>
                      {groupLedgers.map((ledger) => (
                        <tr key={ledger._index}>
                          <td className="border border-gray-400 p-2 text-sm">{ledger.ledger_name}</td>
                          <td className="border border-gray-400 p-2">
                            <input
                              type="number"
                              value={ledger.opening_balance || ''}
                              onChange={(e) => handleChange(ledger._index, 'opening_balance', e.target.value)}
                              className="w-full px-1 py-1 text-xs text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                              step="0.01"
                            />
                          </td>
                          <td className="border border-gray-400 p-2">
                            <input
                              type="number"
                              value={ledger.additions_debit || ''}
                              onChange={(e) => handleChange(ledger._index, 'additions_debit', e.target.value)}
                              className="w-full px-1 py-1 text-xs text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                              step="0.01"
                            />
                          </td>
                          <td className="border border-gray-400 p-2">
                            <input
                              type="number"
                              value={ledger.credits || ''}
                              onChange={(e) => handleChange(ledger._index, 'credits', e.target.value)}
                              className="w-full px-1 py-1 text-xs text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                              step="0.01"
                            />
                          </td>
                          <td className="border border-gray-400 p-2 text-right text-sm font-medium">
                            {(ledger.opening_balance || 0) + (ledger.additions_debit || 0) - (ledger.credits || 0)}
                          </td>
                          <td className="border border-gray-400 p-2 text-center">
                            <button
                              onClick={() => handleDeleteLedger(ledger._index)}
                              className="text-xs text-red-600 hover:text-red-800 font-medium"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Import Dialog */}
      {showImportDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-bold mb-4">Import Fixed Assets from Tally</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tally Company Name
                </label>
                <input
                  type="text"
                  value={tallyCompany}
                  onChange={(e) => setTallyCompany(e.target.value)}
                  placeholder="e.g., R S Distributors"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Host
                  </label>
                  <input
                    type="text"
                    value={tallyHost}
                    onChange={(e) => setTallyHost(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Port
                  </label>
                  <input
                    type="text"
                    value={tallyPort}
                    onChange={(e) => setTallyPort(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="bg-blue-50 p-3 rounded text-sm text-blue-800">
                ℹ️ Ensure Tally is open with the company loaded and HTTP Server enabled
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowImportDialog(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleImportFromTally}
                disabled={importing || !tallyCompany.trim()}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition font-medium"
              >
                {importing ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
