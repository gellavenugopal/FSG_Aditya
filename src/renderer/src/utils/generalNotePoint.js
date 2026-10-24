// ── What a General Notes point prints ───────────────────────────────────────
// A point is its rich-text body (contentHtml) plus, for Financial Ratios, the
// CA's comment paragraphs written below the ratio table (point.comments —
// [{ id, html }], added with "+ Add Comment Paragraph", 30 Sep 2026). They are
// kept apart from the body so that bringing the ratio table up to date
// (utils/ratioTable.js) can never touch them. One definition for the PDF and
// the Excel export. An empty paragraph prints nothing.
const isBlank = (html) => {
  const h = String(html || '')
  if (/<table/i.test(h)) return false
  return !h.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim()
}

export function pointComments(point) {
  return (point?.comments || []).filter(c => !isBlank(c?.html))
}

export function pointBodyHtml(point) {
  return (point?.contentHtml || '') + pointComments(point).map(c => c.html).join('')
}
