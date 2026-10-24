// Shared parsers for Tally Trial Balance Excel + Master JSON.
// Used by both the Tally TB Preview tab and the dual-file upload modal in
// ActualTB. Parses entirely in the renderer; the resulting structures are
// then sent to the main process for DB persistence.

import * as XLSX from 'xlsx'

/**
 * Parses a Tally Trial Balance Excel file.
 * @param {ArrayBuffer} buffer
 * @returns {{ rows: Array, header: string }}
 *   rows: { name, opening_dr, opening_cr, debit, credit, closing_dr, closing_cr, opening_net, closing_net }
 */
export function parseTallyTB(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellText: true, cellNF: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws || !ws['!ref']) return { rows: [], header: '' }
  const range = XLSX.utils.decode_range(ws['!ref'])
  const rows = []
  let entityHeader = ''

  // Find data start: first row where col B is "Balance" (sub-header row)
  let dataStart = -1
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cell = ws[XLSX.utils.encode_cell({ c: 1, r })]
    if (cell && (cell.v === 'Balance' || cell.w === 'Balance')) {
      dataStart = r + 1
      break
    }
  }
  if (dataStart < 0) dataStart = range.s.r

  // Pick the entity name from first non-empty top-left cell
  for (let r = range.s.r; r < dataStart && r < range.s.r + 6; r++) {
    const c0 = ws[XLSX.utils.encode_cell({ c: 0, r })]
    if (c0 && c0.v && typeof c0.v === 'string' && c0.v.length > 1 && !entityHeader) {
      entityHeader = c0.v
      break
    }
  }

  const parseDrCr = (cell) => {
    if (!cell) return { dr: 0, cr: 0 }
    const v = parseFloat(cell.v) || 0
    const w = (cell.w || '').toString()
    if (/Cr\s*$/i.test(w)) return { dr: 0, cr: Math.abs(v) }
    if (/Dr\s*$/i.test(w)) return { dr: Math.abs(v), cr: 0 }
    return { dr: Math.abs(v), cr: 0 }
  }

  for (let r = dataStart; r <= range.e.r; r++) {
    const nameCell = ws[XLSX.utils.encode_cell({ c: 0, r })]
    if (!nameCell || !nameCell.v) continue
    const name = String(nameCell.v).trim()
    if (!name) continue
    if (/^(Grand\s+Total|Total)$/i.test(name)) continue

    const open = parseDrCr(ws[XLSX.utils.encode_cell({ c: 1, r })])
    const debTrans  = parseFloat(ws[XLSX.utils.encode_cell({ c: 2, r })]?.v || 0) || 0
    const credTrans = parseFloat(ws[XLSX.utils.encode_cell({ c: 3, r })]?.v || 0) || 0
    const close = parseDrCr(ws[XLSX.utils.encode_cell({ c: 4, r })])

    rows.push({
      name,
      opening_dr: open.dr,
      opening_cr: open.cr,
      debit: debTrans,
      credit: credTrans,
      closing_dr: close.dr,
      closing_cr: close.cr,
      opening_net: open.dr - open.cr,
      closing_net: close.dr - close.cr,
    })
  }
  return { rows, header: entityHeader }
}

/**
 * Parses a Tally Master JSON file (handles UTF-16 LE/BE BOM, UTF-8 BOM, plain UTF-8).
 * @param {ArrayBuffer} buffer
 * @returns {{ ledgerMap, groupCount, ledgerCount }}
 */
export function parseMasterJSON(buffer) {
  const u8 = new Uint8Array(buffer)
  let txt
  if (u8[0] === 0xff && u8[1] === 0xfe) {
    txt = new TextDecoder('utf-16le').decode(u8.slice(2))
  } else if (u8[0] === 0xfe && u8[1] === 0xff) {
    const swapped = new Uint8Array(u8.length - 2)
    for (let i = 0; i < swapped.length; i += 2) {
      swapped[i] = u8[i + 3]
      swapped[i + 1] = u8[i + 2]
    }
    txt = new TextDecoder('utf-16le').decode(swapped)
  } else if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    txt = new TextDecoder('utf-8').decode(u8.slice(3))
  } else {
    txt = new TextDecoder('utf-8').decode(u8)
  }
  const data = JSON.parse(txt)
  const messages = data.tallymessage || []

  const groupParent = {}
  for (const m of messages) {
    if (m.metadata?.type === 'Group') {
      const name = m.metadata.name
      if (name) groupParent[name] = m.parent || null
    }
  }

  const chainOf = (groupName) => {
    const chain = []
    let cur = groupName
    let safety = 0
    while (cur && safety++ < 32) {
      chain.push(cur)
      const p = groupParent[cur]
      if (!p) break
      cur = p
    }
    return chain
  }

  const ledgerMap = {}
  for (const m of messages) {
    if (m.metadata?.type === 'Ledger') {
      const name = m.metadata.name
      const parent = m.parent || ''
      const hierarchy = parent ? chainOf(parent) : []
      ledgerMap[(name || '').trim().toLowerCase()] = {
        name,
        parent,
        hierarchy,
        affectsstock: !!m.affectsstock,
      }
    }
  }
  return {
    ledgerMap,
    groupCount: Object.keys(groupParent).length,
    ledgerCount: Object.keys(ledgerMap).length,
  }
}

