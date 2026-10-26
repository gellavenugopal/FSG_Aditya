import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createDemoUserCredentials } from './engagement-demo-auth-config.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const { Pool } = require('pg')
const XLSX = require('xlsx')
const home = path.resolve(process.env.FSG_DEMO_HOME || path.join(os.homedir(), 'FSG-Aditya-engagement-demo'))
const dataDirectory = path.join(home, 'postgres-data')
const userDataPath = path.join(home, 'electron-user-data')
const targetFile = path.join(home, 'target.json')
const stateFile = path.join(home, 'bootstrap-state.json')
const pgRoot = 'C:\\Program Files\\PostgreSQL'
const versions = fs.existsSync(pgRoot)
  ? fs.readdirSync(pgRoot).filter(version => fs.existsSync(path.join(pgRoot, version, 'bin', 'initdb.exe')))
      .sort((left, right) => parseFloat(right) - parseFloat(left))
  : []
const pgBin = versions[0] && path.join(pgRoot, versions[0], 'bin')
if (!pgBin) throw new Error('PostgreSQL initdb.exe was not found under C:\\Program Files\\PostgreSQL.')
if (fs.existsSync(targetFile) || fs.existsSync(path.join(home, 'credentials.json'))) {
  throw new Error(`A demo environment already exists at ${home}. It will not be overwritten or deleted.`)
}

const run = (exe, args, options = {}) => {
  const result = spawnSync(exe, args, { encoding: 'utf8', timeout: 120000, ...options })
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(exe)} failed: ${result.error?.message || result.stderr || result.stdout || result.status}`)
  }
  return result.stdout
}
const sqlLiteral = value => `'${String(value).replace(/'/g, "''")}'`
const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close(error => error ? reject(error) : resolvePort(port))
  })
})

const previousState = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {}
let port = Number(previousState.port) || await freePort()
let instanceId = previousState.instanceId || randomUUID()
const runtimeUser = 'fsg_demo_runtime'
const database = 'fsg_engagement_demo'
const runtimePassword = previousState.runtimePassword || randomBytes(32).toString('base64url')
const bootstrapPassword = previousState.bootstrapPassword || randomBytes(32).toString('base64url')
const mappingFile = path.join(root, 'Mapping_v2.xlsx')
if (!fs.existsSync(mappingFile)) throw new Error(`Maintained mapping workbook is missing: ${mappingFile}`)

fs.mkdirSync(home, { recursive: true })
fs.mkdirSync(userDataPath, { recursive: true })
if (fs.existsSync(dataDirectory)) {
  if (!fs.existsSync(path.join(dataDirectory, 'PG_VERSION'))) {
    throw new Error(`Incomplete PostgreSQL data directory found at ${dataDirectory}; it is preserved for inspection.`)
  }
  const optionsFile = path.join(dataDirectory, 'postmaster.opts')
  if (fs.existsSync(optionsFile)) {
    const options = fs.readFileSync(optionsFile, 'utf8')
    const match = options.match(/["']?-p["']?\s+["']?(\d+)/)
    if (match) port = Number(match[1])
  }
} else {
  fs.mkdirSync(dataDirectory, { recursive: true })
  run(path.join(pgBin, 'initdb.exe'), [
    '-D', dataDirectory, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '-N',
  ])
}
fs.writeFileSync(stateFile, `${JSON.stringify({ port, instanceId, runtimePassword, bootstrapPassword }, null, 2)}\n`)

