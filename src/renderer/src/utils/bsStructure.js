// ── Schedule III, Division I — Balance Sheet structure (Companies Act 2013) ───
// For constitution=3 (Company). Each L2 entry carries match patterns for the
// mapped TB data. "other" entries are catch-all buckets.
// Single source of truth — used by the live BS screen, the Excel exporter,
// and the PDF exporter, so all three always render the identical structure,
// numbering, and zero-value suppression.
export const BS_STRUCTURE = {
  el: [
    {
      num: '1', label: "Shareholders' funds",
      lines: [
        { key: 'share_capital',   alpha: 'a', label: 'Share capital',                match: /share capital/i },
        { key: 'reserves',        alpha: 'b', label: 'Reserves and Surplus',          match: /reserves? (and|&) surplus/i },
        { key: 'share_warrants',  alpha: 'c', label: 'Money received against share warrants', match: /share warrant/i },
      ],
    },
    {
      num: '2', label: 'Share application money pending allotment',
      lines: [
        { key: 'share_app',       alpha: '',  label: 'Share application money pending allotment', match: /share application/i },
      ],
    },
    {
      num: '3', label: 'Non-current liabilities',
      lines: [
        { key: 'ltb',             alpha: 'a', label: 'Long-term borrowings',          match: /long.term borrow/i },
        { key: 'dtl',             alpha: 'b', label: 'Deferred tax liabilities (Net)', match: /deferred tax liabilit/i },
        { key: 'other_lt_liab',   alpha: 'c', label: 'Other long-term liabilities',   match: /other long.term liabilit/i },
        { key: 'lt_provisions',   alpha: 'd', label: 'Long-term provisions',          match: /long.term provision/i },
      ],
    },
    {
      num: '4', label: 'Current liabilities',
      lines: [
        { key: 'stb',             alpha: 'a', label: 'Short-term borrowings',         match: /short.term borrow/i },
        { key: 'trade_pay',       alpha: 'b', label: 'Trade Payables',                match: /trade payable/i },
        { key: 'other_cl',        alpha: 'c', label: 'Other current liabilities',     match: /other current liabilit/i },
        { key: 'st_provisions',   alpha: 'd', label: 'Short-term provisions',         match: /short.term provision/i },
      ],
    },
    {
      // R7: branch books only — printed only when it carries a figure (optional)
      num: '5', label: 'Inter-branch and Head Office account', optional: true,
      lines: [
        { key: 'interbranch_el',  alpha: '',  label: 'Head Office / inter-branch current account (Cr)', match: /inter.?branch|head office/i },
      ],
    },
  ],
  assets: [
    {
      num: '1', label: 'Non-current assets',
      lines: [
        // (a) is a caption with no figure of its own; (i)-(iv) beneath it carry the figures and each cites the one PPE note.
        { key: 'ppe_head',        alpha: 'a',      label: 'Property, Plant and Equipment and Intangible assets',  heading: true, match: null },
        { key: 'ppe_tangible',    alpha: 'i',      label: 'Tangible assets',                                      sub: true, match: /\btangible asset|property.plant|fixed asset|plant.machin|furniture|vehicle|building|equipment/i },
        { key: 'ppe_intangible',  alpha: 'ii',     label: 'Intangible assets',                                    sub: true, match: /intangible asset(?!s?\s+under\s+development)/i },
        { key: 'cwip',            alpha: 'iii',    label: 'Capital work-in-progress',                             sub: true, match: /capital work.in.progress|cwip/i },
        { key: 'iad',             alpha: 'iv',     label: 'Intangible assets under development',                  sub: true, match: /intangible.*development/i },
        { key: 'nc_investments',  alpha: 'b',      label: 'Non-current investments',                              match: /non.current investment/i },
        { key: 'dta',             alpha: 'c',      label: 'Deferred tax assets (Net)',                            match: /deferred tax asset/i },
        { key: 'lt_loans',        alpha: 'd',      label: 'Long-term loans and advances',                         match: /long.term loans? and advance/i },
        { key: 'other_nc_assets', alpha: 'e',      label: 'Other non-current assets',                             match: /other non.current asset/i },
      ],
    },
    {
      num: '2', label: 'Current assets',
      lines: [
        { key: 'curr_investments',alpha: 'a', label: 'Current investments',           match: /current investment/i },
        { key: 'inventories',     alpha: 'b', label: 'Inventories',                   match: /inventor/i },
        { key: 'trade_rec',       alpha: 'c', label: 'Trade receivables',             match: /trade receivable/i },
        { key: 'cash',            alpha: 'd', label: 'Cash and cash equivalents',     match: /cash and (cash equiv|bank)|cash.bank/i },
        { key: 'st_loans',        alpha: 'e', label: 'Short-term loans and advances', match: /short.term loans? and advance/i },
        { key: 'other_ca',        alpha: 'f', label: 'Other current assets',          match: /other current asset/i },
      ],
    },
    {
      // R7: Head Office books only — printed only when it carries a figure (optional)
      num: '3', label: 'Inter-branch and Head Office account', optional: true,
      lines: [
        { key: 'interbranch_as',  alpha: '',  label: 'Branch / inter-branch current account (Dr)', match: /inter.?branch|head office/i },
      ],
    },
  ],
}

