$ErrorActionPreference='Stop'
$docs=[Environment]::GetFolderPath('MyDocuments')
$vault=Join-Path $docs 'AI_Memory_Vault'
$claude=Join-Path $HOME '.claude'
[pscustomobject]@{
 Documents=$docs
 VaultPath=$vault
 VaultExists=(Test-Path $vault)
 VaultPreinstructionExists=(Test-Path (Join-Path $vault '90_SYSTEM\CHATGPT_PREINSTRUCTION.md'))
 ClaudeDir=$claude
 ClaudeDirExists=(Test-Path $claude)
 ClaudeSettingsExists=(Test-Path (Join-Path $claude 'settings.json'))
 ClaudeMdExists=(Test-Path (Join-Path $claude 'CLAUDE.md'))
 PluginsDirectoryExists=(Test-Path (Join-Path $claude 'plugins'))
} | Format-List
Write-Host 'Nenhuma credencial ou conteúdo do Vault foi copiado.'
