// Minimal Electron stand-in so the REAL main-process modules (db/client.js,
// ipc/*.js, services/*.js) run under plain Node against the dev database.
// safeStorage.decryptString mirrors Chromium's v10 AES-256-GCM using the
// DPAPI-unwrapped key the runner puts in k.tmp (never printed, wiped after).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const KEY_FILE = process.env.E2E_KEY_FILE
const key = KEY_FILE && fs.existsSync(KEY_FILE) ? Buffer.from(fs.readFileSync(KEY_FILE, 'ascii'), 'base64') : null

export const app = {
  getPath: (name) => name === 'userData' ? path.join(process.env.APPDATA, 'fsg-bharat') : process.cwd(),
  getAppPath: () => process.cwd(),
  isPackaged: false,
}
export const safeStorage = {
  isEncryptionAvailable: () => !!key,
  decryptString: (buf) => {
    const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(3, 15))
    d.setAuthTag(buf.subarray(buf.length - 16))
    return Buffer.concat([d.update(buf.subarray(15, buf.length - 16)), d.final()]).toString('utf8')
  },
  encryptString: (s) => Buffer.from(s, 'utf8'),
}
globalThis.__ipc = globalThis.__ipc || {}
export const ipcMain = {
  handle: (name, fn) => { globalThis.__ipc[name] = fn },
  on: () => {},
}
export const dialog = { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }) }
export class BrowserWindow { constructor() {} loadURL() {} close() {} get webContents() { return { printToPDF: async () => Buffer.alloc(0) } } }
export default { app, safeStorage, ipcMain, dialog, BrowserWindow }
