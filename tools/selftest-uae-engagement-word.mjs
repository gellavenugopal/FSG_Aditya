import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { SYNTHETIC_ASPECT, SYNTHETIC_SVG_BASE64, pngInfo, ratioWithin } from './brand-logo-fixture.mjs'
import { calculateUaeReportDataHash } from '../src/main/services/uae-report-data-hash.mjs'
import { buildUaeDemoFinancials } from '../src/renderer/src/components/Engagements/uaeDemoReporting.js'
import { buildUaeEngagementWordDocument } from '../src/main/services/uae-engagement-word.js'
import {
  applyUaeIfrsFixtureJournals,
  createUaeIfrsTestBedFixtures,
} from './uae-ifrs-testbed-fixtures.mjs'

const fixtures = createUaeIfrsTestBedFixtures()

function sourceFor(fixture, outputId) {
  const rows = applyUaeIfrsFixtureJournals(fixture).map((row, index) => ({
    ...row,
    debit: Number(fixture.currentTrialBalance.rows[index].debit || 0) + Number(row.debit || 0),
    credit: Number(fixture.currentTrialBalance.rows[index].credit || 0) + Number(row.credit || 0),
  }))
  const financials = buildUaeDemoFinancials({
    currentRows: rows,
    comparativeRows: fixture.comparativeTrialBalance.rows,
    mappings: fixture.currentTrialBalance.mappings,
    periodEnd: fixture.engagement.settings.currentPeriodEnd,
    comparativePeriodEnd: fixture.engagement.settings.comparativePeriodEnd,
  })
  const snapshot = { id: outputId + 100, version: 3, journal_watermark: 2 }
  const finalRows = rows.map(row => ({ ...row }))
  const uaeMappings = Object.entries(fixture.currentTrialBalance.mappings).map(([trialBalanceRowId, lineKey]) => ({
    trialBalanceRowId: Number(trialBalanceRowId),
    lineKey,
  }))
  const source = {
    engagement: {
      reference: fixture.id,
      name: fixture.engagement.name,
      clientName: fixture.entity.name,
      reportingPackId: fixture.engagement.reportingPackId,
      periodStart: fixture.engagement.settings.currentPeriodStart,
      periodEnd: fixture.engagement.settings.currentPeriodEnd,
      trialBalanceCurrency: 'AED',
      presentationCurrency: 'AED',
    },
    reportOutput: {
      id: outputId,
      version: 7,
      final_tb_snapshot_id: snapshot.id,
      final_tb_version: 3,
      report_style_snapshot: {
        settings: {
          fontFamily: 'Tahoma', fontFallback: 'Arial, sans-serif', bodyFontSize: 10, headingFontSize: 16,
          headingWeight: 700, logoPlacement: 'top-right', logoWidthMm: 40, headerText: 'Synthetic header',
          footerText: 'Synthetic footer', tableHeaderColor: '#123456', tableHeaderTextColor: '#ffffff',
          tableStripeColor: '#eeeeee', pageSize: 'Letter', pageOrientation: 'landscape', pageMarginMm: 12,
        },
      },
      template_id: 'uae-demo-v1',
      template_revision: 4,
      financial_data_sha256: '',
      audit_report_fields: {
        addressee: 'To the members',
        opinion: 'Synthetic demonstration opinion.',
        basisForOpinion: 'Synthetic basis.',
        managementResponsibilities: 'Synthetic management responsibilities.',
        auditorResponsibilities: 'Synthetic auditor responsibilities.',
        otherMatters: 'Synthetic other matters.',
        reportDate: '2026-10-27',
        reportPlace: 'Dubai',
        firmName: 'Synthetic UAE Test Firm',
        firmAddress: 'Synthetic office address',
        firmRegistrationNumber: 'DEMO-FIRM-01',
        auditorName: 'Synthetic Test Partner',
        auditorMembershipNumber: 'DEMO-01',
        auditorDesignation: 'Partner',
      },
      signing_details: {
        approvalDate: '2026-10-27',
        approvalPlace: 'Dubai',
        signatories: [{ id: 1, name: 'Synthetic Managing Member', designation: 'Managing Member' }],
        identitySnapshot: { branding: { name: 'Synthetic UAE Test Brand' } },
      },
    },
    snapshot,
    finalRows,
    uaeMappings,
    comparativeTrialBalance: {
      id: fixture.comparativeTrialBalance.id,
      filename: 'Synthetic comparative TB.xlsx',
      dateFrom: fixture.engagement.settings.comparativePeriodStart,
      dateTill: fixture.engagement.settings.comparativePeriodEnd,
    },
    noteDisclosures: fixture.disclosures.narrative,
    financials,
  }
  source.reportOutput.financial_data_sha256 = calculateUaeReportDataHash(source)
  return source
}

