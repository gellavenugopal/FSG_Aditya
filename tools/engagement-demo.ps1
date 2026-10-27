param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('init', 'start-db', 'stop-db', 'status', 'provision-users', 'generate-uae-tbs', 'generate-ifrs-testbed-tbs', 'ifrs-cases-create-ui', 'ifrs-cases-reopen-ui', 'verify-ui', 'workflow-ui', 'reconcile-ui', 'finalize-ui', 'reopen-ui', 'uae-access-ui', 'uae-correct-output-ui', 'firm-settings-ui', 'firm-settings-reopen-ui', 'firm-settings-verify-master-ui', 'launch', 'epipe-ui')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$DemoHome = if ($env:FSG_DEMO_HOME) { [System.IO.Path]::GetFullPath($env:FSG_DEMO_HOME) } else {
  Join-Path $env:USERPROFILE 'FSG-Aditya-engagement-demo'
}
$ManifestPath = Join-Path $DemoHome 'target.json'
$CredentialsPath = Join-Path $DemoHome 'credentials.json'

function Read-DemoManifest {
  if (!(Test-Path -LiteralPath $ManifestPath) -or !(Test-Path -LiteralPath $CredentialsPath)) {
    throw "No isolated demo exists at $DemoHome. Run .\tools\engagement-demo.ps1 init first."
  }
  return @{
    Target = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    Credentials = Get-Content -LiteralPath $CredentialsPath -Raw | ConvertFrom-Json
  }
}

function Get-PostgresControl {
  $installRoot = 'C:\Program Files\PostgreSQL'
  $versions = Get-ChildItem -LiteralPath $installRoot -Directory | Where-Object {
    Test-Path -LiteralPath (Join-Path $_.FullName 'bin\pg_ctl.exe')
  } | Sort-Object { [double]$_.Name } -Descending
  if (!$versions) { throw 'PostgreSQL pg_ctl.exe was not found under C:\Program Files\PostgreSQL.' }
  return Join-Path $versions[0].FullName 'bin\pg_ctl.exe'
}

function Set-DisposableTestEnvironment($state) {
  $env:FSG_TEST_MODE = 'true'
  $env:FSG_TEST_DB_HOST = [string]$state.Credentials.host
  $env:FSG_TEST_DB_PORT = [string]$state.Credentials.port
  $env:FSG_TEST_DB_NAME = [string]$state.Credentials.database
  $env:FSG_TEST_DB_USER = [string]$state.Credentials.user
  $env:FSG_TEST_DB_PASSWORD = [string]$state.Credentials.password
  $env:FSG_TEST_TARGET_FILE = $ManifestPath
  $env:FSG_TEST_USER_DATA_PATH = [string]$state.Target.userDataPath
  $env:FSG_TEST_REMOTE_DEBUG_PORT = '9339'
  foreach ($key in @(
    'ENGAGEMENT_SERVICE_URL', 'ENGAGEMENT_DATABASE_URL', 'ENGAGEMENT_DB_HOST',
    'ENGAGEMENT_DB_PORT', 'ENGAGEMENT_DB_NAME', 'ENGAGEMENT_DB_USER', 'ENGAGEMENT_DB_PASSWORD'
  )) {
    Remove-Item "Env:$key" -ErrorAction SilentlyContinue
  }
}

function Wait-ForDemoDesktop {
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $attempt = $client.BeginConnect('127.0.0.1', 9339, $null, $null)
      if ($attempt.AsyncWaitHandle.WaitOne(500)) {
        $client.EndConnect($attempt)
        return
      }
    } catch {
    } finally {
      $client.Dispose()
    }
    Start-Sleep -Milliseconds 250
  }
  throw 'The isolated desktop DevTools endpoint did not become available within 60 seconds.'
}

