import os
import json
import glob
import hashlib
import uvicorn
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional

# ================= 配置区域 =================
PLUGIN_ROOT = os.path.dirname(os.path.abspath(__file__))
SETTINGS_FILE = os.path.join(PLUGIN_ROOT, "system_settings.json")
MAPPINGS_FILE = os.path.join(PLUGIN_ROOT, "character_mappings.json")

DEFAULT_BASE_DIR = os.path.join(PLUGIN_ROOT, "MyCharacters")
DEFAULT_CACHE_DIR = os.path.join(PLUGIN_ROOT, "Cache")
MAX_CACHE_SIZE_MB = 500
SOVITS_HOST = "http://127.0.0.1:9880"

# 全局变量
BASE_DIR = DEFAULT_BASE_DIR
CACHE_DIR = DEFAULT_CACHE_DIR
# ============================================

app = FastAPI()
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

# --- 辅助函数 ---
def load_json(filename):
    if os.path.exists(filename):
        try:
            with open(filename, 'r', encoding='utf-8') as f: return json.load(f)
        except: return {}
    return {}

def save_json(filename, data):
    try:
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving {filename}: {e}")

def init_settings():
    global BASE_DIR, CACHE_DIR
    settings = load_json(SETTINGS_FILE)
    dirty = False

    if settings.get("enabled") is None:
        settings["enabled"] = True
        dirty = True

    if settings.get("auto_generate") is None:
        settings["auto_generate"] = True
        dirty = True

    if not settings.get("base_dir"):
        settings["base_dir"] = DEFAULT_BASE_DIR
        dirty = True

    if not settings.get("cache_dir"):
        settings["cache_dir"] = DEFAULT_CACHE_DIR
        dirty = True

    # === 新增：默认语言设置 ===
    if not settings.get("default_lang"):
        settings["default_lang"] = "Chinese"
        dirty = True
    # === 新增：初始化美化卡模式设置 ===
    if settings.get("iframe_mode") is None:
        settings["iframe_mode"] = False  # 默认为 False (关闭)
        dirty = True
    # ================================

    if dirty:
        save_json(SETTINGS_FILE, settings)

    BASE_DIR = settings["base_dir"]
    CACHE_DIR = settings["cache_dir"]

    # 确保物理路径存在
    if not os.path.exists(CACHE_DIR): os.makedirs(CACHE_DIR, exist_ok=True)
    if not os.path.exists(BASE_DIR): os.makedirs(BASE_DIR, exist_ok=True)

    return settings

# 启动时初始化
init_settings()

def maintain_cache_size():
    try:
        if not os.path.exists(CACHE_DIR): return
        files = []
        total_size = 0
        with os.scandir(CACHE_DIR) as it:
            for entry in it:
                if entry.is_file() and entry.name.endswith('.wav'):
                    stat = entry.stat()
                    files.append({"path": entry.path, "size": stat.st_size, "mtime": stat.st_mtime})
                    total_size += stat.st_size
        if (total_size / (1024 * 1024)) < MAX_CACHE_SIZE_MB: return
        files.sort(key=lambda x: x["mtime"])
        for f in files:
            try:
                os.remove(f["path"])
                total_size -= f["size"]
                if (total_size / (1024 * 1024)) < (MAX_CACHE_SIZE_MB * 0.9): break
            except: pass
    except: pass

# --- 数据模型 (Pydantic) 修复 ---
# 1. 修复绑定请求：前端发的是 model_folder，不是 model_name
class BindRequest(BaseModel):
    char_name: str
    model_folder: str

class UnbindRequest(BaseModel):
    char_name: str

# 2. 修复创建文件夹请求：前端发的是 folder_name
class CreateModelRequest(BaseModel):
    folder_name: str

# 3. 修复设置请求：增加 enabled 字段，并将所有字段设为可选(Optional)
# manager.py 里的 SettingsRequest 类
class SettingsRequest(BaseModel):
    enabled: Optional[bool] = None
    auto_generate: Optional[bool] = None
    base_dir: Optional[str] = None
    cache_dir: Optional[str] = None
    default_lang: Optional[str] = None
    iframe_mode: Optional[bool] = None

# --- 接口 ---

