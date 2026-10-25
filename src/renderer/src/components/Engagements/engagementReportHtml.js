import { formatPeriodDate } from '../../utils/financialPeriodDisplay'

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function reportParagraph(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>')
}

export function makeAuditReportPage(fields, entity, engagement) {
  const section = (title, content) => content?.trim()
    ? `<section style="margin:5mm 0"><h2 style="font-size:11pt;margin:0 0 2mm">${escapeHtml(title)}</h2><div style="font-size:10.5pt;line-height:1.45;white-space:pre-wrap">${reportParagraph(content)}</div></section>`
    : ''
  const reportDate = formatPeriodDate(fields.reportDate)
  const address = fields.firmAddress.trim()
    ? `<div style="margin-top:2mm;white-space:pre-wrap">${reportParagraph(fields.firmAddress)}</div>`
    : ''
  return `
    <div class="print-page" style="page-break-after:always;min-height:262mm;padding:0 2mm;font-family:Calibri,Arial,sans-serif">
      <header style="text-align:center;border-bottom:1pt solid #111;padding-bottom:4mm;margin-bottom:7mm">
        <div style="font-size:14pt;font-weight:700;text-transform:uppercase">${escapeHtml(entity.name)}</div>
        <div style="font-size:10pt;margin-top:1mm">Independent Auditor's Report</div>
        <div style="font-size:10pt;margin-top:1mm">For the year ended ${escapeHtml(formatPeriodDate(engagement.periodEnd))}</div>
      </header>
      <div style="font-size:10.5pt;font-weight:600;margin-bottom:4mm">${reportParagraph(fields.addressee)}</div>
      ${section('Opinion', fields.opinion)}
      ${section('Basis for Opinion', fields.basisForOpinion)}
      ${section('Responsibilities of Management', fields.managementResponsibilities)}
      ${section('Auditor Responsibilities', fields.auditorResponsibilities)}
      ${section('Other Matters', fields.otherMatters)}
      <footer style="margin-top:10mm;font-size:10pt;page-break-inside:avoid">
        <div>${escapeHtml(fields.reportPlace)} · ${escapeHtml(reportDate)}</div>
        <div style="margin-top:12mm;font-weight:700">${escapeHtml(fields.auditorName)}</div>
        ${fields.auditorDesignation ? `<div>${escapeHtml(fields.auditorDesignation)}</div>` : ''}
        <div>Membership No. ${escapeHtml(fields.auditorMembershipNumber)}</div>
        <div style="margin-top:4mm;font-weight:700">${escapeHtml(fields.firmName)}</div>
        ${fields.firmRegistrationNumber ? `<div>Firm Registration No. ${escapeHtml(fields.firmRegistrationNumber)}</div>` : ''}
        ${address}
      </footer>
    </div>`
}

export function prependAuditReport(html, auditPage) {
  const bodyStart = html.search(/<body\b[^>]*>/i)
  if (bodyStart < 0) throw new Error('The India financial statement renderer returned an invalid HTML document.')
  const bodyTagEnd = html.indexOf('>', bodyStart)
  if (bodyTagEnd < 0) throw new Error('The India financial statement renderer returned an incomplete HTML document.')
  return `${html.slice(0, bodyTagEnd + 1)}${auditPage}${html.slice(bodyTagEnd + 1)}`
}
