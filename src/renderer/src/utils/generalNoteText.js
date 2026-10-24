// Standard wording of General Notes points that the tool has changed since a note may already have been saved.
// A saved note keeps its own text (the CA may have edited it); only a point still holding the tool's OLD standard wording, word for word,
// is brought up to the current wording - on screen when the tab opens, and in the PDF / Excel.
// The Company's General Notes is headed "Significant Accounting Policies & Additional Regulatory Information" (0.1.111); a saved note still
// headed with the old plain title is brought up to it.
export const GN_TITLE_OLD = 'Significant Accounting Policies'
export const GN_TITLE_COMPANY = 'Significant Accounting Policies & Additional Regulatory Information'
export const TITLE_DEEDS_HEADER = 'Title Deeds of Immovable Property'
export const TITLE_DEEDS_OLD = 'The Company does not hold any title deeds of immovable property in its own name.'
export const TITLE_DEEDS_NEW = 'The Company does not hold any title deeds of immovable property which is not in its own name.'

const plain = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

export function withCurrentTitleDeedsText(note) {
  if (!note || !Array.isArray(note.points)) return note
  if (String(note.title || '').trim() === GN_TITLE_OLD) note = { ...note, title: GN_TITLE_COMPANY }
  let changed = false
  const points = note.points.map(pt => {
    if (((pt && pt.header) || '').trim() !== TITLE_DEEDS_HEADER) return pt
    if (plain(pt.contentHtml) !== TITLE_DEEDS_OLD) return pt
    changed = true
    return { ...pt, contentHtml: `<p>${TITLE_DEEDS_NEW}</p>` }
  })
  return changed ? { ...note, points } : note
}
