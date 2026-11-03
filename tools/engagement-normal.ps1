<#
.SYNOPSIS
  Launches the current source against the NORMAL firm profile (%APPDATA%\fsg-bharat) and stops at sign-in.

.DESCRIPTION
  Separate from tools\engagement-demo.ps1 (UAT). It never selects the isolated profile:
    - refuses to start while any FSG_TEST_* or ENGAGEMENT_SERVICE_* variable is inherited, instead of silently using or clearing it;
    - refuses to start while another FSG window is running (UAT or normal), so two profiles are never open together;
    - requires a non-empty pg_dump backup of the normal database that is less than 24 hours old (see -BackupFolder);
    - sets FSG_STARTUP_DATA_REWRITES=off so startup does not reseed mapping rules or rewrite mapped ledgers.
  The environment badge is not changed; with no profile identity marker it remains Unverified.
  Passwords are never read or printed.
#>
param(
  [string]$BackupFolder = 'D:\Programs\FinancialStatements\AdityaTool\FSG-normal-backups',
  [int]$MaxBackupAgeHours = 24,
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$normalProfile = Join-Path $env:APPDATA 'fsg-bharat'

$inherited = Get-ChildItem Env: | Where-Object { $_.Name -match '^(FSG_TEST_|FSG_DEMO_|ENGAGEMENT_SERVICE_)' } | Select-Object -ExpandProperty Name
if ($inherited) {
  throw "Refusing to launch the normal profile: these variables are set in this shell and could select UAT or another service: $($inherited -join ', '). Open a clean terminal."
}

if (-not (Test-Path (Join-Path $normalProfile 'db-config.json'))) {
  throw "Normal profile configuration was not found at $normalProfile."
}

$backup = Get-ChildItem $BackupFolder -Filter 'vera_financial-*.dump' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $backup -or $backup.Length -le 0) { throw "No normal-database backup was found in $BackupFolder." }
if ($backup.LastWriteTime -lt (Get-Date).AddHours(-$MaxBackupAgeHours)) {
  throw "The newest backup ($($backup.Name)) is older than $MaxBackupAgeHours hours. Create a fresh pg_dump backup first."
}
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$toc = & 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe' --list $backup.FullName 2>$null
$listExit = $LASTEXITCODE
$ErrorActionPreference = $previousPreference
if ($listExit -ne 0) { throw "Backup $($backup.Name) could not be listed by pg_restore." }

$running = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -like "*$repositoryRoot*" -and $_.CommandLine -notmatch '--type=' }
if ($running) {
  throw "Another FSG window is running (PID $($running.ProcessId -join ', ')). Close it normally first; this launcher does not stop applications."
}

Write-Host "Profile : $normalProfile"
Write-Host "Backup  : $($backup.FullName) ($($backup.Length) bytes, $(@($toc).Count) TOC lines, $($backup.LastWriteTime))"
Write-Host 'Mode    : normal firm profile; startup data rewrites OFF; environment badge stays Unverified'
if ($CheckOnly) { Write-Host 'CheckOnly: all pre-launch checks passed; nothing was started.'; return }

$env:FSG_STARTUP_DATA_REWRITES = 'off'
Set-Location $repositoryRoot
npm run dev
