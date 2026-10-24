import React, { useState } from 'react'

// ── Schedule III Division A (Company) format reference PDFs ─────────────────
// The source PDF has been physically split into per-section PDFs under
// src/renderer/public/schedule3/ (served by Vite in dev, bundled in prod).
// Each note therefore opens ONLY its own portion of the Schedule III format.
const FULL_PDF_URL = './schedule3-division-a.pdf'
const SEG = (slug) => `./schedule3/${slug}.pdf`

// Statement-level sections
export const SCHEDULE3_SECTIONS = {
  FULL: { url: FULL_PDF_URL,      label: 'Schedule III — Division A (Complete)' },
  BS:   { url: SEG('bs-format'),  label: 'Part I — Balance Sheet Format' },
  PL:   { url: SEG('pl-format'),  label: 'Part II — Statement of Profit and Loss Format' },
}

// Note-title → segment PDF. First matching pattern wins.
const NOTE_SEGMENT_MAP = [
  { pattern: /share\s*capital/i,                         slug: 'share-capital',             label: 'A. Share Capital' },
  { pattern: /reserves?\s*(and|&)\s*surplus/i,           slug: 'reserves-surplus',          label: 'B. Reserves and Surplus' },
  { pattern: /long[\s-]*term\s*borrow/i,                 slug: 'long-term-borrowings',      label: 'C. Long-Term Borrowings' },
  { pattern: /other\s*long[\s-]*term\s*liab/i,           slug: 'other-lt-liabilities',      label: 'D. Other Long-term Liabilities' },
  { pattern: /long[\s-]*term\s*provision/i,              slug: 'long-term-provisions',      label: 'E. Long-term Provisions' },
  { pattern: /short[\s-]*term\s*borrow/i,                slug: 'short-term-borrowings',     label: 'F. Short-term Borrowings' },
  { pattern: /trade\s*payab/i,                           slug: 'trade-payables',            label: 'FA. Trade Payables' },
  { pattern: /other\s*current\s*liab/i,                  slug: 'other-current-liabilities', label: 'G. Other Current Liabilities' },
  { pattern: /short[\s-]*term\s*provision/i,             slug: 'short-term-provisions',     label: 'H. Short-term Provisions' },
  { pattern: /tangible\s*asset|property.*plant|fixed\s*asset/i, slug: 'tangible-assets',    label: 'I. Tangible Assets' },
  { pattern: /intangible/i,                              slug: 'intangible-assets',         label: 'J. Intangible Assets' },
  { pattern: /non[\s-]*current\s*invest/i,               slug: 'non-current-investments',   label: 'K. Non-current Investments' },
  { pattern: /long[\s-]*term\s*loans?\s*(and|&)\s*advance/i, slug: 'lt-loans-advances',     label: 'L. Long-term Loans and Advances' },
  { pattern: /other\s*non[\s-]*current\s*asset/i,        slug: 'other-non-current-assets',  label: 'M. Other Non-current Assets' },
  { pattern: /current\s*invest/i,                        slug: 'current-investments',       label: 'N. Current Investments' },
  { pattern: /inventor/i,                                slug: 'inventories',               label: 'O. Inventories' },
  { pattern: /trade\s*receivab/i,                        slug: 'trade-receivables',         label: 'P. Trade Receivables' },
  { pattern: /cash\s*(and|&)\s*cash|cash\s*equivalent|cash\s*(and|&)\s*bank/i, slug: 'cash-equivalents', label: 'Q. Cash and Cash Equivalents' },
  { pattern: /short[\s-]*term\s*loans?\s*(and|&)\s*advance/i, slug: 'st-loans-advances',    label: 'R. Short-term Loans and Advances' },
  { pattern: /other\s*current\s*asset/i,                 slug: 'other-current-assets',      label: 'S. Other Current Assets' },
  { pattern: /contingent/i,                              slug: 'contingent-liabilities',    label: 'T. Contingent Liabilities and Commitments' },
  // PL notes
  { pattern: /revenue\s*from\s*operation/i,              slug: 'revenue-operations',        label: '2. Revenue from Operations' },
  { pattern: /finance\s*cost/i,                          slug: 'finance-costs',             label: '3. Finance Costs' },
  { pattern: /other\s*income/i,                          slug: 'other-income',              label: '4. Other Income' },
  { pattern: /employee\s*benefit/i,                      slug: 'employee-benefits',         label: '5. Employee Benefits Expense' },
  { pattern: /depreciation|amortis|amortiz/i,            slug: 'depreciation-additional',   label: '5. Additional Information' },
  { pattern: /other\s*expense/i,                         slug: 'other-expenses',            label: '5. Additional Information — Expenses' },
]

// Look up the segment PDF for a note title. Returns null when no match.
export function findNoteSegment(noteTitle) {
  if (!noteTitle) return null
  const hit = NOTE_SEGMENT_MAP.find(m => m.pattern.test(noteTitle))
  return hit ? { url: SEG(hit.slug), label: hit.label } : null
}

// True when this entity should see Schedule III format references (company only)
export function isCompany(entity) {
  return parseInt(entity?.constitution) === 3
}

// ── Small icon button that opens a format reference PDF ─────────────────────
export function FormatRefButton({ entity, url, label, title = 'Format' }) {
  const [open, setOpen] = useState(false)
  if (!isCompany(entity)) return null
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`Compare with Schedule III format${label ? ` — ${label}` : ''}`}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 transition font-medium shrink-0"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
          <path d="M10.75 16.82A7.462 7.462 0 0 1 15 15.5c.71 0 1.396.098 2.046.282A.75.75 0 0 0 18 15.06v-11a.75.75 0 0 0-.546-.721A9.006 9.006 0 0 0 15 3a8.963 8.963 0 0 0-4.25 1.065V16.82ZM9.25 4.065A8.963 8.963 0 0 0 5 3c-.85 0-1.673.118-2.454.339A.75.75 0 0 0 2 4.06v11a.75.75 0 0 0 .954.721A7.506 7.506 0 0 1 5 15.5c1.579 0 3.042.487 4.25 1.32V4.065Z" />
        </svg>
        {title}
      </button>
      {open && <PDFViewerModal url={url} label={label} onClose={() => setOpen(false)} />}
    </>
  )
}

// ── PDF viewer modal ─────────────────────────────────────────────────────────
export function PDFViewerModal({ url, label, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: '85vw', height: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 bg-blue-800 text-white shrink-0">
          <div>
            <h3 className="font-bold text-sm">Schedule III — Division A Format Reference</h3>
            {label && <p className="text-xs text-blue-200">{label}</p>}
          </div>
          <button onClick={onClose}
            className="px-2.5 py-1 text-xs rounded bg-white/10 hover:bg-white/25 transition font-medium">
            Close ✕
          </button>
        </div>
        <iframe
          src={`${url}#zoom=110`}
          title="Schedule III Format Reference"
          className="flex-1 w-full border-0"
        />
      </div>
    </div>
  )
}

// Convenience wrapper for a note: renders nothing when no match or not a company
export function NoteFormatRefButton({ entity, noteTitle }) {
  const hit = findNoteSegment(noteTitle)
  if (!hit) return null
  return <FormatRefButton entity={entity} url={hit.url} label={hit.label} />
}
