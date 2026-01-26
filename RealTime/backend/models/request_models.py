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


class ChatStreamRequest(BaseModel):
    """流式对话请求"""
    user_input: str
    messages: Optional[List[Dict[str, str]]] = None  # 可选：覆盖历史消息
    system_prompt: Optional[str] = None  # 可选：系统提示词


# ==================== 通话记忆管理 ====================

class CallStartRequest(BaseModel):
    """开始通话请求"""
    context: Dict[str, Any]  # 初始上下文（角色、历史等）
    filter_config: Optional[Dict[str, Any]] = None  # 过滤配置


class CallMessageRequest(BaseModel):
    """添加通话消息请求"""
    call_id: str
    role: str  # "user" | "assistant"
    content: str


class CallEndRequest(BaseModel):
    """结束通话请求"""
    call_id: str
