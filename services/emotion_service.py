import os
import re
from typing import List
from fastapi import HTTPException
from config import load_json, MAPPINGS_FILE, get_current_dirs


class EmotionService:
    """情绪管理服务"""
    
    @staticmethod
    def get_available_emotions(char_name: str) -> List[str]:
        """
        获取角色可用情绪列表
        
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
        ref_dir = os.path.join(base_dir, model_folder, "reference_audios")
        
        emotions = set()
        
        for root, dirs, files in os.walk(ref_dir):
            for file in files:
                if file.endswith(('.wav', '.mp3', '.flac')):
                    match = re.match(r'^([^_]+)_', file)
                    if match:
                        emotions.add(match.group(1))
        
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
