<#
  FSG Bharat — one-command release.

  Bumps the version, builds, hashes the exe, snapshots the exact source that
  produced it, and appends a row to RELEASES.md.

  Usage:
    powershell -ExecutionPolicy Bypass -File tools\Release.ps1 -Version 0.1.6 -Notes "Fixed X"

  Refuses to run if that version already appears in RELEASES.md — one version
  number is one binary, forever.
#>

param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Notes
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Fail($m) { Write-Host "`n  [ABORT] $m`n" -ForegroundColor Red; exit 1 }
function Step($m) { Write-Host "`n>> $m" -ForegroundColor Cyan }

if ($Version -notmatch '^\d+\.\d+\.\d+$') { Fail "Version must look like 0.1.6 (got '$Version')." }

$manifest = Join-Path $root "RELEASES.md"
if (-not (Test-Path $manifest)) { Fail "RELEASES.md not found at $manifest" }

# ── Guard: never reuse a version number ──────────────────────────────────────
if ((Get-Content $manifest -Raw -Encoding UTF8) -match [regex]::Escape("| $Version |")) {
  Fail "Version $Version is already in RELEASES.md. Pick a NEW number - never ship two different binaries under one version."
}

# ── Guard: a running app silently blocks the build forever ───────────────────
$running = Get-Process | Where-Object { $_.ProcessName -like "FSG*" }
if ($running) {
  Write-Host "  FSG Bharat is running (PIDs: $($running.Id -join ', '))." -ForegroundColor Yellow
  Write-Host "  Building to a separate folder so it cannot lock the output." -ForegroundColor Yellow
}

