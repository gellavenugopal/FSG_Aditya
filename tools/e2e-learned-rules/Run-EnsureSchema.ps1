$ErrorActionPreference = 'Stop'
$root = "C:\Users\Aditya Maheshwari\Desktop\JE_Financial_App"
$here = Join-Path $root "tools\e2e-learned-rules"
$k = Join-Path $here 'k.tmp'
Add-Type -AssemblyName System.Security
$ls = Get-Content "$env:APPDATA\fsg-bharat\Local State" -Raw | ConvertFrom-Json
$enc = [Convert]::FromBase64String($ls.os_crypt.encrypted_key); $enc = $enc[5..($enc.Length-1)]
$key = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, 'CurrentUser')
[IO.File]::WriteAllText($k, [Convert]::ToBase64String($key))
$env:E2E_KEY_FILE = $k
Set-Location $root
try {
  & node --import "./tools/e2e-learned-rules/register.mjs" "./tools/e2e-learned-rules/ensure_schema.mjs"
  $rc = $LASTEXITCODE
} finally {
  if (Test-Path $k) { [IO.File]::Delete($k) }
  Remove-Item Env:E2E_KEY_FILE -ErrorAction SilentlyContinue
}
exit $rc
