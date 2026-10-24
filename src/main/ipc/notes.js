import { ipcMain } from 'electron'
import { noteStore } from '../db/noteStore.js'

// Every read/write here finds the note's saved row by TITLE — see noteStore.js.
const findRow = (tbId, noteNum, noteTitle) => noteStore.find('note_details', tbId, noteNum, noteTitle)
const saveRow = (tbId, noteNum, noteTitle, data, existingRow) =>
  noteStore.save('note_details', tbId, noteNum, noteTitle, JSON.stringify(data), existingRow)
const parsed = (row) => (row ? JSON.parse(row.value) : null)

export function registerNotesHandlers() {
  // Get MSME Trade Payables disclosure data
  ipcMain.handle('notesGetMSME', async (_, tbId, noteNum, noteTitle) => {
    if (!tbId || !noteNum) return null
    try {
      return parsed(await findRow(tbId, noteNum, noteTitle))
    } catch (e) {
      console.error('Failed to load MSME data:', e)
      return null
    }
  })

  // Save MSME Trade Payables disclosure data (merged with existing ageing data if present)
  ipcMain.handle('notesSaveMSME', async (_, tbId, noteNum, noteTitle, data) => {
    if (!tbId || !noteNum || !noteTitle) throw new Error('Missing TB ID, note number, or note title')
    try {
      const existingRow = await findRow(tbId, noteNum, noteTitle)
      const combinedData = { msme: data }
      try {
        const existingData = parsed(existingRow)
        if (existingData?.ageing) combinedData.ageing = existingData.ageing
      } catch (e) {}
      await saveRow(tbId, noteNum, noteTitle, combinedData, existingRow)
      return { success: true }
    } catch (e) {
      console.error('Failed to save MSME data:', e)
      throw new Error(e.message || 'Failed to save MSME disclosure data')
    }
  })

  // Get Cash & Bank Balances disclosure data
  ipcMain.handle('notesGetCashBank', async (_, tbId, noteNum, noteTitle) => {
    if (!tbId || !noteNum) return null
    try {
      return parsed(await findRow(tbId, noteNum, noteTitle))
    } catch (e) {
      console.error('Failed to load Cash & Bank data:', e)
      return null
    }
  })

  // Save Cash & Bank Balances disclosure data
  ipcMain.handle('notesSaveCashBank', async (_, tbId, noteNum, noteTitle, data) => {
    if (!tbId || !noteNum || !noteTitle) throw new Error('Missing TB ID, note number, or note title')
    try {
      await saveRow(tbId, noteNum, noteTitle, data)
      return { success: true }
    } catch (e) {
      console.error('Failed to save Cash & Bank data:', e)
      throw new Error(e.message || 'Failed to save Cash & Bank disclosure data')
    }
  })

  // Get Trade Receivables Ageing Schedule data
  ipcMain.handle('notesGetTradeReceivablesAging', async (_, tbId, noteNum, noteTitle) => {
    if (!tbId || !noteNum) return null
    try {
      return parsed(await findRow(tbId, noteNum, noteTitle))
    } catch (e) {
      console.error('Failed to load Trade Receivables Ageing data:', e)
      return null
    }
  })

  // Save Trade Receivables Ageing Schedule data
  ipcMain.handle('notesSaveTradeReceivablesAging', async (_, tbId, noteNum, noteTitle, data) => {
    if (!tbId || !noteNum || !noteTitle) throw new Error('Missing TB ID, note number, or note title')
    try {
      await saveRow(tbId, noteNum, noteTitle, data)
      return { success: true }
    } catch (e) {
      console.error('Failed to save Trade Receivables Ageing data:', e)
      throw new Error(e.message || 'Failed to save Trade Receivables Ageing Schedule')
    }
  })

  // Get Trade Payables Ageing Schedule data
  ipcMain.handle('notesGetTradePayablesAging', async (_, tbId, noteNum, noteTitle) => {
    if (!tbId || !noteNum) return null
    try {
      return parsed(await findRow(tbId, noteNum, noteTitle))
    } catch (e) {
      console.error('Failed to load Trade Payables Ageing data:', e)
      return null
    }
  })

  // Save Trade Payables Ageing Schedule data (merged with existing MSME data if present)
  ipcMain.handle('notesSaveTradePayablesAging', async (_, tbId, noteNum, noteTitle, data) => {
    if (!tbId || !noteNum || !noteTitle) throw new Error('Missing TB ID, note number, or note title')
    try {
      const existingRow = await findRow(tbId, noteNum, noteTitle)
      const combinedData = { ageing: data }
      try {
        const existingData = parsed(existingRow)
        if (existingData?.msme) combinedData.msme = existingData.msme
      } catch (e) {}
      await saveRow(tbId, noteNum, noteTitle, combinedData, existingRow)
      return { success: true }
    } catch (e) {
      console.error('Failed to save Trade Payables Ageing data:', e)
      throw new Error(e.message || 'Failed to save Trade Payables Ageing Schedule')
    }
  })
}
