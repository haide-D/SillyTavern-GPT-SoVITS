from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse
from typing import Optional
import os
import shutil

from config import init_settings, save_json, SETTINGS_FILE

from utils_admin.service_manager import ServiceManager
from utils_admin.model_manager import ModelManager
from utils_admin.version_manager import VersionManager

router = APIRouter()

# ==================== 系统状态 ====================

@router.get("/status")
async def get_system_status():
    """获取系统整体状态"""
    return ServiceManager.get_system_status()

# ==================== 模型管理 ====================

@router.get("/models")
async def get_models():
    """获取所有模型列表"""
    settings = init_settings()
    base_dir = settings.get("base_dir")
    
    if not base_dir or not os.path.exists(base_dir):
        return {
            "models": [],
            "base_dir": base_dir,
            "error": "模型目录不存在"
        }
    
    manager = ModelManager(base_dir)
    models = manager.scan_models()
    
    return {
        "models": models,
        "base_dir": base_dir,
        "total": len(models)
    }

@router.post("/models/create")
async def create_model(
    model_name: str = Form(...),
    gpt_file: Optional[UploadFile] = File(None),
    sovits_file: Optional[UploadFile] = File(None)
):
    """创建新模型目录结构,可选上传模型文件"""
    settings = init_settings()
    base_dir = settings.get("base_dir")
    
    if not base_dir:
        raise HTTPException(status_code=400, detail="模型目录未配置")
    
    # 验证文件格式
    if gpt_file and not gpt_file.filename.lower().endswith('.ckpt'):
        raise HTTPException(status_code=400, detail="GPT模型文件必须是.ckpt格式")
    
    if sovits_file and not sovits_file.filename.lower().endswith('.pth'):
        raise HTTPException(status_code=400, detail="SoVITS模型文件必须是.pth格式")
    
    manager = ModelManager(base_dir)
    result = manager.create_model_structure(model_name, gpt_file, sovits_file)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error"))
    
    return result

@router.get("/models/{model_name}/audios")
async def get_model_audios(model_name: str):
    """获取指定模型的参考音频列表"""
    settings = init_settings()
    base_dir = settings.get("base_dir")
    
    if not base_dir:
        raise HTTPException(status_code=400, detail="模型目录未配置")
    
    manager = ModelManager(base_dir)
    audios = manager.get_reference_audios(model_name)
    
    return {
        "model_name": model_name,
        "audios": audios,
        "total": len(audios)
    }

