import { query, runInTransaction } from '../db/client.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

// Inter-branch / Head Office current accounts (R7, 0.1.13). One Level 1 for
// all constitutions; it is the only Level 1 a ledger may reach from EITHER side
// of the Balance Sheet (a branch's HO account is a credit, the HO's branch
// account a debit), and it is exempt from the sign-based reclassification —
// its side is decided by useFinancials.js from the balance, and the
// Consolidated view nets it across branches.
const INTERBRANCH_RX = /inter[\s-]?branch|head office/i

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Word-boundary match: keyword must appear as whole word in text.
 * Prevents "rent" matching "current".
 */
function wordBoundaryMatch(text, keywordStr) {
  if (!keywordStr || !text) return false
  return keywordStr.split('|').map(k => k.trim()).filter(Boolean).some(k => {
    try {
      return new RegExp(`\\b${escapeRegex(k)}\\b`, 'i').test(text)
    } catch {
      return text.toLowerCase().includes(k.toLowerCase())
    }
  })
}

/** Match ANY text in a list against ANY keyword. Used for group-based matching. */
function anyWordBoundaryMatch(texts, keywordStr) {
  if (!keywordStr || !texts || texts.length === 0) return false
  return texts.some(t => t && wordBoundaryMatch(t, keywordStr))
}

/** Collect matched keywords from a list of source texts. */
function matchedKeywordsFromSources(sources, keywordStr) {
  if (!keywordStr) return []
  const matched = []
  for (const src of sources) {
    if (!src) continue
    const hits = keywordStr.split('|').map(k => k.trim()).filter(k => {
      if (!k) return false
      try { return new RegExp(`\\b${escapeRegex(k)}\\b`, 'i').test(src) }
      catch { return src.toLowerCase().includes(k.toLowerCase()) }
    })
    matched.push(...hits)
  }
  return [...new Set(matched)]
}

/** Return matched keywords from ledger name (for display in conflict/discrepancy UI). */
function matchedKeywords(name, keywordStr) {
  return matchedKeywordsFromSources([name], keywordStr)
}

/** Strip "(specify nature)" variants before LevelFormat key lookups. */
function stripSpecifyNature(val) {
  if (!val) return val
  return val.replace(/\s*\(specify nature\)/gi, '').trim()
}

// stripSpecifyNature() deliberately returns its argument UNCHANGED when falsy,
// so it hands back null for a null input. Calling .toLowerCase() on that result
// therefore throws "Cannot read properties of null (reading 'toLowerCase')".
//
// That is not hypothetical: level_format legitimately stores terminal Level-1
// captions with a NULL level2 (Cost of materials consumed, Finance Costs,
// Depreciation & Amortisation Expenses, ... - 30 such rows per rule set), and
// map2 can carry a NULL mapping2_resultant. Any comparison that touched one of
// those crashed the whole Auto-Mapping run.
//
// Normalise to '' for comparison, matching how the rest of the codebase treats
// these fields ((row.level2 || '') and friends). Absent-vs-absent then compares
// equal, which is the intended meaning for a terminal Level-1 row.
function normForCompare(val) {
  return (stripSpecifyNature(val) || '').toLowerCase()
}

function pickAssumptionDefault(raw, kind = 'general') {
  if (!raw || !raw.includes('/')) return null
  const opts = raw.split('/').map(s => s.trim()).filter(Boolean)
  if (kind === 'payable') {
    return opts.find(o => /creditors?.*other\s+than\s+msme/i.test(o)) || null
  }
  if (kind === 'receivable') {
    return opts.find(o => /unsecured.*considered\s*good/i.test(o)) || null
  }
  return opts.find(o => /unsecured.*considered\s*good/i.test(o))
      || opts.find(o => /^unsecured\b/i.test(o))
      || opts.find(o => /considered\s*good/i.test(o))
      || null
}

function applyTradeAssumption(result, lfRow) {
  if (!lfRow) return false
  const l2 = result.mapping2_resultant || lfRow.level2 || ''
  const isPayable = /trade\s+payables?/i.test(l2)
  const isReceivable = /trade\s+receivables?/i.test(l2)
  if (!isPayable && !isReceivable) {
    // Any other head offering "Secured, considered good / Unsecured, considered good / Doubtful" (loans and advances, other assets
    // ...): the ledger is "Unsecured, considered good" until the CA says otherwise - every constitution. A Mapping 3 / Level 5 the
    // ledger's own name already settled is left as it is.
    let any = false
    const UNSEC = /unsecured.*considered\s*good/i
    const open = (v) => !v || String(v).includes('/')
    if (lfRow.level3 && lfRow.level3.includes('/') && open(result.mapping3_resultant)) {
      const def = pickAssumptionDefault(lfRow.level3, 'general')
      if (def && UNSEC.test(def)) { result.mapping3_resultant = def; any = true }
    }
    if (lfRow.level5 && lfRow.level5.includes('/') && open(result.level5_value)) {
      const def = pickAssumptionDefault(lfRow.level5, 'general')
      if (def && UNSEC.test(def)) { result.level5_value = def; any = true }
    }
    if (any) {
      result.level_format_id = lfRow.id
      if (!result.alie && lfRow.alie) result.alie = lfRow.alie
    }
    return any
  }

  const kind = isPayable ? 'payable' : 'receivable'
  let applied = false

  if (lfRow.level3 && lfRow.level3.includes('/')) {
    const def = pickAssumptionDefault(lfRow.level3, kind)
    if (def) {
      result.mapping3_resultant = def
      applied = true
    }
  }
  if (lfRow.level5 && lfRow.level5.includes('/')) {
    const def = pickAssumptionDefault(lfRow.level5, kind)
    if (def) {
      result.level5_value = def
      applied = true
    }
  }
  if (applied) {
    result.level_format_id = lfRow.id
    if (!result.alie && lfRow.alie) result.alie = lfRow.alie
    result.override_note = 'On assumption'
  }
  return applied
}

function hierarchyHasTradeGroup(allHierarchy, groupType) {
  const rx = groupType === 'receivable'
    ? /^(sundry\s+debtors?|trade\s+receivables?|debtors?)$/i
    : /^(sundry\s+creditors?|trade\s+payables?|creditors?)$/i
  return (allHierarchy || []).some(v => rx.test((v || '').trim()))
}

