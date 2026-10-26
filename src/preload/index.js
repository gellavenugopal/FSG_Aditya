import { contextBridge, ipcRenderer } from 'electron'

// Every call goes through inv(): a call that SAVES something also tells the main process, which tells the app's other windows
// (App.jsx offers them a refresh). Reads, dialogs and file writes do not.
const WRITE_RX = /^(?:notes)?(save|set|add|upsert|update|override|approve|delete|remove|run|upload|import|clear|lock|unlock|finali[sz]e|attach|revert|resolve|bulk|markReview|publish|create|insert|replace|apply|merge|rename|reset|restore|toggle|accept|move|propagate|record|submit|enable|disable|link|assign|fix|dismiss|mark|insertManualRow|activate|reopen|requestAccess|resolveAccess|confirmLegacy|setup|changePassword)/i
const isWrite = (channel) => {
  const ch = String(channel || '')
  if (/^(dialog|file|settings|window|app|db):/.test(ch)) return false
  const action = ch.includes(':') ? ch.split(':').slice(1).join(':') : ch
  return WRITE_RX.test(action) || /^(delete|save|import)[A-Z]/.test(ch)
}
const inv = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args)
  if (isWrite(channel)) { try { ipcRenderer.send('data:changed', { channel }) } catch {} }
  return r
}

