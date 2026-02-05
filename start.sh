#!/bin/bash

# ============================================================
# SillyTavern GPT-SoVITS Launcher (macOS / Linux)
# ============================================================

cd "$(dirname "$0")"
echo "[INFO] Starting up..."
echo "[INFO] Current path: $(pwd)"

# ============================================================
# 设置 PYTHONPATH 为当前目录（项目根目录）
# ============================================================
export PYTHONPATH="$(pwd)"

# ============================================================
# 检查 Python 环境
# ============================================================
PYTHON_CMD=""

# 优先检查 python3
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
# 回退到 python
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo ""
    echo "[ERROR] Python not found!"
    echo "Please install Python 3.10+ first."
    echo ""
    echo "For macOS, you can install via Homebrew:"
    echo "  brew install python@3.11"
    echo ""
    exit 1
fi

# 显示 Python 版本
echo "[INFO] Python: $($PYTHON_CMD --version)"

# ============================================================
# 安装/更新依赖
# ============================================================
echo "[INFO] Checking dependencies..."
$PYTHON_CMD -m pip install -r requirements.txt -q

# ============================================================
# 启动服务
# ============================================================
echo ""
echo "[INFO] Preparing to start Manager..."
echo "[INFO] If \"Uvicorn running...\" appears, the startup is successful."
echo "[INFO] Admin UI will open automatically in your browser..."
echo "---------------------------------------------------"

# 后台启动一个延迟任务,5秒后自动打开浏览器
(sleep 5 && open "http://localhost:3000/admin" 2>/dev/null || xdg-open "http://localhost:3000/admin" 2>/dev/null) &

$PYTHON_CMD manager.py

# ============================================================
# 程序退出
# ============================================================
echo ""
echo "---------------------------------------------------"
echo "[INFO] Program has stopped running."