# ── 1. Version ───────────────────────────────────────────────────────────────
Step "Setting package.json version to $Version"
$pkgPath = Join-Path $root "package.json"
$pkgRaw  = Get-Content $pkgPath -Raw
$oldVer  = ([regex]'"version":\s*"([^"]+)"').Match($pkgRaw).Groups[1].Value
$pkgRaw  = [regex]::Replace($pkgRaw, '"version":\s*"[^"]+"', """version"": ""$Version""", 1)
# -Encoding utf8 emits a BOM in Windows PowerShell 5.1; write UTF-8 without one.
[System.IO.File]::WriteAllText($pkgPath, $pkgRaw, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "   $oldVer -> $Version"

# ── 1b. Self-test ────────────────────────────────────────────────────────────
# Runs BEFORE packaging. 0.1.7 shipped an infinite recursion that made every
# Tally import fail with "Maximum call stack size exceeded" — and the packaged
# app still launched fine, so a smoke test of "does the window open" caught
# nothing. These checks exercise the pure helpers for real.
Step "Self-test"
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Self-test failed - not building. Fix the failures above." }

# Manual Previous Year overlay - runs the real applyManualPyOverrides() against
# the note-row shapes the app produces (see tools\selftest-manualpy.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-manualpy.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Manual PY self-test failed - not building. Fix the failures above." }

# Mapping_v2.xlsx: every rule must resolve to an existing caption (see tools\selftest-mapping.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-mapping.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Mapping self-test failed - not building. Fix the failures above." }

# Inter-branch / Head Office elimination (see tools\selftest-interbranch.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-interbranch.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Inter-branch self-test failed - not building. Fix the failures above." }

# GST one-net-balance presentation (see tools\selftest-gst.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-gst.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "GST self-test failed - not building. Fix the failures above." }

# Notes: numbering, saved note data following its note, Excel face-cell links,
# Company BS PPE / Intangible split (see tools\selftest-notes.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-notes.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Notes self-test failed - not building. Fix the failures above." }

# PDF layout: 10pt minimum type outside Fill Details tables, Balance Sheet and
# P&L on one page, nothing wider than the paper, Notes / Annexures pages used
# fully with matching Carried / Brought forward (see tools\selftest-pdf-layout.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-pdf-layout.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "PDF layout self-test failed - not building. Fix the failures above." }

# Categorisation: Level 1/2/3 belong together on every save path, a Level 2
# heading from the other statement never reaches the statements, and every
# P&L note shows the same lines and totals on screen, in the PDF and in Excel
# (see tools\selftest-categorisation.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-categorisation.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Categorisation self-test failed - not building. Fix the failures above." }

# Figures agree: with a separate Previous Year Trial Balance selected, the
# Notes screen, the PDF and the Excel export show the same lines and totals —
# Balance Sheet, P&L, every note and every annexure sub-total — and Excel
# never keeps a cross-sheet link that would show something other than the
# app's own figure (see tools\selftest-figures-agree.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-figures-agree.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Figures-agree self-test failed - not building. Fix the failures above." }

# PY-only Balance Sheet major heads (see tools\selftest-py-only-major-head.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-py-only-major-head.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "PY-only-major-head self-test failed - not building. Fix the failures above." }

# PY-only major heads WITH template rows: PY figure, BS face and Notes list
# (see tools\selftest-py-only-manualpy-template.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-py-only-manualpy-template.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "PY-only-manual-PY-template self-test failed - not building. Fix the failures above." }

# A Previous Year rectification survives relaunch / CY re-save / learned rules /
# PY re-run - real main-process code on a throw-away PostgreSQL
# (see tools\selftest-py-mapping-persists.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-py-mapping-persists.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "PY-mapping-persistence self-test failed - not building. Fix the failures above." }

# Re-uploading a TB keeps Secured/Unsecured and GST placements; learned rules follow
# the latest year (see tools\selftest-reupload-mapping.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-reupload-mapping.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Re-upload mapping self-test failed - not building. Fix the failures above." }

# + Add PY-only Major Head: every BS head, every constitution, and heads with nil /
# cancelling ledgers this year (see tools\selftest-py-only-heads-all.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-py-only-heads-all.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "PY-only heads self-test failed - not building. Fix the failures above." }

# Company BS face: Trade payables (A) MSME / (B) others (see tools\selftest-company-trade-payables-msme.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-company-trade-payables-msme.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Company trade payables MSME self-test failed - not building. Fix the failures above." }

# Recategorisation bulk Level 4-7 only (see tools\selftest-bulk-levels.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-bulk-levels.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Bulk Level 4-7 self-test failed - not building. Fix the failures above." }

# Global auditor list works and auditees pick from it (see tools\selftest-global-auditor.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-global-auditor.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Global auditor self-test failed - not building. Fix the failures above." }

# Masters window text readable inside the white-text top bar (see tools\selftest-masters-visible.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-masters-visible.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Masters visibility self-test failed - not building. Fix the failures above." }

# Share Capital 1(e)-(l), Cash & Bank Other Details once, Sale of Goods / Services,
# no ratio working note (see tools\selftest-notes-sale-cash-sharecap.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-notes-sale-cash-sharecap.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Notes (share capital / cash / sale / ratios) self-test failed - not building. Fix the failures above." }

# Amount filters (Rectification, Mapped TB) and the To fix filter (see tools\selftest-amount-filters.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-amount-filters.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Amount filter self-test failed - not building. Fix the failures above." }

# Dep (IT) for a Company: blank rows + Block drop-down, no ledger mapping (see tools\selftest-dep-it-company.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-dep-it-company.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Dep (IT) company self-test failed - not building. Fix the failures above." }

# Features > Format: the blank BS / P&L / notes / Fill Details of each constitution (see tools\selftest-format.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-format.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Format self-test failed - not building. Fix the failures above." }

# P&L below the expense lines (discontinuing operations, Exceptional / Extraordinary) and the Company BS PPE caption (see tools\selftest-pl-tail.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-pl-tail.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "P&L tail self-test failed - not building. Fix the failures above." }

# Trial Balance adjustments (Mapped TB: Adjustments Dr / Cr -> Revised Clos Bal): the revised closing balance reaches every statement, note, ratio, EPS,
# Dep reconciliation and exception check, and cannot corrupt it (see tools\selftest-tb-adjustments.mjs; runs the real code on a throw-away PostgreSQL).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-tb-adjustments.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "TB adjustments self-test failed - not building. Fix the failures above." }

# A first year of operation (Previous Year EPS a dash, no message; Reserves and surplus without "Add:") and "Previous Year not required" (nil figures,
# column kept or left out of the PDF / Excel) - see tools\selftest-first-year.mjs; runs the real code on a throw-away PostgreSQL.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-first-year.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "First-year / Previous Year self-test failed - not building. Fix the failures above." }

# A branch with tens of thousands of ledgers must never blank the window (0.1.92): the Level Format helpers answer as the scanning ones did but in
# seconds, the Rectification screen draws a page at a time, a dead or hung screen is announced and reloaded, and the dropdowns' captions come from
# a small DISTINCT query - see tools\selftest-large-branch.mjs; the caption check runs the real handlers on a throw-away PostgreSQL.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-large-branch.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Large-branch self-test failed - not building. Fix the failures above." }

# Consolidated Dep (IT)/Dep (Comp) Pull from Branches (see tools\selftest-dep-join.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-dep-join.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Dep-join self-test failed - not building. Fix the failures above." }

# Trade Payables/Receivables sign-reclassification must run at most once and
# never override a manual/learned decision (see tools\selftest-sign-reclassify-guard.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-sign-reclassify-guard.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Sign-reclassify-guard self-test failed - not building. Fix the failures above." }

# A second "+ Add PY-only Major Head" entry must not overwrite the first
# (see tools\selftest-manualpy-notenum-clash.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-manualpy-notenum-clash.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Manual-PY note_num clash self-test failed - not building. Fix the failures above." }

# Columnar Excel Notes/Annexures sheets (see tools\selftest-columnar-notes-annexures.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-columnar-notes-annexures.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Columnar Notes/Annexures self-test failed - not building. Fix the failures above." }

# Owners'/Partners' Capital Account Excel note detail must not throw
# (see tools\selftest-owners-capital-excel.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-owners-capital-excel.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Owners-capital-Excel self-test failed - not building. Fix the failures above." }

# A named Manual PY particular (e.g. "Current tax") on an otherwise-flat P&L
# note must reach the P&L face's own named line, not just the note's total
# (see tools\selftest-named-manualpy-flat-note.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-named-manualpy-flat-note.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Named-Manual-PY-flat-note self-test failed - not building. Fix the failures above." }

# Tax expense: a Previous Year figure (entered via "+ Add PY-only Major Head" or by name) must reach the
# P&L face's Current tax row on every constitution, and the face's tax rows must foot to the tax total
# (see tools\selftest-tax-expense-manualpy.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-tax-expense-manualpy.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Tax-expense-Manual-PY self-test failed - not building. Fix the failures above." }

# Zoho Books Trial Balance upload: layout, the Dr+/Cr- sign flip, integrity checks, and the real mapping engine
# (see tools\selftest-zoho-tb.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-zoho-tb.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Zoho-TB self-test failed - not building. Fix the failures above." }

# Trade Receivables ageing table (Proprietorship / Partnership / LLP) on screen data, PDF, Excel and the bulk
# workbook; Company untouched; and the export's second PDF (no Index, no Annexures)
# (see tools\selftest-tr-ageing-and-pdf-variants.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-tr-ageing-and-pdf-variants.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Trade-Receivables-ageing-and-PDF-variants self-test failed - not building. Fix the failures above." }

# The tax on the P&L face - read from the REAL PDF and Excel builders - for every constitution
# (Company's caption is "Tax expense:" with a colon; the PDF face once missed it and printed empty
# placeholders while the notes had the tax) (see tools\selftest-tax-face-renderers.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-tax-face-renderers.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Tax-face-renderers self-test failed - not building. Fix the failures above." }

# Settings > Download All Tables (Excel): built and written in the main process, compressed, sanitised,
# split into files when too big - never a file-sized array through IPC ("Invalid array length")
# (see tools\selftest-db-export.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-db-export.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Database-export self-test failed - not building. Fix the failures above." }

# The Fix button opens the ACTUAL ledgers behind a flagged line (ids), not a caption search that can find nothing
# (see tools\selftest-fix-targets.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-fix-targets.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Fix-targets self-test failed - not building. Fix the failures above." }

# The Recategorisation screen as a Fix leaves it: honest empty state; nature column opens for caption-drifted ledgers
# (see tools\selftest-fix-recategorisation-ui.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-fix-recategorisation-ui.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Fix-recategorisation-UI self-test failed - not building. Fix the failures above." }

# Fix is clear for every level a ledger can lack (Level 4-7) and for the Previous Year; the screen-only flags never print
# (see tools\selftest-fix-levels.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-fix-levels.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Fix-levels self-test failed - not building. Fix the failures above." }

# The default Recategorisation list shows only ledgers that still need something - the real query, on a throw-away
# PostgreSQL started by the test itself, never the working database (see tools\selftest-queue-membership.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-queue-membership.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Queue-membership self-test failed - not building. Fix the failures above." }

# Stock tab (0.1.93): Stores & Spares / Loose Tools / Others are adjusted in the Other-expenses head the CA names - one line of the one Other
# expenses note; Raw Materials with no Cost of materials consumed line go to Changes in inventories; and the Other expenses note no longer splits
# in two when stock is added to it. See tools\selftest-stock-heads.mjs; the database checks run the real handlers on a throw-away PostgreSQL.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-stock-heads.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Stock-heads self-test failed - not building. Fix the failures above." }

# The Stock screen's head box used the way a person uses it (0.1.93): a row with an amount and no head turns red and Save is held, the pick-list
# opens on a click and narrows as you type, Enter / click-away / the cross, the heads that go in the save - the real screen in Electron
# (see tools\selftest-stock-ui.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-stock-ui.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Stock-screen self-test failed - not building. Fix the failures above." }

# General Notes tables (Financial Ratios, Remarks on Ratios) in the PDF (0.1.94): columns sized from what they hold, no word split mid-way
# (see tools\selftest-rich-table-fit.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-rich-table-fit.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Rich-table fit self-test failed - not building. Fix the failures above." }

# Cash Flow Statement (0.1.95): AS 3 indirect method drawn from the real Balance Sheet / P&L, ties to the Balance Sheet cash, typed Previous Year,
# the PDF page and the Excel sheet (see tools\selftest-cashflow.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-cashflow.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Cash Flow self-test failed - not building. Fix the failures above." }

# PAN on the auditee (0.1.96): optional, 5 letters + 4 digits + 1 letter (see tools\selftest-pan.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-pan.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "PAN self-test failed - not building. Fix the failures above." }

# Final copy (0.1.97): Place / Date of Signing saved + Financial Year locked when "Final" is ticked at export, released only by unlocking in Master
# (see tools\selftest-final-signing.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-final-signing.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Final-copy self-test failed - not building. Fix the failures above." }

# Snapshot for Cloudtail MCA (0.1.101): the finalised statements published into fs_snapshots - layout, stable codes, figures that agree with the
# statements, versioning, refusal of a bad snapshot (see tools\selftest-fs-snapshot.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-fs-snapshot.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Snapshot self-test failed - not building. Fix the failures above." }

# Two classifications (0.1.102): Advance to Suppliers (a debit balance under Trade Payables) -> Short-term loans and advances; Current maturities of
# long-term borrowings -> Short-term borrowings (see tools\selftest-short-term-reclass.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-short-term-reclass.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Short-term reclassification self-test failed - not building. Fix the failures above." }

# General Notes (Company): the Title Deeds of Immovable Property wording (0.1.104) - see tools\\selftest-title-deeds-text.mjs.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\\selftest-title-deeds-text.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Title-deeds wording self-test failed - not building. Fix the failures above." }

# A ledger added at the end of the Mapped TB (0.1.105): name, mapping at every level, adjustment; the statements follow; kept by a re-run of the mapping;
# refused cleanly (see tools\selftest-manual-ledger.mjs).
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-manual-ledger.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Manual-ledger self-test failed - not building. Fix the failures above." }

# Short-term borrowings Fill Details table agrees with the note on current maturities, CY and PY (0.1.108) - see tools\\selftest-stb-cm-details.mjs.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\\selftest-stb-cm-details.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Short-term borrowings details self-test failed - not building. Fix the failures above." }

# General Notes / Cash Flow Statement are the Consolidated ones for an Auditee with branches (0.1.109) - see tools\\selftest-consolidated-entity-level.mjs.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\\selftest-consolidated-entity-level.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Consolidated entity-level self-test failed - not building. Fix the failures above." }

# P&L note "Changes in inventories": Opening, Less: Closing and the Total only (0.1.111) - see tools\selftest-changes-in-inventories-rows.mjs.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-changes-in-inventories-rows.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Changes-in-inventories rows self-test failed - not building. Fix the failures above." }

# More than one window: New window, and a save telling the other windows (0.1.112) - see tools\selftest-multiwindow.mjs.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-multiwindow.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Multi-window self-test failed - not building. Fix the failures above." }

# Keyboard shortcuts follow the menu; Escape steps back (0.1.113) - see tools\selftest-keyboard-menu.mjs.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-keyboard-menu.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Keyboard-menu self-test failed - not building. Fix the failures above." }

# Net Credit Purchases working in the Annexures (0.1.114) - see tools\selftest-ratio-workings.mjs.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-ratio-workings.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Ratio-workings self-test failed - not building. Fix the failures above." }

# ITR BS / P&L / Details filled from the statements for every constitution (0.1.115) - see tools\selftest-itr-pull.mjs.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-itr-pull.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "ITR-pull self-test failed - not building. Fix the failures above." }

# Consolidated view: current year / previous year Trial Balances (0.1.118) - see tools\selftest-consolidation-years.mjs.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-consolidation-years.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Consolidation-years self-test failed - not building. Fix the failures above." }

# Features > Tax Computation (0.1.122) - see tools\selftest-tax-computation.mjs.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-tax-computation.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Tax-computation self-test failed - not building. Fix the failures above." }

# Features > Deferred Tax (0.1.125) - see tools\selftest-deferred-tax.mjs.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-deferred-tax.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Deferred-tax self-test failed - not building. Fix the failures above." }

# Auditor by denomination for a Company; note-number links (0.1.126) - see tools\selftest-signing-notelinks.mjs.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-signing-notelinks.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Signing / note-links self-test failed - not building. Fix the failures above." }

# Nature default Unsecured, considered good (0.1.127) - see tools\selftest-nature-default.mjs.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-nature-default.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Nature-default self-test failed - not building. Fix the failures above." }

# Busy Trial Balance parser + the five stock categories under Closing Stock (BS) (0.1.128) - see tools\selftest-busy-inventories.mjs.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-busy-inventories.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Busy / Inventories self-test failed - not building. Fix the failures above." }

# Disclosure notes in the Consolidated view (0.1.116) - see tools\selftest-entity-disclosure.mjs.
$ErrorActionPreference = 'Continue'
& node (Join-Path $root "tools\selftest-entity-disclosure.mjs")
$rc = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($rc -ne 0) { Fail "Entity-disclosure self-test failed - not building. Fix the failures above." }

# ── 2. Build ─────────────────────────────────────────────────────────────────
Step "Building (this takes ~2 minutes)"
$staging = Join-Path $root "dist-release"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }

