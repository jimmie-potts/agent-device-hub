# CHOMPI bridge UI Automation helper, protocol 1. Windows PowerShell 5.1, started by uia-helper.ts.
# It never sends input or clicks. Only FocusCardButton and InvokeCardButton change UI state on a card, each on one
# button of the open card (#821), only the eight setting actions (#906) on the model and effort controls, and only
# FocusSuggestion and InvokeSuggestion (#907) on one suggestion of Claude's next-step band; every other operation is
# read-only.
# One JSON request per stdin line; one JSON reply per stdout line. Replies carry only booleans, counts, indexes,
# package versions and fixed reason codes, never names, values or other text read from a window. The one exception is
# PickerState (#906): it returns only model and effort labels, the names of the qualified model and effort controls and
# their entries, never conversation text and nothing from any other menu.
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
  [Console]::Out.WriteLine($NonAscii.Replace((ConvertTo-Json -InputObject $value -Compress -Depth 6), $EscapeChar))
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

# Model and effort controls (#906). PickerState reads; the eight setting actions below change UI state, each only on a
# qualified control found afresh and checked against what the caller read: Claude's "Model: " and "Effort: " buttons,
# its model menu and Effort slider, Codex's picker button, its "Select effort" menu, that menu's "Select model" entry and
# the model list. Names are returned only for those, and only model and effort labels.
$MenuId = [System.Windows.Automation.ControlType]::Menu.Id
$RadioButtonId = [System.Windows.Automation.ControlType]::RadioButton.Id
$CheckBoxId = [System.Windows.Automation.ControlType]::CheckBox.Id
$PickerEntryTypes = [System.Windows.Automation.OrCondition]::new([System.Windows.Automation.Condition[]]@(
  (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::RadioButton)),
  (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::MenuItem)),
  (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::CheckBox))))
$ExpandState = [System.Windows.Automation.ExpandCollapsePattern]::ExpandCollapseStateProperty
$MaxPickerEntries = 64
$MaxPickerMenus = 32
$MaxPickerLabel = 128
$MaxComposerAncestors = 8
$ClaudeModelButton = 'Model: '
$ClaudeEffortButton = 'Effort: '
$EffortSliderName = 'Effort'
$CodexPickerName = 'Select effort'
$CodexSelectModel = 'Select model'
# Codex's collapsed picker button: "<model> <effort>", at least one word of model name, then an effort label at the end
# (labels seen on the trial host, 2026-10-06; case and spacing tolerant). Labels are matched only to find this button.
$CodexPickerClosedName = [regex]::new('^\S.*\s(minimal|low|medium|high|extra\s+high|light|standard|extended|max|ultra)$', 'IgnoreCase')
# After a setting action, read its effect back every 25 ms for at most 400 ms, as FocusCardButton does.
$SettlePollMs = 25
$SettleMs = 400

# A label as the adapter takes it: trimmed, at most 128 characters, $null when empty.
function PickerLabel([string]$text) {
  if (-not $text) { return $null }
  $trimmed = $text.Trim()
  if ($trimmed.Length -eq 0) { return $null }
  if ($trimmed.Length -gt $MaxPickerLabel) { return $trimmed.Substring(0, $MaxPickerLabel) }
  return $trimmed
}

# The nearest Menu at or above an element, inside the target window; $null when there is none below the window.
function MenuAbove($element, $window) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $node = $element
  for ($depth = 0; $null -ne $node; $depth++) {
    if ($depth -ge 256) { Fail 'focus-ancestry-too-deep' }
    if ([System.Windows.Automation.Automation]::Compare($node, $window)) { return $null }
    if ($node.Current.ControlType.Id -eq $MenuId) { return $node }
    $node = $walker.GetParent($node)
  }
  return $null
}

# The window's keyboard focus when it belongs to the target process, else $null.
function WindowFocus($request) {
  $focused = $AE::FocusedElement
  if ($null -eq $focused -or $focused.Current.ProcessId -ne [int]$request.processId) { return $null }
  return $focused
}

