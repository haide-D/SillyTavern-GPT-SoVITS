# -*- coding: utf-8 -*-
"""
GPT-SoVITS 安装向导与服务管理路由
"""
import os
import json
import asyncio
import subprocess
import threading
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, WebSocket
from pydantic import BaseModel

router = APIRouter(prefix="/api/sovits", tags=["GPT-SoVITS 安装管理"])

# 全局变量：GPT-SoVITS 进程
sovits_process: Optional[subprocess.Popen] = None
sovits_process_lock = threading.Lock()


# 版本配置
VERSION_CONFIGS = {
    "nvidia_general": {
        "name": "NVIDIA 通用版",
        "download_url": "https://www.modelscope.cn/models/FlowerCry/gpt-sovits-7z-pacakges/resolve/master/GPT-SoVITS-v2pro-20250604.7z",
        "startup_script": "api_v2.py",
        "description": "适用于 NVIDIA RTX 20/30/40 系列显卡"
    },
    "nvidia_50": {
        "name": "NVIDIA 50系列版",
        "download_url": "https://www.modelscope.cn/models/FlowerCry/gpt-sovits-7z-pacakges/resolve/master/GPT-SoVITS-v2pro-20250604-nvidia50.7z",
        "startup_script": "api_v2.py",
        "description": "适用于 NVIDIA RTX 50 系列显卡"
    },
    "amd": {
        "name": "AMD 版",
        "download_url": "",  # 暂时留空
        "startup_script": "api_v2.py",
        "description": "适用于 AMD 显卡（暂未提供）"
    }
}


class SovitsConfig(BaseModel):
    installed: bool = False
    version_type: str = "nvidia_general"
    install_path: str = ""
    auto_start: bool = True
    api_port: int = 9880


class StartServiceRequest(BaseModel):
    install_path: Optional[str] = None


def get_settings_path():
    """获取 system_settings.json 路径"""
    return Path(__file__).parent.parent / "system_settings.json"


def load_sovits_config() -> SovitsConfig:
    """加载 GPT-SoVITS 配置"""
    settings_path = get_settings_path()
    if settings_path.exists():
        with open(settings_path, "r", encoding="utf-8") as f:
            settings = json.load(f)
            if "sovits_installation" in settings:
                return SovitsConfig(**settings["sovits_installation"])
    return SovitsConfig()


def save_sovits_config(config: SovitsConfig):
    """保存 GPT-SoVITS 配置"""
    settings_path = get_settings_path()
    settings = {}
    if settings_path.exists():
        with open(settings_path, "r", encoding="utf-8") as f:
            settings = json.load(f)
    
    settings["sovits_installation"] = config.dict()
    
    with open(settings_path, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)


@router.get("/versions")
async def get_versions():
    """获取可用版本列表"""
    return {
        "versions": VERSION_CONFIGS,
        "default": "nvidia_general"
    }


@router.get("/config")
async def get_config():
    """获取当前 GPT-SoVITS 配置"""
    config = load_sovits_config()
    return {
        "config": config.dict(),
        "versions": VERSION_CONFIGS
    }


@router.post("/config")
async def update_config(config: SovitsConfig):
    """更新 GPT-SoVITS 配置"""
    save_sovits_config(config)
    return {"success": True, "message": "配置已保存"}


