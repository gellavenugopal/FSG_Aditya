export function isValidDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function validateEngagementDraft(input, requireServiceScope = false) {
  const errors = []
  if (!Number.isInteger(Number(input.entityId)) || Number(input.entityId) <= 0) errors.push('Select a client.')
  if (!String(input.name || '').trim()) errors.push('Engagement name is required.')
  if (!Array.isArray(input.serviceScope)) errors.push('Service scope must be a list.')
  else if (requireServiceScope && input.serviceScope.length === 0) errors.push('Add at least one service to the scope.')
  else if (input.serviceScope.some(scope => !['statutory_audit', 'review', 'compilation', 'tax'].includes(scope))) {
    errors.push('Choose only supported service-scope options.')
  }

  const start = input.periodStart || ''
  const end = input.periodEnd || ''
  if (!!start !== !!end) errors.push('Enter both reporting-period dates, or leave both blank for a Draft.')
  if (start && end) {
    if (!isValidDateOnly(start) || !isValidDateOnly(end)) errors.push('Enter valid reporting-period dates.')
    else if (start >= end) errors.push('The reporting-period start must be before its end.')
  }

  for (const [label, currency] of [['Trial balance currency', input.trialBalanceCurrency], ['Presentation currency', input.presentationCurrency]]) {
    if (currency && !/^[A-Z]{3}$/.test(currency)) errors.push(`${label} must be a three-letter ISO currency code.`)
  }

  return errors
}

export function validateActivation(input) {
  const errors = validateEngagementDraft(input, true)
  if (!input.periodStart || !input.periodEnd) errors.push('Reporting-period dates are required to activate.')
  if (!input.partnerUserId) errors.push('Assign an engagement partner before activation.')
  if (!input.jurisdiction || !input.framework || !input.reportingPackId) errors.push('Choose a reporting basis.')
  if (!input.trialBalanceCurrency || !input.presentationCurrency) errors.push('Set both reporting currencies.')
  if (input.trialBalanceCurrency !== input.presentationCurrency) errors.push('Currency translation is not implemented; trial-balance and presentation currencies must match.')
  if (!input.compatibilityConfirmed) errors.push('Confirm the reporting-pack compatibility and legacy-data setup.')
  return [...new Set(errors)]
}

export function canViewEngagement(user, engagement, membership) {
  return ['administrator', 'partner'].includes(user.role)
    || engagement.owner_user_id === user.id
    || engagement.partner_user_id === user.id
    || engagement.substitute_user_id === user.id
    || !!membership
}

export function canEditEngagement(user, engagement, membership) {
  if (engagement.status === 'finalised' || engagement.status === 'archived') return false
  return engagement.owner_user_id === user.id
    || membership?.access_level === 'edit'
}

export function canFinaliseEngagement(user, engagement) {
  return engagement.partner_user_id === user.id || engagement.substitute_user_id === user.id
}