# A menu's own entries (RadioButton option, MenuItem action, CheckBox toggle) in tree order, not those of a menu nested
# in it, read from one cached FindAll. More than 64 entry elements under the menu is an error.
function MenuEntries($menu, $window) {
  $cache = New-Object System.Windows.Automation.CacheRequest
  $cache.Add($AE::NameProperty)
  $cache.Add($AE::ControlTypeProperty)
  $cache.Add([System.Windows.Automation.SelectionItemPattern]::IsSelectedProperty)
  $cache.Add([System.Windows.Automation.TogglePattern]::ToggleStateProperty)
  $cache.Push()
  try { $found = $menu.FindAll($Scope::Descendants, $PickerEntryTypes) } finally { $cache.Pop() }
  if ($found.Count -gt $MaxPickerEntries) { Fail 'picker-too-many-entries' }
  $entries = New-Object System.Collections.ArrayList
  foreach ($entry in $found) {
    $owner = MenuAbove $entry $window
    if ($null -eq $owner -or -not [System.Windows.Automation.Automation]::Compare($owner, $menu)) { continue }
    $label = PickerLabel $entry.Cached.Name
    if ($null -eq $label) { Fail 'picker-entry-unnamed' }
    $type = $entry.Cached.ControlType.Id
    if ($type -eq $RadioButtonId) {
      $kind = 'option'
      $value = $entry.GetCachedPropertyValue([System.Windows.Automation.SelectionItemPattern]::IsSelectedProperty)
      $selected = ($value -is [bool]) -and $value
    } elseif ($type -eq $CheckBoxId) {
      $kind = 'toggle'
      $value = $entry.GetCachedPropertyValue([System.Windows.Automation.TogglePattern]::ToggleStateProperty)
      $selected = ($value -is [System.Windows.Automation.ToggleState]) -and $value -eq [System.Windows.Automation.ToggleState]::On
    } else { $kind = 'action'; $selected = $false }
    [void]$entries.Add(@{ element = $entry; kind = $kind; label = $label; selected = $selected })
  }
  return ,$entries
}

# The window's Buttons with their names and ExpandCollapse state, from one cached FindAll under $root.
function SettingButtons($root) {
  $cache = New-Object System.Windows.Automation.CacheRequest
  $cache.Add($AE::NameProperty)
  $cache.Add($AE::IsExpandCollapsePatternAvailableProperty)
  $cache.Add($ExpandState)
  $cache.Push()
  try { $found = $root.FindAll($Scope::Descendants, (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Button))) } finally { $cache.Pop() }
  $list = New-Object System.Collections.ArrayList
  foreach ($button in $found) { if ([bool]$button.GetCachedPropertyValue($AE::IsExpandCollapsePatternAvailableProperty)) { [void]$list.Add($button) } }
  return ,$list
}

function ButtonExpanded($button) { return $button.GetCachedPropertyValue($ExpandState) -eq [System.Windows.Automation.ExpandCollapseState]::Expanded }

# Claude's one expandable button whose name starts with $prefix among $buttons (from SettingButtons); $null when there
# is none, an error for several.
function PrefixedButton($buttons, [string]$prefix) {
  $match = @($buttons | Where-Object { $_.Cached.Name -and $_.Cached.Name.StartsWith($prefix, $Ordinal) })
  if ($match.Count -gt 1) { Fail 'composer-setting-count' }
  if ($match.Count -eq 0) { return $null }
  return $match[0]
}

# Codex's picker button, found by identity among ALL expandable Buttons under the composer's 8th ancestor (or the
# window, when it is nearer): the composer area also holds other expandable buttons, such as "Add files and more" and
# "Change permissions". It is the one named "Select effort" (expanded) or named "<model> <effort>" (collapsed), whose
# name ends, after at least one word of model name, with a known effort label. None is $null; several are an error.
function CodexPickerButton($window) {
  $cache = New-Object System.Windows.Automation.CacheRequest
  $cache.Add($AE::ClassNameProperty)
  $cache.Push()
  try { $edits = $window.FindAll($Scope::Descendants, (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Edit))) } finally { $cache.Pop() }
  $composers = @($edits | Where-Object { HasToken $_.Cached.ClassName $ComposerToken })
  if ($composers.Count -ne 1) { return $null }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $root = $composers[0]
  for ($depth = 0; $depth -lt $MaxComposerAncestors; $depth++) {
    if ([System.Windows.Automation.Automation]::Compare($root, $window)) { break }
    $parent = $walker.GetParent($root)
    if ($null -eq $parent) { break }
    $root = $parent
  }
  $buttons = SettingButtons $root
  $pickers = @($buttons | Where-Object { CodexPickerName $_.Cached.Name })
  if ($pickers.Count -gt 1) { Fail 'codex-picker-button-ambiguous' }
  if ($pickers.Count -eq 0) { return $null }
  return $pickers[0]
}

