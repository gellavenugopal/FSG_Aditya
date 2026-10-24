// The italic working note the tool used to write above the Financial Ratios
// table ("Current Year, Previous Year and Variance % were pulled from ..." /
// "Fill in the Current Year and Previous Year figures below ...") was an
// instruction to the CA, not a disclosure, and printed in the accounts. The
// template no longer writes it (30 Sep 2026); notes saved before that still
// carry it, so it is removed wherever a saved note is read — the General Notes
// screen and the financials the PDF / Excel print from.
const INTRO_RX = /<p(?:\s[^>]*)?>(?:(?!<\/p>)[\s\S])*?(?:Current Year, Previous Year and Variance % were pulled|Fill in the Current Year and Previous Year figures below)[\s\S]*?<\/p>/g

export function stripRatioIntro(html) {
  return typeof html === 'string' ? html.replace(INTRO_RX, '') : html
}

/** The same General Notes object with the intro removed from every point (same object when there is none). */
export function withoutRatioIntro(generalNotes) {
  if (!generalNotes || !Array.isArray(generalNotes.points)) return generalNotes
  let changed = false
  const points = generalNotes.points.map(pt => {
    const html = stripRatioIntro(pt?.contentHtml)
    if (html === pt?.contentHtml) return pt
    changed = true
    return { ...pt, contentHtml: html }
  })
  return changed ? { ...generalNotes, points } : generalNotes
}
