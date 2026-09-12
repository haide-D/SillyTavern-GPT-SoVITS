import uvicorn
import os
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

# 导入配置和路由
from config import FRONTEND_DIR, init_settings, get_manager_port
from routers import (
    data, tts, system, admin, phone_call, speakers,
    eavesdrop, continuous_analysis, sovits_installer, themes, workshop, auth
)

# 导入自定义中间件
from middleware.logging_middleware import LoggingMiddleware
from middleware.auth_middleware import AuthMiddleware
from middleware.ui_static_files import UIStaticFiles

# 初始化配置(确保 system_settings.json 和目录存在)
init_settings()

app = FastAPI()

# 1. 强力 CORS 静态文件支持
class CORSStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "*"
        return response

# 2. 中间件注册 (FastAPI 注册顺序: 越后注册越外层，最先执行)
# 最内层: 日志
app.add_middleware(LoggingMiddleware)

# 中间层: 安全鉴权防护
app.add_middleware(AuthMiddleware)

# 最外层: 全局 CORS 跨域支持 (最先捕获 preflight OPTIONS 并注入响应头)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r".*",
    allow_origins=[],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Audio-Filename", "Content-Type", "Content-Length"]
)

# 添加验证错误处理器
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    try:
        print(f"\n[ValidationError] 请求验证失败:")
        print(f"  - URL: {request.url}")
        print(f"  - Method: {request.method}")
        print(f"  - 错误详情: {exc.errors()}")
        body = await request.body()
        print(f"  - 请求体: {body.decode('utf-8', errors='replace')}")
    except:
        pass
    
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors(), "body": str(exc.body)},
    )


# 2. 挂载静态文件 (前端界面)
if os.path.exists(FRONTEND_DIR):
    app.mount("/static", UIStaticFiles(directory=FRONTEND_DIR), name="static")
else:
    print(f"Warning: 'frontend' folder not found at {FRONTEND_DIR}")

# 挂载管理面板静态文件
admin_dir = os.path.join(os.path.dirname(__file__), "admin")
if os.path.exists(admin_dir):
    app.mount("/admin/static", UIStaticFiles(directory=admin_dir), name="admin_static")
    app.mount("/admin", UIStaticFiles(directory=admin_dir, html=True), name="admin")
else:
    print(f"Warning: 'admin' folder not found at {admin_dir}")

os.makedirs("data/favorites_audio", exist_ok=True)
app.mount("/favorites", StaticFiles(directory="data/favorites_audio"), name="favorites")

# 挂载主题资源目录
os.makedirs("data/themes", exist_ok=True)
app.mount("/api/themes/assets", StaticFiles(directory="data/themes"), name="themes_assets")

# 挂载角色自定义本地头像目录
os.makedirs("data/avatars", exist_ok=True)
app.mount("/avatars", StaticFiles(directory="data/avatars"), name="avatars")

# 挂载主动电话音频目录 - 使用自定义路由处理中文路径
from config import init_settings
from fastapi.responses import FileResponse
from urllib.parse import unquote

cache_dir = init_settings().get("cache_dir", "Cache")
auto_call_audio_dir = os.path.join(cache_dir, "auto_phone_calls")
os.makedirs(auto_call_audio_dir, exist_ok=True)

# 自定义路由处理 URL 编码的中文路径
@app.get("/auto_call_audio/{speaker_name}/{filename}")
async def serve_auto_call_audio(speaker_name: str, filename: str):
    """
    提供自动电话音频文件
    
    手动解码 URL 路径以支持中文字符
    """
    # URL 解码
    speaker_name = unquote(speaker_name)
    filename = unquote(filename)
    
    # 构建文件路径
    file_path = os.path.join(auto_call_audio_dir, speaker_name, filename)
    
    # 检查文件是否存在
    if not os.path.exists(file_path):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"音频文件不存在: {speaker_name}/{filename}")
    
    # 返回文件
    return FileResponse(
        file_path,
        media_type="audio/wav",
        headers={
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*"
        }
    )