# Whether a button name is Codex's picker: "Select effort", or "<model> <effort>" ending in a known effort label.
function CodexPickerName([string]$name) {
  if (-not $name) { return $false }
  if ([string]::Equals($name, $CodexPickerName, $Ordinal)) { return $true }
  return $CodexPickerClosedName.IsMatch($name)
}

function SettingButton($window, [string]$control) {
  switch ($control) {
    'claude-model' { return PrefixedButton (SettingButtons $window) $ClaudeModelButton }
    'claude-effort' { return PrefixedButton (SettingButtons $window) $ClaudeEffortButton }
    'codex-picker' { return CodexPickerButton $window }
    default { Fail 'invalid-setting' }
  }
}

# The one open qualified menu of the client, as @{ kind; menu; entries }, or $null. Other menus are never read.
function QualifiedMenu($window, [string]$client) {
  $cache = New-Object System.Windows.Automation.CacheRequest
  $cache.Add($AE::NameProperty)
  $cache.Push()
  try { $menus = $window.FindAll($Scope::Descendants, (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Menu))) } finally { $cache.Pop() }
  if ($menus.Count -gt $MaxPickerMenus) { Fail 'picker-too-many-menus' }
  if ($client -eq 'claude') {
    $model = @($menus | Where-Object { $_.Cached.Name -and $_.Cached.Name.StartsWith($ClaudeModelButton, $Ordinal) })
    if ($model.Count -gt 1) { Fail 'picker-menu-count' }
    if ($model.Count -eq 0) { return $null }
    return @{ kind = 'claude-model'; menu = $model[0]; entries = (MenuEntries $model[0] $window) }
  }
  $picker = @($menus | Where-Object { [string]::Equals($_.Cached.Name, $CodexPickerName, $Ordinal) })
  if ($picker.Count -gt 1) { Fail 'picker-menu-count' }
  $button = CodexPickerButton $window
  # The model list counts only while the picker button is expanded: a menu other than the picker whose own entries are
  # all model options.
  if ($null -ne $button -and (ButtonExpanded $button)) {
    $lists = New-Object System.Collections.ArrayList
    foreach ($menu in $menus) {
      if ([string]::Equals($menu.Cached.Name, $CodexPickerName, $Ordinal)) { continue }
      $entries = MenuEntries $menu $window
      if ($entries.Count -gt 0 -and @($entries | Where-Object { $_.kind -ne 'option' }).Count -eq 0) { [void]$lists.Add(@{ kind = 'codex-models'; menu = $menu; entries = $entries }) }
    }
    if ($lists.Count -gt 1) { Fail 'picker-menu-count' }
    if ($lists.Count -eq 1) { return $lists[0] }
  }
  if ($picker.Count -eq 0) { return $null }
  return @{ kind = 'codex-picker'; menu = $picker[0]; entries = (MenuEntries $picker[0] $window) }
}

function EntryIndex($entries, $element) {
  if ($null -eq $element) { return -1 }
  for ($i = 0; $i -lt $entries.Count; $i++) { if ([System.Windows.Automation.Automation]::Compare($entries[$i].element, $element)) { return $i } }
  return -1
}

# Claude's open Effort slider, $null when there is none; several are an error.
function EffortSlider($window) {
  $sliders = $window.FindAll($Scope::Descendants, [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.Condition[]]@(
    (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Slider)), (Condition $AE::NameProperty $EffortSliderName))))
  if ($sliders.Count -gt 1) { Fail 'effort-slider-count' }
  if ($sliders.Count -eq 0) { return $null }
  return $sliders[0]
}

function SliderRange($slider) {
  $range = $slider.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern).Current
  return @{ value = [double]$range.Value; min = [double]$range.Minimum; max = [double]$range.Maximum; step = [double]$range.SmallChange; readOnly = [bool]$range.IsReadOnly }
}

# Codex's picker announcement: the Name (or, when empty, the first Text child's Name) of the one StatusBar inside $menu.
function PickerAnnouncement($menu) {
  $bars = $menu.FindAll($Scope::Descendants, (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::StatusBar)))
  if ($bars.Count -ne 1) { return $null }
  $text = PickerLabel $bars[0].Current.Name
  if ($null -eq $text) {
    $child = $bars[0].FindFirst($Scope::Children, (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Text)))
    if ($null -ne $child) { $text = PickerLabel $child.Current.Name }
  }
  return $text
}

