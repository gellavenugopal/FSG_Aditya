const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatPeriodDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''))
  if (!match) return value || ''

  const [, year, month, day] = match
  const monthIndex = Number(month) - 1
  if (monthIndex < 0 || monthIndex >= MONTHS.length) return value

  return `${day}-${MONTHS[monthIndex]}-${year.slice(-2)}`
}

export function formatPeriodRange(dateFrom, dateTill, separator = ' to ') {
  return `${formatPeriodDate(dateFrom)}${separator}${formatPeriodDate(dateTill)}`
}

export function formatPeriodMasterRange(dateFrom, dateTill) {
  const formatDate = value => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''))
    if (!match) return value || ''
    const [, year, month, day] = match
    const monthIndex = Number(month) - 1
    if (monthIndex < 0 || monthIndex >= MONTHS.length) return value
    return `${day}-${MONTHS[monthIndex]}-${year}`
  }
  return `${formatDate(dateFrom)} to ${formatDate(dateTill)}`
}

export function formatPeriodMasterOption(label, dateFrom, dateTill) {
  return `${label} · ${formatPeriodMasterRange(dateFrom, dateTill)}`
}

export function financialPeriodText(trialBalance) {
  const dateOnly = value => value instanceof Date
    ? value.toISOString().slice(0, 10)
    : /^\d{4}-\d{2}-\d{2}/.exec(String(value || ''))?.[0] || ''
  const dateFrom = dateOnly(trialBalance?.period_date_from)
  const dateTill = dateOnly(trialBalance?.period_date_till)
  return dateFrom && dateTill ? `${dateFrom} To ${dateTill}` : String(trialBalance?.period || '')
}

export function formatPeriodText(value, separator = ' To ') {
  const text = String(value || '').trim()
  const isoMatch = /^(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})$/i.exec(text)
  if (isoMatch) return formatPeriodRange(isoMatch[1], isoMatch[2], separator)

  const dmyMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})\s+to\s+(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/i.exec(text)
  if (!dmyMatch) return value || ''

  const [, fromDay, fromMonth, fromYear, tillDay, tillMonth, tillYear] = dmyMatch
  const from = `${fromYear}-${fromMonth.padStart(2, '0')}-${fromDay.padStart(2, '0')}`
  const till = `${tillYear}-${tillMonth.padStart(2, '0')}-${tillDay.padStart(2, '0')}`
  return formatPeriodRange(from, till, separator)
}
