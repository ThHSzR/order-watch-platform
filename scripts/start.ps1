$ErrorActionPreference = 'Stop'
$taskName = 'AmazonOrderWatcher'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    Start-ScheduledTask -TaskName $taskName
    Write-Output "Tarefa $taskName iniciada."
} else {
    $root = Split-Path -Parent $PSScriptRoot
    $proc = Start-Process -FilePath (Get-Command node -ErrorAction Stop).Source -ArgumentList 'src/index.js','run' -WorkingDirectory $root -WindowStyle Hidden -PassThru
    Write-Output "Watcher iniciado no processo $($proc.Id)."
}
