const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function financialPeriodLabel(closingDate) {
  const value = closingDate instanceof Date
    ? closingDate.toISOString().slice(0, 10)
    : String(closingDate || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null
  const [, year, month] = /^(\d{4})-(\d{2})-\d{2}$/.exec(value)
  return `${MONTHS[Number(month) - 1]}${year}`
}

export const DEFAULT_FINANCIAL_PERIODS = Object.freeze([
  { date_from: '2024-01-01', date_till: '2024-12-31' },
  { date_from: '2025-01-01', date_till: '2025-12-31' },
  { date_from: '2026-01-01', date_till: '2026-12-31' },
  { date_from: '2026-01-01', date_till: '2026-03-31' },
  { date_from: '2026-04-01', date_till: '2026-06-30' },
  { date_from: '2026-07-01', date_till: '2026-09-30' },
  { date_from: '2026-10-01', date_till: '2026-12-31' },
  { date_from: '2024-04-01', date_till: '2025-03-31' },
  { date_from: '2025-04-01', date_till: '2026-03-31' },
  { date_from: '2026-04-01', date_till: '2027-03-31' },
].map(period => Object.freeze({
  ...period,
  year_label: financialPeriodLabel(period.date_till),
})))

export async function seedFinancialPeriodMasters(query) {
  if (typeof query !== 'function') throw new Error('A database query function is required to seed financial periods.')

  for (const period of DEFAULT_FINANCIAL_PERIODS) {
    await query(
      `INSERT INTO financial_periods (year_label,date_from,date_till)
       VALUES ($1,$2,$3)
       ON CONFLICT (date_from,date_till) DO UPDATE SET year_label=EXCLUDED.year_label`,
      [period.year_label, period.date_from, period.date_till]
    )
  }

  const { rows } = await query(`SELECT id,date_till FROM financial_periods`)
  for (const period of rows) {
    const label = financialPeriodLabel(period.date_till)
    if (!label) throw new Error(`Financial period ${period.id} has an invalid closing date.`)
    await query(
      `UPDATE financial_periods SET year_label=$1 WHERE id=$2 AND year_label IS DISTINCT FROM $1`,
      [label, period.id]
    )
  }
}
