import { withStartupLock } from './client.js'
import { ensureSchema } from './schema.js'
import { seedDefaultMapping, ensureStockCategories } from '../services/excel.js'
import { migrateMappingV3Captions, migrateMappingV3CaptionsPass2 } from './mapping-v3-migration.js'
import { applyMappingPatches } from '../ipc/mapping.js'

// Legacy database startup, serialized across clients. With FSG_STARTUP_DATA_REWRITES=off, nothing that rewrites
// existing rules or mapped ledgers runs: the mapping reseed, caption migrations, patches and the one-time
// schema backfills are all skipped (additive schema creation still runs).
export async function runLegacyStartupSetup(env = process.env) {
  const rewritesOff = env.FSG_STARTUP_DATA_REWRITES === 'off'
  await withStartupLock(async () => {
    await ensureSchema()
    if (rewritesOff) {
      console.info('Startup mapping reseed and caption/patch rewrites skipped (FSG_STARTUP_DATA_REWRITES=off).')
    } else {
      await seedDefaultMapping()
    }
    await ensureStockCategories()
    if (!rewritesOff) {
      await migrateMappingV3Captions()
      await migrateMappingV3CaptionsPass2()
      await applyMappingPatches()
    }
  })
}
