# CHOMPI bridge UI Automation helper, protocol 1. Windows PowerShell 5.1, started by uia-helper.ts.
# Read-only: it never sends input, clicks, focuses or invokes a control pattern.
# One JSON request per stdin line; one JSON reply per stdout line. Replies carry only booleans, counts,
# package versions and fixed reason codes, never names, values or other text read from a window.
# The selectors below were established read-only; see UIA-NOTES.md.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$EditId = [System.Windows.Automation.ControlType]::Edit.Id
$Ordinal = [System.StringComparison]::Ordinal
$Packages = [ordered]@{ codex = 'OpenAI.Codex_2p2nqsd0c76g0'; claude = 'Claude_pzs8sxrjxfjjc' }
$CodexRowPrefix = 'group relative cursor-interaction'
$CodexSelectedToken = 'bg-primary-ghost-hover'
$ComposerToken = 'ProseMirror'

# Requests arrive ASCII-only (non-ASCII as \uXXXX escapes, which ConvertFrom-Json decodes). Replies are escaped
# the same way, so neither direction depends on the console code page.
$NonAscii = [regex]'[^\x00-\x7F]'
$EscapeChar = [System.Text.RegularExpressions.MatchEvaluator]{ param($match) '\u{0:x4}' -f [int][char]$match.Value }
function Reply($value) {
  [Console]::Out.WriteLine($NonAscii.Replace((ConvertTo-Json -InputObject $value -Compress -Depth 4), $EscapeChar))
  [Console]::Out.Flush()
}
# Length and UTF-16 code-unit sum of a probe string, so a check can confirm decoding without echoing text.
function Probe([string]$text) {
  $sum = 0
  foreach ($unit in $text.ToCharArray()) { $sum = ($sum + [int]$unit) % 2147483647 }
  return @{ pong = $true; probeLength = $text.Length; probeSum = $sum }
}
function Fail([string]$code) { throw [System.InvalidOperationException]::new("chompi:$code") }
function HasToken([string]$classes, [string]$token) { return [bool]($classes -and (($classes -split '\s+') -ccontains $token)) }
function Condition($property, $value) { New-Object System.Windows.Automation.PropertyCondition($property, $value) }

function TargetWindow($request) {
  $window = $AE::FromHandle([IntPtr][long]$request.hwnd)
  if ($null -eq $window -or $window.Current.ProcessId -ne [int]$request.processId) { Fail 'window-mismatch' }
  return $window
}

function CodexSelectedTitle($request) {
  $window = TargetWindow $request
  $title = [string]$request.title
  $documents = $window.FindAll($Scope::Descendants, (Condition $AE::AutomationIdProperty 'RootWebArea'))
  if ($documents.Count -ne 1) { Fail 'document-count' }
  $cache = New-Object System.Windows.Automation.CacheRequest
  $cache.Add($AE::NameProperty)
  $cache.Add($AE::ClassNameProperty)
  $cache.Push()
  try {
    $document = $documents[0].GetUpdatedCache($cache)
    $buttons = $document.FindAll($Scope::Descendants, (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Button)))
  } finally { $cache.Pop() }
  $selected = 0; $selectedMatches = $false; $same = 0
  foreach ($button in $buttons) {
    $classes = $button.Cached.ClassName
    if (-not $classes -or -not $classes.StartsWith($CodexRowPrefix, $Ordinal)) { continue }
    $equal = [string]::Equals($button.Cached.Name, $title, $Ordinal)
    if ($equal) { $same++ }
    if (HasToken $classes $CodexSelectedToken) { $selected++; $selectedMatches = $equal }
  }
  if ($selected -ne 1) { Fail 'selected-row-count' }
  $documentMatches = [string]::Equals($document.Cached.Name, $title, $Ordinal)
  return @{ matches = ($documentMatches -and $selectedMatches); sameTitleRows = $same }
}

function ComposerFocused($request) {
  $window = TargetWindow $request
  $focused = $AE::FocusedElement
  if ($null -eq $focused) { return @{ focused = $false } }
  $current = $focused.Current
  if ($current.ProcessId -ne [int]$request.processId) { return @{ focused = $false } }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $node = $focused; $inside = $false
  for ($depth = 0; $null -ne $node; $depth++) {
    if ($depth -ge 256) { Fail 'focus-ancestry-too-deep' }
    if ([System.Windows.Automation.Automation]::Compare($node, $window)) { $inside = $true; break }
    $node = $walker.GetParent($node)
  }
  if (-not $inside -or $current.ControlType.Id -ne $EditId -or -not (HasToken $current.ClassName $ComposerToken)) { return @{ focused = $false } }
  $pattern = $null
  if (-not $focused.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { return @{ focused = $false } }
  return @{ focused = (-not $pattern.Current.IsReadOnly) }
}

function ClientVersions {
  $result = [ordered]@{}
  foreach ($client in $Packages.Keys) {
    $family = $Packages[$client]
    $found = @(Get-AppxPackage -Name ($family -split '_')[0] | Where-Object { $_.PackageFamilyName -ceq $family })
    if ($found.Count -eq 1) { $result[$client] = @{ version = $found[0].Version.ToString() } }
    elseif ($found.Count -eq 0) { $result[$client] = @{ reason = 'not-installed' } }
    else { $result[$client] = @{ reason = 'multiple-packages' } }
  }
  return $result
}

Reply @{ ready = $true; protocol = 1 }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $id = $null
  try {
    $request = ConvertFrom-Json -InputObject $line
    $id = $request.id
    switch ([string]$request.op) {
      'ping' { if ($null -ne $request.probe) { $value = Probe ([string]$request.probe) } else { $value = @{ pong = $true } } }
      'codexSelectedTitle' { $value = CodexSelectedTitle $request }
      'composerFocused' { $value = ComposerFocused $request }
      'clientVersions' { $value = ClientVersions }
      default { Fail 'unknown-op' }
    }
    Reply @{ id = $id; ok = $true; value = $value }
  } catch {
    $message = [string]$_.Exception.Message
    if ($message.StartsWith('chompi:', $Ordinal)) { $reason = $message.Substring(7) } else { $reason = 'uia-' + $_.Exception.GetType().Name.ToLowerInvariant() }
    Reply @{ id = $id; ok = $false; reason = $reason }
  }
}
