import { ipcMain, dialog } from 'electron'
import { writeFileSync } from 'fs'
import * as XLSX from 'xlsx'
import { query } from '../db/client.js'
import { runMappingEngine, persistMappingResults } from '../services/mapping-engine.js'

// Strip "(specify nature)" for fuzzy LevelFormat matching (SQLite-compatible)
const SPEC_NATURE_SQL = (col) =>
  `LOWER(TRIM(REPLACE(${col}, '(specify nature)', '')))`

// Rows the Stock tab writes (and deletes + re-creates on every save): never adjusted
// from the Mapped TB - see mappedTB:setAdjustment.
const STOCK_ENTRY_NATURES = ['Stock Entry', 'Stock Entry PY', 'Opening Stock (Manual)']

// ── Financial Period locking guards ──────────────────────────────────────────
// A locked entity_period (Auditee ↔ FY) freezes all categorisation/mapping
// changes for every TB uploaded under it. Rule-set *definitions* (map1/map2/
// map3/level_format) are intentionally NOT gated here — only per-ledger
// classification already saved against a locked period is frozen.
const LOCK_MSG = 'This Financial Period is locked. Unlock it from the Master tab to make changes.'

async function assertPeriodUnlockedForTB(tbId) {
  const { rows: [row] } = await query(
    `SELECT ep.locked FROM trial_balances tb
     JOIN entity_periods ep ON ep.id = tb.entity_period_id
     WHERE tb.id = $1`,
    [tbId]
  )
  if (row?.locked) throw new Error(LOCK_MSG)
}

async function assertPeriodUnlockedForMappedRow(id) {
  const { rows: [row] } = await query(`SELECT tb_id FROM mapped_tb WHERE id=$1`, [id])
  if (row) await assertPeriodUnlockedForTB(row.tb_id)
}

async function assertPeriodUnlockedForMappedRows(ids) {
  if (!ids?.length) return
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
  const { rows } = await query(
    `SELECT DISTINCT tb_id FROM mapped_tb WHERE id IN (${placeholders})`, ids
  )
  for (const r of rows) await assertPeriodUnlockedForTB(r.tb_id)
}

// SQLite stores JSON columns as TEXT — parse them back to JS objects/arrays.
function parseMappedRow(r) {
  if (!r) return r
  if (typeof r.conflict_candidates === 'string') {
    try { r.conflict_candidates = JSON.parse(r.conflict_candidates) } catch { r.conflict_candidates = [] }
  }
  if (typeof r.discrepancy_suggestion === 'string') {
    try { r.discrepancy_suggestion = JSON.parse(r.discrepancy_suggestion) } catch { r.discrepancy_suggestion = null }
  }
  return r
}

// ── Carry-forward of finalised user categorisation ───────────────────────────
// User categorisation (status user_override / user_approved) is stored per-TB.
// Without carry-forward, every re-upload of a TB (new tb_id) — and every
// re-run of auto-mapping — starts from scratch and the user has to redo the
// same categorisation work. This re-applies the user's latest decision per
// ledger (matched by ledger name, case-insensitive) on top of fresh engine
// results, sourced from:
//   1. the SAME TB's rows as they stood just before this re-run (snapshot
//      taken before the DELETE), and
//   2. all OTHER TBs of the same entity (any period/branch), latest first.
// Locked periods are only ever READ here, never written — so a decision made
// in a locked FY still informs new periods, without flowing anything back.
// To genuinely start clean, use "Clear All Mappings" first, then run.
// Resolves the level_format row for a (Mapping 1, 2, 3) triple INSIDE the
// UPDATE, using the row's own rule set. Every categorisation screen used to
// compute this client-side and send null whenever its lookup missed - for a
// terminal Level 1 (no Level 2, e.g. Finance Costs) it always missed, and the
// row was then stored with no level_format_id, rendered with blank Level
// columns, and treated as unfinished by the rectification queue even though
// its classification was complete. Preference order: exact Level 3 match >
// the Level-2 row itself > the terminal Level-1 row (level2 IS NULL).
// Parameters are positional so the expression drops into either UPDATE:
//   m1, m2, m3 are the placeholder numbers of Mapping 1 / 2 / 3.
const RESOLVE_LF_SQL = (m1, m2, m3) => `(
  SELECT lf.id FROM level_format lf
  WHERE lf.rule_set_id = mapped_tb.rule_set_id
    AND ${SPEC_NATURE_SQL('lf.level1')} = ${SPEC_NATURE_SQL('$' + m1 + '::text')}
    AND (
      ($${m2}::text IS NULL AND lf.level2 IS NULL)
      OR ($${m2}::text IS NOT NULL AND lf.level2 IS NOT NULL
          AND ${SPEC_NATURE_SQL('lf.level2')} = ${SPEC_NATURE_SQL('$' + m2 + '::text')})
    )
  ORDER BY
    CASE WHEN $${m3}::text IS NOT NULL AND lf.level3 IS NOT NULL
              AND ${SPEC_NATURE_SQL('lf.level3')} = ${SPEC_NATURE_SQL('$' + m3 + '::text')} THEN 0
         WHEN lf.level3 IS NULL THEN 1
         ELSE 2 END,
    lf.id
  LIMIT 1
)`

// The format row a save may keep from the client: only one naming the same
// Level 1 and Level 2 being saved. A stale id (the ledger's previous
// categorisation, sent back unchanged by a screen) used to be stored as is, and
// the financials query reads captions from the format row first - the ledger
// then kept its old heading beside the new Level 1. Anything else is resolved
// from the saved captions (RESOLVE_LF_SQL).
const CLIENT_LF_SQL = (id, m1, m2) => `(
  SELECT lf.id FROM level_format lf
  WHERE lf.id = $${id}::int
    AND ${SPEC_NATURE_SQL('lf.level1')} = ${SPEC_NATURE_SQL('$' + m1 + '::text')}
    AND (($${m2}::text IS NULL AND lf.level2 IS NULL)
      OR ($${m2}::text IS NOT NULL AND lf.level2 IS NOT NULL
          AND ${SPEC_NATURE_SQL('lf.level2')} = ${SPEC_NATURE_SQL('$' + m2 + '::text')}))
)`

const USER_MAPPING_COLS = `
  mt.mapping1_resultant, mt.mapping2_resultant, mt.mapping3_resultant,
  mt.level_format_id, mt.level4_value, mt.level5_value, mt.level6_value, mt.level7_value,
  mt.alie, mt.status, mt.override_note, mt.mapped_at, mt.hand_fixed`

async function snapshotUserRows(tbId) {
  const { rows } = await query(
    `SELECT tr.name, ${USER_MAPPING_COLS}
     FROM mapped_tb mt
     JOIN tb_rows tr ON tr.id = mt.tb_row_id
     WHERE mt.tb_id = $1 AND mt.status IN ('user_override', 'user_approved')`,
    [tbId]
  )
  return rows
}

async function applyCarryForward(tbId, entityId, sameTBSnapshot) {
  // Decisions on the entity's OTHER TBs, split by year: the same Financial
  // Period and branch as this TB (the copy being replaced by a re-upload) —
  // then every other year, LATEST year first. Ordered by the year, never by
  // when a row was last saved: a 2024-25 fix saved after the 2025-26 one used
  // to win the 2025-26 re-upload (Secured came back Unsecured, 0.1.71).
  const { rows: otherTBRows } = await query(
    `SELECT tr.name, ${USER_MAPPING_COLS},
            (tb.entity_period_id IS NOT DISTINCT FROM me.entity_period_id
             AND COALESCE(tb.branch_name, '') = COALESCE(me.branch_name, '')) AS same_year
     FROM mapped_tb mt
     JOIN tb_rows tr ON tr.id = mt.tb_row_id
     JOIN trial_balances tb ON tb.id = mt.tb_id
     JOIN trial_balances me ON me.id = $2
     LEFT JOIN entity_periods ep ON ep.id = tb.entity_period_id
     LEFT JOIN financial_periods fp ON fp.id = ep.financial_period_id
     WHERE tb.entity_id = $1 AND mt.tb_id <> $2
       AND mt.status IN ('user_override', 'user_approved')
     ORDER BY fp.date_from DESC NULLS LAST, mt.mapped_at DESC`,
    [entityId, tbId]
  )
  // Durable, TB-independent store (see schema.js's learned_ledger_rules) —
  // survives even if every other TB for this entity has been deleted, and is
  // what a downloaded/uploaded "Learned Ledger Rules" file round-trips
  // through. Lowest priority of the three: a still-live TB's own more
  // specific decision (possibly with a different override_note/level_format)
  // wins over this durable snapshot when both exist.
  const { rows: learnedRows } = await query(
    `SELECT ledger_name AS name, mapping1_resultant, mapping2_resultant, mapping3_resultant,
            level4_value, level5_value, level6_value, level7_value, alie,
            -- a learned rule is a decision the CA made: carried as one, so GST
            -- netting (useFinancials.js isGstBalanceRow) still respects a GST
            -- ledger deliberately placed elsewhere after a re-upload
            'user_override' AS status, NULL AS override_note, updated_at AS mapped_at, NULL AS level_format_id,
            FALSE AS hand_fixed
     FROM learned_ledger_rules WHERE entity_id = $1`,
    [entityId]
  )

  // Precedence per ledger name: the same TB's own pre-run decision, then
  // the same year's (and branch's) other copy — the TB a re-upload replaces
  // (0.1.72) — then the durable learned rule, then other years' TBs, latest
  // year first. Learned rules are rewritten on EVERY approve/override and by an
  // uploaded rules file, so they are the entity's latest word; sibling TBs
  // can carry an older 'user_approved' (e.g. a bulk "approve all" of the
  // engine's default mapping) that used to outrank a freshly uploaded rule —
  // which is how a custom line such as "Other expenses > Software & Website
  // Expenses" could be replaced by the default caption on the next re-run.
  const byName = new Map()
  // Only this TB's OWN snapshot keeps its hand_fixed mark across a re-run;
  // a decision copied in from elsewhere is not a fix made on this TB.
  const sameYear = otherTBRows.filter(p => p.same_year), otherYears = otherTBRows.filter(p => !p.same_year)
  for (const p of [...(sameTBSnapshot || []).map(p => ({ ...p, own: true })), ...sameYear, ...learnedRows, ...otherYears]) {
    const key = (p.name || '').trim().toLowerCase()
    if (key && !byName.has(key)) byName.set(key, p)
  }
  if (byName.size === 0) return 0

  const { rows: fresh } = await query(
    `SELECT mt.id, tr.name FROM mapped_tb mt
     JOIN tb_rows tr ON tr.id = mt.tb_row_id
     WHERE mt.tb_id = $1`,
    [tbId]
  )
  let applied = 0
  for (const r of fresh) {
    const prev = byName.get((r.name || '').trim().toLowerCase())
    if (!prev) continue
    await query(
      `UPDATE mapped_tb SET
         mapping1_resultant=$1, mapping2_resultant=$2, mapping3_resultant=$3,
         level_format_id=$4, level4_value=$5, level5_value=$6, level6_value=$7, level7_value=$8,
         alie=$9, status=$10, confidence='high',
         conflict_candidates=NULL, conflict_stage=NULL, discrepancy_suggestion=NULL,
         override_note=$11, mapped_at=now(), hand_fixed=$13
       WHERE id=$12`,
      [prev.mapping1_resultant, prev.mapping2_resultant, prev.mapping3_resultant,
       prev.level_format_id, prev.level4_value, prev.level5_value, prev.level6_value, prev.level7_value,
       prev.alie, prev.status,
       prev.override_note || 'Carried forward from earlier categorisation', r.id,
       !!(prev.own && prev.hand_fixed)]
    )
    applied++
  }
  await resolveLevelFormatIds(tbId)
  return applied
}

