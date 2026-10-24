import { ipcMain } from 'electron'
import { readFileSync } from 'fs'
import { query } from '../db/client.js'
import { readMappingFile, exportMappingToExcel } from '../services/excel.js'

// ── Startup DB patches applied to ALL rule sets ─────────────────────────────
// These fix missing keywords across default + all custom rule sets.
// Each patch is idempotent (checks/guards before updating), so it's safe to
// run on every boot — index.js calls this explicitly inside the shared
// startup lock (see db/client.js's withStartupLock) rather than firing it
// unawaited here, so it can't interleave with seedDefaultMapping()'s
// delete-and-reinsert of the same tables.
export async function applyMappingPatches() {
  try {
    // Advance to Suppliers sits under Short-term loans and advances (0.1.102). schema.js adds the sub head to existing databases at
    // start-up; a database seeded just now (a fresh install) gets it here, after the seed. Idempotent.
    await query(`
      INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3, sort_order)
      SELECT lf.rule_set_id, lf.constitution, 'ASSETS', lf.level1, 'Short-term loans and advances', 'Advance to Suppliers', MAX(lf.sort_order)
      FROM level_format lf
      WHERE lf.level2 = 'Short-term loans and advances'
        AND NOT EXISTS (
          SELECT 1 FROM level_format lf2
          WHERE lf2.rule_set_id = lf.rule_set_id AND lf2.constitution = lf.constitution
            AND lf2.level2 = 'Short-term loans and advances' AND lf2.level3 = 'Advance to Suppliers'
        )
      GROUP BY lf.rule_set_id, lf.constitution, lf.level1
    `)
    // sub heads patched in earlier sat at sort_order 0 - ahead of the Non-current captions on the Balance Sheet; put them at their siblings'
    await query(`
      UPDATE level_format lf SET sort_order = s.mx
        FROM (SELECT rule_set_id, constitution, level1, level2, MAX(sort_order) AS mx
                FROM level_format WHERE sort_order > 0 GROUP BY rule_set_id, constitution, level1, level2) s
       WHERE lf.sort_order = 0 AND lf.level3 IN ('Advance to Suppliers', 'Advance from Customers')
         AND s.rule_set_id = lf.rule_set_id AND s.constitution = lf.constitution AND s.level1 = lf.level1 AND s.level2 = lf.level2
    `)

    // Patches 1-4 (keyword appends to 'Power and fuel' / 'Insurance' /
    // 'Payments to Auditors' / 'Misc Expenses' and the Depreciation / Finance /
    // Salary Map1 rows) were retired on 8 Sep 2026: Mapping_v2.xlsx now carries
    // all of it natively, and three of them re-introduced errors the revised
    // workbook removes (Telephone/Internet under Power and fuel, professional
    // fees under Payments to Auditors, 'Bank Charges' as a finance cost).

    // Patch 5: Individual/Proprietorship/Partnership and LLP (constitution 1
    // & 2) "Tax expense" was inconsistently written as "Tax expense:" (with
    // a trailing colon) in some Map2/Map3 keyword rules, while level_format
    // defines the Level 1 caption WITHOUT a colon for these constitutions
    // (only Company/constitution 3 legitimately uses the colon). The
    // mismatch meant such ledgers never resolved to their proper
    // level_format row (e.g. "Excess/ Short provision of tax relating to
    // earlier years" never showed as an available Level 2), and instead
    // landed in an orphaned, duplicate "Tax expense:" Mapping 1 bucket.
    // Fixes both the rule tables (so future auto-mapping gets it right) and
    // already-mapped ledger rows (so existing categorisations don't need to
    // be redone).
    await query(`UPDATE map2 SET mapping1_resultant = 'Tax expense'
      WHERE mapping1_resultant = 'Tax expense:' AND constitution IN (1,2)`)
    await query(`UPDATE map3 SET mapping1_resultant = 'Tax expense'
      WHERE mapping1_resultant = 'Tax expense:' AND constitution IN (1,2)`)
    await query(`UPDATE mapped_tb SET mapping1_resultant = 'Tax expense'
      WHERE mapping1_resultant = 'Tax expense:'
        AND tb_id IN (
          SELECT tb.id FROM trial_balances tb JOIN entities e ON e.id = tb.entity_id
          WHERE e.constitution IN (1,2)
        )`)

    // Patch 6: Patch 5 above only corrected the mapping1_resultant TEXT on
    // rows that were saved back when it still read "Tax expense:" — it never
    // re-resolved level_format_id/alie, which had been left NULL/stale
    // because the lookup for a level_format row matching "Tax expense:" (for
    // constitution 1/2, which never had that spelling) simply found nothing.
    // A NULL level_format_id + stale alie is exactly what makes a ledger's
    // amount silently drop out of its P&L line even though its Mapping
    // 1/2/3 look correct in the Rectification screen. Re-resolve both now
    // that the text is fixed.
    await query(`
      UPDATE mapped_tb mt
      SET level_format_id = lf.id,
          alie = lf.alie
      FROM level_format lf, trial_balances tb, entities e
      WHERE mt.tb_id = tb.id
        AND tb.entity_id = e.id
        AND lf.rule_set_id = mt.rule_set_id
        AND lf.constitution = e.constitution
        AND lf.level1 = mt.mapping1_resultant
        AND COALESCE(lf.level2, '') = COALESCE(mt.mapping2_resultant, '')
        AND mt.mapping1_resultant = 'Tax expense'
        AND mt.level_format_id IS NULL
        AND e.constitution IN (1,2)
    `)

    // Patch 7 (every-launch copy of the latest period's categorisation onto
    // every earlier period) was RETIRED in 0.1.71. It ran on every launch of
    // every PC and overwrote a Previous Year ledger the CA had deliberately
    // rectified (e.g. "Provision for tax" -> Tax expense: / Current tax) with
    // whatever the Current Year held — often the bulk-approved default — so
    // PY fixes "did not save" once the app was reopened. A Current Year fix
    // still reaches earlier periods at the moment it is saved
    // (mapped-tb.js's propagateToOtherTBs), except over a row the CA fixed on
    // that period itself (mapped_tb.hand_fixed).

  } catch (e) {
    console.warn('Mapping patch error:', e.message)
  }
}

