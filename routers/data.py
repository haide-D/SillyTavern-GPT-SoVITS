import os
import glob
from fastapi import APIRouter
from fastapi.responses import FileResponse
from config import init_settings, load_json, save_json, get_current_dirs, MAPPINGS_FILE, SETTINGS_FILE
from utils import scan_audio_files
from schemas import BindRequest, UnbindRequest, CreateModelRequest, StyleRequest
import json
import re
import shutil
import uuid
from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional, Dict
from database import DatabaseManager

db = DatabaseManager()

router = APIRouter()

# 2. 定义数据模型 (方便 FastAPI 解析)
class FavoriteItem(BaseModel):
    text: str
    audio_url: str
    char_name: str
    context: Optional[List[str]] = []
    tags: Optional[str] = ""
    filename: Optional[str] = None
    chat_branch: Optional[str] = "Unknown"
    fingerprint: Optional[str] = ""
    emotion: Optional[str] = ""

class DeleteFavRequest(BaseModel):
    id: str
class MatchRequest(BaseModel):
    char_name: str
    fingerprints: List[str]
    chat_branch: Optional[str] = None
# 定义收藏文件路径 (Legacy JSON path removed)

@router.get("/get_data")
def get_data():
    settings = init_settings()
    base_dir = settings["base_dir"]
    models_data = {}

    if os.path.exists(base_dir):
        for folder_name in os.listdir(base_dir):
            folder_path = os.path.join(base_dir, folder_name)
            if not os.path.isdir(folder_path): continue

            gpt = glob.glob(os.path.join(folder_path, "*.ckpt"))
            sovits = glob.glob(os.path.join(folder_path, "*.pth"))
            ref_dir = os.path.join(folder_path, "reference_audios")

            languages_map = {}

            if os.path.exists(ref_dir):
                # 1. 扫描根目录 (兼容旧模式)
                root_refs = scan_audio_files(ref_dir)
                if root_refs:
                    languages_map["default"] = root_refs

                # 2. 扫描子文件夹 (多语言支持)
                with os.scandir(ref_dir) as it:
                    for entry in it:
                        if entry.is_dir():
                            raw_folder_name = entry.name
                            target_lang_key = "Chinese" if raw_folder_name == "中文" else raw_folder_name

                            emotions_subdir = os.path.join(entry.path, "emotions")
                            found_refs = []

                            if os.path.exists(emotions_subdir):
                                found_refs = scan_audio_files(emotions_subdir)
                            else:
                                found_refs = scan_audio_files(entry.path)

                            if found_refs:
                                if target_lang_key not in languages_map:
                                    languages_map[target_lang_key] = []
                                languages_map[target_lang_key].extend(found_refs)

            models_data[folder_name] = {
                "gpt_path": gpt[0] if gpt else "",
                "sovits_path": sovits[0] if sovits else "",
                "languages": languages_map
            }

    mappings = load_json(MAPPINGS_FILE)
    return { "models": models_data, "mappings": mappings, "settings": settings }

@router.post("/bind_character")
def bind(req: BindRequest):
    m = load_json(MAPPINGS_FILE)
    m[req.char_name] = req.model_folder
    save_json(MAPPINGS_FILE, m)
    return {"status": "success"}

@router.post("/unbind_character")
def unbind(req: UnbindRequest):
    m = load_json(MAPPINGS_FILE)
    if req.char_name in m:
        del m[req.char_name]
        save_json(MAPPINGS_FILE, m)
    return {"status": "success"}

@router.post("/create_model_folder")
def create(req: CreateModelRequest):
    base_dir, _ = get_current_dirs()

    safe_name = "".join([c for c in req.folder_name if c.isalnum() or c in (' ','_','-')]).strip()
    if not safe_name: return {"status": "error", "msg": "Invalid name"}

    target_path = os.path.join(base_dir, safe_name)
    ref_root = os.path.join(target_path, "reference_audios")

    # 预创建常用语言包结构
    for lang in ["Chinese", "Japanese", "English"]:
        os.makedirs(os.path.join(ref_root, lang, "emotions"), exist_ok=True)

    os.makedirs(ref_root, exist_ok=True) # 确保根目录存在

    return {"status": "success"}
@router.post("/save_style")
def save_style(req: StyleRequest):
    # 1. 读取现有的系统设置
    settings = load_json(SETTINGS_FILE)

    # 2. 更新风格字段
    settings["bubble_style"] = req.style

    # 3. 写回 system_settings.json
    save_json(SETTINGS_FILE, settings)

    return {"status": "success", "current_style": req.style}

@router.get("/get_favorites")
def get_favorites():
    return {"favorites": db.get_all_favorites()}

    # 定义目录常量
