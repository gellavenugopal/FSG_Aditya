import { createHash } from 'node:crypto'

export function calculateUaeReportDataHash({ snapshot, finalRows, uaeMappings }) {
  const mappingById = new Map((uaeMappings || []).map(item => [
    String(item.trialBalanceRowId), item.lineKey || null,
  ]))
  const rows = (finalRows || []).map(row => ({
    id: row.id,
    name: row.name,
    ledger_code: row.ledger_code,
    opening_balance: row.opening_balance,
    closing_balance: row.closing_balance,
    line_key: mappingById.get(String(row.id)) || null,
  }))
  return createHash('sha256').update(JSON.stringify({
    snapshotId: Number(snapshot.id),
    version: Number(snapshot.version),
    journalWatermark: Number(snapshot.journal_watermark),
    rows,
  })).digest('hex')
}