function PickerClient($request) {
  $client = [string]$request.client
  if ($client -ne 'claude' -and $client -ne 'codex') { Fail 'invalid-client' }
  return $client
}

function PickerState($request) {
  $window = TargetWindow $request
  $client = PickerClient $request
  $focused = WindowFocus $request
  $menu = $null; $slider = $null; $model = $null; $effort = $null; $announcement = $null
  $qualified = QualifiedMenu $window $client
  if ($null -ne $qualified) {
    $label = PickerLabel $qualified.menu.Current.Name
    if ($null -eq $label) { Fail 'picker-menu-unnamed' }
    $items = New-Object System.Collections.ArrayList
    foreach ($entry in $qualified.entries) { [void]$items.Add([ordered]@{ kind = $entry.kind; label = $entry.label; selected = $entry.selected }) }
    $hasFocus = $false
    if ($null -ne $focused) { $owner = MenuAbove $focused $window; $hasFocus = $null -ne $owner -and [System.Windows.Automation.Automation]::Compare($owner, $qualified.menu) }
    $menu = [ordered]@{ kind = $qualified.kind; label = $label; items = $items; focused = (EntryIndex $qualified.entries $focused); hasFocus = $hasFocus }
    if ($client -eq 'codex') {
      $pickerMenu = $qualified.menu
      if ($qualified.kind -eq 'codex-models') { $pickerMenu = $null }
      if ($null -ne $pickerMenu) { $announcement = PickerAnnouncement $pickerMenu }
    }
  }
  if ($client -eq 'claude') {
    $buttons = SettingButtons $window
    $modelButton = PrefixedButton $buttons $ClaudeModelButton
    if ($null -ne $modelButton) { $model = [ordered]@{ label = (PickerLabel $modelButton.Cached.Name.Substring($ClaudeModelButton.Length)); expanded = (ButtonExpanded $modelButton) } }
    $effortButton = PrefixedButton $buttons $ClaudeEffortButton
    if ($null -ne $effortButton) { $effort = [ordered]@{ label = (PickerLabel $effortButton.Cached.Name.Substring($ClaudeEffortButton.Length)); expanded = (ButtonExpanded $effortButton) } }
    $effortSlider = EffortSlider $window
    if ($null -ne $effortSlider) { $range = SliderRange $effortSlider; $slider = [ordered]@{ value = $range.value; min = $range.min; max = $range.max; step = $range.step } }
  } else {
    $pickerButton = CodexPickerButton $window
    if ($null -ne $pickerButton) { $model = [ordered]@{ label = (PickerLabel $pickerButton.Cached.Name); expanded = (ButtonExpanded $pickerButton) } }
  }
  return [ordered]@{ menu = $menu; slider = $slider; model = $model; effort = $effort; announcement = $announcement }
}

# Waits up to $SettleMs for $check to answer true, polling every $SettlePollMs; answers the last check.
function Settle([scriptblock]$check) {
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  $ok = & $check
  while (-not $ok -and $clock.ElapsedMilliseconds -lt $SettleMs) { Start-Sleep -Milliseconds $SettlePollMs; $ok = & $check }
  return [bool]$ok
}

function SettingRequest($request) {
  $client = PickerClient $request
  $control = [string]$request.control
  $allowed = @{ claude = @('claude-model', 'claude-effort'); codex = @('codex-picker') }
  if ($allowed[$client] -notcontains $control) { Fail 'invalid-setting' }
  return $control
}

function ExpandSetting($request) {
  $window = TargetWindow $request
  $control = SettingRequest $request
  $button = SettingButton $window $control
  if ($null -eq $button) { Fail 'setting-missing' }
  if ($button.GetCurrentPropertyValue($ExpandState) -ne [System.Windows.Automation.ExpandCollapseState]::Collapsed) { Fail 'setting-not-collapsed' }
  $button.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
  return @{ expanded = (Settle { $button.GetCurrentPropertyValue($ExpandState) -eq [System.Windows.Automation.ExpandCollapseState]::Expanded }) }
}

