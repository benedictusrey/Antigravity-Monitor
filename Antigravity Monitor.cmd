@echo off
rem Starts the Antigravity Monitor companion window.
rem Works with the Antigravity desktop app, the IDE, and VS Code.
setlocal
cd /d "%~dp0"
node "tools\monitor-server.mjs"
if errorlevel 1 pause
