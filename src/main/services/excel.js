import * as XLSX from 'xlsx'
import { join } from 'path'
import { createHash } from 'crypto'
import { query, runInTransaction } from '../db/client.js'
import { tryClaimMigration } from '../db/schema.js'
export { parseTBExcel, generateTBTemplate } from './tb-template.js'

// Primary mapping file: Mapping_v2.xlsx
// In dev: project root. In production: app resources folder (extraResources).
import { existsSync, readFileSync as readFileBytes } from 'fs'
import { app } from 'electron'

function findMappingFile() {
  const candidates = [
    join(process.resourcesPath || '', 'Mapping_v2.xlsx'),   // packaged app
    join(process.cwd(), 'Mapping_v2.xlsx'),                  // dev mode
    join(app?.getAppPath?.() || '', 'Mapping_v2.xlsx'),      // fallback
  ]
  return candidates.find(p => existsSync(p)) || candidates[1]
}

const SOURCE_MAPPING = findMappingFile()

// ── Read Mapping.xlsx and return parsed data ─────────────────────────────────
export function readMappingFile(filePath = SOURCE_MAPPING) {
  const wb = XLSX.readFile(filePath)

  const clean = (v) => (v === null || v === undefined || v === '' ? null : String(v).trim())

  // Normalize the "Constitution" header to a consistent case — some sheets
  // (seen in the wild: Map1/Map2/Map3 using lowercase "constitution" while
  // LevelFormat uses "Constitution") use different casing, which otherwise
  // makes downstream `row['Constitution']` lookups silently come back undefined.
  const normalizeKey = (k) => (String(k).trim().toLowerCase() === 'constitution' ? 'Constitution' : k)

  const readSheet = (name) => {
    const ws = wb.Sheets[name]
    if (!ws) return []
    return XLSX.utils.sheet_to_json(ws, { defval: null })
      .map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [normalizeKey(k), clean(v)])))
  }

  return {
    levelFormat: readSheet('LevelFormat'),
    map1:        readSheet('Map1'),
    map2:        readSheet('Map2'),
    map3:        readSheet('Map3'),
  }
}