function applyTradeGroupOverride(result, lf, groupType) {
  const isReceivable = groupType === 'receivable'
  const targetL2 = isReceivable ? 'Trade receivables' : 'Trade payables'
  const targetAlie = isReceivable ? 'ASSETS' : 'EQUITY AND LIABILITIES'
  const targetL1Rx = isReceivable ? /current\s+assets/i : /current\s+liabilities/i
  const targetL2Rx = isReceivable ? /trade\s+receivables?/i : /trade\s+payables?/i

  const lfRow = lf.find(r => targetL1Rx.test(r.level1 || '') && targetL2Rx.test(r.level2 || ''))
             || lf.find(r => targetL2Rx.test(r.level2 || ''))

  result.alie = targetAlie
  result.mapping1_resultant = lfRow?.level1 || (isReceivable ? 'Current assets' : 'Current liabilities')
  result.mapping2_resultant = lfRow?.level2 || targetL2
  result.mapping3_resultant = null
  result.level4_value = null
  result.level5_value = null
  result.level6_value = null
  result.level7_value = null
  if (lfRow) {
    result.level_format_id = lfRow.id
    applyTradeAssumption(result, lfRow)
  }
  result.status = 'auto_high'
  result.confidence = 'high'
  return result
}

function hasExactHierarchy(allHierarchy, label) {
  const wanted = (label || '').trim().toLowerCase()
  return (allHierarchy || []).some(v => (v || '').trim().toLowerCase() === wanted)
}

function purchaseTargetByBusinessType(businessType) {
  const bt = (businessType || '').trim().toLowerCase()
  if (bt === 'trader') return 'Purchases of Stock-in-Trade'
  if (bt === 'manufacturer') return 'Cost of materials consumed'
  return 'Uncategorised Purchase Accounts'
}

function applyPurchaseAccountsOverride(result, lf, businessType) {
  const targetL1 = purchaseTargetByBusinessType(businessType)
  const lfRow = lf.find(r => (r.level1 || '').trim().toLowerCase() === targetL1.toLowerCase())

  result.alie = 'Expenses'
  result.mapping1_resultant = lfRow?.level1 || targetL1
  result.mapping2_resultant = null
  result.mapping3_resultant = null
  result.level4_value = null
  result.level5_value = null
  result.level6_value = null
  result.level7_value = null
  if (lfRow) result.level_format_id = lfRow.id
  result.status = targetL1.startsWith('Uncategorised') ? 'auto_low' : 'auto_high'
  result.confidence = targetL1.startsWith('Uncategorised') ? 'low' : 'high'
  return result
}

function dedupeM2Hits(hits) {
  const m = new Map()
  for (const h of hits || []) {
    const key = `${h.mapping1_resultant || ''}||${h.mapping2_resultant || ''}`.toLowerCase()
    if (!m.has(key)) m.set(key, h)
  }
  return [...m.values()]
}

/**
 * Section 3.4 — Step 2: Find "Primary" in the Tally group hierarchy chain.
 *
 * Tally hierarchy from deepest (most specific) to broadest:
 *   parent → group_parent → group_parent_1 → … → group_parent_8 → Primary
 *
 * Returns:
 *   prePrimary     — value immediately before "Primary" (used for Level 1 / Map1)
 *   prePre         — value 2 positions before "Primary" (used for Level 2 hint)
 *   hierChain      — all values before Primary, deepest-first
 *   allHierarchy   — all values before Primary, closest-to-Primary-first (pre-primary first)
 *                    Used for group-based keyword matching in Stage 2 / Stage 3.
 */
function extractHierarchyLevels(row) {
  const chain = [
    row.parent,
    row.group_parent,
    row.group_parent_1,
    row.group_parent_2,
    row.group_parent_3,
    row.group_parent_4,
    row.group_parent_5,
    row.group_parent_6,
    row.group_parent_7,
    row.group_parent_8,
  ].filter(v => v != null && v !== '')

  const primaryIdx = chain.findIndex(v => v.trim().toLowerCase() === 'primary')

  if (primaryIdx === -1) {
    // "Primary" not in chain — use entire chain for fallback matching
    return {
      prePrimary:    null,
      prePre:        null,
      hierChain:     chain,
      allHierarchy:  [...chain].reverse(),
    }
  }

  // Everything before "Primary" (from deepest to closest-to-primary)
  const beforePrimary = chain.slice(0, primaryIdx)
  const n = beforePrimary.length

  return {
    prePrimary:   n >= 1 ? beforePrimary[n - 1] : null, // closest to Primary
    prePre:       n >= 2 ? beforePrimary[n - 2] : null, // 2nd closest
    hierChain:    beforePrimary,                          // deepest-first
    allHierarchy: [...beforePrimary].reverse(),           // pre-primary first (closest to Primary first)
  }
}

/**
 * Section 3.4 — Step 1: Derive ALIE from the "TrialBalance" column of the uploaded TB.
 * Logic:
 *   Assets     → ASSETS
 *   Liabilities → EQUITY AND LIABILITIES
 *   Expense/Expenses → Expenses
 *   Income     → Income
 */
function deriveAlieFromType(trialBalanceType) {
  if (!trialBalanceType) return null
  const t = trialBalanceType.trim().toLowerCase()
  if (t === 'assets')                return 'ASSETS'
  if (t === 'liabilities')           return 'EQUITY AND LIABILITIES'
  if (t === 'expense' || t === 'expenses') return 'Expenses'
  if (t === 'income')                return 'Income'
  return null
}

// ── Main engine ───────────────────────────────────────────────────────────────

/**
 * Improved 3-Stage Mapping Pipeline (Section 3.4 compliant)
 *
 * Stage 1 (Map1) — Group-based, FIRST PRIORITY:
 *   Identify "Primary" in hierarchy; use Pre-Primary value for Map1 exact lookup.
 *   Fallback: walk entire hierarchy chain if Pre-Primary not found in Map1.
 *   → Determines Level 1 (mapping1_resultant)
 *
 * Stage 2 (Map2) — Level 2:
 *   Step A (GROUP FIRST): Check all hierarchy values against Map2 keywords.
 *   Step B (NAME FALLBACK): Only if group matching fails, check ledger Name.
 *   Cross-check across Level 1 boundaries for discrepancy detection.
 *   → Determines Level 2 (mapping2_resultant)
 *
 * Stage 3 (Map3) — Level 3:
 *   Step A (GROUP FIRST): Check all hierarchy values against Map3 keywords.
 *   Step B (NAME FALLBACK): Only if group matching fails, check ledger Name.
 *   → Determines Level 3 (mapping3_resultant)
 *
 * Confidence levels:
 *   auto_high   — all 3 stages resolved + LevelFormat exact match
 *   auto_medium — stages 1+2 resolved (Stage 3 unknown or LevelFormat only)
 *   auto_low    — Stage 1 only (Stage 2 missed)
 *   unmapped    — Stage 1 failed
 */
