import { randomBytes } from 'node:crypto'

export const DEMO_USER_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'administrator', email: 'admin@fsg-demo.invalid', displayName: 'Demo Administrator', jobTitle: 'partner', role: 'administrator' }),
  Object.freeze({ key: 'contributor', email: 'contributor@fsg-demo.invalid', displayName: 'Demo Contributor', jobTitle: 'employee', role: 'staff' }),
  Object.freeze({ key: 'reader', email: 'reader@fsg-demo.invalid', displayName: 'Demo Reader', jobTitle: 'employee', role: 'staff' }),
  Object.freeze({ key: 'partner', email: 'partner@fsg-demo.invalid', displayName: 'Demo Engagement Partner', jobTitle: 'partner', role: 'partner' }),
])

function createDemoUserCredential(user) {
  return {
    email: user.email,
    displayName: user.displayName,
    jobTitle: user.jobTitle,
    password: randomBytes(32).toString('base64url'),
  }
}

export function createDemoUserCredentials() {
  return Object.fromEntries(DEMO_USER_DEFINITIONS.map(user => [user.key, createDemoUserCredential(user)]))
}

export function addMissingDemoUserCredentials(testUsers = {}) {
  const users = { ...testUsers }
  let added = false
  for (const definition of DEMO_USER_DEFINITIONS) {
    if (Object.hasOwn(users, definition.key)) continue
    users[definition.key] = createDemoUserCredential(definition)
    added = true
  }
  return { testUsers: users, added }
}

export function validateDemoUserCredentials(testUsers) {
  for (const definition of DEMO_USER_DEFINITIONS) {
    const user = testUsers?.[definition.key]
    if (!user || user.email !== definition.email || user.displayName !== definition.displayName
      || user.jobTitle !== definition.jobTitle || typeof user.password !== 'string'
      || user.password.length < 12 || user.password.length > 256) {
      throw new Error(`The isolated demo credential configuration is missing ${definition.key}.`)
    }
  }
}
