// One-off: apply ensureSchema() (idempotent ADD COLUMN IF NOT EXISTS etc.)
// against the dev DB, exactly like the app does on every launch — so the
// e2e harness (which only calls initDB(), not ensureSchema()) can exercise
// a schema change before it's actually shipped in a build.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const ROOT = 'C:/Users/Aditya Maheshwari/Desktop/JE_Financial_App'
const { initDB } = await import(pathToFileURL(path.join(ROOT, 'src/main/db/client.js')).href)
const { ensureSchema } = await import(pathToFileURL(path.join(ROOT, 'src/main/db/schema.js')).href)
await initDB()
await ensureSchema()
console.log('ensureSchema() applied.')
process.exit(0)
