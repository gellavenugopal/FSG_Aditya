// PAN of an auditee: 10 characters - five letters, four digits, one letter (e.g. ABCDE1234F). Optional.
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
// What a person types, tidied: capitals, no spaces, at most 10 characters
export const normalizePan = (v) => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
// '' (not given) is fine; anything else must be a complete PAN
export const isValidPan = (v) => { const p = String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, ''); return p === '' || PAN_PATTERN.test(p) }