@router.post("/start")
async def start_service(request: StartServiceRequest = None):
    """启动 GPT-SoVITS API 服务（在新窗口中启动，方便查看日志）"""
    global sovits_process
    
    with sovits_process_lock:
        if sovits_process and sovits_process.poll() is None:
            return {"success": False, "message": "服务已在运行中"}
    
    config = load_sovits_config()
    install_path = request.install_path if request and request.install_path else config.install_path
    
    if not install_path:
        raise HTTPException(status_code=400, detail="未配置 GPT-SoVITS 安装路径")
    
    install_path = Path(install_path)
    if not install_path.exists():
        raise HTTPException(status_code=404, detail=f"安装路径不存在: {install_path}")
    
    # 查找 Python 和启动脚本
    python_exe = install_path / "runtime" / "python.exe"
    api_script = install_path / "api_v2.py"
    config_yaml = install_path / "GPT_SoVITS" / "configs" / "tts_infer.yaml"
    
    if not python_exe.exists():
        raise HTTPException(status_code=404, detail=f"未找到 Python: {python_exe}")
    
    if not api_script.exists():
        raise HTTPException(status_code=404, detail=f"未找到 API 脚本: {api_script}")
    
    try:
        # 构建启动命令
        cmd = [
            str(python_exe),
            str(api_script),
            "-a", "127.0.0.1",
            "-p", str(config.api_port)
        ]
        
        if config_yaml.exists():
            cmd.extend(["-c", str(config_yaml)])
        
        # 启动进程 - 在新窗口中启动，方便用户查看日志
        with sovits_process_lock:
            if os.name == 'nt':
                # Windows: 使用 CREATE_NEW_CONSOLE 在新窗口中启动
                sovits_process = subprocess.Popen(
                    cmd,
                    cwd=str(install_path),
                    creationflags=subprocess.CREATE_NEW_CONSOLE
                )
            else:
                # Linux/Mac: 正常启动
                sovits_process = subprocess.Popen(
                    cmd,
                    cwd=str(install_path)
                )
        
        # 等待一小段时间检查是否启动成功
        await asyncio.sleep(2)
        
        with sovits_process_lock:
            if sovits_process.poll() is not None:
                # 进程已退出
                raise HTTPException(status_code=500, detail="服务启动后立即退出，请检查新窗口中的错误信息")
        
        return {
            "success": True,
            "message": "GPT-SoVITS 服务已在新窗口中启动，请查看该窗口的日志输出",
            "pid": sovits_process.pid,
            "port": config.api_port
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"启动失败: {str(e)}")


@router.post("/stop")
async def stop_service():
    """停止 GPT-SoVITS API 服务"""
    global sovits_process
    
    with sovits_process_lock:
        if not sovits_process or sovits_process.poll() is not None:
            return {"success": True, "message": "服务未在运行"}
        
        try:
            import psutil
            
            # 使用 psutil 终止进程及其子进程
            parent = psutil.Process(sovits_process.pid)
            children = parent.children(recursive=True)
            
            for child in children:
                child.terminate()
            parent.terminate()
            
            # 等待进程结束
            gone, alive = psutil.wait_procs([parent] + children, timeout=5)
            
            # 强制杀死仍在运行的进程
            for p in alive:
                p.kill()
            
            sovits_process = None
            return {"success": True, "message": "服务已停止"}
            
        except Exception as e:
            # 尝试直接终止
            try:
                sovits_process.terminate()
                sovits_process = None
            except:
                pass
            return {"success": True, "message": f"服务已停止 (警告: {str(e)})"}


@router.get("/status")
async def get_status():
    """获取 GPT-SoVITS 服务状态"""
    global sovits_process
    
    config = load_sovits_config()
    
    # 检查进程状态
    process_running = False
    pid = None
    with sovits_process_lock:
        if sovits_process and sovits_process.poll() is None:
            process_running = True
            pid = sovits_process.pid
    
    # 尝试连接 API
    api_reachable = False
    try:
        import httpx
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"http://127.0.0.1:{config.api_port}/")
            api_reachable = response.status_code < 500
    except:
        pass
    
    return {
        "installed": config.installed,
        "install_path": config.install_path,
        "version_type": config.version_type,
        "auto_start": config.auto_start,
        "api_port": config.api_port,
        "process_running": process_running,
        "pid": pid,
        "api_reachable": api_reachable
    }


@router.post("/test")
async def test_connection():
    """测试 GPT-SoVITS API 连接"""
    config = load_sovits_config()
    
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            # 尝试获取模型列表或其他 API
            response = await client.get(f"http://127.0.0.1:{config.api_port}/")
            
            return {
                "success": True,
                "message": "连接成功",
                "status_code": response.status_code,
                "port": config.api_port
            }
    except httpx.ConnectError:
        return {
            "success": False,
            "message": f"无法连接到 http://127.0.0.1:{config.api_port}",
            "port": config.api_port
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"连接测试失败: {str(e)}",
            "port": config.api_port
        }
