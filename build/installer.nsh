; Before the old version is removed, stop every process still running from the
; Noctan install folder. When the app quits for an update, children such as the
; embedded PC Controller (Noctan.exe in node mode), claude.exe and Playwright's
; browser can outlive it and keep files in app.asar.unpacked locked. The old
; uninstaller then fails with "Falha ao desinstalar os arquivos do aplicativo
; antigo ... : 2". Only processes whose executable lives inside the Noctan
; folder are touched, never other Claude/Chrome instances.
!macro noctanStopInstallFolderProcesses DIR
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$dirs = @('${DIR}', (Join-Path $$env:LOCALAPPDATA 'Programs\Noctan')) | Where-Object { $$_ } | ForEach-Object { [IO.Path]::GetFullPath($$_).TrimEnd('\') + '\' }; Get-Process | Where-Object { $$p = $$_.Path; $$p -and ($$dirs | Where-Object { $$p.StartsWith($$_, [StringComparison]::OrdinalIgnoreCase) }) } | Stop-Process -Force -ErrorAction SilentlyContinue"`
  Pop $0
  Sleep 1500
!macroend

!macro customInit
  !insertmacro noctanStopInstallFolderProcesses "$INSTDIR"
!macroend

!macro customUnInit
  !insertmacro noctanStopInstallFolderProcesses "$INSTDIR"
!macroend
