import os
import glob
from fastapi import APIRouter
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

class DeleteFavRequest(BaseModel):
    id: str
class MatchRequest(BaseModel):
    char_name: str
    fingerprints: List[str]
    chat_branch: Optional[str] = None
# 定义收藏文件路径
FAVORITES_FILE = "data/favorites.json"

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

def _load_favs():
    if not os.path.exists(FAVORITES_FILE):
        return []
    return load_json(FAVORITES_FILE)

@router.get("/get_favorites")
def get_favorites():
    return {"favorites": _load_favs()}

    # 定义目录常量
CACHE_DIR = "Cache"
FAV_AUDIO_DIR = "data/favorites_audio"
@router.post("/add_favorite")
def add_favorite(item: FavoriteItem):
    favs = _load_favs()
    # 容错处理：防止 json 格式不对
    if isinstance(favs, dict):
        if "favorites" in favs and isinstance(favs["favorites"], list):
            favs = favs["favorites"]
        else:
            favs = []

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

    favs.insert(0, new_entry)
    save_json(FAVORITES_FILE, favs)
    return {"status": "success", "id": new_entry["id"]}
@router.post("/delete_favorite")
def delete_favorite(req: DeleteFavRequest):
    favs = _load_favs()
    target_fav = next((f for f in favs if f["id"] == req.id), None)

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
    new_favs = [f for f in favs if f["id"] != req.id]
    save_json(FAVORITES_FILE, new_favs)

    return {"status": "success"}
@router.post("/get_matched_favorites")
def get_matched_favorites(req: MatchRequest):
    all_favs = _load_favs()
    if req.char_name:
        target_favs = [f for f in all_favs if f.get('char_name') == req.char_name]
    else:
        target_favs = all_favs
    current_fp_set = set(req.fingerprints)

    result_current = []
    result_others = []

    for fav in target_favs:
        is_match = False
        fav_fp = fav.get('fingerprint')
        if fav_fp and fav_fp in current_fp_set:
            is_match = True
        elif req.chat_branch and fav.get('chat_branch') == req.chat_branch:
            is_match = True

        # 3. 归类
        fav['is_current'] = is_match
        if is_match:
            result_current.append(fav)
        else:
            result_others.append(fav)

    return {
        "status": "success",
        "data": {
            "current": result_current,
            "others": result_others,
            "total_count": len(target_favs)
        }
    }
