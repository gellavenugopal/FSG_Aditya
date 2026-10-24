import { ipcMain } from 'electron'
import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import { query } from '../db/client.js'

// ── Companies Act 2013, Schedule II ──────────────────────────────────────────
export const SCHEDULE_II = [
  { category: 'Buildings — Factory',                             life: 30 },
  { category: 'Buildings — Other (RCC Frame)',                   life: 60 },
  { category: 'Buildings — Other (Other than RCC)',              life: 30 },
  { category: 'Bridges, Culverts, Bunders etc.',                 life: 30 },
  { category: 'Roads',                                           life: 10 },
  { category: 'Plant & Machinery — General',                     life: 15 },
  { category: 'Plant & Machinery — Continuous Process',          life: 25 },
  { category: 'Plant & Machinery — Specific (Schedule II Part C)', life: 15 },
  { category: 'Data Processing Equipment (Computers)',           life: 3  },
  { category: 'Data Processing Equipment (Servers)',             life: 6  },
  { category: 'Electrical Installations & Equipment',            life: 10 },
  { category: 'Furniture and Fixtures',                          life: 10 },
  { category: 'Motor Vehicles — Other than Two Wheelers',        life: 8  },
  { category: 'Motor Vehicles — Two Wheelers',                   life: 10 },
  { category: 'Ships',                                           life: 25 },
  { category: 'Aircraft / Helicopters',                          life: 20 },
  { category: 'Intangible Assets — Patents',                     life: 10 },
  { category: 'Intangible Assets — Goodwill',                    life: 10 },
  { category: 'Intangible Assets — Computer Software',           life: 3  },
  { category: 'Office Equipment',                                life: 5  },
  { category: 'Tools & Jigs',                                    life: 3  },
]

const RESIDUAL_PCT = 0.05

function slmRate(life) { return ((1 - RESIDUAL_PCT) / life) * 100 }
function wdvRate(life) { return (1 - Math.pow(RESIDUAL_PCT, 1 / life)) * 100 }

// ── IT Act 1961 — Block names (for template reference) ──────────────────────
const IT_BLOCKS = [
  { id: 'B1',  name: 'Buildings — Residential',                  rate: 5  },
  { id: 'B2',  name: 'Buildings — Non-Residential / Commercial', rate: 10 },
  { id: 'B3',  name: 'Buildings — Factory',                      rate: 10 },
  { id: 'F1',  name: 'Furniture & Fittings',                     rate: 10 },
  { id: 'PM1', name: 'Plant & Machinery — General',              rate: 15 },
  { id: 'PM2', name: 'Motor Cars (excluding hire/taxi)',          rate: 15 },
  { id: 'PM3', name: 'Motor Vehicles — Heavy (Hire/Taxi)',        rate: 30 },
  { id: 'PM4', name: 'Computers & Software',                     rate: 60 },
  { id: 'PM5', name: 'Ships',                                    rate: 20 },
  { id: 'PM6', name: 'Aircraft / Helicopters',                   rate: 40 },
  { id: 'IA1', name: 'Intangible Assets (Know-how / Patents)',    rate: 25 },
]