const startArgs = [
  '-D', dataDirectory,
  '-o', `-h 127.0.0.1 -p ${port} -c listen_addresses=127.0.0.1`,
  '-l', path.join(home, 'postgres.log'),
  '-w', 'start',
]
const control = path.join(pgBin, 'pg_ctl.exe')
const clusterStatus = spawnSync(control, ['-D', dataDirectory, 'status'], { stdio: 'ignore', timeout: 10000 })
if (clusterStatus.status !== 0) run(control, startArgs, { stdio: 'ignore' })
const hbaPath = path.join(dataDirectory, 'pg_hba.conf')
let hba = fs.readFileSync(hbaPath, 'utf8')
const trustHba = hba.replace(
  /^host\s+all\s+all\s+127\.0\.0\.1\/32\s+scram-sha-256\s*$/m,
  'host all all 127.0.0.1/32 trust'
)
if (trustHba !== hba) {
  fs.writeFileSync(hbaPath, trustHba, 'utf8')
  run(control, ['-D', dataDirectory, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' })
  run(control, startArgs, { stdio: 'ignore' })
  hba = trustHba
}
let bootstrap = new Pool({ host: '127.0.0.1', port, database: 'postgres', user: 'postgres' })
try {
  await bootstrap.query(`ALTER ROLE postgres PASSWORD ${sqlLiteral(bootstrapPassword)}`)
  const { rows: [existingRole] } = await bootstrap.query('SELECT rolname FROM pg_roles WHERE rolname=$1', [runtimeUser])
  if (existingRole) {
    await bootstrap.query(`ALTER ROLE ${runtimeUser} LOGIN PASSWORD ${sqlLiteral(runtimePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`)
  } else {
    await bootstrap.query(`CREATE ROLE ${runtimeUser} LOGIN PASSWORD ${sqlLiteral(runtimePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`)
  }
  const { rows: [existingDatabase] } = await bootstrap.query('SELECT datname FROM pg_database WHERE datname=$1', [database])
  if (existingDatabase) await bootstrap.query(`ALTER DATABASE ${database} OWNER TO ${runtimeUser}`)
  else await bootstrap.query(`CREATE DATABASE ${database} OWNER ${runtimeUser}`)
  await bootstrap.query('REVOKE CONNECT ON DATABASE postgres FROM PUBLIC')
  await bootstrap.query('REVOKE CONNECT ON DATABASE template1 FROM PUBLIC')
  await bootstrap.query('GRANT CONNECT ON DATABASE postgres TO postgres')
  await bootstrap.query('GRANT CONNECT ON DATABASE template1 TO postgres')
} finally {
  await bootstrap.end()
}

const hardenedHba = hba.replace(
  /^host\s+all\s+all\s+127\.0\.0\.1\/32\s+trust\s*$/m,
  'host all all 127.0.0.1/32 scram-sha-256'
)
if (hardenedHba !== hba) {
  fs.writeFileSync(hbaPath, hardenedHba, 'utf8')
  run(control, ['-D', dataDirectory, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' })
  run(control, startArgs, { stdio: 'ignore' })
}

const db = new Pool({
  host: '127.0.0.1', port, database, user: runtimeUser, password: runtimePassword,
  application_name: 'fsg-disposable-engagement-demo-setup',
})
try {
  const { rows: [identityTable] } = await db.query(
    `SELECT to_regclass('public.fsg_test_instance_identity') AS table_name`
  )
  if (!identityTable.table_name) {
    await db.query(`
    CREATE TABLE public.fsg_test_instance_identity (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      instance_id TEXT NOT NULL,
      data_directory TEXT NOT NULL
    );
    CREATE TABLE entities (
      id SERIAL PRIMARY KEY,name TEXT NOT NULL,constitution INTEGER NOT NULL,
      constitution_display TEXT,business_type TEXT,address TEXT,cin TEXT,pan TEXT,
      jurisdiction TEXT,legal_form TEXT
    );
    CREATE TABLE auditor_firms (
      id SERIAL PRIMARY KEY,firm_name TEXT NOT NULL,frn TEXT,is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT now(),pan TEXT,address TEXT,email TEXT
    );
    CREATE TABLE global_signatories (id SERIAL PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE financial_periods (
      id SERIAL PRIMARY KEY,year_label TEXT NOT NULL,date_from DATE NOT NULL,date_till DATE NOT NULL,
      UNIQUE(date_from,date_till)
    );
    CREATE TABLE mapping_rule_sets (
      id SERIAL PRIMARY KEY,name TEXT NOT NULL,is_default BOOLEAN DEFAULT FALSE,
      entity_id INTEGER REFERENCES entities(id),created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE level_format (
      id SERIAL PRIMARY KEY,rule_set_id INTEGER NOT NULL REFERENCES mapping_rule_sets(id),
      constitution INTEGER NOT NULL,alie TEXT,level1 TEXT,level2 TEXT,level3 TEXT,
      level4 TEXT,level5 TEXT,level6 TEXT,level7 TEXT,sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE map1 (
      id SERIAL PRIMARY KEY,rule_set_id INTEGER NOT NULL REFERENCES mapping_rule_sets(id),
      constitution INTEGER NOT NULL,tally_pre_primary TEXT,mapping1_resultant TEXT
    );
    CREATE TABLE map2 (
      id SERIAL PRIMARY KEY,rule_set_id INTEGER NOT NULL REFERENCES mapping_rule_sets(id),
      constitution INTEGER NOT NULL,keywords TEXT,mapping2_resultant TEXT,
      mapping1_resultant TEXT,priority INTEGER DEFAULT 1,notes TEXT
    );
    CREATE TABLE map3 (
      id SERIAL PRIMARY KEY,rule_set_id INTEGER NOT NULL REFERENCES mapping_rule_sets(id),
      constitution INTEGER NOT NULL,keywords TEXT,mapping1_resultant TEXT,mapping2_resultant TEXT,
      mapping3_resultant TEXT,priority INTEGER DEFAULT 1,notes TEXT
    );
    CREATE TABLE entity_periods (
      id SERIAL PRIMARY KEY,entity_id INTEGER NOT NULL REFERENCES entities(id),
      financial_period_id INTEGER NOT NULL REFERENCES financial_periods(id),
      locked BOOLEAN NOT NULL DEFAULT FALSE,locked_at TIMESTAMPTZ,is_final BOOLEAN NOT NULL DEFAULT FALSE,
      finalised_at TIMESTAMPTZ,final_sign_place TEXT,final_sign_date TEXT,
      UNIQUE(entity_id,financial_period_id)
    );
    CREATE TABLE trial_balances (
      id SERIAL PRIMARY KEY,entity_id INTEGER NOT NULL REFERENCES entities(id),
      entity_period_id INTEGER REFERENCES entity_periods(id),period TEXT NOT NULL,
      filename TEXT NOT NULL,row_count INTEGER NOT NULL,uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      branch_name TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE tb_rows (
      id SERIAL PRIMARY KEY,tb_id INTEGER NOT NULL REFERENCES trial_balances(id),
      ledger_name TEXT,alie TEXT,level1 TEXT,level2 TEXT,level3 TEXT,
      closing_balance NUMERIC NOT NULL,opening_balance NUMERIC NOT NULL,period TEXT,branch TEXT,
      ledger_code TEXT,name TEXT,debit NUMERIC NOT NULL DEFAULT 0,credit NUMERIC NOT NULL DEFAULT 0,
      is_revenue BOOLEAN,is_deemed_positive BOOLEAN,trail_balance NUMERIC NOT NULL DEFAULT 0,
      parent TEXT,group_parent TEXT,group_parent_1 TEXT,group_parent_2 TEXT,group_parent_3 TEXT,
      group_parent_4 TEXT,group_parent_5 TEXT,group_parent_6 TEXT,group_parent_7 TEXT,
      group_parent_8 TEXT,trial_balance_type TEXT,upload_nature TEXT,stock_head TEXT
    );
    CREATE TABLE mapped_tb (
      id SERIAL PRIMARY KEY,tb_id INTEGER NOT NULL REFERENCES trial_balances(id),
      tb_row_id INTEGER REFERENCES tb_rows(id),rule_set_id INTEGER REFERENCES mapping_rule_sets(id),
      ledger_name TEXT,mapped_head TEXT,amount NUMERIC,mapping1_resultant TEXT,
      mapping2_resultant TEXT,mapping3_resultant TEXT,level_format_id INTEGER REFERENCES level_format(id),
      level4_value TEXT,level5_value TEXT,level6_value TEXT,level7_value TEXT,alie TEXT,
      status TEXT DEFAULT 'auto_high',confidence TEXT DEFAULT 'high',conflict_candidates TEXT,
      conflict_stage INTEGER,discrepancy_suggestion TEXT,override_note TEXT,mapped_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(tb_id,tb_row_id)
    );
    CREATE TABLE note_details (
      id SERIAL PRIMARY KEY,tb_id INTEGER NOT NULL REFERENCES trial_balances(id),note_num INTEGER NOT NULL,
      note_title TEXT NOT NULL DEFAULT '',data TEXT NOT NULL DEFAULT '{}',details JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT now(),UNIQUE(tb_id,note_num)
    );
    CREATE TABLE note_disclosures (
      id SERIAL PRIMARY KEY,tb_id INTEGER NOT NULL REFERENCES trial_balances(id),note_num INTEGER NOT NULL,
      note_title TEXT NOT NULL,text TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(tb_id,note_num)
    );
    CREATE TABLE general_notes (
      id SERIAL PRIMARY KEY,entity_id INTEGER NOT NULL REFERENCES entities(id),
      entity_period_id INTEGER NOT NULL REFERENCES entity_periods(id),segments JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ DEFAULT now(),UNIQUE(entity_id,entity_period_id)
    );
    CREATE TABLE auditors (
      id SERIAL PRIMARY KEY,entity_id INTEGER NOT NULL REFERENCES entities(id),firm_name TEXT,frn TEXT,
      name TEXT NOT NULL,designation TEXT,membership_number TEXT NOT NULL,pan TEXT,
      membership_category TEXT,is_active BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE TABLE signatories (
      id SERIAL PRIMARY KEY,entity_id INTEGER NOT NULL REFERENCES entities(id),name TEXT NOT NULL,
      designation TEXT NOT NULL,din TEXT,id_type TEXT,is_active BOOLEAN NOT NULL DEFAULT TRUE
    );
    `)
    await db.query(
      `INSERT INTO public.fsg_test_instance_identity(singleton,instance_id,data_directory)
       VALUES (TRUE,$1,$2)`,
      [instanceId, dataDirectory]
    )
  } else {
    const { rows: [identity] } = await db.query(
      `SELECT instance_id,data_directory FROM public.fsg_test_instance_identity WHERE singleton=TRUE`
    )
    if (!identity || path.resolve(identity.data_directory).toLowerCase() !== path.resolve(dataDirectory).toLowerCase()) {
      throw new Error('The isolated PostgreSQL identity row is missing or points to another data directory.')
    }
    instanceId = identity.instance_id
  }

  const workbook = XLSX.readFile(mappingFile)
  const clean = value => value == null || value === '' ? null : String(value).trim()
  const read = sheet => (workbook.Sheets[sheet]
    ? XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { defval: null })
    : []).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), clean(value)])))
  const levelFormat = read('LevelFormat')
  const map1 = read('Map1')
  const map2 = read('Map2')
  const map3 = read('Map3')
  let { rows: [ruleSet] } = await db.query(
    `SELECT id FROM mapping_rule_sets WHERE is_default=TRUE ORDER BY id LIMIT 1`
  )
  if (!ruleSet) {
    const result = await db.query(
      `INSERT INTO mapping_rule_sets(name,is_default) VALUES ('Mapping_v2 disposable demo',TRUE) RETURNING id`
    )
    ruleSet = result.rows[0]
  }
  const { rows: [existingMappings] } = await db.query(
    `SELECT COUNT(*)::integer AS count FROM level_format WHERE rule_set_id=$1`,
    [ruleSet.id]
  )
  if (Number(existingMappings.count) === 0) {
  for (const [index, row] of levelFormat.entries()) {
    if (!row.constitution || !Number.isInteger(Number(row.constitution))) continue
    await db.query(
      `INSERT INTO level_format(rule_set_id,constitution,alie,level1,level2,level3,level4,level5,level6,level7,sort_order)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [ruleSet.id, Number(row.constitution), row.alie, row['level 1'], row['level 2'], row['level 3'],
        row['level 4'], row['level 5'], row['level 6'], row['level 7'], index]
    )
  }
  for (const row of map1) {
    if (!row.constitution || !Number.isInteger(Number(row.constitution))) continue
    await db.query(
      `INSERT INTO map1(rule_set_id,constitution,tally_pre_primary,mapping1_resultant) VALUES($1,$2,$3,$4)`,
      [ruleSet.id, Number(row.constitution), row['tally pre-primary'], row['mapping1 resultant']]
    )
  }
  for (const row of map2) {
    if (!row.constitution || !Number.isInteger(Number(row.constitution))) continue
    await db.query(
      `INSERT INTO map2(rule_set_id,constitution,keywords,mapping2_resultant,mapping1_resultant,priority,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [ruleSet.id, Number(row.constitution), row.keyword, row['mapping2 resultant'],
        row['mapping1 resultant'], Number(row.priority) || 1, row['notes for understanding']]
    )
  }
  for (const row of map3) {
    if (!row.constitution || !Number.isInteger(Number(row.constitution))) continue
    await db.query(
      `INSERT INTO map3(rule_set_id,constitution,keywords,mapping1_resultant,mapping2_resultant,mapping3_resultant,priority,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ruleSet.id, Number(row.constitution), row.keyword, row['mapping1 resultant'],
        row['mapping2 resultant'], row['mapping3 resultant'], Number(row.priority) || 1, row['notes for understanding']]
    )
  }
  }
} finally {
  await db.end()
}

const manifest = {
  instanceId,
  host: '127.0.0.1',
  port,
  database,
  user: runtimeUser,
  dataDirectory,
  userDataPath,
}
fs.writeFileSync(targetFile, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
fs.writeFileSync(path.join(home, 'credentials.json'), `${JSON.stringify({
  host: manifest.host, port, database, user: runtimeUser, password: runtimePassword,
  testUsers: createDemoUserCredentials(),
}, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
fs.rmSync(stateFile, { force: true })
console.info(JSON.stringify({
  home,
  host: manifest.host,
  port,
  database,
  user: runtimeUser,
  dataDirectory,
  userDataPath,
  targetFile,
}, null, 2))
console.info('Disposable PostgreSQL is initialized and running. No production connection was used.')
