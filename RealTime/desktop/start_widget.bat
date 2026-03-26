@echo off
chcp 65001 >nul
title Realtime Widget

:: Get the directory of the bat file
set "DIR=%~dp0"
:: Navigate to the project root (two levels up from RealTime\desktop)
cd /d "%DIR%..\.."

:: Determine Python executable
if exist "%CD%\.venv\Scripts\python.exe" (
    set "PY=%CD%\.venv\Scripts\python.exe"
    echo [Widget] Using .venv Python
) else (
    set "PY=python"
    echo [Widget] Using system Python
)

:: Check and auto-install pywebview if missing
"%PY%" -c "import webview" 2>nul
if errorlevel 1 (
    echo [Widget] pywebview not found, installing...
    "%PY%" -m pip install pywebview -q
    if errorlevel 1 (
        echo [Widget] Failed to install pywebview. Please run: pip install pywebview
        pause
        exit /b 1
    )
    echo [Widget] pywebview installed successfully.
)

:: Start widget
echo [Widget] Starting...
"%PY%" "%DIR%widget.py"

pause
