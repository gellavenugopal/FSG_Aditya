// ── Share Capital (Company): disclosures 1(e) to 1(l) ───────────────────────
// Replaces the single free-text "(e) Rights, Preferences and Restrictions"
// with the eight standard disclosures the CA's working paper uses (Word file,
// 30 Sep 2026): Class of Shares; Rights, Preferences and Restrictions; Shares
// held by Holding / Ultimate Holding / Subsidiaries or Associates; ESOP or
// other Commitments; Bonus, Buy Back and Issue of shares other than Cash;
// Convertible Securities; Unpaid Calls; Forfeiture of Shares.
//
// One definition for the Fill Details form, the PDF, the Excel export and the
// Fill Details workbook. Each section's text is the CA's own once edited
// (details.disclosures[key], a string); until then it is the default below.
// A section whose text is cleared to blank is left out of the output.
//
// Text is plain: one paragraph per line, and a line starting with "•" (or
// "-") is a bullet point (see disclosureParagraphs).

// What the old single "(e) Rights" box started with — an untouched one is
// not carried into the new sections.
export const OLD_RIGHTS_DEFAULT = 'The Company has one class of equity shares having a par value of ₹10 per share. Each holder is eligible for one vote per share held.'

const fmtFace = (fv) => {
  const n = parseFloat(fv)
  if (!n) return '10'
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

export const SC_DISCLOSURES = [
  { key: 'e', heading: 'Class of Shares',
    text: (fv) => `The Company has only one class of equity shares with a par value of ₹${fv} per share and each holder of equity shares is entitled to one vote per share on all resolutions placed before the shareholders.` },
  { key: 'f', heading: 'Rights, Preferences and Restrictions',
    text: () => 'There are no restrictions attached to the equity shares regarding the distribution of dividends or the repayment of capital, other than those generally applicable under the Companies Act, 2013.' },
  { key: 'g', heading: 'Shares held by Holding / Ultimate Holding / Subsidiaries or Associates',
    text: () => 'There are no Shares held by holding / ultimate holding company and/or their subsidiaries / associates during the current or previous financial year.' },
  { key: 'h', heading: 'ESOP or other Commitments',
    text: () => 'There are no shares reserved for issue under options and contracts or commitments for the sale of shares or disinvestment as at the end of the current reporting period and the previous financial year.' },
  { key: 'i', heading: 'Bonus, Buy Back and Issue of shares other than Cash',
    text: () => [
      'During the period of five years immediately preceding the balance sheet date, the Company has:',
      '• not allotted any class of shares as fully paid-up pursuant to any contract without payment being received in cash;',
      '• not allotted any class of shares as fully paid-up by way of bonus shares; and',
      '• not bought back any class of shares.',
    ].join('\n') },
  { key: 'j', heading: 'Convertible Securities',
    text: () => 'The Company has not issued any securities convertible into equity shares or preference shares during the current reporting period or the previous financial year. Accordingly, there are no outstanding convertible securities as at the balance sheet date.' },
  { key: 'k', heading: 'Unpaid Calls',
    text: () => 'There are no calls unpaid on any shares issued by the Company as at the end of the current reporting period and the previous financial year, including any calls unpaid by the Directors and Officers of the Company.' },
  { key: 'l', heading: 'Forfeiture of Shares',
    text: () => 'No shares have been forfeited by the Company during the current reporting period or the previous financial year.' },
]

/** The default text of one section, for this note's first share class. */
export function defaultDisclosureText(key, details) {
  const d = SC_DISCLOSURES.find(s => s.key === key)
  return d ? d.text(fmtFace(details?.classes?.[0]?.faceValue)) : ''
}

/** Each section's current text: the CA's own, else the default. A customised
 *  old "(e) Rights" box (saved before these sections existed) becomes (e). */
export function disclosureTexts(details) {
  const saved = details?.disclosures || {}
  const oldRights = String(details?.rights || '').trim()
  const out = {}
  for (const s of SC_DISCLOSURES) {
    if (typeof saved[s.key] === 'string') out[s.key] = saved[s.key]
    else if (s.key === 'e' && !details?.disclosures && oldRights && oldRights !== OLD_RIGHTS_DEFAULT) out[s.key] = oldRights
    else out[s.key] = defaultDisclosureText(s.key, details)
  }
  return out
}

/** The sections to print, in order: [{ key, heading, text }] — blank ones left out. */
export function printedDisclosures(details) {
  const texts = disclosureTexts(details)
  return SC_DISCLOSURES
    .map(s => ({ key: s.key, heading: s.heading, text: String(texts[s.key] || '').trim() }))
    .filter(s => s.text)
}

/** A section's text as paragraphs: [{ text, bullet }] — "•" / "-" lines are bullets. */
export function disclosureParagraphs(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^[•\-–]\s*(.*)$/)
    return m ? { text: m[1], bullet: true } : { text: l, bullet: false }
  })
}
