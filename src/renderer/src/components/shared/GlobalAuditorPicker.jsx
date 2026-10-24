import React, { useState, useEffect } from 'react'

// Picks an auditor from the GLOBAL list (Masters → Auditor Firms / Signatories):
// choose the Firm, and its partners / proprietor are offered — the only one is
// chosen by itself — and the firm name, FRN, name, designation and membership
// number come with it. Nothing has to be typed for an auditee the firm audits.
//
//   onPick({ firm_name, frn, name, designation, membership_number } | null)
export function auditorFromGlobal(firm, person) {
  if (!firm || !person) return null
  return {
    firm_name: firm.firm_name || '',
    frn: firm.frn || '',
    name: person.name || '',
    designation: person.designation || '',
    membership_number: person.membership_number || '',
    membership_category: person.membership_category || '',
  }
}

export default function GlobalAuditorPicker({ onPick, compact = false }) {
  const [firms, setFirms] = useState([])
  const [people, setPeople] = useState([])
  const [firmId, setFirmId] = useState('')
  const [personId, setPersonId] = useState('')
  const [loadErr, setLoadErr] = useState('')

  useEffect(() => {
    window.api?.listAuditorFirms?.()
      .then(r => setFirms(r || []))
      .catch(e => setLoadErr(e?.message || 'Could not load the Global Auditor list.'))
  }, [])

  const firm = firms.find(f => String(f.id) === String(firmId)) || null

  useEffect(() => {
    setPeople([]); setPersonId('')
    if (!firmId) { onPick?.(null); return }
    window.api?.listGlobalSignatories?.(firmId)
      .then(list => {
        const ppl = list || []
        setPeople(ppl)
        if (ppl.length === 1) {                       // a proprietor / sole partner: no second choice to make
          setPersonId(String(ppl[0].id))
          onPick?.(auditorFromGlobal(firm, ppl[0]))
        } else {
          onPick?.(null)
        }
      })
      .catch(e => setLoadErr(e?.message || 'Could not load the firm\'s partners.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmId, firms])

  const choosePerson = (id) => {
    setPersonId(id)
    onPick?.(auditorFromGlobal(firm, people.find(p => String(p.id) === String(id))))
  }

  const sel = compact
    ? 'w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white'
    : 'w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400'
  const lbl = compact ? 'block text-[10px] text-gray-500 mb-0.5' : 'block text-xs text-gray-500 mb-1'

  if (!loadErr && firms.length === 0) {
    return <p className="text-xs text-gray-400">No firms in the Global Auditor list yet — add them via the Masters icon (top bar).</p>
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className={lbl}>Auditor Firm (Global list)</label>
        <select value={firmId} onChange={e => setFirmId(e.target.value)} className={sel}>
          <option value="">— Select firm —</option>
          {firms.map(f => <option key={f.id} value={f.id}>{f.firm_name}{f.frn ? ` (FRN ${f.frn})` : ''}</option>)}
        </select>
      </div>
      <div>
        <label className={lbl}>Partner / Proprietor</label>
        <select value={personId} onChange={e => choosePerson(e.target.value)} disabled={!firmId || people.length === 0} className={`${sel} disabled:bg-gray-100`}>
          <option value="">{!firmId ? '— Select firm first —' : people.length === 0 ? '— none in this firm —' : '— Select —'}</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.name}{p.designation ? `, ${p.designation}` : ''}{p.membership_number ? ` (M.No. ${p.membership_number})` : ''}</option>)}
        </select>
      </div>
      {loadErr && <p className="col-span-2 text-red-500 text-xs">{loadErr}</p>}
    </div>
  )
}
