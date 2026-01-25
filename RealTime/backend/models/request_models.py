# 请求/响应模型 - Pydantic 数据模型

from pydantic import BaseModel
from typing import Optional


class TTSRequest(BaseModel):
    """TTS 请求模型"""
    text: str
    ref_audio_path: str
    prompt_text: str = ""
    text_lang: str = "zh"
    prompt_lang: str = "zh"
    is_first_chunk: bool = False  # 是否是第一个文本块，用于首包延迟优化


class InterruptRequest(BaseModel):
    """打断请求模型"""
    pass


class WarmupRequest(BaseModel):
    """预热请求模型"""
    ref_audio_path: Optional[str] = None
    prompt_text: Optional[str] = None
    prompt_lang: Optional[str] = None
    force: bool = False


class SwitchRefAudioRequest(BaseModel):
    """切换参考音频请求模型"""
    ref_audio_path: str
    prompt_text: str
    prompt_lang: str = "zh"
    auto_warmup: bool = True