// Point user-decided rows that have no format row yet at the row their
// captions name (exact Level 3 > the Level-2 row > the terminal Level-1 row —
// the same preference as RESOLVE_LF_SQL / the start-up backfill). A CUSTOM
// caption (e.g. a new expense line typed in Rectification) has no format row
// and legitimately stays NULL: BS / P&L / Notes render it from its text.
async function resolveLevelFormatIds(tbId) {
  await query(`
    UPDATE mapped_tb mt SET level_format_id = (
      SELECT lf.id FROM level_format lf
      WHERE lf.rule_set_id = mt.rule_set_id
        AND ${SPEC_NATURE_SQL('lf.level1')} = ${SPEC_NATURE_SQL('mt.mapping1_resultant')}
        AND ((mt.mapping2_resultant IS NULL AND lf.level2 IS NULL)
          OR (mt.mapping2_resultant IS NOT NULL AND lf.level2 IS NOT NULL
              AND ${SPEC_NATURE_SQL('lf.level2')} = ${SPEC_NATURE_SQL('mt.mapping2_resultant')}))
      ORDER BY CASE WHEN mt.mapping3_resultant IS NOT NULL AND lf.level3 IS NOT NULL
                         AND ${SPEC_NATURE_SQL('lf.level3')} = ${SPEC_NATURE_SQL('mt.mapping3_resultant')} THEN 0
                    WHEN lf.level3 IS NULL THEN 1 ELSE 2 END, lf.id
      LIMIT 1)
    WHERE mt.tb_id = $1 AND mt.level_format_id IS NULL AND mt.mapping1_resultant IS NOT NULL AND mt.rule_set_id IS NOT NULL`,
    [tbId])
}

// Applies the entity's durable learned_ledger_rules to its ALREADY-MAPPED TBs,
// by ledger name. applyCarryForward (above) only reaches a TB when that TB is
// itself re-run through mappedTB:run, so uploading a rules file — or learning a
// rule while a sibling TB sits mapped — left every existing TB untouched and
// looking like the rules had done nothing at all.
//
// Locked periods are skipped rather than failing the whole operation: a locked
// year is meant to be immutable, and one locked TB must not stop the rules from
// reaching the others. Returns per-TB counts so the caller can say what happened.
//
// level_format_id is cleared for the same reason applyCarryForward clears it on
// this path: learned rules carry no level_format identity, and keeping the id
// the engine computed for a DIFFERENT mapping would point the row at the wrong
// format row.
async function applyLearnedRulesToEntityTBs(entityId) {
  const { rows: tbs } = await query(
    `SELECT tb.id, ep.locked
       FROM trial_balances tb
       LEFT JOIN entity_periods ep ON ep.id = tb.entity_period_id
      WHERE tb.entity_id = $1`,
    [entityId]
  )
  let applied = 0, tbsTouched = 0, tbsLocked = 0
  for (const tb of tbs) {
    if (tb.locked) { tbsLocked++; continue }
    const { rowCount } = await query(
      `UPDATE mapped_tb mt SET
         mapping1_resultant = lr.mapping1_resultant,
         mapping2_resultant = lr.mapping2_resultant,
         mapping3_resultant = lr.mapping3_resultant,
         level_format_id    = NULL,
         level4_value       = lr.level4_value,
         level5_value       = lr.level5_value,
         level6_value       = lr.level6_value,
         level7_value       = lr.level7_value,
         alie               = COALESCE(lr.alie, mt.alie),
         status             = 'user_override',
         confidence         = 'high',
         conflict_candidates = NULL, conflict_stage = NULL, discrepancy_suggestion = NULL,
         override_note      = COALESCE(mt.override_note, 'Applied from Learned Ledger Rules'),
         mapped_at          = now()
       FROM tb_rows tr, learned_ledger_rules lr
       WHERE tr.id = mt.tb_row_id
         AND mt.tb_id = $1
         AND lr.entity_id = $2
         AND lr.ledger_name_key = LOWER(TRIM(tr.name))
         AND lr.mapping1_resultant IS NOT NULL
         AND mt.hand_fixed IS NOT TRUE`,   // a fix made on that TB itself stays
      [tb.id, entityId]
    )
    if (rowCount > 0) { applied += rowCount; tbsTouched++; await resolveLevelFormatIds(tb.id) }
  }
  return { applied, tbsTouched, tbsLocked }
}

// Records the CURRENT finalised state of the given mapped_tb rows into the
// durable, TB-independent learned_ledger_rules table (see schema.js) — called
// after every approve/override so a ledger's decision survives even if every
// TB it was ever mapped on gets deleted later. Best-effort: a row with no
// ledger name or no resolvable entity is silently skipped rather than
// failing the approve/override action itself.
async function recordLearnedRules(mappedTbIds) {
  if (!mappedTbIds?.length) return
  const placeholders = mappedTbIds.map((_, i) => `$${i + 1}`).join(',')
  // A save on an EARLIER year's TB does not teach the entity's rule when a
  // later year's TB has the same ledger: the rule is what a re-upload of the
  // latest year gets, and last year's facts (a loan then Unsecured, now
  // Secured) must not replace this year's. The older year keeps its own
  // decision on its own TB (mapped_tb.hand_fixed).
  const { rows } = await query(
    `SELECT mt.mapping1_resultant, mt.mapping2_resultant, mt.mapping3_resultant,
            mt.level4_value, mt.level5_value, mt.level6_value, mt.level7_value, mt.alie,
            tr.name AS ledger_name, tb.entity_id, tb.branch_name,
            EXISTS (
              SELECT 1 FROM trial_balances tb2
              JOIN entity_periods ep2 ON ep2.id = tb2.entity_period_id
              JOIN financial_periods fp2 ON fp2.id = ep2.financial_period_id
              JOIN tb_rows tr2 ON tr2.tb_id = tb2.id AND LOWER(TRIM(tr2.name)) = LOWER(TRIM(tr.name))
              WHERE tb2.entity_id = tb.entity_id AND fp2.date_from > fp.date_from
            ) AS later_year_has_it
     FROM mapped_tb mt
     JOIN tb_rows tr ON tr.id = mt.tb_row_id
     JOIN trial_balances tb ON tb.id = mt.tb_id
     LEFT JOIN entity_periods ep ON ep.id = tb.entity_period_id
     LEFT JOIN financial_periods fp ON fp.id = ep.financial_period_id
     WHERE mt.id IN (${placeholders})`,
    mappedTbIds
  )
  for (const r of rows) {
    if (r.later_year_has_it) continue
    const key = (r.ledger_name || '').trim().toLowerCase()
    if (!key || !r.entity_id) continue
    await query(
      `INSERT INTO learned_ledger_rules
         (entity_id, ledger_name_key, ledger_name, mapping1_resultant, mapping2_resultant, mapping3_resultant,
          level4_value, level5_value, level6_value, level7_value, alie, source_branch_name, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
       ON CONFLICT(entity_id, ledger_name_key) DO UPDATE SET
         ledger_name = excluded.ledger_name,
         mapping1_resultant = excluded.mapping1_resultant,
         mapping2_resultant = excluded.mapping2_resultant,
         mapping3_resultant = excluded.mapping3_resultant,
         level4_value = excluded.level4_value,
         level5_value = excluded.level5_value,
         level6_value = excluded.level6_value,
         level7_value = excluded.level7_value,
         alie = excluded.alie,
         source_branch_name = excluded.source_branch_name,
         updated_at = excluded.updated_at`,
      [r.entity_id, key, r.ledger_name, r.mapping1_resultant, r.mapping2_resultant, r.mapping3_resultant,
       r.level4_value, r.level5_value, r.level6_value, r.level7_value, r.alie, r.branch_name || null]
    )
  }
}

// ── Push propagation of manual categorisation to sibling TBs ────────────────
// applyCarryForward (above) is PULL-based: it only re-applies a ledger's
// latest decision when the TARGET TB is itself re-run via mappedTB:run. That
// leaves every OTHER TB of the entity stale until someone re-runs it too —
// e.g. recategorising a ledger in FY2025-26 never reaches the already-mapped
// FY2024-25 rows for the same ledger name. This pushes the just-saved
// mapping to sibling TBs of the same entity immediately, matched by ledger
// name (case/whitespace-insensitive), skipping any TB whose Financial
// Period is locked — a locked period's own saved categorisation is frozen
// and must never be silently overwritten.
//
// Direction is anchored to Financial Period chronology (financial_periods.
// date_from), NEVER to edit/save recency — an earlier bug here used
// mapped_at ("whichever TB was touched most recently") as the signal for
// "which period is authoritative," which silently flows backwards whenever
// the OLDER period happens to get edited/re-saved more recently in wall-
// clock time (e.g. while debugging FY2024-25 after already having fixed
// FY2025-26), overwriting the newer, correct categorisation. Only propagate
// from a TB into OTHER TBs whose Financial Period started strictly BEFORE
// the source TB's own period — i.e. always newer-FY-into-older-FY, matching
// "the categorisation of 25-26 should flow into 24-25" literally. A source
// TB with no linked Financial Period (entity_period_id NULL) has no defined
// chronological position, so direction can't be trusted — skip rather than
// guess.
async function propagateToOtherTBs(entityId, ledgerNameKey, patch, sourceTbId) {
  if (!ledgerNameKey || !entityId) return 0
  const { rows: [srcPeriod] } = await query(
    `SELECT fp.date_from FROM trial_balances tb
     JOIN entity_periods ep ON ep.id = tb.entity_period_id
     JOIN financial_periods fp ON fp.id = ep.financial_period_id
     WHERE tb.id = $1`,
    [sourceTbId]
  )
  if (!srcPeriod) return 0
  const { rows: targets } = await query(
    `SELECT mt.id FROM mapped_tb mt
     JOIN tb_rows tr ON tr.id = mt.tb_row_id
     JOIN trial_balances tb ON tb.id = mt.tb_id
     JOIN entity_periods ep ON ep.id = tb.entity_period_id
     JOIN financial_periods fp ON fp.id = ep.financial_period_id
     WHERE tb.entity_id = $1 AND tb.id <> $2
       AND ep.locked IS NOT TRUE
       AND fp.date_from < $4
       AND LOWER(TRIM(tr.name)) = $3
       AND mt.hand_fixed IS NOT TRUE`,   // never over a fix the CA made on that period itself
    [entityId, sourceTbId, ledgerNameKey, srcPeriod.date_from]
  )
  for (const t of targets) {
    await query(
      `UPDATE mapped_tb SET
         mapping1_resultant=$1, mapping2_resultant=$2, mapping3_resultant=$3,
         level_format_id=$4, level4_value=$5, level5_value=$6, level6_value=$7, level7_value=$8,
         alie=$9, status='user_override', confidence='high',
         conflict_candidates=NULL, conflict_stage=NULL, discrepancy_suggestion=NULL,
         override_note=$10, mapped_at=now()
       WHERE id=$11`,
      [patch.mapping1_resultant, patch.mapping2_resultant, patch.mapping3_resultant,
       patch.level_format_id, patch.level4_value, patch.level5_value, patch.level6_value, patch.level7_value,
       patch.alie, 'Propagated from categorisation made on another period', t.id]
    )
  }
  return targets.length
}