for (const [index, fixture] of [fixtures[0], fixtures[2]].entries()) {
  const source = sourceFor(fixture, index + 1)
  const buffer = await buildUaeEngagementWordDocument(source)
  assert.ok(buffer.length > 5000, `${fixture.id} produces an editable Word document`)
  assert.deepEqual([...buffer.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'Word output is an OOXML ZIP package')
  if (index === 0) {
    assert.equal(source.financials.current.position.assets, fixture.expected.current.assets)
    assert.equal(source.financials.current.profit.profitForYear, fixture.expected.current.profit)
    assert.equal(source.financials.current.profit.totalComprehensiveIncome, fixture.expected.current.comprehensiveIncome)
  } else {
    assert.equal(source.financials.current.profit.otherComprehensiveIncome, fixture.expected.current.oci)
    assert.notEqual(source.financials.current.profit.otherComprehensiveIncome, 0, 'non-zero OCI fixture remains distinct from profit')
  }
}

await assert.rejects(
  buildUaeEngagementWordDocument({
    ...sourceFor(fixtures[0], 4),
    engagement: { ...sourceFor(fixtures[0], 4).engagement, reportingPackId: 'IN_SCHEDULE_III_LEGACY' },
  }),
  /only for the AED UAE demonstration reporting pack/,
)
await assert.rejects(
  buildUaeEngagementWordDocument({
    ...sourceFor(fixtures[0], 5),
    financials: { current: {}, comparative: null, notes: [] },
  }),
  /comparative Trial Balance and load reconciled UAE reporting data/,
)
await assert.rejects(
  buildUaeEngagementWordDocument({
    ...sourceFor(fixtures[0], 6),
    uaeMappings: [],
  }),
  /saved PDF data hash does not match/,
  'Word export rejects mappings changed since the saved PDF revision',
)

console.log('UAE editable Word export checks passed for baseline and non-zero OCI fixtures.')

{
  const logoSource = sourceFor(fixtures[0], 7)
  logoSource.reportOutput.signing_details.identitySnapshot = {
    branding: { name: 'Synthetic Kreston-proportion logo', logoMimeType: 'image/svg+xml', logoBase64: SYNTHETIC_SVG_BASE64 },
  }
  const zip = await JSZip.loadAsync(await buildUaeEngagementWordDocument(logoSource))
  const media = Object.keys(zip.files).filter(name => /^word\/media\/.+\.png$/.test(name))
  assert.equal(media.length, 1, 'SVG logo is embedded as one derived PNG')
  const info = pngInfo(await zip.file(media[0]).async('nodebuffer'))
  assert.ok(ratioWithin(info.width / info.height, SYNTHETIC_ASPECT), 'derived PNG keeps the SVG proportions')
  assert.equal(info.colorType, 6, 'derived PNG has an alpha channel')
  assert.equal(info.cornerAlpha, 0, 'derived PNG background is transparent')
  const xml = await zip.file('word/document.xml').async('string')
  const extent = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml)
  assert.ok(extent && ratioWithin(Number(extent[1]) / Number(extent[2]), SYNTHETIC_ASPECT), 'Word picture extent keeps the logo proportions')
  console.log(`Word logo: SVG derived to ${info.width}x${info.height} transparent PNG; extent ratio ${(extent[1] / extent[2]).toFixed(3)} (expected ${SYNTHETIC_ASPECT.toFixed(3)}).`)
}