# 挂载对话追踪音频目录
eavesdrop_audio_dir = os.path.join(cache_dir, "eavesdrop")
os.makedirs(eavesdrop_audio_dir, exist_ok=True)

@app.get("/api/audio/eavesdrop/{filename}")
async def serve_eavesdrop_audio(filename: str):
    """
    提供对话追踪音频文件 (支持多路径回退探测，兼容历史已生成音频)
    """
    # URL 解码
    filename = unquote(filename)
    
    # 动态获取最新 cache_dir
    from config import get_current_dirs, DATA_DIR, PLUGIN_ROOT
    _, dynamic_cache_dir = get_current_dirs()

    # 候选路径探测列表
    candidate_paths = [
        os.path.join(dynamic_cache_dir, "eavesdrop", filename),
        os.path.join(eavesdrop_audio_dir, filename),
        os.path.join(DATA_DIR, "Cache", "eavesdrop", filename),
        os.path.join(PLUGIN_ROOT, "Cache", "eavesdrop", filename),
        os.path.join(PLUGIN_ROOT, "data", "Cache", "eavesdrop", filename),
    ]
    
    file_path = None
    for candidate in candidate_paths:
        if os.path.exists(candidate) and os.path.isfile(candidate):
            file_path = candidate
            break

    # 检查文件是否存在
    if not file_path:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"音频文件不存在: {filename}")
    
    # 返回文件
    return FileResponse(
        file_path,
        media_type="audio/wav",
        headers={
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*"
        }
    )