# Claude only: Codex's picker stays expanded on Collapse, so the bridge closes it with one Escape instead.
function CollapseSetting($request) {
  $window = TargetWindow $request
  $control = SettingRequest $request
  if ($control -eq 'codex-picker') { Fail 'collapse-unsupported' }
  $button = SettingButton $window $control
  if ($null -eq $button) { Fail 'setting-missing' }
  if ($button.GetCurrentPropertyValue($ExpandState) -ne [System.Windows.Automation.ExpandCollapseState]::Expanded) { Fail 'setting-not-expanded' }
  $button.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Collapse()
  return @{ collapsed = (Settle { $button.GetCurrentPropertyValue($ExpandState) -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed }) }
}

function InvokeSelectModel($request) {
  $window = TargetWindow $request
  if ((PickerClient $request) -ne 'codex') { Fail 'invalid-client' }
  $qualified = QualifiedMenu $window 'codex'
  if ($null -eq $qualified -or $qualified.kind -ne 'codex-picker') { Fail 'menu-absent' }
  $entries = @($qualified.entries | Where-Object { $_.kind -eq 'action' -and [string]::Equals($_.label, $CodexSelectModel, $Ordinal) })
  if ($entries.Count -ne 1) { Fail 'select-model-count' }
  $entries[0].element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  return @{ invoked = $true }
}

# The open qualified menu named by the request, when it still has the request's number of entries and a valid index.
function MenuRequest($request, $window) {
  $index = $request.index; $count = $request.count
  if (-not (($index -is [int] -or $index -is [long]) -and ($count -is [int] -or $count -is [long]) -and $index -ge 0 -and $index -lt $count -and $count -le $MaxPickerEntries)) { Fail 'invalid-menu-index' }
  $qualified = QualifiedMenu $window (PickerClient $request)
  if ($null -eq $qualified -or $qualified.kind -ne [string]$request.menu) { Fail 'menu-absent' }
  if ($qualified.entries.Count -ne [int]$count) { Fail 'menu-changed' }
  return $qualified.entries
}

function FocusMenuEntry($request) {
  $window = TargetWindow $request
  $entries = MenuRequest $request $window
  $index = [int]$request.index
  $entries[$index].element.SetFocus()
  [void](Settle { (EntryIndex $entries (WindowFocus $request)) -eq $index })
  return @{ focused = (EntryIndex $entries (WindowFocus $request)) }
}

function SelectMenuOption($request) {
  $window = TargetWindow $request
  $entries = MenuRequest $request $window
  $entry = $entries[[int]$request.index]
  if ($entry.kind -ne 'option') { Fail 'not-an-option' }
  $focused = WindowFocus $request
  if ($null -eq $focused -or -not [System.Windows.Automation.Automation]::Compare($entry.element, $focused)) { return @{ selected = $false } }
  $entry.element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
  return @{ selected = $true }
}

# Codex: Invoke on the model list's selected (current) option, which returns to the picker with nothing changed: the way
# to leave the list without a pick, because Select on the selected option does nothing there (observed 2026-10-07).
function InvokeCurrentOption($request) {
  $window = TargetWindow $request
  if ((PickerClient $request) -ne 'codex' -or [string]$request.menu -ne 'codex-models') { Fail 'invalid-menu' }
  $entries = MenuRequest $request $window
  $entry = $entries[[int]$request.index]
  if ($entry.kind -ne 'option') { Fail 'not-an-option' }
  if (-not $entry.selected) { Fail 'not-current-option' }
  $entry.element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  return @{ invoked = $true }
}

function SetSliderValue($request) {
  $window = TargetWindow $request
  if ((PickerClient $request) -ne 'claude') { Fail 'invalid-client' }
  $from = [double]$request.from; $to = [double]$request.to
  $slider = EffortSlider $window
  if ($null -eq $slider) { Fail 'slider-absent' }
  $range = SliderRange $slider
  if ($range.readOnly -or $range.value -ne $from -or [Math]::Abs($to - $from) -ne $range.step -or $to -lt $range.min -or $to -gt $range.max) { Fail 'slider-changed' }
  $slider.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern).SetValue($to)
  [void](Settle { (SliderRange $slider).value -eq $to })
  return @{ value = (SliderRange $slider).value }
}

