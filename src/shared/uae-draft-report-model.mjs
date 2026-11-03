// One deterministic model of a draft separate-FS UAE report. The on-screen draft, PDF, Word and Excel
// are all rendered from this model, so they cannot disagree. It is computed from the saved final TB and
// the pack mapping state only; reference statement figures appear only as separate validation evidence.
import { buildStatementPreview, compareWithReference, REFERENCE_2024 } from './uae-pack-statement-preview.mjs'

export const DRAFT_MODEL_SCHEMA = 'fsg-uae-separate-fs-draft/1'
const INTERIOR_REFERENCE = 'INTERIOR-LLC-2024'

export function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

const dateText = value => (value ? String(value).slice(0, 10) : '')

function accountOf(row) {
  const reference = row.references?.[0]
  const basis = row.basis || (row.status === 'confirmed' ? 'confirmed' : row.suggestedLineKey ? 'suggested' : 'unresolved')
  let source = 'No classification'
  if (basis === 'confirmed') source = 'Saved mapping (confirmed)'
  else if (basis === 'suggested') source = `Suggested from ${reference ? `${reference.sourceLabel} (${reference.sourceYear})` : 'reference'} - not confirmed`
  else if (row.issue) source = row.issue
  return { id: row.id, code: row.code || '', name: row.name, balance: row.balance, basis, source }
}

const PENDING = [
  { item: 'Comparative figures', status: 'Pending', detail: 'No prior-year comparative Trial Balance is verified or selected; no comparative figures are shown.' },
  { item: 'Statement of cash flows', status: 'Pending', detail: 'Not implemented for this pack.' },
  { item: 'Statement of changes in equity', status: 'Pending', detail: 'Movement schedules are not available; only closing equity is shown on the Balance Sheet.' },
  { item: 'Notes to the financial statements and supporting schedules', status: 'Pending', detail: 'Not generated; the line-level ledger detail below is the only supporting detail.' },
  { item: 'Accounting policies', status: 'Pending', detail: 'Not generated for this pack.' },
  { item: 'Auditor\'s report', status: 'Pending', detail: 'Not generated; this draft is not an audited or issued report.' },
]

export const PENDING_COMPONENTS = PENDING

function statementRows(preview, statement) {
  const rows = []
  for (const [title, lines] of preview.sections[statement].entries()) {
    rows.push({ kind: 'section', label: title })
    for (const line of lines) {
      if (!line.members.length) continue
      rows.push({
        kind: 'line', key: line.key, label: line.label, amount: line.amount,
        accounts: line.members.map(accountOf),
      })
    }
    if (statement === 'SFP' && title === 'Equity') {
      rows.push({ kind: 'derived', label: 'Profit / (loss) for the year (provisional, derived from the P&L lines; not a ledger or a mapping)', amount: preview.totals.profit })
    }
    if (statement === 'SFP' && title === 'Liabilities' && preview.unclassified.credit.count) {
      rows.push({
        kind: 'placeholder', side: 'credit', label: 'Unclassified credit balances', badge: 'Action required',
        count: preview.unclassified.credit.count, amount: preview.unclassified.credit.amount,
        accounts: preview.unclassified.credit.rows.map(accountOf),
      })
    }
    if (statement === 'SFP') {
      const totals = preview.totals
      const sectionTotal = title === 'Non-current assets' ? totals.totalNonCurrent : title === 'Current assets' ? totals.totalCurrent
        : title === 'Equity' ? totals.totalEquity : totals.totalLiabilities
      if (title === 'Current assets' && preview.unclassified.debit.count) {
        rows.push({
          kind: 'placeholder', side: 'debit', label: 'Unclassified debit balances', badge: 'Action required',
          count: preview.unclassified.debit.count, amount: preview.unclassified.debit.amount,
          accounts: preview.unclassified.debit.rows.map(accountOf),
        })
      }
      rows.push({ kind: 'total', label: `Total ${title.toLowerCase()} (provisional)`, amount: sectionTotal })
    }
  }
  return rows
}