// ── IT Act 1961 — Block master for the "Dep (IT)" module ────────────────────
// This is the statutory WDV-rate table (Appendix I, IT Rules 1962) grouped by
// Major Category, used to auto-fill Rate once a ledger is assigned a Block.
// Kept separate from IT_BLOCKS above (which only feeds the existing "Dep"
// module's IT Act WDV / DTL-DTA tabs — left untouched per instruction).
export const IT_BLOCKS_MASTER = [
  { id: 'bld-residential',  majorCategory: 'I. BUILDING',                 block: 'Buildings — Residential',                                                                                                                             rate: 5  },
  { id: 'bld-nonres',       majorCategory: 'I. BUILDING',                 block: 'Buildings — Non-Residential / Commercial / Factory / Hotels',                                                                                          rate: 10 },
  { id: 'bld-temp',         majorCategory: 'I. BUILDING',                 block: 'Buildings — Temporary Erections like wooden erections and specified Buildings',                                                                        rate: 40 },
  { id: 'furniture',        majorCategory: 'II. FURNITURE AND FITTINGS',  block: 'Furniture & Fittings incl Electrical Fittings',                                                                                                        rate: 10 },
  { id: 'mp-general',       majorCategory: 'III. MACHINERY AND PLANT',    block: 'Machinery & Plant — General',                                                                                                                          rate: 15 },
  { id: 'motor-cars',       majorCategory: 'III. MACHINERY AND PLANT',    block: 'Motor Cars & Vehicles (excluding Hire / Taxi)',                                                                                                        rate: 15 },
  { id: 'motor-hire',       majorCategory: 'III. MACHINERY AND PLANT',    block: 'Motor Cars & Vehicles — used for Hire / Taxi',                                                                                                         rate: 30 },
  { id: 'computers',        majorCategory: 'III. MACHINERY AND PLANT',    block: 'Computers including Computer Software',                                                                                                                rate: 40 },
  { id: 'mp-specified-30',  majorCategory: 'III. MACHINERY AND PLANT',    block: 'Machinery & Plant - Specified 30%',                                                                                                                    rate: 30 },
  { id: 'mp-specified-40',  majorCategory: 'III. MACHINERY AND PLANT',    block: 'Machinery & Plant - Specified 40%',                                                                                                                    rate: 40 },
  { id: 'ships',            majorCategory: 'IV. SHIPS',                   block: 'Ships and Vessels',                                                                                                                                    rate: 20 },
  { id: 'intangible',       majorCategory: 'INTANGIBLE ASSETS',           block: 'Know-how, patents, copyrights, trademarks, licences, franchises or any other business or commercial rights of similar nature not being goodwill of business or profession', rate: 25 },
]

// ── Excel column map (data starts at row 3; row 1=config, row 2=headers) ─────
// A=Date  B=LedgerName  C=Category  D=RowType  E=Method  F=Life  G=CustomRate
// H=ITBlock  I=GrossOpen  J=AccumDepOpen  K=Additions  L=Deductions  M=DepDisp
// N=GrossClose[f]  O=DepRate[f]  P=ProRataMonths[f]  Q=DepYear[f]
// R=AccumClose[f]  S=NBOpen[f]  T=NBClose[f]

function makeFormula(col, n) {
  // n = row number (3-based)
  const r = String(n)
  const yearEndCell = '$B$1'  // Year-end date stored in B1

  if (col === 'N') {  // Gross Closing
    return `IF(D${r}="Opening",I${r}-L${r},K${r}-L${r})`
  }
  if (col === 'O') {  // Dep Rate %
    return `IF(G${r}<>"",G${r},IF(E${r}="SLM",(1-0.05)/F${r}*100,(1-0.05^(1/F${r}))*100))`
  }
  if (col === 'P') {  // Pro-rata months (12 for Opening; computed for Addition)
    return `IF(D${r}="Opening",12,MAX(0,MIN(12,ROUND((${yearEndCell}-A${r})/30.4375,0))))`
  }
  if (col === 'Q') {  // Dep for Year
    return (
      `IF(D${r}="Opening",` +
        `IF(E${r}="SLM",MIN(I${r}*O${r}/100,MAX(0,I${r}-J${r})),MAX(0,I${r}-J${r})*O${r}/100),` +
        `K${r}*O${r}/100*P${r}/12` +
      `)`
    )
  }
  if (col === 'R') {  // Accum Dep Closing
    return `IF(D${r}="Opening",MAX(0,J${r}+Q${r}-M${r}),MAX(0,Q${r}-M${r}))`
  }
  if (col === 'S') {  // Net Block Opening
    return `IF(D${r}="Opening",I${r}-J${r},0)`
  }
  if (col === 'T') {  // Net Block Closing
    return `N${r}-R${r}`
  }
  return ''
}

function setCellFormula(ws, cellAddr, formula, numFmt = '#,##0') {
  ws[cellAddr] = { t: 'n', f: formula, z: numFmt }
}

function setCellValue(ws, cellAddr, value, type = 's', numFmt = null) {
  ws[cellAddr] = numFmt
    ? { t: type, v: value, z: numFmt }
    : { t: type, v: value }
}

