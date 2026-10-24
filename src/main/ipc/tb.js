import { ipcMain, app } from 'electron'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { query } from '../db/client.js'
import { parseTBExcel, generateTBTemplate } from '../services/excel.js'
import { checkTallyRunning, getTallyCompanies, listTallyCompanies, getTallyTrialBalance, getTallyLedgerMasters, parseTallyTBXml, parseTallyMasterXml, tcpPing, getTallyDataViaOdbc, getTallyStockTotals, resolveStockFigures } from '../services/tally-odbc.js'

// A locked entity_period (Auditee ↔ FY) also blocks new TB uploads against
// it — locking fully freezes the period, not just existing categorisation.
async function assertEntityPeriodUnlocked(entityPeriodId) {
  if (!entityPeriodId) return
  const { rows: [row] } = await query(`SELECT locked FROM entity_periods WHERE id=$1`, [entityPeriodId])
  if (row?.locked) throw new Error('This Financial Period is locked. Unlock it from the Master tab to upload a new Trial Balance.')
}

export function registerTBHandlers() {
  // ── List all entities ──────────────────────────────────────────────────────
  ipcMain.handle('entity:getAll', async () => {
    const { rows } = await query(`SELECT * FROM entities ORDER BY name`)
    return rows
  })

  ipcMain.handle('entity:save', async (_, e) => {
    const hasBranches = e.has_branches ? 1 : 0
    const businessType = e.business_type || null
    const address = e.address || null
    const cin = e.cin || null
    // PAN is optional; when given it must be five letters, four digits, one letter
    const pan = String(e.pan == null ? '' : e.pan).toUpperCase().replace(/\s+/g, '') || null
    if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw new Error('PAN must be 10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).')
    if (e.id) {
      const { rows } = await query(
        `UPDATE entities SET name=$1, constitution=$2, constitution_display=$3, has_branches=$4, business_type=$5, address=$6, cin=$7, pan=$8, updated_at=now()
         WHERE id=$9 RETURNING *`,
        [e.name, e.constitution, e.constitution_display, hasBranches, businessType, address, cin, pan, e.id]
      )
      return rows[0]
    } else {
      const { rows } = await query(
        `INSERT INTO entities (name, constitution, constitution_display, has_branches, business_type, address, cin, pan) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [e.name, e.constitution, e.constitution_display, hasBranches, businessType, address, cin, pan]
      )
      return rows[0]
    }
  })

  ipcMain.handle('entity:delete', async (_, entityId) => {
    await query(`DELETE FROM entities WHERE id = $1`, [entityId])
    return { ok: true }
  })

  // ── List distinct branches for an entity ──────────────────────────────────
  ipcMain.handle('tb:getBranches', async (_, entityId) => {
    const { rows } = await query(
      `SELECT id, branch_name, period, filename, row_count, entity_period_id FROM trial_balances
       WHERE entity_id=$1 ORDER BY branch_name, id`,
      [entityId]
    )
    return rows
  })

  // ── Trial Balance upload ───────────────────────────────────────────────────
  ipcMain.handle('tb:upload', async (_, { entityId, filePath, period, branchName, entityPeriodId }) => {
    await assertEntityPeriodUnlocked(entityPeriodId)
    const buffer = readFileSync(filePath)
    const tbRows = parseTBExcel(buffer)

    if (!tbRows.length) throw new Error('No data rows found in the Excel file.')

    const { rows: [tb] } = await query(
      `INSERT INTO trial_balances (entity_id, period, filename, row_count, branch_name, entity_period_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [entityId, period || '', filePath.split(/[\\/]/).pop(), tbRows.length, branchName || '', entityPeriodId || null]
    )

    // Batch insert TB rows (chunked for performance)
    const CHUNK = 200
    for (let i = 0; i < tbRows.length; i += CHUNK) {
      const chunk = tbRows.slice(i, i + CHUNK)
      const values = []
      const params = []
      chunk.forEach((r, idx) => {
        const base = idx * 21
        values.push(
          `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13},$${base+14},$${base+15},$${base+16},$${base+17},$${base+18},$${base+19},$${base+20},$${base+21})`
        )
        params.push(
          tb.id, r.period, r.branch, r.ledger_code, r.name,
          r.opening_balance, r.debit, r.credit, r.closing_balance,
          r.is_revenue, r.is_deemed_positive, r.trail_balance, r.parent,
          r.group_parent, r.group_parent_1, r.group_parent_2, r.group_parent_3,
          r.group_parent_4, r.group_parent_5, r.group_parent_6, r.group_parent_7
        )
      })
      await query(
        `INSERT INTO tb_rows (tb_id,period,branch,ledger_code,name,opening_balance,debit,credit,closing_balance,is_revenue,is_deemed_positive,trail_balance,parent,group_parent,group_parent_1,group_parent_2,group_parent_3,group_parent_4,group_parent_5,group_parent_6,group_parent_7)
         VALUES ${values.join(',')}`,
        params
      )
    }

    return { tb, rowCount: tbRows.length }
  })

  // ── Trial Balance upload (Tally dual-file format) ─────────────────────────
  // Accepts pre-parsed rows from the renderer (parseTallyTB + master join).
  // The renderer has already applied the system's sign convention via
  // buildTBRowsFromTally(), so this is just a DB persistence step.
  //
  // Opening-Stock handling (Tally only): when a ledger's name contains
  // "Opening Stock", we tag it with upload_nature='Opening Stock (Tally)'
  // so it gets:
  //   • auto-mapped to Expenses → Opening Stock (PL) → Opening Stock
  //     (so the value flows into PL "Changes in Stock in Trade")
  //   • excluded from the manual Opening Stock prompt later — total is
  //     already taken from the TB ledger value, only classification remains

  // ── ONE definition of "this row is the TB's Opening Stock" ────────────────
  // These predicates used to disagree with each other, and the disagreement
  // silently double-counted Opening Stock:
  //   * isOpeningStock() below tags ANY row containing "opening stock" (loose)
  //     as upload_nature='Opening Stock (Tally)', and auto-maps it into
  //     Opening Stock (PL).
  //   * the reconciliation guard and the Stock form's total matched only the
  //     EXACT name "Opening Stock" (strict).
  // So a client ledger called e.g. "Opening Stock A/c" was treated as opening
  // stock by the mapping engine, but was invisible to the guard — which then
  // inserted a second, reconciling 'Opening Stock (Manual)' row on top of it.
  // Both then flowed into Opening Stock (PL). Matching on the app's OWN tag as
  // well as the loose name keeps every site agreeing about the same rows.
  const OPENING_STOCK_RX = /opening\s*stock/i
  const isOpeningStockLedgerRow = (r) =>
    r?.upload_nature === 'Opening Stock (Tally)' ||
    r?.upload_nature === 'Opening Stock (Manual)' ||
    OPENING_STOCK_RX.test((r?.name || '').trim())

  ipcMain.handle('tb:uploadTally', async (_, { entityId, period, fileName, tbRows, branchName, entityPeriodId, closingStockTotal, openingStockTotal, tallyCompany, plClosedToCapital }) => {
    await assertEntityPeriodUnlocked(entityPeriodId)
    if (!Array.isArray(tbRows) || !tbRows.length) {
      throw new Error('No data rows received from Tally TB parse.')
    }

    // Same regex the shared predicate above uses — one source of truth.
    const isOpeningStock = (name) => OPENING_STOCK_RX.test(name || '')

    const { rows: [tb] } = await query(
      `INSERT INTO trial_balances (entity_id, period, filename, row_count, branch_name, entity_period_id, tally_closing_stock_total, tally_opening_stock_total, tally_company, pl_closed_to_capital)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [entityId, period || '', fileName || 'Tally_TB.xlsx', tbRows.length, branchName || '', entityPeriodId || null, closingStockTotal || null, openingStockTotal || null, tallyCompany || null, plClosedToCapital ? 1 : 0]
    )

    // Insert tb_rows and remember which row IDs are Opening Stock so we can
    // auto-map them in a second pass.
    const openingStockRowIds = []
    const CHUNK = 200
    for (let i = 0; i < tbRows.length; i += CHUNK) {
      const chunk = tbRows.slice(i, i + CHUNK)
      // Insert one-by-one to capture IDs for opening stock rows. The chunk is
      // small enough that round-trip cost is fine.
      for (const r of chunk) {
        const uploadNature = isOpeningStock(r.name) ? 'Opening Stock (Tally)' : null
        const { rows: [inserted] } = await query(
          `INSERT INTO tb_rows
            (tb_id,period,branch,ledger_code,name,opening_balance,debit,credit,closing_balance,
             is_revenue,is_deemed_positive,trail_balance,parent,group_parent,group_parent_1,
             group_parent_2,group_parent_3,group_parent_4,group_parent_5,group_parent_6,group_parent_7,
             upload_nature)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
           RETURNING id, name`,
          [
            tb.id, r.period || '', r.branch || '', r.ledger_code || '', r.name,
            r.opening_balance || 0, r.debit || 0, r.credit || 0, r.closing_balance || 0,
            r.is_revenue, r.is_deemed_positive, r.trail_balance || 0, r.parent || '',
            r.group_parent || '', r.group_parent_1 || '', r.group_parent_2 || '',
            r.group_parent_3 || '', r.group_parent_4 || '', r.group_parent_5 || '',
            r.group_parent_6 || '', r.group_parent_7 || '',
            uploadNature,
          ]
        )
        if (uploadNature === 'Opening Stock (Tally)') openingStockRowIds.push(inserted.id)
      }
    }

    // Auto-map Opening Stock rows so they flow into PL > Changes in Stock in Trade.
    if (openingStockRowIds.length > 0) {
      const { rows: [defaultRs] } = await query(
        `SELECT id FROM mapping_rule_sets WHERE is_default=TRUE LIMIT 1`
      )
      const rsId = defaultRs?.id
      if (rsId) {
        const m1 = 'Opening Stock (PL)'
        const m2 = 'Opening Stock'
        const m3 = 'Opening Stock'
        const { rows: [lfRow] } = await query(
          `SELECT id FROM level_format
             WHERE rule_set_id = $1 AND level1 = $2 AND level2 = $3 AND level3 = $4 LIMIT 1`,
          [rsId, m1, m2, m3]
        )
        const lfId = lfRow?.id || null
        for (const tbRowId of openingStockRowIds) {
          await query(
            `INSERT INTO mapped_tb
               (tb_id, tb_row_id, rule_set_id, alie,
                mapping1_resultant, mapping2_resultant, mapping3_resultant,
                level_format_id, status, confidence, mapped_at, override_note)
             VALUES ($1, $2, $3, 'Expenses', $4, $5, $6, $7,
                     'user_approved', 'high', NOW(),
                     'Auto-routed from Tally Opening Stock ledger')
             ON CONFLICT (tb_id, tb_row_id) DO NOTHING`,
            [tb.id, tbRowId, rsId, m1, m2, m3, lfId]
          )
        }
      }
    }

    return { tb, rowCount: tbRows.length, openingStockRows: openingStockRowIds.length }
  })

  // ── List TBs for an entity ─────────────────────────────────────────────────
  ipcMain.handle('tb:list', async (_, entityId) => {
    const { rows } = await query(
      `SELECT * FROM trial_balances WHERE entity_id=$1 ORDER BY uploaded_at DESC`,
      [entityId]
    )
    return rows
  })

  // ── List TBs for a specific Auditee↔FY (entity_period) ────────────────────
  // Drives the Financial Year badge: exactly one match auto-loads as
  // activeTB, zero prompts to upload, more than one prompts the user to
  // pick — see App.jsx's resolveTBForPeriod.
  ipcMain.handle('tb:listByEntityPeriod', async (_, entityPeriodId) => {
    if (!entityPeriodId) return []
    const { rows } = await query(
      `SELECT * FROM trial_balances WHERE entity_period_id=$1 ORDER BY uploaded_at DESC`,
      [entityPeriodId]
    )
    return rows
  })

  // ── Get rows for a TB ──────────────────────────────────────────────────────
  // The Trial Balance as it was uploaded: closing_balance here is the IMPORTED
  // figure. Adjustments typed on the Mapped TB (adj_debit / adj_credit) revise the
  // closing balance everywhere else; the revised figure rides along beside it.
  ipcMain.handle('tb:rows', async (_, tbId) => {
    const { rows } = await query(
      `SELECT * FROM tb_rows WHERE tb_id=$1 ORDER BY id`,
      [tbId]
    )
    return rows.map(r => ({
      ...r,
      closing_balance: r.imported_closing_balance ?? r.closing_balance,
      revised_closing_balance: r.closing_balance,
    }))
  })

  // ── Download blank TB template ─────────────────────────────────────────────
  ipcMain.handle('tb:template', async () => {
    const buffer = generateTBTemplate()
    return Array.from(buffer)  // transfer as array over IPC
  })

  // ── Delete a trial balance (cascades to tb_rows + mapped_tb) ─────────────
  ipcMain.handle('tb:delete', async (_, tbId) => {
    // entity_periods.prev_tb_id has no ON DELETE clause, so any Auditee↔FY
    // that had this TB set as its comparative Previous Year TB would block
    // the delete with a FK violation — clear those references first.
    await query(`UPDATE entity_periods SET prev_tb_id = NULL WHERE prev_tb_id = $1`, [tbId])
    await query(`DELETE FROM trial_balances WHERE id = $1`, [tbId])
    return { ok: true }
  })

  // ── Save Opening/Closing Stock entries ────────────────────────────────────
  ipcMain.handle('tb:saveStock', async (_, { tbId, stockData }) => {
    // Get the TB's entity and rule_set_id for mapping inserts
    const { rows: [tbInfo] } = await query(
      `SELECT tb.id, e.constitution,
              (SELECT id FROM mapping_rule_sets WHERE is_default=TRUE LIMIT 1) as rule_set_id
       FROM trial_balances tb JOIN entities e ON e.id = tb.entity_id WHERE tb.id = $1`,
      [tbId]
    )
    const rsId = tbInfo?.rule_set_id

    // The Other-expenses head each of Stores & Spares / Loose Tools / Others is adjusted in (0.1.93), kept on the stock rows themselves
    // (tb_rows.stock_head - not mapped_tb, which a re-run of mapping rebuilds). `stockData.heads` is { category: head } as the Stock form
    // sends it. A caller that sends none (the Fill Details Excel upload) leaves the heads this Trial Balance already has exactly as they
    // are: they are read here, before the old stock rows go, and written onto the new ones.
    const HEAD_CATEGORIES = new Set(['Stores & Spares', 'Loose Tools', 'Others'])
    const cleanHead = (h) => String(h == null ? '' : h).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
    const stockCategoryOf = (name) => {
      const m = /^(?:PY\s+)?(?:Opening Stock|Closing Stock(?:\s*-\s*(?:PL|BS))?)\s*-\s*(.+)$/i.exec(String(name || '').trim())
      return m ? m[1].trim() : ''
    }
    const { rows: keptHeadRows } = await query(
      `SELECT name, stock_head FROM tb_rows
       WHERE tb_id = $1 AND upload_nature IN ('Stock Entry', 'Stock Entry PY') AND stock_head IS NOT NULL AND stock_head <> ''
       ORDER BY id`,
      [tbId]
    )
    const keptHeads = {}
    for (const r of keptHeadRows) {
      const c = stockCategoryOf(r.name)
      if (c && !keptHeads[c]) keptHeads[c] = cleanHead(r.stock_head)
    }
    const givenHeads = {}
    for (const [c, h] of Object.entries((stockData && stockData.heads) || {})) {
      if (HEAD_CATEGORIES.has(c) && cleanHead(h)) givenHeads[c] = cleanHead(h)
    }
    const headFor = (category) => (HEAD_CATEGORIES.has(category) ? (givenHeads[category] || keptHeads[category] || null) : null)

    // Delete existing stock rows (cascade deletes mapped_tb entries).
    // 'Stock Entry PY' rows are the manually-typed Previous Year figures kept
    // on this SAME TB when there's no separate comparative TB to pull PY from
    // — plain disclosure data for the Stock form only, never mapped/routed
    // into the PL or BS (no mapped_tb entry is ever created for them).
    // 'Opening Stock (Manual)' is the single reconciling ledger row (see
    // below) that gets replaced on every save, same as the others.
    await query(
      `DELETE FROM tb_rows WHERE tb_id = $1 AND upload_nature IN ('Stock Entry', 'Stock Entry PY', 'Opening Stock (Manual)')`,
      [tbId]
    )

    // Raw litmus, computed with the manual reconciling row already gone —
    // this is the TRUE uploaded-TB imbalance, independent of any previous
    // save's reconciliation attempt. Mirrors tb:getOpeningStockCheck's own
    // exclusion rule (Stock Entry / Stock Entry PY are never in the TB by
    // this point anyway, since they were just deleted above).
    const { rows: rawRows } = await query(
      `SELECT name, opening_balance FROM tb_rows
       WHERE tb_id = $1 AND (upload_nature IS NULL OR upload_nature NOT IN ('Stock Entry', 'Stock Entry PY'))`,
      [tbId]
    )
    const rawLitmus = rawRows.reduce((s, r) => s + (parseFloat(r.opening_balance) || 0), 0)

    // Does the TB ALREADY carry an "Opening Stock" ledger of its own? Our own
    // reconciling row has just been deleted above, so anything matching here
    // is genuine — either a real ledger from the client's books, or the
    // synthetic one UploadTB.jsx embeds at Tally-import time from the
    // resolved stock figure.
    //
    // This check has to be explicit. The reconciliation below used to rely on
    // `!rawIsBalanced` alone as a proxy, reasoning that a TB which already has
    // Opening Stock must balance and so would be skipped. That is false
    // whenever the TB is out of balance for some OTHER reason — a genuinely
    // missing entry, a rounding break, a partial upload — which is common.
    // In that case a second "Opening Stock" row was inserted alongside the
    // existing one and tb:getOpeningStockCheck, which sums every row named
    // "Opening Stock", reported exactly twice the real figure: entering
    // 42,75,620 made "Total as per Trial Balance" read 85,51,240.
    const hasGenuineOpeningStockLedger = rawRows.some(
      r => r.upload_nature !== 'Opening Stock (Manual)' && isOpeningStockLedgerRow(r)
    )

    const opening = stockData.opening || {}
    const closing = stockData.closing || {}
    const allTypes = new Set([...Object.keys(opening), ...Object.keys(closing)])

    // [name, ob, cb, is_deemed_positive, alie, m1, m2, m3, category]
    // `category` (the exact Stock-form type — Raw Materials / Work in Progress /
    // Finished Goods / Stock-in-Trade / Stores & Spares / Loose Tools / Others /
    // Uncategorised Stock) is stored as mapped_tb.level5_value so
    // utils/inventorySplit.js can route each category to the right PL/BS
    // treatment (Cost of Materials Consumed / Changes in Inventories / Other
    // Expenses / Inventories note) without relying on manual Categorisation.
    const rows = []
    // Opening Stock — Expense (Debit nature, is_deemed_positive=true, stored negative)
    for (const [type, value] of Object.entries(opening)) {
      const v = parseFloat(value)
      if (!v || v === 0) continue
      rows.push([`Opening Stock - ${type}`, v * -1, v * -1, true,
                 'Expenses', 'Opening Stock (PL)', 'Opening Stock', 'Opening Stock', type])
    }
    // Closing Stock - PL: Income (Credit nature) — only when there's an
    // actual closing value (this is the P&L income-side contra entry).
    for (const [type, value] of Object.entries(closing)) {
      const v = parseFloat(value)
      if (!v || v === 0) continue
      rows.push([`Closing Stock - PL - ${type}`, 0, v, false,
                 'Income', 'Closing Stock (PL)', 'Closing Stock', 'Closing Stock', type])
    }
    // Closing Stock - BS: Asset (Debit nature, stored negative) — one row per
    // category that has EITHER an opening or a closing value, so the BS
    // Inventories note can show a category even when only one of the two
    // years has a figure (never when both are zero). Opening balance carries
    // the SAME category's Opening Stock value (this year's opening = last
    // year's closing) so the note's Previous Year column reads correctly
    // straight off this one row.
    for (const type of allTypes) {
      const openV  = parseFloat(opening[type]) || 0
      const closeV = parseFloat(closing[type]) || 0
      if (!openV && !closeV) continue
      rows.push([`Closing Stock - BS - ${type}`, openV * -1, closeV * -1, true,
                 'ASSETS', 'Current assets', 'Inventories', 'Closing Stock (BS)', type])
    }

    // Insert tb_rows and corresponding mapped_tb entries
    for (const [name, ob, cb, deemed, alie, m1, m2, m3, category] of rows) {
      const { rows: [tbRow] } = await query(
        `INSERT INTO tb_rows (tb_id, name, opening_balance, closing_balance, upload_nature, is_deemed_positive, stock_head)
         VALUES ($1, $2, $3, $4, 'Stock Entry', $5, $6) RETURNING id`,
        [tbId, name, ob, cb, deemed, headFor(category)]
      )

      // Find matching LevelFormat row
      let lfId = null
      if (rsId) {
        const { rows: [lfRow] } = await query(
          `SELECT id FROM level_format
           WHERE rule_set_id = $1 AND level1 = $2 AND level2 = $3 AND level3 = $4 LIMIT 1`,
          [rsId, m1, m2, m3]
        )
        if (lfRow) lfId = lfRow.id
      }

      // Insert mapped_tb entry so it shows in Mapped TB
      if (rsId) {
        await query(
          `INSERT INTO mapped_tb
             (tb_id, tb_row_id, rule_set_id, alie,
              mapping1_resultant, mapping2_resultant, mapping3_resultant,
              level5_value, level_format_id, status, confidence, mapped_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'user_approved', 'high', NOW())
           ON CONFLICT (tb_id, tb_row_id) DO NOTHING`,
          [tbId, tbRow.id, rsId, alie, m1, m2, m3, category, lfId]
        )
      }
    }

    // Opening Stock reconciliation (CA's point 3): if the raw uploaded TB
    // doesn't balance (Dr ≠ Cr once the source ledgers are summed) and no
    // genuine "Opening Stock" ledger already exists in it (e.g. from Tally's
    // own books or a literal Excel upload — that case nets rawLitmus to ~0
    // already and is left alone), the missing amount is almost certainly the
    // omitted Opening Stock. Push the user's bifurcated total back into the
    // TB as a single ledger row named "Opening Stock" so the TB's own
    // opening balance reconciles going forward, same as it would if Tally
    // had exported that ledger itself. If the entered total doesn't fully
    // explain the gap, save anyway and report the residual — the caller
    // shows a persistent warning banner rather than blocking the save.
    const totOpeningStock = Object.values(opening).reduce((s, v) => s + (parseFloat(v) || 0), 0)
    const rawIsBalanced = Math.abs(rawLitmus) < 1
    let reconciliation = { attempted: false, insertedOpeningStock: false, residual: null }
    if (!rawIsBalanced && totOpeningStock > 0 && !hasGenuineOpeningStockLedger) {
      const ob = totOpeningStock * -1  // Dr/asset convention — stored negative
      const { rows: [reconRow] } = await query(
        `INSERT INTO tb_rows (tb_id, name, opening_balance, closing_balance, upload_nature, is_deemed_positive)
         VALUES ($1, 'Opening Stock', $2, $2, 'Opening Stock (Manual)', true) RETURNING id`,
        [tbId, ob]
      )
      if (rsId) {
        const m1 = 'Opening Stock (PL)', m2 = 'Opening Stock', m3 = 'Opening Stock'
        const { rows: [lfRow] } = await query(
          `SELECT id FROM level_format WHERE rule_set_id = $1 AND level1 = $2 AND level2 = $3 AND level3 = $4 LIMIT 1`,
          [rsId, m1, m2, m3]
        )
        await query(
          `INSERT INTO mapped_tb
             (tb_id, tb_row_id, rule_set_id, alie,
              mapping1_resultant, mapping2_resultant, mapping3_resultant,
              level_format_id, status, confidence, mapped_at, override_note)
           VALUES ($1, $2, $3, 'Expenses', $4, $5, $6, $7,
                   'user_approved', 'high', NOW(),
                   'Auto-routed: Opening Stock manually reconciled from Stock form')
           ON CONFLICT (tb_id, tb_row_id) DO NOTHING`,
          [tbId, reconRow.id, rsId, m1, m2, m3, lfRow?.id || null]
        )
      }
      reconciliation = { attempted: true, insertedOpeningStock: true, residual: rawLitmus - totOpeningStock }
    }

    // Manually-typed Previous Year figures (only used when no separate PY TB
    // is selected) — plain tb_rows, no mapped_tb entry, purely for the Stock
    // form's own PY columns and reconciliation.
    const pyOpening = stockData.pyOpening || {}
    const pyClosing = stockData.pyClosing || {}
    for (const [type, value] of Object.entries(pyOpening)) {
      const v = parseFloat(value)
      if (!v || v === 0) continue
      await query(
        `INSERT INTO tb_rows (tb_id, name, opening_balance, closing_balance, upload_nature, is_deemed_positive, stock_head)
         VALUES ($1, $2, 0, $3, 'Stock Entry PY', true, $4)`,
        [tbId, `PY Opening Stock - ${type}`, v * -1, headFor(type)]
      )
    }
    for (const [type, value] of Object.entries(pyClosing)) {
      const v = parseFloat(value)
      if (!v || v === 0) continue
      await query(
        `INSERT INTO tb_rows (tb_id, name, opening_balance, closing_balance, upload_nature, is_deemed_positive, stock_head)
         VALUES ($1, $2, 0, $3, 'Stock Entry PY', true, $4)`,
        [tbId, `PY Closing Stock - ${type}`, v * -1, headFor(type)]
      )
    }

    // Update row_count
    const { rows: [countRow] } = await query(`SELECT COUNT(*) as cnt FROM tb_rows WHERE tb_id = $1`, [tbId])
    await query(`UPDATE trial_balances SET row_count = $1 WHERE id = $2`, [parseInt(countRow.cnt), tbId])

    return { inserted: rows.length, reconciliation }
  })

  // ── Real Books / Zoho Books Format upload ─────────────────────────────────
  // Accepts pre-parsed rows from the renderer (parseRealBooksTB + master join, or
  // parseZohoTB + buildTBRowsFromZoho). No Opening Stock auto-routing — the
  // mapping engine handles it via hierarchy. Both formats hand over rows already
  // in the system's sign convention (Dr negative / Cr positive); this is only the
  // DB persistence step, one plain INSERT creating a NEW tb_id like every upload.
  const persistPreparedTB = async ({ entityId, period, fileName, tbRows, branchName, entityPeriodId, uploadNature, formatLabel, defaultFileName }) => {
    await assertEntityPeriodUnlocked(entityPeriodId)
    if (!Array.isArray(tbRows) || !tbRows.length) {
      throw new Error(`No data rows received from ${formatLabel} TB parse.`)
    }

    const { rows: [tb] } = await query(
      `INSERT INTO trial_balances (entity_id, period, filename, row_count, branch_name, entity_period_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [entityId, period || '', fileName || defaultFileName, tbRows.length, branchName || '', entityPeriodId || null]
    )

    const CHUNK = 200
    for (let i = 0; i < tbRows.length; i += CHUNK) {
      const chunk = tbRows.slice(i, i + CHUNK)
      for (const r of chunk) {
        await query(
          `INSERT INTO tb_rows
            (tb_id,period,branch,ledger_code,name,opening_balance,debit,credit,closing_balance,
             is_revenue,is_deemed_positive,trail_balance,parent,group_parent,group_parent_1,
             group_parent_2,group_parent_3,group_parent_4,group_parent_5,group_parent_6,group_parent_7,
             trial_balance_type,upload_nature)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
          [
            tb.id, r.period || '', r.branch || '', r.ledger_code || '', r.name,
            r.opening_balance || 0, r.debit || 0, r.credit || 0, r.closing_balance || 0,
            r.is_revenue ?? null, r.is_deemed_positive ?? null, r.trail_balance || 0,
            r.parent || '', r.group_parent || '', r.group_parent_1 || '',
            r.group_parent_2 || '', r.group_parent_3 || '', r.group_parent_4 || '',
            r.group_parent_5 || '', r.group_parent_6 || '', r.group_parent_7 || '',
            r.trial_balance_type || null, uploadNature,
          ]
        )
      }
    }

    return { tb, rowCount: tbRows.length }
  }

  ipcMain.handle('tb:uploadRealBooks', (_, args) => persistPreparedTB({
    ...args, uploadNature: 'Real Books Format', formatLabel: 'Real Books', defaultFileName: 'RealBooks_TB.xlsx',
  }))

  ipcMain.handle('tb:uploadZoho', (_, args) => persistPreparedTB({
    ...args, uploadNature: 'Zoho Format', formatLabel: 'Zoho', defaultFileName: 'Zoho_TB.xlsx',
  }))

  ipcMain.handle('tb:uploadBusy', (_, args) => persistPreparedTB({
    ...args, uploadNature: 'Busy Format', formatLabel: 'Busy', defaultFileName: 'Busy_TB.xlsx',
  }))

  // ── Get existing stock rows ───────────────────────────────────────────────
  ipcMain.handle('tb:getStockRows', async (_, tbId) => {
    const { rows } = await query(
      `SELECT id, name, opening_balance, closing_balance, stock_head FROM tb_rows
       WHERE tb_id = $1 AND upload_nature IN ('Stock Entry', 'Stock Entry PY') ORDER BY id`,
      [tbId]
    )
    return rows
  })

  // ── The Other-expenses heads the Stock tab offers for Stores & Spares / Loose Tools / Others ──
  // inTB: the lines of the Other expenses note this Trial Balance already has (Level 2 captions, with the expense each carries; the stock
  // rows themselves are left out). standard: the Other-expenses captions of the mapping the Trial Balance was mapped with, in the Level
  // Format's own order. Two small aggregate queries - never the ledgers themselves.
  ipcMain.handle('tb:getOtherExpenseHeads', async (_, tbId) => {
    // Nothing selected, or the Consolidated view (its "Trial Balance" is not a row of the database): nothing to offer.
    if (!tbId || !Number.isInteger(Number(tbId))) return { inTB: [], standard: [] }
    const { rows: [tbInfo] } = await query(
      `SELECT e.constitution FROM trial_balances tb JOIN entities e ON e.id = tb.entity_id WHERE tb.id = $1`, [tbId])
    const { rows: [mapped] } = await query(
      `SELECT rule_set_id FROM mapped_tb WHERE tb_id = $1 AND rule_set_id IS NOT NULL LIMIT 1`, [tbId])
    let ruleSetId = mapped?.rule_set_id
    if (!ruleSetId) {
      const { rows: [d] } = await query(`SELECT id FROM mapping_rule_sets WHERE is_default = TRUE LIMIT 1`)
      ruleSetId = d?.id
    }
    const { rows: inTB } = await query(
      `SELECT COALESCE(lf.level2, mt.mapping2_resultant) AS name, SUM(tr.closing_balance) AS total
         FROM mapped_tb mt
         JOIN tb_rows tr ON tr.id = mt.tb_row_id
         LEFT JOIN level_format lf ON lf.id = mt.level_format_id
        WHERE mt.tb_id = $1
          AND mt.status IN ('auto_high', 'auto_medium', 'auto_low', 'user_approved', 'user_override')
          AND lower(btrim(COALESCE(lf.level1, mt.mapping1_resultant, ''))) = 'other expenses'
          AND btrim(COALESCE(lf.level2, mt.mapping2_resultant, '')) <> ''
          AND COALESCE(lf.level2, mt.mapping2_resultant) !~* 'uncategori[sz]ed'
          AND (tr.upload_nature IS NULL OR tr.upload_nature NOT IN ('Stock Entry', 'Stock Entry PY', 'Opening Stock (Manual)'))
        GROUP BY 1
        ORDER BY MIN(lf.sort_order) NULLS LAST, 1`,
      [tbId]
    )
    let standard = []
    if (ruleSetId && tbInfo && tbInfo.constitution != null) {
      const r = await query(
        `SELECT level2 AS name FROM level_format
          WHERE rule_set_id = $1 AND constitution = $2 AND lower(btrim(level1)) = 'other expenses'
            AND level2 IS NOT NULL AND btrim(level2) <> '' AND level2 !~* 'uncategori[sz]ed'
          GROUP BY level2 ORDER BY MIN(sort_order), level2`,
        [ruleSetId, tbInfo.constitution]
      )
      standard = r.rows.map(x => x.name)
    }
    // Expenses are stored as debits (negative): the figure offered is the expense itself, positive.
    return { inTB: inTB.map(r => ({ name: r.name, total: -(parseFloat(r.total) || 0) })), standard }
  })

  // ── Opening/Closing Stock litmus test ──────────────────────────────────────
  // Per the CA's rule: sum the TB's own Opening Balance column (excluding our
  // own Stock Entry rows). If it nets to ~zero (Dr = Cr), Opening Stock is
  // presumed to already be embedded in the TB as a real ledger — found by
  // matching a ledger literally named "Opening Stock" (same for Closing,
  // though that almost never appears in an uploaded TB). Its value is what
  // the Stock form's "Total as per Trial Balance" reconciliation column
  // should show, auto-computed rather than typed in.
  ipcMain.handle('tb:getOpeningStockCheck', async (_, tbId) => {
    if (!tbId) return null
    const { rows } = await query(
      `SELECT id, name, opening_balance, closing_balance, is_deemed_positive, upload_nature FROM tb_rows
       WHERE tb_id = $1 AND (upload_nature IS NULL OR upload_nature NOT IN ('Stock Entry', 'Stock Entry PY'))`,
      [tbId]
    )
    const litmusTotal = rows.reduce((s, r) => s + (parseFloat(r.opening_balance) || 0), 0)
    const displayVal = (r) => {
      const closeBal = parseFloat(r.closing_balance) || 0
      const openBal = parseFloat(r.opening_balance) || 0
      const raw = closeBal !== 0 ? closeBal : openBal
      return r.is_deemed_positive ? -raw : raw
    }
    const matchByName = (rx) => rows.filter(r => rx.test((r.name || '').trim()))
    // Never count a genuine "Opening Stock" ledger AND our own reconciling
    // copy of it — that reads as exactly double the real figure. The
    // reconciling row is a stand-in for a missing ledger, so it only counts
    // when no genuine one exists. saveStockEntries no longer creates that
    // situation, but TBs saved by an earlier build still carry both rows, and
    // they must display correctly without needing to be re-saved first.
    const allOpeningRows = rows.filter(isOpeningStockLedgerRow)
    const genuineOpeningRows = allOpeningRows.filter(r => r.upload_nature !== 'Opening Stock (Manual)')
    const openingRows = genuineOpeningRows.length ? genuineOpeningRows : allOpeningRows
    const closingRows = matchByName(/^closing stock$/i)

    // Was this "Opening Stock" ledger contributed by us (Stock form
    // reconciliation) rather than genuinely present in the source TB?
    // Distinguishes "never entered yet" from "entered, but still doesn't
    // fully reconcile" for the UI's warning banner.
    const { rows: [manualRow] } = await query(
      `SELECT id FROM tb_rows WHERE tb_id = $1 AND upload_nature = 'Opening Stock (Manual)' LIMIT 1`,
      [tbId]
    )

    // Closing Stock essentially never appears as a real TB ledger (Tally
    // computes it internally) — fall back to the aggregate figure pulled
    // straight from Tally's Stock Items at import time (see
    // getTallyStockTotals / tb:uploadTally), when no literal ledger match
    // exists and this TB actually came from a Tally ODBC import.
    const { rows: [tbRow] } = await query(
      `SELECT tally_closing_stock_total, tally_opening_stock_total FROM trial_balances WHERE id = $1`,
      [tbId]
    )
    const tallyClosingStockTotal = tbRow?.tally_closing_stock_total
    const tallyOpeningStockTotal = tbRow?.tally_opening_stock_total
    const embeddedClosingFromLedger = closingRows.reduce((s, r) => s + displayVal(r), 0)
    const embeddedClosing = closingRows.length > 0
      ? embeddedClosingFromLedger
      : (tallyClosingStockTotal != null ? parseFloat(tallyClosingStockTotal) : embeddedClosingFromLedger)

    // Opening Stock gets the same fallback as Closing above. A Tally TB that
    // already balances carries no Opening Stock ledger and no longer has one
    // injected, so without this the form's "Total as per Trial Balance" would
    // read 0.00 and show the CA's correctly-entered figure as a large red
    // difference. The figure resolved from Tally at import time is the right
    // reference to reconcile against, exactly as it is for Closing.
    const embeddedOpeningFromLedger = openingRows.reduce((s, r) => s + displayVal(r), 0)
    const embeddedOpening = openingRows.length > 0
      ? embeddedOpeningFromLedger
      : (tallyOpeningStockTotal != null ? parseFloat(tallyOpeningStockTotal) : embeddedOpeningFromLedger)

    return {
      litmusTotal,
      isBalanced: Math.abs(litmusTotal) < 1,
      hasManualOpeningStock: !!manualRow,
      embeddedOpening,
      embeddedClosing,
      embeddedClosingFromTally: closingRows.length === 0 && tallyClosingStockTotal != null,
      embeddedOpeningFromTally: openingRows.length === 0 && tallyOpeningStockTotal != null,
      embeddedOpeningRows: openingRows.map(r => ({ id: r.id, name: r.name })),
      embeddedClosingRows: closingRows.map(r => ({ id: r.id, name: r.name })),
    }
  })

  // ── Insert a manual row ───────────────────────────────────────────────────
  ipcMain.handle('tb:insertManualRow', async (_, { tbId, rowData }) => {
    const { rows: [newRow] } = await query(
      `INSERT INTO tb_rows (tb_id, period, branch, ledger_code, name,
       opening_balance, debit, credit, closing_balance, upload_nature)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Manually Inserted')
       RETURNING *`,
      [tbId, rowData.period || '', rowData.branch || '', rowData.ledger_code || '',
       rowData.name, rowData.opening_balance || 0, rowData.debit || 0,
       rowData.credit || 0, rowData.closing_balance || 0]
    )
    // Update row_count
    const { rows: [countRow] } = await query(`SELECT COUNT(*) as cnt FROM tb_rows WHERE tb_id = $1`, [tbId])
    await query(`UPDATE trial_balances SET row_count = $1 WHERE id = $2`, [parseInt(countRow.cnt), tbId])
    return newRow
  })

  // ── Delete a single TB row (e.g. a stray manually-entered ledger) ─────────
  ipcMain.handle('tb:deleteRow', async (_, { tbId, rowId }) => {
    await query(`DELETE FROM tb_rows WHERE id = $1 AND tb_id = $2`, [rowId, tbId])
    const { rows: [countRow] } = await query(`SELECT COUNT(*) as cnt FROM tb_rows WHERE tb_id = $1`, [tbId])
    await query(`UPDATE trial_balances SET row_count = $1 WHERE id = $2`, [parseInt(countRow.cnt), tbId])
    return { ok: true }
  })

  // ── Get unique ledgers in a TB with their existing mappings ───────────────
  ipcMain.handle('tb:getLedgersForTB', async (_, tbId) => {
    // SQLite: use ROW_NUMBER() instead of DISTINCT ON
    const { rows } = await query(
      `SELECT name, mapping1_resultant, mapping2_resultant, mapping3_resultant,
              alie, level_format_id, is_deemed_positive
       FROM (
         SELECT tr.name,
                mt.mapping1_resultant, mt.mapping2_resultant, mt.mapping3_resultant,
                mt.alie, mt.level_format_id, tr.is_deemed_positive,
                ROW_NUMBER() OVER (PARTITION BY tr.name ORDER BY mt.id DESC NULLS LAST) AS rn
         FROM tb_rows tr
         LEFT JOIN mapped_tb mt ON mt.tb_row_id = tr.id
         WHERE tr.tb_id = $1 AND tr.name IS NOT NULL
       ) sub
       WHERE rn = 1
       ORDER BY name`,
      [tbId]
    )
    return rows
  })

  // ── Save Journal Entry (multiple Dr/Cr rows, must balance) ────────────────
  ipcMain.handle('tb:saveJournalEntry', async (_, { tbId, date, entries }) => {
    // Validate balance
    const totalDr = entries.filter(e => e.type === 'Dr').reduce((s, e) => s + parseFloat(e.amount), 0)
    const totalCr = entries.filter(e => e.type === 'Cr').reduce((s, e) => s + parseFloat(e.amount), 0)
    if (Math.abs(totalDr - totalCr) > 0.01) {
      throw new Error(`Journal entry not balanced: Dr ${totalDr} vs Cr ${totalCr}`)
    }

    // Get TB / entity / rule_set info for mapping inserts
    const { rows: [tbInfo] } = await query(
      `SELECT tb.id, e.constitution,
              (SELECT id FROM mapping_rule_sets WHERE is_default=TRUE LIMIT 1) AS rule_set_id
       FROM trial_balances tb JOIN entities e ON e.id = tb.entity_id WHERE tb.id = $1`,
      [tbId]
    )
    const rsId = tbInfo?.rule_set_id
    const constitution = tbInfo?.constitution

    for (const e of entries) {
      const amt = parseFloat(e.amount)
      // Dr → negative closing_balance, is_deemed_positive=true
      // Cr → positive closing_balance, is_deemed_positive=false
      const closingBalance = e.type === 'Dr' ? amt * -1 : amt
      const isDeemedPositive = e.type === 'Dr'

      // Insert tb_rows entry
      const { rows: [tbRow] } = await query(
        `INSERT INTO tb_rows (tb_id, period, name, opening_balance, closing_balance,
                              is_deemed_positive, upload_nature)
         VALUES ($1, $2, $3, 0, $4, $5, 'Journal Passed Manually')
         RETURNING id`,
        [tbId, date || '', e.ledgerName, closingBalance, isDeemedPositive]
      )

      // Determine mapping: existing ledger or provided new mapping
      let m1 = e.mapping1
      let m2 = e.mapping2
      let m3 = e.mapping3
      let alie = null

      if (!e.isNew) {
        // Try to find existing mapping for a ledger with same name in this TB
        const { rows: [existing] } = await query(
          `SELECT mt.mapping1_resultant, mt.mapping2_resultant, mt.mapping3_resultant,
                  mt.alie, mt.level_format_id
           FROM mapped_tb mt
           JOIN tb_rows tr ON tr.id = mt.tb_row_id
           WHERE tr.tb_id = $1 AND tr.name = $2 AND mt.mapping1_resultant IS NOT NULL
           ORDER BY mt.id DESC LIMIT 1`,
          [tbId, e.ledgerName]
        )
        if (existing) {
          m1 = m1 || existing.mapping1_resultant
          m2 = m2 || existing.mapping2_resultant
          m3 = m3 || existing.mapping3_resultant
          alie = existing.alie
        }
      }

      // Derive ALIE from LevelFormat if not set
      if (!alie && m1 && rsId) {
        const { rows: [lfRow] } = await query(
          `SELECT alie FROM level_format
           WHERE rule_set_id = $1 AND level1 = $2 AND alie IS NOT NULL LIMIT 1`,
          [rsId, m1]
        )
        if (lfRow) alie = lfRow.alie
      }

      // Find level_format_id
      let lfId = null
      if (rsId && m1 && m2) {
        const { rows: [lfRow] } = await query(
          `SELECT id FROM level_format
           WHERE rule_set_id = $1 AND level1 = $2 AND level2 = $3
             ${m3 ? 'AND (level3 = $4 OR $4 = ANY(ARRAY(SELECT btrim(x) FROM unnest(string_to_array(level3, \'/\')) x)))' : ''}
           LIMIT 1`,
          m3 ? [rsId, m1, m2, m3] : [rsId, m1, m2]
        )
        if (lfRow) lfId = lfRow.id
      }

      // Insert mapped_tb entry
      if (rsId && m1) {
        await query(
          `INSERT INTO mapped_tb
             (tb_id, tb_row_id, rule_set_id, alie,
              mapping1_resultant, mapping2_resultant, mapping3_resultant,
              level_format_id, status, confidence, mapped_at, override_note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'user_approved', 'high', NOW(), $9)
           ON CONFLICT (tb_id, tb_row_id) DO NOTHING`,
          [tbId, tbRow.id, rsId, alie, m1, m2, m3, lfId, `Journal Entry dated ${date || 'N/A'}`]
        )
      }
    }

    // Update row_count
    const { rows: [countRow] } = await query(`SELECT COUNT(*) as cnt FROM tb_rows WHERE tb_id = $1`, [tbId])
    await query(`UPDATE trial_balances SET row_count = $1 WHERE id = $2`, [parseInt(countRow.cnt), tbId])

    return { inserted: entries.length }
  })

  // ── Tally Auto-Import (HTTP XML) ───────────────────────────────────────────
  function loadTallyConfig() {
    try {
      const p = join(app.getPath('userData'), 'tally-config.json')
      if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'))
    } catch (_) {}
    return { host: 'localhost', port: 9000 }
  }

  ipcMain.handle('tally:check', async (_, cfg) => {
    const { host, port } = cfg || loadTallyConfig()
    return checkTallyRunning(host, port)
  })

  ipcMain.handle('tally:tcpPing', async (_, cfg) => {
    const { host, port } = cfg || loadTallyConfig()
    return tcpPing(host, port)
  })

  ipcMain.handle('tally:companies', async (_, cfg) => {
    const { host, port } = cfg || loadTallyConfig()
    return getTallyCompanies(host, port)
  })

  // Every company Tally currently has loaded — the import screen needs the
  // full list, not just the first, so the user can say which branch they are
  // importing when several are open at once.
  ipcMain.handle('tally:listCompanies', async (_, cfg) => {
    const { host, port } = cfg || loadTallyConfig()
    return listTallyCompanies(host, port)
  })

  ipcMain.handle('tally:fetchTB', async (_, { host, port, keepPLLedger, company: chosenCompany, multipleCompanies = false } = {}) => {
    const cfg = loadTallyConfig()
    const h = host || cfg.host
    const p = port || cfg.port
    let httpErr = null
    try {
      // Resolve WHICH company we are importing, ONCE, and pin every subsequent
      // request to it. Tally can hold several companies open at the same time,
      // and a request that does not name one resolves against whatever Tally
      // considers current — not necessarily the SAME one for every request
      // type. That is how a branch import ended up with Branch 2's ledgers but
      // Branch 1's stock figures: the Ledger collection followed the selected
      // company while the StockItem collection answered from another. Pinning
      // removes the ambiguity instead of hoping the two agree.
      //
      // If the name cannot be read, company stays null and every request
      // behaves exactly as it did before — degraded, never worse.
      // The company to import is CHOSEN by the user when more than one is
      // loaded (see the import screen). Auto-detection is only a fallback for
      // the single-company case — with several loaded it picks whichever Tally
      // lists first, which is precisely how Branch 2's import ended up taking
      // Branch 1's stock.
      let company = chosenCompany || null
      if (!company) {
        try { company = (await getTallyCompanies(h, p))[0] || null } catch (_) {}
      }

      const [tbXml, masterXml] = await Promise.all([
        getTallyTrialBalance(h, p, company),
        getTallyLedgerMasters(h, p, company),
      ])

      // Debug dump — sign conventions have been wrong twice now from blind
      // XML-parsing guesses. Always save the exact raw response so it can be
      // inspected against real ledger figures instead of guessed at again.
      try {
        const dir = join(app.getPath('userData'), 'tally-debug')
        mkdirSync(dir, { recursive: true })
        const stamp = Date.now()
        writeFileSync(join(dir, `tb-raw-${stamp}.xml`), tbXml, 'utf8')
        writeFileSync(join(dir, `master-raw-${stamp}.xml`), masterXml, 'utf8')
      } catch { /* best-effort debug dump */ }

      const tbRows = parseTallyTBXml(tbXml, keepPLLedger)
      const masterData = parseTallyMasterXml(masterXml)
      // HTTP call can resolve with a response that superficially looks right
      // (e.g. an empty <LEDGER> collection) but parses to zero rows — that's
      // not a thrown error, so fall through to the ODBC path below instead
      // of returning an empty result.
      if (tbRows.length > 0) {
        // Opening/Closing Stock, resolved across all three sources Tally can
        // report them from (its own P&L first, then a manually-entered
        // Stock-in-Hand ledger, then item-level inventory valuation). Reading
        // only the Inventory Register — the old behaviour — silently produced
        // the wrong figure for every client who sets F11 "Integrate Accounts
        // and Inventory" to No and types the stock value in by hand.
        // Best-effort throughout; never blocks the import.
        const stockTotals = await resolveStockFigures(h, p, company)
        return { tbRows, masterData, rawTBXml: tbXml.substring(0, 500), source: 'http_xml', stockTotals, company }
      }
      httpErr = new Error(`HTTP XML export returned 0 ledger rows (${tbXml.substring(0, 180)})`)
    } catch (err) {
      httpErr = err
    }
    // The ODBC fallback below reads Tally's ODBC driver directly and has NO
    // way to name a company — it just answers for whatever Tally's ODBC
    // layer itself currently considers active, a notion that is separate
    // from (and not necessarily in sync with) the company the HTTP path
    // above was just scoped to. With only one company open that distinction
    // never matters (there is nothing else it could mean). With several open
    // and a specific one chosen, silently falling back here previously meant
    // an import could succeed while quietly reading a DIFFERENT company than
    // the one picked — no error, no warning, just the wrong company's data
    // labelled as a successful import. Refuse instead of guessing.
    if (multipleCompanies) {
      throw new Error(
        `${httpErr.message} — multiple companies are open in Tally and the network export failed for ` +
        `"${chosenCompany || 'the selected company'}", so the ODBC fallback was NOT used: it cannot target ` +
        `a specific company and could silently import a different one. Close every other company in Tally ` +
        `except the one you want, then retry.`
      )
    }
    try {
      const odbcData = await getTallyDataViaOdbc(h, p, keepPLLedger)
      return { ...odbcData, source: 'odbc', httpError: httpErr.message }
    } catch (odbcErr) {
      throw new Error(`${httpErr.message} ODBC fallback also failed: ${odbcErr.message}`)
    }
  })
}
