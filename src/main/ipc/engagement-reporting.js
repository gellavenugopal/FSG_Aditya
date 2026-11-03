import { dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { renderHtmlToPdf } from './pdf-rendering.js'
import { buildUaeEngagementWorkbook } from '../services/uae-engagement-workbook.js'
import { buildUaeEngagementWordDocument } from '../services/uae-engagement-word.js'
import { buildDraftWordDocument, buildDraftWorkbook } from '../services/uae-draft-report.js'
import { DRAFT_MODEL_SCHEMA, buildDraftReportHtml } from '../../shared/uae-draft-report-model.mjs'

const DRAFT_FORMATS = {
  pdf: { name: 'PDF document', extension: 'pdf', signature: '%PDF-' },
  docx: { name: 'Word document', extension: 'docx', signature: 'PK' },
  xlsx: { name: 'Excel workbook', extension: 'xlsx', signature: 'PK' },
}

export function registerEngagementReportingDesktopHandlers() {
  ipcMain.handle('engagement:renderPDF', async (_, html) => renderHtmlToPdf(html))

  // Renders the three draft formats from one trusted model returned by the engagement service.
  ipcMain.handle('engagement:draftReportBuildFiles', async (_, model) => {
    if (!model || model.schema !== DRAFT_MODEL_SCHEMA || !Array.isArray(model.sfp) || !Array.isArray(model.pl)) {
      throw new Error('A draft report model from the engagement service is required.')
    }
    const [pdf, docx, xlsx] = await Promise.all([
      renderHtmlToPdf(buildDraftReportHtml(model)),
      buildDraftWordDocument(model),
      buildDraftWorkbook(model),
    ])
    const files = { pdf: Buffer.from(pdf), docx, xlsx }
    for (const [format, buffer] of Object.entries(files)) {
      if (buffer.length > 8 * 1024 * 1024) throw new Error(`The draft ${format.toUpperCase()} exceeds the 8 MB limit.`)
    }
    return { pdfBase64: files.pdf.toString('base64'), docxBase64: docx.toString('base64'), xlsxBase64: xlsx.toString('base64') }
  })

  ipcMain.handle('engagement:draftReportSaveFile', async (_, input = {}) => {
    const format = DRAFT_FORMATS[input.format]
    if (!format) throw new Error('Unknown draft report format.')
    const encoded = input.contentBase64
    if (typeof encoded !== 'string' || encoded.length > 12 * 1024 * 1024) throw new Error('The saved draft file is invalid.')
    const content = Buffer.from(encoded, 'base64')
    if (content.subarray(0, format.signature.length).toString('latin1') !== format.signature) throw new Error('The saved draft file is not a valid document.')
    const result = await dialog.showSaveDialog({
      title: `Save draft ${format.name}`,
      defaultPath: String(input.defaultName || `Draft-report.${format.extension}`).replace(/[\\/:*?"<>|]/g, '_'),
      filters: [{ name: format.name, extensions: [format.extension] }],
    })
    if (result.canceled || !result.filePath) return { cancelled: true }
    await writeFile(result.filePath, content)
    return { filePath: result.filePath }
  })

  ipcMain.handle('engagement:savePdfFile', async (_, input = {}) => {
    const encoded = input.contentBase64
    if (typeof encoded !== 'string' || encoded.length > 28 * 1024 * 1024
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new Error('Select a valid PDF file no larger than 20 MB.')
    }
    const content = Buffer.from(encoded, 'base64')
    if (content.toString('base64') !== encoded || content.length > 20 * 1024 * 1024
      || content.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('The selected report is not a valid PDF or exceeds the 20 MB limit.')
    }
    const result = await dialog.showSaveDialog({
      title: 'Save combined financial reporting pack',
      defaultPath: String(input.defaultName || 'Financial-Reporting-Pack.pdf').replace(/[\\/:*?"<>|]/g, '_'),
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) return { cancelled: true }
    await writeFile(result.filePath, content, { flag: 'wx' }).catch(async error => {
      if (error.code !== 'EEXIST') throw error
      await writeFile(result.filePath, content)
    })
    return { filePath: result.filePath }
  })

  ipcMain.handle('engagement:exportUaeWorkbook', async (_, source = {}) => {
    const buffer = await buildUaeEngagementWorkbook(source)
    if (buffer.byteLength > 20 * 1024 * 1024) throw new Error('The workbook exceeds the 20 MB export limit.')
    const result = await dialog.showSaveDialog({
      title: 'Save UAE demonstration workbook',
      defaultPath: String(source.defaultName || 'UAE-Demonstration-Reporting.xlsx').replace(/[\\/:*?"<>|]/g, '_'),
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
    })
    if (result.canceled || !result.filePath) return { cancelled: true }
    await writeFile(result.filePath, buffer, { flag: 'wx' }).catch(async error => {
      if (error.code !== 'EEXIST') throw error
      await writeFile(result.filePath, buffer)
    })
    return { filePath: result.filePath }
  })

  ipcMain.handle('engagement:exportUaeWord', async (_, source = {}) => {
    const buffer = await buildUaeEngagementWordDocument(source)
    if (buffer.byteLength > 20 * 1024 * 1024) throw new Error('The Word document exceeds the 20 MB export limit.')
    const result = await dialog.showSaveDialog({
      title: 'Save UAE demonstration Word reporting pack',
      defaultPath: String(source.defaultName || 'UAE-Demonstration-Reporting.docx').replace(/[\\/:*?"<>|]/g, '_'),
      filters: [{ name: 'Word document', extensions: ['docx'] }],
    })
    if (result.canceled || !result.filePath) return { cancelled: true }
    await writeFile(result.filePath, buffer, { flag: 'wx' }).catch(async error => {
      if (error.code !== 'EEXIST') throw error
      await writeFile(result.filePath, buffer)
    })
    return { filePath: result.filePath }
  })
}