contextBridge.exposeInMainWorld('api', {
  // Engagement identity and permission-checked operations
  engagementAuthStatus:       () => inv('engagementAuth:status'),
  setupEngagementAdmin:       (data) => inv('engagementAuth:setup', data),
  loginEngagementUser:        (data) => inv('engagementAuth:login', data),
  logoutEngagementUser:       () => inv('engagementAuth:logout'),
  changeEngagementPassword:   (password) => inv('engagementAuth:changePassword', password),
  canConfigureLocalEngagement:() => inv('engagementService:localSetupAvailable'),
  restartLocalEngagement:     () => inv('engagementService:restartLocal'),
  listEngagementUsers:        () => inv('engagementAdmin:listUsers'),
  createEngagementUser:       (data) => inv('engagementAdmin:createUser', data),
  getEngagementFirmSettings:  () => inv('engagementAdmin:firmSettings'),
  saveEngagementProfessionalFirm: (data) => inv('engagementAdmin:saveProfessionalFirm', data),
  saveEngagementFirmOffice:   (data) => inv('engagementAdmin:saveFirmOffice', data),
  saveEngagementPartnerProfile: (data) => inv('engagementAdmin:savePartnerProfile', data),
  listEngagementOptions:      () => inv('engagement:listOptions'),
  createEngagementClient:     (data) => inv('engagement:createClient', data),
  listEngagements:            (scope) => inv('engagement:list', scope),
  checkEngagementDuplicates:  (data) => inv('engagement:checkDuplicates', data),
  requestEngagementAccess:    (data) => inv('engagement:requestAccessForPeriod', data),
  createEngagement:           (data) => inv('engagement:create', data),
  updateEngagementDraft:      (data) => inv('engagement:updateDraft', data),
  getEngagementOverview:      (id) => inv('engagement:overview', id),
  confirmEngagementLegacyLink: (data) => inv('engagement:confirmLegacyLink', data),
  linkEngagementLegacyTrialBalances: (data) => inv('engagement:linkLegacyTrialBalances', data),
  updateEngagementAccess:     (data) => inv('engagement:updateAccess', data),
  resolveEngagementAccessRequest: (data) => inv('engagement:resolveAccessRequest', data),
  activateEngagement:         (data) => inv('engagement:activate', data),
  finaliseEngagement:         (data) => inv('engagement:finalise', data),
  reopenEngagement:           (id) => inv('engagement:reopen', id),
  listEngagementTrialBalances: (id) => inv('engagement:trialBalances', id),
  getEngagementTrialBalanceRows: (data) => inv('engagement:trialBalanceRows', data),
  importEngagementTrialBalance: (data) => inv('engagement:importTrialBalance', data),
  selectEngagementComparativeTrialBalance: (data) => inv('engagement:comparativeTrialBalanceSelect', data),
  listEngagementJournals:      (id) => inv('engagement:journalList', id),
  postEngagementJournal:       (data) => inv('engagement:journalPost', data),
  listEngagementFinalTrialBalances: (id) => inv('engagement:finalTrialBalances', id),
  createEngagementFinalTrialBalance: (data) => inv('engagement:finalTrialBalanceCreate', data),
  getEngagementFinalTrialBalanceRows: (data) => inv('engagement:finalTrialBalanceRows', data),
  correctEngagementMapping: (data) => inv('engagement:mappingOverride', data),
  getEngagementReportingData:  (data) => inv('engagement:reportingData', data),
  saveEngagementUaeDemoMappings: (data) => inv('engagement:uaeDemoMappingsSave', data),
  saveEngagementAuditReportSettings: (data) => inv('engagement:reportingSettingsSave', data),
  saveEngagementReportingSelections: (data) => inv('engagement:reportingSelectionsSave', data),
  createEngagementReportSignatory: (data) => inv('engagement:reportingSignatoryCreate', data),
  saveEngagementNoteDisclosure: (data) => inv('engagement:noteDisclosureSave', data),
  saveEngagementNoteDetails: (data) => inv('engagement:noteDetailsSave', data),
  listEngagementReportOutputs: (id) => inv('engagement:reportOutputs', id),
  saveEngagementReportOutput:  (data) => inv('engagement:reportOutputSave', data),
  getEngagementReportOutput:   (id) => inv('engagement:reportOutputRead', id),
  finaliseEngagementReportOutput: (id) => inv('engagement:reportOutputFinalise', id),
  renderEngagementPDF:          (html) => inv('engagement:renderPDF', html),
  saveEngagementPdfFile:        (data) => inv('engagement:savePdfFile', data),

  // More than one window
  openNewWindow:     (payload) => ipcRenderer.invoke('window:openNew', payload),
  quitApp:           ()       => ipcRenderer.invoke('app:quit'),
  onDataChanged:     (cb)      => { const h = (_e, info) => cb(info); ipcRenderer.on('data:changed', h); return () => ipcRenderer.removeListener('data:changed', h) },
  // Settings / DB connection
  getSettings:       ()       => inv('settings:get'),
  saveSettings:      (cfg)    => inv('settings:save', cfg),
  testConnection:    (cfg)    => inv('settings:testConnection', cfg),
  exportAllTablesToFile: (opts) => inv('db:exportAllTablesToFile', opts),
  getFormatReference:()       => inv('format:getReference'),

  // Entities
  getEntities:       ()       => inv('entity:getAll'),
  saveEntity:        (e)      => inv('entity:save', e),
  deleteEntity:      (id)     => inv('entity:delete', id),
  getBranches:       (eid)    => inv('tb:getBranches', eid),

  // Financial Periods (global master) + Entity Periods (per-Auditee attachment, with locking)
  listFinancialPeriods:  ()                    => inv('financialPeriod:list'),
  saveFinancialPeriod:   (data)                => inv('financialPeriod:save', data),
  deleteFinancialPeriod: (id)                  => inv('financialPeriod:delete', id),
  listEntityPeriods:     (entityId)            => inv('entityPeriod:list', entityId),
  attachEntityPeriod:    (entityId, fpId)      => inv('entityPeriod:attach', entityId, fpId),
  lockEntityPeriod:      (id)                  => inv('entityPeriod:lock', id),
  unlockEntityPeriod:    (id)                  => inv('entityPeriod:unlock', id),
  finaliseEntityPeriod:  (id, place, date)     => inv('entityPeriod:finalise', id, place, date),
  deleteEntityPeriod:    (id)                  => inv('entityPeriod:delete', id),
  setEntityPeriodPrevTB: (id, tbId)            => inv('entityPeriod:setPrevTB', id, tbId),
  getEntityPeriod:       (id)                  => inv('entityPeriod:get', id),
  setEntityPeriodPYMode: (id, mode)            => inv('entityPeriod:setPYMode', id, mode),

  // Trial Balance
  uploadTB:          (data)   => inv('tb:upload', data),
  uploadTallyTB:     (data)   => inv('tb:uploadTally', data),
  uploadRealBooksTB: (data)   => inv('tb:uploadRealBooks', data),
  uploadZohoTB:      (data)   => inv('tb:uploadZoho', data),
  uploadBusyTB:      (data)   => inv('tb:uploadBusy', data),

  // Tally Auto-Import (HTTP XML from running Tally)
  checkTally:        (cfg)                    => inv('tally:check', cfg),
  getTallyCompanies: (cfg)                    => inv('tally:companies', cfg),
  listTallyCompanies:(cfg)                    => inv('tally:listCompanies', cfg),
  fetchTallyTB:      (data)                   => inv('tally:fetchTB', data),
  tallyGetConfig:    ()                       => inv('tally:getConfig'),
  tallySaveConfig:   (cfg)                    => inv('tally:saveConfig', cfg),
  tallyTcpPing:      (cfg)                    => inv('tally:tcpPing', cfg),
  getTBList:         (eid)    => inv('tb:list', eid),
  getTBsForEntityPeriod: (entityPeriodId) => inv('tb:listByEntityPeriod', entityPeriodId),
  getTBRows:         (tbId)   => inv('tb:rows', tbId),
  downloadTBTemplate:()       => inv('tb:template'),
  deleteTB:          (tbId)   => inv('tb:delete', tbId),
  saveStock:         (data)   => inv('tb:saveStock', data),
  getStockRows:      (tbId)   => inv('tb:getStockRows', tbId),
  getOtherExpenseHeads: (tbId) => inv('tb:getOtherExpenseHeads', tbId),
  getOpeningStockCheck: (tbId) => inv('tb:getOpeningStockCheck', tbId),
  insertManualRow:   (data)   => inv('tb:insertManualRow', data),
  deleteTBRow:       (data)   => inv('tb:deleteRow', data),
  getLedgersForTB:   (tbId)   => inv('tb:getLedgersForTB', tbId),
  saveJournalEntry:  (data)   => inv('tb:saveJournalEntry', data),

  // Mapping Rules
  getDefaultMapping: (const_) => inv('mapping:getDefault', const_),
  getUserMapping:    (eid)    => inv('mapping:getUserMapping', eid),
  saveUserMapping:   (data)   => inv('mapping:saveUser', data),
  revertToDefault:   (eid)    => inv('mapping:revertDefault', eid),
  downloadMapping:   (rsId)   => inv('mapping:download', rsId),
  uploadMapping:     (data)   => inv('mapping:upload', data),
  getLevelFormat:    (const_, rsId) => inv('mapping:levelFormat', const_, rsId),
  getRuleSets:       (eid)    => inv('mapping:ruleSets', eid),
  getMapSheets:      (rsId, const_) => inv('mapping:getMapSheets', rsId, const_),

  // Mapped TB
  runMapping:        (tbId, rsId, opts) => inv('mappedTB:run', tbId, rsId, opts),
  getMappedRows:     (tbId)          => inv('mappedTB:rows', tbId),
  findMappedByFilter:(tbId, filter) => inv('mappedTB:findByFilter', tbId, filter),
  listMappedCaptions:(tbId)         => inv('mappedTB:captionTuples', tbId),
  exceptionsDiagnostics:(tbId)     => inv('mappedTB:diagnostics', tbId),
  setAdjustment:     (id, data)      => inv('mappedTB:setAdjustment', id, data),
  getAdjustmentSummary: (arg)        => inv('mappedTB:adjustmentSummary', arg),
  clearAdjustments:  (tbId)          => inv('mappedTB:clearAdjustments', tbId),
  addManualLedger:   (tbId, data)    => inv('mappedTB:addManualLedger', tbId, data),
  deleteManualLedger: (id)           => inv('mappedTB:deleteManualLedger', id),
  getAdjustmentLog:  (tbId)          => inv('mappedTB:adjustmentLog', tbId),
  approveRow:        (id)            => inv('mappedTB:approve', id),
  approveMany:       (ids)           => inv('mappedTB:approveMany', ids),
  overrideRow:       (id, data)      => inv('mappedTB:override', id, data),
  overrideMany:      (ids, data)     => inv('mappedTB:overrideMany', ids, data),
  markReview:        (ids)           => inv('mappedTB:markReview', ids),
  bulkSetNature:     (tbId, pattern, val) => inv('mappedTB:bulkSetLevel5', { tbId, mapping2Pattern: pattern, level5Value: val }),
  bulkSetNatureL3:   (tbId, pattern, val) => inv('mappedTB:bulkSetLevel3', { tbId, mapping2Pattern: pattern, level3Value: val }),
  clearAllMappings:  (tbId)          => inv('mappedTB:clearAll', tbId),
  downloadMappedTB:  (tbId)          => inv('mappedTB:downloadExcel', tbId),
  downloadLearnedRules: (entityId)          => inv('learnedRules:download', entityId),
  uploadLearnedRules:   (entityId, bytes)   => inv('learnedRules:upload', entityId, bytes),
  applyLearnedRules:    (entityId)          => inv('learnedRules:apply', entityId),
  listLearnedRules:     (entityId)          => inv('learnedRules:list', entityId),
  resolveConflict:      (id, chosen)          => inv('mappedTB:resolveConflict', id, chosen),
  resolveDiscrepancy:   (id, action, option)  => inv('mappedTB:resolveDiscrepancy', id, action, option),

  // Financial Statements
  getFinancialData:          (tbId)       => inv('financials:getData', tbId),
  getConsolidatedData:       (entityId, tbIds) => inv('financials:getConsolidatedData', entityId, tbIds),
  getBranchTBsData:          (entityId)   => inv('financials:getBranchTBsData', entityId),
  renderPDF:                 (html)       => inv('financials:renderPDF', html),
  getAppVersion:             ()           => inv('app:getVersion'),

  // Masters — Auditors & Signatories (legacy per-entity)
  listAuditors:         (entityId)            => inv('auditor:list', entityId),
  listGlobalAuditors:   ()                    => inv('auditor:listGlobal'),
  saveAuditor:          (data)                => inv('auditor:save', data),
  deleteAuditor:        (id)                  => inv('auditor:delete', id),
  listSignatories:      (entityId)            => inv('signatory:list', entityId),
  saveSignatory:        (data)                => inv('signatory:save', data),
  deleteSignatory:      (id)                  => inv('signatory:delete', id),

  // Masters — Global Auditor Firms & Signatories (shared across all entities)
  listAuditorFirms:     ()                    => inv('auditorFirm:list'),
  saveAuditorFirm:      (data)                => inv('auditorFirm:save', data),
  deleteAuditorFirm:    (id)                  => inv('auditorFirm:delete', id),
  listGlobalSignatories:(firmId)              => inv('globalSignatory:list', firmId),
  saveGlobalSignatory:  (data)                => inv('globalSignatory:save', data),
  deleteGlobalSignatory:(id)                  => inv('globalSignatory:delete', id),

  // Note Details (supplementary data for each financial statement note)
  getNoteDetails:       (tbId, noteNum, noteTitle)   => inv('noteDetails:get', tbId, noteNum, noteTitle),
  saveNoteDetails:      (data)                       => inv('noteDetails:save', data),
  listNoteDetails:      (tbId)                       => inv('noteDetails:listByTB', tbId),
  getItrDetails:        (tbId)                       => inv('itrDetails:get', tbId),
  saveItrDetails:       (data)                       => inv('itrDetails:save', data),
  exportItrExcel:       (data)                       => inv('itr:exportExcel', data),
  getNoteDisclosure:    (tbId, noteNum, noteTitle)   => inv('noteDisclosure:get', tbId, noteNum, noteTitle),
  saveNoteDisclosure:   (data)                       => inv('noteDisclosure:save', data),
  listNoteDisclosures:  (tbId)                       => inv('noteDisclosure:listByTB', tbId),
  getEntityNoteDisclosure:   (entityId, noteNum, noteTitle) => inv('entityNoteDisclosure:get', entityId, noteNum, noteTitle),
  saveEntityNoteDisclosure:  (data)                  => inv('entityNoteDisclosure:save', data),
  listEntityNoteDisclosures: (entityId)              => inv('entityNoteDisclosure:list', entityId),
  notesGetMSME:         (tbId, noteNum, noteTitle) => inv('notesGetMSME', tbId, noteNum, noteTitle),
  notesSaveMSME:        (tbId, noteNum, noteTitle, data) => inv('notesSaveMSME', tbId, noteNum, noteTitle, data),
  notesGetCashBank:     (tbId, noteNum, noteTitle) => inv('notesGetCashBank', tbId, noteNum, noteTitle),
  notesSaveCashBank:    (tbId, noteNum, noteTitle, data) => inv('notesSaveCashBank', tbId, noteNum, noteTitle, data),
  notesGetTradeReceivablesAging: (tbId, noteNum, noteTitle) => inv('notesGetTradeReceivablesAging', tbId, noteNum, noteTitle),
  notesSaveTradeReceivablesAging: (tbId, noteNum, noteTitle, data) => inv('notesSaveTradeReceivablesAging', tbId, noteNum, noteTitle, data),
  notesGetTradePayablesAging: (tbId, noteNum, noteTitle) => inv('notesGetTradePayablesAging', tbId, noteNum, noteTitle),
  notesSaveTradePayablesAging: (tbId, noteNum, noteTitle, data) => inv('notesSaveTradePayablesAging', tbId, noteNum, noteTitle, data),

  // Entity-level Note Details (shared across all branches for statutory forms)
  getEntityNoteDetails:  (entityId, noteNum, noteTitle) => inv('entityNoteDetails:get', entityId, noteNum, noteTitle),
  saveEntityNoteDetails: (data)                      => inv('entityNoteDetails:save', data),
  listEntityNoteDetails: (entityId)                  => inv('entityNoteDetails:list', entityId),

  // Form 3CD (Ratios)
  getForm3CD:            (entityId, entityPeriodId)  => inv('getForm3CD', entityId, entityPeriodId),
  saveForm3CD:           (entityId, entityPeriodId, data) => inv('saveForm3CD', entityId, entityPeriodId, data),

  // Ratio tab — Gross Profit Trading-Account item selection
  ratioGetGPSelection:   (entityId, entityPeriodId)  => inv('ratio:getGPSelection', entityId, entityPeriodId),
  ratioSaveGPSelection:  (entityId, entityPeriodId, selection) => inv('ratio:saveGPSelection', entityId, entityPeriodId, selection),

  // General Notes (narrative Notes to Accounts — replaces Tally tab slot)
  getGeneralNotes:       (entityId, entityPeriodId)  => inv('generalNotes:get', entityId, entityPeriodId),
  saveGeneralNotes:      (entityId, entityPeriodId, segments) => inv('generalNotes:save', entityId, entityPeriodId, segments),

  // Cash Flow Statement (CFS tab): the Previous Year column, typed Current Year overrides, include-in-PDF flag
  getCfs:                (entityId, entityPeriodId)  => inv('cfs:get', entityId, entityPeriodId),
  saveCfs:               (entityId, entityPeriodId, data) => inv('cfs:save', entityId, entityPeriodId, data),
  getDeferredTax:        (entityId, entityPeriodId)  => inv('deferredTax:get', entityId, entityPeriodId),
  saveDeferredTax:       (entityId, entityPeriodId, data) => inv('deferredTax:save', entityId, entityPeriodId, data),
  getTaxComputation:     (entityId, entityPeriodId)  => inv('taxComputation:get', entityId, entityPeriodId),
  saveTaxComputation:    (entityId, entityPeriodId, data) => inv('taxComputation:save', entityId, entityPeriodId, data),

  // Snapshots of the finalised statements for Cloudtail MCA (fs_snapshots)
  publishFsSnapshot:     (entityId, entityPeriodId, payload) => inv('fsSnapshot:publish', entityId, entityPeriodId, payload),
  listFsSnapshots:       (entityPeriodId)      => inv('fsSnapshot:list', entityPeriodId),

  // PPE (Property, Plant & Equipment)
  getPPELedgers:         (entityId, entityPeriodId)  => inv('getPPELedgers', entityId, entityPeriodId),
  savePPELedgers:        (entityId, entityPeriodId, ledgers) => inv('savePPELedgers', entityId, entityPeriodId, ledgers),
  deletePPELedger:       (id)                        => inv('deletePPELedger', id),
  importPPEFromTally:    (company, host, port)      => inv('importPPEFromTally', company, host, port),

  // Manual Previous Year entry (one flag per TB, shared by BS/PL/Notes; plus
  // per-particular/sub-heading PY values entered inline in the Notes screen)
  getManualPY:          (tbId)                      => inv('manualPY:get', tbId),
  setManualPY:          (tbId, enabled)              => inv('manualPY:set', tbId, enabled),
  getPlClosedToCapital: (tbId)                      => inv('plClosedToCapital:get', tbId),
  setPlClosedToCapital: (tbId, enabled)              => inv('plClosedToCapital:set', tbId, enabled),
  getEntityPlClosedToCapital: (entityId)              => inv('entityPlClosedToCapital:get', entityId),
  setEntityPlClosedToCapital: (entityId, enabled)     => inv('entityPlClosedToCapital:set', entityId, enabled),
  getEps:                (tbId)                      => inv('eps:get', tbId),
  setEps:                (tbId, field, value)         => inv('eps:set', tbId, field, value),
  getEntityEps:           (entityId)                  => inv('entityEps:get', entityId),
  setEntityEps:           (entityId, field, value)     => inv('entityEps:set', entityId, field, value),
  listManualPyEntries:  (tbId)                       => inv('manualPyEntries:list', tbId),
  upsertManualPyEntry:  (data)                       => inv('manualPyEntries:upsert', data),
  deleteManualPyEntry:  (id)                         => inv('manualPyEntries:delete', id),

  // Manual PY for the Consolidated view of a branch entity — entity-scoped
  // mirror of the four above (see schema.js's entity_manual_py_entries).
  getEntityManualPY:          (entityId)             => inv('entityManualPY:get', entityId),
  setEntityManualPY:          (entityId, enabled)    => inv('entityManualPY:set', entityId, enabled),
  listEntityManualPyEntries:  (entityId)             => inv('entityManualPyEntries:list', entityId),
  upsertEntityManualPyEntry:  (data)                 => inv('entityManualPyEntries:upsert', data),
  deleteEntityManualPyEntry:  (id)                   => inv('entityManualPyEntries:delete', id),

  // Manual custom face lines (e.g. Tax Expense "+ Add Line" for non-corp)
  listManualFaceLines:  (tbId, section)               => inv('manualFaceLines:list', tbId, section),
  addManualFaceLine:    (data)                        => inv('manualFaceLines:add', data),
  updateManualFaceLine: (data)                        => inv('manualFaceLines:update', data),
  deleteManualFaceLine: (id)                          => inv('manualFaceLines:delete', id),

  // Remarks
  listRemarks:          (tbId)                => inv('remarks:listByTB', tbId),
  saveRemark:           (data)                => inv('remarks:save', data),
  remarksConsolidated:  (tbId, prevTbId)       => inv('remarks:consolidated', tbId, prevTbId),

  // Depreciation Schedules — Useful Life / Schedule II basis (unchanged)
  depSave:              (data)      => inv('dep:save', data),
  depGet:               (tbId)      => inv('dep:get', tbId),
  depScheduleII:        ()          => inv('dep:scheduleII'),
  depDownloadTemplate:  ()          => inv('dep:downloadTemplate'),
  depParseExcel:        (filePath)  => inv('dep:parseExcel', filePath),
  depGetMappedLedgers:  (tbId)      => inv('dep:getMappedLedgers', tbId),

  // Depreciation — Income Tax Act, 1961 block-wise basis ("Dep (IT)")
  depITBlocksMaster:    ()          => inv('dep:itBlocksMaster'),
  depITBlocksCustom:    (entityId)  => inv('dep:itBlocksCustom', entityId),
  depITSaveCustomBlock: (data)      => inv('dep:saveCustomITBlock', data),
  depITGetLedgers:      (tbId)      => inv('dep:getITLedgers', tbId),
  depITGet:             (tbId)      => inv('dep:getIT', tbId),
  depITSave:            (data)      => inv('dep:saveIT', data),

  // Depreciation — Companies Act 2013, Schedule II category-level basis ("Dep (Comp)")
  depCompGet:           (tbId)      => inv('dep:getComp', tbId),
  depCompSave:          (data)      => inv('dep:saveComp', data),

  // File dialog + write
  openFileDialog:    (opts)   => inv('dialog:openFile', opts),
  saveFileDialog:    (opts)   => inv('dialog:saveFile', opts),
  writeFile:         (path, buf) => inv('file:write', path, buf),
  readFile:          (path)  => inv('file:read', path),
})
