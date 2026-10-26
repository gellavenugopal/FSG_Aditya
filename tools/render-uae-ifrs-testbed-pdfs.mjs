import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import {
  buildUaeDemoFinancials,
  buildUaeDemoFinancialsHtml,
} from '../src/renderer/src/components/Engagements/uaeDemoReporting.js'
import {
  applyUaeIfrsFixtureJournals,
  createUaeIfrsTestBedFixtures,
} from './uae-ifrs-testbed-fixtures.mjs'

const demoHome = process.env.FSG_DEMO_HOME || path.join(os.homedir(), 'FSG-Aditya-engagement-demo')
const manifestPath = path.join(demoHome, 'target.json')
if (!fs.existsSync(manifestPath)) {
  throw new Error('The existing isolated demo manifest is required for fixture PDF output. Do not run init.')
}
const outputDirectory = path.join(demoHome, 'outputs', 'UAE-IFRS-Testbed')
const relativeOutput = path.relative(demoHome, outputDirectory)
if (relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) {
  throw new Error('Fixture PDF output must remain inside the existing isolated demo home.')
}

const edgeCandidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
const edgePath = edgeCandidates.find(candidate => fs.existsSync(candidate))
if (!edgePath) throw new Error('Microsoft Edge was not found at a supported Windows installation path.')

function renderToPdf(htmlPath, pdfPath, profilePath) {
  const result = spawnSync(edgePath, [
    '--headless',
    '--disable-gpu',
    '--no-first-run',
    '--disable-extensions',
    '--no-pdf-header-footer',
    `--user-data-dir=${profilePath}`,
    `--print-to-pdf=${pdfPath}`,
    pathToFileURL(htmlPath).href,
  ], { encoding: 'utf8', timeout: 120000, windowsHide: true })
  if (result.error || result.status !== 0) {
    throw new Error(`Headless PDF rendering failed: ${result.error?.message || result.stderr || result.stdout || result.status}`)
  }
}

fs.mkdirSync(outputDirectory, { recursive: true })
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const runDirectory = path.join(outputDirectory, `run-${timestamp}`)
fs.mkdirSync(runDirectory, { recursive: false })
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-uae-ifrs-testbed-'))
const results = []

try {
  for (const fixture of createUaeIfrsTestBedFixtures()) {
    const financials = buildUaeDemoFinancials({
      currentRows: applyUaeIfrsFixtureJournals(fixture),
      comparativeRows: fixture.comparativeTrialBalance.rows,
      mappings: fixture.currentTrialBalance.mappings,
      periodEnd: fixture.engagement.settings.currentPeriodEnd,
      comparativePeriodEnd: fixture.engagement.settings.comparativePeriodEnd,
      disclosureTotals: fixture.disclosures.expectedTotals,
    })
    const html = buildUaeDemoFinancialsHtml({
      financials,
      entity: fixture.entity,
      engagement: fixture.engagement,
      bundle: {
        auditReport: { fields: { opinion: 'Synthetic first-cut test-bed wording; not a client audit opinion.' } },
        noteDisclosures: fixture.disclosures.narrative,
        approvalDate: fixture.engagement.approvalDate,
        approvalPlace: fixture.engagement.approvalPlace,
        approvalSignatories: [{ name: 'Synthetic Managing Member', designation: 'Managing Member' }],
      },
    })
    const filename = `${fixture.id}.pdf`
    const htmlPath = path.join(tempDirectory, `${fixture.id}.html`)
    const pdfPath = path.join(runDirectory, filename)
    const profilePath = path.join(tempDirectory, `${fixture.id}-edge-profile`)
    fs.writeFileSync(htmlPath, html, { flag: 'wx' })
    renderToPdf(htmlPath, pdfPath, profilePath)
    const pdf = await PDFDocument.load(await fs.promises.readFile(pdfPath))
    const expectedPages = (html.match(/<section class="report-page"/g) || []).length
    if (pdf.getPageCount() !== expectedPages) {
      throw new Error(`${fixture.id} PDF has ${pdf.getPageCount()} pages; its rendered contents layout requires ${expectedPages}.`)
    }
    results.push({ case: fixture.id, filename, pages: pdf.getPageCount(), bytes: fs.statSync(pdfPath).size })
  }

  console.log(JSON.stringify({
    result: 'Synthetic UAE test-bed renderer PDFs generated; these are not saved engagement outputs.',
    outputDirectory: runDirectory,
    cases: results,
  }, null, 2))
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
