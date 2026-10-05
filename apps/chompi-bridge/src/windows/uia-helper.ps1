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
$ButtonId = [System.Windows.Automation.ControlType]::Button.Id
$TextId = [System.Windows.Automation.ControlType]::Text.Id
$TextOrButton = [System.Windows.Automation.OrCondition]::new([System.Windows.Automation.Condition[]]@(
  (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)),
  (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button))))
$Ordinal = [System.StringComparison]::Ordinal
$Packages = [ordered]@{ codex = 'OpenAI.Codex_2p2nqsd0c76g0'; claude = 'Claude_pzs8sxrjxfjjc' }
$CodexRowPrefix = 'group relative cursor-interaction'
$CodexSelectedToken = 'bg-primary-ghost-hover'
$ComposerToken = 'ProseMirror'
$ClaudeApprovalToken = 'epitaxy-approval-card'
$MaxCardButtons = 64
# Codex cards are found among the window's Group elements; more than this many is not qualified.
$MaxCardGroups = 512
# Claude answer rows (and its "Other" row) carry this class token; header, footer and submit buttons do not.
$ClaudeAnswerToken = 'text-left'
# Claude applies focus asynchronously: after a focus request, read focus back every 25 ms for at most 400 ms.
$FocusPollMs = 25
$FocusSettleMs = 400

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
# Actionable buttons in tree order: enabled Buttons with Invoke and without ExpandCollapse (menus open outside the card).
# More than 64 Button elements in scope, before that filter, is an error.
function CardButtonList($container, $scope) {
  $cache = New-Object System.Windows.Automation.CacheRequest
  $cache.Add($AE::ClassNameProperty)
  $cache.Add($AE::IsEnabledProperty)
  $cache.Add($AE::IsInvokePatternAvailableProperty)
  $cache.Add($AE::IsExpandCollapsePatternAvailableProperty)
  $cache.Push()
  try {
    $found = $container.FindAll($scope, (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Button)))
  } finally { $cache.Pop() }
  if ($found.Count -gt $MaxCardButtons) { Fail 'card-too-many-buttons' }
  $list = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
  foreach ($b in $found) {
    if ([bool]$b.GetCachedPropertyValue($AE::IsEnabledProperty) -and [bool]$b.GetCachedPropertyValue($AE::IsInvokePatternAvailableProperty) -and
      -not [bool]$b.GetCachedPropertyValue($AE::IsExpandCollapsePatternAvailableProperty)) { $list.Add($b) }
  }
  return ,$list
}

# Claude's wheel stops: when any actionable button carries the answer token (a question card), only those buttons, the
# answer rows and "Other", in tree order, as Up and Down move inside its option list; otherwise (a permission card) all.
function ClaudeStops($buttons) {
  $answers = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
  foreach ($b in $buttons) { if (HasToken $b.Cached.ClassName $ClaudeAnswerToken) { $answers.Add($b) } }
  if ($answers.Count -gt 0) { return ,$answers }
  return ,$buttons
}

function FocusedIndex($buttons) {
  $focused = $AE::FocusedElement
  if ($null -ne $focused) {
    for ($i = 0; $i -lt $buttons.Count; $i++) { if ([System.Windows.Automation.Automation]::Compare($buttons[$i], $focused)) { return $i } }
  }
  return -1
}

# Claude: the one element with the approval-card token. Codex (no token): only while no composer exists and exactly one
# sidebar row is selected, the one on-screen Group directly holding at least one Text element and at least two actionable
# buttons, wherever keyboard focus is.
function CardContainer($request, $window) {
  $client = [string]$request.client
  $cache = New-Object System.Windows.Automation.CacheRequest
  $cache.Add($AE::ClassNameProperty)
  $cache.Add($AE::ControlTypeProperty)
  $cache.Push()
  try {
    if ($client -eq 'claude') { $elements = $window.FindAll($Scope::Descendants, [System.Windows.Automation.Condition]::TrueCondition) }
    elseif ($client -eq 'codex') {
      $types = [System.Windows.Automation.OrCondition]::new([System.Windows.Automation.Condition[]]@(
        (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Edit)), (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Button))))
      $elements = $window.FindAll($Scope::Descendants, $types)
    }
    else { Fail 'invalid-client' }
  } finally { $cache.Pop() }
  if ($client -eq 'claude') {
    $cards = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
    foreach ($element in $elements) { if (HasToken $element.Cached.ClassName $ClaudeApprovalToken) { $cards.Add($element) } }
    if ($cards.Count -ne 1) { return @{ cards = $cards.Count } }
    return @{ cards = 1; container = $cards[0]; buttons = (ClaudeStops (CardButtonList $cards[0] $Scope::Descendants)) }
  }
  $composers = 0; $selectedRows = 0
  foreach ($element in $elements) {
    $classes = $element.Cached.ClassName
    if ($element.Cached.ControlType.Id -eq $EditId) { if (HasToken $classes $ComposerToken) { $composers++ } }
    elseif ($classes -and $classes.StartsWith($CodexRowPrefix, $Ordinal) -and (HasToken $classes $CodexSelectedToken)) { $selectedRows++ }
  }
  $none = @{ composers = $composers; selectedRows = $selectedRows; cardGroups = 0; cards = 0 }
  if ($composers -ne 0 -or $selectedRows -ne 1) { return $none }
  # Codex does not reliably give its card keyboard focus, so the card is found by structure, not from focus: the one
  # on-screen Group that directly holds a Text element and at least two actionable buttons.
  $groupCache = New-Object System.Windows.Automation.CacheRequest
  $groupCache.Add($AE::ClassNameProperty)
  $groupCache.Add($AE::IsOffscreenProperty)
  $groupCache.Push()
  try {
    $groups = $window.FindAll($Scope::Descendants, (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Group)))
  } finally { $groupCache.Pop() }
  if ($groups.Count -gt $MaxCardGroups) { Fail 'card-too-many-groups' }
  $candidates = New-Object 'System.Collections.Generic.List[object]'
  foreach ($group in $groups) {
    if ([bool]$group.GetCachedPropertyValue($AE::IsOffscreenProperty)) { continue }
    $stops = CodexGroupStops $group
    if ($null -ne $stops) { $candidates.Add(@{ group = $group; buttons = $stops }) }
  }
  $none.cardGroups = $candidates.Count
  if ($candidates.Count -ne 1) { return $none }
  # Focus elsewhere (Codex may leave it on the sidebar row) does not matter: a press needs a wheel step confirmed on a stop.
  $card = $candidates[0]
  return @{ composers = 0; selectedRows = 1; cardGroups = 1; cards = 1; container = $card.group; buttons = $card.buttons }
}