CACHE_DIR = "Cache"
FAV_AUDIO_DIR = "data/favorites_audio"
@router.post("/add_favorite")
def add_favorite(item: FavoriteItem):

    new_entry = item.dict()
    new_entry["id"] = str(uuid.uuid4())
    new_entry["created_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # === 【安全修改 1】 ===
    clean_filename = os.path.basename(item.filename) if item.filename else None

    if clean_filename:
        # 确保目标文件夹存在
        os.makedirs(FAV_AUDIO_DIR, exist_ok=True)
        # 强制限制在 CACHE_DIR 内部
        source_path = os.path.join(CACHE_DIR, clean_filename)
        target_filename = f"fav_{new_entry['id']}_{clean_filename}"
        target_path = os.path.join(FAV_AUDIO_DIR, target_filename)
        # 检查源文件
        if os.path.exists(source_path):
            try:
                shutil.copy2(source_path, target_path)
                print(f"✅ [收藏] 音频已备份: {target_path}")
                new_entry["audio_url"] = f"/favorites/{target_filename}"
                new_entry["relative_path"] = target_filename
                new_entry["filename"] = clean_filename
            except Exception as e:
                print(f"⚠️ [收藏] 备份失败: {e}")
        else:
            print(f"⚠️ [收藏] 源文件 {source_path} 未找到，仅保存文本记录。")

    db.add_favorite(new_entry)
    return {"status": "success", "id": new_entry["id"]}
@router.post("/delete_favorite")
def delete_favorite(req: DeleteFavRequest):
    target_fav = db.get_favorite(req.id)

    if target_fav:
        filename_to_del = target_fav.get("relative_path")
        if not filename_to_del and target_fav.get("audio_url", "").startswith("/favorites/"):
            filename_to_del = target_fav["audio_url"].replace("/favorites/", "")
        if filename_to_del:
            # === 【安全修改 2：防止越狱删除】 ===
            safe_filename = os.path.basename(filename_to_del)
            abs_base_dir = os.path.abspath(FAV_AUDIO_DIR)
            abs_target_path = os.path.abspath(os.path.join(FAV_AUDIO_DIR, safe_filename))
            if abs_target_path.startswith(abs_base_dir) and os.path.exists(abs_target_path) and os.path.isfile(abs_target_path):
                try:
                    os.remove(abs_target_path)
                    print(f"🗑️ [删除] 已清理物理文件: {abs_target_path}")
                except Exception as e:
                    print(f"⚠️ [删除] 文件删除失败: {e}")
            else:
                print(f"🚫 [安全拦截] 试图删除非收藏目录文件或文件不存在: {abs_target_path}")
        
        db.delete_favorite(req.id)

    return {"status": "success"}
@router.post("/get_matched_favorites")
def get_matched_favorites(req: MatchRequest):
    result_data = db.get_matched_favorites(req.fingerprints, req.chat_branch)
    return {
        "status": "success",
        "data": result_data
    }

# 🔧 新增:下载端点,解决 CORS 问题
@router.get("/download_favorite/{filename}")
def download_favorite(filename: str, custom_filename: Optional[str] = None):
    """
    专门用于下载收藏音频的端点
    - 自动添加 CORS 头
    - 设置 Content-Disposition: attachment (触发下载)
    - 支持自定义下载文件名
    """
    # 安全检查:只允许文件名,不允许路径遍历
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(FAV_AUDIO_DIR, safe_filename)
    
    # 验证文件存在且在正确的目录中
    abs_base_dir = os.path.abspath(FAV_AUDIO_DIR)
    abs_file_path = os.path.abspath(file_path)
    
    if not abs_file_path.startswith(abs_base_dir):
        return {"status": "error", "msg": "Invalid file path"}
    
    if not os.path.exists(abs_file_path):
        return {"status": "error", "msg": "File not found"}
    
    # 使用自定义文件名或原始文件名
    if custom_filename:
        # 🔒 安全验证:清理自定义文件名
        # 1. 移除路径分隔符,防止路径遍历
        safe_custom = os.path.basename(custom_filename)
        # 2. 移除控制字符(包括换行符),防止 HTTP 头注入
        safe_custom = ''.join(char for char in safe_custom if ord(char) >= 32 and char not in '\r\n')
        # 3. 限制长度,防止过长文件名
        safe_custom = safe_custom[:255]
        # 4. 确保有扩展名
        if not safe_custom.endswith('.wav'):
            safe_custom = safe_custom + '.wav'
        download_filename = safe_custom
    else:
        download_filename = safe_filename
    
    # 返回文件,设置 Content-Disposition 为 attachment
    # 🔧 使用 RFC 2231 编码支持中文文件名
    from urllib.parse import quote
    
    # URL 编码文件名以支持中文
    encoded_filename = quote(download_filename.encode('utf-8'))
    
    return FileResponse(
        path=abs_file_path,
        media_type="audio/wav",
        headers={
            # 使用 RFC 2231 格式: filename*=UTF-8''encoded_filename
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*"
        }
    )