export async function runMappingEngine(tbId, rsId, constitution, {
  excludeZero = false,
  businessType = null,
  database = { query, runInTransaction },
} = {}) {
  const dbQuery = database.query
  const tbQuery = excludeZero
    // A ledger the CA has adjusted stays in even if the adjustment nets its balance to nil -
    // it must stay on the Mapped TB, where the adjustment can be seen and changed.
    ? dbQuery(`SELECT * FROM tb_rows WHERE tb_id = $1
              AND (opening_balance != 0 OR closing_balance != 0 OR adj_debit IS NOT NULL OR adj_credit IS NOT NULL OR upload_nature = 'Manual Ledger') ORDER BY id`, [tbId])
    : dbQuery(`SELECT * FROM tb_rows WHERE tb_id = $1 ORDER BY id`, [tbId])
  const [tbRes, m1Res, m2Res, m3Res, lfRes] = await Promise.all([
    tbQuery,
    dbQuery(`SELECT * FROM map1 WHERE rule_set_id=$1 AND constitution=$2`, [rsId, constitution]),
    dbQuery(`SELECT * FROM map2 WHERE rule_set_id=$1 AND constitution=$2 ORDER BY priority, id`, [rsId, constitution]),
    dbQuery(`SELECT * FROM map3 WHERE rule_set_id=$1 AND constitution=$2 ORDER BY priority, id`, [rsId, constitution]),
    dbQuery(`SELECT * FROM level_format WHERE rule_set_id=$1 AND constitution=$2 ORDER BY sort_order`, [rsId, constitution]),
  ])

  const tbRows = tbRes.rows
  const map1   = m1Res.rows
  const map2   = m2Res.rows
  const map3   = m3Res.rows
  const lf     = lfRes.rows

  // ── LevelFormat lookup indexes ────────────────────────────────────────────
  const lfByM2M3      = {}   // "level2_clean||level3_clean" → LF row
  const lfByM2        = {}   // "level2_clean"               → LF row (fallback)
  const lfByM1Terminal = {}  // "level1" → LF row where level2 is null (terminal L1 categories)
  const alieByL1      = {}   // "level1" → ALIE value (first match)
  // Whether an L2 has any *named* L3 children defined in the template.
  // This decides whether Stage 3's "no Map3 keyword match" fallback should
  // synthesise "Uncategorised {L2}" (because L3 SHOULD be filled, e.g. Sale →
  // Sale of products / Sale of services) or just leave L3 NULL (because the
  // L2 is terminal, e.g. Other current assets, Cash and bank balances).
  const l2HasL3Children = {}  // "L1||L2" → boolean
  // Same idea for Stage 2 fallback: only generate "Uncategorised {L1}" when
  // the L1 has L2 children defined.
  const l1HasL2Children = {}  // "L1" → boolean
  // lfByM2's fallback pick used to be whichever LevelFormat row for that L2
  // came first by sort_order — for an L2 like "Other current liabilities"
  // that meant an unrelated ledger with no real Stage-3 match (e.g. "Audit
  // Fee Payable") silently got level_format_id pointed at a SPECIFIC,
  // unrelated L3 sibling ("Current maturities of long-term debt", simply
  // because it happened to sort first) rather than something generic. Track
  // priority per L2 so the fallback instead prefers: a terminal L2 (no L3 at
  // all) > an explicit "Uncategorised {L2}" L3 > only then whatever sorts
  // first — never a specific named L3 picked by accident.
  const lfByM2Priority = {}   // "level2_clean" → priority of the row currently in lfByM2
  for (const row of lf) {
    const l2 = stripSpecifyNature(row.level2)
    const l3 = stripSpecifyNature(row.level3)
    if (l2 && l3 && !lfByM2M3[`${l2}||${l3}`]) lfByM2M3[`${l2}||${l3}`] = row
    if (l2) {
      const priority = !row.level3 ? 0 : /^uncategorised\b/i.test(row.level3.trim()) ? 1 : 2
      if (lfByM2Priority[l2] === undefined || priority < lfByM2Priority[l2]) {
        lfByM2[l2] = row
        lfByM2Priority[l2] = priority
      }
    }
    // Terminal L1: LF row has a level1 but no level2 (e.g. "Depreciation & Amortisation Expenses")
    if (row.level1 && !l2 && !lfByM1Terminal[row.level1]) lfByM1Terminal[row.level1] = row
    if (row.level1 && row.alie && !alieByL1[row.level1]) alieByL1[row.level1] = row.alie
    // Only count NON-uncategorised L2 / L3 as "real children"
    const l2NotUncat = row.level2 && !/^uncategorised\b/i.test(row.level2.trim())
    const l3NotUncat = row.level3 && row.level3.trim() && !/^uncategorised\b/i.test(row.level3.trim())
    if (row.level1 && l2NotUncat) l1HasL2Children[row.level1] = true
    if (row.level1 && row.level2 && l3NotUncat) {
      l2HasL3Children[`${row.level1}||${row.level2}`] = true
    }
  }

  const results = []

  for (const row of tbRows) {
    const result = {
      tb_id:                  tbId,
      tb_row_id:              row.id,
      rule_set_id:            rsId,
      alie:                   deriveAlieFromType(row.trial_balance_type),
      mapping1_resultant:     null,
      mapping2_resultant:     null,
      mapping3_resultant:     null,
      level_format_id:        null,
      level4_value:           null,
      level5_value:           null,
      level6_value:           null,
      level7_value:           null,
      status:                 'unmapped',
      confidence:             'none',
      conflict_candidates:    null,
      conflict_stage:         null,
      discrepancy_suggestion: null,
      override_note:          null,
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SPECIAL CASE — "Opening Stock" ledger from books.
    // It belongs to P&L inventory movement, not BS closing inventory.
    // ═══════════════════════════════════════════════════════════════════════════
    if (/^opening\s*stock$|^o\s*stock$|^o\s*\/\s*s$|^os$/i.test((row.name || '').trim()) && row.upload_nature !== 'Stock Entry') {
      const lfRow = lf.find(r => r.level1 === 'Opening Stock (PL)' && r.level2 === 'Opening Stock')
      result.alie                 = 'Expenses'
      result.mapping1_resultant   = 'Opening Stock (PL)'
      result.mapping2_resultant   = 'Opening Stock'
      result.mapping3_resultant   = 'Opening Stock'
      if (lfRow) result.level_format_id = lfRow.id
      result.status     = 'user_approved'
      result.confidence = 'high'
      results.push(result); continue
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SPECIAL CASE — system / book ledgers carrying opening accumulated P&L.
    // This is the accumulated retained earnings b/f — maps to Reserves & Surplus
    // → Surplus in Statement of Profit and Loss → Opening Profit & Loss.
    // ═══════════════════════════════════════════════════════════════════════════
    if (/^(opening\s+)?(surplus\s+in\s+)?profit\s*(?:&|and)?\s*loss(?:\s*a\/c)?(?:\s+\d{4}[-/]\d{2,4})?$/i.test((row.name || '').trim())) {
      const lfRow = lf.find(r => /reserves?\s*(and|&)\s*surplus/i.test(r.level2 || '') && /opening\s+profit.*loss|surplus.*pl|undistributed surplus/i.test(r.level3 || ''))
                || lf.find(r => /reserves?\s*(and|&)\s*surplus/i.test(r.level2 || ''))
      result.alie                 = 'EQUITY AND LIABILITIES'
      result.mapping1_resultant   = lfRow?.level1 || 'Reserves and Surplus'
      result.mapping2_resultant   = lfRow?.level2 || 'Reserves and surplus'
      result.mapping3_resultant   = 'Opening Profit & Loss'
      if (lfRow) result.level_format_id = lfRow.id
      result.status     = 'user_approved'
      result.confidence = 'high'
      results.push(result); continue
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SPECIAL CASE — Stock Entries (no Tally hierarchy, hard-mapped by name)
    // ═══════════════════════════════════════════════════════════════════════════
    if (row.upload_nature === 'Stock Entry' && row.name) {
      const name = row.name
      let stockMap = null
      let category = null
      if (/^Opening Stock\s*-\s*/i.test(name)) {
        stockMap = { alie: 'Expenses', m1: 'Opening Stock (PL)', m2: 'Opening Stock', m3: 'Opening Stock' }
        category = name.replace(/^Opening Stock\s*-\s*/i, '').trim()
      } else if (/^Closing Stock\s*-\s*PL\s*-\s*/i.test(name)) {
        stockMap = { alie: 'Income', m1: 'Closing Stock (PL)', m2: 'Closing Stock', m3: 'Closing Stock' }
        category = name.replace(/^Closing Stock\s*-\s*PL\s*-\s*/i, '').trim()
      } else if (/^Closing Stock\s*-\s*BS\s*-\s*/i.test(name)) {
        stockMap = { alie: 'ASSETS', m1: 'Current assets', m2: 'Inventories', m3: 'Closing Stock (BS)' }
        category = name.replace(/^Closing Stock\s*-\s*BS\s*-\s*/i, '').trim()
      }
      if (stockMap) {
        result.alie = stockMap.alie
        result.mapping1_resultant = stockMap.m1
        result.mapping2_resultant = stockMap.m2
        result.mapping3_resultant = stockMap.m3
        // Preserve the Stock-form category (Raw Materials / Work in Progress /
        // Finished Goods / Stock-in-Trade / Stores & Spares / Loose Tools /
        // Others / Uncategorised Stock) as level5_value — see tb.js's
        // saveStock, which sets this at entry time. Re-running Auto-Mapping
        // must not lose it, since utils/inventorySplit.js relies on it to
        // route each category to the right PL/BS treatment.
        result.level5_value = category || null
        const lfRow = lf.find(r =>
          r.level1 === stockMap.m1 && r.level2 === stockMap.m2 && r.level3 === stockMap.m3
        )
        if (lfRow) result.level_format_id = lfRow.id
        result.status = 'user_approved'
        result.confidence = 'high'
        results.push(result); continue
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STAGE 1 — Map1: Group-based Level 1 (Pre-Primary identification)
    // ═══════════════════════════════════════════════════════════════════════════
    const { prePrimary, hierChain, allHierarchy } = extractHierarchyLevels(row)

    if (hasExactHierarchy(allHierarchy, 'Purchase Accounts')) {
      applyPurchaseAccountsOverride(result, lf, businessType)
      results.push(result); continue
    }

    const tradeGroupOverride = hierarchyHasTradeGroup(allHierarchy, 'receivable')
      ? 'receivable'
      : hierarchyHasTradeGroup(allHierarchy, 'payable')
        ? 'payable'
        : null
    if (tradeGroupOverride) {
      applyTradeGroupOverride(result, lf, tradeGroupOverride)
      results.push(result); continue
    }

    let m1Hit = null

    // 1a. Depth-first: walk hierarchy from DEEPEST to BROADEST group.
    // This ensures specific sub-groups (e.g. "Salary & Wages") take priority
    // over broad Tally groups (e.g. "Indirect Expenses" → "Other expenses").
    // hierChain is already deepest-first [G5, G4, G3, G2, G1, G0].
    for (const col of hierChain) {
      const hit = map1.find(m =>
        m.tally_pre_primary &&
        m.tally_pre_primary.toLowerCase().trim() === col.toLowerCase().trim()
      )
      if (hit) { m1Hit = hit; break }
    }

    // 1b. Fallback for legacy Tally: if no depth-first match, try prePrimary alone
    // (backward-compat for Tally where prePrimary IS the canonical lookup node)
    if (!m1Hit && prePrimary) {
      m1Hit = map1.find(m =>
        m.tally_pre_primary &&
        m.tally_pre_primary.toLowerCase().trim() === prePrimary.toLowerCase().trim()
      )
    }

    // 1c. Name-based Map1 refinement (ledger name fallback)
    // Problem: many Tally companies put Depreciation / Interest / Purchase ledgers
    // directly under "Indirect Expenses" or "Direct Expenses" without creating a
    // dedicated sub-group. In that case steps 1a/1b give a broad M1 like
    // "Other expenses" which is wrong for the P&L face.
    // Solution: after any group-based match, check if the ledger NAME contains a
    // word from any Map1 tally_pre_primary entry that maps to a MORE SPECIFIC M1.
    // Only fires when the refined M1 stays within the same ALIE boundary (safe).
    if (m1Hit && row.name) {
      const broadM1  = m1Hit.mapping1_resultant
      const broadAlie = alieByL1[broadM1]
      // Walk Map1 entries ordered by specificity (longer keyword = more specific)
      const sortedMap1 = [...map1].sort(
        (a, b) => (b.tally_pre_primary || '').length - (a.tally_pre_primary || '').length
      )
      for (const m of sortedMap1) {
        if (!m.tally_pre_primary) continue
        if (m.mapping1_resultant === broadM1) continue          // same result, skip
        if (!wordBoundaryMatch(row.name, m.tally_pre_primary)) continue  // no name match
        const refineAlie = alieByL1[m.mapping1_resultant]
        // Block cross-ALIE refinement (Expenses ledger must stay in Expenses) —
        // except the inter-branch account, which may cross between the two
        // Balance Sheet sides (never between BS and P&L).
        const bsSides = ['ASSETS', 'EQUITY AND LIABILITIES']
        const interBranchCross = INTERBRANCH_RX.test(m.mapping1_resultant || '') &&
          bsSides.includes(broadAlie) && bsSides.includes(refineAlie)
        if (broadAlie && refineAlie && broadAlie !== refineAlie && !interBranchCross) continue
        m1Hit = m
        break
      }
    }

    if (!m1Hit) {
      // Fallback: use "Uncategorised {ALIE}" as Level 1
      if (result.alie) {
        result.mapping1_resultant = `Uncategorised ${result.alie}`
        result.mapping2_resultant = `Uncategorised ${result.alie}`
        result.mapping3_resultant = `Uncategorised ${result.alie}`
        result.status = 'auto_low'; result.confidence = 'low'
      } else {
        result.status = 'unmapped'; result.confidence = 'none'
      }
      results.push(result); continue
    }

    result.mapping1_resultant = m1Hit.mapping1_resultant
    // Derive ALIE from LevelFormat if not already set from trial_balance_type
    if (!result.alie && m1Hit.mapping1_resultant) {
      result.alie = alieByL1[m1Hit.mapping1_resultant] || null
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STAGE 2 — Map2: Level 2 (Group hierarchy FIRST, ledger name FALLBACK)
    // ═══════════════════════════════════════════════════════════════════════════
    const m2InScope = map2.filter(m => m.mapping1_resultant === result.mapping1_resultant)

    // Step A: GROUP-BASED (FIRST PRIORITY — but only for priority-1 entries)
    // Priority-2 entries like "Indirect Expenses → Misc Expenses" are broad fallbacks.
    // If ONLY priority-2 entries match via group, skip group hits and use name-based
    // matching instead — this lets "ELECTRICITY EXPENSES" match "Electricity" (name)
    // rather than being swallowed by the broad "Indirect Expenses" group match.
    const m2GroupHitsAll = m2InScope.filter(m => anyWordBoundaryMatch(allHierarchy, m.keywords))
    const m2GroupHitsPri1 = m2GroupHitsAll.filter(m => (m.priority || 1) <= 1)
    const m2GroupHits = m2GroupHitsPri1.length > 0 ? m2GroupHitsAll : []

    // Step B: NAME-BASED (FALLBACK — only if no priority-1 group matching)
    const m2NameHits  = m2GroupHits.length > 0
      ? []
      : m2InScope.filter(m => wordBoundaryMatch(row.name, m.keywords))

    const m2Hits    = m2GroupHits.length > 0 ? m2GroupHits : m2NameHits
    const stage2IsGroup = m2GroupHits.length > 0

    if (m2Hits.length === 0) {
      // No match within Level 1 — cross-check for discrepancy
      // Rule: ALIE cannot change via discrepancy. A ledger already placed in ASSETS
      // (via group/hierarchy → Map1) cannot be reclassified as Expenses/Income,
      // and vice versa. Only flag discrepancy within the same ALIE boundary.
      const m2CrossHits = map2
        .filter(m => m.mapping1_resultant !== result.mapping1_resultant)
        .filter(m => {
          // Block cross-ALIE suggestions (e.g. ASSETS → Expenses, or Expenses → ASSETS)
          const crossAlie = alieByL1[m.mapping1_resultant]
          if (result.alie && crossAlie && result.alie !== crossAlie) return false
          return anyWordBoundaryMatch(allHierarchy, m.keywords) ||
                 wordBoundaryMatch(row.name, m.keywords)
        })

      const uniqueM2CrossHits = dedupeM2Hits(m2CrossHits)

      if (uniqueM2CrossHits.length === 1) {
        const hit = uniqueM2CrossHits[0]
        result.mapping1_resultant = hit.mapping1_resultant
        result.mapping2_resultant = hit.mapping2_resultant
        result.mapping3_resultant = null
        result.alie = alieByL1[hit.mapping1_resultant] || result.alie

        const lfRowFallback = lf.find(r =>
          normForCompare(r.level1) === normForCompare(result.mapping1_resultant) &&
          normForCompare(r.level2) === normForCompare(result.mapping2_resultant)
        )
        if (lfRowFallback) result.level_format_id = lfRowFallback.id
        result.status = lfRowFallback ? 'auto_high' : 'auto_medium'
        result.confidence = lfRowFallback ? 'high' : 'medium'
      } else if (uniqueM2CrossHits.length > 0) {
        result.status     = 'discrepancy'
        result.confidence = 'none'
        result.discrepancy_suggestion = {
          tally_level1: result.mapping1_resultant,
          options: uniqueM2CrossHits.map(m => ({
            mapping1:         m.mapping1_resultant,
            mapping2:         m.mapping2_resultant,
            matched_keywords: matchedKeywordsFromSources([...allHierarchy, row.name], m.keywords),
          }))
        }
      } else {
        // No Stage 2 keyword match. If L1 has L2 children defined in LF,
        // synthesise "Uncategorised {L1}" so the user knows L2 needs picking.
        // Otherwise leave both NULL — L1 alone is the complete classification.
        const hasL2Children = !!l1HasL2Children[result.mapping1_resultant]
        if (hasL2Children) {
          result.mapping2_resultant = `Uncategorised ${result.mapping1_resultant}`
          // Stage 3 will decide whether to add "Uncategorised X" further
          // (likely not, since the synthetic L2 has no LF L3 children)
          result.mapping3_resultant = null
        } else {
          result.mapping2_resultant = null
          result.mapping3_resultant = null
        }
        result.status     = 'auto_low'
        result.confidence = 'low'
      }
      results.push(result); continue
    }

    // Tiebreaker: resolve group-based Stage 2 conflict
    let resolvedM2Hits = m2Hits
    if (m2Hits.length > 1 && stage2IsGroup) {
      // Step 1: ledger name matches a Map2 keyword directly
      const nameHits = m2Hits.filter(m => wordBoundaryMatch(row.name, m.keywords))
      if (nameHits.length === 1) {
        resolvedM2Hits = nameHits
      } else {
        // Step 2: look-ahead — which M2 candidate has a Map3 entry matching the ledger name?
        // "Securities Premium" ledger → only "Reserves and surplus" has Map3 keyword "Securities Premium"
        const m2WithM3NameMatch = m2Hits.filter(m2c => {
          const m3Scope = map3.filter(m3 =>
            (m3.mapping1_resultant == null || m3.mapping1_resultant === result.mapping1_resultant) &&
            (m3.mapping2_resultant == null || m3.mapping2_resultant === m2c.mapping2_resultant)
          )
          return m3Scope.some(m3 => wordBoundaryMatch(row.name, m3.keywords))
        })
        if (m2WithM3NameMatch.length === 1) resolvedM2Hits = m2WithM3NameMatch
      }
    }

    if (resolvedM2Hits.length > 1) {
      result.status        = 'conflict'
      result.confidence    = 'none'
      result.conflict_stage = 2
      result.conflict_candidates = resolvedM2Hits.map(m => ({
        stage:              2,
        mapping1_resultant: m.mapping1_resultant,
        mapping2_resultant: m.mapping2_resultant,
        matched_keywords:   matchedKeywordsFromSources(
          stage2IsGroup ? allHierarchy : [row.name],
          m.keywords
        ),
        all_keywords:       m.keywords,
        map_row_id:         m.id,
        match_source:       stage2IsGroup ? 'group' : 'name',
      }))
      results.push(result); continue
    }

    result.mapping2_resultant = resolvedM2Hits[0].mapping2_resultant

    // ═══════════════════════════════════════════════════════════════════════════
    // STAGE 3 — Map3: Level 3 (Group hierarchy FIRST, ledger name FALLBACK)
    // ═══════════════════════════════════════════════════════════════════════════
    // Map3 rows with null mapping1_resultant match any M1 (Excel column left blank).
    // Map3 rows with null mapping2_resultant match any M2 (very broad — rare).
    const m3InScope = map3.filter(m =>
      (m.mapping1_resultant == null || m.mapping1_resultant === result.mapping1_resultant) &&
      (m.mapping2_resultant == null || m.mapping2_resultant === result.mapping2_resultant)
    )

    // Step A: GROUP-BASED (FIRST PRIORITY)
    const m3GroupHits = m3InScope.filter(m => anyWordBoundaryMatch(allHierarchy, m.keywords))

    // Step B: NAME-BASED (FALLBACK — only if group matching fails)
    const m3NameHits  = m3GroupHits.length > 0
      ? []
      : m3InScope.filter(m => wordBoundaryMatch(row.name, m.keywords))

    const m3Hits    = m3GroupHits.length > 0 ? m3GroupHits : m3NameHits
    const stage3IsGroup = m3GroupHits.length > 0

    if (m3Hits.length === 0) {
      const lfRowFallback = lfByM2[stripSpecifyNature(result.mapping2_resultant)]
      if (applyTradeAssumption(result, lfRowFallback)) {
        result.status = 'auto_medium'
        result.confidence = 'medium'
        results.push(result); continue
      }
      // No Stage 3 keyword match. Decide whether L3 should be filled at all:
      //  - If the LevelFormat template has *named* L3 children for this
      //    (L1, L2), the row is incomplete → set "Uncategorised {L2}" so the
      //    user knows to drill down (e.g. Sale → must pick Goods / Services).
      //  - If the L2 is terminal (no L3 children, e.g. Other current assets,
      //    Cash and bank balances), leave mapping3 NULL — the row is fully
      //    classified at L2 already.
      const l2Key = `${result.mapping1_resultant}||${result.mapping2_resultant}`
      const hasChildren = !!l2HasL3Children[l2Key]
      if (hasChildren) {
        const uncatL3 = `Uncategorised ${result.mapping2_resultant}`
        result.mapping3_resultant = uncatL3
      } else {
        result.mapping3_resultant = null
      }
      // Try to attach a level_format_id even when L3 is NULL (matches by L2)
      if (lfRowFallback) {
        result.level_format_id = lfRowFallback.id
      } else if (!hasChildren) {
        // Terminal L1 category (e.g. "Depreciation & Amortisation Expenses"):
        // LF row has no L2, so lfByM2 has no entry. Look up by L1 directly.
        // This ensures correct sort_order, alie, and auto_high confidence.
        const terminalLF = lfByM1Terminal[result.mapping1_resultant]
        if (terminalLF) {
          result.level_format_id = terminalLF.id
          result.mapping2_resultant = null
          if (!result.alie && terminalLF.alie) result.alie = terminalLF.alie
          result.status     = 'auto_high'
          result.confidence = 'high'
          results.push(result); continue
        }
      }
      result.status     = 'auto_medium'
      result.confidence = 'medium'
      results.push(result); continue
    }

    // When a group-based conflict arises, try to resolve it using the ledger name
    // as a tiebreaker before declaring a conflict. This handles the common case
    // where the M2 group name (e.g. "Cash and bank balances") contains words
    // ("Cash", "Bank") that accidentally fire multiple M3 group rules, but the
    // ledger name uniquely identifies the right M3 (e.g. "HDFC BANK LTD" → Bank).
    let resolvedM3Hits = m3Hits
    if (m3Hits.length > 1 && stage3IsGroup) {
      // Step 1: ledger name matches one of the group-hit candidates
      const nameHits = m3Hits.filter(m => wordBoundaryMatch(row.name, m.keywords))
      if (nameHits.length === 1) {
        resolvedM3Hits = nameHits
      } else {
        // Step 2: ledger name matches a DIFFERENT Map3 entry in scope not caught by group.
        // e.g. group hits "Capital Reserves" + "Other Reserves" but name "Securities Premium"
        // exactly matches the "Securities Premium" Map3 entry → use that instead.
        const scopeNameHits = m3InScope.filter(m => wordBoundaryMatch(row.name, m.keywords))
        if (scopeNameHits.length === 1) resolvedM3Hits = scopeNameHits
      }
    }

    if (resolvedM3Hits.length > 1) {
      result.status        = 'conflict'
      result.confidence    = 'medium'
      result.conflict_stage = 3
      result.conflict_candidates = resolvedM3Hits.map(m => ({
        stage:              3,
        mapping2_resultant: result.mapping2_resultant,
        mapping3_resultant: m.mapping3_resultant,
        matched_keywords:   matchedKeywordsFromSources(
          stage3IsGroup ? allHierarchy : [row.name],
          m.keywords
        ),
        all_keywords:       m.keywords,
        map_row_id:         m.id,
        match_source:       stage3IsGroup ? 'group' : 'name',
      }))
      results.push(result); continue
    }

    result.mapping3_resultant = resolvedM3Hits[0].mapping3_resultant

    // ── Find LevelFormat row ──────────────────────────────────────────────────
    let m2c   = stripSpecifyNature(result.mapping2_resultant)
    let m3c   = stripSpecifyNature(result.mapping3_resultant)
    const lfRow = lfByM2M3[`${m2c}||${m3c}`] || lfByM2[m2c]

    if (lfRow) {
      result.level_format_id = lfRow.id
      // Helper: when a "/" template has an obvious safe default (e.g. for
      // Trade receivables we default to "Unsecured considered good" because
      // most ledgers fall there), pick it. User can change later in the grid
      // or via the Override modal.
      const pickDefault = (raw) => {
        if (!raw) return null
        if (!raw.includes('/')) return raw
        return pickAssumptionDefault(raw)
      }
      const assumedTradePayable = /trade\s+payables?/i.test(result.mapping2_resultant || lfRow.level2 || '')
      const assumedTradeReceivable = /trade\s+receivables?/i.test(result.mapping2_resultant || lfRow.level2 || '')
      applyTradeAssumption(result, lfRow)
      // Level 4
      if (lfRow.level4) {
        const def = pickDefault(lfRow.level4)
        if (def) result.level4_value = def
      }
      // Level 5
      if (lfRow.level5) {
        const def = pickDefault(lfRow.level5)
        if (def) {
          result.level5_value = def
          if (assumedTradePayable || assumedTradeReceivable) result.override_note = 'On assumption'
        }
      }
      // Level 6
      if (lfRow.level6) {
        const def = pickDefault(lfRow.level6)
        if (def) result.level6_value = def
      }
      // Level 7: "Specify Nature" = user input placeholder (do not auto-populate)
      if (lfRow.level7 && !/specify nature/i.test(lfRow.level7)) {
        const def = pickDefault(lfRow.level7)
        if (def) result.level7_value = def
      }

      // If ALIE was not derived from trial_balance_type, derive from LevelFormat
      if (!result.alie && lfRow.alie) result.alie = lfRow.alie
    }

    m2c = stripSpecifyNature(result.mapping2_resultant)
    m3c = stripSpecifyNature(result.mapping3_resultant)
    const exactLF       = !!lfByM2M3[`${m2c}||${m3c}`]
    result.status       = exactLF ? 'auto_high'  : 'auto_medium'
    result.confidence   = exactLF ? 'high'        : 'medium'

    results.push(result)
  }

  // ── Sign-based reclassification: Trade Payables/Receivables ─────────────
  // A Trade Payables ledger with an abnormal DEBIT balance is economically an
  // advance paid to that supplier, not a payable — it belongs on the Assets
  // side (Other current assets → Advance to Suppliers). The mirror case: a
  // Trade Receivables ledger with an abnormal CREDIT balance is an advance
  // received from a customer — it belongs under Current liabilities (Other
  // current liabilities → Advance from Customers). Applied after the normal
  // Map1→Map2→Map3 pipeline, uniformly across every TB upload path (Tally,
  // Real Books, Excel/ODBC) and every constitution, since it only depends on
  // the sign already stored on tb_rows.closing_balance — the same sign
  // convention used everywhere else in the app (see displayAmt() in
  // useFinancials.js: Dr-natured ALIEs stored negative, Cr-natured positive).
  // See Annexures' Trade Payables/Receivables reconciliation for a full,
  // reviewable list of every ledger this reclassifies.
  const tbRowsById = new Map(tbRows.map(r => [r.id, r]))
  // Advance to Suppliers sits under SHORT-TERM LOANS AND ADVANCES (it was Other current assets until 0.1.102); a rule set that has
  // not got that sub head yet (schema.js adds it at start-up) falls back to the old place rather than losing the reclassification
  const advSupplierLF = lf.find(r => r.level2 === 'Short-term loans and advances' && r.level3 === 'Advance to Suppliers')
    || lf.find(r => r.level2 === 'Other current assets' && r.level3 === 'Advance to Suppliers')
  const advCustomerLF = lf.find(r => r.level2 === 'Other current liabilities' && r.level3 === 'Advance from Customers')
  const isDrSideAlie = (alie) => alie === 'ASSETS' || alie === 'Expenses'
  const signedClosingBal = (tbRow, alie) => {
    const bal = parseFloat(tbRow.closing_balance || 0)
    return isDrSideAlie(alie) ? -bal : bal
  }

  if (advSupplierLF || advCustomerLF) {
    for (const result of results) {
      const tbRow = tbRowsById.get(result.tb_row_id)
      if (!tbRow) continue
      const isPayables = result.alie === 'EQUITY AND LIABILITIES' && /^trade\s+payables?$/i.test(result.mapping2_resultant || '')
      const isReceivables = result.alie === 'ASSETS' && /^trade\s+receivables?$/i.test(result.mapping2_resultant || '')
      if (!isPayables && !isReceivables) continue
      const amt = signedClosingBal(tbRow, result.alie)
      if (Math.abs(amt) < 0.005) continue  // zero-balance ledger — nothing to reclassify

      if (isPayables && amt < 0 && advSupplierLF) {
        result.alie = 'ASSETS'
        result.mapping1_resultant = advSupplierLF.level1
        result.mapping2_resultant = advSupplierLF.level2
        result.mapping3_resultant = advSupplierLF.level3 || null
        result.level4_value = null; result.level5_value = null; result.level6_value = null; result.level7_value = null
        result.level_format_id = advSupplierLF.id
        result.override_note = 'Reclassified from Trade Payables (Dr balance — advance to supplier)'
      } else if (isReceivables && amt < 0 && advCustomerLF) {
        result.alie = 'EQUITY AND LIABILITIES'
        result.mapping1_resultant = advCustomerLF.level1
        result.mapping2_resultant = advCustomerLF.level2
        result.mapping3_resultant = advCustomerLF.level3 || null
        result.level4_value = null; result.level5_value = null; result.level6_value = null; result.level7_value = null
        result.level_format_id = advCustomerLF.id
        result.override_note = 'Reclassified from Trade Receivables (Cr balance — advance from customer)'
      }
    }
  }

  reclassifyAbnormalBalances(results, tbRowsById, lf)

  return results
}

// ── Sign-based reclassification: all other heads (generalized) ──────────────
// Same principle as Trade Payables/Receivables in runMappingEngine, extended to
// every other head: a ledger's balance should never come out abnormal for its
// assigned side (Assets/Expenses should display Dr-positive; Equity&
// Liabilities/Income should display Cr-positive) — except the one line
// that is legitimately allowed to be negative: the Profit/Loss-carrying
// capital/reserves note itself (Reserves and Surplus for a Company,
// Capital/Current Account for non-corporates), since a business can
// genuinely be loss-making. Any OTHER ledger with an abnormal balance is
// re-routed to the mirror head on the opposite side of the SAME statement
// (Income ↔ Expenses on the P&L, Assets ↔ Equity&Liabilities on the BS) —
// a generic "Other income"/"Other Expenses"/"Other current assets"/"Other
// current liabilities" bucket, since (unlike Trade Payables/Receivables)
// there's no universally-correct specific mirror caption for an arbitrary
// ledger. The stored amount's sign is left untouched — only alie/mapping
// change, so displayAmt() renders it correctly under its new side.
//
// The ledger's Level 2 / 3 belong to the head it leaves, so they are cleared
// on every route. The Income ↔ Expenses routes used to change only Mapping 1,
// leaving e.g. "Sale" as a line of Other expenses.
//
// Deliberately excluded — ledgers that are the "wrong" sign by accounting
// DESIGN, not by mistake, and must never be auto-flipped:
//   - The capital/reserves/P&L-carrying note (CAPITAL_EQUITY_L2_RX).
//   - Known contra-accounts (CONTRA_ACCOUNT_RX) — Accumulated Depreciation
//     and Provisions for Doubtful Debts/Investments/diminution sit as a
//     credit balance under Assets to reduce it; Discount on Issue of
//     Shares/Debentures and similar sit as a debit under Equity — both
//     intentional, not abnormal.
const CAPITAL_EQUITY_L2_RX = /reserves?\s*(and|&)\s*surplus|capital\s*account|partners?.{0,3}capital|owner.?s?\s*capital|current\s*account|drawings|share\s*capital/i
const CONTRA_ACCOUNT_RX = /accumulated\s*depreciation|provision\s*for\s*(doubtful|bad)|provision\s*for\s*diminution|discount\s*on\s*issue|preliminary\s*expenses|underwriting\s*commission/i

export function reclassifyAbnormalBalances(results, tbRowsById, lf) {
  const isDrSideAlie = (alie) => alie === 'ASSETS' || alie === 'Expenses'
  const signedClosingBal = (tbRow, alie) => {
    const bal = parseFloat(tbRow.closing_balance || 0)
    return isDrSideAlie(alie) ? -bal : bal
  }
  const otherIncomeLF  = lf.find(r => r.level1 === 'Other income'  && !r.level2)
  const otherExpenseLF = lf.find(r => r.level1 === 'Other expenses' && !r.level2)
  const otherAssetLF   = lf.find(r => r.level2 === 'Other current assets'      && !r.level3)
  const otherLiabLF    = lf.find(r => r.level2 === 'Other current liabilities' && !r.level3)
  const clearLowerLevels = (result) => {
    result.mapping3_resultant = null
    result.level4_value = null; result.level5_value = null; result.level6_value = null; result.level7_value = null
  }

  for (const result of results) {
    if (result.override_note) continue // already reclassified (Trade Payables/Receivables)
    const tbRow = tbRowsById.get(result.tb_row_id)
    if (!tbRow) continue
    // Both exclusion regexes describe Balance Sheet-only concepts (the
    // capital/reserves note itself, contra-asset/contra-equity accounts) —
    // scope them to BS-side rows only, so a P&L caption that merely
    // MENTIONS "Partners' Capital" in passing (e.g. "Interest on Partners'
    // Capital") isn't wrongly exempted from reclassification just because
    // it shares wording with the real Partners' Capital Account note.
    const isBSSide = result.alie === 'ASSETS' || result.alie === 'EQUITY AND LIABILITIES'
    const captionSources = [result.mapping1_resultant, result.mapping2_resultant, result.mapping3_resultant, tbRow.name]
    if (isBSSide && captionSources.some(c => CAPITAL_EQUITY_L2_RX.test(c || '') || CONTRA_ACCOUNT_RX.test(c || ''))) continue
    // Inter-branch / HO accounts are legitimately Dr in one set of books and
    // Cr in the other — never "abnormal", never re-routed.
    if (isBSSide && INTERBRANCH_RX.test(result.mapping1_resultant || '')) continue

    const amt = signedClosingBal(tbRow, result.alie)
    if (amt >= -0.005) continue // normal, zero, or negligible — nothing to reclassify

    if (result.alie === 'Income') {
      result.alie = 'Expenses'
      result.mapping1_resultant = 'Other expenses'
      result.mapping2_resultant = null
      clearLowerLevels(result)
      result.level_format_id = otherExpenseLF ? otherExpenseLF.id : null
      result.override_note = 'Reclassified: abnormal (debit) balance on an Income ledger — moved to Other Expenses'
    } else if (result.alie === 'Expenses') {
      result.alie = 'Income'
      result.mapping1_resultant = 'Other income'
      result.mapping2_resultant = null
      clearLowerLevels(result)
      result.level_format_id = otherIncomeLF ? otherIncomeLF.id : null
      result.override_note = 'Reclassified: abnormal (credit) balance on an Expense ledger — moved to Other Income'
    } else if (result.alie === 'ASSETS') {
      result.alie = 'EQUITY AND LIABILITIES'
      result.mapping1_resultant = otherLiabLF?.level1 || 'Current liabilities'
      result.mapping2_resultant = 'Other current liabilities'
      clearLowerLevels(result)
      result.level_format_id = otherLiabLF ? otherLiabLF.id : null
      result.override_note = 'Reclassified: abnormal (credit) balance on an Asset ledger — moved to Other current liabilities'
    } else if (result.alie === 'EQUITY AND LIABILITIES') {
      result.alie = 'ASSETS'
      result.mapping1_resultant = otherAssetLF?.level1 || 'Current assets'
      result.mapping2_resultant = 'Other current assets'
      clearLowerLevels(result)
      result.level_format_id = otherAssetLF ? otherAssetLF.id : null
      result.override_note = 'Reclassified: abnormal (debit) balance on a Liability ledger — moved to Other current assets'
    }
  }
  return results
}

// ── Persist results (upsert) ──────────────────────────────────────────────────
export async function persistMappingResults(results, database = { query, runInTransaction }) {
  await database.runInTransaction(async () => {
    for (const r of results) {
      await database.query(
        `INSERT INTO mapped_tb
           (tb_id, tb_row_id, rule_set_id, alie,
            mapping1_resultant, mapping2_resultant, mapping3_resultant,
            level_format_id, level4_value, level5_value, level6_value, level7_value,
            status, confidence,
            conflict_candidates, conflict_stage, discrepancy_suggestion, override_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (tb_id, tb_row_id) DO UPDATE SET
           rule_set_id            = EXCLUDED.rule_set_id,
           alie                   = EXCLUDED.alie,
           mapping1_resultant     = EXCLUDED.mapping1_resultant,
           mapping2_resultant     = EXCLUDED.mapping2_resultant,
           mapping3_resultant     = EXCLUDED.mapping3_resultant,
           level_format_id        = EXCLUDED.level_format_id,
           level4_value           = EXCLUDED.level4_value,
           level5_value           = EXCLUDED.level5_value,
           level6_value           = EXCLUDED.level6_value,
           level7_value           = EXCLUDED.level7_value,
           status                 = EXCLUDED.status,
           confidence             = EXCLUDED.confidence,
           conflict_candidates    = EXCLUDED.conflict_candidates,
           conflict_stage         = EXCLUDED.conflict_stage,
           discrepancy_suggestion = EXCLUDED.discrepancy_suggestion,
           override_note          = EXCLUDED.override_note,
           mapped_at              = NOW()`,
        [r.tb_id, r.tb_row_id, r.rule_set_id, r.alie,
         r.mapping1_resultant, r.mapping2_resultant, r.mapping3_resultant,
         r.level_format_id, r.level4_value, r.level5_value, r.level6_value, r.level7_value,
         r.status, r.confidence,
         r.conflict_candidates    ? JSON.stringify(r.conflict_candidates)    : null,
         r.conflict_stage ?? null,
         r.discrepancy_suggestion ? JSON.stringify(r.discrepancy_suggestion) : null,
         r.override_note || null]
      )
    }
  })
}
