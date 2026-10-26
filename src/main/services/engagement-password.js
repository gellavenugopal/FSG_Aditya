import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const derivePassword = promisify(pbkdf2)
const PASSWORD_ITERATIONS = 310000

export function validateEngagementPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw new Error('Password must be between 12 and 256 characters.')
  }
}

export async function createEngagementPasswordRecord(password) {
  validateEngagementPassword(password)
  const salt = randomBytes(16).toString('hex')
  const hash = await derivePassword(password, Buffer.from(salt, 'hex'), PASSWORD_ITERATIONS, 32, 'sha256')
  return { salt, hash: hash.toString('hex') }
}

export async function verifyEngagementPassword(password, salt, expectedHex) {
  if (typeof password !== 'string' || password.length > 256) return false
  const actual = await derivePassword(String(password || ''), Buffer.from(salt, 'hex'), PASSWORD_ITERATIONS, 32, 'sha256')
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