export function registerMappingHandlers() {
  // ── Get all rule sets for an entity (includes default) ───────────────────
  ipcMain.handle('mapping:ruleSets', async (_, entityId) => {
    const { rows } = await query(
      `SELECT * FROM mapping_rule_sets
       WHERE is_default = TRUE OR entity_id = $1
       ORDER BY is_default DESC, created_at DESC`,
      [entityId]
    )
    return rows
  })

  // ── Get default rule set mapping data ────────────────────────────────────
  ipcMain.handle('mapping:getDefault', async (_, constitution) => {
    const { rows: [rs] } = await query(
      `SELECT id FROM mapping_rule_sets WHERE is_default=TRUE LIMIT 1`
    )
    if (!rs) return null
    return _loadRuleSetData(rs.id, constitution)
  })

  // ── Get entity-specific (user) mapping ───────────────────────────────────
  ipcMain.handle('mapping:getUserMapping', async (_, entityId) => {
    const { rows } = await query(
      `SELECT * FROM mapping_rule_sets WHERE entity_id=$1 ORDER BY created_at DESC`,
      [entityId]
    )
    return rows
  })

  // ── Get LevelFormat for a constitution + rule set ────────────────────────
  ipcMain.handle('mapping:levelFormat', async (_, constitution, rsId) => {
    let ruleSetId = rsId
    if (!ruleSetId) {
      const { rows: [rs] } = await query(
        `SELECT id FROM mapping_rule_sets WHERE is_default=TRUE LIMIT 1`
      )
      ruleSetId = rs?.id
    }
    if (!ruleSetId) return []
    const { rows } = await query(
      `SELECT * FROM level_format WHERE rule_set_id=$1 AND constitution=$2 ORDER BY sort_order, id`,
      [ruleSetId, constitution]
    )
    return rows
  })

  // ── Save user-defined mapping (uploaded Excel) ───────────────────────────
  ipcMain.handle('mapping:upload', async (_, { entityId, filePath, name }) => {
    let data
    try {
      data = readMappingFile(filePath)
    } catch (err) {
      throw new Error(`Cannot read mapping file: ${err.message}`)
    }

    // Create new rule set for this entity
    const { rows: [rs] } = await query(
      `INSERT INTO mapping_rule_sets (name, is_default, entity_id) VALUES ($1, FALSE, $2) RETURNING id`,
      [name || 'User Mapping', entityId]
    )
    const rsId = rs.id

    // Rows with no (or non-numeric) Constitution are blank/trailing padding
    // rows Excel commonly leaves at the end of a sheet — skip them instead of
    // failing the whole upload with a Postgres "invalid input syntax" error.
    let skipped = 0
    for (let i = 0; i < data.levelFormat.length; i++) {
      const r = data.levelFormat[i]
      const constitution = parseInt(r['Constitution'])
      if (isNaN(constitution)) { skipped++; continue }
      await query(
        `INSERT INTO level_format
           (rule_set_id, constitution, alie, level1, level2, level3, level4, level5, level6, level7, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [rsId, constitution, r['ALIE'], r['Level 1'], r['Level 2'],
         r['Level 3'], r['Level 4'], r['Level 5'], r['Level 6'], r['Level 7'], i]
      )
    }
    for (const r of data.map1) {
      const constitution = parseInt(r['Constitution'])
      if (isNaN(constitution)) { skipped++; continue }
      await query(
        `INSERT INTO map1 (rule_set_id, constitution, tally_pre_primary, mapping1_resultant)
         VALUES ($1,$2,$3,$4)`,
        [rsId, constitution, r['Tally Pre-Primary'], r['Mapping1 Resultant']]
      )
    }
    for (const r of data.map2) {
      const constitution = parseInt(r['Constitution'])
      if (isNaN(constitution)) { skipped++; continue }
      await query(
        `INSERT INTO map2 (rule_set_id, constitution, keywords, mapping2_resultant, mapping1_resultant, priority, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [rsId, constitution, r['Keyword'], r['Mapping2 Resultant'],
         r['Mapping1 Resultant'], parseInt(r['Priority']) || 1, r['Notes for understanding']]
      )
    }
    for (const r of data.map3) {
      const constitution = parseInt(r['Constitution'])
      if (isNaN(constitution)) { skipped++; continue }
      await query(
        `INSERT INTO map3 (rule_set_id, constitution, keywords, mapping1_resultant, mapping2_resultant, mapping3_resultant, priority, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [rsId, constitution, r['Keyword'], r['Mapping1 Resultant'],
         r['Mapping2 Resultant'], r['Mapping3 Resultant'], parseInt(r['Priority']) || 1,
         r['Notes for understanding']]
      )
    }

    return { rsId, name: name || 'User Mapping', skippedRows: skipped }
  })

  // ── Revert entity to default mapping ────────────────────────────────────
  ipcMain.handle('mapping:revertDefault', async (_, entityId) => {
    // Just update the entity's active rule set to the default one
    // (we don't delete user rule sets, just mark them inactive)
    const { rows: [rs] } = await query(
      `SELECT id FROM mapping_rule_sets WHERE is_default=TRUE LIMIT 1`
    )
    return { defaultRsId: rs?.id }
  })

  // ── Get Map1 / Map2 / Map3 data for a rule set + constitution ───────────
  ipcMain.handle('mapping:getMapSheets', async (_, rsId, constitution) => {
    let ruleSetId = rsId
    if (!ruleSetId) {
      const { rows: [rs] } = await query(
        `SELECT id FROM mapping_rule_sets WHERE is_default=TRUE LIMIT 1`
      )
      ruleSetId = rs?.id
    }
    if (!ruleSetId) return { map1: [], map2: [], map3: [] }
    const [m1, m2, m3] = await Promise.all([
      query(`SELECT * FROM map1 WHERE rule_set_id=$1 AND constitution=$2 ORDER BY id`, [ruleSetId, constitution]),
      query(`SELECT * FROM map2 WHERE rule_set_id=$1 AND constitution=$2 ORDER BY priority, id`, [ruleSetId, constitution]),
      query(`SELECT * FROM map3 WHERE rule_set_id=$1 AND constitution=$2 ORDER BY priority, id`, [ruleSetId, constitution]),
    ])
    return { map1: m1.rows, map2: m2.rows, map3: m3.rows }
  })

  // ── Export mapping rule set to Excel buffer ──────────────────────────────
  ipcMain.handle('mapping:download', async (_, rsId) => {
    const buffer = await exportMappingToExcel(rsId)
    return Array.from(buffer)
  })

  // ── Save user-edits to mapping rows inline ───────────────────────────────
  ipcMain.handle('mapping:saveUser', async (_, { entityId, rows, name }) => {
    const { rows: [rs] } = await query(
      `INSERT INTO mapping_rule_sets (name, is_default, entity_id) VALUES ($1, FALSE, $2) RETURNING id`,
      [name || 'Custom Mapping', entityId]
    )
    const rsId = rs.id

    // rows is array of { constitution, alie, level1..7 } from the entry table
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      await query(
        `INSERT INTO level_format
           (rule_set_id, constitution, alie, level1, level2, level3, level4, level5, level6, level7, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [rsId, r.constitution, r.alie, r.level1, r.level2, r.level3, r.level4,
         r.level5, r.level6, r.level7, i]
      )
    }
    return { rsId }
  })
}

async function _loadRuleSetData(rsId, constitution) {
  const [lf, m1, m2, m3] = await Promise.all([
    query(`SELECT * FROM level_format WHERE rule_set_id=$1 AND constitution=$2 ORDER BY sort_order, id`, [rsId, constitution]),
    query(`SELECT * FROM map1 WHERE rule_set_id=$1 AND constitution=$2`, [rsId, constitution]),
    query(`SELECT * FROM map2 WHERE rule_set_id=$1 AND constitution=$2 ORDER BY priority`, [rsId, constitution]),
    query(`SELECT * FROM map3 WHERE rule_set_id=$1 AND constitution=$2 ORDER BY priority`, [rsId, constitution]),
  ])
  return { rsId, levelFormat: lf.rows, map1: m1.rows, map2: m2.rows, map3: m3.rows }
}
