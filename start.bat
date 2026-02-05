@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul
title SillyTavern GPT-SoVITS Launcher

echo [INFO] Starting up...
echo [INFO] Current path: %cd%

:: ============================================================
:: 设置 PYTHONPATH 为当前目录（项目根目录）
:: ============================================================
set "PYTHONPATH=%~dp0"

:: ============================================================
:: 优先使用内置 runtime（嵌入式 Python）
:: ============================================================
set "RUNTIME_PYTHON=%~dp0runtime\python\python.exe"

if exist "%RUNTIME_PYTHON%" (
    echo [INFO] Using embedded Python runtime...
    set "PYTHON_CMD=%RUNTIME_PYTHON%"
) else (
    :: 回退到系统 Python
    echo [INFO] Embedded runtime not found, checking system Python...
    where python >nul 2>nul
    if !errorlevel! neq 0 (
        echo.
        echo [ERROR] Python not found!
        echo Please ensure the 'runtime' folder exists, or install Python 3.10+.
        echo.
        pause
        exit /b 1
    )
    set "PYTHON_CMD=python"
)

:: 显示 Python 版本
echo [INFO] Python: 
"!PYTHON_CMD!" --version

:: ============================================================
:: 安装/更新依赖
:: ============================================================
echo [INFO] Checking dependencies...
"!PYTHON_CMD!" -m pip install -r requirements.txt -q

:: ============================================================
:: 启动服务
:: ============================================================
echo.
echo [INFO] Preparing to start Manager...
echo [INFO] If "Uvicorn running..." appears, the startup is successful.
echo [INFO] Admin UI will open automatically in your browser...
echo ---------------------------------------------------

:: 后台启动一个延迟任务,5秒后自动打开浏览器
start /b cmd /c "timeout /t 5 /nobreak >nul && start http://localhost:3000/admin"

"!PYTHON_CMD!" manager.py

:: ============================================================
:: 程序退出
:: ============================================================
echo.
echo ---------------------------------------------------
echo [INFO] Program has stopped running.
endlocal
pause
