import os
import re
from typing import List
from fastapi import HTTPException
from config import load_json, MAPPINGS_FILE, SETTINGS_FILE, get_current_dirs
from utils import scan_audio_files


class EmotionService:
    """情绪管理服务"""
    
    @staticmethod
    def get_available_emotions(char_name: str) -> List[str]:
        """
        获取角色可用情绪列表
        
        使用与 _select_ref_audio 一致的逻辑：
        - 读取 tts_config.prompt_lang 配置
        - 扫描对应语言目录下的 emotions 文件夹
        
        Args:
            char_name: 角色名称
            
        Returns:
            情绪列表 (已排序)
        """
        mappings = load_json(MAPPINGS_FILE)
        
        if char_name not in mappings:
            raise HTTPException(status_code=404, detail=f"角色 {char_name} 未绑定模型")
        
        model_folder = mappings[char_name]
        base_dir, _ = get_current_dirs()
        
        # 从 tts_config.prompt_lang 读取语言设置并转换为目录名
        # 与 _select_ref_audio 保持一致
        settings = load_json(SETTINGS_FILE)
        prompt_lang = settings.get("phone_call", {}).get("tts_config", {}).get("prompt_lang", "zh")
        
        # 语言代码转目录名映射
        lang_map = {
            "zh": "Chinese",
            "en": "English",
            "ja": "Japanese",
            "all_zh": "Chinese",
            "all_ja": "Japanese"
        }
        lang_dir = lang_map.get(prompt_lang, "Chinese")
        
        # 使用配置的语言目录下的 emotions 文件夹
        ref_dir = os.path.join(base_dir, model_folder, "reference_audios", lang_dir, "emotions")
        
        if not os.path.exists(ref_dir):
            print(f"[EmotionService] 警告: 参考音频目录不存在: {ref_dir}")
            return []
        
        # 使用 scan_audio_files 扫描（与 _select_ref_audio 一致）
        audio_files = scan_audio_files(ref_dir)
        
        # 提取唯一的情绪标签
        emotions = set(a["emotion"] for a in audio_files if a.get("emotion"))
        
        return sorted(list(emotions))
    
    @staticmethod
    def validate_emotion(char_name: str, emotion: str) -> bool:
        """
        验证情绪是否可用
        
        Args:
            char_name: 角色名称
            emotion: 情绪名称
            
        Returns:
            是否可用
        """
        available_emotions = EmotionService.get_available_emotions(char_name)
        return emotion in available_emotions
