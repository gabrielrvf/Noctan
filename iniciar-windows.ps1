$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Instale Node.js 20+ antes de continuar: https://nodejs.org/'; exit 1 }
if (-not (Test-Path 'node_modules')) { npm install; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
if (-not $env:ANTHROPIC_API_KEY) {
  $secure = Read-Host 'Cole sua chave da Anthropic API (entrada oculta)' -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $env:ANTHROPIC_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
if (-not $env:ANTHROPIC_API_KEY) { Write-Host 'Chave ausente.'; exit 1 }
Start-Process 'http://127.0.0.1:4177'
node server.mjs
