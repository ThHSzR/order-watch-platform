$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$taskName = 'AmazonOrderWatcher'
$account = "$env:USERDOMAIN\$env:USERNAME"
Push-Location $root
try {
    if (-not (Test-Path '.env')) { throw 'Arquivo .env ausente.' }
    npm ci
    npx playwright install chromium
    $action = New-ScheduledTaskAction -Execute $node -Argument '"src/index.js" run' -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
    $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Amazon Order Watcher, perfil local do usuário' -Force | Out-Null
    Write-Output "Tarefa $taskName registrada para a sessão interativa de $account."
} finally { Pop-Location }