export function buildDraftReportModel({ review, engagement }) {
  const preview = buildStatementPreview(review)
  const { totals, coverage } = preview
  const sfp = statementRows(preview, 'SFP')
  sfp.push(
    { kind: 'total', label: 'Total assets (provisional)', amount: totals.totalAssets, strong: true },
    { kind: 'total', label: 'Total equity and liabilities (provisional)', amount: totals.totalEquityAndLiabilities, strong: true },
    { kind: 'difference', label: 'Balance Sheet difference (assets less equity and liabilities)', amount: totals.difference },
  )
  const pl = statementRows(preview, 'PL')
  pl.push({ kind: 'total', label: 'Profit / (loss) for the year (provisional, potentially incomplete)', amount: totals.profit, strong: true })
  const isInterior = engagement.reference === INTERIOR_REFERENCE
  const comparison = isInterior
    ? compareWithReference(preview).map(item => ({
      statement: item.statement, label: item.label, calculated: item.calculated, reference: item.reference,
      difference: item.difference, populated: item.populated, note: item.note || '',
    }))
    : []
  const warnings = [
    'PROVISIONAL DRAFT - not reviewed, not confirmed, not audited and not for issue.',
    `Calculated from final Trial Balance version ${review.finalVersion} using ${coverage.confirmedCount} confirmed and ${coverage.suggestedCount} suggested (unconfirmed) ledger mappings.`,
    coverage.unresolvedCount
      ? `ACTION REQUIRED: ${coverage.unresolvedCount} accounts are not classified. They appear as red presentation placeholders (unclassified debit balances under assets, unclassified credit balances under liabilities) so that every ledger is counted once. No suspense journal, ledger change or assumed classification has been made, and profit may be incomplete.`
      : 'Every non-zero ledger is classified.',
    'Finalisation is blocked while classifications are unresolved or required validations are outstanding.',
  ]
  return {
    schema: DRAFT_MODEL_SCHEMA,
    title: 'Draft financial statements (provisional)',
    identity: {
      engagementId: engagement.id,
      reference: engagement.reference || '',
      name: engagement.name || '',
      client: engagement.clientName || '',
      periodStart: dateText(engagement.periodStart),
      periodEnd: dateText(engagement.periodEnd),
      currency: 'AED',
      currencyNote: 'AED (assumed - unconfirmed)',
    },
    source: {
      finalTbVersion: review.finalVersion,
      trialBalanceId: review.trialBalanceId,
      packId: review.pack.id,
      packVersion: review.pack.version,
      packStatus: review.pack.status,
    },
    warnings,
    unconfirmedMetadata: review.pack.metadata.filter(item => !item.confirmed).map(item => ({ label: item.label, value: item.value })),
    sfp,
    pl,
    treatment: preview.closing,
    checks: preview.checks.map(check => ({ kind: check.kind, label: check.label, passed: check.passed, detail: check.detail })),
    arithmeticReconciled: preview.arithmeticReconciled,
    classificationComplete: preview.classification.complete,
    coverage: {
      accounts: coverage.accounts, confirmed: coverage.confirmedCount, suggested: coverage.suggestedCount,
      unresolvedCount: coverage.unresolvedCount, unresolvedNet: coverage.unresolvedNet,
      unresolvedAbsolute: coverage.unresolvedAbsolute, totalAbsolute: coverage.totalAbsolute,
      unresolvedAbsolutePercent: coverage.unresolvedAbsolutePercent,
    },
    totals: { ...totals },
    unresolved: preview.exceptions.map(accountOf),
    validationEvidence: {
      source: isInterior ? REFERENCE_2024.source : '',
      note: 'Reference comparisons are validation evidence only. Calculated figures are never adjusted to them.',
      items: comparison,
    },
    pending: PENDING,
  }
}

// Stable serialisation (sorted keys) so a revision hash does not depend on property order.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))

