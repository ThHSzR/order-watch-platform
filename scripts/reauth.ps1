$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$taskName = 'AmazonOrderWatcher'

Push-Location $root
try {
    Write-Output 'Abrindo o perfil Amazon do watcher. Entre na conta e conclua o MFA na janela Chromium.'
    npm run auth
    if ($LASTEXITCODE -ne 0) {
        throw 'A sessão não foi validada. Conclua o login/MFA na janela e tente novamente.'
    }

    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        Start-ScheduledTask -TaskName $taskName
        Write-Output "Sessão validada; tarefa $taskName iniciada."
    } else {
        $node = (Get-Command node -ErrorAction Stop).Source
        Start-Process -FilePath $node -ArgumentList 'src/index.js', 'run' -WorkingDirectory $root -WindowStyle Hidden
        Write-Output 'Sessão validada; watcher iniciado.'
    }
} finally {
    Pop-Location
}
