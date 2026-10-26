param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Open', 'Save')]
  [string]$Action,
  [Parameter(Mandatory = $true)]
  [string]$DialogTitle,
  [Parameter(Mandatory = $true)]
  [string]$FilePath,
  [Parameter(Mandatory = $true)]
  [string]$DemoHome,
  [Parameter(Mandatory = $true)]
  [string]$UserDataPath,
  [Parameter(Mandatory = $true)]
  [string]$RepositoryRoot
)

$ErrorActionPreference = 'Stop'
if ([System.Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
  throw 'Run the isolated file-dialog helper in STA mode.'
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$resolvedDemoHome = [System.IO.Path]::GetFullPath($DemoHome).TrimEnd('\')
$resolvedPath = [System.IO.Path]::GetFullPath($FilePath)
$resolvedUserData = [System.IO.Path]::GetFullPath($UserDataPath).TrimEnd('\')
$resolvedRepository = [System.IO.Path]::GetFullPath($RepositoryRoot).TrimEnd('\')
if (!$resolvedPath.StartsWith("$resolvedDemoHome\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'The selected demo file must stay inside the isolated demo directory.'
}
if ($Action -eq 'Open' -and !(Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
  throw 'The selected synthetic workbook does not exist.'
}
if ($Action -eq 'Save' -and (Test-Path -LiteralPath $resolvedPath)) {
  throw 'Refusing to overwrite an existing demo output.'
}

$processes = @(Get-CimInstance Win32_Process)
$renderer = $processes | Where-Object {
  $_.ExecutablePath -like "$resolvedRepository\node_modules\electron\dist\electron.exe" -and
  $_.CommandLine -like '*--type=renderer*' -and
  $_.CommandLine -like "*--user-data-dir=`"$resolvedUserData`"*"
} | Select-Object -First 1
if (!$renderer) { throw 'Could not verify the isolated Electron renderer profile.' }
$main = $processes | Where-Object { $_.ProcessId -eq $renderer.ParentProcessId } | Select-Object -First 1
if (!$main -or $main.ExecutablePath -ne "$resolvedRepository\node_modules\electron\dist\electron.exe") {
  throw 'Could not verify that the isolated Electron main process owns the file dialog.'
}

if (-not ('EngagementDemoWindowNative' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class EngagementDemoWindowNative {
  public delegate bool EnumWindowsProc(IntPtr window, IntPtr state);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr state);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int maxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, string lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}
'@
}

$dialogHandle = [IntPtr]::Zero
$fileNameEdit = [IntPtr]::Zero
$openButton = [IntPtr]::Zero
$dialogProcessId = [uint32]$main.ProcessId
$deadline = [DateTime]::UtcNow.AddSeconds(30)
while ([DateTime]::UtcNow -lt $deadline -and $dialogHandle -eq [IntPtr]::Zero) {
  $windows = [System.Collections.Generic.List[IntPtr]]::new()
  $callback = [EngagementDemoWindowNative+EnumWindowsProc]{
    param([IntPtr]$window, [IntPtr]$state)
    if (![EngagementDemoWindowNative]::IsWindowVisible($window)) { return $true }
    $title = [System.Text.StringBuilder]::new(512)
    $className = [System.Text.StringBuilder]::new(128)
    [void][EngagementDemoWindowNative]::GetWindowText($window, $title, $title.Capacity)
    [void][EngagementDemoWindowNative]::GetClassName($window, $className, $className.Capacity)
    [uint32]$owner = 0
    [void][EngagementDemoWindowNative]::GetWindowThreadProcessId($window, [ref]$owner)
    if (($owner -eq $dialogProcessId) -and ($className.ToString() -eq '#32770') -and ($title.ToString() -eq $DialogTitle)) {
      $windows.Add($window)
    }
    return $true
  }
  [void][EngagementDemoWindowNative]::EnumWindows($callback, [IntPtr]::Zero)
  if ($windows.Count -gt 0) { $dialogHandle = $windows[0] }
  else { Start-Sleep -Milliseconds 200 }
}
if ($dialogHandle -eq [IntPtr]::Zero) { throw 'The expected isolated-app file dialog did not appear.' }

[void][EngagementDemoWindowNative]::ShowWindow($dialogHandle, 9)
[void][EngagementDemoWindowNative]::SetForegroundWindow($dialogHandle)
$script:fileNameEdit = [IntPtr]::Zero
$script:openButton = [IntPtr]::Zero
$script:fileNameFallback = [IntPtr]::Zero
$script:buttonFallback = [IntPtr]::Zero
$controlCallback = [EngagementDemoWindowNative+EnumWindowsProc]{
  param([IntPtr]$window, [IntPtr]$state)
  $className = [System.Text.StringBuilder]::new(128)
  [void][EngagementDemoWindowNative]::GetClassName($window, $className, $className.Capacity)
  $controlId = [EngagementDemoWindowNative]::GetDlgCtrlID($window)
  $text = [System.Text.StringBuilder]::new(256)
  [void][EngagementDemoWindowNative]::GetWindowText($window, $text, $text.Capacity)
  if ($className.ToString() -eq 'Edit' -and $controlId -ne 41477) {
    if ($controlId -eq 1148) { $script:fileNameEdit = $window }
    elseif ($controlId -ne 0) { $script:fileNameFallback = $window }
  } elseif ($className.ToString() -eq 'Button') {
    if ($text.ToString() -match '^(?:&)?(?:Save|Open)$') { $script:openButton = $window }
    elseif ($controlId -eq 1) { $script:buttonFallback = $window }
  }
  return $true
}
[void][EngagementDemoWindowNative]::EnumChildWindows($dialogHandle, $controlCallback, [IntPtr]::Zero)
if ($script:fileNameEdit -eq [IntPtr]::Zero) { $script:fileNameEdit = $script:fileNameFallback }
if ($script:openButton -eq [IntPtr]::Zero) { $script:openButton = $script:buttonFallback }
if ($script:fileNameEdit -eq [IntPtr]::Zero -or $script:openButton -eq [IntPtr]::Zero) { throw 'Could not resolve the verified file-name field and action button.' }
[void][EngagementDemoWindowNative]::SendMessage($script:fileNameEdit, 0x000C, [IntPtr]::Zero, $resolvedPath)
$fileNameElement = [System.Windows.Automation.AutomationElement]::FromHandle($script:fileNameEdit)
if ($fileNameElement.Current.Name -ne $resolvedPath) { throw 'The isolated file dialog did not accept the requested demo file path.' }
[void][EngagementDemoWindowNative]::SendMessage($script:openButton, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)

$deadline = [DateTime]::UtcNow.AddSeconds(30)
while ([DateTime]::UtcNow -lt $deadline) {
  if (![EngagementDemoWindowNative]::IsWindowVisible($dialogHandle)) { exit 0 }
  Start-Sleep -Milliseconds 200
}
throw 'The isolated-app file dialog did not close after selecting the demo file.'
