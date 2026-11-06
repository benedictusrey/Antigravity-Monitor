@echo off
rem Installs the companion and native editor extensions for this Windows user.
setlocal
if "%~1"=="" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install-windows.ps1" -PackageRoot "%~dp0."
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install-windows.ps1" -PackageRoot "%~dp0." -VsixPath "%~f1"
)
set "RESULT=%ERRORLEVEL%"
if not defined NO_PAUSE pause
exit /b %RESULT%