export const ALPHA_SEQ = 'abcdefghijklmnopqrstuvwxyz'
const ZERO_EPS = 0.005
const isZero = (n) => Math.abs(n || 0) < ZERO_EPS
// R7 inter-branch / Head Office current account. Good bookkeeping keeps it
// nil, so it is printed on the Balance Sheet face only when it actually
// carries a figure in either year (never as a zero skeleton line).
const INTERBRANCH_RX = /inter[\s-]?branch|head office/i

// ── Section ordering (also used by useFinancials.js to sort the real
// elSections/assetSections it builds, and by computeDynamicBSLayout below
// to place newly-injected zero-skeleton sections at their correct statutory
// position rather than always at the end — see injectZeroSkeletonLines).
// Defined here (not in useFinancials.js) so this module stays import-free
// and safe for useFinancials.js to import FROM, avoiding a circular import
// (useFinancials.js already imports companyBSLineOrder from this file).
export const EL_ORDER_CORP = [
  "Shareholders' funds", "Share application money pending allotment",
  "Non-Current liabilities", "Current liabilities",
]
export const EL_ORDER_NONCORP = [
  "Partners' Funds", "Partner's Funds", "Partners Funds",
  "Owner's Fund", "Owner's Funds", "Owner's Capital",
  "Partner's Capital", "Partners' Capital", "Capital Account",
  "Proprietor's Capital", "Proprietor's Fund",
  "Non-Current liabilities", "Current liabilities",
]
export function elOrderFor(constitution) {
  return parseInt(constitution) === 3 ? EL_ORDER_CORP : EL_ORDER_NONCORP
}
export function nonCorpSectionSortKey(level1, orderList) {
  const lower = (level1 || '').toLowerCase()
  for (let i = 0; i < orderList.length; i++) {
    if (lower.includes(orderList[i].toLowerCase())) return i
  }
  if (lower.includes('uncategorised')) return 9999
  if (lower.includes('liabilities') || lower.includes('liability')) return orderList.length
  return -1
}
export function sectionSortKey(level1, orderList) {
  const lower = (level1 || '').toLowerCase()
  for (let i = 0; i < orderList.length; i++) {
    if (lower.includes(orderList[i].toLowerCase())) return i
  }
  if (lower.includes('uncategorised')) return 9999
  return orderList.length
}
export const ASSET_ORDER = [
  "Non-Current Assets", "Current assets",
]

// ── Match all lines in sections to BS_STRUCTURE buckets ───────────────────────
// Returns { buckets, unmatched }. buckets[key] = { total, prevTotal, noteNum, lines[] }
// ── Property, Plant and Equipment block under ONE Level 2 caption ───────────
// Some rule sets carry a single Level 2 — "Property, Plant and Equipment and
// Intangible assets" — with the Schedule III face lines one level down (Level
// 3: Property, plant and equipment / Intangible assets / Capital work-in-
// progress / Intangible assets under development). Matched by its Level 2
// caption alone, the whole note landed in a(i) Tangible assets although the
// note itself showed Intangible assets separately. Such a line is spread over
// the face lines by its Level 3 figures; every part still cites the one note.
const PPE_FACE_KEYS = new Set(['ppe_tangible', 'ppe_intangible', 'cwip', 'iad'])
// Only a Level 3 that IS one of the four statutory captions moves to that face
// line — descriptive Level 3s ("Buildings", "Software") never trigger a split.
const PPE_LEVEL3_CAPTIONS = [
  { key: 'iad',            rx: /^intangible assets? under development$/ },
  { key: 'cwip',           rx: /^capital work in progress$/ },
  { key: 'ppe_intangible', rx: /^intangible assets?$/ },
  { key: 'ppe_tangible',   rx: /^(property plant (and )?equipment|tangible assets?)$/ },
]
const ppeCaptionKey = (label) => {
  const norm = String(label || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z]+/g, ' ').trim()
  return PPE_LEVEL3_CAPTIONS.find(c => c.rx.test(norm))?.key || null
}