/**
 * Joins parsed Tally TB rows with the Master ledger map and returns rows
 * shaped for the standard `tb_rows` table (compatible with the existing
 * ODBC TB upload format).
 *
 * Sign convention (matches existing system, see tb.js saveStock):
 *   - Dr-natured (assets/expenses): stored as NEGATIVE balance, is_deemed_positive = true
 *   - Cr-natured (liab/equity/income): stored as POSITIVE balance,    is_deemed_positive = false
 */
export function buildTBRowsFromTally(tbRows, ledgerMap) {
  return tbRows.map(r => {
    const m = ledgerMap[r.name.trim().toLowerCase()]
    const chain = m?.hierarchy || []

    // Net signed balance per system convention
    const openingBalance = r.opening_cr - r.opening_dr  // Cr+, Dr-
    const closingBalance = r.closing_cr - r.closing_dr
    // Nature (Dr-natured Assets/Expenses vs Cr-natured Liabilities/Income) is
    // a STRUCTURAL property of the ledger — it must come from Tally's own
    // IsDeemedPositive master field, not be guessed from which side the
    // balance currently sits on. A creditor showing a Dr balance (advance
    // paid) is still Cr-natured; a debtor in credit (advance received) is
    // still Dr-natured. Falling back to the balance-side heuristic only
    // when the master data doesn't carry the field at all (e.g. some Excel
    // Master.json exports).
    const isDeemedPositive = m?.isDeemedPositive !== null && m?.isDeemedPositive !== undefined
      ? m.isDeemedPositive
      : (r.closing_dr >= r.closing_cr ? true : (r.opening_dr > r.opening_cr))

    return {
      period: '',
      branch: '',
      ledger_code: '',
      name: r.name,
      opening_balance: openingBalance,
      debit: r.debit,
      credit: r.credit,
      closing_balance: closingBalance,
      is_revenue: null,
      is_deemed_positive: isDeemedPositive,
      trail_balance: 0,
      parent:         chain[0] || '',
      group_parent:   chain[1] || '',
      group_parent_1: chain[2] || '',
      group_parent_2: chain[3] || '',
      group_parent_3: chain[4] || '',
      group_parent_4: chain[5] || '',
      group_parent_5: chain[6] || '',
      group_parent_6: chain[7] || '',
      group_parent_7: chain[chain.length - 1] || '',  // primary group at the top
    }
  })
}

// ── Real Books Format parsers ─────────────────────────────────────────────────

/**
 * Parses a Real Books Trial Balance Excel (Ledger Group Details Pivot Structure).
 * Detects the header row by looking for the cell "Segment", then reads data below.
 * Also extracts the period from the metadata header block.
 */
export function parseRealBooksTB(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  let headerIdx = -1
  let period = ''

  for (let i = 0; i < aoa.length; i++) {
    const cell0 = aoa[i][0] ? String(aoa[i][0]).trim() : ''
    if (cell0 === 'Segment') { headerIdx = i; break }
    if (/period\s+for/i.test(cell0)) {
      period = aoa[i][1] ? String(aoa[i][1]).trim() : ''
    }
  }
  if (headerIdx < 0) throw new Error('Could not find header row (Segment column) in Real Books TB file.')

  const rows = []
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i]
    const name = row[2] ? String(row[2]).trim() : ''
    if (!name || /^(Grand Total|Total)$/i.test(name) || /^Date\s*:/i.test(name)) continue
    rows.push({
      ledger_group:    row[1] ? String(row[1]).trim() : '',
      name,
      opening_balance: parseFloat(row[3]) || 0,
      debit:           parseFloat(row[4]) || 0,
      credit:          parseFloat(row[5]) || 0,
      closing_balance: parseFloat(row[6]) || 0,
    })
  }
  return { rows, period }
}

/**
 * Parses a Real Books Ledger Master Excel.
 * Detects the header row by looking for the cell "Nature".
 *
 * Returns:
 *   masterMap       — keyed by lower-cased ledger name → { name, nature, hierarchyChain, ledger_code }
 *   groupHierarchyMap — keyed by group name → chain of parents ABOVE it (deepest-first → topmost-last)
 *                       Used as fallback when a TB ledger name isn't in masterMap directly.
 *   groupNatureMap  — keyed by group name → Nature of ledgers in that group (for Nature inference)
 *   ledgerCount
 *
 * Real Books hierarchy convention:
 *   Parent Group0 = TOPMOST (broadest, equivalent to Tally's pre-primary group)
 *   Parent Group5 = DEEPEST (most specific, immediate parent of the ledger)
 * We store chain deepest-first so that appending synthetic "Primary" makes Group0 the pre-primary,
 * which is exactly what the Tally mapping engine expects for Map1 lookup.
 */
