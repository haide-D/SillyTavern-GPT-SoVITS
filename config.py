import os
import json

# ================= 路径配置 =================
# 获取当前文件所在目录作为插件根目录
PLUGIN_ROOT = os.path.dirname(os.path.abspath(__file__))

SETTINGS_FILE = os.path.join(PLUGIN_ROOT, "system_settings.json")
MAPPINGS_FILE = os.path.join(PLUGIN_ROOT, "character_mappings.json")
FRONTEND_DIR = os.path.join(PLUGIN_ROOT, "frontend")

# 默认值
DEFAULT_BASE_DIR = os.path.join(PLUGIN_ROOT, "MyCharacters")
DEFAULT_CACHE_DIR = os.path.join(PLUGIN_ROOT, "Cache")
MAX_CACHE_SIZE_MB = 500
SOVITS_HOST = "http://127.0.0.1:9880"

# ================= 配置加载逻辑 =================
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
    """初始化并读取设置，确保文件和目录存在"""
    settings = load_json(SETTINGS_FILE)
    dirty = False

    # 默认值检查
    defaults = {
        "enabled": True,
        "auto_generate": True,
        "base_dir": DEFAULT_BASE_DIR,
        "cache_dir": DEFAULT_CACHE_DIR,
        "default_lang": "Chinese",
        "iframe_mode": False,
        "bubble_style": "default",
        "sovits_host": SOVITS_HOST
    }

    for key, val in defaults.items():
        if settings.get(key) is None:
            settings[key] = val
            dirty = True
        elif (key == "base_dir" or key == "cache_dir") and not settings.get(key):
            # 防止空字符串路径
            settings[key] = val
            dirty = True

    # phone_call 配置默认值
    if "phone_call" not in settings:
        settings["phone_call"] = {
            "enabled": True,
            "trigger": {
                "type": "message_count",
                "threshold": 5
            },
            "llm": {
                "api_url": "",  # 用户自定义
                "api_key": "",  # 用户自定义
                "model": "gemini-2.5-flash",
                "temperature": 0.8,
                "max_tokens": 500
            },
            "data_extractors": [
                {
                    "name": "summary",
                    "pattern": "<总结>([\\s\\S]*?)</总结>",
                    "scope": "character_only",
                    "description": "提取角色消息中的总结内容"
                }
            ],
            "response_parser": {
                "format": "json",
                "fallback_emotion": "default",
                "validate_speed_range": [0.5, 2.0],
                "validate_pause_range": [0.1, 3.0]
            },
            "audio_merge": {
                "silence_between_segments": 0.5,
                "normalize_volume": False,
                "output_format": "wav"
            },
            "tts_config": {
                "text_lang": "zh",
                "prompt_lang": "zh",
                "text_split_method": "cut0",
                "use_aux_ref_audio": False
            },
            "auto_generation": {
                "enabled": True,
                "trigger_strategy": "floor_interval",
                "floor_interval": 3,
                "start_floor": 3,
                "max_context_messages": 10,
                "notification_method": "websocket"
            }
        }
        dirty = True

    if dirty:
        save_json(SETTINGS_FILE, settings)

    # 确保物理路径存在
    base_dir = settings["base_dir"]
    cache_dir = settings["cache_dir"]

    if not os.path.exists(cache_dir): os.makedirs(cache_dir, exist_ok=True)
    if not os.path.exists(base_dir): os.makedirs(base_dir, exist_ok=True)

    return settings

# 获取当前配置的快捷函数
def get_current_dirs():
    s = init_settings()
    return s["base_dir"], s["cache_dir"]

def get_sovits_host():
    """获取配置的 GPT-SoVITS 服务地址"""
    s = init_settings()
    return s.get("sovits_host", SOVITS_HOST)
