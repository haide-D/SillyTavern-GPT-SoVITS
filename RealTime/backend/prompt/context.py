# 对话上下文管理

from dataclasses import dataclass, field
from typing import List, Dict, Optional, TYPE_CHECKING
import time

if TYPE_CHECKING:
    from .data_source.base import BaseDataSource

from .base import PromptContext


@dataclass
class DialogueState:
    """对话状态 - 跟踪对话动态信息"""
    last_user_message_time: float = 0        # 最后用户消息时间戳
    last_assistant_message_time: float = 0   # 最后助手消息时间戳
    turn_count: int = 0                      # 对话轮次
    current_mood: str = "neutral"            # 当前情绪
    is_active: bool = False                  # 对话是否活跃


class DialogueContext:
    """
    对话上下文管理器
    
    职责:
    1. 管理对话历史
    2. 跟踪对话状态（沉默时长、轮次等）
    3. 从数据源加载角色和历史
    4. 生成 PromptContext
    """
    
    def __init__(
        self, 
        data_source: 'BaseDataSource' = None,
        max_history: int = 20
    ):
        """
        初始化对话上下文
        
        Args:
            data_source: 数据源实例（可选）
            max_history: 最大历史消息数
        """
        self.data_source = data_source
        self.max_history = max_history
        
        # 对话数据
        self.history: List[Dict] = []
        self.state = DialogueState()
        self.scene_id: str = "casual_chat"
        
        # 角色信息
        self.character_name: str = ""
        self.character_persona: str = ""
        self.scenario: str = ""
        self.first_message: str = ""
    
    async def load_from_source(self) -> bool:
        """
        从数据源加载角色信息和对话历史
        
        Returns:
            是否成功加载
        """
        if not self.data_source:
            print("[DialogueContext] ⚠️ 无数据源，使用本地模式")
            return False
        
        try:
            # 检查数据源可用性
            if not await self.data_source.is_available():
                print(f"[DialogueContext] ⚠️ 数据源 {self.data_source.source_name} 不可用")
                return False
            
            # 加载角色信息
            character = await self.data_source.get_character()
            if character:
                self.character_name = character.name
                self.character_persona = character.persona
                self.scenario = character.scenario
                self.first_message = character.first_message
                print(f"[DialogueContext] ✅ 加载角色: {character.name}")
            
            # 加载对话历史
            conversation = await self.data_source.get_conversation(self.max_history)
            if conversation.messages:
                self.history = conversation.messages
                print(f"[DialogueContext] ✅ 加载历史: {len(self.history)} 条消息")
            
            return True
            
        except Exception as e:
            print(f"[DialogueContext] ❌ 加载失败: {e}")
            return False
    
    def add_user_message(self, content: str) -> None:
        """添加用户消息"""
        self.history.append({
            "role": "user",
            "content": content,
            "timestamp": time.time()
        })
        self.state.last_user_message_time = time.time()
        self.state.turn_count += 1
        self.state.is_active = True
        
        # 限制历史长度
        if len(self.history) > self.max_history:
            self.history = self.history[-self.max_history:]
    
    def add_assistant_message(self, content: str) -> None:
        """添加助手消息"""
        self.history.append({
            "role": "assistant",
            "content": content,
            "timestamp": time.time()
        })
        self.state.last_assistant_message_time = time.time()
        
        # 限制历史长度
        if len(self.history) > self.max_history:
            self.history = self.history[-self.max_history:]
    
    def get_silence_duration(self) -> float:
        """
        获取当前沉默时长（自最后一条消息后）
        
        Returns:
            沉默时长（秒）
        """
        if not self.state.is_active:
            return 0.0
        
        last_time = max(
            self.state.last_user_message_time,
            self.state.last_assistant_message_time
        )
        
        if last_time == 0:
            return 0.0
        
        return time.time() - last_time
    
    def switch_scene(self, scene_id: str) -> None:
        """切换场景"""
        print(f"[DialogueContext] 🔄 切换场景: {self.scene_id} -> {scene_id}")
        self.scene_id = scene_id
    
    def clear(self) -> None:
        """清空对话上下文"""
        self.history = []
        self.state = DialogueState()
        print("[DialogueContext] 🗑️ 对话已清空")
    
    def to_prompt_context(
        self, 
        user_input: str,
        event_type: str = None,
        extra_data: Dict = None
    ) -> PromptContext:
        """
        生成 PromptContext 用于构建提示词
        
        Args:
            user_input: 用户当前输入
            event_type: 触发事件类型
            extra_data: 额外数据
            
        Returns:
            PromptContext 实例
        """
        return PromptContext(
            user_input=user_input,
            conversation_history=self.history.copy(),
            scene_id=self.scene_id,
            character_name=self.character_name,
            character_persona=self.character_persona,
            scenario=self.scenario,
            first_message=self.first_message,
            event_type=event_type,
            extra_data=extra_data or {}
        )
