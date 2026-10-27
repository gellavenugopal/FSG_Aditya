import assert from 'node:assert/strict'
import {
  DEFAULT_APPEARANCE, DEFAULT_REPORT_STYLE, extractKrestonPublicProfile, sanitizePublicSvg,
  validateAppearance, validatePublicProfileUrl, validateReportStyle,
} from '../src/main/services/branding-domain.mjs'

assert.deepEqual(validateAppearance(DEFAULT_APPEARANCE), { ...DEFAULT_APPEARANCE })
assert.equal(validateReportStyle(DEFAULT_REPORT_STYLE).fontFamily, 'Tahoma')
assert.equal(validateAppearance({ density: 'compact' }).density, 'compact')
assert.throws(() => validateAppearance({ primaryColor: 'blue' }), /hexadecimal/i)
assert.throws(() => validateAppearance({ density: 'tight' }), /compact or comfortable/i)
assert.equal(validateAppearance({ displayName: 'Kreston Menon', logoMimeType: 'image/svg+xml',
  logoBase64: Buffer.from('<svg viewBox="0 0 1 1"></svg>').toString('base64') }).displayName, 'Kreston Menon')
assert.throws(() => validateAppearance({ displayName: 'x'.repeat(101) }), /display name/i)
assert.throws(() => validateAppearance({ logoMimeType: 'image/svg+xml',
  logoBase64: Buffer.from('<svg><script>bad</script></svg>').toString('base64') }), /active or externally linked/i)
assert.throws(() => validateAppearance({ logoMimeType: 'image/png',
  logoBase64: Buffer.from('not a PNG').toString('base64') }), /valid PNG/i)
assert.throws(() => validateReportStyle({ pageMarginMm: 31 }), /between 8 and 30/i)
assert.throws(() => validateReportStyle({ logoPlacement: 'in-signatory-block' }), /supported logo placement/i)
assert.equal(validatePublicProfileUrl('https://www.krestonmenon.com/').hostname, 'www.krestonmenon.com')
assert.throws(() => validatePublicProfileUrl('http://127.0.0.1/'), /restricted/i)
assert.throws(() => validatePublicProfileUrl('https://www.krestonmenon.com/?next=https://127.0.0.1'), /restricted/i)

const svg = sanitizePublicSvg('<?xml version="1.0"?><svg viewBox="0 0 10 10"><path d="M0 0"/></svg>')
assert.match(svg, /^<svg/)
assert.throws(() => sanitizePublicSvg('<svg onload="alert(1)"></svg>'), /active or externally linked/i)
assert.throws(() => sanitizePublicSvg('<svg><image href="https://invalid.test/x.png"/></svg>'), /active or externally linked/i)

const home = `
  <meta name="author" content="Kreston Menon">
  <a href="tel:+97142762233">Call Us Now +971 4 276 2233</a>
  <a href="mailto:info@krestonmenon.com">Connect Mail</a>
  <img src="https://krestonmenon.com/storage/uploads/common-cms/logo(1).svg" alt="logo">
`
const office = `
  <a href="https://www.krestonmenon.com/contact-us/dubai/" class="branch-list"
     data-location="Lake Central, Level 15 Marasi Drive, Business Bay P.O. Box 55535, Dubai, UAE"
     data-phone="+971 4 276 2233" data-email="dubai@krestonmenon.com">Dubai</a>
`
const details = extractKrestonPublicProfile(home, office, '2026-10-27T00:00:00.000Z')
assert.equal(details.firmName, 'Kreston Menon')
assert.equal(details.phone, '+971 4 276 2233')
assert.equal(details.email, 'info@krestonmenon.com')
assert.equal(details.office.address, 'Lake Central, Level 15 Marasi Drive, Business Bay P.O. Box 55535, Dubai, UAE')
assert.equal(details.office.email, 'dubai@krestonmenon.com')
assert.equal(details.profileStatus, 'demo')
assert.equal(details.registrationNumber, '')
assert.equal(details.signingAuthority, '')
assert.equal(details.retrievedAt, '2026-10-27T00:00:00.000Z')
assert.equal(details.sourceUrls.length, 2)

console.info('Branding validation and synthetic public-profile parser checks passed.')