// ── Seed / refresh default mapping from maintained mapping workbook ───────────
// Logic:
//   • If Mapping_v2.xlsx or Mapping_updated.xlsx exists → replace the default rule set with its
//     content exactly once per distinct file version (see fileHash below), keyed via
//     schema_migrations. This preserves the "edit Mapping_v2.xlsx, restart, see it reflected" dev
//     workflow while not re-wiping the shared default rule set on every one of 15 clients' launches
//     against an unchanged file (which would repeatedly null out level_format_id for every
//     already-mapped TB using the default rule set, mid-session, for everyone).
//   • If only the legacy Source/Mapping.xlsx exists and no default is in DB → seed once.
//   • Client-specific rule sets (entity_id IS NOT NULL) are never touched.
export async function seedDefaultMapping() {
  // Always refresh when using a maintained primary mapping file.
  const usingMaintainedMapping = SOURCE_MAPPING.includes('Mapping_v2')

  let data
  try {
    data = readMappingFile()
  } catch (err) {
    console.warn('Could not read default Mapping file:', err.message)
    // Fall back to existing DB default if file unreadable
    const { rows } = await query(`SELECT id FROM mapping_rule_sets WHERE is_default = TRUE LIMIT 1`)
    return rows[0]?.id ?? null
  }

  const { rows: existing } = await query(`SELECT id FROM mapping_rule_sets WHERE is_default = TRUE LIMIT 1`)

  if (existing.length > 0 && !usingMaintainedMapping) {
    // Legacy file and default already seeded — don't overwrite
    return existing[0].id
  }

  if (usingMaintainedMapping) {
    const fileHash = createHash('sha256').update(readFileBytes(SOURCE_MAPPING)).digest('hex')
    const claimed = await tryClaimMigration(`mapping_seed:${fileHash}`)
    if (!claimed) {
      // This exact file content has already been seeded (by this client on a
      // prior launch, or by another client under the shared startup lock) —
      // don't wipe and rebuild the shared default rule set again.
      return existing[0]?.id ?? null
    }
  }

  // Refresh existing default rule set: clear child tables and refill.
  // We keep the rule set row itself so foreign keys from mapped_tb etc. stay valid.
  let rsId
  if (existing.length > 0) {
    rsId = existing[0].id
    await runInTransaction(async () => {
      // Null out level_format_id references in mapped_tb before deleting level_format rows
      // (mapped_tb.level_format_id FK → level_format.id)
      await query(`UPDATE mapped_tb SET level_format_id = NULL WHERE rule_set_id = $1`, [rsId])
      await query(`DELETE FROM level_format WHERE rule_set_id = $1`, [rsId])
      await query(`DELETE FROM map1         WHERE rule_set_id = $1`, [rsId])
      await query(`DELETE FROM map2         WHERE rule_set_id = $1`, [rsId])
      await query(`DELETE FROM map3         WHERE rule_set_id = $1`, [rsId])
    })
  } else {
    const { rows: [rs] } = await query(
      `INSERT INTO mapping_rule_sets (name, is_default) VALUES ($1, TRUE) RETURNING id`,
      ['Default Mapping']
    )
    rsId = rs.id
  }

  // Wrap all seed inserts in one transaction — avoids thousands of disk writes
  await runInTransaction(async () => {
    for (let i = 0; i < data.levelFormat.length; i++) {
      const r = data.levelFormat[i]
      await query(
        `INSERT INTO level_format
          (rule_set_id, constitution, alie, level1, level2, level3, level4, level5, level6, level7, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [rsId, parseInt(r['Constitution']), r['ALIE'], r['Level 1'], r['Level 2'],
         r['Level 3'], r['Level 4'], r['Level 5'], r['Level 6'], r['Level 7'], i]
      )
    }
    for (const r of data.map1) {
      await query(
        `INSERT INTO map1 (rule_set_id, constitution, tally_pre_primary, mapping1_resultant)
         VALUES ($1,$2,$3,$4)`,
        [rsId, parseInt(r['Constitution']), r['Tally Pre-Primary'], r['Mapping1 Resultant']]
      )
    }
    for (const r of data.map2) {
      await query(
        `INSERT INTO map2
          (rule_set_id, constitution, keywords, mapping2_resultant, mapping1_resultant, priority, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [rsId, parseInt(r['Constitution']), r['Keyword'], r['Mapping2 Resultant'],
         r['Mapping1 Resultant'], parseInt(r['Priority']) || 1, r['Notes for understanding']]
      )
    }
    for (const r of data.map3) {
      await query(
        `INSERT INTO map3
          (rule_set_id, constitution, keywords, mapping1_resultant, mapping2_resultant, mapping3_resultant, priority, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [rsId, parseInt(r['Constitution']), r['Keyword'], r['Mapping1 Resultant'],
         r['Mapping2 Resultant'], r['Mapping3 Resultant'], parseInt(r['Priority']) || 1,
         r['Notes for understanding']]
      )
    }
  })

  console.log('Default mapping seeded, rule_set_id =', rsId)
  return rsId
}

// ── Ensure stock categorisation entries exist in Level Format ────────────────
export async function ensureStockCategories() {
  const { rows } = await query(`SELECT id FROM mapping_rule_sets WHERE is_default = TRUE LIMIT 1`)
  if (!rows.length) return
  const rsId = rows[0].id

  // For each constitution (1,2,3), ensure stock entries exist
  for (const c of [1, 2, 3]) {
    // 1. Opening Stock (PL) — Expenses
    const { rows: existOp } = await query(
      `SELECT id FROM level_format WHERE rule_set_id=$1 AND constitution=$2 AND level1='Opening Stock (PL)' LIMIT 1`,
      [rsId, c]
    )
    if (!existOp.length) {
      await query(
        `INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3, sort_order)
         VALUES ($1, $2, 'Expenses', 'Opening Stock (PL)', 'Opening Stock', 'Opening Stock', 9990)`,
        [rsId, c]
      )
    }

    // 2. Closing Stock (PL) — Income
    const { rows: existClPL } = await query(
      `SELECT id FROM level_format WHERE rule_set_id=$1 AND constitution=$2 AND level1='Closing Stock (PL)' LIMIT 1`,
      [rsId, c]
    )
    if (!existClPL.length) {
      await query(
        `INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3, sort_order)
         VALUES ($1, $2, 'Income', 'Closing Stock (PL)', 'Closing Stock', 'Closing Stock', 9991)`,
        [rsId, c]
      )
    }

    // 3. Closing Stock (BS) — Assets → Current assets → Inventories (check if Inventories exists)
    const { rows: existInv } = await query(
      `SELECT id FROM level_format WHERE rule_set_id=$1 AND constitution=$2 AND level2='Inventories' LIMIT 1`,
      [rsId, c]
    )
    if (!existInv.length) {
      await query(
        `INSERT INTO level_format (rule_set_id, constitution, alie, level1, level2, level3, sort_order)
         VALUES ($1, $2, 'ASSETS', 'Current assets', 'Inventories', 'Closing Stock (BS)', 9992)`,
        [rsId, c]
      )
    }

    // Add Map1 entries for stock keywords
    const { rows: existM1Op } = await query(
      `SELECT id FROM map1 WHERE rule_set_id=$1 AND constitution=$2 AND tally_pre_primary='Opening Stock' LIMIT 1`,
      [rsId, c]
    )
    if (!existM1Op.length) {
      await query(
        `INSERT INTO map1 (rule_set_id, constitution, tally_pre_primary, mapping1_resultant)
         VALUES ($1, $2, 'Opening Stock', 'Opening Stock (PL)')`,
        [rsId, c]
      )
    }

    const { rows: existM1Cl } = await query(
      `SELECT id FROM map1 WHERE rule_set_id=$1 AND constitution=$2 AND tally_pre_primary='Closing Stock' LIMIT 1`,
      [rsId, c]
    )
    if (!existM1Cl.length) {
      await query(
        `INSERT INTO map1 (rule_set_id, constitution, tally_pre_primary, mapping1_resultant)
         VALUES ($1, $2, 'Closing Stock', 'Closing Stock (PL)')`,
        [rsId, c]
      )
    }

    // Add Map2 entries for stock keywords
    const { rows: existM2Op } = await query(
      `SELECT id FROM map2 WHERE rule_set_id=$1 AND constitution=$2 AND keywords='Opening Stock' AND mapping1_resultant='Opening Stock (PL)' LIMIT 1`,
      [rsId, c]
    )
    if (!existM2Op.length) {
      await query(
        `INSERT INTO map2 (rule_set_id, constitution, keywords, mapping2_resultant, mapping1_resultant, priority)
         VALUES ($1, $2, 'Opening Stock', 'Opening Stock', 'Opening Stock (PL)', 1)`,
        [rsId, c]
      )
    }

    const { rows: existM2Cl } = await query(
      `SELECT id FROM map2 WHERE rule_set_id=$1 AND constitution=$2 AND keywords='Closing Stock - PL' AND mapping1_resultant='Closing Stock (PL)' LIMIT 1`,
      [rsId, c]
    )
    if (!existM2Cl.length) {
      await query(
        `INSERT INTO map2 (rule_set_id, constitution, keywords, mapping2_resultant, mapping1_resultant, priority)
         VALUES ($1, $2, 'Closing Stock - PL', 'Closing Stock', 'Closing Stock (PL)', 1)`,
        [rsId, c]
      )
    }

    const { rows: existM2BS } = await query(
      `SELECT id FROM map2 WHERE rule_set_id=$1 AND constitution=$2 AND keywords='Closing Stock - BS' AND mapping1_resultant='Current assets' LIMIT 1`,
      [rsId, c]
    )
    if (!existM2BS.length) {
      await query(
        `INSERT INTO map2 (rule_set_id, constitution, keywords, mapping2_resultant, mapping1_resultant, priority)
         VALUES ($1, $2, 'Closing Stock - BS', 'Inventories', 'Current assets', 1)`,
        [rsId, c]
      )
    }

    // Map3 entries for stock — so they don't fall into "Uncategorised"
    const m3Entries = [
      ['Opening Stock', 'Opening Stock (PL)', 'Opening Stock', 'Opening Stock'],
      ['Closing Stock - PL', 'Closing Stock (PL)', 'Closing Stock', 'Closing Stock'],
      ['Closing Stock - BS', 'Current assets', 'Inventories', 'Closing Stock (BS)'],
    ]
    for (const [kw, m1, m2, m3] of m3Entries) {
      const { rows: ex } = await query(
        `SELECT id FROM map3 WHERE rule_set_id=$1 AND constitution=$2 AND keywords=$3 AND mapping1_resultant=$4 AND mapping2_resultant=$5 LIMIT 1`,
        [rsId, c, kw, m1, m2]
      )
      if (!ex.length) {
        await query(
          `INSERT INTO map3 (rule_set_id, constitution, keywords, mapping1_resultant, mapping2_resultant, mapping3_resultant, priority)
           VALUES ($1, $2, $3, $4, $5, $6, 1)`,
          [rsId, c, kw, m1, m2, m3]
        )
      }
    }
  }
}

// ── Export mapping rule set to Excel ────────────────────────────────────────
export async function exportMappingToExcel(rsId) {
  const wb = XLSX.utils.book_new()

  const { rows: lf } = await query(
    `SELECT constitution, alie, level1, level2, level3, level4, level5, level6, level7
     FROM level_format WHERE rule_set_id=$1 ORDER BY sort_order`, [rsId]
  )
  const { rows: m1 } = await query(
    `SELECT constitution, tally_pre_primary AS "Tally Pre-Primary",
            mapping1_resultant AS "Mapping1 Resultant"
     FROM map1 WHERE rule_set_id=$1`, [rsId]
  )
  const { rows: m2 } = await query(
    `SELECT constitution, keywords AS "Keyword",
            mapping2_resultant AS "Mapping2 Resultant",
            mapping1_resultant AS "Mapping1 Resultant",
            priority AS "Priority", notes AS "Notes for understanding"
     FROM map2 WHERE rule_set_id=$1`, [rsId]
  )
  const { rows: m3 } = await query(
    `SELECT constitution, keywords AS "Keyword",
            mapping1_resultant AS "Mapping1 Resultant",
            mapping2_resultant AS "Mapping2 Resultant",
            mapping3_resultant AS "Mapping3 Resultant",
            priority AS "Priority", notes AS "Notes for understanding"
     FROM map3 WHERE rule_set_id=$1`, [rsId]
  )

  const addSheet = (name, data) => {
    if (!data.length) return
    const ws = XLSX.utils.json_to_sheet(data)
    XLSX.utils.book_append_sheet(wb, ws, name)
  }

  addSheet('LevelFormat', lf.map(r => ({
    Constitution: r.constitution, ALIE: r.alie,
    'Level 1': r.level1, 'Level 2': r.level2, 'Level 3': r.level3,
    'Level 4': r.level4, 'Level 5': r.level5, 'Level 6': r.level6, 'Level 7': r.level7
  })))
  addSheet('Map1', m1)
  addSheet('Map2', m2)
  addSheet('Map3', m3)

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