@router.post("/models/{model_name}/audios/upload")
async def upload_audio(
    model_name: str,
    language: str,
    emotion: str,
    file: UploadFile = File(...)
):
    """上传参考音频"""
    settings = init_settings()
    base_dir = settings.get("base_dir")
    
    if not base_dir:
        raise HTTPException(status_code=400, detail="模型目录未配置")
    
    # 验证文件类型
    if not file.filename.lower().endswith(('.wav', '.mp3', '.ogg', '.flac')):
        raise HTTPException(status_code=400, detail="不支持的音频格式")
    
    # 构建目标路径
    model_path = os.path.join(base_dir, model_name)
    if not os.path.exists(model_path):
        raise HTTPException(status_code=404, detail=f"模型 '{model_name}' 不存在")
    
    # 确定保存路径
    if language in ["Chinese", "Japanese", "English"]:
        target_dir = os.path.join(model_path, "reference_audios", language, "emotions")
    else:
        target_dir = os.path.join(model_path, "reference_audios")
    
    os.makedirs(target_dir, exist_ok=True)
    
    # 构建文件名: emotion_originalname.ext
    original_name = file.filename
    name_without_ext = os.path.splitext(original_name)[0]
    ext = os.path.splitext(original_name)[1]
    
    # 如果文件名已经包含情感标签,保持原样;否则添加
    if not name_without_ext.startswith(f"{emotion}_"):
        new_filename = f"{emotion}_{original_name}"
    else:
        new_filename = original_name
    
    target_path = os.path.join(target_dir, new_filename)
    
    # 保存文件
    try:
        with open(target_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # 【新增】检查音频时长
        from utils import get_audio_duration, pad_audio_to_duration
        
        duration = get_audio_duration(target_path)
        
        if duration is None:
            # 无法读取音频时长,删除文件并报错
            os.remove(target_path)
            raise HTTPException(status_code=400, detail="无法读取音频文件,请检查文件格式")
        
        # 检查时长范围
        if duration > 10.0:
            # 音频过长,删除文件并报错
            os.remove(target_path)
            raise HTTPException(
                status_code=400, 
                detail=f"音频时长过长 ({duration:.2f}秒),GPT-SoVITS 要求参考音频在 3-10 秒范围内。请剪辑后重新上传。"
            )
        
        auto_padded = False
        if duration < 3.0:
            # 音频过短,自动填充到 3 秒
            print(f"⚠️ 音频过短 ({duration:.2f}秒),自动填充到 3 秒: {new_filename}")
            success = pad_audio_to_duration(target_path, 3.0)
            if not success:
                os.remove(target_path)
                raise HTTPException(
                    status_code=500, 
                    detail=f"音频时长过短 ({duration:.2f}秒),自动填充失败。请手动延长音频后重新上传。"
                )
            auto_padded = True
            duration = 3.0  # 更新时长
        
        return {
            "success": True,
            "filename": new_filename,
            "path": target_path,
            "duration": duration,
            "auto_padded": auto_padded,
            "message": f"上传成功! 音频时长: {duration:.2f}秒" + (" (已自动填充)" if auto_padded else "")
        }
    except HTTPException:
        raise
    except Exception as e:
        # 清理可能已保存的文件
        if os.path.exists(target_path):
            os.remove(target_path)
        raise HTTPException(status_code=500, detail=f"文件保存失败: {str(e)}")

@router.delete("/models/{model_name}/audios")
async def delete_audio(model_name: str, relative_path: str):
    """删除参考音频"""
    settings = init_settings()
    base_dir = settings.get("base_dir")
    
    if not base_dir:
        raise HTTPException(status_code=400, detail="模型目录未配置")
    
    manager = ModelManager(base_dir)
    result = manager.delete_audio(model_name, relative_path)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error"))
    
    return result

@router.put("/models/{model_name}/audios/rename")
async def rename_audio(model_name: str, relative_path: str, new_filename: str):
    """重命名参考音频"""
    settings = init_settings()
    base_dir = settings.get("base_dir")
    
    if not base_dir:
        raise HTTPException(status_code=400, detail="模型目录未配置")
    
    manager = ModelManager(base_dir)
    result = manager.rename_audio(model_name, relative_path, new_filename)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error"))
    
    return result

@router.post("/models/{model_name}/audios/batch-emotion")
async def batch_update_emotion(model_name: str, old_emotion: str, new_emotion: str):
    """批量修改情感前缀"""
    settings = init_settings()
    base_dir = settings.get("base_dir")
    
    if not base_dir:
        raise HTTPException(status_code=400, detail="模型目录未配置")
    
    manager = ModelManager(base_dir)
    result = manager.batch_update_emotion(model_name, old_emotion, new_emotion)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error"))
    
    return result

# ==================== 配置管理 ====================

@router.get("/settings")
async def get_settings():
    """获取系统配置"""
    return init_settings()

@router.post("/settings")
async def update_settings(settings: dict):
    """更新系统配置"""
    try:
        current = init_settings()
        
        # 深度合并配置,而不是浅更新
        def deep_merge(base: dict, updates: dict) -> dict:
            """深度合并两个字典"""
            result = base.copy()
            for key, value in updates.items():
                if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                    # 递归合并嵌套字典
                    result[key] = deep_merge(result[key], value)
                else:
                    # 直接覆盖
                    result[key] = value
            return result
        
        current = deep_merge(current, settings)
        save_json(SETTINGS_FILE, current)
        
        # 确保新路径存在
        if "base_dir" in settings:
            os.makedirs(settings["base_dir"], exist_ok=True)
        if "cache_dir" in settings:
            os.makedirs(settings["cache_dir"], exist_ok=True)
        
        return {
            "success": True,
            "settings": current
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"配置保存失败: {str(e)}")

# ==================== 音频文件流式传输 ====================

@router.get("/models/{model_name}/audios/stream")
async def stream_audio(model_name: str, relative_path: str):
    """流式传输参考音频文件"""
    settings = init_settings()
    base_dir = settings.get("base_dir")
    
    if not base_dir:
        raise HTTPException(status_code=400, detail="模型目录未配置")
    
    # 构建完整路径 (relative_path 是相对于 reference_audios 目录的)
    model_path = os.path.join(base_dir, model_name)
    ref_audio_dir = os.path.join(model_path, "reference_audios")
    # 将前端的正斜杠路径转换为系统路径分隔符
    relative_path = relative_path.replace('/', os.sep)
    audio_path = os.path.join(ref_audio_dir, relative_path)
    
    # 安全验证:确保路径在模型目录内
    audio_path = os.path.normpath(audio_path)
    model_path = os.path.normpath(model_path)
    
    if not audio_path.startswith(model_path):
        raise HTTPException(status_code=403, detail="非法路径访问")
    
    # 检查文件是否存在
    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="音频文件不存在")
    
    # 返回音频文件
    return FileResponse(
        audio_path,
        media_type="audio/wav",
        headers={"Accept-Ranges": "bytes"}
    )

# ==================== 版本管理 ====================

@router.get("/version/check")
async def check_version():
    """检查是否有可用更新"""
    try:
        manager = VersionManager()
        result = manager.check_for_updates()
        return result
    except Exception as e:
        return {
            "success": False,
            "error": f"检查更新失败: {str(e)}"
        }

@router.post("/version/update")
async def update_version():
    """执行版本更新"""
    try:
        manager = VersionManager()
        
        # 直接执行更新,download_and_update 会自动处理 Git 仓库和 ZIP 下载两种情况
        result = manager.download_and_update()
        
        if not result.get('success'):
            raise HTTPException(status_code=500, detail=result.get('error', '更新失败'))
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"更新失败: {str(e)}")

@router.post("/restart")
async def restart_service():
    """重启服务"""
    import sys
    import asyncio
    
    async def delayed_restart():
        """延迟重启,确保响应能够返回"""
        await asyncio.sleep(1)  # 等待1秒,确保响应已发送
        try:
            # 在 Windows 上重启服务
            if sys.platform == 'win32':
                # 使用 os.execv 重启当前进程
                import os
                python = sys.executable
                os.execv(python, [python] + sys.argv)
            else:
                # Unix-like 系统
                import os
                os.execv(sys.executable, [sys.executable] + sys.argv)
        except Exception as e:
            print(f"重启失败: {e}")
    
    # 在后台执行重启
    asyncio.create_task(delayed_restart())
    
    return {
        "success": True,
        "message": "服务正在重启..."
    }

