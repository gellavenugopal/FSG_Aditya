import assert from 'node:assert/strict'
import {
  buildUaeDemoFinancials,
  buildUaeDemoFinancialsHtml,
} from '../src/renderer/src/components/Engagements/uaeDemoReporting.js'
import { createUaeIfrsTestBedFixtures } from './uae-ifrs-testbed-fixtures.mjs'

let assertions = 0
function check(condition, message) {
  assertions++
  assert.ok(condition, message)
}

function calculate(fixture, overrides = {}) {
  return buildUaeDemoFinancials({
    currentRows: fixture.currentTrialBalance.rows,
    comparativeRows: fixture.comparativeTrialBalance.rows,
    mappings: fixture.currentTrialBalance.mappings,
    periodEnd: fixture.engagement.settings.currentPeriodEnd,
    comparativePeriodEnd: fixture.engagement.settings.comparativePeriodEnd,
    disclosureTotals: fixture.disclosures.expectedTotals,
    ...overrides,
  })
}

function buildHtml(fixture, financials, narrative = fixture.disclosures.narrative) {
  return buildUaeDemoFinancialsHtml({
    financials,
    entity: fixture.entity,
    engagement: fixture.engagement,
    bundle: {
      auditReport: { fields: { opinion: 'Synthetic test-bed opinion wording.' } },
      noteDisclosures: narrative,
      approvalDate: fixture.engagement.approvalDate,
      approvalPlace: fixture.engagement.approvalPlace,
      approvalSignatories: [{ name: 'Synthetic Managing Member', designation: 'Managing Member' }],
    },
  })
}

function sourceBalance(rows) {
  return Math.round(rows.reduce((total, row) => total + Number(row.closing_balance || 0), 0) * 100) / 100
}

function assertBalancedJournals(journals) {
  for (const journal of journals) {
    const debit = journal.entries.filter(entry => entry.side === 'Dr')
      .reduce((total, entry) => total + Math.round(Number(entry.amount) * 100), 0)
    const credit = journal.entries.filter(entry => entry.side === 'Cr')
      .reduce((total, entry) => total + Math.round(Number(entry.amount) * 100), 0)
    check(debit === credit, `${journal.id} balances to the cent`)
  }
}

function assertResults(fixture, financials) {
  const expected = fixture.expected
  check(financials.sourceBalance === expected.sourceBalance, `${fixture.id} current TB balances`)
  check(financials.comparativeSourceBalance === expected.comparativeSourceBalance, `${fixture.id} comparative TB balances`)

  for (const [period, statement] of [['current', financials.current], ['comparative', financials.comparative]]) {
    const values = expected[period]
    check(statement.position.assets === values.assets, `${fixture.id} ${period} assets match independent fixture result`)
    check(statement.position.totalLiabilitiesAndEquity === values.liabilitiesAndEquity,
      `${fixture.id} ${period} liabilities and equity match independent fixture result`)
    check(statement.position.assets === statement.position.totalLiabilitiesAndEquity,
      `${fixture.id} ${period} statement of financial position reconciles`)
    check(statement.profit.profitForYear === values.profit, `${fixture.id} ${period} profit matches independent fixture result`)
    check(statement.profit.otherComprehensiveIncome === values.oci, `${fixture.id} ${period} OCI matches independent fixture result`)
    check(statement.profit.totalComprehensiveIncome === values.comprehensiveIncome,
      `${fixture.id} ${period} total comprehensive income reconciles`)
    check(statement.equity.totalClosing === values.equity, `${fixture.id} ${period} closing equity matches independent result`)
    check(statement.equity.difference === 0, `${fixture.id} ${period} equity movements reconcile`)
    check(statement.cashFlow.openingCash === values.cashOpening, `${fixture.id} ${period} opening cash uses selected prior data`)
    check(statement.cashFlow.closingCash === values.cashClosing, `${fixture.id} ${period} closing cash matches independent result`)
    check(statement.cashFlow.netMovement === values.cashMovement, `${fixture.id} ${period} cash movement matches independent result`)
    check(statement.cashFlow.difference === 0, `${fixture.id} ${period} cash flows reconcile`)
  }

  for (const note of financials.notes) {
    const supportingTotal = note.accounts.reduce((total, account) => total + account.current, 0)
    check(Math.abs(supportingTotal - note.currentTotal) <= 0.01,
      `${fixture.id} Note ${note.number} current supporting balances reconcile`)
  }
  for (const expectedNote of expected.noteTotals) {
    const note = financials.notes.find(item => item.number === expectedNote.noteNumber)
    check(!!note, `${fixture.id} Note ${expectedNote.noteNumber} exists`)
    check(note.currentTotal === expectedNote.currentTotal,
      `${fixture.id} Note ${expectedNote.noteNumber} current total matches independent result`)
    check(note.comparativeTotal === expectedNote.comparativeTotal,
      `${fixture.id} Note ${expectedNote.noteNumber} comparative uses selected prior-year TB`)
  }
}

