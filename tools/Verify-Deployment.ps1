<#
  FSG Bharat — what is actually installed on THIS machine?

  Answers, by evidence rather than by filename:
    * which exe files are present, and their real SHA-256
    * which release each one is (matched against RELEASES.md)
    * whether an older build is still being launched
    * whether the database this machine talks to has the newest schema

  Copy this file (and RELEASES.md) alongside the exe, then run on the machine
  in question:

      powershell -ExecutionPolicy Bypass -File Verify-Deployment.ps1

  Point it somewhere specific with -AppDir:

      powershell -ExecutionPolicy Bypass -File Verify-Deployment.ps1 -AppDir "C:\FSG Bharat"
#>

param(
  [string]$AppDir,
  [string]$Manifest
)

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  FSG Bharat - deployment check on $env:COMPUTERNAME" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# ── Locate things ────────────────────────────────────────────────────────────
if (-not $AppDir) {
  $guesses = @($PSScriptRoot, (Split-Path -Parent $PSScriptRoot),
                (Join-Path (Split-Path -Parent $PSScriptRoot) "dist"),
                "C:\FSG Bharat", "$env:USERPROFILE\Desktop")
  $AppDir = $guesses | Where-Object { $_ -and (Test-Path $_) -and
              (Get-ChildItem $_ -Filter "FSG Bharat*.exe" -ErrorAction SilentlyContinue) } |
              Select-Object -First 1
}
if (-not $AppDir) {
  Write-Host "`n  No 'FSG Bharat*.exe' found. Pass -AppDir with the folder holding the exe.`n" -ForegroundColor Red
  exit 1
}

if (-not $Manifest) {
  $Manifest = @((Join-Path $PSScriptRoot "..\RELEASES.md"),
                (Join-Path $PSScriptRoot "RELEASES.md"),
                (Join-Path $AppDir "RELEASES.md")) |
              Where-Object { Test-Path $_ } | Select-Object -First 1
}

$known = @{}
if ($Manifest -and (Test-Path $Manifest)) {
  foreach ($line in Get-Content $Manifest) {
    $m = [regex]::Match($line, '^\|\s*(\d+\.\d+\.\d+)\s*\|\s*([^|]*?)\s*\|\s*`([A-Fa-f0-9]{64})`')
    if ($m.Success) { $known[$m.Groups[3].Value.ToUpper()] = @{ Version = $m.Groups[1].Value; Built = $m.Groups[2].Value.Trim() } }
  }
  Write-Host "`n  manifest : $((Resolve-Path $Manifest).Path)  ($($known.Count) known releases)"
} else {
  Write-Host "`n  manifest : NOT FOUND - cannot name the builds, only hash them" -ForegroundColor Yellow
}
Write-Host "  app dir  : $AppDir"

# ── 1. What is on disk ───────────────────────────────────────────────────────
Write-Host "`n1. Executables present"
$exes = Get-ChildItem $AppDir -Filter "FSG Bharat*.exe" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime
if (-not $exes) { Write-Host "   none found" -ForegroundColor Red }
foreach ($e in $exes) {
  $h = (Get-FileHash $e.FullName -Algorithm SHA256).Hash.ToUpper()
  $tag = if ($known.ContainsKey($h)) { "release $($known[$h].Version)" } else { "UNKNOWN BUILD - not in RELEASES.md" }
  $col = if ($known.ContainsKey($h)) { "Green" } else { "Yellow" }
  Write-Host ("   {0,-26} v{1,-7} {2}" -f $e.Name, $e.VersionInfo.FileVersion, $tag) -ForegroundColor $col
  Write-Host ("       sha256 {0}" -f $h) -ForegroundColor DarkGray
  if ($known.ContainsKey($h) -and $known[$h].Version -ne $e.VersionInfo.FileVersion) {
    Write-Host "       WARNING: filename/metadata says $($e.VersionInfo.FileVersion) but the bytes are $($known[$h].Version)" -ForegroundColor Red
  }
}

