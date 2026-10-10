param([Parameter(Mandatory=$true)][string]$Name)
$ErrorActionPreference = 'Stop'
$mutex = $null
$held = $false
try {
  if ($Name -notmatch '^Global\\Bunny-BB8-[0-9a-f]{64}$') { exit 1 }
  $mutex = [System.Threading.Mutex]::new($false, $Name)
  try { $held = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $held = $true }
  if (-not $held) { exit 1 }
  [Console]::Out.WriteLine('owned')
  [Console]::Out.Flush()
  # The parent owns stdin. Process death closes its pipe and releases this OS lease.
  while ($null -ne [Console]::ReadLine()) { }
} finally {
  if ($held) { $mutex.ReleaseMutex() }
  if ($null -ne $mutex) { $mutex.Dispose() }
}
