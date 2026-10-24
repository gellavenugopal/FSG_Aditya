// What the Deferred Tax screen and the Exception Report share: the figures drawn from the statements and the depreciation schedules.
import { consolidatedDepFromNoteDetails } from './depStore'
import { num } from './taxComputation'
import { withNet } from './depCompNet'

// Assets on which neither the books nor the Income Tax Act charge depreciation - freehold land and capital work-in-progress / assets under
// development - carry no timing difference, and the Income Tax blocks have no line for them. Left in the books' WDV they made the
// cumulative difference (B) - (A) larger by exactly their value.
export const NON_DEPRECIABLE_RX = /^\s*(freehold\s+)?land\b(?!.*(lease|building))|\bfreehold\s+land\b|capital\s+work|work[\s-]*in[\s-]*progress|\bcwip\b|under\s+(development|construction)/i

// Dep (IT) block summary and Dep (Comp) schedule of the Trial Balance (the Consolidated ones for an Auditee with branches)
export async function loadDepSources(entity, activeTB) {
  const out = { itDep: 0, itWdv: 0, bookWdv: 0, bookDepSchedule: 0, bookWdvExcluded: 0 }
  try {
    if (!activeTB?.id) return out
    let it = null, comp = null
    if (activeTB.id === '__consolidated__') {
      const nd = await window.api?.listEntityNoteDetails?.(entity.id)
      const c = consolidatedDepFromNoteDetails(nd)
      it = c.depITData; comp = c.depCompData
    } else {
      it = await window.api?.depITGet?.(activeTB.id)
      comp = await window.api?.depCompGet?.(activeTB.id)
    }
    if (Array.isArray(it?.blockSummary)) {
      out.itDep = it.blockSummary.reduce((s, b) => s + num(b.depreciation), 0)
      out.itWdv = it.blockSummary.reduce((s, b) => s + num(b.closingWDV), 0)
    }
    if (comp) {
      const t = comp.totals
      if (Array.isArray(comp.categoryRows) && comp.categoryRows.length) {
        // re-derived from the category rows (closing figures are formulas) rather than a saved total that may pre-date an edit
        for (const r0 of comp.categoryRows) {
          const r = withNet(r0)
          if (NON_DEPRECIABLE_RX.test(String(r.category || ''))) out.bookWdvExcluded += num(r.netBlockClose)
          else out.bookWdv += num(r.netBlockClose)
          out.bookDepSchedule += num(r.depForYear)
        }
      } else {
        out.bookWdv = t && t.netBlockClose !== undefined ? num(t.netBlockClose) : 0
        out.bookDepSchedule = t && t.depForYear !== undefined ? num(t.depForYear) : 0
      }
    }
  } catch { /* nothing drawn: the figures are typed */ }
  return out
}

// Deferred tax assets / liabilities as the Balance Sheet carries them: [closing, previous year's closing]
export function bsDeferredTax(data) {
  const r = { dtaCY: 0, dtaPY: 0, dtlCY: 0, dtlPY: 0 }
  if (!data) return r
  const scan = (sections) => {
    for (const sec of (sections || [])) {
      for (const line of (sec.lines || [])) {
        const hay = `${line.level2 || ''} ${line.level3 || ''} ${sec.level1 || ''}`
        if (/deferred tax liabilit/i.test(hay)) { r.dtlCY += num(line.total); r.dtlPY += num(line.prevTotal) }
        else if (/deferred tax asset/i.test(hay)) { r.dtaCY += num(line.total); r.dtaPY += num(line.prevTotal) }
      }
    }
  }
  scan(data.elSections); scan(data.assetSections)
  return r
}

// the figures the screen draws: fig = extractITRFigures(data).fig, src = loadDepSources(), bs = bsDeferredTax(data)
export function buildDeferredInput(group, fig, src, bs) {
  return {
    group,
    bookDep: fig ? num(fig.depreciation) : 0,          // as charged in the Profit & Loss account
    itDep: num(src && src.itDep),
    bookWdv: num(src && src.bookWdv),
    itWdv: num(src && src.itWdv),
    openDTA: num(bs && bs.dtaPY),
    openDTL: num(bs && bs.dtlPY),
    plDeferredTax: fig ? num(fig.taxDeferred) : 0,
    bsDTA: num(bs && bs.dtaCY),
    bsDTL: num(bs && bs.dtlCY),
  }
}
