@echo off
:: ============================================================
:: [开发者专用] 一次性配置嵌入式 Python Runtime
:: 运行后会在 runtime/python 创建完整的 Python 环境
:: ============================================================
cd /d "%~dp0"
chcp 65001 >nul
title Setup Embedded Python Runtime

set "RUNTIME_DIR=%~dp0runtime\python"
set "PYTHON_VERSION=3.10.11"
set "PYTHON_ZIP=python-%PYTHON_VERSION%-embed-amd64.zip"
set "PYTHON_URL=https://www.python.org/ftp/python/%PYTHON_VERSION%/%PYTHON_ZIP%"
set "GET_PIP_URL=https://bootstrap.pypa.io/get-pip.py"

echo ============================================================
echo  Embedded Python Runtime Setup
echo ============================================================
echo.

:: 1. 创建目录
if not exist "%RUNTIME_DIR%" (
    echo [1/5] Creating runtime directory...
    mkdir "%RUNTIME_DIR%"
) else (
    echo [1/5] Runtime directory already exists.
)

:: 2. 检查是否已经解压
if exist "%RUNTIME_DIR%\python.exe" (
    echo [2/5] Python already extracted, skipping download...
    goto :setup_pip
)

:: 3. 下载 Python Embedded
echo [2/5] Downloading Python %PYTHON_VERSION% Embedded...
echo       URL: %PYTHON_URL%
powershell -Command "Invoke-WebRequest -Uri '%PYTHON_URL%' -OutFile '%RUNTIME_DIR%\%PYTHON_ZIP%'"
if %errorlevel% neq 0 (
    echo [ERROR] Download failed! Please download manually:
    echo         %PYTHON_URL%
    pause
    exit /b 1
)

:: 4. 解压
echo [3/5] Extracting Python...
powershell -Command "Expand-Archive -Path '%RUNTIME_DIR%\%PYTHON_ZIP%' -DestinationPath '%RUNTIME_DIR%' -Force"
del "%RUNTIME_DIR%\%PYTHON_ZIP%"

:setup_pip
:: 5. 修改 ._pth 文件以启用 import site
echo [4/5] Enabling pip support...
set "PTH_FILE=%RUNTIME_DIR%\python310._pth"
if exist "%PTH_FILE%" (
    powershell -Command "(Get-Content '%PTH_FILE%') -replace '#import site', 'import site' | Set-Content '%PTH_FILE%'"
)

:: 6. 安装 pip
if not exist "%RUNTIME_DIR%\Scripts\pip.exe" (
    echo [5/5] Installing pip...
    powershell -Command "Invoke-WebRequest -Uri '%GET_PIP_URL%' -OutFile '%RUNTIME_DIR%\get-pip.py'"
    "%RUNTIME_DIR%\python.exe" "%RUNTIME_DIR%\get-pip.py" --no-warn-script-location
    del "%RUNTIME_DIR%\get-pip.py"
) else (
    echo [5/5] pip already installed.
)

:: 7. 预装项目依赖
echo.
echo [BONUS] Pre-installing project dependencies...
"%RUNTIME_DIR%\Scripts\pip.exe" install -r requirements.txt

echo.
echo ============================================================
echo  Setup Complete!
echo ============================================================
echo.
echo  Runtime location: %RUNTIME_DIR%
echo  Python version:   %PYTHON_VERSION%
echo.
echo  You can now commit the 'runtime' folder to your repo,
echo  or package it with your release.
echo.
echo  Note: The runtime folder is about 80-150MB depending on deps.
echo        Consider using Git LFS or excluding from git if too large.
echo.
pause
