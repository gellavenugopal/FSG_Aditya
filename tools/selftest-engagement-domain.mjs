import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const source = fs.readFileSync(path.join(root, 'src', 'main', 'services', 'engagement-domain.js'), 'utf8')
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fsg-engagement-domain-'))
const modulePath = path.join(tempDirectory, 'engagement-domain.mjs')
fs.writeFileSync(modulePath, source)

try {
  const domain = await import(pathToFileURL(modulePath).href)
  assert.equal(domain.isValidDateOnly('2024-02-29'), true)
  assert.equal(domain.isValidDateOnly('2025-02-29'), false)
  const draft = {
    entityId: 12,
    name: 'Annual audit',
    serviceScope: ['statutory_audit'],
    periodStart: '2025-04-01',
    periodEnd: '2026-03-31',
    trialBalanceCurrency: 'INR',
    presentationCurrency: 'INR',
  }

  assert.deepEqual(domain.validateEngagementDraft(draft), [])
  assert.deepEqual(domain.validateEngagementDraft({ ...draft, serviceScope: [] }), [])
  assert.deepEqual(domain.validateEngagementDraft({
    ...draft,
    periodStart: '2025-02-30',
    serviceScope: ['unsupported'],
  }), [
    'Choose only supported service-scope options.',
    'Enter valid reporting-period dates.',
  ])
  assert.ok(domain.validateEngagementDraft({ ...draft, periodStart: '', periodEnd: '2026-03-31' })
    .includes('Enter both reporting-period dates, or leave both blank for a Draft.'))

  const activationErrors = domain.validateActivation({
    ...draft,
    partnerUserId: 5,
    jurisdiction: 'AE',
    framework: 'IFRS',
    reportingPackId: 'AE_IFRS',
    trialBalanceCurrency: 'AED',
    presentationCurrency: 'USD',
    compatibilityConfirmed: true,
  })
  assert.ok(activationErrors.includes('Currency translation is not implemented; trial-balance and presentation currencies must match.'))
  assert.ok(activationErrors.includes('Choose a reporting basis.') === false)
  assert.ok(domain.validateActivation({ ...draft, serviceScope: [] }).includes('Add at least one service to the scope.'))

  const owner = { id: 1, role: 'staff' }
  const engagement = { owner_user_id: 1, partner_user_id: 2, substitute_user_id: 3, status: 'active' }
  assert.equal(domain.canViewEngagement(owner, engagement, null), true)
  assert.equal(domain.canViewEngagement({ id: 4, role: 'staff' }, engagement, { access_level: 'read' }), true)
  assert.equal(domain.canEditEngagement({ id: 4, role: 'staff' }, engagement, { access_level: 'read' }), false)
  assert.equal(domain.canEditEngagement({ id: 4, role: 'staff' }, engagement, { access_level: 'edit' }), true)
  assert.equal(domain.canEditEngagement({ id: 2, role: 'partner' }, engagement, null), false)
  assert.equal(domain.canFinaliseEngagement({ id: 2, role: 'partner' }, engagement), true)
  assert.equal(domain.canFinaliseEngagement({ id: 3, role: 'partner' }, engagement), true)
  assert.equal(domain.canFinaliseEngagement({ id: 1, role: 'staff' }, engagement), false)
  assert.equal(domain.canViewEngagement({ id: 9, role: 'administrator' }, engagement, null), true)
  assert.equal(domain.canEditEngagement({ id: 9, role: 'administrator' }, engagement, null), false)
  assert.equal(domain.canEditEngagement({ id: 4, role: 'staff' }, { ...engagement, status: 'finalised' }, { access_level: 'edit' }), false)

  console.log('Engagement domain self-test passed.')
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true })
}