// Level-3 breakdowns are tried most authoritative first. One is used only if
// it adds up to the line itself (so the Balance Sheet totals are unchanged)
// and every figure in it belongs to a PPE face line; otherwise the line stays
// whole, as before.
function ppeLevel3Parts(l2, sec, data) {
  const candidates = []
  // 1. The note's own Level-3 rows — what the Notes screen shows, Manual PY included.
  const note = l2.noteNum != null ? data?.notes?.[l2.noteNum] : null
  const noteRows = (note?.templateRowsAll || note?.templateRows || []).filter(r => r.type === 'l3')
  if (noteRows.length) {
    candidates.push(noteRows.map(r => ({ label: String(r.label || ''), cy: Number(r.cy) || 0, py: Number(r.py) || 0 })))
  }
  // 2. The line's own ledgers (asset side: debit balances are stored negative),
  //    Previous Year from the comparative TB when one is selected.
  if ((l2.rows || []).length) {
    const byL3 = new Map()
    for (const row of l2.rows) {
      const label = String(row.mapping3_resultant || row.level3 || '').trim()
      const part = byL3.get(label) || { label, cy: 0, py: 0 }
      part.cy -= parseFloat(row.closing_balance) || 0
      part.py -= parseFloat(row.opening_balance) || 0
      byL3.set(label, part)
    }
    const parts = [...byL3.values()]
    if (data?.prevMapL3) {
      const prefix = `ASSETS|${String(sec.level1 || 'Uncategorised').trim().toLowerCase()}|${String(l2.level2 || '').trim().toLowerCase()}|`
      candidates.push(parts.map(p => ({ ...p, py: data.prevMapL3.get(prefix + p.label.toLowerCase()) || 0 })))
    } else {
      candidates.push(parts)
    }
  }
  for (const parts of candidates) {
    const byKey = new Map()
    let cy = 0, py = 0, mapsCleanly = true
    for (const p of parts) {
      cy += p.cy
      py += p.py
      if (isZero(p.cy) && isZero(p.py)) continue
      const key = ppeCaptionKey(p.label)
      if (!key) { mapsCleanly = false; break }
      const bucket = byKey.get(key) || { key, total: 0, prevTotal: 0 }
      bucket.total += p.cy
      bucket.prevTotal += p.py
      byKey.set(key, bucket)
    }
    if (!mapsCleanly || Math.abs(cy - (l2.total || 0)) > 1 || Math.abs(py - (l2.prevTotal || 0)) > 1) continue
    return byKey.size > 1 ? [...byKey.values()] : null
  }
  return null
}

