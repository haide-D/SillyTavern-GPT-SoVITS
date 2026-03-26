@echo off
chcp 65001 >nul
title Realtime Widget

:: Get the directory of the bat file
set "DIR=%~dp0"
:: Navigate to the project root (two levels up from RealTime\desktop)
cd /d "%DIR%..\.."

:: Use absolute paths to avoid confusion
if exist "%CD%\.venv\Scripts\python.exe" (
    echo [Widget] Starting with .venv...
    "%CD%\.venv\Scripts\python.exe" "%DIR%widget.py"
) else (
    echo [Widget] Starting with system Python...
    python "%DIR%widget.py"
)

pause
