# 配置服务 - 读取和管理参考音频配置
import sys
import os
from typing import Dict

# 添加父目录到路径，以便导入项目配置
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))))
from config import get_sovits_host, load_json, SETTINGS_FILE


class ConfigService:
    """
    配置服务
    
    负责读取和管理与实时对话相关的配置，包括：
    - GPT-SoVITS 服务地址
    - 默认参考音频路径
    - 默认提示文本
    """
    
    def __init__(self):
        self._settings_file = SETTINGS_FILE
        self._sovits_host = get_sovits_host()
        print(f"[ConfigService] 初始化，sovits_host = {self._sovits_host}")
    
    @property
    def sovits_host(self) -> str:
        """获取 GPT-SoVITS 服务地址"""
        return self._sovits_host
    
    def get_default_ref_audio(self, char_name: str = None) -> Dict:
        """
        获取默认参考音频配置
        
        Args:
            char_name: 角色名称 (可选，未来扩展用)
            
        Returns:
            {path, text, lang} 参考音频信息
        """
        settings = load_json(self._settings_file)
        phone_call_config = settings.get("phone_call", {})
        tts_config = phone_call_config.get("tts_config", {})
        
        # TODO: 根据角色获取参考音频，暂用配置中的默认值
        return {
            "path": tts_config.get("default_ref_audio_path", ""),
            "text": tts_config.get("default_prompt_text", ""),
            "lang": tts_config.get("prompt_lang", "zh")
        }
    
    def reload(self) -> None:
        """重新加载配置（热更新用）"""
        self._sovits_host = get_sovits_host()
        print(f"[ConfigService] 配置已重新加载")
