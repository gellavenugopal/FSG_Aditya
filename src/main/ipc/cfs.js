import { ipcMain } from 'electron'
import { query } from '../db/client.js'

// Cash Flow Statement (CFS tab) - what the CA types: the Previous Year column, any Current Year figure
// replaced by hand, and whether the statement goes into the PDF / Excel. One JSONB document per (entity, period):
//   { cy: { rowId: number }, py: { rowId: number }, custom: [{ id, section, label, cy, py }], hidden: [rowId], include: boolean }
// (section: 'A' end of operating, 'A1' under "Adjustments for:", 'A2' under the working-capital adjustments, 'B', 'C'; hidden: rows the CA deleted)
// The Current Year figures themselves are never stored: they are drawn from the Balance Sheet and P&L each time
// (src/renderer/src/utils/cashFlow.js).
export function registerCfsHandlers() {
  ipcMain.handle('cfs:get', async (_, entityId, entityPeriodId) => getCfs(entityId, entityPeriodId))
  ipcMain.handle('cfs:save', async (_, entityId, entityPeriodId, data) => saveCfs(entityId, entityPeriodId, data))
  registerTaxComputationHandlers()
  registerDeferredTaxHandlers()
}

// Tax Computation (Features > Tax Computation): one JSONB document per (entity, period), stored as the screen sends it (numbers cleaned).
export function registerDeferredTaxHandlers() {
  ipcMain.handle('deferredTax:get', async (_, entityId, entityPeriodId) => {
    if (!entityId || !entityPeriodId) return null
    const { rows } = await query(`SELECT data FROM deferred_tax_computations WHERE entity_id = $1 AND entity_period_id = $2`, [entityId, entityPeriodId])
    return rows[0] ? rows[0].data : null
  })
  ipcMain.handle('deferredTax:save', async (_, entityId, entityPeriodId, data) => {
    if (!entityId || !entityPeriodId) throw new Error('Missing entity/period')
    const n = (v) => { if (v === null || v === undefined || v === '') return null; const x = parseFloat(v); return Number.isFinite(x) ? x : null }
    const d = data || {}
    const ov = {}
    for (const k of ['bookDep', 'itDep', 'bookWdv', 'itWdv', 'openDTA', 'openDTL']) { const v = n(d.ov && d.ov[k]); if (v !== null) ov[k] = v }
    const rows = (a) => (Array.isArray(a) ? a : []).slice(0, 60).map(r => ({ id: String(r.id || '').slice(0, 40), label: String(r.label == null ? '' : r.label).slice(0, 200), amount: n(r.amount) || 0 })).filter(r => r.id)
    const clean = { ov, other1: rows(d.other1), other2: rows(d.other2), rate: n(d.rate), surcharge: n(d.surcharge), cess: n(d.cess) }
    await query(
      `INSERT INTO deferred_tax_computations (entity_id, entity_period_id, data, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT(entity_id, entity_period_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [entityId, entityPeriodId, JSON.stringify(clean)])
    return { ok: true }
  })
}

export function registerTaxComputationHandlers() {
  ipcMain.handle('taxComputation:get', async (_, entityId, entityPeriodId) => {
    if (!entityId || !entityPeriodId) return null
    const { rows } = await query(`SELECT data FROM tax_computations WHERE entity_id = $1 AND entity_period_id = $2`, [entityId, entityPeriodId])
    return rows[0] ? rows[0].data : null
  })
  ipcMain.handle('taxComputation:save', async (_, entityId, entityPeriodId, data) => {
    if (!entityId || !entityPeriodId) throw new Error('Missing entity/period')
    const n = (v) => { if (v === null || v === undefined || v === '') return null; const x = parseFloat(v); return Number.isFinite(x) ? x : null }
    const d = data || {}
    const ov = {}
    for (const k of ['pbt', 'dep_co', 'dep_it', 'remun', 'allowable']) { const v = n(d.ov && d.ov[k]); if (v !== null) ov[k] = v }
    const rows = (a) => (Array.isArray(a) ? a : []).slice(0, 60).map(r => ({ id: String(r.id || '').slice(0, 40), label: String(r.label == null ? '' : r.label).slice(0, 200), amount: n(r.amount) || 0 })).filter(r => r.id)
    const date = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '')
    const clean = {
      ov, additions: rows(d.additions), deductions: rows(d.deductions),
      rate: n(d.rate), surcharge: n(d.surcharge), cess: n(d.cess),
      advance: [0, 1, 2, 3].map(i => n(Array.isArray(d.advance) ? d.advance[i] : null)),
      advanceTotal: n(d.advanceTotal), tds: n(d.tds), tcs: n(d.tcs),
      dueDate: date(d.dueDate), filingDate: date(d.filingDate), presumptive: !!d.presumptive,
    }
    await query(
      `INSERT INTO tax_computations (entity_id, entity_period_id, data, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT(entity_id, entity_period_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [entityId, entityPeriodId, JSON.stringify(clean)])
    return { ok: true }
  })
}

export async function getCfs(entityId, entityPeriodId) {
  if (!entityId || !entityPeriodId) return null
  const { rows } = await query(
    `SELECT data FROM cash_flow_entries WHERE entity_id = $1 AND entity_period_id = $2`,
    [entityId, entityPeriodId]
  )
  return rows[0] ? rows[0].data : null
}

export async function saveCfs(entityId, entityPeriodId, data) {
  if (!entityId || !entityPeriodId) throw new Error('Missing entity/period')
  const clean = { cy: {}, py: {}, custom: [], hidden: [], include: !!(data && data.include), ccNote: String((data && data.ccNote) || '').slice(0, 500) }
  for (const side of ['cy', 'py']) {
    const src = (data && data[side]) || {}
    for (const k of Object.keys(src)) {
      const v = src[k]
      if (v === null || v === '' || v === undefined) continue
      const n = parseFloat(v)
      if (Number.isFinite(n)) clean[side][k] = n
    }
  }
  // Rows the CA added to an activity: { id, section: 'A' | 'B' | 'C', label, cy, py }
  const seen = new Set()
  for (const c of (data && Array.isArray(data.custom) ? data.custom : [])) {
    if (!c || !c.id || !/^(A1|A2|A|B|C)$/.test(c.section) || seen.has(String(c.id))) continue
    seen.add(String(c.id))
    const cy = parseFloat(c.cy), py = parseFloat(c.py)
    clean.custom.push({ id: String(c.id).slice(0, 40), section: c.section, label: String(c.label == null ? '' : c.label).slice(0, 200), cy: Number.isFinite(cy) ? cy : 0, py: Number.isFinite(py) ? py : 0 })
  }
  for (const id of (data && Array.isArray(data.hidden) ? data.hidden : [])) {
    const k = String(id == null ? '' : id)
    if (/^[a-z]_[a-z0-9]{1,30}$/.test(k) && !clean.hidden.includes(k) && clean.hidden.length < 60) clean.hidden.push(k)
  }
  await query(
    `INSERT INTO cash_flow_entries (entity_id, entity_period_id, data, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT(entity_id, entity_period_id) DO UPDATE SET
       data = EXCLUDED.data,
       updated_at = now()`,
    [entityId, entityPeriodId, JSON.stringify(clean)]
  )
  return { ok: true }
}
