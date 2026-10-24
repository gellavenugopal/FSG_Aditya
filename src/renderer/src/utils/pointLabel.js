// (a), (b), (c) ... (z), (aa), (ab) ... spreadsheet-column-style lettering,
// shared by every place that renders a General Notes point list (the live
// editor, the PDF, the Excel export, and the Notes preview) so a Company
// template with more than 26 points numbers consistently everywhere.
export const pointLabel = (idx) => {
  let n = idx
  let s = ''
  do {
    s = String.fromCharCode(97 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return `(${s})`
}