// `data` (the processed financials) lets a combined PPE line be split by its
// Level 3 figures — see ppeLevel3Parts. Shared by the BS screen, PDF and Excel.
export function matchToBuckets(sections, structureGroups, data = null) {
  const buckets = {}
  for (const grp of structureGroups) {
    for (const line of grp.lines) {
      buckets[line.key] = { total: 0, prevTotal: 0, noteNum: null, lines: [] }
    }
  }
  const unmatched = []

  for (const sec of sections) {
    for (const l2 of sec.lines) {
      const label = (l2.level2 || '').trim()
      let matched = false
      for (const grp of structureGroups) {
        for (const entry of grp.lines) {
          if (entry.match && (entry.match.test(label) || entry.match.test(sec.level1))) {
            const parts = PPE_FACE_KEYS.has(entry.key) ? ppeLevel3Parts(l2, sec, data) : null
            for (const part of parts || [{ key: entry.key, total: l2.total, prevTotal: l2.prevTotal }]) {
              const bucket = buckets[part.key]
              bucket.total     += part.total
              bucket.prevTotal += part.prevTotal
              if (!bucket.noteNum) bucket.noteNum = l2.noteNum
              bucket.lines.push(l2)
            }
            matched = true
            break
          }
        }
        if (matched) break
      }
      if (!matched) {
        unmatched.push({ level1: sec.level1, level2: label, total: l2.total, prevTotal: l2.prevTotal, noteNum: l2.noteNum })
      }
    }
  }
  // The four PPE face lines are normally one note: each cites it, also those with no figure of
  // their own. (With separate notes — e.g. its own "Intangible assets" note — each keeps its own.)
  const ppeNotes = new Set([...PPE_FACE_KEYS].map(k => buckets[k]?.noteNum).filter(Boolean))
  if (ppeNotes.size === 1) {
    const only = [...ppeNotes][0]
    for (const k of PPE_FACE_KEYS) if (buckets[k] && !buckets[k].noteNum) buckets[k].noteNum = only
  }
  return { buckets, unmatched }
}

// ── Route unmatched lines to per-group uncategorised buckets ─────────────────
export function buildUncatBuckets(unmatched, groupMatchFn) {
  const byGroup  = {}
  const topLevel = { total: 0, prevTotal: 0, lines: [] }
  for (const u of unmatched) {
    const gn = groupMatchFn(u.level1)
    if (gn) {
      if (!byGroup[gn]) byGroup[gn] = { total: 0, prevTotal: 0, lines: [] }
      byGroup[gn].total     += u.total
      byGroup[gn].prevTotal += u.prevTotal
      byGroup[gn].lines.push(u)
    } else {
      topLevel.total     += u.total
      topLevel.prevTotal += u.prevTotal
      topLevel.lines.push(u)
    }
  }
  return { byGroup, topLevel }
}

export function elGroupOf(level1) {
  if (/shareholders?.fund|shareholders?.equity/i.test(level1)) return '1'
  if (/share.application/i.test(level1))                       return '2'
  if (/non.current.*liab/i.test(level1))                       return '3'
  if (/current.*liab/i.test(level1))                           return '4'
  return null
}

export function assetGroupOf(level1) {
  if (/non.current.*asset/i.test(level1)) return '1'
  if (/current.*asset/i.test(level1))     return '2'
  return null
}

/**
 * Returns the real BS line objects (from data.elSections + data.assetSections)
 * in exact Schedule III presentation order for a Company (constitution=3) —
 * the same top-to-bottom order the BS screen, Excel, and PDF all render.
 *
 * Used by note-numbering so a note's number matches where its line physically
 * appears on the face of the Balance Sheet (e.g. Trade Payables, shown above
 * Other current liabilities, always gets the lower note number regardless of
 * the raw elSections ordering or any synthetic lines injected later).
 *
 * Within each side: matched Schedule III lines in template order, then any
 * unmatched lines belonging to that L1 group, then (last) unmatched lines whose
 * L1 can't be placed in any group. Order among ties is preserved (stable sort).
 */
export function companyBSLineOrder(data) {
  const result = []
  const sides = [
    { sections: data.elSections || [],     groups: BS_STRUCTURE.el,     groupOf: elGroupOf },
    { sections: data.assetSections || [],   groups: BS_STRUCTURE.assets, groupOf: assetGroupOf },
  ]
  for (const { sections, groups, groupOf } of sides) {
    const tagged = []
    for (const sec of sections) {
      for (const l2 of sec.lines) {
        const label = (l2.level2 || '').trim()
        let gi = 998, li = 0, found = false
        for (let g = 0; g < groups.length && !found; g++) {
          for (let e = 0; e < groups[g].lines.length; e++) {
            const entry = groups[g].lines[e]
            if (entry.match && (entry.match.test(label) || entry.match.test(sec.level1))) {
              gi = g; li = e; found = true; break
            }
          }
        }
        if (!found) {
          // Unmatched: sit after the matched lines of its own L1 group, or —
          // if its L1 maps to no group — after every group (top-level uncat).
          const gnum = groupOf(sec.level1)
          const gIdx = gnum ? groups.findIndex(g => g.num === gnum) : -1
          if (gIdx >= 0) { gi = gIdx; li = 900 } else { gi = 998; li = 900 }
        }
        tagged.push({ line: l2, gi, li })
      }
    }
    tagged.sort((a, b) => (a.gi - b.gi) || (a.li - b.li))
    for (const t of tagged) result.push(t.line)
  }
  return result
}