# ── 2. What is actually RUNNING ──────────────────────────────────────────────
# The whole point: a new exe can be copied while an old one is still launched
# from a shortcut, a pinned taskbar entry, or another folder entirely.
Write-Host "`n2. Currently running"
$procs = Get-Process | Where-Object { $_.ProcessName -like "FSG*" }
if (-not $procs) {
  Write-Host "   nothing running"
} else {
  $paths = $procs | ForEach-Object { try { $_.Path } catch { $null } } | Where-Object { $_ } | Select-Object -Unique
  foreach ($p in $paths) {
    $ver = (Get-Item $p).VersionInfo.FileVersion
    Write-Host "   $ver  <-  $p"
    if ($p -notlike "$AppDir*" -and $p -notlike "*\Temp\*") {
      Write-Host "       WARNING: launched from OUTSIDE $AppDir - a stale copy may be in use" -ForegroundColor Red
    }
  }
  Write-Host "   (a portable exe unpacks to %TEMP%, so a Temp path here is normal)" -ForegroundColor DarkGray
}

# ── 3. Which database, and is its schema current ─────────────────────────────
Write-Host "`n3. Database this machine points at"
$cfgPath = Join-Path $env:APPDATA "fsg-bharat\db-config.json"
if (-not (Test-Path $cfgPath)) {
  Write-Host "   no db-config.json - the app has not been configured on this machine yet"
} else {
  $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
  Write-Host "   $($cfg.host):$($cfg.port)  db=$($cfg.database)  user=$($cfg.user)"

  $psql = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
          Select-Object -Last 1
  if (-not $psql) {
    Write-Host "   psql not installed here (normal on a client) - skipping schema check" -ForegroundColor DarkGray
    Write-Host "   Run the schema check on the SERVER, or use Diagnose_Opening_Stock.sql" -ForegroundColor DarkGray
  } else {
    # -w / --no-password: NEVER prompt. Without it psql blocks forever waiting
    # on a password when this runs from a script, a scheduled task, or any
    # non-interactive shell - the check would hang instead of reporting.
    # It still succeeds silently when a pgpass file or $env:PGPASSWORD exists.
    # If it needs a password, print the one-liner to re-run interactively —
    # never prompt for or handle the password inside this script.
    $pw = $null
    $runPsql = {
      param($sql, $fmt = '-tAc')
      & $psql.FullName -w -h $cfg.host -p $cfg.port -U $cfg.user -d $cfg.database $fmt $sql 2>&1
    }
    $probe = $runPsql.Invoke("SELECT 1;")
    if ("$probe" -match 'password') {
      Write-Host "   needs a password - re-run interactively with:" -ForegroundColor Yellow
      Write-Host ""
      Write-Host "     `$env:PGPASSWORD = Read-Host 'DB password' -AsSecureString | ConvertFrom-SecureString -AsPlainText" -ForegroundColor Gray
      Write-Host "     powershell -ExecutionPolicy Bypass -File Verify-Deployment.ps1" -ForegroundColor Gray
      Write-Host ""
      Write-Host "   (or set `$env:PGPASSWORD yourself for this session only, then re-run)" -ForegroundColor Yellow
    } else {
      Write-Host "   checking schema..."

      # 0.1.4 marker (kept for a very old install where schema_migrations
      # itself doesn't exist yet).
      $res = $runPsql.Invoke("SELECT count(*) FROM information_schema.columns WHERE table_name='trial_balances' AND column_name='tally_opening_stock_total';")
      if ($res -match '^\s*1\s*$') {
        Write-Host "   0.1.4+ marker present (tally_opening_stock_total)" -ForegroundColor Green
      } else {
        Write-Host "   0.1.4+ marker ABSENT - no build newer than 0.1.3 has ever started against this database" -ForegroundColor Red
      }

      # 0.1.22+ marker — the newest additive column as of this writing.
      $res2 = $runPsql.Invoke("SELECT count(*) FROM information_schema.columns WHERE table_name='learned_ledger_rules' AND column_name='source_branch_name';")
      if ($res2 -match '^\s*1\s*$') {
        Write-Host "   0.1.22+ marker present (learned_ledger_rules.source_branch_name)" -ForegroundColor Green
      } else {
        Write-Host "   0.1.22+ marker ABSENT - this DB has not yet been touched by 0.1.22/0.1.23" -ForegroundColor Yellow
      }

      # Everything 0.1.89 - 0.1.125 added to the database. All of it is created by the FIRST start of the new exe against this
      # database (src/main/db/schema.js, run once under a global lock; nobody has to run any SQL). If any line below says MISSING,
      # no new exe has started against this database yet.
      Write-Host "`n   Database changes of 0.1.89 - 0.1.122 (created by the first start of the new exe):"
      $needed = @(
        @{ What = 'column tb_rows.adj_debit              (Mapped TB Adjustments, 0.1.89)';       Sql = "SELECT count(*) FROM information_schema.columns WHERE table_name='tb_rows' AND column_name='adj_debit';" },
        @{ What = 'column tb_rows.adj_credit             (Mapped TB Adjustments, 0.1.89)';       Sql = "SELECT count(*) FROM information_schema.columns WHERE table_name='tb_rows' AND column_name='adj_credit';" },
        @{ What = 'column tb_rows.imported_closing_balance (Revised Clos Bal, 0.1.90)';          Sql = "SELECT count(*) FROM information_schema.columns WHERE table_name='tb_rows' AND column_name='imported_closing_balance';" },
        @{ What = 'table  tb_adjustment_log              (Adjustments log, 0.1.90)';             Sql = "SELECT count(*) FROM information_schema.tables WHERE table_name='tb_adjustment_log';" },
        @{ What = 'check  tb_rows_adjusted_closing_chk, validated (0.1.90)';                     Sql = "SELECT count(*) FROM pg_constraint WHERE conname='tb_rows_adjusted_closing_chk' AND convalidated;" },
        @{ What = 'column entity_periods.py_mode         (Previous Year figures choice, 0.1.91)'; Sql = "SELECT count(*) FROM information_schema.columns WHERE table_name='entity_periods' AND column_name='py_mode';" },
        @{ What = 'column tb_rows.stock_head             (Other-expenses head of Stores & Spares stock, 0.1.93)'; Sql = "SELECT count(*) FROM information_schema.columns WHERE table_name='tb_rows' AND column_name='stock_head';" },
        @{ What = 'table  cash_flow_entries              (Cash Flow Statement entries, 0.1.95)';  Sql = "SELECT count(*) FROM information_schema.tables WHERE table_name='cash_flow_entries';" },
        @{ What = 'column entities.pan                   (PAN of the auditee, 0.1.96)';            Sql = "SELECT count(*) FROM information_schema.columns WHERE table_name='entities' AND column_name='pan';" },
        @{ What = 'column entity_periods.is_final        (Final copy flag, 0.1.97)';              Sql = "SELECT count(*) FROM information_schema.columns WHERE table_name='entity_periods' AND column_name='is_final';" },
        @{ What = 'column entity_periods.final_sign_date (Final Place / Date of Signing, 0.1.97)'; Sql = "SELECT count(*) FROM information_schema.columns WHERE table_name='entity_periods' AND column_name='final_sign_date';" },
        @{ What = 'table  fs_snapshots                   (figures published for Cloudtail MCA, 0.1.101)'; Sql = "SELECT count(*) FROM information_schema.tables WHERE table_name='fs_snapshots';" },
        @{ What = 'level format Short-term loans and advances / Advance to Suppliers (0.1.102)'; Sql = "SELECT count(*) FROM level_format WHERE level2='Short-term loans and advances' AND level3='Advance to Suppliers';" },
        @{ What = 'table  entity_note_disclosures        (disclosure notes of the Consolidated view, 0.1.116)'; Sql = "SELECT count(*) FROM information_schema.tables WHERE table_name='entity_note_disclosures';" }
        @{ What = 'table  tax_computations               (Features > Tax Computation, 0.1.122)'; Sql = "SELECT count(*) FROM information_schema.tables WHERE table_name='tax_computations';" }
        @{ What = 'table  deferred_tax_computations      (Features > Deferred Tax, 0.1.125)'; Sql = "SELECT count(*) FROM information_schema.tables WHERE table_name='deferred_tax_computations';" },
        @{ What = 'column auditor_firms.pan              (optional PAN / address / e-mail of the firm, 0.1.136)'; Sql = "SELECT count(*) FROM information_schema.columns WHERE table_name='auditor_firms' AND column_name='pan';" },
        @{ What = 'column global_signatories.email       (optional address / e-mail of the signing partner, 0.1.136)'; Sql = "SELECT count(*) FROM information_schema.columns WHERE table_name='global_signatories' AND column_name='email';" },
        @{ What = 'column global_signatories.membership_category (Associate / Fellow, 0.1.137)'; Sql = "SELECT count(*) FROM information_schema.columns WHERE table_name='global_signatories' AND column_name='membership_category';" },
        @{ What = 'column auditors.membership_category   (Associate / Fellow, 0.1.137)'; Sql = "SELECT count(*) FROM information_schema.columns WHERE table_name='auditors' AND column_name='membership_category';" }
      )
      $missing = 0
      foreach ($n in $needed) {
        $v = "$($runPsql.Invoke($n.Sql))".Trim()
        if ($v -match '^\s*1\s*$') { Write-Host ("     present  {0}" -f $n.What) -ForegroundColor Green }
        else { $missing++; Write-Host ("     MISSING  {0}" -f $n.What) -ForegroundColor Red }
      }
      if ($missing -eq 0) {
        Write-Host "   -> every database change up to 0.1.102 is in effect on this database." -ForegroundColor Green
      } else {
        Write-Host "   -> $missing change(s) missing. Start the new exe ONCE against this database (close the app on every other PC first;" -ForegroundColor Yellow
        Write-Host "      it applies them itself, normally in a few seconds), then run this check again." -ForegroundColor Yellow
      }

      # schema_migrations: exact record of every one-time (data-affecting,
      # not just additive) migration this database has already run. Its
      # ABSENCE means a build old enough to predate tryClaimMigration itself
      # (see src/main/db/schema.js) — i.e. well before the Mapping v3
      # workbook adoption.
      $migTable = $runPsql.Invoke("SELECT count(*) FROM information_schema.tables WHERE table_name='schema_migrations';")
      if ($migTable -match '^\s*1\s*$') {
        # psql -tAc returns one row per array element when there are several,
        # but a single PLAIN STRING when there's exactly one row (or none) —
        # @(...) coerces either shape into a real array so this works both
        # ways. (Interpolating an array straight into a string, "$keys", joins
        # it with a SPACE, not a newline — splitting on "`n" afterwards did
        # nothing and printed every key crammed onto one line.)
        $keys = $runPsql.Invoke("SELECT key FROM schema_migrations ORDER BY key;")
        $keyList = @($keys) | Where-Object { $_ -and $_.ToString().Trim() }
        Write-Host "   schema_migrations (one-time migrations already applied here):"
        if ($keyList.Count -gt 0) { $keyList | ForEach-Object { Write-Host "     - $($_.ToString().Trim())" } }
        else { Write-Host "     (none yet)" -ForegroundColor Yellow }
        $hasCaptions = ($keyList -join ' ') -match 'mapping_v3_captions'
        if ($hasCaptions) {
          Write-Host "   -> the CA-reviewed caption rename (Mapping v3) has ALREADY run here." -ForegroundColor Green
          Write-Host "      Starting a newer build now will be purely additive (new columns/tables/indexes only)." -ForegroundColor Green
        } else {
          Write-Host "   -> the CA-reviewed caption rename (Mapping v3) has NOT run here yet." -ForegroundColor Yellow
          Write-Host "      Starting a newer build for the first time will ALSO run it once (renames existing" -ForegroundColor Yellow
          Write-Host "      mapped_tb/learned_ledger_rules caption text to match the reviewed workbook -" -ForegroundColor Yellow
          Write-Host "      no rows added or removed). Back up first; see RELEASES.md's deployment note." -ForegroundColor Yellow
        }
      } else {
        Write-Host "   schema_migrations table does not exist - this database predates ALL one-time migrations" -ForegroundColor Red
        Write-Host "   (i.e. well before 0.1.10). Launching the new exe will run several in sequence. Back up first." -ForegroundColor Red
      }

      # Row-count baseline — save this output BEFORE upgrading and compare it
      # AFTER. Every one of these must be IDENTICAL; only column VALUES in
      # mapped_tb / learned_ledger_rules may change (the caption rename
      # above), never row counts.
      Write-Host "`n   Row-count baseline (save this; compare after upgrading):"
      foreach ($t in @('entities','trial_balances','tb_rows','mapped_tb','learned_ledger_rules')) {
        $c = $runPsql.Invoke("SELECT count(*) FROM $t;")
        Write-Host ("     {0,-22} {1}" -f $t, "$c".Trim())
      }
    }
  }
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "  Record the result in the Rollout table of RELEASES.md." -ForegroundColor Cyan
Write-Host "==========================================================`n" -ForegroundColor Cyan