# Gives the window's one composer keyboard focus, as Codex's Alt+L would; Claude's composer is its "Prompt" field.
function FocusComposer($request) {
  $window = TargetWindow $request
  [void](PickerClient $request)
  $cache = New-Object System.Windows.Automation.CacheRequest
  $cache.Add($AE::ClassNameProperty)
  $cache.Push()
  try { $edits = $window.FindAll($Scope::Descendants, (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Edit))) } finally { $cache.Pop() }
  $composers = @($edits | Where-Object { HasToken $_.Cached.ClassName $ComposerToken })
  if ($composers.Count -ne 1) { Fail 'composer-count' }
  $composers[0].SetFocus()
  return @{ focused = (Settle { [bool]$composers[0].GetCurrentPropertyValue($AE::HasKeyboardFocusProperty) }) }
}

# Claude's next-step suggestions (#907). The band is a Group beside the composer's group holding a Text "next:", one
# Button per suggestion and a Button "dismiss". Names are compared here only to find the band and its "dismiss" button,
# and the composer's Value only with the empty forms; replies carry counts, indexes and booleans, never a suggestion's
# text, which is model output.
$BandLabel = 'next:'
$BandDismiss = 'dismiss'
$MaxSuggestions = 8
# A band holds the label, the suggestions and "dismiss"; a group with more Text and Button children is not the band.
$MaxBandChildren = 16
# A level of the walk up from the composer with more Group children than this is not searched further.
$MaxBandGroups = 64

# Claude's one composer: the Edit carrying the ProseMirror class token. None or several is an error.
function ClaudeComposer($window) {
  $cache = New-Object System.Windows.Automation.CacheRequest
  $cache.Add($AE::ClassNameProperty)
  $cache.Push()
  try { $edits = $window.FindAll($Scope::Descendants, (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Edit))) } finally { $cache.Pop() }
  $composers = @($edits | Where-Object { HasToken $_.Cached.ClassName $ComposerToken })
  if ($composers.Count -ne 1) { Fail 'composer-count' }
  return $composers[0]
}

# Whether the composer is empty: its Value is '' or only one trailing line break. Claude's empty composer reads as one
# "`n" (2026-10-06), and its ghost text never shows in the Value. The Value is compared, never returned.
function ComposerEmpty($composer) {
  $pattern = $null
  if (-not $composer.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { Fail 'composer-value-unavailable' }
  $value = [string]$pattern.Current.Value
  return ($value.Length -eq 0 -or [string]::Equals($value, "`n", $Ordinal) -or [string]::Equals($value, "`r`n", $Ordinal))
}

# The suggestion buttons of $group in tree order, when it directly holds exactly one Text named "next:" and exactly one
# Button named "dismiss"; $null for any other group. A band whose other Buttons are not 1-8 enabled, keyboard-focusable
# and invokable buttons is an error, not a missing band.
function BandSuggestions($group) {
  $cache = New-Object System.Windows.Automation.CacheRequest
  $cache.Add($AE::NameProperty)
  $cache.Add($AE::ControlTypeProperty)
  $cache.Add($AE::IsEnabledProperty)
  $cache.Add($AE::IsKeyboardFocusableProperty)
  $cache.Add($AE::IsInvokePatternAvailableProperty)
  $cache.Push()
  try { $children = $group.FindAll($Scope::Children, $TextOrButton) } finally { $cache.Pop() }
  if ($children.Count -gt $MaxBandChildren) { return $null }
  $labels = 0; $dismiss = 0
  $buttons = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
  foreach ($child in $children) {
    $text = ([string]$child.Cached.Name).Trim()
    if ($child.Cached.ControlType.Id -eq $TextId) { if ([string]::Equals($text, $BandLabel, $Ordinal)) { $labels++ } }
    elseif ([string]::Equals($text, $BandDismiss, $Ordinal)) { $dismiss++ }
    else { $buttons.Add($child) }
  }
  if ($labels -ne 1 -or $dismiss -ne 1) { return $null }
  if ($buttons.Count -lt 1 -or $buttons.Count -gt $MaxSuggestions) { Fail 'suggestion-band-unqualified' }
  foreach ($b in $buttons) {
    if (-not ([bool]$b.GetCachedPropertyValue($AE::IsEnabledProperty) -and [bool]$b.GetCachedPropertyValue($AE::IsKeyboardFocusableProperty) -and
      [bool]$b.GetCachedPropertyValue($AE::IsInvokePatternAvailableProperty))) { Fail 'suggestion-band-unqualified' }
  }
  return ,$buttons
}

# The band, as @{ buttons; level }: walking up from the composer through at most 8 ancestors, the first level whose
# parent directly holds a Group of the band's shape beside the composer's ancestor; several there is an error, none at
# any level is no band ($null).
function SuggestionBand($composer, $window) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $node = $composer
  for ($depth = 0; $depth -lt $MaxComposerAncestors; $depth++) {
    if ([System.Windows.Automation.Automation]::Compare($node, $window)) { break }
    $parent = $walker.GetParent($node)
    if ($null -eq $parent) { break }
    $groups = $parent.FindAll($Scope::Children, (Condition $AE::ControlTypeProperty ([System.Windows.Automation.ControlType]::Group)))
    if ($groups.Count -gt $MaxBandGroups) { break }
    $found = New-Object System.Collections.ArrayList
    foreach ($group in $groups) {
      if ([System.Windows.Automation.Automation]::Compare($group, $node)) { continue }
      $buttons = BandSuggestions $group
      if ($null -ne $buttons) { [void]$found.Add(@{ buttons = $buttons; level = $depth }) }
    }
    if ($found.Count -gt 1) { Fail 'suggestion-band-ambiguous' }
    if ($found.Count -eq 1) { return $found[0] }
    $node = $parent
  }
  return $null
}

