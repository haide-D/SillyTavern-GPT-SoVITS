"""
对话追踪相关数据模型

用于多说话人场景的 Segment 和场景分析结果
"""
from typing import List, Optional
from pydantic import BaseModel


class MultiSpeakerSegment(BaseModel):
    """多说话人情绪片段"""
    speaker: str                          # 说话人
    emotion: str                          # 情绪
    text: str                             # 说话内容
    translation: Optional[str] = None     # 中文翻译
    pause_after: Optional[float] = None   # 停顿时长(秒)
    speed: Optional[float] = None         # 语速倍率
    filler_word: Optional[str] = None     # 语气词
    
    # 音频生成后填充
    audio_duration: Optional[float] = None  # 该segment的音频时长(秒)
    start_time: Optional[float] = None      # 在合并音频中的起始时间(秒)


class SceneAnalysisResult(BaseModel):
    """场景分析结果"""
    characters_present: List[str]           # 当前在场角色
    character_left: Optional[str] = None    # 刚离场的角色
    private_conversation_likely: bool       # 是否可能存在私下对话
    suggested_action: str                   # "phone_call" / "eavesdrop" / "none"
    reason: str                             # 判断原因
    scene_description: Optional[str] = None # 场景描述（可选）


class EavesdropResult(BaseModel):
    """对话追踪生成结果"""
    scene_description: str                  # 场景描述
    segments: List[MultiSpeakerSegment]     # 对话片段列表