function statementHtml(title, rows) {
  const body = rows.map(row => {
    if (row.kind === 'section') return `<tr class="sec"><td colspan="2">${esc(row.label)}</td></tr>`
    const cls = row.kind === 'placeholder' ? 'ph' : row.kind === 'total' ? (row.strong ? 'tot strong' : 'tot') : row.kind === 'difference' ? 'diff' : row.kind === 'derived' ? 'der' : ''
    const label = row.kind === 'placeholder'
      ? `${esc(row.label)} <span class="badge">${esc(row.badge)}</span> <span class="small">${row.count} account${row.count === 1 ? '' : 's'} - presentation placeholder only</span>`
      : esc(row.label) + (row.accounts ? ` <span class="small">(${row.accounts.length} ledger${row.accounts.length === 1 ? '' : 's'})</span>` : '')
    return `<tr class="${cls}"><td>${label}</td><td class="n">${formatAmount(row.amount)}</td></tr>`
  }).join('')
  return `<h2>${esc(title)}</h2><table class="st">${body}</table>`
}

function detailHtml(title, rows) {
  const blocks = rows.filter(row => row.accounts && row.accounts.length).map(row => `
    <h4 class="${row.kind === 'placeholder' ? 'red' : ''}">${esc(row.label)} - ${formatAmount(row.amount)}</h4>
    <table class="dt"><thead><tr><th>Code</th><th>Ledger</th><th class="n">Balance (Cr +, Dr -)</th><th>Mapping status / source</th></tr></thead><tbody>
    ${row.accounts.map(account => `<tr class="${account.basis === 'unresolved' ? 'ph' : ''}"><td>${esc(account.code || '(no code)')}</td><td>${esc(account.name)}</td><td class="n">${formatAmount(account.balance)}</td><td>${esc(account.source)}</td></tr>`).join('')}
    </tbody></table>`).join('')
  return `<h2>${esc(title)}</h2>${blocks}`
}

