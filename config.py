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

    # 深度合并函数
    def deep_merge(defaults: dict, user_config: dict) -> bool:
        """深度合并配置,只补充缺失字段,返回是否有修改"""
        modified = False
        for key, default_val in defaults.items():
            if key not in user_config:
                user_config[key] = default_val
                modified = True
            elif isinstance(default_val, dict) and isinstance(user_config.get(key), dict):
                # 递归合并嵌套字典
                if deep_merge(default_val, user_config[key]):
                    modified = True
        return modified

    # message_processing 配置 - 共享的消息过滤配置
    message_processing_defaults = {
        "extract_tag": "",
        "filter_tags": "<small>, [statbar]"
    }
    if "message_processing" not in settings:
        settings["message_processing"] = message_processing_defaults
        dirty = True
    else:
        settings["message_processing"] = deep_merge(message_processing_defaults, settings["message_processing"])

    # phone_call 配置 - 使用深度合并,只补充缺失字段,不覆盖用户设置
    phone_call_defaults = {
        "enabled": True,
        "trigger": {
            "type": "message_count",
            "threshold": 5
        },
        "llm": {
            "api_url": "",
            "api_key": "",
            "model": "gemini-2.5-flash",
            "temperature": 0.8,
            "max_tokens": 5000
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

    # 初始化或深度合并 phone_call 配置
    if "phone_call" not in settings:
        settings["phone_call"] = phone_call_defaults
        dirty = True
    else:
        # 深度合并,保留用户已有设置
        if deep_merge(phone_call_defaults, settings["phone_call"]):
            dirty = True

    # analysis_engine 默认配置 - 分析引擎独立配置
    analysis_engine_defaults = {
        "enabled": True,
        "analysis_interval": 2,          # 每几楼层分析一次
        "max_history_records": 100,       # 最大历史记录数
        "llm_context_limit": 10,          # 发给 LLM 的历史记录数量
        "trigger_threshold": 60,          # 行动触发阈值 (0-100)
        "llm": {
            "api_url": "",
            "api_key": "",
            "model": "",
            "temperature": 0.8,
            "max_tokens": 5000
        }
    }
    
    if "analysis_engine" not in settings:
        settings["analysis_engine"] = analysis_engine_defaults
        dirty = True
    else:
        if deep_merge(analysis_engine_defaults, settings["analysis_engine"]):
            dirty = True
    
    # 迁移旧配置（兼容性处理）
    if "analysis_llm" in settings:
        # 如果用户有旧的 analysis_llm 配置，迁移到 analysis_engine.llm
        old_llm = settings.pop("analysis_llm")
        if deep_merge(old_llm, settings["analysis_engine"]["llm"]):
            pass  # 合并旧配置到新位置
        dirty = True
    
    # 迁移 phone_call 中的旧分析配置
    phone_call = settings.get("phone_call", {})
    if "continuous_analysis" in phone_call:
        old_ca = phone_call.pop("continuous_analysis")
        settings["analysis_engine"]["analysis_interval"] = old_ca.get("analysis_interval", 3)
        settings["analysis_engine"]["max_history_records"] = old_ca.get("max_history_records", 100)
        settings["analysis_engine"]["llm_context_limit"] = old_ca.get("llm_context_limit", 10)
        dirty = True
    if "live_character" in phone_call:
        old_lc = phone_call.pop("live_character")
        settings["analysis_engine"]["trigger_threshold"] = old_lc.get("threshold", 60)
        dirty = True
    if "smart_trigger" in phone_call:
        phone_call.pop("smart_trigger")  # 已废弃，直接删除
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