export function registerMappedTBHandlers() {
  // ── Run full 3-stage mapping ───────────────────────────────────────────────
  ipcMain.handle('mappedTB:run', async (_, tbId, rsId, options = {}) => {
    await assertPeriodUnlockedForTB(tbId)
    const { rows: [tb] } = await query(
      `SELECT tb.*, e.constitution, e.business_type FROM trial_balances tb
       JOIN entities e ON e.id = tb.entity_id WHERE tb.id = $1`, [tbId]
    )
    if (!tb) throw new Error('Trial Balance not found.')
    // Preserve this TB's own user decisions across the re-run
    const userSnapshot = await snapshotUserRows(tbId)
    await query(`DELETE FROM mapped_tb WHERE tb_id = $1`, [tbId])
    const results = await runMappingEngine(tbId, rsId, tb.constitution, {
      excludeZero: !!options.excludeZero,
      businessType: tb.business_type || null,
    })
    await persistMappingResults(results)
    // Re-apply finalised categorisation (this TB's snapshot + entity's other TBs)
    const carriedForward = await applyCarryForward(tbId, tb.entity_id, userSnapshot)
    return {
      total:       results.length,
      high:        results.filter(r => r.confidence === 'high').length,
      medium:      results.filter(r => r.confidence === 'medium').length,
      low:         results.filter(r => r.confidence === 'low').length,
      conflict:    results.filter(r => r.status === 'conflict').length,
      discrepancy: results.filter(r => r.status === 'discrepancy').length,
      unmapped:    results.filter(r => r.status === 'unmapped').length,
      carriedForward,
    }
  })

  // ── Get all mapped rows joined with TB + LevelFormat data ─────────────────
  // LATERAL replaced with correlated subquery; REGEXP_REPLACE replaced with REPLACE+LOWER
  ipcMain.handle('mappedTB:rows', async (_, tbId) => {
    const { rows } = await query(
      `SELECT
         mt.*,
         tr.period, tr.branch, tr.ledger_code, tr.name,
         tr.opening_balance, tr.debit, tr.credit, tr.closing_balance,
         tr.is_revenue, tr.is_deemed_positive, tr.trail_balance,
         tr.parent, tr.group_parent,
         tr.group_parent_1, tr.group_parent_2, tr.group_parent_3,
         tr.adj_debit, tr.adj_credit, tr.upload_nature,
         COALESCE(tr.imported_closing_balance, tr.closing_balance) AS imported_closing_balance,
         COALESCE(lf.alie,    lf2.alie)    AS alie,
         COALESCE(lf.level1,  lf2.level1)  AS level1,
         COALESCE(lf.level2,  lf2.level2)  AS level2,
         COALESCE(lf.level3,  lf2.level3)  AS level3,
         COALESCE(lf.level4,  lf2.level4)  AS lf_level4,
         COALESCE(lf.level5,  lf2.level5)  AS lf_level5,
         COALESCE(lf.level6,  lf2.level6)  AS lf_level6,
         COALESCE(lf.level7,  lf2.level7)  AS lf_level7
       FROM mapped_tb mt
       JOIN tb_rows tr ON tr.id = mt.tb_row_id
       LEFT JOIN level_format lf ON lf.id = mt.level_format_id
       LEFT JOIN level_format lf2 ON lf2.id = (
         SELECT id FROM level_format
         WHERE rule_set_id = mt.rule_set_id
           AND mt.level_format_id IS NULL
           AND (
             (mt.mapping2_resultant IS NOT NULL
              AND ${SPEC_NATURE_SQL('level2')} = ${SPEC_NATURE_SQL('mt.mapping2_resultant')}
              AND (mt.mapping3_resultant IS NULL
                   OR ${SPEC_NATURE_SQL('level3')} = ${SPEC_NATURE_SQL('mt.mapping3_resultant')}))
             OR
             -- Terminal Level 1 (no Level 2, e.g. Finance Costs): the row is
             -- complete at Level 1, so show that format row's levels rather
             -- than blanks. Without this every such row rendered as unmapped.
             (mt.mapping2_resultant IS NULL AND level2 IS NULL
              AND ${SPEC_NATURE_SQL('level1')} = ${SPEC_NATURE_SQL('mt.mapping1_resultant')})
           )
         LIMIT 1
       )
       WHERE mt.tb_id = $1
       ORDER BY
         CASE mt.status
           WHEN 'conflict'     THEN 1
           WHEN 'discrepancy'  THEN 2
           WHEN 'unmapped'     THEN 3
           WHEN 'auto_low'     THEN 4
           WHEN 'auto_medium'  THEN 5
           WHEN 'auto_high'    THEN 6
           ELSE 7
         END, tr.name`,
      [tbId]
    )
    return rows.map(parseMappedRow)
  })

  // ── Trial Balance adjustments (Debit / Credit) ────────────────────────────
  // The Mapped TB screen lets the CA type Adjustments (Debit) / (Credit)
  // against a ledger after the import. The closing balance is the app's single
  // source of truth - the statements, notes, ratios, EPS, depreciation and every
  // exception check all read tb_rows.closing_balance - so the REVISED figure is
  // written there, by one statement, never worked out on the side:
  //
  //   closing_balance          = imported_closing_balance + adj_credit - adj_debit
  //   imported_closing_balance = what the upload brought in (kept so it can be
  //                              shown on the Mapped TB and restored)
  //
  // Balances are stored Cr positive / Dr negative, so a Debit adjustment moves a
  // ledger towards Dr and a Credit adjustment towards Cr, on whichever side it
  // sits: Revised (Debit) = Clos (Debit) + Adj (Debit) - Adj (Credit), and the
  // mirror for Credit. A CHECK constraint on tb_rows (schema.js) refuses any write
  // that breaks the identity, and every change is recorded in tb_adjustment_log.
  const ADJ_MAX = 1e13
  const parseAdjustmentInput = (v, label) => {
    if (v === null || v === undefined || v === '') return null
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim())
    if (!Number.isFinite(n)) throw new Error(`${label} must be a number.`)
    if (n < 0) throw new Error(`${label} cannot be negative - to reduce a balance, enter the amount in the opposite column.`)
    if (n > ADJ_MAX) throw new Error(`${label} is too large.`)
    const r = Math.round(n * 100) / 100
    return r === 0 ? null : r
  }
  const sameAmount = (a, b) => (a === null || a === undefined ? 0 : Number(a)) === (b === null || b === undefined ? 0 : Number(b))

  // The one statement that writes an adjustment (closing = imported + credit - debit) and its log line
  const ADJUSTMENT_SQL = `WITH cur AS (
         SELECT id, tb_id, name, ledger_code, closing_balance, adj_debit, adj_credit,
                COALESCE(imported_closing_balance, closing_balance, 0) AS imp
           FROM tb_rows WHERE id = $1 FOR UPDATE
       ), nxt AS (
         SELECT cur.*,
                CASE WHEN $2::boolean THEN $3::numeric ELSE cur.adj_debit  END AS d,
                CASE WHEN $4::boolean THEN $5::numeric ELSE cur.adj_credit END AS c
           FROM cur
       ), upd AS (
         UPDATE tb_rows t
            SET imported_closing_balance = nxt.imp,
                adj_debit  = nxt.d,
                adj_credit = nxt.c,
                closing_balance = nxt.imp + COALESCE(nxt.c, 0) - COALESCE(nxt.d, 0)
           FROM nxt WHERE t.id = nxt.id
         RETURNING t.id, t.tb_id, t.adj_debit, t.adj_credit, t.closing_balance, t.imported_closing_balance
       ), lg AS (
         INSERT INTO tb_adjustment_log
           (tb_id, tb_row_id, ledger_name, ledger_code, old_adj_debit, old_adj_credit, new_adj_debit, new_adj_credit, closing_before, closing_after)
         SELECT nxt.tb_id, nxt.id, nxt.name, nxt.ledger_code, nxt.adj_debit, nxt.adj_credit, nxt.d, nxt.c,
                nxt.closing_balance, nxt.imp + COALESCE(nxt.c, 0) - COALESCE(nxt.d, 0)
           FROM nxt
       )
       SELECT id AS tb_row_id, tb_id, adj_debit, adj_credit, closing_balance, imported_closing_balance FROM upd`

  ipcMain.handle('mappedTB:setAdjustment', async (_, id, data = {}) => {
    await assertPeriodUnlockedForMappedRow(id)
    const hasD = Object.prototype.hasOwnProperty.call(data || {}, 'debit')
    const hasC = Object.prototype.hasOwnProperty.call(data || {}, 'credit')
    if (!hasD && !hasC) throw new Error('Nothing to save - send an Adjustments (Debit) or (Credit) amount.')
    const d = hasD ? parseAdjustmentInput(data.debit, 'Adjustments (Debit)') : null
    const c = hasC ? parseAdjustmentInput(data.credit, 'Adjustments (Credit)') : null

    const { rows: [cur] } = await query(
      `SELECT tr.id, tr.tb_id, tr.upload_nature, tr.closing_balance, tr.imported_closing_balance, tr.adj_debit, tr.adj_credit
         FROM mapped_tb mt JOIN tb_rows tr ON tr.id = mt.tb_row_id WHERE mt.id = $1`, [id])
    if (!cur) throw new Error('Ledger not found.')
    // Opening / Closing Stock rows are written by the Stock tab, which deletes and
    // re-creates them on every save - an adjustment typed here would be lost
    // without a word, and the Stock tab's own reconciliation would disagree.
    if (STOCK_ENTRY_NATURES.includes(cur.upload_nature)) {
      throw new Error('Opening / Closing Stock is maintained on the Stock tab - change it there, not by an adjustment.')
    }
    const unchanged = (!hasD || sameAmount(cur.adj_debit, d)) && (!hasC || sameAmount(cur.adj_credit, c))
    if (unchanged) {
      return { tb_row_id: cur.id, tb_id: cur.tb_id, adj_debit: cur.adj_debit, adj_credit: cur.adj_credit,
               closing_balance: cur.closing_balance, imported_closing_balance: cur.imported_closing_balance ?? cur.closing_balance,
               previous_closing_balance: cur.closing_balance, changed: false }
    }

    const { rows: [r] } = await query(
      ADJUSTMENT_SQL,
      [cur.id, hasD, d, hasC, c])
    return { ...r, previous_closing_balance: cur.closing_balance, changed: true }
  })

  // ── A ledger added on the Mapped TB ───────────────────────────────────────
  // A ledger that is not in the imported Trial Balance (an entry the CA wants to bring in: a provision, an accrual, a reclassification).
  // It is a real tb_rows ledger (upload_nature 'Manual Ledger') whose imported balance is nil and whose balance is its Adjustments, so
  // everything that reads the closing balance - Balance Sheet, P&L, notes, annexures, ratios - follows, exactly as for an adjusted ledger.
  // Added in one go: the name, the mapping at every level (the same override as the Override button), and the adjustment. A failure
  // part-way removes what was made.
  const MANUAL_NATURE = 'Manual Ledger'
  const tidy = (v) => { const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return t || null }
  ipcMain.handle('mappedTB:addManualLedger', async (_, tbIdArg, data = {}) => {
    if (!Number.isInteger(Number(tbIdArg))) throw new Error('Open one Trial Balance to add a ledger to - not the Consolidated view.')
    const tbId = Number(tbIdArg)
    await assertPeriodUnlockedForTB(tbId)
    const name = tidy(data.ledger_name)
    if (!name) throw new Error('Enter the name of the ledger.')
    if (name.length > 200) throw new Error('The ledger name is too long (200 characters at most).')
    const code = (tidy(data.ledger_code) || '').slice(0, 60) || null
    const dr = parseAdjustmentInput(data.adj_debit, 'Adjustments (Debit)')
    const cr = parseAdjustmentInput(data.adj_credit, 'Adjustments (Credit)')
    const { rows: [tb] } = await query(
      `SELECT tb.id, tb.period, e.constitution FROM trial_balances tb JOIN entities e ON e.id = tb.entity_id WHERE tb.id = $1`, [tbId])
    if (!tb) throw new Error('Trial Balance not found.')
    const { rows: [dup] } = await query(`SELECT name FROM tb_rows WHERE tb_id = $1 AND LOWER(TRIM(name)) = LOWER($2) LIMIT 1`, [tbId, name])
    if (dup) throw new Error(`A ledger named "${dup.name}" is already in this Trial Balance. Adjust that ledger instead, or give the new one a different name.`)

    // the mapping: every level the Level Format has for the chosen branch must be chosen
    const { rows: [rsRow] } = await query(`SELECT rule_set_id FROM mapped_tb WHERE tb_id = $1 AND rule_set_id IS NOT NULL LIMIT 1`, [tbId])
    const rsId = rsRow ? rsRow.rule_set_id : (await query(`SELECT id FROM mapping_rule_sets WHERE is_default = TRUE LIMIT 1`)).rows[0]?.id
    if (!rsId) throw new Error('No mapping rule set found for this Trial Balance.')
    const m1 = tidy(data.mapping1_resultant), m2 = tidy(data.mapping2_resultant), m3 = tidy(data.mapping3_resultant)
    const { rows: lf } = await query(`SELECT alie, level1, level2, level3 FROM level_format WHERE rule_set_id = $1 AND constitution = $2`, [rsId, tb.constitution])
    // a Level Format cell may hold alternates ("Secured, considered good / Unsecured, considered good / Doubtful"): the ledger takes one
    const hasAlt = (cell, v) => !!v && !!cell && (cell === v || String(cell).split('/').map(s => s.trim()).includes(v))
    const l1 = lf.filter(r => hasAlt(r.level1, m1))
    if (!m1 || !l1.length) throw new Error('Choose Mapping 1 from the list - the ledger must be mapped before it can be added.')
    if (l1.some(r => r.level2)) {
      if (!m2 || !l1.some(r => hasAlt(r.level2, m2))) throw new Error(`Choose Mapping 2 (category) under "${m1}".`)
    } else if (m2) throw new Error(`"${m1}" has no Mapping 2.`)
    const l2 = l1.filter(r => m2 ? hasAlt(r.level2, m2) : !r.level2)
    if (l2.some(r => r.level3)) {
      if (!m3 || !l2.some(r => hasAlt(r.level3, m3))) throw new Error(`Choose Mapping 3 (specific line item) under "${m2 || m1}".`)
    } else if (m3) throw new Error(`"${m2 || m1}" has no Mapping 3.`)
    const alie = l1[0].alie
    if (!alie) throw new Error('The Level Format has no side (Assets / Liabilities / Income / Expenses) for that mapping.')
    const dSide = alie === 'ASSETS' || alie === 'Expenses'

    // 1. the ledger (imported balance nil: its whole balance is its adjustment)
    const { rows: [tbRow] } = await query(
      `INSERT INTO tb_rows (tb_id, period, ledger_code, name, opening_balance, debit, credit, closing_balance, imported_closing_balance,
                            is_deemed_positive, upload_nature, parent, group_parent)
       VALUES ($1, $2, $3, $4, 0, 0, 0, 0, 0, $5, $6, 'Added on the Mapped TB', 'Added on the Mapped TB')
       RETURNING id`, [tbId, tb.period || '', code, name, dSide, MANUAL_NATURE])
    try {
      // 2. its mapping, by the Override button's own code
      const { rows: [mt] } = await query(
        `INSERT INTO mapped_tb (tb_id, tb_row_id, rule_set_id, alie, status, confidence, mapped_at, override_note)
         VALUES ($1, $2, $3, $4, 'user_override', 'high', NOW(), $5) RETURNING id`,
        [tbId, tbRow.id, rsId, alie, 'Added as a new ledger on the Mapped TB'])
      await doOverride(mt.id, {
        mapping1_resultant: m1, mapping2_resultant: m2, mapping3_resultant: m3, level_format_id: data.level_format_id || null,
        level4_value: data.level4_value || null, level5_value: data.level5_value || null, level6_value: data.level6_value || null, level7_value: data.level7_value || null,
        override_note: tidy(data.override_note) || 'Added as a new ledger on the Mapped TB',
      })
      // 3. its adjustment, by the statement the Adjustments columns use
      if (dr !== null || cr !== null) await query(ADJUSTMENT_SQL, [tbRow.id, dr !== null, dr, cr !== null, cr])
      await query(`UPDATE trial_balances SET row_count = (SELECT COUNT(*) FROM tb_rows WHERE tb_id = $1) WHERE id = $1`, [tbId])
      return { tb_row_id: tbRow.id, mapped_id: mt.id }
    } catch (e) {
      await query(`DELETE FROM tb_rows WHERE id = $1`, [tbRow.id])   // its mapping row goes with it
      throw e
    }
  })

  // Remove a ledger that was added here (never one from the imported Trial Balance - that is adjusted back instead)
  ipcMain.handle('mappedTB:deleteManualLedger', async (_, id) => {
    await assertPeriodUnlockedForMappedRow(id)
    const { rows: [cur] } = await query(
      `SELECT tr.id, tr.tb_id, tr.name, tr.ledger_code, tr.upload_nature, tr.closing_balance, tr.adj_debit, tr.adj_credit
         FROM mapped_tb mt JOIN tb_rows tr ON tr.id = mt.tb_row_id WHERE mt.id = $1`, [id])
    if (!cur) throw new Error('Ledger not found.')
    if (cur.upload_nature !== MANUAL_NATURE) throw new Error('Only a ledger added on the Mapped TB can be removed. A ledger from the imported Trial Balance can be adjusted back to its imported figure instead.')
    await query(
      `INSERT INTO tb_adjustment_log (tb_id, tb_row_id, ledger_name, ledger_code, old_adj_debit, old_adj_credit, new_adj_debit, new_adj_credit, closing_before, closing_after)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, $7, 0)`,
      [cur.tb_id, cur.id, `${cur.name} (ledger removed)`, cur.ledger_code, cur.adj_debit, cur.adj_credit, cur.closing_balance])
    await query(`DELETE FROM tb_rows WHERE id = $1`, [cur.id])
    await query(`UPDATE trial_balances SET row_count = (SELECT COUNT(*) FROM tb_rows WHERE tb_id = $1) WHERE id = $1`, [cur.tb_id])
    return { removed: true }
  })

  // The adjustments on a TB (or on every TB of an entity, for the consolidated
  // view) and what they do to the Trial Balance. A Trial Balance balances when
  // its signed closing balances sum to nil (the same test the upload applies).
  const NON_STOCK_ROW = `(tr.upload_nature IS NULL OR tr.upload_nature NOT IN ('Stock Entry', 'Stock Entry PY', 'Opening Stock (Manual)'))`
  const ADJ_SUMMARY_SQL = (from, where) => `
    SELECT
      COUNT(*) FILTER (WHERE tr.adj_debit IS NOT NULL OR tr.adj_credit IS NOT NULL) AS rows_adjusted,
      COALESCE(SUM(tr.adj_debit), 0)  AS total_debit,
      COALESCE(SUM(tr.adj_credit), 0) AS total_credit,
      COALESCE(SUM(COALESCE(tr.imported_closing_balance, tr.closing_balance)) FILTER (WHERE ${NON_STOCK_ROW}), 0) AS imported_sum,
      COALESCE(SUM(tr.closing_balance) FILTER (WHERE ${NON_STOCK_ROW}), 0) AS revised_sum,
      COALESCE(SUM(GREATEST(-COALESCE(tr.imported_closing_balance, tr.closing_balance), 0)) FILTER (WHERE ${NON_STOCK_ROW}), 0) AS imported_dr,
      COALESCE(SUM(GREATEST( COALESCE(tr.imported_closing_balance, tr.closing_balance), 0)) FILTER (WHERE ${NON_STOCK_ROW}), 0) AS imported_cr,
      COALESCE(SUM(GREATEST(-tr.closing_balance, 0)) FILTER (WHERE ${NON_STOCK_ROW}), 0) AS revised_dr,
      COALESCE(SUM(GREATEST( tr.closing_balance, 0)) FILTER (WHERE ${NON_STOCK_ROW}), 0) AS revised_cr
    FROM ${from} WHERE ${where}`
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
  ipcMain.handle('mappedTB:adjustmentSummary', async (_, arg) => {
    const byEntity = arg && typeof arg === 'object' && arg.entityId != null
    const { rows: [s] } = byEntity
      ? await query(ADJ_SUMMARY_SQL('tb_rows tr JOIN trial_balances tb ON tb.id = tr.tb_id', 'tb.entity_id = $1'), [arg.entityId])
      : await query(ADJ_SUMMARY_SQL('tb_rows tr', 'tr.tb_id = $1'), [arg])
    const out = {
      rows_adjusted: parseInt(s?.rows_adjusted) || 0,
      total_debit: round2(s?.total_debit), total_credit: round2(s?.total_credit),
      imported_dr: round2(s?.imported_dr), imported_cr: round2(s?.imported_cr), imported_sum: round2(s?.imported_sum),
      revised_dr: round2(s?.revised_dr), revised_cr: round2(s?.revised_cr), revised_sum: round2(s?.revised_sum),
    }
    out.difference = round2(out.total_debit - out.total_credit)
    out.adjustments_balanced = Math.abs(out.difference) < 0.005
    out.revised_balanced = Math.abs(out.revised_sum) <= 0.01
    return out
  })

  // Back to the imported figures: every adjustment on the TB removed in one go.
  ipcMain.handle('mappedTB:clearAdjustments', async (_, tbId) => {
    await assertPeriodUnlockedForTB(tbId)
    const { rows: [r] } = await query(
      `WITH cur AS (
         SELECT id, tb_id, name, ledger_code, closing_balance, adj_debit, adj_credit,
                COALESCE(imported_closing_balance, closing_balance, 0) AS imp
           FROM tb_rows
          WHERE tb_id = $1 AND (adj_debit IS NOT NULL OR adj_credit IS NOT NULL) FOR UPDATE
       ), upd AS (
         UPDATE tb_rows t
            SET adj_debit = NULL, adj_credit = NULL, imported_closing_balance = cur.imp, closing_balance = cur.imp
           FROM cur WHERE t.id = cur.id RETURNING t.id
       ), lg AS (
         INSERT INTO tb_adjustment_log
           (tb_id, tb_row_id, ledger_name, ledger_code, old_adj_debit, old_adj_credit, new_adj_debit, new_adj_credit, closing_before, closing_after)
         SELECT tb_id, id, name, ledger_code, adj_debit, adj_credit, NULL::numeric, NULL::numeric, closing_balance, imp FROM cur
       )
       SELECT COUNT(*)::int AS cleared FROM upd`,
      [tbId])
    return { cleared: r?.cleared || 0 }
  })

  ipcMain.handle('mappedTB:adjustmentLog', async (_, tbId) => {
    const { rows } = await query(
      `SELECT id, tb_row_id, ledger_name, ledger_code, old_adj_debit, old_adj_credit, new_adj_debit, new_adj_credit,
              closing_before, closing_after, changed_at
         FROM tb_adjustment_log WHERE tb_id = $1 ORDER BY id DESC LIMIT 1000`, [tbId])
    return rows
  })

  // ── Approve single row ────────────────────────────────────────────────────
  ipcMain.handle('mappedTB:approve', async (_, id) => {
    await assertPeriodUnlockedForMappedRow(id)
    const { rows: [r] } = await query(
      `UPDATE mapped_tb SET status='user_approved', mapped_at=NOW() WHERE id=$1 RETURNING *`, [id]
    )
    await recordLearnedRules([id])
    return parseMappedRow(r)
  })

  // ── Approve multiple rows ─────────────────────────────────────────────────
  ipcMain.handle('mappedTB:approveMany', async (_, ids) => {
    if (!ids.length) return { updated: 0 }
    await assertPeriodUnlockedForMappedRows(ids)
    // SQLite: expand array to IN (?,?,...)
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
    await query(
      `UPDATE mapped_tb SET status='user_approved', mapped_at=now() WHERE id IN (${placeholders})`,
      ids
    )
    await recordLearnedRules(ids)
    return { updated: ids.length }
  })

  // ── Override single row ───────────────────────────────────────────────────
  // The override of one ledger's mapping - the same code serves the Override button and a ledger added on the Mapped TB
  const doOverride = async (id, data) => {
    let alie = null
    if (data.mapping1_resultant) {
      const { rows: [lfRow] } = await query(
        `SELECT alie FROM level_format WHERE level1 = $1 AND alie IS NOT NULL LIMIT 1`,
        [data.mapping1_resultant]
      )
      if (lfRow) alie = lfRow.alie
    }
    const { rows: [r] } = await query(
      `UPDATE mapped_tb SET
         mapping1_resultant=$1, mapping2_resultant=$2, mapping3_resultant=$3,
         level_format_id=COALESCE(${CLIENT_LF_SQL(4, 1, 2)}, ${RESOLVE_LF_SQL(1, 2, 3)}),
         level4_value=$5, level5_value=$6, level6_value=$7, level7_value=$8,
         override_note=$9, alie=COALESCE($11, alie), status='user_override', confidence='high', hand_fixed=TRUE,
         conflict_candidates=NULL, conflict_stage=NULL, mapped_at=NOW()
       WHERE id=$10 RETURNING *`,
      [data.mapping1_resultant, data.mapping2_resultant, data.mapping3_resultant,
       data.level_format_id || null, data.level4_value || null, data.level5_value || null,
       data.level6_value || null, data.level7_value || null,
       data.override_note || null, id, alie]
    )
    await recordLearnedRules([id])
    const { rows: [meta] } = await query(
      `SELECT tr.name AS ledger_name, tb.entity_id
       FROM mapped_tb mt
       JOIN tb_rows tr ON tr.id = mt.tb_row_id
       JOIN trial_balances tb ON tb.id = mt.tb_id
       WHERE mt.id = $1`,
      [id]
    )
    if (meta) {
      await propagateToOtherTBs(meta.entity_id, (meta.ledger_name || '').trim().toLowerCase(), {
        mapping1_resultant: r.mapping1_resultant, mapping2_resultant: r.mapping2_resultant,
        mapping3_resultant: r.mapping3_resultant, level_format_id: r.level_format_id,
        level4_value: r.level4_value, level5_value: r.level5_value,
        level6_value: r.level6_value, level7_value: r.level7_value, alie: r.alie,
      }, r.tb_id)
    }
    return parseMappedRow(r)
  }
  ipcMain.handle('mappedTB:override', async (_, id, data) => {
    await assertPeriodUnlockedForMappedRow(id)
    return doOverride(id, data)
  })

  // ── Override multiple rows with same mapping ───────────────────────────────
  ipcMain.handle('mappedTB:overrideMany', async (_, ids, data) => {
    await assertPeriodUnlockedForMappedRows(ids)
    let alie = null
    if (data.mapping1_resultant) {
      const { rows: [lfRow] } = await query(
        `SELECT alie FROM level_format WHERE level1 = $1 AND alie IS NOT NULL LIMIT 1`,
        [data.mapping1_resultant]
      )
      if (lfRow) alie = lfRow.alie
    }
    for (const id of ids) {
      await query(
        `UPDATE mapped_tb SET
           mapping1_resultant=$1, mapping2_resultant=$2, mapping3_resultant=$3,
           level_format_id=COALESCE(${CLIENT_LF_SQL(4, 1, 2)}, ${RESOLVE_LF_SQL(1, 2, 3)}),
           level4_value=$5, level5_value=$6, level6_value=$7, level7_value=$8,
           override_note=$9, alie=COALESCE($11, alie), status='user_override', confidence='high', hand_fixed=TRUE,
           conflict_candidates=NULL, conflict_stage=NULL, mapped_at=NOW()
         WHERE id=$10`,
        [data.mapping1_resultant, data.mapping2_resultant, data.mapping3_resultant,
         data.level_format_id || null, data.level4_value || null, data.level5_value || null,
         data.level6_value || null, data.level7_value || null,
         data.override_note || null, id, alie]
      )
    }
    await recordLearnedRules(ids)
    {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
      const { rows: metas } = await query(
        `SELECT mt.id, mt.tb_id, tr.name AS ledger_name, tb.entity_id
         FROM mapped_tb mt
         JOIN tb_rows tr ON tr.id = mt.tb_row_id
         JOIN trial_balances tb ON tb.id = mt.tb_id
         WHERE mt.id IN (${placeholders})`,
        ids
      )
      const patch = {
        mapping1_resultant: data.mapping1_resultant, mapping2_resultant: data.mapping2_resultant,
        mapping3_resultant: data.mapping3_resultant, level_format_id: data.level_format_id || null,
        level4_value: data.level4_value || null, level5_value: data.level5_value || null,
        level6_value: data.level6_value || null, level7_value: data.level7_value || null, alie,
      }
      for (const m of metas) {
        await propagateToOtherTBs(m.entity_id, (m.ledger_name || '').trim().toLowerCase(), patch, m.tb_id)
      }
    }
    return { updated: ids.length }
  })

  // ── Bulk set level5_value for rows matching an M2 pattern ────────────────
  ipcMain.handle('mappedTB:bulkSetLevel5', async (_, { tbId, mapping2Pattern, level5Value }) => {
    await assertPeriodUnlockedForTB(tbId)
    const like = `%${(mapping2Pattern || '').toLowerCase()}%`
    const { rows } = await query(
      `UPDATE mapped_tb SET level5_value=$1
       WHERE tb_id=$2
         AND LOWER(TRIM(COALESCE(mapping2_resultant, ''))) LIKE $3
         AND (level5_value IS NULL OR TRIM(level5_value) = '')
       RETURNING id`,
      [level5Value, tbId, like]
    )
    await recordLearnedRules(rows.map(r => r.id))   // a bulk nature assignment is a decision too
    return { updated: rows.length }
  })

  // ── Bulk set mapping3_resultant (Level 3) for rows matching an M2 pattern ──
  // Used for Trade Payables (MSME) / Trade Receivables (Secured/Unsecured)
  // nature assignment — that classification lives at Level 3 for every
  // constitution (see schema.js's Level 5→3 migration), unlike bulkSetLevel5
  // above which is still used for other, genuinely Level-5 classifications.
  ipcMain.handle('mappedTB:bulkSetLevel3', async (_, { tbId, mapping2Pattern, level3Value }) => {
    await assertPeriodUnlockedForTB(tbId)
    const like = `%${(mapping2Pattern || '').toLowerCase()}%`
    const { rows } = await query(
      `UPDATE mapped_tb SET mapping3_resultant=$1
       WHERE tb_id=$2
         AND LOWER(TRIM(COALESCE(mapping2_resultant, ''))) LIKE $3
         AND (mapping3_resultant IS NULL OR TRIM(mapping3_resultant) = '')
       RETURNING id`,
      [level3Value, tbId, like]
    )
    await recordLearnedRules(rows.map(r => r.id))
    return { updated: rows.length }
  })

  // ── Mark rows as Needs Review ─────────────────────────────────────────────
  ipcMain.handle('mappedTB:markReview', async (_, ids) => {
    if (!ids.length) return { updated: 0 }
    await assertPeriodUnlockedForMappedRows(ids)
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
    await query(
      `UPDATE mapped_tb SET status='needs_review', mapped_at=now() WHERE id IN (${placeholders})`,
      ids
    )
    return { updated: ids.length }
  })

  // ── Resolve conflict ──────────────────────────────────────────────────────
  ipcMain.handle('mappedTB:resolveConflict', async (_, id, chosen) => {
    await assertPeriodUnlockedForMappedRow(id)
    const { rows: [mt] } = await query(`SELECT * FROM mapped_tb WHERE id=$1`, [id])
    if (!mt) throw new Error('Row not found.')

    let m3Resultant = chosen.mapping3_resultant || null
    let lfId = chosen.level_format_id || null

    if (mt.conflict_stage === 2 && !m3Resultant) {
      const { rows: m3Rows } = await query(
        `SELECT * FROM map3
         WHERE rule_set_id=$1 AND constitution=(
           SELECT e.constitution FROM trial_balances tb JOIN entities e ON e.id=tb.entity_id WHERE tb.id=$2
         )
         AND mapping1_resultant=$3 AND mapping2_resultant=$4
         ORDER BY priority, id`,
        [mt.rule_set_id, mt.tb_id, mt.mapping1_resultant, chosen.mapping2_resultant]
      )
      const { rows: [tbRow] } = await query(`SELECT name FROM tb_rows WHERE id=$1`, [mt.tb_row_id])
      const name = tbRow?.name || ''
      const match = m3Rows.find(m => {
        if (!m.keywords || !name) return false
        return m.keywords.split('|').some(k => {
          const kTrimmed = k.trim()
          if (!kTrimmed) return false
          try { return new RegExp(`\\b${kTrimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(name) }
          catch { return name.toLowerCase().includes(kTrimmed.toLowerCase()) }
        })
      })
      if (match) m3Resultant = match.mapping3_resultant
    }

    if (chosen.mapping2_resultant && m3Resultant) {
      const m2c = chosen.mapping2_resultant.replace(/\s*\(specify nature\)/gi, '').trim().toLowerCase()
      const m3c = m3Resultant.replace(/\s*\(specify nature\)/gi, '').trim().toLowerCase()
      const { rows: [lfRow] } = await query(
        `SELECT id FROM level_format
         WHERE rule_set_id=$1
           AND ${SPEC_NATURE_SQL('level2')} = $2
           AND ${SPEC_NATURE_SQL('level3')} = $3
         LIMIT 1`,
        [mt.rule_set_id, m2c, m3c]
      )
      if (lfRow) lfId = lfRow.id
    }

    const newStatus = m3Resultant ? (lfId ? 'auto_high' : 'auto_medium') : 'auto_medium'

    const { rows: [r] } = await query(
      `UPDATE mapped_tb SET
         mapping2_resultant=$1, mapping3_resultant=$2,
         level_format_id=$3,
         conflict_candidates=NULL, conflict_stage=NULL,
         status=$4, confidence=$5, mapped_at=NOW()
       WHERE id=$6 RETURNING *`,
      [chosen.mapping2_resultant, m3Resultant, lfId,
       newStatus, newStatus === 'auto_high' ? 'high' : 'medium', id]
    )
    await recordLearnedRules([id])   // the CA chose between the candidates — remember it like any other decision
    return parseMappedRow(r)
  })

  // ── Clear all mappings for a TB ──────────────────────────────────────────
  ipcMain.handle('mappedTB:clearAll', async (_, tbId) => {
    await assertPeriodUnlockedForTB(tbId)
    const { rowCount } = await query(`DELETE FROM mapped_tb WHERE tb_id = $1`, [tbId])
    return { deleted: rowCount }
  })

  // ── Download mapped TB as Excel ───────────────────────────────────────────
  ipcMain.handle('mappedTB:downloadExcel', async (_, tbId) => {
    const { rows } = await query(
      `SELECT
         tr.period, tr.branch, tr.ledger_code, tr.name,
         tr.opening_balance, tr.debit, tr.credit, tr.closing_balance,
         tr.adj_debit, tr.adj_credit, tr.imported_closing_balance,
         tr.is_revenue, tr.is_deemed_positive, tr.trail_balance,
         tr.parent, tr.group_parent,
         tr.group_parent_1, tr.group_parent_2, tr.group_parent_3,
         tr.group_parent_4, tr.group_parent_5, tr.group_parent_6,
         tr.group_parent_7, tr.group_parent_8,
         mt.alie, mt.mapping1_resultant, mt.mapping2_resultant, mt.mapping3_resultant,
         mt.level4_value, mt.level5_value, mt.level6_value, mt.level7_value,
         mt.status, mt.confidence, mt.override_note,
         lf.level1, lf.level2, lf.level3,
         lf.level4 AS lf_level4, lf.level5 AS lf_level5, lf.level6 AS lf_level6, lf.level7 AS lf_level7,
         tb.branch_name
       FROM mapped_tb mt
       JOIN tb_rows tr ON tr.id = mt.tb_row_id
       JOIN trial_balances tb ON tb.id = mt.tb_id
       LEFT JOIN level_format lf ON lf.id = mt.level_format_id
       WHERE mt.tb_id = $1
       ORDER BY tr.name`,
      [tbId]
    )

    const data = rows.map(r => ({
      'Period': r.period,
      // The branch this whole Trial Balance belongs to (set when it was
      // uploaded) — same on every row, but lets a CA tell branch files apart
      // once several are open side by side. Distinct from 'Branch' below,
      // which is a raw per-ledger import field almost always blank.
      'Branch Name': r.branch_name || '',
      'Branch': r.branch,
      'Ledger Code': r.ledger_code,
      'Ledger Name': r.name,
      'Opening Balance': r.opening_balance,
      'Debit': r.debit,
      'Credit': r.credit,
      // As imported; the revised figure (what the statements use) follows the Adjustments.
      'Closing Balance': r.imported_closing_balance ?? r.closing_balance,
      'Opn Bal (Debit)':  r.is_deemed_positive ? (r.opening_balance || 0) * -1 : null,
      'Opn Bal (Credit)': r.is_deemed_positive ? null : r.opening_balance,
      'Clos Bal (Debit)':  r.is_deemed_positive ? ((r.imported_closing_balance ?? r.closing_balance) || 0) * -1 : null,
      'Clos Bal (Credit)': r.is_deemed_positive ? null : (r.imported_closing_balance ?? r.closing_balance),
      'Adjustments (Debit)':  r.adj_debit,
      'Adjustments (Credit)': r.adj_credit,
      'Revised Clos Bal (Debit)':  r.is_deemed_positive ? (r.closing_balance || 0) * -1 : null,
      'Revised Clos Bal (Credit)': r.is_deemed_positive ? null : r.closing_balance,
      'Is Revenue': r.is_revenue,
      'Is Deemed Positive': r.is_deemed_positive,
      'Trail Balance': r.trail_balance,
      'Parent': r.parent,
      'Group Parent': r.group_parent,
      'Group Parent 1': r.group_parent_1,
      'Group Parent 2': r.group_parent_2,
      'Group Parent 3': r.group_parent_3,
      'Group Parent 4': r.group_parent_4,
      'Group Parent 5': r.group_parent_5,
      'Group Parent 6': r.group_parent_6,
      'Group Parent 7': r.group_parent_7,
      'Group Parent 8': r.group_parent_8,
      'ALIE': r.alie,
      'Mapping 1 (Broad)': r.mapping1_resultant,
      'Mapping 2 (Category)': r.mapping2_resultant,
      'Mapping 3 (Specific)': r.mapping3_resultant,
      'Level 1': r.level1,
      'Level 2': r.level2,
      'Level 3': r.level3,
      'Level 4': r.level4_value || r.lf_level4,
      'Level 5': r.level5_value || r.lf_level5,
      'Level 6': r.level6_value || r.lf_level6,
      'Level 7': r.level7_value || r.lf_level7,
      'Status': r.status,
      'Confidence': r.confidence,
      'Override Note': r.override_note,
    }))

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(data)
    ws['!cols'] = Object.keys(data[0] || {}).map(() => ({ wch: 20 }))
    XLSX.utils.book_append_sheet(wb, ws, 'Mapped TB')
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  })

  // ── Learned Ledger Rules — download/upload ────────────────────────────────
  // See schema.js's learned_ledger_rules: an entity's finalised per-ledger
  // classifications, durable and TB-independent (survives deleting every TB
  // for the entity). The exported file carries no entity identity — only
  // ledger name + mapping — so it can be uploaded into a DIFFERENT entity
  // (a genuinely different company, or a freshly-created duplicate of the
  // same one), exactly like the existing Map1/2/3 rules download/upload.
  ipcMain.handle('learnedRules:download', async (_, entityId) => {
    const { rows } = await query(
      `SELECT ledger_name, mapping1_resultant, mapping2_resultant, mapping3_resultant,
              level4_value, level5_value, level6_value, level7_value, alie, source_branch_name, updated_at
       FROM learned_ledger_rules WHERE entity_id = $1 ORDER BY ledger_name`,
      [entityId]
    )
    // Branch is informational only — the branch whose TB last recorded/
    // confirmed this rule (see recordLearnedRules). A rule still applies
    // across every branch of the entity; this column just helps a CA locate
    // where a ledger came from. Blank for a single-branch entity.
    const data = rows.map(r => ({
      'Ledger Name': r.ledger_name,
      'Branch': r.source_branch_name || '',
      'ALIE': r.alie,
      'Mapping 1 (Broad)': r.mapping1_resultant,
      'Mapping 2 (Category)': r.mapping2_resultant,
      'Mapping 3 (Specific)': r.mapping3_resultant,
      'Level 4': r.level4_value,
      'Level 5': r.level5_value,
      'Level 6': r.level6_value,
      'Level 7': r.level7_value,
      'Last Updated': r.updated_at,
    }))
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ 'Ledger Name': '' }])
    ws['!cols'] = Object.keys(data[0] || { 'Ledger Name': '' }).map(() => ({ wch: 22 }))
    XLSX.utils.book_append_sheet(wb, ws, 'Learned Ledger Rules')
    return { buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), count: rows.length }
  })

  ipcMain.handle('learnedRules:upload', async (_, entityId, fileBytes) => {
    const wb = XLSX.read(new Uint8Array(fileBytes), { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames.find(n => /learned/i.test(n)) || wb.SheetNames[0]]
    const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' })
    // Headers are matched loosely (case, spacing, the "(Broad)" suffixes) so a
    // file that was edited or re-saved in Excel, or an older export, still
    // imports; every value is trimmed. Blank cells become NULL, never ''.
    const norm = (h) => h.toString().toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    const WANT = { ledger: /^ledger name$/, alie: /^alie$/, m1: /^mapping ?1$/, m2: /^mapping ?2$/, m3: /^mapping ?3$/, l4: /^level ?4$/, l5: /^level ?5$/, l6: /^level ?6$/, l7: /^level ?7$/ }
    const colOf = {}
    for (const h of Object.keys(rawRows[0] || {})) {
      const n = norm(h)
      for (const [k, rx] of Object.entries(WANT)) if (!colOf[k] && rx.test(n)) colOf[k] = h
    }
    if (!colOf.ledger || !colOf.m1) throw new Error('This is not a Learned Ledger Rules file: it needs at least the "Ledger Name" and "Mapping 1" columns.')
    const val = (r, k) => (colOf[k] ? r[colOf[k]] : '').toString().trim() || null
    const rows = rawRows.map(r => ({
      'Ledger Name': val(r, 'ledger') || '', 'Mapping 1 (Broad)': val(r, 'm1') || '', 'Mapping 2 (Category)': val(r, 'm2') || '', 'Mapping 3 (Specific)': val(r, 'm3') || '',
      'Level 4': val(r, 'l4') || '', 'Level 5': val(r, 'l5') || '', 'Level 6': val(r, 'l6') || '', 'Level 7': val(r, 'l7') || '', 'ALIE': val(r, 'alie') || '',
    }))
    // Custom captions (not in the Level Format for this constitution) are
    // legitimate — they are exactly the lines a CA adds by hand — but they are
    // reported so nothing disappears silently.
    const { rows: [ent] } = await query(`SELECT constitution FROM entities WHERE id = $1`, [entityId])
    const { rows: lfRows } = await query(
      `SELECT level1, level2 FROM level_format WHERE constitution = $1 AND rule_set_id = (SELECT id FROM mapping_rule_sets WHERE is_default = TRUE LIMIT 1)`,
      [ent?.constitution || 0])
    const known1 = new Set(lfRows.map(r => r.level1)), known2 = new Set(lfRows.filter(r => r.level2).map(r => r.level1 + '||' + r.level2))
    const customCaptions = new Set()
    let applied = 0, skipped = 0
    const seen = new Set()
    for (const r of rows) {
      const ledgerName = (r['Ledger Name'] || '').toString().trim()
      const mapping1 = (r['Mapping 1 (Broad)'] || '').toString().trim()
      if (!ledgerName || !mapping1) { skipped++; continue }
      const key = ledgerName.toLowerCase()
      if (seen.has(key)) { skipped++; continue }   // duplicate name in the file: first row wins
      seen.add(key)
      const m2 = (r['Mapping 2 (Category)'] || '').toString().trim()
      if (!known1.has(mapping1)) customCaptions.add(mapping1)
      else if (m2 && !known2.has(mapping1 + '||' + m2)) customCaptions.add(mapping1 + ' > ' + m2)
      await query(
        `INSERT INTO learned_ledger_rules
           (entity_id, ledger_name_key, ledger_name, mapping1_resultant, mapping2_resultant, mapping3_resultant,
            level4_value, level5_value, level6_value, level7_value, alie, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
         ON CONFLICT(entity_id, ledger_name_key) DO UPDATE SET
           ledger_name = excluded.ledger_name,
           mapping1_resultant = excluded.mapping1_resultant,
           mapping2_resultant = excluded.mapping2_resultant,
           mapping3_resultant = excluded.mapping3_resultant,
           level4_value = excluded.level4_value,
           level5_value = excluded.level5_value,
           level6_value = excluded.level6_value,
           level7_value = excluded.level7_value,
           alie = excluded.alie,
           updated_at = excluded.updated_at`,
        [entityId, key, ledgerName, mapping1,
         (r['Mapping 2 (Category)'] || '').toString().trim() || null,
         (r['Mapping 3 (Specific)'] || '').toString().trim() || null,
         (r['Level 4'] || '').toString().trim() || null,
         (r['Level 5'] || '').toString().trim() || null,
         (r['Level 6'] || '').toString().trim() || null,
         (r['Level 7'] || '').toString().trim() || null,
         (r['ALIE'] || '').toString().trim() || null]
      )
      applied++
    }
    // Storing the rules is only half the job — without this the file appeared
    // to import successfully while nothing on any Trial Balance changed, since
    // the rules would not have been consulted until each TB was manually
    // re-run through Auto-Mapping.
    const reapplied = await applyLearnedRulesToEntityTBs(entityId)
    // Which uploaded ledger names exist on NO Trial Balance of this entity —
    // the honest answer to "why did only some rules work": those ledgers are
    // named differently in this company's books.
    const { rows: unmatchedRows } = await query(
      `SELECT lr.ledger_name FROM learned_ledger_rules lr
        WHERE lr.entity_id = $1
          AND NOT EXISTS (SELECT 1 FROM tb_rows tr JOIN trial_balances tb ON tb.id = tr.tb_id
                          WHERE tb.entity_id = $1 AND LOWER(TRIM(tr.name)) = lr.ledger_name_key)
        ORDER BY lr.ledger_name`, [entityId])
    // NB: `applied` here is the number of RULES imported from the file; the
    // rows updated on Trial Balances are returned separately (an earlier
    // version spread `reapplied` over it, so an upload into an entity whose TB
    // was not yet mapped reported "Imported 0 rules" although all were stored).
    return { applied, skipped, rowsApplied: reapplied.applied, tbsTouched: reapplied.tbsTouched, tbsLocked: reapplied.tbsLocked,
             unmatched: unmatchedRows.map(r => r.ledger_name), customCaptions: [...customCaptions].sort() }
  })

  // Apply the entity's stored learned rules to its TBs on demand, without
  // needing a rules file or a full Auto-Mapping re-run.
  ipcMain.handle('learnedRules:apply', async (_, entityId) =>
    applyLearnedRulesToEntityTBs(entityId))

  // Distinct Mapping 1/2/3 combinations the entity has ever finalised. The
  // Rectification dropdowns build their custom ("+ Custom line...") options
  // from the CURRENT TB's mapped rows alone, so a caption created on an
  // earlier TB disappeared from the list the moment a fresh TB was uploaded —
  // the rule still existed, but there was no way to pick it again by hand.
  ipcMain.handle('learnedRules:list', async (_, entityId) => {
    const { rows } = await query(
      `SELECT DISTINCT mapping1_resultant, mapping2_resultant, mapping3_resultant
         FROM learned_ledger_rules
        WHERE entity_id = $1 AND mapping1_resultant IS NOT NULL`,
      [entityId]
    )
    return rows
  })

  // ── Resolve discrepancy ───────────────────────────────────────────────────
  ipcMain.handle('mappedTB:resolveDiscrepancy', async (_, id, action, chosenOption) => {
    await assertPeriodUnlockedForMappedRow(id)
    const { rows: [mt] } = await query(`SELECT * FROM mapped_tb WHERE id=$1`, [id])
    if (!mt) throw new Error('Row not found.')

    if (action === 'keep') {
      const { rows: [r] } = await query(
        `UPDATE mapped_tb SET
           status='auto_low', confidence='low',
           discrepancy_suggestion=NULL, mapped_at=NOW()
         WHERE id=$1 RETURNING *`,
        [id]
      )
      return parseMappedRow(r)
    }

    const { mapping1, mapping2 } = chosenOption
    const { rows: [tbRow] } = await query(`SELECT name FROM tb_rows WHERE id=$1`, [mt.tb_row_id])
    const name = tbRow?.name || ''

    const { rows: m3Rows } = await query(
      `SELECT * FROM map3
       WHERE rule_set_id=$1
         AND constitution=(
           SELECT e.constitution FROM trial_balances tb
           JOIN entities e ON e.id=tb.entity_id WHERE tb.id=$2
         )
         AND mapping1_resultant=$3 AND mapping2_resultant=$4
       ORDER BY priority, id`,
      [mt.rule_set_id, mt.tb_id, mapping1, mapping2]
    )

    let m3Resultant = null
    for (const m of m3Rows) {
      if (!m.keywords || !name) continue
      const hits = m.keywords.split('|').some(k => {
        const kTrimmed = k.trim()
        if (!kTrimmed) return false
        try { return new RegExp(`\\b${kTrimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(name) }
        catch { return name.toLowerCase().includes(kTrimmed.toLowerCase()) }
      })
      if (hits) { m3Resultant = m.mapping3_resultant; break }
    }

    let lfId = null
    const m2c = mapping2.replace(/\s*\(specify nature\)/gi, '').trim().toLowerCase()
    if (m3Resultant) {
      const m3c = m3Resultant.replace(/\s*\(specify nature\)/gi, '').trim().toLowerCase()
      const { rows: [lfRow] } = await query(
        `SELECT id FROM level_format
         WHERE rule_set_id=$1
           AND ${SPEC_NATURE_SQL('level2')} = $2
           AND ${SPEC_NATURE_SQL('level3')} = $3
         LIMIT 1`,
        [mt.rule_set_id, m2c, m3c]
      )
      if (lfRow) lfId = lfRow.id
    } else {
      const { rows: [lfRow] } = await query(
        `SELECT id FROM level_format
         WHERE rule_set_id=$1
           AND ${SPEC_NATURE_SQL('level2')} = $2
         LIMIT 1`,
        [mt.rule_set_id, m2c]
      )
      if (lfRow) lfId = lfRow.id
    }

    const newStatus = m3Resultant ? (lfId ? 'auto_high' : 'auto_medium') : 'auto_medium'
    const newConf   = newStatus === 'auto_high' ? 'high' : 'medium'

    const { rows: [r] } = await query(
      `UPDATE mapped_tb SET
         mapping1_resultant=$1, mapping2_resultant=$2, mapping3_resultant=$3,
         level_format_id=$4, status=$5, confidence=$6,
         discrepancy_suggestion=NULL, mapped_at=NOW()
       WHERE id=$7 RETURNING *`,
      [mapping1, mapping2, m3Resultant, lfId, newStatus, newConf, id]
    )
    await recordLearnedRules([id])   // accepted discrepancy suggestion = a decision — remember it
    return parseMappedRow(r)
  })

  // ── Find ledgers matching a filter ────────────────────────────────────────
  // The distinct Mapping 1/2/3 captions in use on a Trial Balance: what the Rectification screen's dropdowns offer as
  // "custom" values. It used to fetch EVERY mapped row of the TB for this (76 MB for 67,000 ledgers).
  ipcMain.handle('mappedTB:captionTuples', async (_, tbId) => {
    const { rows } = await query(
      `SELECT DISTINCT mapping1_resultant, mapping2_resultant, mapping3_resultant FROM mapped_tb WHERE tb_id = $1`, [tbId])
    return rows
  })

  ipcMain.handle('mappedTB:findByFilter', async (_, tbId, filter = {}) => {
    const conds = ['mt.tb_id = $1']
    const params = [tbId]
    let idx = 2
    let withCombos = ''
    if (filter.alie)               { conds.push(`mt.alie = $${idx++}`);               params.push(filter.alie) }
    if (filter.mapping1_resultant) { conds.push(`mt.mapping1_resultant = $${idx++}`); params.push(filter.mapping1_resultant) }
    if (filter.mapping2_resultant) { conds.push(`mt.mapping2_resultant = $${idx++}`); params.push(filter.mapping2_resultant) }
    if (filter.mapping3_resultant) { conds.push(`mt.mapping3_resultant = $${idx++}`); params.push(filter.mapping3_resultant) }
    if (filter.level1Pattern)      { conds.push(`mt.mapping1_resultant ILIKE $${idx++}`); params.push(`%${filter.level1Pattern}%`) }
    if (filter.level5_unclassified) {
      conds.push(`(mt.level5_value IS NULL OR TRIM(mt.level5_value) = '')`)
    } else if (filter.level5_value) {
      conds.push(`mt.level5_value = $${idx++}`); params.push(filter.level5_value)
    }
    if (filter.uncategorised) {
      // Level Format rows of ANOTHER constitution never decide whether THIS ledger still lacks a Level 4 /
      // Level 5 (see level45Unresolved). Company's Trade payables / Trade receivables were queued as "unresolved"
      // whenever Partnership's or LLP's rows still carried a Level 5 option list - which is exactly the state
      // right after every default-mapping reseed, until the next launch migrates Level 5 -> Level 3.
      let constCond = ''
      {
        const { rows: [ent] } = await query(
          `SELECT e.constitution FROM trial_balances tb JOIN entities e ON e.id = tb.entity_id WHERE tb.id = $1`, [tbId])
        if (ent?.constitution) { constCond = `AND lf.constitution = $${idx++}`; params.push(ent.constitution) }
      }
      // A genuinely blank/synthetic-"Uncategorised…" mapping1/2/3 can NEVER
      // be excluded by status='user_override' — that status just means
      // *someone last touched Save on this row*, not that they filled in a
      // real classification. mappedTB:override sets status='user_override'
      // unconditionally, even when Mapping 2/3 were left blank, and that
      // status (plus whatever was/wasn't filled in) then gets carried
      // forward on every re-run (applyCarryForward), pushed to sibling TBs
      // (propagateToOtherTBs), and persisted entity-wide (learned_ledger_
      // rules) — so one incomplete save used to permanently and silently
      // vanish a ledger from every "needs recategorisation" queue, even
      // though the BS/PL/Mapped TB screens (which only look at mapping
      // content, not status) kept showing it as uncategorised.
      // A blank Mapping 2 only means "not categorised yet" when the format
      // actually defines a Level 2 under that Level 1. Several Level 1 captions
      // are terminal by design — Partners' Remuneration, Purchases of
      // Stock-in-Trade, Cost of materials consumed, Finance Costs and others
      // have no Level 2 anywhere in Mapping_v2 — so treating their empty
      // Mapping 2 as uncategorised meant those ledgers could never be cleared:
      // they reappeared in this queue after every save, however correctly they
      // had been categorised. Scoped to the row's own rule set where it has one,
      // since a caption can be terminal under one constitution and not another.
      // ...unless the SAME Level 1 also has a terminal row (level2 IS NULL) in
      // this rule set. Mapping_v2 defines several captions both ways - Finance
      // Costs is a terminal row AND has four Level-2 children - and a ledger
      // classified at the terminal level is complete, not unfinished. Without
      // this, 19 correctly categorised Finance Costs ledgers sat in the queue
      // permanently, reappearing after every save. Level 1 is compared with
      // "(specify nature)" stripped, as everywhere else.
      const level2Expected = `(
        EXISTS (
          SELECT 1 FROM level_format lf
          WHERE ${SPEC_NATURE_SQL('lf.level1')} = ${SPEC_NATURE_SQL('mt.mapping1_resultant')}
            AND lf.level2 IS NOT NULL AND TRIM(lf.level2) <> ''
            AND (mt.rule_set_id IS NULL OR lf.rule_set_id = mt.rule_set_id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM level_format lf
          WHERE ${SPEC_NATURE_SQL('lf.level1')} = ${SPEC_NATURE_SQL('mt.mapping1_resultant')}
            AND lf.level2 IS NULL
            AND (mt.rule_set_id IS NULL OR lf.rule_set_id = mt.rule_set_id)
        )
      )`
      const coreUncat = `(
        mt.mapping1_resultant IS NULL OR mt.mapping1_resultant = '' OR
        LOWER(COALESCE(mt.mapping1_resultant,'')) LIKE '%uncategorised%' OR
        LOWER(COALESCE(mt.mapping2_resultant,'')) LIKE '%uncategorised%' OR
        LOWER(COALESCE(mt.mapping3_resultant,'')) LIKE '%uncategorised%' OR
        (
          (mt.mapping2_resultant IS NULL OR TRIM(mt.mapping2_resultant) = '')
          AND ${level2Expected}
        )
      )`
      // Mapping 1/2 are both genuinely resolved here — only a deeper
      // "specify nature" (level4/level5) detail is missing. This narrower
      // case keeps the original behaviour: once the user has explicitly
      // reviewed/saved it (user_override), stop re-flagging it.
      // Postgres: "IS NOT" only compares against NULL/TRUE/FALSE, not an
      // arbitrary string — that needs IS DISTINCT FROM (also NULL-safe).
      const level45Unresolved = `(
        mt.mapping1_resultant IS NOT NULL AND mt.mapping2_resultant IS NOT NULL
        -- Both statuses are explicit user decisions. Carry-forward and learned
        -- rules re-write an override as user_approved on every re-run, so
        -- exempting only user_override re-queued 43 PPE / Sale / Other
        -- non-current-asset ledgers the CA had already reviewed, each time the
        -- mapping was re-run - "rectified but never vanishes".
        AND COALESCE(mt.status, '') NOT IN ('user_override', 'user_approved')
        AND EXISTS (
          SELECT 1 FROM level_format lf
          WHERE lf.level1 = mt.mapping1_resultant
            AND lf.level2 = mt.mapping2_resultant
            AND (mt.rule_set_id IS NULL OR lf.rule_set_id = mt.rule_set_id)
            ${constCond}
            -- ...and only the Level Format row(s) of the ledger's OWN Level 3. Matching on Level 1 + Level 2 alone
            -- let a sibling line's options queue every ledger under the same Level 2: Advance from Customers
            -- (Other current liabilities) because Statutory dues payable has a Level 4 list, Sale of Products
            -- because another Sale line has a Level 5 list. Level 3 may itself be an option list ("Due to MSME /
            -- Due to Creditors other than MSME"): the ledger's Level 3 is then one of the options.
            AND (
              ${SPEC_NATURE_SQL(`COALESCE(lf.level3, '')`)} = ${SPEC_NATURE_SQL(`COALESCE(mt.mapping3_resultant, '')`)}
              OR EXISTS (
                SELECT 1 FROM unnest(string_to_array(COALESCE(lf.level3, ''), '/')) AS o(opt)
                WHERE TRIM(o.opt) <> '' AND ${SPEC_NATURE_SQL('o.opt')} = ${SPEC_NATURE_SQL(`COALESCE(mt.mapping3_resultant, '')`)}
              )
            )
            AND (
              (
                lf.level4 IS NOT NULL AND TRIM(lf.level4) <> ''
                AND STRPOS(lf.level4, '/') > 0
                AND (mt.level4_value IS NULL OR TRIM(mt.level4_value) = '')
              )
              OR
              (
                lf.level5 IS NOT NULL AND TRIM(lf.level5) <> ''
                AND STRPOS(lf.level5, '/') > 0
                AND (mt.level5_value IS NULL OR TRIM(mt.level5_value) = '')
              )
            )
        )
      )`
      // Discrepancy and conflict rows are shown on Mapped TB but were absent
      // here, because the engine gives them a full Mapping 1/2/3 and so they
      // matched none of the tests above — leaving the one screen built for
      // fixing categorisation unable to see the rows most in need of it. They
      // carry their own status, which the Status column renders, and their
      // candidate options remain available through the Mapped TB resolvers.
      const flaggedByEngine = `mt.status IN ('discrepancy', 'conflict')`
      // A Level 2 the format places only on the OTHER statement than the
      // ledger's Level 1 - e.g. "Short-term loans and advances" (Balance Sheet)
      // left under "Purchases of Stock-in-Trade" (P&L). The statements leave
      // such a heading out (useFinancials.js ignoreForeignLevel2) and the
      // Exception Report lists the ledger; it must be fixable here too, whatever
      // its status says. A caption the format does not know (a custom line) is
      // never counted.
      const statementSQL = (alie) => `(CASE WHEN ${alie} IN ('Income', 'Expenses') THEN 'PL' WHEN ${alie} IN ('ASSETS', 'EQUITY AND LIABILITIES') THEN 'BS' END)`
      const level1StatementSQL = statementSQL(`COALESCE((
          SELECT l1.alie FROM level_format l1
          WHERE ${SPEC_NATURE_SQL('l1.level1')} = ${SPEC_NATURE_SQL('mt.mapping1_resultant')}
            AND l1.alie IS NOT NULL
            AND (mt.rule_set_id IS NULL OR l1.rule_set_id = mt.rule_set_id)
          ORDER BY l1.id LIMIT 1), mt.alie)`)
      const foreignLevel2 = `(
        mt.mapping2_resultant IS NOT NULL AND TRIM(mt.mapping2_resultant) <> ''
        AND ${level1StatementSQL} IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM level_format l2
          WHERE ${SPEC_NATURE_SQL('l2.level2')} = ${SPEC_NATURE_SQL('mt.mapping2_resultant')}
            AND ${statementSQL('l2.alie')} IS NOT NULL
            AND (mt.rule_set_id IS NULL OR l2.rule_set_id = mt.rule_set_id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM level_format l2
          WHERE ${SPEC_NATURE_SQL('l2.level2')} = ${SPEC_NATURE_SQL('mt.mapping2_resultant')}
            AND ${statementSQL('l2.alie')} = ${level1StatementSQL}
            AND (mt.rule_set_id IS NULL OR l2.rule_set_id = mt.rule_set_id)
        )
      )`
      const queuePredicate = `(${coreUncat} OR ${level45Unresolved} OR ${flaggedByEngine} OR ${foreignLevel2})`
      if (filter.perLedger) {
        // The original strategy - every ledger runs the tests itself. Kept only so tools/selftest-large-branch.mjs can prove that the
        // combination strategy below lists exactly the same ledgers. The screen never asks for it.
        conds.push(`(${queuePredicate} OR tr.upload_nature = 'Manual Ledger')`)
      } else {
        // The tests above depend only on these eight columns of a ledger, and most ledgers of a branch share their captions. So they are
        // run once per DISTINCT combination (a few hundred), not once per ledger - for 67,000 ledgers that took about a minute, each one
        // searching the Level Format several times - and every ledger is then matched, through its combination, to that answer.
        const KEY = ['alie', 'mapping1_resultant', 'mapping2_resultant', 'mapping3_resultant', 'level4_value', 'level5_value', 'status', 'rule_set_id']
        const keyOf = (a) => `concat_ws(chr(1), ${KEY.map(c => `COALESCE(${a}.${c}::text, chr(2))`).join(', ')})`
        withCombos = `WITH combos AS MATERIALIZED (SELECT DISTINCT ${KEY.map(c => `k.${c}`).join(', ')} FROM mapped_tb k WHERE k.tb_id = $1),
          flagged AS MATERIALIZED (SELECT ${keyOf('mt')} AS k FROM combos mt WHERE ${queuePredicate})
        `
        // a ledger added on the Mapped TB is always listed, so the CA can review its mapping here
        conds.push(`(${keyOf('mt')} IN (SELECT k FROM flagged) OR tr.upload_nature = 'Manual Ledger')`)
      }
    }
    // A Fix opened from Notes / Balance Sheet / P&L carries the ids of the very ledgers behind
    // the flagged line. Those win over every caption condition above: the captions Notes and BS
    // show are worked out in memory (level-format first, GST-netted, case-merged) and need not
    // equal the raw columns compared here, which used to find nothing at all.
    if (Array.isArray(filter.mappedIds) && filter.mappedIds.length) {
      conds.length = 0
      params.length = 0
      withCombos = ''
      conds.push('mt.id = ANY($1::int[])')
      params.push(filter.mappedIds.map(Number).filter(Number.isInteger))
    }
    const sql = `${withCombos}
      SELECT
        mt.id, mt.tb_row_id, mt.rule_set_id,
        mt.alie, mt.mapping1_resultant, mt.mapping2_resultant, mt.mapping3_resultant,
        mt.level_format_id, mt.level4_value, mt.level5_value, mt.level6_value, mt.level7_value,
        mt.status, mt.confidence, mt.override_note,
        tr.period, tr.branch, tr.name, tr.ledger_code,
        tr.opening_balance, tr.closing_balance, tr.is_deemed_positive,
        tr.trial_balance_type, tr.parent, tr.group_parent,
        tr.group_parent_1, tr.group_parent_2, tr.group_parent_3, tr.group_parent_4,
        tr.group_parent_5, tr.group_parent_6, tr.group_parent_7, tr.group_parent_8,
        tr.upload_nature
      FROM mapped_tb mt
      JOIN tb_rows tr ON tr.id = mt.tb_row_id
      WHERE ${conds.join(' AND ')}
      ORDER BY tr.name
    `
    const { rows } = await query(sql, params)
    return rows
  })

  // ── Diagnostic bucket counts ──────────────────────────────────────────────
  // COUNT(*) FILTER (WHERE ...) → SUM(CASE WHEN ... THEN 1 ELSE 0 END)
  ipcMain.handle('mappedTB:diagnostics', async (_, tbId) => {
    const { rows: [counts] } = await query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN mapping1_resultant IS NULL OR mapping1_resultant = '' THEN 1 ELSE 0 END) AS m1_null,
        SUM(CASE WHEN mapping2_resultant IS NULL OR mapping2_resultant = '' THEN 1 ELSE 0 END) AS m2_null,
        SUM(CASE WHEN mapping3_resultant IS NULL OR mapping3_resultant = '' THEN 1 ELSE 0 END) AS m3_null,
        SUM(CASE WHEN LOWER(COALESCE(mapping1_resultant,'')) LIKE '%uncategorised%' THEN 1 ELSE 0 END) AS m1_uncat,
        SUM(CASE WHEN LOWER(COALESCE(mapping2_resultant,'')) LIKE '%uncategorised%' THEN 1 ELSE 0 END) AS m2_uncat,
        SUM(CASE WHEN LOWER(COALESCE(mapping3_resultant,'')) LIKE '%uncategorised%' THEN 1 ELSE 0 END) AS m3_uncat,
        SUM(CASE WHEN status = 'user_approved' THEN 1 ELSE 0 END) AS user_approved,
        SUM(CASE WHEN status = 'user_override' THEN 1 ELSE 0 END) AS user_override
      FROM mapped_tb WHERE tb_id = $1
    `, [tbId])
    const { rows: byStatus } = await query(
      `SELECT status, COUNT(*) c FROM mapped_tb WHERE tb_id = $1 GROUP BY status ORDER BY c DESC`,
      [tbId]
    )
    const { rows: sample } = await query(`
      SELECT
        tr.name, mt.alie, mt.mapping1_resultant AS m1, mt.mapping2_resultant AS m2,
        mt.mapping3_resultant AS m3, mt.level5_value AS l5, mt.status, mt.rule_set_id
      FROM mapped_tb mt JOIN tb_rows tr ON tr.id = mt.tb_row_id
      WHERE mt.tb_id = $1 AND (
        mt.mapping1_resultant IS NULL OR
        LOWER(COALESCE(mt.mapping1_resultant,'')) LIKE '%uncategorised%' OR
        mt.mapping2_resultant IS NULL OR
        LOWER(COALESCE(mt.mapping2_resultant,'')) LIKE '%uncategorised%' OR
        LOWER(COALESCE(mt.mapping3_resultant,'')) LIKE '%uncategorised%'
      )
      ORDER BY tr.name LIMIT 50
    `, [tbId])
    return { counts, byStatus, sample }
  })
}
