import { ipcMain } from 'electron'
import { query } from '../db/client.js'
import { noteStore } from '../db/noteStore.js'
import { buildItrExcel } from '../services/itrExport.js'

// Optional master details: blank is fine (stored as NULL); what is given must be well formed.
const optionalText = (v) => { const t = String(v ?? '').trim(); return t || null }
// Associate (ACA) or Fellow (FCA) member of the Institute; anything else is not stored
const memberCategory = (v) => (v === 'Associate' || v === 'Fellow') ? v : null
function optionalPan(v) {
  const t = String(v ?? '').replace(/\s+/g, '').toUpperCase()
  if (!t) return null
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(t)) throw new Error('PAN must be 10 characters like AAAAA9999A')
  return t
}
function optionalEmail(v) {
  const t = String(v ?? '').trim()
  if (!t) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) throw new Error('E-mail address does not look right')
  return t
}

export function registerMastersHandlers() {
  // ── Auditor handlers ─────────────────────────────────────────────────────
  // Every signatory in the global firm master, shaped exactly like a row of the
  // per-entity `auditors` table so the exporters can consume either without
  // caring which it came from. The same two or three firms audit most auditees,
  // and re-keying the firm name, FRN and membership number for each new one was
  // both tedious and a source of typos.
  ipcMain.handle('auditor:listGlobal', async () => {
    const { rows } = await query(
      `SELECT gs.id, f.firm_name, f.frn, gs.name, gs.designation, gs.membership_number,
              f.pan AS firm_pan, f.address AS firm_address, f.email AS firm_email,
              gs.address AS signer_address, gs.email AS signer_email, gs.membership_category,
              f.id AS firm_id
         FROM global_signatories gs
         JOIN auditor_firms f ON f.id = gs.firm_id
        WHERE gs.is_active = TRUE AND f.is_active = TRUE
        ORDER BY f.firm_name, gs.name`
    )
    return rows
  })

  ipcMain.handle('auditor:list', async (_, entityId) => {
    if (!entityId) return []
    const { rows } = await query(
      `SELECT * FROM auditors WHERE entity_id = $1 AND is_active = TRUE ORDER BY id DESC`,
      [entityId]
    )
    return rows
  })

  ipcMain.handle('auditor:save', async (_, data) => {
    if (!data.name || !data.membership_number) {
      throw new Error('Name of Auditor and Membership Number are compulsory')
    }
    if (data.id) {
      const { rows: [r] } = await query(
        `UPDATE auditors SET firm_name=$1, frn=$2, name=$3, designation=$4, membership_number=$5, pan=$6, membership_category=$8
         WHERE id=$7 RETURNING *`,
        [data.firm_name || null, data.frn || null, data.name, data.designation || null,
         data.membership_number, data.pan || null, data.id, memberCategory(data.membership_category)]
      )
      return r
    } else {
      const { rows: [r] } = await query(
        `INSERT INTO auditors (entity_id, firm_name, frn, name, designation, membership_number, pan, membership_category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [data.entity_id, data.firm_name || null, data.frn || null, data.name,
         data.designation || null, data.membership_number, data.pan || null, memberCategory(data.membership_category)]
      )
      return r
    }
  })

  ipcMain.handle('auditor:delete', async (_, id) => {
    await query(`UPDATE auditors SET is_active = FALSE WHERE id = $1`, [id])
    return { ok: true }
  })

  // ── Signatory handlers ───────────────────────────────────────────────────
  ipcMain.handle('signatory:list', async (_, entityId) => {
    if (!entityId) return []
    const { rows } = await query(
      `SELECT * FROM signatories WHERE entity_id = $1 AND is_active = TRUE ORDER BY id`,
      [entityId]
    )
    return rows
  })

  ipcMain.handle('signatory:save', async (_, data) => {
    if (!data.name) throw new Error('Signatory name is compulsory')
    if (data.id) {
      const { rows: [r] } = await query(
        `UPDATE signatories SET name=$1, din=$2, designation=$3, id_type=$5 WHERE id=$4 RETURNING *`,
        [data.name, data.din || null, data.designation || null, data.id, data.id_type || null]
      )
      return r
    } else {
      const { rows: [r] } = await query(
        `INSERT INTO signatories (entity_id, name, din, designation, id_type)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [data.entity_id, data.name, data.din || null, data.designation || null, data.id_type || null]
      )
      return r
    }
  })

  ipcMain.handle('signatory:delete', async (_, id) => {
    await query(`UPDATE signatories SET is_active = FALSE WHERE id = $1`, [id])
    return { ok: true }
  })

  // ── Global Auditor Firms ─────────────────────────────────────────────────
  // is_active is a PostgreSQL BOOLEAN: these four queries compared it with 1 / 0,
  // which PostgreSQL rejects ("operator does not exist: boolean = integer") — the
  // global list could be added to but never listed or pruned (fixed 0.1.76).
  ipcMain.handle('auditorFirm:list', async () => {
    const { rows } = await query(`SELECT * FROM auditor_firms WHERE is_active IS TRUE ORDER BY firm_name`)
    return rows
  })
  ipcMain.handle('auditorFirm:save', async (_, data) => {
    if (!data.firm_name) throw new Error('Firm name is required')
    // PAN, address and e-mail are optional; a PAN, when given, must be a real one
    const pan = optionalPan(data.pan), address = optionalText(data.address), email = optionalEmail(data.email)
    if (data.id) {
      const { rows: [r] } = await query(
        `UPDATE auditor_firms SET firm_name=$1, frn=$2, pan=$4, address=$5, email=$6 WHERE id=$3 RETURNING *`,
        [data.firm_name, data.frn || null, data.id, pan, address, email]
      )
      return r
    } else {
      const { rows: [r] } = await query(
        `INSERT INTO auditor_firms (firm_name, frn, pan, address, email) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [data.firm_name, data.frn || null, pan, address, email]
      )
      return r
    }
  })
  ipcMain.handle('auditorFirm:delete', async (_, id) => {
    await query(`UPDATE auditor_firms SET is_active=FALSE WHERE id=$1`, [id])
    return { ok: true }
  })

  // ── Global Signatories (per auditor firm) ────────────────────────────────
  ipcMain.handle('globalSignatory:list', async (_, firmId) => {
    // JOIN auditor_firms so firm_name and frn are available on each signatory row
    const { rows } = await query(
      `SELECT gs.*, af.firm_name, af.frn AS firm_frn
       FROM global_signatories gs
       LEFT JOIN auditor_firms af ON af.id = gs.firm_id
       WHERE gs.is_active IS TRUE${firmId ? ' AND gs.firm_id=$1' : ''}
       ORDER BY gs.name`,
      firmId ? [firmId] : []
    )
    return rows
  })
  ipcMain.handle('globalSignatory:save', async (_, data) => {
    if (!data.name) throw new Error('Name is required')
    const address = optionalText(data.address), email = optionalEmail(data.email)   // optional
    if (data.id) {
      const { rows: [r] } = await query(
        `UPDATE global_signatories SET firm_id=$1, name=$2, din=$3, designation=$4, membership_number=$5, address=$7, email=$8, membership_category=$9 WHERE id=$6 RETURNING *`,
        [data.firm_id || null, data.name, data.din || null, data.designation || null, data.membership_number || null, data.id, address, email, memberCategory(data.membership_category)]
      )
      return r
    } else {
      const { rows: [r] } = await query(
        `INSERT INTO global_signatories (firm_id, name, din, designation, membership_number, address, email, membership_category) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [data.firm_id || null, data.name, data.din || null, data.designation || null, data.membership_number || null, address, email, memberCategory(data.membership_category)]
      )
      return r
    }
  })
  ipcMain.handle('globalSignatory:delete', async (_, id) => {
    await query(`UPDATE global_signatories SET is_active=FALSE WHERE id=$1`, [id])
    return { ok: true }
  })

  // ── Note Details handlers ────────────────────────────────────────────────
  // Found by note TITLE, not number — see src/main/db/noteStore.js.
  ipcMain.handle('noteDetails:get', async (_, tbId, noteNum, noteTitle) => {
    const row = await noteStore.find('note_details', tbId, noteNum, noteTitle)
    return row ? JSON.parse(row.value) : null
  })

  ipcMain.handle('noteDetails:save', async (_, { tbId, noteNum, noteTitle, data }) => {
    await noteStore.save('note_details', tbId, noteNum, noteTitle, JSON.stringify(data))
    return { ok: true }
  })

  ipcMain.handle('itrDetails:get', async (_, tbId) => {
    const { rows } = await query(`SELECT data FROM itr_details WHERE tb_id=$1`, [tbId])
    return rows[0] ? JSON.parse(rows[0].data) : null
  })

  ipcMain.handle('itrDetails:save', async (_, { tbId, data }) => {
    await query(
      `INSERT INTO itr_details (tb_id, data, updated_at)
       VALUES ($1,$2,now())
       ON CONFLICT(tb_id) DO UPDATE SET
         data = EXCLUDED.data,
         updated_at = now()`,
      [tbId, JSON.stringify(data)]
    )
    return { ok: true }
  })

  ipcMain.handle('itr:exportExcel', async (_, { group, formValues, detailsData }) => {
    const buf = await buildItrExcel({ group, formValues, detailsData })
    // Return a plain byte array, not the raw ExcelJS Buffer — Buffers can
    // arrive mangled/truncated on the renderer side of the IPC structured-clone
    // boundary, which produced files Excel reported as corrupted.
    return Array.from(buf)
  })

  ipcMain.handle('noteDetails:listByTB', async (_, tbId) => {
    const { rows } = await query(
      `SELECT note_num, note_title, data, updated_at FROM note_details WHERE tb_id=$1 ORDER BY note_num`,
      [tbId]
    )
    return rows.map(r => ({ ...r, data: JSON.parse(r.data) }))
  })

  // ── Note Disclosures (optional free-text block shown below a note when
  // non-empty — included in the live view, PDF, and Excel exports) ──────────
  ipcMain.handle('noteDisclosure:get', async (_, tbId, noteNum, noteTitle) => {
    const row = await noteStore.find('note_disclosures', tbId, noteNum, noteTitle)
    return row?.value || ''
  })

  ipcMain.handle('noteDisclosure:save', async (_, { tbId, noteNum, noteTitle, text }) => {
    await noteStore.save('note_disclosures', tbId, noteNum, noteTitle, text || '')
    return { ok: true }
  })

  ipcMain.handle('noteDisclosure:listByTB', async (_, tbId) => {
    const { rows } = await query(
      `SELECT note_num, note_title, text, updated_at FROM note_disclosures WHERE tb_id=$1 AND text != '' ORDER BY note_num`,
      [tbId]
    )
    return rows
  })

  // Disclosure notes of the Consolidated view of a branch entity (saved against the Auditee)
  ipcMain.handle('entityNoteDisclosure:get', async (_, entityId, noteNum, noteTitle) => {
    const row = await noteStore.find('entity_note_disclosures', entityId, noteNum, noteTitle)
    return row?.value || ''
  })
  ipcMain.handle('entityNoteDisclosure:save', async (_, { entityId, noteNum, noteTitle, text }) => {
    await noteStore.save('entity_note_disclosures', entityId, noteNum, noteTitle, text || '')
    return { ok: true }
  })
  ipcMain.handle('entityNoteDisclosure:list', async (_, entityId) => {
    const { rows } = await query(
      `SELECT note_num, note_title, text, updated_at FROM entity_note_disclosures WHERE entity_id=$1 AND text != '' ORDER BY note_num`,
      [entityId]
    )
    return rows
  })

  // ── Entity-level Note Details (for branch entities — statutory forms) ──────
  ipcMain.handle('entityNoteDetails:get', async (_, entityId, noteNum, noteTitle) => {
    const row = await noteStore.find('entity_note_details', entityId, noteNum, noteTitle)
    return row ? JSON.parse(row.value) : null
  })

  ipcMain.handle('entityNoteDetails:save', async (_, { entityId, noteNum, noteTitle, data }) => {
    await noteStore.save('entity_note_details', entityId, noteNum, noteTitle, JSON.stringify(data))
    return { ok: true }
  })

  ipcMain.handle('entityNoteDetails:list', async (_, entityId) => {
    const { rows } = await query(
      `SELECT note_num, note_title, data, updated_at FROM entity_note_details WHERE entity_id=$1 ORDER BY note_num`,
      [entityId]
    )
    return rows.map(r => ({ ...r, data: JSON.parse(r.data) }))
  })

  // ── Remarks handlers ─────────────────────────────────────────────────────
  const VALID_SCOPES = new Set(['tb', 'bs', 'pl', 'notes', 'annexure'])

  // Fetch all remarks for a TB, keyed by "scope|scope_key"
  ipcMain.handle('remarks:listByTB', async (_, tbId) => {
    if (!tbId) return []
    const { rows } = await query(
      `SELECT scope, scope_key, remark FROM remarks WHERE tb_id = $1`,
      [tbId]
    )
    return rows
  })

  // Upsert a single remark
  ipcMain.handle('remarks:save', async (_, { tbId, scope, scope_key, remark }) => {
    if (!VALID_SCOPES.has(scope)) throw new Error(`Invalid scope: ${scope}`)
    if (!scope_key) throw new Error('scope_key is required')
    const trimmed = (remark || '').trim()
    if (!trimmed) {
      // Delete on empty
      await query(`DELETE FROM remarks WHERE tb_id = $1 AND scope = $2 AND scope_key = $3`,
        [tbId, scope, scope_key])
      return { ok: true, deleted: true }
    }
    const { rows: [r] } = await query(
      `INSERT INTO remarks (tb_id, scope, scope_key, remark)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tb_id, scope, scope_key) DO UPDATE SET
         remark = EXCLUDED.remark,
         updated_at = NOW()
       RETURNING *`,
      [tbId, scope, scope_key, trimmed]
    )
    return r
  })

  // Consolidated "Mapped TB With Remarks" view — returns one row per ledger
  // with remarks aggregated across all scopes via mapping.
  ipcMain.handle('remarks:consolidated', async (_, tbId, prevTbId) => {
    if (!tbId) return []
    const { rows } = await query(`
      SELECT
        tr.ledger_code,
        tr.name AS ledger_name,
        mt.alie,
        mt.mapping1_resultant,
        mt.mapping2_resultant,
        mt.mapping3_resultant,
        tr.closing_balance,
        tr.adj_debit, tr.adj_credit,
        (SELECT remark FROM remarks WHERE tb_id = $1 AND scope='tb'       AND scope_key = COALESCE(NULLIF(tr.ledger_code, ''), tr.name)) AS tb_remark,
        (SELECT remark FROM remarks WHERE tb_id = $1 AND scope='bs'       AND scope_key = mt.mapping2_resultant)                       AS bs_remark,
        (SELECT remark FROM remarks WHERE tb_id = $1 AND scope='pl'       AND scope_key = mt.mapping2_resultant)                       AS pl_remark,
        (SELECT remark FROM remarks WHERE tb_id = $1 AND scope='notes'    AND scope_key = mt.mapping2_resultant)                       AS notes_remark,
        (SELECT remark FROM remarks WHERE tb_id = $1 AND scope='annexure' AND scope_key = COALESCE(NULLIF(tr.ledger_code, ''), tr.name)) AS annexure_remark
      FROM tb_rows tr
      LEFT JOIN mapped_tb mt ON mt.tb_row_id = tr.id
      WHERE tr.tb_id = $1
      ORDER BY mt.alie, mt.mapping1_resultant, mt.mapping2_resultant, tr.name
    `, [tbId])

    // Previous Year ledger-level closing balance — matched by ledger_code
    // (falling back to name), same identity-match convention used elsewhere
    // for per-ledger PY figures (see buildPrevRowsByLedger in useFinancials.js).
    if (prevTbId) {
      const { rows: prevRows } = await query(
        `SELECT ledger_code, name, closing_balance FROM tb_rows WHERE tb_id = $1`, [prevTbId]
      )
      const prevMap = new Map()
      for (const r of prevRows) {
        const key = (r.ledger_code || r.name || '').trim().toLowerCase()
        if (!key) continue
        prevMap.set(key, (prevMap.get(key) || 0) + parseFloat(r.closing_balance || 0))
      }
      for (const row of rows) {
        const key = (row.ledger_code || row.ledger_name || '').trim().toLowerCase()
        row.py_closing_balance = key && prevMap.has(key) ? prevMap.get(key) : null
      }
    }
    return rows
  })

  // ── Manual Previous Year entry ───────────────────────────────────────────
  // One flag per TB (trial_balances.manual_py), toggleable from BS/PL/Notes
  // alike — they all read/write this same value, so ticking it in any one
  // screen is automatically reflected in the other two on next refresh.
  ipcMain.handle('manualPY:get', async (_, tbId) => {
    const { rows } = await query(`SELECT manual_py FROM trial_balances WHERE id=$1`, [tbId])
    return !!rows[0]?.manual_py
  })

  ipcMain.handle('manualPY:set', async (_, tbId, enabled) => {
    await query(`UPDATE trial_balances SET manual_py=$1 WHERE id=$2`, [enabled ? 1 : 0, tbId])
    return { ok: true }
  })

  // One flag per TB (trial_balances.pl_closed_to_capital) — see schema.js's
  // migration comment. Editable after import too (not just at Tally-connect
  // time), since the user may only realise afterward that this TB's P&L was
  // already closed to Capital in Tally.
  ipcMain.handle('plClosedToCapital:get', async (_, tbId) => {
    const { rows } = await query(`SELECT pl_closed_to_capital FROM trial_balances WHERE id=$1`, [tbId])
    return !!rows[0]?.pl_closed_to_capital
  })

  ipcMain.handle('plClosedToCapital:set', async (_, tbId, enabled) => {
    await query(`UPDATE trial_balances SET pl_closed_to_capital=$1 WHERE id=$2`, [enabled ? 1 : 0, tbId])
    return { ok: true }
  })

  // Consolidated-view mirror — see schema.js's consolidated_pl_closed_to_capital comment.
  ipcMain.handle('entityPlClosedToCapital:get', async (_, entityId) => {
    const { rows } = await query(`SELECT consolidated_pl_closed_to_capital FROM entities WHERE id=$1`, [entityId])
    return !!rows[0]?.consolidated_pl_closed_to_capital
  })
  ipcMain.handle('entityPlClosedToCapital:set', async (_, entityId, enabled) => {
    await query(`UPDATE entities SET consolidated_pl_closed_to_capital=$1 WHERE id=$2`, [enabled ? 1 : 0, entityId])
    return { ok: true }
  })

  // Basic/Diluted EPS overrides — see schema.js's eps_basic_cy comment.
  // NULL in any of the 4 columns means "use the auto-computed figure"; a
  // non-NULL value is a CA override that always wins over the auto-computed
  // one. :set takes whichever of the 4 keys the caller wants to change —
  // the other columns are left untouched (a partial UPDATE, not a full
  // overwrite), since the CA may only edit one of the four cells at a time.
  const EPS_FIELDS = { basicCY: 'eps_basic_cy', basicPY: 'eps_basic_py', dilutedCY: 'eps_diluted_cy', dilutedPY: 'eps_diluted_py' }
  ipcMain.handle('eps:get', async (_, tbId) => {
    const { rows } = await query(`SELECT eps_basic_cy, eps_basic_py, eps_diluted_cy, eps_diluted_py FROM trial_balances WHERE id=$1`, [tbId])
    const r = rows[0] || {}
    return { basicCY: r.eps_basic_cy, basicPY: r.eps_basic_py, dilutedCY: r.eps_diluted_cy, dilutedPY: r.eps_diluted_py }
  })
  ipcMain.handle('eps:set', async (_, tbId, field, value) => {
    const col = EPS_FIELDS[field]
    if (!col) throw new Error('Unknown EPS field: ' + field)
    await query(`UPDATE trial_balances SET ${col}=$1 WHERE id=$2`, [value === '' || value === undefined ? null : value, tbId])
    return { ok: true }
  })
  ipcMain.handle('entityEps:get', async (_, entityId) => {
    const { rows } = await query(`SELECT consolidated_eps_basic_cy, consolidated_eps_basic_py, consolidated_eps_diluted_cy, consolidated_eps_diluted_py FROM entities WHERE id=$1`, [entityId])
    const r = rows[0] || {}
    return { basicCY: r.consolidated_eps_basic_cy, basicPY: r.consolidated_eps_basic_py, dilutedCY: r.consolidated_eps_diluted_cy, dilutedPY: r.consolidated_eps_diluted_py }
  })
  ipcMain.handle('entityEps:set', async (_, entityId, field, value) => {
    const col = 'consolidated_' + EPS_FIELDS[field]
    if (!EPS_FIELDS[field]) throw new Error('Unknown EPS field: ' + field)
    await query(`UPDATE entities SET ${col}=$1 WHERE id=$2`, [value === '' || value === undefined ? null : value, entityId])
    return { ok: true }
  })

  ipcMain.handle('manualPyEntries:list', async (_, tbId) => {
    const { rows } = await query(
      `SELECT * FROM manual_py_entries WHERE tb_id=$1 ORDER BY note_num, particular_label`,
      [tbId]
    )
    return rows
  })

  ipcMain.handle('manualPyEntries:upsert', async (_, { tbId, noteNum, noteTitle, particularLabel, py_amount, is_custom }) => {
    const label = particularLabel || ''
    const title = (noteTitle || '').trim()
    // Match by TITLE first, not note_num — see schema.js's note_title
    // comment for why note_num alone is unsafe (renumbers whenever the set
    // of non-zero notes changes, including as a side effect of THIS save).
    // If a row already carries this title+label, update it in place
    // regardless of what note_num it was last saved under, rather than
    // creating a second row that would tie for the match at read time.
    if (title) {
      const { rows: existing } = await query(
        `SELECT id FROM manual_py_entries WHERE tb_id=$1 AND note_title=$2 AND particular_label=$3`,
        [tbId, title, label]
      )
      if (existing[0]) {
        const r = await query(
          `UPDATE manual_py_entries SET note_num=$1, py_amount=$2, is_custom=$3, updated_at=now() WHERE id=$4 RETURNING *`,
          [noteNum, parseFloat(py_amount) || 0, is_custom ? 1 : 0, existing[0].id]
        )
        return r.rows[0]
      }
    }
    // First save for this title+label (or no title supplied) — the legacy
    // ON CONFLICT target is still (tb_id, note_num, particular_label), kept
    // unchanged so it stays compatible with rows saved before note_title existed.
    // If that exact slot is already taken by a DIFFERENT title (every
    // "+ Add PY-only Major Head" entry starts at noteNum 0, since the note
    // doesn't exist yet — a second one would otherwise silently overwrite
    // the first), reassign to a fresh, unused negative placeholder instead
    // of colliding with it.
    let insertNoteNum = noteNum
    const { rows: clash } = await query(
      `SELECT id FROM manual_py_entries WHERE tb_id=$1 AND note_num=$2 AND particular_label=$3`,
      [tbId, insertNoteNum, label]
    )
    if (clash[0]) {
      const { rows: [{ min }] } = await query(
        `SELECT COALESCE(MIN(note_num), 0) AS min FROM manual_py_entries WHERE tb_id=$1`,
        [tbId]
      )
      insertNoteNum = Math.min(0, min) - 1
    }
    const r = await query(
      `INSERT INTO manual_py_entries (tb_id, note_num, note_title, particular_label, py_amount, is_custom, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT(tb_id, note_num, particular_label) DO UPDATE SET
         note_title = EXCLUDED.note_title,
         py_amount = EXCLUDED.py_amount,
         is_custom = EXCLUDED.is_custom,
         updated_at = now()
       RETURNING *`,
      [tbId, insertNoteNum, title, label, parseFloat(py_amount) || 0, is_custom ? 1 : 0]
    )
    return r.rows[0]
  })

  ipcMain.handle('manualPyEntries:delete', async (_, id) => {
    await query(`DELETE FROM manual_py_entries WHERE id=$1`, [id])
    return { ok: true }
  })

  // ── Manual PY for the Consolidated view of a branch entity ────────────────
  // Entity-scoped mirror of manualPY:get/set and manualPyEntries above — see
  // schema.js's entity_manual_py_entries comment for why this exists.
  ipcMain.handle('entityManualPY:get', async (_, entityId) => {
    const { rows } = await query(`SELECT consolidated_manual_py FROM entities WHERE id=$1`, [entityId])
    return !!rows[0]?.consolidated_manual_py
  })

  ipcMain.handle('entityManualPY:set', async (_, entityId, enabled) => {
    await query(`UPDATE entities SET consolidated_manual_py=$1 WHERE id=$2`, [enabled ? 1 : 0, entityId])
    return { ok: true }
  })

  ipcMain.handle('entityManualPyEntries:list', async (_, entityId) => {
    const { rows } = await query(
      `SELECT * FROM entity_manual_py_entries WHERE entity_id=$1 ORDER BY note_num, particular_label`,
      [entityId]
    )
    return rows
  })

  ipcMain.handle('entityManualPyEntries:upsert', async (_, { entityId, noteNum, noteTitle, particularLabel, py_amount, is_custom }) => {
    const label = particularLabel || ''
    const title = (noteTitle || '').trim()
    // Same title-first matching as manualPyEntries:upsert above — see there.
    if (title) {
      const { rows: existing } = await query(
        `SELECT id FROM entity_manual_py_entries WHERE entity_id=$1 AND note_title=$2 AND particular_label=$3`,
        [entityId, title, label]
      )
      if (existing[0]) {
        const r = await query(
          `UPDATE entity_manual_py_entries SET note_num=$1, py_amount=$2, is_custom=$3, updated_at=now() WHERE id=$4 RETURNING *`,
          [noteNum, parseFloat(py_amount) || 0, is_custom ? 1 : 0, existing[0].id]
        )
        return r.rows[0]
      }
    }
    // Same reassignment as manualPyEntries:upsert above — see there.
    let insertNoteNum = noteNum
    const { rows: clash } = await query(
      `SELECT id FROM entity_manual_py_entries WHERE entity_id=$1 AND note_num=$2 AND particular_label=$3`,
      [entityId, insertNoteNum, label]
    )
    if (clash[0]) {
      const { rows: [{ min }] } = await query(
        `SELECT COALESCE(MIN(note_num), 0) AS min FROM entity_manual_py_entries WHERE entity_id=$1`,
        [entityId]
      )
      insertNoteNum = Math.min(0, min) - 1
    }
    const r = await query(
      `INSERT INTO entity_manual_py_entries (entity_id, note_num, note_title, particular_label, py_amount, is_custom, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT(entity_id, note_num, particular_label) DO UPDATE SET
         note_title = EXCLUDED.note_title,
         py_amount = EXCLUDED.py_amount,
         is_custom = EXCLUDED.is_custom,
         updated_at = now()
       RETURNING *`,
      [entityId, insertNoteNum, title, label, parseFloat(py_amount) || 0, is_custom ? 1 : 0]
    )
    return r.rows[0]
  })

  ipcMain.handle('entityManualPyEntries:delete', async (_, id) => {
    await query(`DELETE FROM entity_manual_py_entries WHERE id=$1`, [id])
    return { ok: true }
  })

  // ── Manual custom face lines (see schema.js) ──────────────────────────────
  ipcMain.handle('manualFaceLines:list', async (_, tbId, section) => {
    const { rows } = await query(
      `SELECT * FROM manual_face_lines WHERE tb_id=$1 AND section=$2 ORDER BY sort_order, id`,
      [tbId, section]
    )
    return rows
  })

  ipcMain.handle('manualFaceLines:add', async (_, { tbId, section, label, cy_amount, py_amount }) => {
    const { rows: [maxRow] } = await query(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM manual_face_lines WHERE tb_id=$1 AND section=$2`,
      [tbId, section]
    )
    const r = await query(
      `INSERT INTO manual_face_lines (tb_id, section, label, cy_amount, py_amount, sort_order, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now()) RETURNING *`,
      [tbId, section, label || '', parseFloat(cy_amount) || 0, parseFloat(py_amount) || 0, maxRow.next]
    )
    return r.rows[0]
  })

  ipcMain.handle('manualFaceLines:update', async (_, { id, label, cy_amount, py_amount }) => {
    const r = await query(
      `UPDATE manual_face_lines SET label=$1, cy_amount=$2, py_amount=$3, updated_at=now()
       WHERE id=$4 RETURNING *`,
      [label || '', parseFloat(cy_amount) || 0, parseFloat(py_amount) || 0, id]
    )
    return r.rows[0]
  })

  ipcMain.handle('manualFaceLines:delete', async (_, id) => {
    await query(`DELETE FROM manual_face_lines WHERE id=$1`, [id])
    return { ok: true }
  })
}
