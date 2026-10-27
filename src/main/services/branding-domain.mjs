export const DEFAULT_APPEARANCE = Object.freeze({
  displayName: 'FSG Bharat',
  logoMimeType: '',
  logoBase64: '',
  primaryColor: '#1e40af',
  fontFamily: 'Tahoma',
  fontFallback: 'Arial, sans-serif',
  baseFontSize: 14,
  headingFontSize: 20,
  headingWeight: 700,
  density: 'comfortable',
})

export const DEFAULT_REPORT_STYLE = Object.freeze({
  fontFamily: 'Tahoma',
  fontFallback: 'Arial, sans-serif',
  bodyFontSize: 10,
  headingFontSize: 14,
  headingWeight: 700,
  logoPlacement: 'top-center',
  logoWidthMm: 45,
  headerText: '',
  footerText: '',
  tableHeaderColor: '#1e40af',
  tableHeaderTextColor: '#ffffff',
  tableStripeColor: '#f3f4f6',
  pageSize: 'A4',
  pageOrientation: 'portrait',
  pageMarginMm: 15,
})

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const FONT_NAME = /^[A-Za-z0-9 _-]{1,48}$/

function boundedNumber(value, name, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`)
  }
  return number
}

function color(value, name) {
  const result = String(value || '').trim()
  if (!HEX_COLOR.test(result)) throw new Error(`${name} must be a six-digit hexadecimal colour.`)
  return result.toLowerCase()
}

function font(value, name) {
  const result = String(value || '').trim()
  if (!FONT_NAME.test(result)) throw new Error(`${name} contains unsupported characters or is too long.`)
  return result
}

function fontFallback(value, name) {
  const result = String(value || '').trim()
  if (!/^[A-Za-z0-9 _,-]{1,80}$/.test(result)) throw new Error(`${name} contains unsupported characters or is too long.`)
  const families = result.split(',').map(item => item.trim()).filter(Boolean)
  const withoutGeneric = families.filter(item => item.toLowerCase() !== 'sans-serif')
  return [...withoutGeneric, 'sans-serif'].join(', ')
}

export function validateAppearance(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Appearance settings must be an object.')
  const displayName = String(value.displayName ?? DEFAULT_APPEARANCE.displayName).trim()
  if (!displayName || displayName.length > 100 || /[\u0000-\u001f\u007f]/.test(displayName)) {
    throw new Error('Application display name must be 1–100 printable characters.')
  }
  const logoMimeType = String(value.logoMimeType ?? '')
  let logoBase64 = String(value.logoBase64 ?? '')
  if (!['', 'image/png', 'image/jpeg', 'image/svg+xml'].includes(logoMimeType)) {
    throw new Error('Application logo must be PNG, JPEG, or sanitized SVG.')
  }
  if ((logoMimeType === '') !== (logoBase64 === '')) throw new Error('Choose a supported application logo file.')
  if (logoBase64) {
    if (logoBase64.length > 1_024_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(logoBase64)) {
      throw new Error('Application logo must be valid base64 and no larger than 750 KB.')
    }
    const bytes = Buffer.from(logoBase64, 'base64')
    if (bytes.length > 750 * 1024) throw new Error('Application logo must be no larger than 750 KB.')
    if (logoMimeType === 'image/png' && !(bytes[0] === 0x89 && bytes.subarray(1, 4).toString('ascii') === 'PNG')) {
      throw new Error('The selected application logo is not a valid PNG image.')
    }
    if (logoMimeType === 'image/jpeg' && !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
      throw new Error('The selected application logo is not a valid JPEG image.')
    }
    if (logoMimeType === 'image/svg+xml') {
      logoBase64 = Buffer.from(sanitizePublicSvg(bytes.toString('utf8')), 'utf8').toString('base64')
    }
  }
  const result = {
    displayName,
    logoMimeType,
    logoBase64,
    primaryColor: color(value.primaryColor ?? DEFAULT_APPEARANCE.primaryColor, 'Primary colour'),
    fontFamily: font(value.fontFamily ?? DEFAULT_APPEARANCE.fontFamily, 'Font family'),
    fontFallback: fontFallback(value.fontFallback ?? 'Arial', 'Font fallback'),
    baseFontSize: boundedNumber(value.baseFontSize ?? DEFAULT_APPEARANCE.baseFontSize, 'Base font size', 11, 20),
    headingFontSize: boundedNumber(value.headingFontSize ?? DEFAULT_APPEARANCE.headingFontSize, 'Heading font size', 14, 32),
    headingWeight: boundedNumber(value.headingWeight ?? DEFAULT_APPEARANCE.headingWeight, 'Heading weight', 400, 900),
    density: String(value.density ?? DEFAULT_APPEARANCE.density),
  }
  if (!['compact', 'comfortable'].includes(result.density)) throw new Error('Choose compact or comfortable density.')
  return result
}

export function validateReportStyle(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Report style must be an object.')
  const result = {
    fontFamily: font(value.fontFamily ?? DEFAULT_REPORT_STYLE.fontFamily, 'Report font family'),
    fontFallback: fontFallback(value.fontFallback ?? 'Arial', 'Report font fallback'),
    bodyFontSize: boundedNumber(value.bodyFontSize ?? DEFAULT_REPORT_STYLE.bodyFontSize, 'Report body size', 8, 14),
    headingFontSize: boundedNumber(value.headingFontSize ?? DEFAULT_REPORT_STYLE.headingFontSize, 'Report heading size', 10, 24),
    headingWeight: boundedNumber(value.headingWeight ?? DEFAULT_REPORT_STYLE.headingWeight, 'Report heading weight', 400, 900),
    logoPlacement: String(value.logoPlacement ?? DEFAULT_REPORT_STYLE.logoPlacement),
    logoWidthMm: boundedNumber(value.logoWidthMm ?? DEFAULT_REPORT_STYLE.logoWidthMm, 'Logo width', 20, 90),
    headerText: String(value.headerText ?? '').trim(),
    footerText: String(value.footerText ?? '').trim(),
    tableHeaderColor: color(value.tableHeaderColor ?? DEFAULT_REPORT_STYLE.tableHeaderColor, 'Table header colour'),
    tableHeaderTextColor: color(value.tableHeaderTextColor ?? DEFAULT_REPORT_STYLE.tableHeaderTextColor, 'Table header text colour'),
    tableStripeColor: color(value.tableStripeColor ?? DEFAULT_REPORT_STYLE.tableStripeColor, 'Table stripe colour'),
    pageSize: String(value.pageSize ?? DEFAULT_REPORT_STYLE.pageSize),
    pageOrientation: String(value.pageOrientation ?? DEFAULT_REPORT_STYLE.pageOrientation),
    pageMarginMm: boundedNumber(value.pageMarginMm ?? DEFAULT_REPORT_STYLE.pageMarginMm, 'Page margin', 8, 30),
  }
  if (!['top-left', 'top-center', 'top-right'].includes(result.logoPlacement)) throw new Error('Choose a supported logo placement.')
  if (!['A4', 'Letter'].includes(result.pageSize)) throw new Error('Choose A4 or Letter page size.')
  if (!['portrait', 'landscape'].includes(result.pageOrientation)) throw new Error('Choose portrait or landscape page orientation.')
  if (result.headerText.length > 300 || result.footerText.length > 300) throw new Error('Report header and footer text are limited to 300 characters.')
  return result
}

export function validatePublicProfileUrl(value) {
  let url
  try { url = new URL(String(value || '')) } catch { throw new Error('Enter the official Kreston Menon website URL.') }
  if (url.protocol !== 'https:' || !['www.krestonmenon.com', 'krestonmenon.com'].includes(url.hostname.toLowerCase())
    || url.username || url.password || url.search || url.hash
    || !['/', '/contact-us/dubai', '/contact-us/dubai/'].includes(url.pathname)) {
    throw new Error('Public profile fetch is restricted to the official Kreston Menon website and its Dubai contact page.')
  }
  return url
}

export function sanitizePublicSvg(source) {
  const svg = String(source || '').trim()
  if (!svg || Buffer.byteLength(svg, 'utf8') > 750 * 1024 || !/^<svg[\s>]/i.test(svg.replace(/^(?:<\?xml[^>]*>\s*)+/i, ''))) {
    throw new Error('The published logo must be an SVG file no larger than 750 KB.')
  }
  if (/<\s*(script|foreignObject|iframe|object|embed)\b|\bon[a-z]+\s*=|@import\b|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|javascript:|data:)|url\s*\(\s*["']?\s*(?:https?:|\/\/|javascript:|data:)/i.test(svg)) {
    throw new Error('The published SVG contains active or externally linked content and cannot be cached.')
  }
  return svg.replace(/^(?:<\?xml[^>]*>\s*)+/i, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '')
}

export function extractKrestonPublicProfile(homeHtml, officeHtml, retrievedAt = new Date().toISOString()) {
  const home = String(homeHtml || '')
  const officePage = String(officeHtml || '')
  const tag = (html, expression) => expression.exec(html)?.[1] || ''
  const decode = value => String(value).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  const email = tag(home, /href=["']mailto:([^"'?]+)/i)
  const phone = tag(home, /href=["']tel:([^"']+)/i)
  const phoneDigits = phone.replace(/\D/g, '')
  const formattedPhone = phoneDigits.startsWith('971') && phoneDigits.length === 11
    ? `+971 ${phoneDigits[3]} ${phoneDigits.slice(4, 7)} ${phoneDigits.slice(7)}`
    : decode(phone)
  const logoPath = tag(home, /<img[^>]*src=["']([^"']*storage\/uploads\/common-cms\/logo[^"']*\.svg)["']/i)
  const branch = [...officePage.matchAll(/<a\b[^>]*class=["'][^"']*\bbranch-list\b[^"']*["'][^>]*>/gi)]
    .map(match => match[0])
    .find(opening => /href=["'][^"']*\/contact-us\/dubai\/?["']/i.test(opening))
  if (!branch || !logoPath) throw new Error('The official website did not publish the expected Dubai office or vector logo details.')
  const attr = name => decode(tag(branch, new RegExp(`data-${name}=["']([^"']*)["']`, 'i')))
  const officeUrl = tag(branch, /href=["']([^"']+)["']/i)
  const name = decode(tag(home, /<meta\s+name=["']author["']\s+content=["']([^"']+)["']/i)) || 'Kreston Menon'
  return {
    profileStatus: 'demo',
    firmName: name,
    websiteUrl: 'https://www.krestonmenon.com/',
    email: decode(email),
    phone: formattedPhone,
    address: attr('location'),
    office: {
      officeName: 'Dubai',
      address: attr('location'),
      phone: attr('phone'),
      email: attr('email'),
      sourceUrl: decode(officeUrl),
    },
    logoUrl: new URL(decode(logoPath), 'https://www.krestonmenon.com/').toString(),
    sourceUrls: ['https://www.krestonmenon.com/', decode(officeUrl)],
    retrievedAt,
    registrationNumber: '',
    signingAuthority: '',
    disclaimer: 'Draft/demo profile. No registration number, professional credential, or signing authority was published or inferred.',
  }
}
