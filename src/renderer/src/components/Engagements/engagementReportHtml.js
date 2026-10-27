import { formatPeriodDate } from '../../utils/financialPeriodDisplay'

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function reportParagraph(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>')
}

export function makeAuditReportPage(fields, entity, engagement, branding = null, style = null) {
  const reportStyle = style?.settings || style || {}
  const section = (title, content) => content?.trim()
    ? `<section style="margin:5mm 0"><h2 style="font-size:11pt;margin:0 0 2mm">${escapeHtml(title)}</h2><div style="font-size:10.5pt;line-height:1.45;white-space:pre-wrap">${reportParagraph(content)}</div></section>`
    : ''
  const reportDate = formatPeriodDate(fields.reportDate)
  const address = fields.firmAddress.trim()
    ? `<div style="margin-top:2mm;white-space:pre-wrap">${reportParagraph(fields.firmAddress)}</div>`
    : ''
  const logo = branding?.logoBase64 && ['image/png', 'image/jpeg', 'image/svg+xml'].includes(branding.logoMimeType)
    ? `<img alt="" src="data:${branding.logoMimeType};base64,${branding.logoBase64}" style="display:block;width:${Number(reportStyle.logoWidthMm) || 45}mm;max-width:90mm;max-height:24mm;object-fit:contain;margin:${reportStyle.logoPlacement === 'top-left' ? '0 auto 3mm 0' : reportStyle.logoPlacement === 'top-right' ? '0 0 3mm auto' : '0 auto 3mm'}">`
    : ''
  const styleFont = escapeHtml(reportStyle.fontFamily || 'Tahoma')
  return `
    <div class="print-page" style="page-break-after:always;min-height:262mm;padding:0 2mm;font-family:${styleFont},Arial,sans-serif">
      <header style="text-align:center;border-bottom:1pt solid #111;padding-bottom:4mm;margin-bottom:7mm">
        ${logo}
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

export function prependAuditReport(html, auditPage, style = null) {
  const bodyStart = html.search(/<body\b[^>]*>/i)
  if (bodyStart < 0) throw new Error('The India financial statement renderer returned an invalid HTML document.')
  const bodyTagEnd = html.indexOf('>', bodyStart)
  if (bodyTagEnd < 0) throw new Error('The India financial statement renderer returned an incomplete HTML document.')
  const reportStyle = style?.settings || style || {}
  const family = escapeHtml(reportStyle.fontFamily || 'Tahoma')
  const fallback = escapeHtml(reportStyle.fontFallback || 'Arial, sans-serif')
  const bodySize = Math.max(8, Math.min(14, Number(reportStyle.bodyFontSize) || 10))
  const headingSize = Math.max(10, Math.min(24, Number(reportStyle.headingFontSize) || 14))
  const weight = Math.max(400, Math.min(900, Number(reportStyle.headingWeight) || 700))
  const margin = Math.max(8, Math.min(30, Number(reportStyle.pageMarginMm) || 15))
  const pageSize = reportStyle.pageSize === 'Letter' ? 'Letter' : 'A4'
  const orientation = reportStyle.pageOrientation === 'landscape' ? 'landscape' : 'portrait'
  const headerColor = /^#[0-9a-f]{6}$/i.test(reportStyle.tableHeaderColor || '') ? reportStyle.tableHeaderColor : '#1e40af'
  const headerText = /^#[0-9a-f]{6}$/i.test(reportStyle.tableHeaderTextColor || '') ? reportStyle.tableHeaderTextColor : '#ffffff'
  const stripe = /^#[0-9a-f]{6}$/i.test(reportStyle.tableStripeColor || '') ? reportStyle.tableStripeColor : '#f3f4f6'
  const styleTag = `<style id="firm-report-style">@page{size:${pageSize} ${orientation};margin:${margin}mm}body{font-family:"${family}",${fallback}!important;font-size:${bodySize}pt!important}h1,h2,h3{font-size:${headingSize}pt!important;font-weight:${weight}!important}thead th,table thead td{background:${headerColor}!important;color:${headerText}!important}tbody tr:nth-child(even){background:${stripe}!important}</style>`
  const styled = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${styleTag}</head>`) : `${styleTag}${html}`
  const styledBodyStart = styled.search(/<body\b[^>]*>/i)
  const styledBodyEnd = styled.indexOf('>', styledBodyStart)
  const header = reportStyle.headerText
    ? `<div style="position:fixed;top:-${Math.max(4, margin - 5)}mm;left:0;right:0;text-align:center;font:8pt &quot;${family}&quot;,${fallback}">${escapeHtml(reportStyle.headerText)}</div>` : ''
  const footer = reportStyle.footerText
    ? `<div style="position:fixed;bottom:-${Math.max(4, margin - 5)}mm;left:0;right:0;text-align:center;font:8pt &quot;${family}&quot;,${fallback}">${escapeHtml(reportStyle.footerText)}</div>` : ''
  return `${styled.slice(0, styledBodyEnd + 1)}${header}${footer}${auditPage}${styled.slice(styledBodyEnd + 1)}`
}