export function registerDepreciationHandlers() {
  // ── Save ───────────────────────────────────────────────────────────────────
  ipcMain.handle('dep:save', async (_, { tbId, data }) => {
    await query(
      `INSERT INTO dep_schedules (tb_id, data, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT(tb_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [tbId, JSON.stringify(data)]
    )
    return { ok: true }
  })

  // ── Load ───────────────────────────────────────────────────────────────────
  ipcMain.handle('dep:get', async (_, tbId) => {
    const { rows } = await query(`SELECT data FROM dep_schedules WHERE tb_id = $1`, [tbId])
    return rows[0] ? JSON.parse(rows[0].data) : null
  })

  // ── Schedule II lookup ─────────────────────────────────────────────────────
  ipcMain.handle('dep:scheduleII', async () => {
    return SCHEDULE_II.map(r => ({
      ...r,
      slmRate: +slmRate(r.life).toFixed(4),
      wdvRate: +wdvRate(r.life).toFixed(4),
    }))
  })

  // ── PPE ledgers from Mapped TB (for Reconciliation tab) ───────────────────
  ipcMain.handle('dep:getMappedLedgers', async (_, tbId) => {
    const { rows } = await query(
      `SELECT
         r.name            AS ledger_name,
         mt.mapping3_resultant AS m3_name,
         mt.mapping2_resultant AS m2_name,
         mt.mapping1_resultant AS m1_name,
         r.closing_balance AS balance,
         r.is_deemed_positive
       FROM mapped_tb mt
       JOIN tb_rows r ON r.id = mt.tb_row_id
       WHERE mt.tb_id = $1
       ORDER BY mt.mapping3_resultant, r.name`,
      [tbId]
    )
    return rows
  })

  // ── Download Excel Template (with embedded formulas & dropdowns) ──────────
  ipcMain.handle('dep:downloadTemplate', async () => {
    const wb = new ExcelJS.Workbook()

    // ── Sheet 1: Instructions ───────────────────────────────────────────────
    const wsInstr = wb.addWorksheet('Instructions', { properties: { tabColor: 'FF0000' } })
    const instrRows = [
      ['FSG Bharat — Fixed Assets & Depreciation Schedule Template'],
      [''],
      ['INSTRUCTIONS:'],
      ['1. The "Assets" sheet contains one row per asset/addition entry.'],
      ['2. Column A (Date): For Opening rows this is optional (original purchase date). For Addition rows this is MANDATORY — used for pro-rata depreciation calculation.'],
      ['3. Column D (Type) is AUTO-COMPUTED — do NOT edit it. It shows "Opening" if column I has a value; "Addition" if column K has a value.'],
      ['4. If the same ledger has both an opening balance AND an addition, create TWO separate rows — one row with Opening values (col I, J) and one row with the Addition amount (col K).'],
      ['5. Columns I–J (Gross Opening, Accum Dep Opening): Fill for Opening rows. When I has a value, D shows "Opening" and K-based dep formula applies only to opening.'],
      ['6. Column K (Additions): Fill for Addition rows. When K has a value, D shows "Addition" and I/J must be blank for that row.'],
      ['7. Column H (IT Block): Optional — assign to an IT Act 1961 block for WDV/DTL-DTA computation.'],
      ['8. Columns N–T are auto-computed by Excel formulas — do NOT edit them.'],
      ['9. All amounts in ₹ (rupees). Do NOT include commas or currency symbols.'],
      ['10. Year-end date must be entered in cell B1 of the Assets sheet (format: DD/MM/YYYY or YYYY-MM-DD).'],
      [''],
      ['SCHEDULE II — Useful Life Reference (Companies Act 2013):'],
      ['Asset Category', 'Useful Life (Yrs)', 'SLM Rate (%)', 'WDV Rate (%)'],
      ...SCHEDULE_II.map(r => [r.category, r.life, +slmRate(r.life).toFixed(2), +wdvRate(r.life).toFixed(2)]),
      [''],
      ['IT ACT 1961 — Block IDs (for Column H):'],
      ['Block ID', 'Block Name', 'Rate (%)'],
      ...IT_BLOCKS.map(b => [b.id, b.name, b.rate]),
    ]
    instrRows.forEach(row => wsInstr.addRow(row))
    wsInstr.columns = [{ width: 90 }, { width: 20 }, { width: 15 }, { width: 15 }]

    // ── Sheet 2: Assets ─────────────────────────────────────────────────────
    const wsAssets = wb.addWorksheet('Assets')

    // Row 1: Config
    wsAssets.getCell(1, 1).value = 'Year End Date:'
    wsAssets.getCell(1, 2).value = new Date(new Date().getFullYear(), 2, 31)
    wsAssets.getCell(1, 2).numFmt = 'DD/MM/YYYY'
    wsAssets.getCell(1, 3).value = '← Enter year-end date here (DD/MM/YYYY). Used for pro-rata calculation.'

    // Row 2: Headers
    const headers = [
      'Date (DD/MM/YYYY)', 'Ledger Name (Optional)', 'Asset Category',
      'Type [auto: Opening/Addition]', 'Method (SLM/WDV)', 'Useful Life (Yrs)',
      'Custom Dep Rate (%) [blank=auto]', 'IT Block ID', 'Gross Opening (₹)',
      'Accum Dep Opening (₹)', 'Additions (₹)', 'Deductions/Disposals (₹)',
      'Dep on Disposals (₹)', 'Gross Closing (₹) [auto]', 'Dep Rate % [auto]',
      'Pro-Rata Months [auto]', 'Dep for Year (₹) [auto]',
      'Accum Dep Closing (₹) [auto]', 'Net Block Opening (₹) [auto]',
      'Net Block Closing (₹) [auto]',
    ]
    headers.forEach((h, i) => {
      wsAssets.getCell(2, i + 1).value = h
    })

    // Sample data rows (3..8)
    const sampleData = SCHEDULE_II.slice(0, 6).map((r, i) => ({
      date: '', ledger: '', cat: r.category, type: i < 3 ? 'Opening' : 'Addition',
      method: 'WDV', life: r.life, rate: '', itBlock: '',
      grossOpen: i < 3 ? 100000 * (i + 1) : '',
      accumOpen: i < 3 ? 10000 * (i + 1) : '',
      additions: i >= 3 ? 50000 * (i - 2) : '',
      deductions: '', depDisp: '',
    }))

    sampleData.forEach((d, i) => {
      const row = i + 3
      wsAssets.getCell(row, 1).value = d.date
      wsAssets.getCell(row, 2).value = d.ledger
      wsAssets.getCell(row, 3).value = d.cat
      wsAssets.getCell(row, 4).value = { formula: `IF(K${row}>0,"Addition",IF(I${row}>0,"Opening",""))` }
      wsAssets.getCell(row, 5).value = d.method
      wsAssets.getCell(row, 6).value = d.life
      wsAssets.getCell(row, 7).value = d.rate
      wsAssets.getCell(row, 8).value = d.itBlock
      if (d.grossOpen !== '') { wsAssets.getCell(row, 9).value = d.grossOpen; wsAssets.getCell(row, 9).numFmt = '#,##0' }
      if (d.accumOpen !== '') { wsAssets.getCell(row, 10).value = d.accumOpen; wsAssets.getCell(row, 10).numFmt = '#,##0' }
      if (d.additions !== '') { wsAssets.getCell(row, 11).value = d.additions; wsAssets.getCell(row, 11).numFmt = '#,##0' }
      for (const fc of ['N','O','P','Q','R','S','T']) {
        const colNum = fc.charCodeAt(0) - 64
        wsAssets.getCell(row, colNum).value = { formula: makeFormula(fc, row) }
        wsAssets.getCell(row, colNum).numFmt = fc === 'P' ? '0' : '#,##0'
      }
    })

    // Empty rows 9–50
    for (let row = 9; row <= 50; row++) {
      wsAssets.getCell(row, 4).value = { formula: `IF(K${row}>0,"Addition",IF(I${row}>0,"Opening",""))` }
      wsAssets.getCell(row, 5).value = 'WDV'
      wsAssets.getCell(row, 6).value = 15
      for (const fc of ['N','O','P','Q','R','S','T']) {
        const colNum = fc.charCodeAt(0) - 64
        wsAssets.getCell(row, colNum).value = { formula: makeFormula(fc, row) }
        wsAssets.getCell(row, colNum).numFmt = '#,##0'
      }
    }

    // Totals row
    wsAssets.getCell(51, 1).value = 'TOTAL'
    for (const col of ['I','J','K','L','M','N','Q','R','S','T']) {
      const colNum = col.charCodeAt(0) - 64
      wsAssets.getCell(51, colNum).value = { formula: `SUM(${col}3:${col}50)` }
      wsAssets.getCell(51, colNum).numFmt = '#,##0'
    }

    // Column widths
    const widths = [14, 20, 38, 12, 8, 8, 12, 10, 14, 14, 14, 12, 12, 14, 10, 8, 14, 14, 14, 14]
    widths.forEach((w, i) => {
      wsAssets.getColumn(i + 1).width = w
    })

    // Freeze panes
    wsAssets.views = [{ state: 'frozen', xSplit: 4, ySplit: 2 }]

    return await wb.xlsx.writeBuffer()
  })

  // ── Parse uploaded Excel ───────────────────────────────────────────────────
  ipcMain.handle('dep:parseExcel', async (_, filePath) => {
    const { readFileSync } = await import('fs')
    const data  = readFileSync(filePath)
    const wb    = XLSX.read(data, { type: 'array', cellDates: true })
    const ws    = wb.Sheets['Assets']
    if (!ws) throw new Error('Sheet "Assets" not found in workbook.')

    const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
    // Row 0 = config (year end date in B0), Row 1 = headers, Row 2+ = data
    // Skip first 2 rows
    const dataRows = allRows.slice(2)

    function parseDate(raw) {
      if (!raw) return ''
      const s = String(raw).trim()
      // DD/MM/YYYY
      const dm = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
      if (dm) return `${dm[3]}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`
      // ISO
      if (s.match(/^\d{4}-\d{2}-\d{2}/)) return s.slice(0, 10)
      // Excel serial
      const n = parseFloat(s)
      if (!isNaN(n) && n > 1000) {
        const d = new Date(Math.round((n - 25569) * 86400 * 1000))
        if (!isNaN(d)) return d.toISOString().slice(0, 10)
      }
      return ''
    }

    const parsed = []
    for (const r of dataRows) {
      const category = String(r[2] || '').trim()
      if (!category) continue

      const date        = parseDate(r[0])
      const ledgerName  = String(r[1] || '').trim()
      const rowType     = String(r[3] || 'opening').toLowerCase().includes('add') ? 'addition' : 'opening'
      const method      = String(r[4] || 'WDV').toUpperCase().includes('SLM') ? 'SLM' : 'WDV'
      const usefulLife  = parseFloat(r[5]) || 15
      const customRate  = parseFloat(r[6]) || null
      const itBlock     = String(r[7] || '').trim()
      const grossOpen   = parseFloat(r[8])  || 0
      const accumDepOpen= parseFloat(r[9])  || 0
      const additions   = parseFloat(r[10]) || 0
      const deductions  = parseFloat(r[11]) || 0
      const depDisposals= parseFloat(r[12]) || 0

      parsed.push({
        id:           Math.random().toString(36).slice(2),
        rowType, date, ledgerName, category, itBlock,
        method, usefulLife, customRate: customRate != null ? String(customRate) : '',
        grossOpen, accumDepOpen, additions, deductions, depDisposals,
      })
    }
    return parsed
  })

  // ── "Dep (IT)" — Income Tax Act, 1961 block-wise WDV module ────────────────

  // Built-in block master (statutory rates) — always available, never edited.
  ipcMain.handle('dep:itBlocksMaster', async () => IT_BLOCKS_MASTER)

  // Entity-level custom blocks (added via "+ Add New Block"), additive to the
  // built-in table and reusable across every TB/year for that entity.
  ipcMain.handle('dep:itBlocksCustom', async (_, entityId) => {
    const { rows } = await query(
      `SELECT id, major_category AS "majorCategory", block_name AS block, rate
       FROM it_blocks_custom WHERE entity_id = $1 ORDER BY major_category, block_name`,
      [entityId]
    )
    return rows
  })

  ipcMain.handle('dep:saveCustomITBlock', async (_, { entityId, majorCategory, blockName, rate }) => {
    if (!entityId) throw new Error('entityId is required')
    if (!blockName || !blockName.trim()) throw new Error('Block name is required')
    if (!majorCategory || !majorCategory.trim()) throw new Error('Major Category is required')
    const rateNum = parseFloat(rate)
    if (isNaN(rateNum) || rateNum < 0 || rateNum > 100) throw new Error('Rate must be a number between 0 and 100')
    await query(
      `INSERT INTO it_blocks_custom (entity_id, major_category, block_name, rate)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(entity_id, block_name) DO UPDATE SET major_category = EXCLUDED.major_category, rate = EXCLUDED.rate`,
      [entityId, majorCategory.trim(), blockName.trim(), rateNum]
    )
    return { ok: true }
  })

  // Ledgers categorised as Property, Plant & Equipment or Intangible Assets
  // in the Mapped TB — the auto-populated "Name of Assets" rows for Dep (IT).
  // Matched on the resolved Level 2 bucket (mapping2_resultant contains both
  // "plant" and "intangible" — order/wording-independent, since the exact
  // phrase differs slightly per constitution: "Property, Plant & Equipment
  // and Intangible Assets" vs "...and Intangible assets"). Deliberately NOT
  // restricted to a specific Level 3 — many ledgers only get resolved this
  // far by the mapping engine (e.g. still "Uncategorised Property, Plant &
  // Equipment and Intangible Assets"), and those still need a Block assigned
  // here, so excluding them would silently drop real fixed-asset ledgers.
  // Only Capital WIP / Intangibles-under-development are excluded, since
  // those aren't depreciable yet.
  ipcMain.handle('dep:getITLedgers', async (_, tbId) => {
    const { rows } = await query(
      `SELECT
         r.name              AS ledger_name,
         mt.mapping3_resultant AS m3_name,
         r.closing_balance   AS balance,
         r.is_deemed_positive
       FROM mapped_tb mt
       JOIN tb_rows r ON r.id = mt.tb_row_id
       WHERE mt.tb_id = $1
         AND LOWER(mt.mapping2_resultant) LIKE '%plant%'
         AND LOWER(mt.mapping2_resultant) LIKE '%intangible%'
         AND LOWER(TRIM(COALESCE(mt.mapping3_resultant, ''))) NOT IN (
           'capital work-in-progress', 'intangible assets under development'
         )
       ORDER BY mt.mapping3_resultant, r.name`,
      [tbId]
    )
    return rows
  })

  ipcMain.handle('dep:getIT', async (_, tbId) => {
    const { rows } = await query(`SELECT data FROM dep_it_schedules WHERE tb_id = $1`, [tbId])
    return rows[0] ? JSON.parse(rows[0].data) : null
  })

  ipcMain.handle('dep:saveIT', async (_, { tbId, data }) => {
    await query(
      `INSERT INTO dep_it_schedules (tb_id, data, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT(tb_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [tbId, JSON.stringify(data)]
    )
    return { ok: true }
  })

  // ── "Dep (Comp)" — Companies Act 2013, Schedule II category-level schedule ──
  // Separate from dep_schedules (the ledger-level "Dep (Old)" module, left
  // untouched) — one row per Asset Category, not per ledger.
  ipcMain.handle('dep:getComp', async (_, tbId) => {
    const { rows } = await query(`SELECT data FROM dep_comp_schedules WHERE tb_id = $1`, [tbId])
    return rows[0] ? JSON.parse(rows[0].data) : null
  })

  ipcMain.handle('dep:saveComp', async (_, { tbId, data }) => {
    await query(
      `INSERT INTO dep_comp_schedules (tb_id, data, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT(tb_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [tbId, JSON.stringify(data)]
    )
    return { ok: true }
  })
}
