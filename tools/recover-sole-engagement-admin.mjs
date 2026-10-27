import { createHash, randomBytes } from 'node:crypto'
import { createEngagementDatabase } from '../src/server/engagement-db.js'

function argumentsFrom(argv) {
  const result = new Map()
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--') || result.has(key)) throw new Error('Use --firm-id, --email and --confirm-sole-admin-recovery once each.')
    result.set(key, argv[index + 1])
    index += 1
  }
  const firmId = Number(result.get('--firm-id'))
  const email = String(result.get('--email') || '').trim().toLowerCase()
  if (!Number.isSafeInteger(firmId) || firmId <= 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || result.get('--confirm-sole-admin-recovery') !== 'I_HAVE_VERIFIED_THE_SERVER_AND_FIRM') {
    throw new Error('Required: --firm-id <id> --email <admin-email> --confirm-sole-admin-recovery I_HAVE_VERIFIED_THE_SERVER_AND_FIRM')
  }
  return { firmId, email }
}

async function main() {
  const { firmId, email } = argumentsFrom(process.argv)
  const database = createEngagementDatabase()
  try {
    await database.connect()
    const credential = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(credential, 'utf8').digest('hex')
    const result = await database.runInTransaction(async () => {
      const { rows: matches } = await database.query(
        `SELECT id,firm_id,email,display_name,active,role
         FROM firm_users WHERE firm_id=$1 AND lower(email)=$2 ORDER BY id FOR UPDATE`,
        [firmId, email]
      )
      if (matches.length !== 1) throw new Error('The requested administrator email is ambiguous or unavailable in this firm.')
      const [target] = matches
      if (!target || !target.active || target.role !== 'administrator') {
        throw new Error('The exact requested active administrator was not found.')
      }
      const { rows: [count] } = await database.query(
        `SELECT count(*)::integer AS active_admin_count FROM firm_users
         WHERE firm_id=$1 AND active=TRUE AND role='administrator'`,
        [firmId]
      )
      if (count.active_admin_count !== 1) throw new Error('Sole-administrator recovery is permitted only when this firm has exactly one active administrator.')
      await database.query(
        `UPDATE engagement_password_resets SET consumed_at=COALESCE(consumed_at,now())
         WHERE firm_id=$1 AND user_id=$2 AND consumed_at IS NULL`,
        [firmId, target.id]
      )
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000)
      await database.query(
        `INSERT INTO engagement_password_resets (firm_id,user_id,token_hash,expires_at)
         VALUES ($1,$2,$3,$4)`,
        [firmId, target.id, tokenHash, expiresAt]
      )
      await database.query(
        `INSERT INTO engagement_audit_log (firm_id,actor_user_id,action,details)
         VALUES ($1,NULL,'user.password_reset_issued_by_server_operator',$2::jsonb)`,
        [firmId, JSON.stringify({ targetUserId: Number(target.id) })]
      )
      return { displayName: target.display_name, email: target.email, expiresAt }
    })
    console.info('Single-use reset credential for the verified sole administrator:')
    console.info(`User: ${result.displayName} <${result.email}>`)
    console.info(`Expires: ${result.expiresAt.toISOString()}`)
    console.info(credential)
    console.info('Deliver this credential to the verified administrator through a secure channel. It will not be shown again.')
  } finally {
    await database.close()
  }
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
