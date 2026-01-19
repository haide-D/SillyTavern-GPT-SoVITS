import re
from typing import List, Dict
from pydantic import BaseModel


class EmotionSegment(BaseModel):
    """情绪片段"""
    emotion: str
    text: str


class ResponseParser:
    """响应解析工具"""
    
    @staticmethod
    def parse_emotion_segments(response: str, parser_config: Dict) -> List[EmotionSegment]:
        """
        解析LLM响应,提取情绪片段
        
        Args:
            response: LLM响应文本
            parser_config: 解析器配置 {pattern, emotion_key, text_key}
            
        Returns:
            情绪片段列表
        """
        pattern = parser_config.get("pattern", r'\[(\w+)\](.*?)(?=\[|$)')
        emotion_key = parser_config.get("emotion_key", "emotion")
        text_key = parser_config.get("text_key", "text")
        
        segments = []
        matches = re.findall(pattern, response, re.DOTALL)
        
        for match in matches:
            if len(match) >= 2:
                emotion = match[0].strip()
                text = match[1].strip()
                
                if emotion and text:
                    segments.append(EmotionSegment(
                        emotion=emotion,
                        text=text
                    ))
        
        return segments