$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& npm run build > (Join-Path $root "build-vite.log")
$rc = $LASTEXITCODE
$ErrorActionPreference = $prevEAP
if ($rc -ne 0) { Fail "npm run build failed (exit $rc). See build-vite.log." }

# --x64 is REQUIRED: this laptop is arm64, and electron-builder otherwise
# targets the host arch and silently produces an arm64 exe.
$ErrorActionPreference = 'Continue'
# The -c.… argument MUST be quoted. Unquoted, PowerShell splits it and
# electron-builder sees a bare "-c" followed by a filename, then dies with
# ENOENT on '.directories.output=dist-release'. Verified: quoted, the child
# process receives it as a single argv entry.
& npx electron-builder --win --x64 "-c.directories.output=dist-release" > (Join-Path $root "build-package.log")
$rc = $LASTEXITCODE
$ErrorActionPreference = $prevEAP
if ($rc -ne 0) { Fail "electron-builder failed (exit $rc). See build-package.log." }

$exe = Get-ChildItem $staging -Filter "*.exe" | Select-Object -First 1
if (-not $exe) { Fail "Build produced no .exe in $staging" }

# ── 3. Publish to dist\ ──────────────────────────────────────────────────────
Step "Publishing to dist\"
$distDir = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$final = Join-Path $distDir $exe.Name
Copy-Item $exe.FullName $final -Force
$hash = (Get-FileHash $final -Algorithm SHA256).Hash
Write-Host "   $($exe.Name)"
Write-Host "   SHA-256: $hash"