const fixtures = createUaeIfrsTestBedFixtures()
check(fixtures.length === 3, 'three deterministic scenario fixtures are available')
const calculated = new Map()
const htmlByScenario = new Map()
for (const fixture of fixtures) {
  check(fixture.entity.legalForm === 'LLC' && fixture.engagement.settings.jurisdiction === 'AE',
    `${fixture.id} identifies a synthetic UAE LLC`)
  check(fixture.engagement.settings.functionalCurrency === 'AED'
    && fixture.engagement.settings.presentationCurrency === 'AED',
  `${fixture.id} uses AED without translation`)
  check(!!fixture.engagement.firm && !!fixture.engagement.office && !!fixture.engagement.partner
    && !!fixture.engagement.brandingProfile
    && fixture.engagement.managementSignatories.length > 0
    && !!fixture.engagement.reportDate && !!fixture.engagement.approvalDate && !!fixture.engagement.approvalPlace,
  `${fixture.id} has firm, office, branding, partner, signatory and signing selections`)
  assertBalancedJournals(fixture.journals)
  check(sourceBalance(fixture.currentTrialBalance.rows) === 0, `${fixture.id} current source rows balance`)
  check(sourceBalance(fixture.comparativeTrialBalance.rows) === 0, `${fixture.id} comparative source rows balance`)
  const financials = calculate(fixture)
  assertResults(fixture, financials)
  const html = buildHtml(fixture, financials)
  check(html.includes('DRAFT FOR DEMONSTRATION'), `${fixture.id} output remains demonstration-only`)
  check(html.includes('31 December 2025') && html.includes('31 December 2024'),
    `${fixture.id} output labels selected current and comparative periods`)
  check(html.includes('AED') && html.includes('Statement of financial position'),
    `${fixture.id} report uses UAE AED statements`)
  check(html.includes(fixture.disclosures.narrative[0].text),
    `${fixture.id} narrative disclosure reaches report HTML`)
  check(html.includes('Total comprehensive income'), `${fixture.id} report includes comprehensive income`)
  check(!/Schedule III|Companies Act|INR|India/i.test(html), `${fixture.id} has no India-specific report captions`)
  calculated.set(fixture.id, financials)
  htmlByScenario.set(fixture.id, html)
}

const [baseline, trading, oci] = fixtures
const ociFinancials = calculated.get(oci.id)
check(ociFinancials.current.profit.profitForYear === calculated.get(trading.id).current.profit.profitForYear,
  'the revaluation OCI is not forced through profit or loss')
check(ociFinancials.current.profit.otherComprehensiveIncome === 10000,
  'controlled IAS 16 fixture recognizes AED 10,000 in OCI')
check(ociFinancials.current.equity.revaluationSurplusClosing === 10000,
  'OCI is accumulated in a separate revaluation surplus')
