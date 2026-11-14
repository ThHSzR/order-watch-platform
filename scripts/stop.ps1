$ErrorActionPreference = 'Stop'
$taskName = 'AmazonOrderWatcher'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task -and $task.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $taskName
    Write-Output "Tarefa $taskName parada."
    exit 0
}
$root = Split-Path -Parent $PSScriptRoot
$lockFile = Join-Path $root 'data\watcher.lock'
if (Test-Path $lockFile) {
    $pidValue = [int](Get-Content -LiteralPath $lockFile -Raw).Trim()
    $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($proc) { Stop-Process -Id $pidValue; Write-Output "Watcher parado (PID $pidValue)."; exit 0 }
}
Write-Output 'Watcher já está parado.'
