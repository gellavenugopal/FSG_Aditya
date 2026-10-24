// ── How a signatory is presented on signed statements ───────────────────────
// Shared by the PDF (buildHTML) and Excel (buildExcel) exporters so the two can
// never disagree.
//
// The statutory identifier printed beneath a signatory's name depends entirely
// on the constitution:
//
//   Company (3)        DIN — directors only.
//   LLP (2)            DIN or LLPIN, and mandatory below the signatory.
//   everything else    nothing at all.
//
// A proprietor or partner has no DIN. The Masters form captures their number in
// the same column, so a PAN entered there was being printed under a "DIN:"
// label — wrong twice over, since PAN and DIN are unrelated identifiers and a
// personal PAN does not belong on the face of signed statements at all. It is
// still stored (it is useful in Masters), just never printed for these
// constitutions.

const CONST_COMPANY = 3
const CONST_LLP = 2

export function signatoryIdLabel(constitution, signatory) {
  const c = parseInt(constitution)
  const type = (signatory?.id_type || '').trim().toUpperCase()
  if (c === CONST_COMPANY) return (type && type !== 'DIN') ? null : 'DIN'
  if (c === CONST_LLP) return type === 'LLPIN' ? 'LLPIN' : 'DIN'
  return null
}

// "DIN: 01234567" / "LLPIN: AAA-1234" / '' when nothing should be printed.
export function signatoryIdText(constitution, signatory) {
  const label = signatoryIdLabel(constitution, signatory)
  const value = (signatory?.din || '').trim()
  return (label && value) ? `${label}: ${value}` : ''
}

// An LLP must carry a DIN/LLPIN beneath each signatory — surfaced in the UI so
// it is caught before the statements are generated, not after.
export function signatoryIdMissing(constitution, signatory) {
  return parseInt(constitution) === CONST_LLP && !(signatory?.din || '').trim()
}

// Only a company signs through a Board. Anyone else signs for the firm itself.
export function signedOnBehalfOf(constitution) {
  const c = parseInt(constitution)
  if (c === CONST_COMPANY) return 'For and on behalf of the Board of Directors of'
  if (c === CONST_LLP) return 'For and on behalf of'
  return 'For'
}