switch ($Action) {
  'init' {
    if (Test-Path -LiteralPath $ManifestPath) { throw "Demo already exists at $DemoHome; it will not be replaced." }
    $env:FSG_DEMO_HOME = $DemoHome
    Push-Location $RepositoryRoot
    try {
      & node (Join-Path $RepositoryRoot 'tools\init-engagement-demo.mjs')
      if ($LASTEXITCODE -ne 0) { throw 'Disposable engagement environment initialization failed.' }
    } finally { Pop-Location }
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $grant = "$($identity):(OI)(CI)F"
    & icacls.exe $DemoHome /inheritance:r /grant:r $grant | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict demo credentials and files to the current Windows user.' }
    foreach ($file in @($ManifestPath, $CredentialsPath)) {
      & icacls.exe $file /inheritance:r /grant:r "$($identity):F" | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Could not restrict demo credential file ACL: $file" }
    }
    Write-Output "Isolated demo initialized at $DemoHome. Credentials are stored with current-user-only ACLs."
  }
  'start-db' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -eq 0) {
      Write-Output "Disposable PostgreSQL is already running on 127.0.0.1:$($state.Target.port)."
    } else {
      $logPath = Join-Path $DemoHome 'postgres.log'
      & $pgCtl -D $state.Target.dataDirectory -o "-h 127.0.0.1 -p $($state.Target.port) -c listen_addresses=127.0.0.1" -l $logPath -w start
      if ($LASTEXITCODE -ne 0) { throw 'Could not start the isolated PostgreSQL instance.' }
    }
  }
  'stop-db' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory -m fast -w stop
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the isolated PostgreSQL instance. Close the desktop application first.' }
  }
  'status' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status
    if ($LASTEXITCODE -ne 0) { throw 'The isolated PostgreSQL instance is not running.' }
    Write-Output "Target: $($state.Target.host):$($state.Target.port)/$($state.Target.database) as $($state.Target.user)"
    Write-Output "PostgreSQL data: $($state.Target.dataDirectory)"
    Write-Output "Electron userData: $($state.Target.userDataPath)"
  }
  'provision-users' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start the disposable database first with .\tools\engagement-demo.ps1 start-db.' }
    Set-DisposableTestEnvironment $state
    Push-Location $RepositoryRoot
    try {
      & node (Join-Path $RepositoryRoot 'tools\provision-engagement-demo-users.mjs')
      if ($LASTEXITCODE -ne 0) { throw 'Isolated demo account provisioning or authentication checks failed.' }
    } finally { Pop-Location }
  }
  'generate-uae-tbs' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start the disposable database first with .\tools\engagement-demo.ps1 start-db.' }
    Set-DisposableTestEnvironment $state
    Push-Location $RepositoryRoot
    try {
      & node (Join-Path $RepositoryRoot 'tools\generate-uae-demo-tbs.mjs')
      if ($LASTEXITCODE -ne 0) { throw 'Synthetic UAE demonstration Trial Balances could not be generated.' }
    } finally { Pop-Location }
  }
  'generate-ifrs-testbed-tbs' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start the disposable database first with .\tools\engagement-demo.ps1 start-db.' }
    Set-DisposableTestEnvironment $state
    Push-Location $RepositoryRoot
    try {
      & node (Join-Path $RepositoryRoot 'tools\generate-uae-ifrs-testbed-tbs.mjs')
      if ($LASTEXITCODE -ne 0) { throw 'Synthetic UAE IFRS test-bed Trial Balances could not be generated.' }
    } finally { Pop-Location }
  }
  'ifrs-cases-create-ui' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start the disposable database first with .\tools\engagement-demo.ps1 start-db.' }
    Set-DisposableTestEnvironment $state
    Wait-ForDemoDesktop
    Push-Location $RepositoryRoot
    try {
      & node (Join-Path $RepositoryRoot 'tools\selftest-engagement-demo-ifrs-cases.mjs') create
      if ($LASTEXITCODE -ne 0) { throw 'The isolated B/C test-bed engagement workflow failed.' }
    } finally { Pop-Location }
  }
  'ifrs-cases-reopen-ui' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start the disposable database first with .\tools\engagement-demo.ps1 start-db.' }
    Set-DisposableTestEnvironment $state
    Wait-ForDemoDesktop
    Push-Location $RepositoryRoot
    try {
      & node (Join-Path $RepositoryRoot 'tools\selftest-engagement-demo-ifrs-cases.mjs') reopen
      if ($LASTEXITCODE -ne 0) { throw 'The saved B/C engagement restart and reopening verification failed.' }
    } finally { Pop-Location }
  }
  'verify-ui' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start the disposable database first with .\tools\engagement-demo.ps1 start-db.' }
    Set-DisposableTestEnvironment $state
    Wait-ForDemoDesktop
    Push-Location $RepositoryRoot
    try {
      & node (Join-Path $RepositoryRoot 'tools\selftest-engagement-demo-ui.mjs')
      if ($LASTEXITCODE -ne 0) { throw 'UI-driven demo authentication checks failed.' }
    } finally { Pop-Location }
  }
  'workflow-ui' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start the disposable database first with .\tools\engagement-demo.ps1 start-db.' }
    Set-DisposableTestEnvironment $state
    Push-Location $RepositoryRoot
    try {
      & node (Join-Path $RepositoryRoot 'tools\selftest-engagement-demo-workflow.mjs')
      if ($LASTEXITCODE -ne 0) { throw 'Saved-engagement workflow UI verification failed.' }
    } finally { Pop-Location }
  }
  'reconcile-ui' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start the disposable database first with .\tools\engagement-demo.ps1 start-db.' }
    Set-DisposableTestEnvironment $state
    Wait-ForDemoDesktop
    Push-Location $RepositoryRoot
    try {
      & node (Join-Path $RepositoryRoot 'tools\selftest-engagement-demo-reconcile.mjs')
      if ($LASTEXITCODE -ne 0) { throw 'Reporting reconciliation UI verification failed.' }
    } finally { Pop-Location }
  }
  'finalize-ui' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start the disposable database first with .\tools\engagement-demo.ps1 start-db.' }
    Set-DisposableTestEnvironment $state
    Push-Location $RepositoryRoot
    try {
      & node (Join-Path $RepositoryRoot 'tools\selftest-engagement-demo-finalization.mjs')
      if ($LASTEXITCODE -ne 0) { throw 'Saved-engagement finalisation UI verification failed.' }
    } finally { Pop-Location }
  }
  'reopen-ui' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start the disposable database first with .\tools\engagement-demo.ps1 start-db.' }
    Set-DisposableTestEnvironment $state
    Wait-ForDemoDesktop
    Push-Location $RepositoryRoot
    try {
      & node (Join-Path $RepositoryRoot 'tools\selftest-engagement-demo-reopen.mjs')
      if ($LASTEXITCODE -ne 0) { throw 'Saved-engagement restart UI verification failed.' }
    } finally { Pop-Location }
  }
  'uae-access-ui' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start the disposable database first with .\tools\engagement-demo.ps1 start-db.' }
    Set-DisposableTestEnvironment $state
    Wait-ForDemoDesktop
    Push-Location $RepositoryRoot
    try {
      & node (Join-Path $RepositoryRoot 'tools\selftest-engagement-demo-uae-access.mjs')
      if ($LASTEXITCODE -ne 0) { throw 'Isolated UAE engagement access and saved-PDF download verification failed.' }
    } finally { Pop-Location }
  }
  'uae-correct-output-ui' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start the disposable database first with .\tools\engagement-demo.ps1 start-db.' }
    Set-DisposableTestEnvironment $state
    Wait-ForDemoDesktop
    Push-Location $RepositoryRoot
    try {
      & node (Join-Path $RepositoryRoot 'tools\selftest-engagement-demo-uae-corrected-output.mjs')
      if ($LASTEXITCODE -ne 0) { throw 'UAE Sample 01 corrected report generation and download verification failed.' }
    } finally { Pop-Location }
  }
  'firm-settings-ui' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start the disposable database first with .\tools\engagement-demo.ps1 start-db.' }
    Set-DisposableTestEnvironment $state
    Wait-ForDemoDesktop
    Push-Location $RepositoryRoot
    try {
      & node (Join-Path $RepositoryRoot 'tools\selftest-engagement-demo-firm-settings.mjs')
      if ($LASTEXITCODE -ne 0) { throw 'Firm Settings and reporting identity UI verification failed.' }
    } finally { Pop-Location }
  }
  'firm-settings-reopen-ui' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start the disposable database first with .\tools\engagement-demo.ps1 start-db.' }
    Set-DisposableTestEnvironment $state
    Wait-ForDemoDesktop
    Push-Location $RepositoryRoot
    try {
      & node (Join-Path $RepositoryRoot 'tools\selftest-engagement-demo-firm-settings.mjs') reopen
      if ($LASTEXITCODE -ne 0) { throw 'Firm Settings and saved report restart verification failed.' }
    } finally { Pop-Location }
  }
  'firm-settings-verify-master-ui' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start the disposable database first with .\tools\engagement-demo.ps1 start-db.' }
    Set-DisposableTestEnvironment $state
    Wait-ForDemoDesktop
    Push-Location $RepositoryRoot
    try {
      & node (Join-Path $RepositoryRoot 'tools\selftest-engagement-demo-firm-settings.mjs') verify-master
      if ($LASTEXITCODE -ne 0) { throw 'Firm master immutability UI verification failed.' }
    } finally { Pop-Location }
  }
  'launch' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start the disposable database first with .\tools\engagement-demo.ps1 start-db.' }
    Set-DisposableTestEnvironment $state
    Push-Location $RepositoryRoot
    try {
      npm run dev
      if ($LASTEXITCODE -ne 0) { throw 'Desktop application exited with an error.' }
    } finally { Pop-Location }
  }
  'epipe-ui' {
    $state = Read-DemoManifest
    $pgCtl = Get-PostgresControl
    & $pgCtl -D $state.Target.dataDirectory status *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start the disposable database first with .\tools\engagement-demo.ps1 start-db.' }
    $electronViteCli = Join-Path $RepositoryRoot 'node_modules\electron-vite\bin\electron-vite.js'
    $devLauncher = Join-Path $RepositoryRoot 'tools\dev-launcher.mjs'
    $electronExecutable = Join-Path $RepositoryRoot 'node_modules\electron\dist\electron.exe'
    $activeDevelopmentProcesses = Get-CimInstance Win32_Process | Where-Object {
      $_.CommandLine -and (
        $_.CommandLine.Contains($electronViteCli) -or
        $_.CommandLine.Contains($devLauncher) -or
        $_.ExecutablePath -eq $electronExecutable
      )
    }
    if ($activeDevelopmentProcesses) {
      $activeDevelopmentProcesses | Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine | Format-List
      throw 'Close all existing development processes from this checkout before starting the EPIPE verification.'
    }
    Set-DisposableTestEnvironment $state
    Push-Location $RepositoryRoot
    try {
      & node (Join-Path $RepositoryRoot 'tools\selftest-dev-launcher-disconnect.mjs')
      if ($LASTEXITCODE -ne 0) { throw 'Isolated launcher output-disconnect verification failed.' }
    } finally { Pop-Location }
  }
}