# ── 4. Snapshot the source that produced it ──────────────────────────────────
# This is the part that replaces git. An exe you cannot rebuild is an exe you
# cannot fix.
Step "Snapshotting source"
$relDir = Join-Path $root "releases"
New-Item -ItemType Directory -Force -Path $relDir | Out-Null
$zip = Join-Path $relDir "fsg-bharat-$Version-source.zip"

$inputs = @(
  "src", "package.json", "package-lock.json", "Mapping_v2.xlsx",
  "itr-templates", "Prescribed_Format_Reference.html",
  "electron.vite.config.mjs", "tailwind.config.js", "postcss.config.js"
) | Where-Object { Test-Path (Join-Path $root $_) } | ForEach-Object { Join-Path $root $_ }

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $inputs -DestinationPath $zip -CompressionLevel Optimal
Write-Host ("   {0} ({1:N1} MB)" -f (Split-Path $zip -Leaf), ((Get-Item $zip).Length / 1MB))

# ── 5. Record it ─────────────────────────────────────────────────────────────
Step "Recording in RELEASES.md"
$built = (Get-Date).ToString("yyyy-MM-dd HH:mm")
$row   = "| $Version | $built | ``$hash`` | $Notes |"
# -Encoding UTF8 is REQUIRED: without it PS 5.1 reads as ANSI and the
# rewrite below mangles every em dash in the file.
$lines = Get-Content $manifest -Encoding UTF8

