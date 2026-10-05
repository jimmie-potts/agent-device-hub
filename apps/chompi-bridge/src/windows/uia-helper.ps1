# CHOMPI bridge UI Automation helper, protocol 1. Windows PowerShell 5.1, started by uia-helper.ts.
# It never sends input or clicks. Only FocusCardButton and InvokeCardButton change UI state, each on one button
# of the open card (#821); every other operation is read-only.
# One JSON request per stdin line; one JSON reply per stdout line. Replies carry only booleans, counts, indexes,
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
$ClaudeApprovalToken = 'epitaxy-approval-card'
$MaxCardButtons = 64

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

# Claude: elements of any control type carrying the approval-card token (its question and permission cards), offscreen
# ones included. Codex: composers, because its approval card replaces the composer. Searches the control view and
# counts class tokens only; the adapter decides.
function ApprovalVisible($request) {
  $window = TargetWindow $request
  switch ([string]$request.client) {
    'claude' { $condition = [System.Windows.Automation.Condition]::TrueCondition; $token = $ClaudeApprovalToken; $key = 'approvalCards' }
    'codex' { $condition = Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Edit); $token = $ComposerToken; $key = 'composers' }
    default { Fail 'invalid-client' }
  }
  $cache = New-Object System.Windows.Automation.CacheRequest
  $cache.Add($AE::ClassNameProperty)
  $cache.Push()
  try {
    $elements = $window.FindAll($Scope::Descendants, $condition)
  } finally { $cache.Pop() }
  $count = 0
  foreach ($element in $elements) {
    if (HasToken $element.Cached.ClassName $token) { $count++ }
  }
  return @{ $key = $count }
}

# Card answers (#821). Counts and indexes only; no Name or Value is read.
function InsideWindow($element, $window) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $node = $element
  for ($depth = 0; $null -ne $node; $depth++) {
    if ($depth -ge 256) { Fail 'focus-ancestry-too-deep' }
    if ([System.Windows.Automation.Automation]::Compare($node, $window)) { return $true }
    $node = $walker.GetParent($node)
  }
  return $false
}

# Actionable buttons in tree order: enabled Buttons with Invoke and without ExpandCollapse (menus open outside the card).
function CardButtonList($container) {
  $cache = New-Object System.Windows.Automation.CacheRequest
  $cache.Add($AE::IsEnabledProperty)
  $cache.Add($AE::IsInvokePatternAvailableProperty)
  $cache.Add($AE::IsExpandCollapsePatternAvailableProperty)
  $cache.Push()
  try {
    $found = $container.FindAll($Scope::Descendants, (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Button)))
  } finally { $cache.Pop() }
  if ($found.Count -gt $MaxCardButtons) { Fail 'card-too-many-buttons' }
  $list = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
  foreach ($b in $found) {
    if ([bool]$b.GetCachedPropertyValue($AE::IsEnabledProperty) -and [bool]$b.GetCachedPropertyValue($AE::IsInvokePatternAvailableProperty) -and
      -not [bool]$b.GetCachedPropertyValue($AE::IsExpandCollapsePatternAvailableProperty)) { $list.Add($b) }
  }
  return ,$list
}

function FocusedIndex($buttons) {
  $focused = $AE::FocusedElement
  if ($null -ne $focused) {
    for ($i = 0; $i -lt $buttons.Count; $i++) { if ([System.Windows.Automation.Automation]::Compare($buttons[$i], $focused)) { return $i } }
  }
  return -1
}

# Claude: the one element with the approval-card token. Codex (no token): only while no composer exists, the control-view
# parent Group of the focused actionable button, holding at least two actionable buttons.
function CardContainer($request, $window) {
  $cache = New-Object System.Windows.Automation.CacheRequest
  $cache.Add($AE::ClassNameProperty)
  $cache.Push()
  try {
    if ([string]$request.client -eq 'claude') { $elements = $window.FindAll($Scope::Descendants, [System.Windows.Automation.Condition]::TrueCondition) }
    elseif ([string]$request.client -eq 'codex') { $elements = $window.FindAll($Scope::Descendants, (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Edit))) }
    else { Fail 'invalid-client' }
  } finally { $cache.Pop() }
  if ([string]$request.client -eq 'claude') {
    $cards = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
    foreach ($element in $elements) { if (HasToken $element.Cached.ClassName $ClaudeApprovalToken) { $cards.Add($element) } }
    if ($cards.Count -ne 1) { return @{ cards = $cards.Count } }
    return @{ cards = 1; buttons = (CardButtonList $cards[0]) }
  }
  $composers = 0
  foreach ($element in $elements) { if (HasToken $element.Cached.ClassName $ComposerToken) { $composers++ } }
  $none = @{ composers = $composers; cards = 0 }
  if ($composers -ne 0) { return $none }
  $focused = $AE::FocusedElement
  if ($null -eq $focused -or $focused.Current.ProcessId -ne [int]$request.processId -or $focused.Current.ControlType.Id -ne [System.Windows.Automation.ControlType]::Button.Id) { return $none }
  if (-not (InsideWindow $focused $window)) { return $none }
  $parent = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($focused)
  if ($null -eq $parent -or $parent.Current.ControlType.Id -ne [System.Windows.Automation.ControlType]::Group.Id) { return $none }
  $buttons = CardButtonList $parent
  if ($buttons.Count -lt 2 -or (FocusedIndex $buttons) -lt 0) { return $none }
  return @{ composers = 0; cards = 1; buttons = $buttons }
}

function CardButtons($request) {
  $window = TargetWindow $request
  $card = CardContainer $request $window
  $value = [ordered]@{}
  if ([string]$request.client -eq 'codex') { $value.composers = $card.composers }
  $value.cards = $card.cards
  if ($card.cards -eq 1) { $value.buttons = $card.buttons.Count; $value.focused = FocusedIndex $card.buttons } else { $value.buttons = 0; $value.focused = -1 }
  return $value
}

# The open card's buttons, when the request names a valid index into an unchanged count.
function CardRequest($request, $window) {
  $index = $request.index; $count = $request.count
  if (-not (($index -is [int] -or $index -is [long]) -and ($count -is [int] -or $count -is [long]) -and $index -ge 0 -and $index -lt $count -and $count -le $MaxCardButtons)) { Fail 'invalid-card-index' }
  $card = CardContainer $request $window
  if ($card.cards -ne 1) { Fail 'card-absent' }
  return ,$card.buttons
}

function FocusCardButton($request) {
  $window = TargetWindow $request
  $buttons = CardRequest $request $window
  $index = [int]$request.index; $count = [int]$request.count
  if ($buttons.Count -ne $count) { Fail 'card-changed' }
  $buttons[$index].SetFocus()
  return @{ focused = (FocusedIndex $buttons) }
}

function InvokeCardButton($request) {
  $window = TargetWindow $request
  $buttons = CardRequest $request $window
  $index = [int]$request.index; $count = [int]$request.count
  if ($buttons.Count -ne $count) { Fail 'card-changed' }
  $focused = $AE::FocusedElement
  if ($null -eq $focused -or -not [System.Windows.Automation.Automation]::Compare($buttons[$index], $focused)) { return @{ invoked = $false } }
  $buttons[$index].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  return @{ invoked = $true }
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
      'approvalVisible' { $value = ApprovalVisible $request }
      'cardButtons' { $value = CardButtons $request }
      'focusCardButton' { $value = FocusCardButton $request }
      'invokeCardButton' { $value = InvokeCardButton $request }
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
