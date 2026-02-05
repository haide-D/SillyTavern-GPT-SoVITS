import uvicorn
import os
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

# 导入配置和路由
from config import FRONTEND_DIR, init_settings
from routers import data, tts, system
from config import FRONTEND_DIR
from routers import data, tts, system, admin, phone_call, speakers, eavesdrop, continuous_analysis, sovits_installer

# 导入自定义日志中间件
from middleware.logging_middleware import LoggingMiddleware

# 初始化配置(确保 system_settings.json 和目录存在)
init_settings()

app = FastAPI()

# 0. 添加自定义日志中间件(必须在 CORS 之前)
app.add_middleware(LoggingMiddleware)

# 1. CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,  # 允许携带凭证
    # 明确列出需要暴露的响应头 (带 credentials 时 * 通配符无效)
    expose_headers=["X-Audio-Filename", "Content-Type", "Content-Length"]
)

# 添加验证错误处理器
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    print(f"\n[ValidationError] ❌ 请求验证失败:")
    print(f"  - URL: {request.url}")
    print(f"  - Method: {request.method}")
    print(f"  - 错误详情: {exc.errors()}")
    try:
        body = await request.body()
        print(f"  - 请求体: {body.decode('utf-8')}")
    except:
        pass
    
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors(), "body": str(exc.body)},
    )


# 2. 挂载静态文件 (前端界面)
if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
else:
    print(f"Warning: 'frontend' folder not found at {FRONTEND_DIR}")

# 挂载管理面板静态文件
admin_dir = os.path.join(os.path.dirname(__file__), "admin")
if os.path.exists(admin_dir):
    app.mount("/admin", StaticFiles(directory=admin_dir, html=True), name="admin")
else:
    print(f"Warning: 'admin' folder not found at {admin_dir}")

# 挂载实时对话前端
realtime_frontend_dir = os.path.join(os.path.dirname(__file__), "RealTime", "frontend")
if os.path.exists(realtime_frontend_dir):
    app.mount("/realtime", StaticFiles(directory=realtime_frontend_dir, html=True), name="realtime")
    print(f"[Manager] ✅ 实时对话前端已挂载: /realtime")
else:
    print(f"[Manager] ⚠️ 实时对话前端目录不存在: {realtime_frontend_dir}")

os.makedirs("data/favorites_audio", exist_ok=True)
app.mount("/favorites", StaticFiles(directory="data/favorites_audio"), name="favorites")

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
    提供对话追踪音频文件
    """
    # URL 解码
    filename = unquote(filename)
    
    # 构建文件路径
    file_path = os.path.join(eavesdrop_audio_dir, filename)
    
    # 检查文件是否存在
    if not os.path.exists(file_path):
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

# 3. 注册路由
app.include_router(data.router, tags=["Data Management"])
app.include_router(tts.router, tags=["TTS Core"])
app.include_router(system.router, tags=["System Settings"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin Panel"])
app.include_router(phone_call.router, prefix="/api", tags=["Phone Call"])
app.include_router(speakers.router, prefix="/api", tags=["Speakers Management"])
app.include_router(eavesdrop.router, prefix="/api/eavesdrop", tags=["Eavesdrop Tracking"])
app.include_router(continuous_analysis.router, prefix="/api", tags=["Continuous Analysis"])
app.include_router(sovits_installer.router, tags=["GPT-SoVITS Installation"])


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
            print("[GPT-SoVITS] ⚠️  未配置安装路径，请访问 http://localhost:3000/admin 进行配置")
            return
        
        install_path = Path(config.install_path)
        if not install_path.exists():
            print(f"[GPT-SoVITS] ⚠️  安装路径不存在: {install_path}")
            print("[GPT-SoVITS] ⚠️  请访问 http://localhost:3000/admin 重新配置")
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
        python_exe = install_path / "runtime" / "python.exe"
        api_script = install_path / "api_v2.py"
        config_yaml = install_path / "GPT_SoVITS" / "configs" / "tts_infer.yaml"
        
        if not python_exe.exists():
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
            subprocess.Popen(cmd, cwd=str(install_path))
        
        print("[GPT-SoVITS] ✅ 服务已在新窗口中启动")
        
    except Exception as e:
        print(f"[GPT-SoVITS] ❌ 自动启动失败: {e}")
        print("[GPT-SoVITS] ⚠️  请手动启动或访问 http://localhost:3000/admin 配置")


# 实时对话路由
try:
    import sys
    realtime_path = os.path.join(os.path.dirname(__file__), "RealTime", "backend")
    if os.path.exists(realtime_path):
        sys.path.insert(0, os.path.dirname(realtime_path))
        from RealTime.backend.realtime_router import router as realtime_router
        app.include_router(realtime_router, prefix="/api/realtime", tags=["Realtime Chat"])
        print("[Manager] ✅ 实时对话路由已加载")
except Exception as e:
    print(f"[Manager] ⚠️ 实时对话路由加载失败: {e}")

if __name__ == "__main__":
    # 自动启动 GPT-SoVITS
    auto_start_sovits()
    
    # 必须是 0.0.0.0，否则局域网无法访问
    # access_log=False 禁用默认访问日志,使用自定义日志中间件
    uvicorn.run(app, host="0.0.0.0", port=3000, access_log=False)