# --- 提取一个扫描文件夹内音频的辅助函数 ---
def scan_audio_files(directory):
    refs = []
    if not os.path.exists(directory): return refs
    for f in os.listdir(directory):
        if f.lower().endswith(('.wav', '.mp3')):
            name = os.path.splitext(f)[0]
            # 兼容处理文件名： emotion_text.wav 或 text.wav
            parts = name.split('_', 1) if "_" in name else ["default", name]
            # 为了防止路径问题，这里存相对路径可能更好，但为了兼容旧逻辑，我们存绝对路径
            refs.append({"emotion": parts[0], "text": parts[1], "path": os.path.join(directory, f)})
    return refs
@app.get("/get_data")
def get_data():
    settings = init_settings()
    models_data = {}

    if os.path.exists(BASE_DIR):
        for folder_name in os.listdir(BASE_DIR):
            folder_path = os.path.join(BASE_DIR, folder_name)
            if not os.path.isdir(folder_path): continue

            gpt = glob.glob(os.path.join(folder_path, "*.ckpt"))
            sovits = glob.glob(os.path.join(folder_path, "*.pth"))

            ref_dir = os.path.join(folder_path, "reference_audios")

            # === 修改开始：支持多语言层级结构 ===
            # 结构目标: reference_audios -> [Language] -> emotions -> [files]

            languages_map = {} # 格式: {"Chinese": [ref_list], "Japanese": [ref_list]}

            if os.path.exists(ref_dir):
                # 1. 扫描根目录 (兼容旧模式，归为 "default")
                root_refs = scan_audio_files(ref_dir)
                if root_refs:
                    languages_map["default"] = root_refs

                # 2. 扫描子文件夹 (视为语言)
                # 2. 扫描子文件夹 (视为语言)
                with os.scandir(ref_dir) as it:
                    for entry in it:
                        if entry.is_dir():
                            raw_folder_name = entry.name

                            # === 新增：文件夹名称映射逻辑 ===
                            # 将 "中文" 映射为 "Chinese"，这样前端选 Chinese 时也能读到这个文件夹
                            target_lang_key = raw_folder_name
                            if raw_folder_name == "中文":
                                target_lang_key = "Chinese"
                            # 你也可以在这里加更多映射，比如 "日语" -> "Japanese"
                            # ============================

                            # 按照你的要求，音频必须在 语言文件夹/emotions 下
                            emotions_subdir = os.path.join(entry.path, "emotions")

                            found_refs = [] # 临时存储找到的音频

                            if os.path.exists(emotions_subdir):
                                found_refs = scan_audio_files(emotions_subdir)
                            else:
                                # 如果没有 emotions 文件夹，直接扫语言文件夹本身 (可选的容错)
                                found_refs = scan_audio_files(entry.path)

                            # === 修改：合并数据而不是覆盖 ===
                            if found_refs:
                                if target_lang_key not in languages_map:
                                    languages_map[target_lang_key] = []
                                languages_map[target_lang_key].extend(found_refs)

            # 决定前端默认显示的列表 (如果有 default 用 default，否则用第一个语言)
            # 前端现在会接收整个 languages_map
            # === 修改结束 ===

            models_data[folder_name] = {
                "gpt_path": gpt[0] if gpt else "",
                "sovits_path": sovits[0] if sovits else "",
                "languages": languages_map # 新增字段：返回所有语言数据
            }

    mappings = load_json(MAPPINGS_FILE)
    return { "models": models_data, "mappings": mappings, "settings": settings }

# === 新增：模型切换代理接口 ===
@app.get("/proxy_set_gpt_weights")
def proxy_set_gpt_weights(weights_path: str):
    try:
        # manager 帮你去请求本地的 SoVITS
        url = f"{SOVITS_HOST}/set_gpt_weights"
        resp = requests.get(url, params={"weights_path": weights_path}, timeout=10)
        return {"status": resp.status_code, "detail": resp.text}
    except Exception as e:
        print(f"Set GPT Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/proxy_set_sovits_weights")
