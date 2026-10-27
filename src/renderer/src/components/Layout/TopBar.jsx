import React, { useState, useEffect } from 'react'
import MastersModal from '../shared/MastersModal'
import FinancialYearBadge from './FinancialYearBadge'

const CONSTITUTION_LABEL = {
  1: 'Individual / Proprietorship / Partnership',
  2: 'LLP',
  3: 'Company',
}

const THEMES = [
  { key: 'blue',  label: 'Classic Blue',  swatch: '#1e40af' },
  { key: 'beige', label: 'Warm Beige',    swatch: '#92400e' },
  { key: 'green', label: 'Modern Green',  swatch: '#166534' },
  { key: 'pink',  label: 'Soft Pink',     swatch: '#9d174d' },
]

export default function TopBar({ onNewWindow, onQuit, entity, onOpenSettings, onManageFinancialPeriods, onSettings, dbOk, theme, onThemeChange, entityPeriods, currentEntityPeriodId, onEntityPeriodChange, applicationName = 'FSG Bharat', applicationLogo = '' }) {
  const [showMastersModal, setShowMastersModal] = useState(false)
  const [showThemeMenu, setShowThemeMenu]     = useState(false)
  const [appVersion, setAppVersion]           = useState('')

  useEffect(() => {
    window.api?.getAppVersion?.().then(v => setAppVersion(v || '')).catch(() => {})
  }, [])

  return (
    <header
      className="flex items-center justify-between text-white px-5 py-2.5 shadow-md select-none shrink-0"
      style={{ background: 'var(--app-navigation-color, var(--color-primary))' }}
    >
      <div className="flex items-center gap-3">
        {applicationLogo && <img alt="" src={applicationLogo} className="h-8 max-w-36 object-contain" />}
        <div className="font-bold text-xl tracking-wide text-white">{applicationName}</div>
        {appVersion && (
          <span className="text-white/80 font-medium self-end mb-0.5 -ml-1.5" style={{ fontSize: '8pt' }} title="Version of this copy of FSG Bharat">
            v{appVersion}
          </span>
        )}
        <div className="text-white/70 text-sm hidden md:block">Financial Statement Generator</div>
      </div>

      <div className="flex items-center gap-4">
        <FinancialYearBadge
          entity={entity}
          entityPeriods={entityPeriods}
          selectedId={currentEntityPeriodId}
          onSelect={onEntityPeriodChange}
          onManage={onManageFinancialPeriods}
        />

        <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${
          dbOk ? 'bg-green-600 text-white' : 'bg-red-500 text-white cursor-pointer'
        }`}
          onClick={!dbOk ? onSettings : undefined}
          title={dbOk ? 'Database connected' : 'Click to configure database'}
        >
          <span className={`w-2 h-2 rounded-full ${dbOk ? 'bg-green-300' : 'bg-red-200'}`} />
          {dbOk ? 'DB Connected' : 'DB Disconnected — Configure'}
        </div>

        {/* Current Auditee context — read-only; all create/select/edit is done via Settings */}
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-white/10 transition"
          style={{ background: 'var(--color-primary-dark)' }}
          title="Go to Settings"
        >
          {entity ? (
            <div className="text-left">
              <div className="text-white font-semibold text-sm leading-tight">{entity.name}</div>
              <div className="text-white/70 text-xs">
                {entity.constitution_display}{entity.business_type ? ` · ${entity.business_type}` : ''} · Settings
              </div>
            </div>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-sm">Select / Create Auditee</span>
            </>
          )}
        </button>

        {/* Another window of the app, opened on this client / Financial Year / tab (BS in one, P&L in another ...) */}
        {onNewWindow && (
          <button
            onClick={onNewWindow}
            className="px-2 py-1 rounded text-xs font-medium hover:bg-white/20 transition border border-white/30"
            title="Open this tab, for this client and Financial Year, in a new window (Alt+W)"
          >
            ⧉ New window
          </button>
        )}

        <button
          onClick={onQuit}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium hover:bg-red-600/90 transition border border-white/30"
          title="Exit FSG Bharat (Alt+X)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 7L7 17M7 7l10 10" />
          </svg>
          Exit
        </button>

        {/* Masters (Auditor / Signatories) — always visible */}
        <button
          onClick={() => setShowMastersModal(true)}
          className="p-1.5 rounded hover:bg-white/20 transition"
          title="Masters — Auditor & Signatories"
        >
          <svg className="w-5 h-5 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </button>

        {/* Theme picker */}
        <div className="relative">
          <button
            onClick={() => setShowThemeMenu(v => !v)}
            className="p-1.5 rounded hover:bg-white/20 transition"
            title="Change theme"
          >
            <svg className="w-5 h-5 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
          </button>
          {showThemeMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowThemeMenu(false)} />
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-48 py-1">
                <div className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-100 font-semibold uppercase">Theme</div>
                {THEMES.map(t => (
                  <button
                    key={t.key}
                    onClick={() => { onThemeChange?.(t.key); setShowThemeMenu(false) }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 text-left ${
                      theme === t.key ? 'bg-gray-100 font-semibold' : ''
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full border border-gray-300" style={{ background: t.swatch }} />
                    <span className="text-gray-800">{t.label}</span>
                    {theme === t.key && <span className="ml-auto text-green-600">✓</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          onClick={onSettings}
          className="p-1.5 rounded hover:bg-white/20 transition"
          title="Database Settings"
        >
          <svg className="w-5 h-5 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {showMastersModal && (
        <MastersModal
          entity={entity}
          onClose={() => setShowMastersModal(false)}
        />
      )}
    </header>
  )
}