# Append under the last row of the "## Releases" table SPECIFICALLY. Scanning
# the whole file for the last "| 0." line put 0.1.6 into the Variants table
# below it, because variant rows share that prefix.
$relIdx = -1
for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i].Trim() -eq '## Releases') { $relIdx = $i; break } }
if ($relIdx -lt 0) { Fail "Could not find the '## Releases' heading in RELEASES.md" }
$lastRow = -1
for ($i = $relIdx + 1; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^\| 0\.') { $lastRow = $i }
  elseif ($lines[$i] -match '^## ') { break }
}
if ($lastRow -lt 0) { Fail "Found '## Releases' but no release rows under it" }
$out = @(); $out += $lines[0..$lastRow]; $out += $row
if ($lastRow + 1 -lt $lines.Count) { $out += $lines[($lastRow + 1)..($lines.Count - 1)] }
[System.IO.File]::WriteAllLines($manifest, $out, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "  RELEASED $Version" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  exe      : dist\$($exe.Name)"
Write-Host "  sha256   : $hash"
Write-Host "  source   : releases\fsg-bharat-$Version-source.zip"
Write-Host ""
Write-Host "  NEXT:" -ForegroundColor Yellow
Write-Host "   1. Copy the exe to EVERY machine - they share one database," -ForegroundColor Yellow
Write-Host "      so a machine left behind writes bad data for everyone." -ForegroundColor Yellow
Write-Host "   2. On each machine run tools\Verify-Deployment.ps1 and check" -ForegroundColor Yellow
Write-Host "      the hash matches the line above." -ForegroundColor Yellow
Write-Host "   3. Update the Rollout table in RELEASES.md." -ForegroundColor Yellow
Write-Host "   4. Back up releases\ off this laptop." -ForegroundColor Yellow
Write-Host ""
