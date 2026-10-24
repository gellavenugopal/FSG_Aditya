# End-to-end test of the Learned Ledger Rules cycle through the REAL main-process
# handlers (Electron stubbed) against THIS machine's configured database.
#   powershell -ExecutionPolicy Bypass -File tools\e2e-learned-rules\Run-E2E.ps1
# It reads 'Aditya Maheshwari & Co.' (any entity with custom Level-2 rules will do —
# edit SRC_NAME in e2e_branch_column.mjs), creates three throw-away entities named
# "ZZ E2E ...", runs upload -> Auto-Mapping -> download -> upload-into-another-
# company -> re-run, asserts every custom line survives, and deletes the
# throw-away entities. Not part of Release.ps1 because it writes to the database.
# The DB password is unwrapped in-process via DPAPI (never printed) and the key
# file is deleted afterwards.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent (Split-Path -Parent $here)
$k = Join-Path $here 'k.tmp'
Add-Type -AssemblyName System.Security
$ls = Get-Content "$env:APPDATA\fsg-bharat\Local State" -Raw | ConvertFrom-Json
$enc = [Convert]::FromBase64String($ls.os_crypt.encrypted_key); $enc = $enc[5..($enc.Length-1)]
$key = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, 'CurrentUser')
[IO.File]::WriteAllText($k, [Convert]::ToBase64String($key))
$env:E2E_KEY_FILE = $k
Set-Location $root
try {
  & node --import "./tools/e2e-learned-rules/register.mjs" "./tools/e2e-learned-rules/e2e_branch_column.mjs"
  $rc = $LASTEXITCODE
} finally {
  if (Test-Path $k) { [IO.File]::Delete($k) }
  Remove-Item Env:E2E_KEY_FILE -ErrorAction SilentlyContinue
}
exit $rc