export function buildDraftReportHtml(model) {
  const { identity, source } = model
  const identityRows = [
    ['Engagement', `${identity.name}${identity.reference ? ` (${identity.reference})` : ''}`],
    ['Reporting period', identity.periodStart ? `${identity.periodStart} to ${identity.periodEnd}` : `year ended ${identity.periodEnd}`],
    ['Currency', identity.currencyNote],
    ['Final Trial Balance', `version ${source.finalTbVersion} (TB #${source.trialBalanceId})`],
    ['Reporting pack', `${source.packId} v${source.packVersion} (${source.packStatus})`],
    ['Comparatives', 'None - pending verification'],
  ].map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')
  const checks = model.checks.map(check => `<li class="${check.passed ? 'ok' : 'red'}">${check.kind === 'classification' ? (check.passed ? 'Classification complete' : 'Action required') : (check.passed ? 'Arithmetic passed' : 'Arithmetic FAILED')} - ${esc(check.label)} (${esc(check.detail)})</li>`).join('')
  const evidence = model.validationEvidence.items.length
    ? `<h2>Reference comparison - validation evidence only</h2><p class="small">${esc(model.validationEvidence.source)}. ${esc(model.validationEvidence.note)} Differences are calculated minus reference.</p>
    <table class="dt"><thead><tr><th>Caption</th><th class="n">Calculated</th><th class="n">Reference</th><th class="n">Difference</th><th>Explanation</th></tr></thead><tbody>
    ${model.validationEvidence.items.map(item => `<tr><td>${esc(item.label)}</td><td class="n">${item.populated ? formatAmount(item.calculated) : 'no mapped ledgers'}</td><td class="n">${formatAmount(item.reference)}</td><td class="n">${Math.abs(item.difference) < 0.005 ? 'agrees' : formatAmount(item.difference)}</td><td>${Math.abs(item.difference) < 0.005 ? '' : esc(item.note || 'Not explained yet.')}</td></tr>`).join('')}</tbody></table>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(model.title)}</title><style>
  @page { size: A4; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #111; }
  h1 { font-size: 16px; margin: 0 0 4px; } h2 { font-size: 13px; margin: 16px 0 6px; page-break-after: avoid; } h4 { font-size: 10px; margin: 8px 0 3px; }
  .banner { border: 2px solid #b45309; background: #fffbeb; padding: 6px 8px; margin: 6px 0; }
  .red, .ph { color: #991b1b; } .ph td { background: #fef2f2; font-weight: bold; }
  .badge { background: #991b1b; color: #fff; padding: 1px 5px; border-radius: 3px; font-size: 9px; }
  .small { font-size: 9px; font-weight: normal; } .ok { color: #166534; }
  table { width: 100%; border-collapse: collapse; } .id th { text-align: left; width: 22%; padding: 2px 4px; } .id td { padding: 2px 4px; }
  .st td { padding: 3px 4px; border-top: 1px solid #ddd; } .st .sec td { font-weight: bold; background: #f3f4f6; text-transform: uppercase; font-size: 9px; }
  .st .tot td { border-top: 2px solid #111; font-weight: bold; } .st .strong td { background: #eef2ff; } .st .diff td { font-weight: bold; } .st .der td { background: #eef2ff; }
  .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .dt th { text-align: left; font-size: 9px; border-bottom: 1px solid #999; padding: 2px 4px; } .dt th.n { text-align: right; } .dt td { padding: 2px 4px; border-top: 1px solid #eee; vertical-align: top; }
  .brk { page-break-before: always; } tr { page-break-inside: avoid; }
  </style></head><body>
  <h1>${esc(model.title)}</h1>
  <div class="banner">${model.warnings.map(w => `<div>${esc(w)}</div>`).join('')}</div>
  <table class="id">${identityRows}</table>
  <ul class="small">${model.unconfirmedMetadata.map(item => `<li><b>Unconfirmed - ${esc(item.label)}:</b> ${esc(item.value)}</li>`).join('')}</ul>
  <div class="brk"></div>
  ${statementHtml('Statement of financial position - provisional, potentially incomplete (AED)', model.sfp)}
  <p class="small">${esc(model.treatment.note)} Arithmetic: ${model.arithmeticReconciled ? 'every ledger counted once and the source TB net is zero' : 'NOT reconciled - investigate'}. Classification: ${model.coverage.unresolvedCount} unresolved (net ${formatAmount(model.coverage.unresolvedNet)}; ${formatAmount(model.coverage.unresolvedAbsolute)} of ${formatAmount(model.coverage.totalAbsolute)} by absolute value, ${model.coverage.unresolvedAbsolutePercent}%).</p>
  <div class="brk"></div>
  ${statementHtml('Statement of profit or loss - provisional, potentially incomplete (AED)', model.pl)}
  <h2>Calculation checks</h2><ul>${checks}</ul>
  <div class="brk"></div>
  ${detailHtml('Supporting detail - Statement of financial position ledgers', model.sfp)}
  <div class="brk"></div>
  ${detailHtml('Supporting detail - Profit or loss ledgers', model.pl)}
  <h2 class="red">Action required - ${model.coverage.unresolvedCount} accounts awaiting classification</h2>
  <table class="dt"><thead><tr><th>Code</th><th>Ledger</th><th class="n">Balance (Cr +, Dr -)</th><th>Reason</th></tr></thead><tbody>
  ${model.unresolved.map(account => `<tr class="ph"><td>${esc(account.code || '(no code)')}</td><td>${esc(account.name)}</td><td class="n">${formatAmount(account.balance)}</td><td>${esc(account.source)}</td></tr>`).join('')}</tbody></table>
  ${evidence}
  <h2>Pending - not included in this draft</h2>
  <table class="dt"><tbody>${model.pending.map(item => `<tr><td><b>${esc(item.item)}</b></td><td>${esc(item.status)}</td><td>${esc(item.detail)}</td></tr>`).join('')}</tbody></table>
  </body></html>`
}