// ── Company face: Trade payables split for MSME (Schedule III, Division I) ──
// Current liabilities (b) Trade payables is presented as
//   (A) total outstanding dues of micro enterprises and small enterprises; and
//   (B) total outstanding dues of creditors other than micro enterprises and
//       small enterprises
// — printed as "micro and small enterprises" (the CA's shorter form, so each
// line stays inside the label column).
// (A) is the Trade payables note's own MSME Level 3 line(s) — the figures the
// Notes screen shows, Previous Year from the PY TB or Manual PY alike — and (B)
// is the rest of the line, so the two always add up to the Trade payables
// figure and the Balance Sheet total is unchanged. The note's MSME disclosure
// schedule (principal / interest) is supplementary and not counted.
export const TRADE_PAY_MSME_LABELS = [
  '(A) total outstanding dues of micro and small enterprises',
  '(B) total outstanding dues of creditors other than micro and small enterprises',
]
export function tradePayablesSplit(data, noteNum, total, prevTotal) {
  const note = noteNum != null ? data?.notes?.[noteNum] : null
  const isMsme = (label) => /\b(msme|micro)\b/i.test(label || '') && !/other\s+than/i.test(label || '')
  let a = 0, ap = 0
  for (const r of note?.templateRowsAll || note?.templateRows || []) {
    if (r.type !== 'l3' || r.isMSME || r.isMSMEHeader || r.isSubtotal || !isMsme(r.label)) continue
    a += Number(r.cy) || 0
    ap += Number(r.py) || 0
  }
  return [
    { label: TRADE_PAY_MSME_LABELS[0], total: a, prevTotal: ap },
    { label: TRADE_PAY_MSME_LABELS[1], total: (Number(total) || 0) - a, prevTotal: (Number(prevTotal) || 0) - ap },
  ]
}

/**
 * Computes the full, ready-to-render Schedule III BS layout for a Company
 * (constitution=3), with zero-value uncategorised items already excluded.
 * Shape:
 *   { el: Side, assets: Side, totalEL, prevEL, totalAsset, prevAsset }
 * Side = {
 *   groups: [{ num, label, lines: [{alpha,label,noteNum,total,prevTotal}],
 *              uncat: {alpha,label,noteNum,total,prevTotal} | null,
 *              total, prevTotal }],
 *   uncatTop: {label,total,prevTotal,noteNum} | null   // ALIE known, L1 unidentifiable
 * }
 */
