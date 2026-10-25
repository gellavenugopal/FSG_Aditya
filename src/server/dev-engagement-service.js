import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createEngagementServer } from './engagement-server.js'

const OPENSSL_CANDIDATES = [
  'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe',
]

function findOpenSsl() {
  const executable = OPENSSL_CANDIDATES.find(candidate => {
    try {
      execFileSync(candidate, ['version'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })
  if (!executable) {
    throw new Error('Local engagement setup needs OpenSSL. Install Git for Windows or OpenSSL, then restart the app.')
  }
  return executable
}

export async function startLocalEngagementService(databaseConfig) {
  const directory = mkdtempSync(join(tmpdir(), 'fsg-engagement-dev-'))
  const keyPath = join(directory, 'localhost-key.pem')
  const certificatePath = join(directory, 'localhost-cert.pem')
  let service
  try {
    execFileSync(findOpenSsl(), [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath,
      '-out', certificatePath,
      '-subj', '/CN=localhost',
      '-days', '1',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ], { stdio: 'ignore' })

    const certificate = readFileSync(certificatePath)
    const setupToken = randomBytes(32).toString('hex')
    service = await createEngagementServer({
      databaseOptions: {
        host: databaseConfig.host,
        port: Number(databaseConfig.port),
        database: databaseConfig.database,
        user: databaseConfig.user,
        password: databaseConfig.password,
      },
      tlsOptions: { key: readFileSync(keyPath), cert: certificate },
      setupToken,
      host: '127.0.0.1',
      port: 0,
    })
    const address = await service.listen()
    return {
      service,
      clientOptions: {
        serviceUrl: `https://127.0.0.1:${address.port}`,
        setupToken,
        ca: certificate,
        localDevelopment: true,
      },
      async close() {
        try {
          await service.close()
        } finally {
          rmSync(directory, { recursive: true, force: true })
        }
      },
    }
  } catch (error) {
    if (service) await service.close().catch(() => {})
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}