# A Codex card candidate's stops: its actionable direct-child buttons in tree order, when it also directly holds at
# least one Text element and at most 64 Button children; otherwise $null. One FindAll of its children, cached.
function CodexGroupStops($group) {
  $cache = New-Object System.Windows.Automation.CacheRequest
  $cache.Add($AE::ControlTypeProperty)
  $cache.Add($AE::IsEnabledProperty)
  $cache.Add($AE::IsInvokePatternAvailableProperty)
  $cache.Add($AE::IsExpandCollapsePatternAvailableProperty)
  $cache.Push()
  try { $children = $group.FindAll($Scope::Children, $TextOrButton) } finally { $cache.Pop() }
  $texts = 0; $buttons = 0
  $stops = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
  foreach ($child in $children) {
    $type = $child.Cached.ControlType.Id
    if ($type -eq $TextId) { $texts++ }
    elseif ($type -eq $ButtonId) {
      $buttons++
      if ([bool]$child.GetCachedPropertyValue($AE::IsEnabledProperty) -and [bool]$child.GetCachedPropertyValue($AE::IsInvokePatternAvailableProperty) -and
        -not [bool]$child.GetCachedPropertyValue($AE::IsExpandCollapsePatternAvailableProperty)) { $stops.Add($child) }
    }
  }
  if ($texts -lt 1 -or $buttons -gt $MaxCardButtons -or $stops.Count -lt 2) { return $null }
  return ,$stops
}

# The card's identity: its container's UI Automation runtime ID, assumed never shared by a new card. An ID, not text.
function CardId($container) { return (($container.GetRuntimeId()) -join '.') }

function CardButtons($request) {
  $window = TargetWindow $request
  $card = CardContainer $request $window
  $value = [ordered]@{}
  if ([string]$request.client -eq 'codex') {
    $value.composers = $card.composers; $value.selectedRows = $card.selectedRows; $value.cardGroups = $card.cardGroups
  }
  $value.cards = $card.cards
  if ($card.cards -eq 1) { $value.buttons = $card.buttons.Count; $value.focused = FocusedIndex $card.buttons; $value.cardId = CardId $card.container }
  else { $value.buttons = 0; $value.focused = -1; $value.cardId = '' }
  return $value
}

# The open card's buttons, when the request names a valid index into it and the card is still the one named.
function CardRequest($request, $window) {
  $index = $request.index; $count = $request.count
  if (-not (($index -is [int] -or $index -is [long]) -and ($count -is [int] -or $count -is [long]) -and $index -ge 0 -and $index -lt $count -and $count -le $MaxCardButtons)) { Fail 'invalid-card-index' }
  $card = CardContainer $request $window
  if ($card.cards -ne 1) { Fail 'card-absent' }
  if (-not [string]::Equals((CardId $card.container), [string]$request.cardId, $Ordinal)) { Fail 'card-changed' }
  return ,$card.buttons
}

function FocusCardButton($request) {
  $window = TargetWindow $request
  $buttons = CardRequest $request $window
  $index = [int]$request.index; $count = [int]$request.count
  if ($buttons.Count -ne $count) { Fail 'card-changed' }
  $buttons[$index].SetFocus()
  # Focus lands asynchronously in Claude; reply with the index observed once it settles or the bound runs out.
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  $observed = FocusedIndex $buttons
  while ($observed -ne $index -and $clock.ElapsedMilliseconds -lt $FocusSettleMs) {
    Start-Sleep -Milliseconds $FocusPollMs
    $observed = FocusedIndex $buttons
  }
  return @{ focused = $observed }
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