export function computeCompanyBSLayout(data) {
  const { buckets: elBuckets, unmatched: elUnmatched } = matchToBuckets(data.elSections, BS_STRUCTURE.el)
  const { buckets: aBuckets, unmatched: aUnmatched } = matchToBuckets(data.assetSections, BS_STRUCTURE.assets, data)
  const { byGroup: elUncatByGroup, topLevel: elUncatTop } = buildUncatBuckets(elUnmatched, elGroupOf)
  const { byGroup: aUncatByGroup, topLevel: aUncatTop } = buildUncatBuckets(aUnmatched, assetGroupOf)

  const buildSide = (structureGroups, buckets, uncatByGroup) => {
    const groups = structureGroups.map(grp => {
      const lines = grp.lines.map(entry => {
        const line = {
          alpha: entry.alpha, label: entry.label, key: entry.key,
          heading: !!entry.heading, sub: !!entry.sub,
          noteNum: buckets[entry.key]?.noteNum || null,
          total: buckets[entry.key]?.total || 0,
          prevTotal: buckets[entry.key]?.prevTotal || 0,
        }
        // Trade payables: a caption over its (A) MSME / (B) other lines, which carry the figures.
        if (entry.key === 'trade_pay') line.subLines = tradePayablesSplit(data, line.noteNum, line.total, line.prevTotal)
        return line
      })
      const uncat = uncatByGroup[grp.num]
      const hasUncat = uncat && !(isZero(uncat.total) && isZero(uncat.prevTotal))
      const matchedTotal = lines.reduce((s, l) => s + l.total, 0)
      const matchedPrevTotal = lines.reduce((s, l) => s + l.prevTotal, 0)
      return {
        num: grp.num, label: grp.label, lines,
        uncat: hasUncat ? {
          alpha: ALPHA_SEQ[grp.lines.filter(l => !l.sub).length] || '',   // the next letter — (i)-(iv) are not letters
          label: `Uncategorised ${grp.label}`,
          noteNum: uncat.lines[0]?.noteNum || null,
          total: uncat.total, prevTotal: uncat.prevTotal,
        } : null,
        total: matchedTotal + (hasUncat ? uncat.total : 0),
        prevTotal: matchedPrevTotal + (hasUncat ? uncat.prevTotal : 0),
        optional: !!grp.optional,
      }
    }).filter(g => !g.optional || !(isZero(g.total) && isZero(g.prevTotal)))   // R7: optional groups print only with a figure
    const uncatTopRaw = uncatByGroup === elUncatByGroup ? elUncatTop : aUncatTop
    const hasUncatTop = !(isZero(uncatTopRaw.total) && isZero(uncatTopRaw.prevTotal))
    return {
      groups,
      uncatTop: hasUncatTop ? {
        label: uncatByGroup === elUncatByGroup ? 'Uncategorised Liabilities' : 'Uncategorised Assets',
        noteNum: uncatTopRaw.lines[0]?.noteNum || null,
        total: uncatTopRaw.total, prevTotal: uncatTopRaw.prevTotal,
      } : null,
    }
  }

  const el = buildSide(BS_STRUCTURE.el, elBuckets, elUncatByGroup)
  const assets = buildSide(BS_STRUCTURE.assets, aBuckets, aUncatByGroup)

  const elKeys = BS_STRUCTURE.el.flatMap(g => g.lines.map(l => l.key))
  const assetKeys = BS_STRUCTURE.assets.flatMap(g => g.lines.map(l => l.key))
  const matchedELcy = elKeys.reduce((s, k) => s + (elBuckets[k]?.total || 0), 0)
  const matchedELpy = elKeys.reduce((s, k) => s + (elBuckets[k]?.prevTotal || 0), 0)
  const uncatELcy = Object.values(elUncatByGroup).reduce((s, v) => s + v.total, 0) + elUncatTop.total
  const uncatELpy = Object.values(elUncatByGroup).reduce((s, v) => s + v.prevTotal, 0) + elUncatTop.prevTotal
  const matchedACy = assetKeys.reduce((s, k) => s + (aBuckets[k]?.total || 0), 0)
  const matchedAPy = assetKeys.reduce((s, k) => s + (aBuckets[k]?.prevTotal || 0), 0)
  const uncatACy = Object.values(aUncatByGroup).reduce((s, v) => s + v.total, 0) + aUncatTop.total
  const uncatAPy = Object.values(aUncatByGroup).reduce((s, v) => s + v.prevTotal, 0) + aUncatTop.prevTotal

  return {
    el, assets,
    totalEL: matchedELcy + uncatELcy, prevEL: matchedELpy + uncatELpy,
    totalAsset: matchedACy + uncatACy, prevAsset: matchedAPy + uncatAPy,
  }
}

/**
 * Computes the dynamic (non-corporate) BS layout, with zero-value
 * uncategorised sections/lines already excluded — mirrors DynamicBS.
 * Shape: { el: DynSide, assets: DynSide, totalEL, prevEL, totalAsset, prevAsset }
 * DynSide = [{ level1, isUncat, total, prevTotal,
 *              lines: [{level2,isUncat,noteNum,total,prevTotal}] }]
 */
