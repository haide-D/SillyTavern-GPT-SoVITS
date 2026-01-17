@echo off
cd /d "%~dp0"
title SillyTavern GPT-SoVITS Launcher

echo [INFO] Starting up...
echo [INFO] Current path: %cd%

:: 1. Check for Git updates (with timeout)
echo [INFO] Checking for updates...
where git >nul 2>nul
if %errorlevel% equ 0 (
    echo [INFO] Git detected, checking for updates from: https://github.com/haide-D/SillyTavern-GPT-SoVITS
    echo [INFO] Timeout set to 30 seconds to prevent hanging...
    
    :: Use PowerShell to run git fetch with timeout
    powershell -Command "$job = Start-Job -ScriptBlock { git fetch origin 2>&1 }; Wait-Job $job -Timeout 30 | Out-Null; if ($job.State -eq 'Running') { Stop-Job $job; Write-Host '[WARN] Git fetch timed out after 30 seconds. Skipping update check.'; exit 1 } else { Receive-Job $job; exit $LASTEXITCODE }"
    
    if %errorlevel% equ 0 (
        :: Check if there are updates available
        for /f %%i in ('git rev-list HEAD...origin/main --count 2^>nul') do set UPDATE_COUNT=%%i
        if not defined UPDATE_COUNT (
            for /f %%i in ('git rev-list HEAD...origin/master --count 2^>nul') do set UPDATE_COUNT=%%i
        )
        
        if defined UPDATE_COUNT (
            if %UPDATE_COUNT% gtr 0 (
                echo [INFO] Found %UPDATE_COUNT% update(s) available.
                echo [INFO] Pulling latest changes...
                git pull --ff-only
                if %errorlevel% equ 0 (
                    echo [INFO] Update successful!
                ) else (
                    echo [WARN] Update failed. Continuing with current version...
                )
            ) else (
                echo [INFO] Already up to date.
            )
        ) else (
            echo [INFO] Unable to check for updates. Continuing...
        )
    ) else (
        echo [WARN] Could not connect to remote repository. Continuing with local version...
    )
) else (
    echo [WARN] Git not found. Skipping update check.
    echo [WARN] To enable auto-update, please install Git: https://git-scm.com/
)

echo.

:: 2. Attempt to detect Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] 'python' command not found!
    echo Please confirm that Python is installed and "Add Python to PATH" was checked during installation.
    echo Or try reinstalling Python 3.10+.
    echo.
    pause
    exit
)

:: 3. Install/Update dependencies
echo [INFO] Checking dependencies...
pip install -r requirements.txt

:: 4. Start Service
echo.
echo [INFO] Preparing to start Manager...
echo [INFO] If "Uvicorn running..." appears, the startup is successful.
echo ---------------------------------------------------
python manager.py

:: 5. Pause on exit
echo.
echo ---------------------------------------------------
echo [INFO] Program has stopped running.
pause
