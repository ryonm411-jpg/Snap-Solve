@echo off
REM SnapSolve Startup Launcher
REM This script launches the SnapSolve background tray shim silently.
start /b powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0SnapSolveTray.ps1"
exit