// Non-corporate constitutions have no fixed BS_STRUCTURE template (see
// companyBSLineOrder below) — the face is built purely from whatever
// Level1/Level2 sections actually have ledgers mapped to them. That means a
// statutory line with a genuinely zero total (or, worse, a real Level2 that
// currently has NO ledgers mapped at all) simply never appears — on the BS
// face OR anywhere else, since a zero line also never gets a Note. Per
// Schedule III convention the face should always show the complete
// pro-forma line list; only Notes should skip zero-value particulars.
//
// This inserts a zero-value placeholder line for every valid Level1/Level2
// pair (from LevelFormat, for this entity's constitution) that isn't already
// present with real data.
//
// Append-only for LINES within an existing real section: the correct
// Schedule III position for L2 lines (BS_L2_ORDER) is already applied
// upstream in useFinancials.js, precisely BECAUSE LevelFormat's own
// sort_order is often unset/tied and not a reliable ordering signal on its
// own (see BS_L2_ORDER's doc comment there). Re-deriving position from
// sort_order here would silently undo that correct upstream order for
// lines that already exist. So: never reorder an existing section's real
// lines — an injected zero LINE always goes at the end of its section.
//
// SECTIONS are different: a brand-new section only gets created here when
// NONE of its lines have real data (fully zero/unmapped), so there's no
// existing real order to protect — but it still has a fixed Schedule III
// slot (via sortKeyFor, the same order list/function useFinancials.js
// already sorted the real sections with upstream). Appending it blindly at
// the very end put e.g. an all-zero "Non-current liabilities" section
// after "Current liabilities", which is statutorily backwards. So new
// sections are spliced into their correct position relative to the real
// (untouched) sections instead of always landing last.
function injectZeroSkeletonLines(realSections, levelFormatRows, alie, sortKeyFor) {
  const lf = (levelFormatRows || []).filter(r => r.alie === alie)
  if (!lf.length) return realSections

  // Keyed by normalised caption, not raw text: the mapped data and the rule
  // set's level_format routinely disagree on hyphens or casing ("Non-Current
  // Liabilities" vs "Non Current Liabilities"), and matching literally made the
  // injector treat them as different headings — printing the section twice, once
  // with the real figures and once as an empty skeleton.
  const existingL1 = new Map(realSections.map(s => [normCaption(s.level1), s]))
  const existingL2 = new Set()
  for (const s of realSections) for (const l of s.lines) existingL2.add(`${normCaption(s.level1)}|||${normCaption(l.level2)}`)

  const out = [...realSections]
  const seenL1 = new Set()
  for (const row of lf) {
    const l1 = (row.level1 || '').trim()
    const l2 = (row.level2 || '').trim()
    if (!l1 || !l2 || /uncategorised/i.test(l1) || /uncategorised/i.test(l2)) continue
    if (INTERBRANCH_RX.test(l1)) continue   // optional group: only real, non-nil figures reach the face
    const key = `${normCaption(l1)}|||${normCaption(l2)}`
    if (existingL2.has(key)) continue // already has real data — never touch it
    if (seenL1.has(key)) continue
    seenL1.add(key)

    let sec = existingL1.get(normCaption(l1))
    if (!sec) {
      sec = { level1: l1, isUncat: false, total: 0, prevTotal: 0, lines: [] }
      existingL1.set(normCaption(l1), sec)
      let insertAt = out.length
      if (sortKeyFor) {
        const newKey = sortKeyFor(l1)
        for (let i = 0; i < out.length; i++) {
          if (sortKeyFor(out[i].level1) > newKey) { insertAt = i; break }
        }
      }
      out.splice(insertAt, 0, sec)
    }
    sec.lines.push({ level2: l2, isUncat: false, noteNum: null, total: 0, prevTotal: 0 })
    existingL2.add(key)
  }
  return out
}

// ── Statutory presentation order ─────────────────────────────────────────────
// level_format is the rule set's own definition of the face, per constitution,
// and mapping:levelFormat already returns it ORDER BY sort_order. That sequence
// — not the order the mapped data happens to arrive in — is what the Balance
// Sheet must follow, so it is the single source of truth used here.
//
// Without this, two things went wrong. A statutory line with no figures was
// appended by injectZeroSkeletonLines rather than placed, so zero lines such as
// Current investments and Inventories fell to the bottom of Current assets
// instead of sitting at (a) and (b). And realSections were never re-sorted at
// all, so a recategorisation that changed the order the sections were built in
// could print Non-current liabilities BELOW Current liabilities.
//
// Captions are normalised for case, hyphens and spacing before comparison, so
// "Non-Current Liabilities", "Non current liabilities" and "non-current
// liabilities" are one and the same line.
const normCaption = (s) => (s || '').trim().toLowerCase().replace(/[\s\-_]+/g, ' ')

