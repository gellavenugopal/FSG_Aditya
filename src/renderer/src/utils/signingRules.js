// Who signs a Company's statements, by the denomination they are printed in.
//
// A Company's financial statements in ABSOLUTE figures (As Is / No Decimals) are signed by the directors only: the auditor's name
// does not appear in the Balance Sheet, Profit & Loss, Cash Flow Statement or the Notes (General Notes). In Hundreds / Lakhs / Crores
// the auditor's name comes as before. Other constitutions are not affected.
export const ABSOLUTE_DENOMINATIONS = ['as_is', 'no_dec']

export function isCompany(entity) {
  if (parseInt(entity && entity.constitution, 10) === 3) return true
  return /company/i.test(String((entity && entity.constitution_display) || ''))
}

export function auditorForDenomination(entity, auditor, denomination) {
  if (!auditor) return auditor
  if (isCompany(entity) && ABSOLUTE_DENOMINATIONS.includes(denomination || 'as_is')) return null
  return auditor
}
