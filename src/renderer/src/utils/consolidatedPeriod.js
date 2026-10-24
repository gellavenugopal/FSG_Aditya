// The Consolidated (all branches) statements have no Trial Balance of their
// own, so they take their heading date from the branches' Trial Balances —
// "as at 31-03-2026" when every branch Trial Balance is for the same year.
// With no year, or several different years, there is no single honest date and
// the heading stays "Consolidated" (it used to be "Consolidated" always, which
// printed "Balance Sheet as at Consolidated").
//
// An Auditee carries Trial Balances of several years (current and previous); only those of the Financial Year on screen
// (entityPeriodId) give the date, otherwise a Proprietorship / Partnership with last year's Trial Balances printed
// "as at Consolidated" (0.1.121).
export function consolidatedPeriodOf(branchTBs, entityPeriodId = null) {
  let list = branchTBs || []
  if (entityPeriodId != null) {
    const ofYear = list.filter(t => t && t.entity_period_id === entityPeriodId)
    if (ofYear.length) list = ofYear
  }
  const periods = [...new Set(list.map(t => t && t.period).filter(Boolean))]
  return periods.length === 1 ? periods[0] : 'Consolidated'
}