# 3. 注册路由 (同时支持根路径与 /api 前缀)
app.include_router(data.router, tags=["Data Management"])
app.include_router(data.router, prefix="/api", tags=["Data Management (API)"])
app.include_router(tts.router, tags=["TTS Core"])
app.include_router(tts.router, prefix="/api", tags=["TTS Core (API)"])
app.include_router(tts.router, prefix="/api/admin", tags=["TTS Core (Admin API)"])
app.include_router(system.router, tags=["System Settings"])
app.include_router(system.router, prefix="/api", tags=["System Settings (API)"])
app.include_router(system.router, prefix="/api/admin", tags=["System Settings (Admin API)"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin Panel"])
app.include_router(admin.router, prefix="/api", tags=["Admin Panel (API)"])
app.include_router(phone_call.router, prefix="/api", tags=["Phone Call"])
app.include_router(speakers.router, prefix="/api", tags=["Speakers Management"])
app.include_router(eavesdrop.router, prefix="/api/eavesdrop", tags=["Eavesdrop Tracking"])
app.include_router(continuous_analysis.router, prefix="/api", tags=["Continuous Analysis"])
app.include_router(sovits_installer.router, tags=["GPT-SoVITS Installation"])
app.include_router(themes.router, prefix="/api/themes", tags=["Themes Management"])
app.include_router(workshop.router, prefix="/api", tags=["Presets Workshop"])
app.include_router(workshop.router, prefix="/api/workshop", tags=["Creative Workshop"])
app.include_router(auth.router, prefix="/api", tags=["Authentication"])



# GPT-SoVITS 自动启动检查
def auto_start_sovits():
    """检查并自动启动 GPT-SoVITS 服务"""
    import subprocess
    import socket
    from pathlib import Path
    
    try:
        from routers.sovits_installer import load_sovits_config
        config = load_sovits_config()
        
        # 检查是否配置了自动启动
        if not config.auto_start:
            print("[GPT-SoVITS] ⏸️  自动启动已禁用")
            return
        
        # 检查是否已配置安装路径
        if not config.install_path:
            print("[Manager] 💡 GPT-SoVITS 本地路径未配置，已进入【轻量无头模式】(云端 TTS / 远程 API 正常可用)")
            return
        
        install_path = Path(config.install_path)
        if not install_path.exists():
            print(f"[Manager] 💡 未在本地找到 SoVITS 路径 ({install_path})，跳过本地自动启动，进入轻量模式")
            return
        
        # 检查端口是否已被占用（可能已经在运行）
        port = config.api_port
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        result = sock.connect_ex(('127.0.0.1', port))
        sock.close()
        
        if result == 0:
            print(f"[GPT-SoVITS] ✅ 端口 {port} 已在运行，跳过自动启动")
            return
        
        # 查找启动脚本
        python_exe = install_path / "runtime" / "python.exe" if os.name == 'nt' else install_path / "bin" / "python"
        if not python_exe.exists() and os.name != 'nt':
            python_exe = Path("python3")
        api_script = install_path / "api_v2.py"
        config_yaml = install_path / "GPT_SoVITS" / "configs" / "tts_infer.yaml"
        
        if not python_exe.exists() and os.name == 'nt':
            print(f"[GPT-SoVITS] ⚠️  未找到 Python: {python_exe}")
            return
        
        if not api_script.exists():
            print(f"[GPT-SoVITS] ⚠️  未找到 API 脚本: {api_script}")
            return
        
        # 构建启动命令
        cmd = [
            str(python_exe),
            str(api_script),
            "-a", "127.0.0.1",
            "-p", str(port)
        ]
        
        if config_yaml.exists():
            cmd.extend(["-c", str(config_yaml)])
        
        # 在新窗口中启动
        print(f"[GPT-SoVITS] 🚀 正在启动服务 (端口: {port})...")
        if os.name == 'nt':
            subprocess.Popen(
                cmd,
                cwd=str(install_path),
                creationflags=subprocess.CREATE_NEW_CONSOLE
            )
        else:
            subprocess.Popen(cmd, cwd=str(install_path), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        print("[GPT-SoVITS] ✅ 服务已启动")
        
    except Exception as e:
        print(f"[Manager] 💡 跳过 GPT-SoVITS 本地自启动 ({e})，使用轻量模式运行")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="SillyTavern-GPT-SoVITS 后端管理器")
    parser.add_argument("--share", action="store_true", help="自动创建 Cloudflare 免费公网安全穿透隧道 (提供免费 HTTPS/WSS 远程地址)")
    parser.add_argument("--port", type=int, default=None, help="自定义监听端口")
    parser.add_argument("--ssl-cert", type=str, default=None, help="SSL 证书文件路径 (.crt/.pem)")
    parser.add_argument("--ssl-key", type=str, default=None, help="SSL 私钥文件路径 (.key)")
    args, _ = parser.parse_known_args()

    # 尝试自动启动本地 GPT-SoVITS (如有配置)
    auto_start_sovits()
    
    port = args.port or get_manager_port()
    print("================================================================")
    print(f"🚀 SillyTavern-GPT-SoVITS 后端中间件已启动 (Port: {port})")
    print(f"📡 局域网/本地访问地址: http://0.0.0.0:{port}")
    print(f"⚙️  管理控制台面板:     http://127.0.0.1:{port}/admin")
    print("💡 支持平台: Windows / Linux / macOS / Android Termux / VPS Docker")
    print("================================================================")

    # 检查是否需要启动 Cloudflare 穿透隧道
    from utils_admin.tunnel_manager import tunnel_manager
    from config import load_json, SETTINGS_FILE
    settings = load_json(SETTINGS_FILE)
    auto_tunnel = args.share or settings.get("auto_share_tunnel", False)

    if auto_tunnel:
        tunnel_manager.start_tunnel(local_port=port)

    # 原生 SSL 支持
    ssl_cert = args.ssl_cert or settings.get("ssl_cert_file")
    ssl_key = args.ssl_key or settings.get("ssl_key_file")

    try:
        if ssl_cert and ssl_key and os.path.exists(ssl_cert) and os.path.exists(ssl_key):
            print(f"[SSL] 🔒 已启用原生 HTTPS/WSS 加密模式")
            uvicorn.run(app, host="0.0.0.0", port=port, ssl_certfile=ssl_cert, ssl_keyfile=ssl_key, access_log=False)
        else:
            uvicorn.run(app, host="0.0.0.0", port=port, access_log=False)
    finally:
        tunnel_manager.stop_tunnel()