def proxy_set_sovits_weights(weights_path: str):
    try:
        url = f"{SOVITS_HOST}/set_sovits_weights"
        resp = requests.get(url, params={"weights_path": weights_path}, timeout=10)
        return {"status": resp.status_code, "detail": resp.text}
    except Exception as e:
        print(f"Set SoVITS Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
# ============================
@app.get("/tts_proxy")
def tts_proxy(text: str, text_lang: str, ref_audio_path: str, prompt_text: str, prompt_lang: str, streaming_mode: str, check_only: Optional[str] = None):
    try:
        # 生成缓存Key
        raw_key = f"{text}_{ref_audio_path}_{prompt_text}_{text_lang}_{prompt_lang}"
        file_hash = hashlib.md5(raw_key.encode('utf-8')).hexdigest()
        cache_file_path = os.path.join(CACHE_DIR, f"{file_hash}.wav")

        if check_only == "true":
            return {"cached": os.path.exists(cache_file_path)}

        if os.path.exists(cache_file_path):
            return FileResponse(cache_file_path, media_type="audio/wav")

        maintain_cache_size()

        # 转发请求给 SoVITS
        url = f"{SOVITS_HOST}/tts"
        params = {
            "text": text,
            "text_lang": text_lang,
            "ref_audio_path": ref_audio_path,
            "prompt_text": prompt_text,
            "prompt_lang": prompt_lang,
            "streaming_mode": "true"
        }

        try:
            r = requests.get(url, params=params, stream=True, timeout=60)
        except requests.exceptions.RequestException:
            raise HTTPException(status_code=503, detail="无法连接到 SoVITS 服务，请检查 9880 端口")

        if r.status_code != 200:
            raise HTTPException(status_code=500, detail=f"SoVITS Error: {r.status_code}")

        def iter_and_save():
            try:
                with open(cache_file_path, "wb") as f:
                    for chunk in r.iter_content(chunk_size=4096):
                        if chunk:
                            f.write(chunk)
                            yield chunk
            except Exception as e:
                print(f"流传输/写入失败: {e}")

        return StreamingResponse(iter_and_save(), media_type="audio/wav")

    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"General TTS Error: {e}")
        raise HTTPException(status_code=500, detail="TTS Server Internal Error")

@app.post("/clear_cache")
def clear_cache():
    if not os.path.exists(CACHE_DIR): return {"status": "empty"}
    for f in glob.glob(os.path.join(CACHE_DIR, "*.wav")):
        try: os.remove(f)
        except: pass
    return {"status": "success"}

@app.post("/bind_character")
def bind(req: BindRequest):
    # 使用 model_folder 匹配前端
    m = load_json(MAPPINGS_FILE)
    m[req.char_name] = req.model_folder
    save_json(MAPPINGS_FILE, m)
    return {"status": "success"}

@app.post("/unbind_character")
def unbind(req: UnbindRequest):
    m = load_json(MAPPINGS_FILE)
    if req.char_name in m:
        del m[req.char_name]
        save_json(MAPPINGS_FILE, m)
    return {"status": "success"}

@app.post("/create_model_folder")
def create(req: CreateModelRequest):
    # 简单的安全过滤
    safe_name = "".join([c for c in req.folder_name if c.isalnum() or c in (' ','_','-')]).strip()
    if not safe_name: return {"status": "error", "msg": "Invalid name"}

    target_path = os.path.join(BASE_DIR, safe_name)

    # === 修改部分：自动创建多语言目录结构 ===
    # 1. 创建基础目录
    ref_root = os.path.join(target_path, "reference_audios")

    # 2. 预创建常用语言包结构，省去手动新建文件夹的麻烦
    # 你可以在这里添加更多默认语言
    for lang in ["Chinese", "Japanese", "English"]:
        os.makedirs(os.path.join(ref_root, lang, "emotions"), exist_ok=True)

    # 3. 如果需要，也可以保留旧的根目录模式（可选）
    os.makedirs(ref_root, exist_ok=True)
    # === 修改结束 ===

    return {"status": "success"}

@app.post("/update_settings")
def update(req: SettingsRequest):
    s = load_json(SETTINGS_FILE)

    if req.enabled is not None: s["enabled"] = req.enabled
    if req.auto_generate is not None: s["auto_generate"] = req.auto_generate
    if req.base_dir and req.base_dir.strip(): s["base_dir"] = req.base_dir.strip()
    if req.cache_dir and req.cache_dir.strip(): s["cache_dir"] = req.cache_dir.strip()

    # === 新增 ===
    if req.default_lang is not None:
        s["default_lang"] = req.default_lang
    # ===========

    # === 新增：保存美化卡模式 ===
    if req.iframe_mode is not None:
        s["iframe_mode"] = req.iframe_mode

    save_json(SETTINGS_FILE, s)
    init_settings() # 刷新全局变量
    return {"status": "success", "settings": s}
if __name__ == "__main__":
    # 必须是 0.0.0.0，否则手机连不上 manager
    uvicorn.run(app, host="0.0.0.0", port=3000)
