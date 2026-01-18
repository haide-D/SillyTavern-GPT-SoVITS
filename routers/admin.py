from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from typing import Optional
import os
import shutil

from config import init_settings, save_json, SETTINGS_FILE

from utils_admin.service_manager import ServiceManager
from utils_admin.model_manager import ModelManager

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
async def create_model(model_name: str):
    """创建新模型目录结构"""
    settings = init_settings()
    base_dir = settings.get("base_dir")
    
    if not base_dir:
        raise HTTPException(status_code=400, detail="模型目录未配置")
    
    manager = ModelManager(base_dir)
    result = manager.create_model_structure(model_name)
    
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
        
        return {
            "success": True,
            "filename": new_filename,
            "path": target_path
        }
    except Exception as e:
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
        current.update(settings)
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