# The band's suggestion count (0 without a band), the focused suggestion (-1 for none), the level it was found at and
# the composer's focus and emptiness.
function SuggestionState($request) {
  $window = TargetWindow $request
  if ((PickerClient $request) -ne 'claude') { Fail 'invalid-client' }
  $composer = ClaudeComposer $window
  $band = SuggestionBand $composer $window
  $value = [ordered]@{ suggestions = 0; focused = -1; level = -1; composerFocused = [bool]$composer.GetCurrentPropertyValue($AE::HasKeyboardFocusProperty); composerEmpty = (ComposerEmpty $composer) }
  if ($null -ne $band) { $value.suggestions = $band.buttons.Count; $value.focused = FocusedIndex $band.buttons; $value.level = $band.level }
  return $value
}

# The band and composer named by the request, when the band still has the request's number of suggestions and the
# index is valid.
function SuggestionRequest($request, $window) {
  $index = $request.index; $count = $request.count
  if (-not (($index -is [int] -or $index -is [long]) -and ($count -is [int] -or $count -is [long]) -and $index -ge 0 -and $index -lt $count -and $count -le $MaxSuggestions)) { Fail 'invalid-suggestion-index' }
  if ((PickerClient $request) -ne 'claude') { Fail 'invalid-client' }
  $composer = ClaudeComposer $window
  $band = SuggestionBand $composer $window
  if ($null -eq $band) { Fail 'band-absent' }
  if ($band.buttons.Count -ne [int]$count) { Fail 'band-changed' }
  return @{ composer = $composer; buttons = $band.buttons }
}

function FocusSuggestion($request) {
  $window = TargetWindow $request
  $band = SuggestionRequest $request $window
  $index = [int]$request.index
  $band.buttons[$index].SetFocus()
  [void](Settle { (FocusedIndex $band.buttons) -eq $index })
  return @{ focused = (FocusedIndex $band.buttons) }
}

# Invokes the suggestion only while it holds keyboard focus and the composer is empty: the next-steps mod then writes it
# into the composer as a draft. It never sends.
function InvokeSuggestion($request) {
  $window = TargetWindow $request
  $band = SuggestionRequest $request $window
  $index = [int]$request.index
  $focused = $AE::FocusedElement
  if ($null -eq $focused -or -not [System.Windows.Automation.Automation]::Compare($band.buttons[$index], $focused)) { return @{ invoked = $false } }
  if (-not (ComposerEmpty $band.composer)) { return @{ invoked = $false } }
  $band.buttons[$index].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
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
      'pickerState' { $value = PickerState $request }
      'expandSetting' { $value = ExpandSetting $request }
      'collapseSetting' { $value = CollapseSetting $request }
      'invokeSelectModel' { $value = InvokeSelectModel $request }
      'focusMenuEntry' { $value = FocusMenuEntry $request }
      'selectMenuOption' { $value = SelectMenuOption $request }
      'invokeCurrentOption' { $value = InvokeCurrentOption $request }
      'setSliderValue' { $value = SetSliderValue $request }
      'focusComposer' { $value = FocusComposer $request }
      'suggestionState' { $value = SuggestionState $request }
      'focusSuggestion' { $value = FocusSuggestion $request }
      'invokeSuggestion' { $value = InvokeSuggestion $request }
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