export function parseRealBooksMaster(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  let headerIdx = -1
  for (let i = 0; i < aoa.length; i++) {
    if (aoa[i][0] && String(aoa[i][0]).trim() === 'Nature') { headerIdx = i; break }
  }
  if (headerIdx < 0) throw new Error('Could not find header row (Nature column) in Real Books Master file.')

  const headers = aoa[headerIdx].map(h => h ? String(h).trim() : '')
  const col = (name) => headers.indexOf(name)

  const iNature = col('Nature'), iName = col('Ledger Name')
  const iG0 = col('Parent Group0'), iG1 = col('Parent Group1')
  const iG2 = col('Parent Group2'), iG3 = col('Parent Group3')
  const iG4 = col('Parent Group4'), iG5 = col('Parent Group5')
  const iCode = col('Ledger Code')

  const masterMap = {}
  const groupHierarchyMap = {}  // group → [parents above it, deepest-first, G0-last]
  const groupNatureMap = {}     // group → Nature string
  let ledgerCount = 0

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i]
    const name = row[iName] ? String(row[iName]).trim() : null
    if (!name) continue

    const nature = row[iNature] ? String(row[iNature]).trim() : ''
    // Chain ordered deepest-first, topmost (G0) last
    const chain = [iG5, iG4, iG3, iG2, iG1, iG0]
      .map(idx => (idx >= 0 && row[idx]) ? String(row[idx]).trim() : null)
      .filter(Boolean)

    // Build groupHierarchyMap: for each position in the chain,
    // record the slice ABOVE it (everything closer to G0).
    // e.g. chain = [G5, G4, G3, G2, G1, G0]
    //   G5's parents = [G4, G3, G2, G1, G0]
    //   G4's parents = [G3, G2, G1, G0]
    //   ...
    //   G0 has no parents above it (it IS the topmost)
    for (let j = 0; j < chain.length; j++) {
      const grp = chain[j]
      if (!groupHierarchyMap[grp]) groupHierarchyMap[grp] = chain.slice(j + 1)
      if (nature && !groupNatureMap[grp]) groupNatureMap[grp] = nature
    }

    masterMap[name.toLowerCase()] = { name, nature, hierarchyChain: chain, ledger_code: (iCode >= 0 && row[iCode]) ? String(row[iCode]).trim() : null }
    ledgerCount++
  }
  return { masterMap, groupHierarchyMap, groupNatureMap, ledgerCount }
}

/**
 * Joins parsed Real Books TB rows with the master map.
 *
 * Sign convention: Real Books uses Dr=positive, Cr=negative.
 * Our system stores Dr-natured (Asset/Expenses) as NEGATIVE with is_deemed_positive=true,
 * and Cr-natured (Liability/Income) as POSITIVE with is_deemed_positive=false.
 * So we flip all balances: stored = -realBooks.
 *
 * Hierarchy: Real Books Group0=topmost, Group5=deepest.
 * We store deepest-first (parent=Group5 or deepest non-null, ..., group_parent_4=Group0),
 * matching the chain direction the mapping engine expects (reversed = topmost-first for Map1).
 */
export function buildTBRowsFromRealBooks(tbRows, masterMap, groupHierarchyMap = {}, groupNatureMap = {}) {
  const natureType = (n) => {
    if (/^asset$/i.test(n)) return 'Assets'
    if (/^liability$/i.test(n)) return 'Liabilities'
    if (/^expenses?$/i.test(n)) return 'Expenses'
    if (/^income$/i.test(n)) return 'Income'
    return null
  }

  return tbRows.map(r => {
    const m = masterMap[r.name.toLowerCase()] || null

    let nature, chain
    if (m) {
      nature = m.nature || ''
      // chain is deepest-first (G5→G0); append synthetic Primary so Map1 engine finds G0 as pre-primary
      chain = [...m.hierarchyChain, 'Primary']
    } else {
      // Unmatched ledger: build chain from TB's ledger_group via groupHierarchyMap
      const grp = r.ledger_group || ''
      const parentsAbove = groupHierarchyMap[grp] || []
      chain = grp ? [grp, ...parentsAbove, 'Primary'] : ['Primary']
      // Walk up the group hierarchy to find nature (immediate group first, then parents)
      nature = groupNatureMap[grp] || ''
      if (!nature) {
        for (const parent of parentsAbove) {
          if (groupNatureMap[parent]) { nature = groupNatureMap[parent]; break }
        }
      }
    }

    const isDr = /^(asset|expenses?)$/i.test(nature)

    return {
      period:             '',
      branch:             '',
      ledger_code:        m?.ledger_code || '',
      name:               r.name,
      opening_balance:    -(r.opening_balance || 0),
      debit:              r.debit || 0,
      credit:             r.credit || 0,
      closing_balance:    -(r.closing_balance || 0),
      is_revenue:         null,
      is_deemed_positive: isDr,
      trail_balance:      0,
      trial_balance_type: natureType(nature),
      parent:             chain[0] || '',
      group_parent:       chain[1] || '',
      group_parent_1:     chain[2] || '',
      group_parent_2:     chain[3] || '',
      group_parent_3:     chain[4] || '',
      group_parent_4:     chain[5] || '',
      group_parent_5:     chain[6] || '',
      group_parent_6:     '',
      group_parent_7:     chain[chain.length - 1] || '',  // topmost (G0 or Primary)
    }
  })
}