function buildFormatOrder(levelFormatRows, alie) {
  const l1Index = new Map()
  const l2Index = new Map()
  let seq = 0
  for (const row of (levelFormatRows || [])) {
    if (row.alie !== alie) continue
    const l1 = normCaption(row.level1)
    const l2 = normCaption(row.level2)
    if (!l1) continue
    if (!l1Index.has(l1)) l1Index.set(l1, seq++)
    if (l2) {
      const key = `${l1}|||${l2}`
      if (!l2Index.has(key)) l2Index.set(key, seq++)
    }
  }
  return { l1Index, l2Index }
}

// Three tiers, so an unrecognised caption is never interleaved with statutory
// ones: 0 = named in the format (ordered by sort_order), 1 = a real caption the
// format doesn't define (kept, after the statutory block, in its existing
// order), 2 = Uncategorised, always last. Sort is stable, so tiers 1 and 2 keep
// the order they came in.
function applyFormatOrder(sections, levelFormatRows, alie) {
  const { l1Index, l2Index } = buildFormatOrder(levelFormatRows, alie)
  if (!l1Index.size) return sections

  const rank = (index, key, isUncat) => {
    if (isUncat) return [2, 0]
    const at = index.get(key)
    return at === undefined ? [1, 0] : [0, at]
  }
  const byRank = (a, b) => (a.t[0] - b.t[0]) || (a.t[1] - b.t[1])

  const orderedSections = sections
    .map((sec, i) => {
      const l1 = normCaption(sec.level1)
      const isU = sec.isUncat || !l1 || l1.includes('uncategorised')
      const lines = sec.lines
        .map((line, j) => {
          const l2 = normCaption(line.level2)
          const lu = line.isUncat || !l2 || l2.includes('uncategorised')
          return { line, j, t: rank(l2Index, `${l1}|||${l2}`, lu) }
        })
        .sort(byRank)
        .map(x => x.line)
      return { sec: { ...sec, lines }, i, t: rank(l1Index, l1, isU) }
    })
    .sort(byRank)
    .map(x => x.sec)

  return orderedSections
}

export function computeDynamicBSLayout(data, constitution) {
  const elOrder  = elOrderFor(constitution)
  const elKeyFn  = parseInt(constitution) === 3 ? sectionSortKey : nonCorpSectionSortKey
  const elSortKeyFor    = (l1) => elKeyFn(l1, elOrder)
  const assetSortKeyFor = (l1) => sectionSortKey(l1, ASSET_ORDER)

  const buildSide = (sections, alie, sortKeyFor) => {
    const real = sections.map(sec => {
      const l1 = sec.level1 || ''
      const isU = !l1 || l1.toLowerCase().includes('uncategorised')
      const isIB = INTERBRANCH_RX.test(l1)
      if ((isU || isIB) && isZero(sec.total) && isZero(sec.prevTotal)) return null
      const lines = sec.lines.map(line => {
        const l2 = line.level2 || ''
        const lineU = !l2 || l2.toLowerCase().includes('uncategorised')
        if ((lineU || isIB) && isZero(line.total) && isZero(line.prevTotal)) return null
        return { level2: l2, isUncat: lineU, noteNum: line.noteNum, total: line.total, prevTotal: line.prevTotal }
      }).filter(Boolean)
      return { level1: l1, isUncat: isU, total: sec.total, prevTotal: sec.prevTotal, lines }
    }).filter(Boolean)
    const withSkeleton = injectZeroSkeletonLines(real, data.levelFormat, alie, sortKeyFor)
    // Order last, so both real and injected lines land in statutory sequence.
    return applyFormatOrder(withSkeleton, data.levelFormat, alie)
  }

  const grandPrevEL = data.elSections.reduce((s, sec) => s + sec.prevTotal, 0)
  const grandPrevAssets = data.assetSections.reduce((s, sec) => s + sec.prevTotal, 0)

  return {
    el: buildSide(data.elSections, 'EQUITY AND LIABILITIES', elSortKeyFor),
    assets: buildSide(data.assetSections, 'ASSETS', assetSortKeyFor),
    totalEL: data.totalEL, prevEL: grandPrevEL,
    totalAsset: data.totalAssets, prevAsset: grandPrevAssets,
  }
}
