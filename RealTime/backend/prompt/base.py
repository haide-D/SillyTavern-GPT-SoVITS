# 抽象基类和数据结构定义

from abc import ABC, abstractmethod
from typing import List, Dict, Optional
from dataclasses import dataclass, field


@dataclass
class PromptContext:
    """提示词构建上下文 - 传递给场景构建器的所有数据"""
    user_input: str                                    # 用户当前输入
    conversation_history: List[Dict] = field(default_factory=list)  # 对话历史
    scene_id: str = "casual_chat"                      # 当前场景
    character_name: str = ""                           # 角色名
    character_persona: str = ""                        # 角色人设
    scenario: str = ""                                 # 场景描述
    first_message: str = ""                            # 开场白
    event_type: Optional[str] = None                   # 触发事件类型
    extra_data: Dict = field(default_factory=dict)     # 扩展数据


class BasePromptBuilder(ABC):
    """
    提示词构建器抽象基类
    
    每个场景实现一个子类，通过 SceneManager 注册和获取
    """
    
    @property
    @abstractmethod
    def scene_id(self) -> str:
        """场景唯一标识"""
        pass
    
    @property
    @abstractmethod
    def scene_name(self) -> str:
        """场景显示名称"""
        pass
    
    @abstractmethod
    def build_system_prompt(self, ctx: PromptContext) -> str:
        """
        构建系统提示词
        
        Args:
            ctx: 提示词构建上下文
            
        Returns:
            系统提示词字符串
        """
        pass
    
    @abstractmethod
    def build_user_prompt(self, ctx: PromptContext) -> str:
        """
        构建用户提示词（包含历史和当前输入）
        
        Args:
            ctx: 提示词构建上下文
            
        Returns:
            用户提示词字符串
        """
        pass
    
    def build_event_prompt(self, ctx: PromptContext, event_type: str) -> Optional[str]:
        """
        构建事件触发的提示词（可选覆盖）
        
        Args:
            ctx: 提示词构建上下文
            event_type: 事件类型
            
        Returns:
            事件提示词，如果该场景不处理此事件则返回 None
        """
        return None
    
    def format_history(self, history: List[Dict], max_turns: int = 10) -> str:
        """
        格式化对话历史（通用实现，子类可覆盖）
        
        Args:
            history: 对话历史列表
            max_turns: 最大保留轮次
            
        Returns:
            格式化后的历史字符串
        """
        if not history:
            return ""
        
        lines = []
        for msg in history[-max_turns:]:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            
            if role == "user":
                lines.append(f"用户: {content}")
            elif role == "assistant":
                lines.append(f"助手: {content}")
            # 跳过 system 消息
        
        return "\n".join(lines)
    
    def build_messages(self, ctx: PromptContext) -> List[Dict]:
        """
        构建完整的 messages 列表（用于 LLM API 调用）
        
        Args:
            ctx: 提示词构建上下文
            
        Returns:
            OpenAI 格式的 messages 列表
        """
        messages = [
            {"role": "system", "content": self.build_system_prompt(ctx)}
        ]
        
        # 添加历史消息
        for msg in ctx.conversation_history:
            messages.append({
                "role": msg.get("role", "user"),
                "content": msg.get("content", "")
            })
        
        # 添加当前用户输入
        if ctx.user_input:
            # 检查是否有事件触发的额外提示
            user_content = ctx.user_input
            if ctx.event_type:
                event_prompt = self.build_event_prompt(ctx, ctx.event_type)
                if event_prompt:
                    user_content = f"{event_prompt}\n{ctx.user_input}"
            
            messages.append({"role": "user", "content": user_content})
        
        return messages
