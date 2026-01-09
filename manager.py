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

    # 初始化默认值并回写，确保文件里有完整结构
    dirty = False
    if "enabled" not in settings:
        settings["enabled"] = True
        dirty = True
    if "auto_generate" not in settings:
        settings["auto_generate"] = True
        dirty = True
    if "base_dir" not in settings:
        settings["base_dir"] = DEFAULT_BASE_DIR
        dirty = True
    if "cache_dir" not in settings:
        settings["cache_dir"] = DEFAULT_CACHE_DIR
        dirty = True

    if dirty:
        save_json(SETTINGS_FILE, settings)

    BASE_DIR = settings["base_dir"]
    CACHE_DIR = settings["cache_dir"]

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
class SettingsRequest(BaseModel):
    enabled: Optional[bool] = None       # 新增：对应总开关
    auto_generate: Optional[bool] = None # 对应自动生成
    base_dir: Optional[str] = None       # 对应路径设置
    cache_dir: Optional[str] = None

# --- 接口 ---
@app.get("/get_data")
def get_data():
    settings = init_settings() # 每次获取数据时重新加载一次配置，确保最新
    models_data = {}

    if os.path.exists(BASE_DIR):
        for folder_name in os.listdir(BASE_DIR):
            folder_path = os.path.join(BASE_DIR, folder_name)
            if not os.path.isdir(folder_path): continue

            # 扫描逻辑
            gpt = glob.glob(os.path.join(folder_path, "*.ckpt"))
            sovits = glob.glob(os.path.join(folder_path, "*.pth"))

            # 如果没找到模型文件，跳过展示，或者是空模型文件夹
            # if not gpt and not sovits: continue

            ref_dir = os.path.join(folder_path, "ref_audio")
            refs = []
            if os.path.exists(ref_dir):
                for f in os.listdir(ref_dir):
                    if f.lower().endswith(('.wav', '.mp3')):
                        name = os.path.splitext(f)[0]
                        # 兼容处理文件名： emotion_text.wav 或 text.wav
                        parts = name.split('_', 1) if "_" in name else ["default", name]
                        refs.append({"emotion": parts[0], "text": parts[1], "path": os.path.join(ref_dir, f)})

            default_ref = next((r for r in refs if r["emotion"] == "default"), refs[0] if refs else None)

            models_data[folder_name] = {
                "gpt_path": gpt[0] if gpt else "",
                "sovits_path": sovits[0] if sovits else "",
                "default_ref": default_ref,
                "emotion_refs": refs
            }

    mappings = load_json(MAPPINGS_FILE)
    return { "models": models_data, "mappings": mappings, "settings": settings }

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
    # 使用 folder_name 匹配前端
    # 简单的安全过滤，防止路径遍历
    safe_name = "".join([c for c in req.folder_name if c.isalnum() or c in (' ','_','-')]).strip()
    if not safe_name: return {"status": "error", "msg": "Invalid name"}

    target_path = os.path.join(BASE_DIR, safe_name)
    os.makedirs(os.path.join(target_path, "ref_audio"), exist_ok=True)
    return {"status": "success"}

@app.post("/update_settings")
def update(req: SettingsRequest):
    s = load_json(SETTINGS_FILE)

    # 逐个检查字段是否更新
    if req.enabled is not None:
        s["enabled"] = req.enabled

    if req.auto_generate is not None:
        s["auto_generate"] = req.auto_generate

    if req.base_dir and req.base_dir.strip():
        s["base_dir"] = req.base_dir.strip()

    if req.cache_dir and req.cache_dir.strip():
        s["cache_dir"] = req.cache_dir.strip()

    save_json(SETTINGS_FILE, s)

    # 立即更新全局变量
    init_settings()

    return {"status": "success", "settings": s}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=3000)