check(ociFinancials.current.cashFlow.details.noncashPpeRevaluation === 10000
  && ociFinancials.current.cashFlow.netMovement === calculated.get(trading.id).current.cashFlow.netMovement,
'the non-cash revaluation is disclosed separately and excluded from cash flows')
check(ociFinancials.current.position.ppeNet === 53000, 'PPE carrying amount includes the revaluation adjustment')

const incompleteComparative = { ...trading, comparativeTrialBalance: { rows: [], mappings: {} } }
assert.throws(() => calculate(incompleteComparative), /select a prior-year comparative Trial Balance/i)
assertions++

const unmapped = structuredClone(trading)
unmapped.currentTrialBalance.rows.push({
  id: 99999, ledger_code: '9999', name: 'Unmapped material ledger', opening_balance: 0, closing_balance: -500,
})
assert.throws(() => calculate(unmapped), /Map every non-zero ledger.*Unmapped material ledger/i)
assertions++

const inconsistentDisclosure = structuredClone(trading)
inconsistentDisclosure.disclosures.expectedTotals[2].currentTotal += 1
assert.throws(() => calculate(inconsistentDisclosure), /Note 3 current disclosure total differs.*Reconcile the supporting schedule/i)
assertions++

const correctedNarrative = buildHtml(trading, calculated.get(trading.id), [
  { note_num: 3, note_title: 'Inventories', text: 'Updated synthetic inventory disclosure after reviewer correction.' },
])
check(correctedNarrative !== htmlByScenario.get(trading.id)
  && correctedNarrative.includes('Updated synthetic inventory disclosure after reviewer correction.'),
'a narrative disclosure correction changes the next report content')

const remapped = structuredClone(trading)
const revenueRow = remapped.currentTrialBalance.rows.find(row => row.ledger_code === '4000')
remapped.currentTrialBalance.mappings[String(revenueRow.id)] = 'other_income'
const remappedFinancials = calculate(remapped)
const remappedHtml = buildHtml(remapped, remappedFinancials)
check(remappedHtml !== htmlByScenario.get(trading.id)
  && remappedFinancials.current.profit.revenue === 0
  && remappedFinancials.current.profit.otherIncome === 220000,
'a mapping correction changes report line presentation without changing total profit')

const journalAdjusted = structuredClone(trading)
const expense = journalAdjusted.currentTrialBalance.rows.find(row => row.ledger_code === '6000')
const payables = journalAdjusted.currentTrialBalance.rows.find(row => row.ledger_code === '2000')
expense.closing_balance -= 1000
payables.closing_balance += 1000
journalAdjusted.journals.push({
  id: 'B-JE-02',
  date: '2025-12-31',
  description: 'Synthetic incremental accrued operating expense',
  currency: 'AED',
  entries: [
    { ledgerName: 'Operating expenses', side: 'Dr', amount: 1000 },
    { ledgerName: 'Trade payables', side: 'Cr', amount: 1000 },
  ],
})
const journalFinancials = calculate(journalAdjusted, { disclosureTotals: [] })
const journalHtml = buildHtml(journalAdjusted, journalFinancials)
check(journalHtml !== htmlByScenario.get(trading.id)
  && journalFinancials.current.profit.profitForYear === 44000
  && journalFinancials.current.position.payables === 18000,
'a balanced journal adjustment changes the next report content and reconciles')

const displayRows = structuredClone(trading.currentTrialBalance.rows)
const originalCash = displayRows.find(row => row.ledger_code === '1000').closing_balance
const displayFinancials = calculate(trading)
const displayHtml = buildHtml(trading, displayFinancials)
check(displayHtml.includes('77,000.00'), 'display amount is rounded to two decimal places')
check(displayFinancials.current.position.cash === 77000
  && displayRows.find(row => row.ledger_code === '1000').closing_balance === originalCash,
'PDF display formatting does not mutate underlying trial-balance balances')

check(htmlByScenario.get(baseline.id).includes('Draft for demonstration'),
  'Sample 01 baseline recalculation remains a draft')
console.log(`UAE IFRS first-cut test-bed passed (${assertions} assertions across A/B/C and failure cases).`)
