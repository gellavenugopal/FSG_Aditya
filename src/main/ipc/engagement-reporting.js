import { dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { renderHtmlToPdf } from './pdf-rendering.js'
import { buildUaeEngagementWorkbook } from '../services/uae-engagement-workbook.js'

export function registerEngagementReportingDesktopHandlers() {
  ipcMain.handle('engagement:renderPDF', async (_, html) => renderHtmlToPdf(html))

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
}
