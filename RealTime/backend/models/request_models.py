# 请求/响应模型 - Pydantic 数据模型

from pydantic import BaseModel
from typing import Optional, List, Dict, Any


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


# ==================== 新增：上下文和会话管理 ====================

class UpdateContextRequest(BaseModel):
    """更新上下文请求"""
    character: Optional[Dict[str, Any]] = None  # 角色信息
    messages: Optional[List[Dict[str, str]]] = None  # 对话历史
    chat_id: Optional[str] = None  # 会话ID
    # 或者直接传酒馆完整上下文
    context: Optional[Dict[str, Any]] = None


class SwitchSceneRequest(BaseModel):
    """切换场景请求"""
    scene_id: str


class BuildPromptRequest(BaseModel):
    """构建提示词请求"""
    user_input: str
    event_type: Optional[str] = None

