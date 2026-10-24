// Fills the user's ITR BS/PL entries back into the ORIGINAL reference
// workbook for the entity's constitution group, so the download preserves
// the exact "hard format" (labels, merged cells, borders, formulas) the
// figures were entered against — only the orange input cells and the
// dynamic Details tables are written; every formula cell is left untouched
// so Excel recalculates totals itself when the file is opened.
import ExcelJS from 'exceljs'
import { join } from 'path'
import { existsSync } from 'fs'
import { app } from 'electron'
import { ITR_DETAILS_BLOCKS } from '../../renderer/src/utils/itrDetailsBlocks.js'

function templatePath(group) {
  const candidates = [
    join(process.resourcesPath || '', 'itr-templates', `${group}.xlsx`),  // packaged app
    join(process.cwd(), 'itr-templates', `${group}.xlsx`),                // dev mode
    join(app?.getAppPath?.() || '', 'itr-templates', `${group}.xlsx`),    // fallback
  ]
  return candidates.find((p) => existsSync(p)) || candidates[1]
}

export async function buildItrExcel({ group, formValues, detailsData }) {
  const path = templatePath(group)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)

  for (const [id, raw] of Object.entries(formValues || {})) {
    const [sheetName, cellRef] = id.split('!')
    const ws = wb.getWorksheet(sheetName)
    if (!ws) continue
    const num = parseFloat(raw)
    if (raw === '' || raw == null || isNaN(num)) continue
    ws.getCell(cellRef).value = num
  }

  for (const block of ITR_DETAILS_BLOCKS) {
    const list = detailsData?.[block.key]
    if (!list || !list.length) continue
    const ws = wb.getWorksheet(block.sheet)
    if (!ws) continue
    list.forEach((entry, i) => {
      const row = block.startRow + i
      for (const col of block.columns) {
        const val = entry?.[col.key]
        if (val === '' || val == null) continue
        ws.getCell(`${col.col}${row}`).value = col.type === 'number' ? (parseFloat(val) || 0) : String(val)
      }
    })
  }

  return wb.xlsx.writeBuffer()
}
