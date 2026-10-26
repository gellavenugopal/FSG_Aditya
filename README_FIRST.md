# FSG Bharat — source code (version 0.1.137)

Financial-statement generator for Indian entities (Proprietorship / Partnership / LLP / Company):
Electron + React (electron-vite, Tailwind) + PostgreSQL. This folder is the complete source; nothing built, no client data, no passwords.

## What you need installed
| Tool | Version | Used for |
|---|---|---|
| Node.js | 20 LTS or newer | build and run |
| PostgreSQL | 14 or newer | the app's database (runs on your own computer) |
| Windows 10/11 | | the app and the release script target Windows |

## First-time setup
1. Open a terminal in this folder and install the packages:
   ```
   npm install
   ```
2. Create an **empty** PostgreSQL database for the app (any name; the original uses `vera_financial`):
   ```
   createdb -U postgres vera_financial
   ```
   (or create it in pgAdmin). Do not restore anything into it: **the app creates every table and loads the
   mapping rules (`Mapping_v2.xlsx`) by itself the first time it starts.**
3. Start the app in development mode:
   ```
   npm run dev
   ```
   (or double-click `RunApp.bat`). On first start the app asks for the database connection
   (host `localhost`, port `5432`, database name, user, password) — enter your own. The setting is stored on your
   computer only (in the app's user-data folder), never in this folder.

## Everyday commands
| Command | What it does |
|---|---|
| `npm run dev` | run the app with live reload |
| `npm run build` | compile to `out/` |
| `npm run dist:win` | build the Windows exe into `dist/` |
| `node tools/selftest-<name>.mjs` | run one self-test (there are ~70 in `tools/`) |
| `node tools/selftest.mjs` | the general self-test |

Development output is also kept in a bounded `dev-launcher.log`; if the console disconnects, logging continues
in `%TEMP%\fsg-bharat-dev` or, in disposable test mode, in the isolated application profile.

For the isolated saved-engagement demo, run `.\tools\engagement-demo.ps1 provision-users` before launching.
It creates repeatable synthetic administrator/contributor/reader accounts only in the verified disposable
database and keeps their generated credentials in the ACL-restricted demo configuration file.
The exact isolated startup, sample workflow, finalisation, restart and PDF-reopen commands are in
[`ENGAGEMENT_SERVICE.md`](./ENGAGEMENT_SERVICE.md#saved-engagement-demo-through-the-desktop-ui).

## Reporting periods
The global Financial Period master is seeded with calendar-year, quarterly, and April-to-March periods for the
requested 2024–2027 ranges. Labels use the closing month and year (`MMMYYYY`), while start and end dates remain
separate ISO dates. Labels can repeat; a period is unique by its exact date range. Editing dates regenerates the
label without changing the period ID or its existing auditee links. Defaults are reusable masters only and are
not automatically attached to auditees or used to create engagements. Period selectors show both label and full
date range.

Many self-tests need PostgreSQL binaries on the machine (they start a throw-away database in a temp folder and
never touch yours). If `initdb` is not found they say **SKIPPED**; set `FSG_PGBIN` to PostgreSQL's `bin` folder.

## Where things are
- `src/main/` — Electron main process: database (`db/`), IPC handlers (`ipc/`), mapping engine (`services/mapping-engine.js`)
- `src/preload/index.js` — the bridge between screens and IPC (`window.api.*`)
- `src/renderer/src/` — the screens (`components/`), data layer (`hooks/useFinancials.js`), helpers (`utils/`)
- `Mapping_v2.xlsx` — the mapping rules (LevelFormat, Map1, Map2, Map3); seeded into the database on start
- `itr-templates/` — ITR Excel templates used by the ITR tab
- `tools/Release.ps1` — the original gated release script (runs every self-test, builds, hashes the exe). It expects the
  original machine's folders and a `releases/` folder; you probably want to use `npm run dist:win` instead.
- `RELEASES.md` — history of every version and what it changed. `CLAUDE.md` — architecture notes.

## Things worth knowing before you change code
- **Sign convention:** Dr-natured balances (assets, expenses) are stored **negative**; Cr positive.
- **Note numbers are positions, not identities.** Saved note data is found by note *title*, never by number.
- **One shared database:** in the original setup several computers use one PostgreSQL. Schema changes must be
  additive (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS` in `src/main/db/schema.js`).
- Prefer one shared fix plus a self-test in `tools/` over patching a single screen.

## Not included on purpose
`node_modules/`, built exes, release snapshots, release logs, the database itself, and any database connection settings.
