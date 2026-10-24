# VERA Financial — Project Memory

## Stack
- Electron + electron-vite | React + Tailwind | PostgreSQL (centralized database)
- Main process: `src/main/` | Renderer: `src/renderer/src/` | Preload: `src/preload/index.js`
- DB: PostgreSQL (localhost:5432) database `vera_financial`, user `vera_app`
  - Config: `C:\Users\Aditya Maheshwari\AppData\Roaming\vera-financial\db-config.json`
  - **IMPORTANT:** Always work in the `vera_financial` database — do NOT create/switch to alternate databases
- Mapping Excel: `Mapping_v2.xlsx` in project root (auto-seeded to DB on startup; falls back to `Mapping_updated.xlsx`)

## Run
- Dev: `npm run dev` OR double-click `RunApp.bat`
- Build exe: `npm run dist:win`

## Key architecture
- IPC: all DB calls go through `src/main/ipc/` handlers, exposed via `src/preload/index.js`
- Mapping engine: `src/main/services/mapping-engine.js` — 3-stage: Map1→Map2→Map3
- Sign convention: Dr-natured (assets/expenses) stored NEGATIVE, `is_deemed_positive=true`
- Theme: CSS variable `var(--color-primary)` — never use hardcoded `bg-blue-700`
- Note forms: Notes tab → ✏ Fill Details → opens form specific to note title
  - "Share Capital" → `ShareCapitalForm.jsx`
  - "Long-term borrowings" → `LongTermBorrowingsForm.jsx`
  - New forms: add title check in `Notes/index.jsx` + renderer in `buildHTML.js`

## DB schema key tables
- `trial_balances`, `tb_rows` — uploaded TB data
- `mapped_tb` — mapping engine output
- `mapping_rule_sets`, `map1`, `map2`, `map3`, `level_format` — mapping rules
- `note_details` — supplementary note data (JSON, per tb_id + note_num)
- `auditor_firms`, `global_signatories` — global auditor master
- `signatories` — per-entity signing authorities

## Mapping rules (constitution=3 = Company)
- Map1: pre-primary group → M1 (depth-first: G5→G4→G3→G2→G1→G0)
- Map2: group-based first, name-based fallback; priority-2 entries skip group matching
- Map3: null M1/M2 matches any; scope name-hit tiebreaker if group conflict
- ALIE lock: cross-boundary discrepancies blocked (Assets can't flip to Expenses)

## Common issues & fixes already done
- Electricity → Power and fuel: priority-2 group match skipped, name match used
- Share Capital = Note 1: case-insensitive SQL JOIN in financials.js
- Startup errors: seedDefaultMapping nulls mapped_tb.level_format_id before deleting level_format
- Tally auto-import: uses Node.js `http` module (not Electron `net`) for arm64 compat
- Depreciation level_format_id: added `lfByM1Terminal` index for terminal L1 LF rows (where level2 is null). Stage 3 no-hits path now resolves level_format_id, clears mapping2_resultant, and sets auto_high for categories like "Depreciation & Amortisation Expenses"

## Menu Structure (Current)
- **Top-level tabs (13):** Master | Trial Balance | Stock | Mapping | Dep | BS | PL | Notes | General Notes | Annex & Reco | Features | Exception | Generate Financials
- **Dep submenu:** Dep (Comp), Dep (IT), Dep (Old) — Alt+D opens the submenu; C, I or O selects the option
- **Features submenu:** ITR, Tax Computation, Deferred Tax, PPE, Ratio — Alt+U opens the submenu; I, T, D, P or R selects an item. ITR's submenu then uses B, P, D or L.
- Menu config: `src/renderer/src/App.jsx` (TABS, TAB_GROUPS, SHORTCUT_MAP arrays)
- NavBar component: `src/renderer/src/components/Layout/NavTabs.jsx` (dropdown rendering + SHORTCUT_KEYS)

## Entity info
- Test entity: Carverse (Company, constitution=3)
- Custom rule sets 3-12 are entity-specific (used for Auto-Mapping)
- Default rule set (id=1) refreshed from Mapping_v2.xlsx on every startup
