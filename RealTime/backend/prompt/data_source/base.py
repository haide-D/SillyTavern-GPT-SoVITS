# 数据源抽象接口

from abc import ABC, abstractmethod
from typing import List, Dict, Optional
from dataclasses import dataclass, field


@dataclass
class CharacterInfo:
    """角色信息"""
    name: str                              # 角色名
    persona: str = ""                      # 人设描述
    first_message: str = ""                # 开场白
    scenario: str = ""                     # 场景描述
    extra: Dict = field(default_factory=dict)  # 扩展字段


@dataclass
class ConversationData:
    """对话数据"""
    messages: List[Dict] = field(default_factory=list)  # 消息列表 [{role, content}]
    chat_id: str = ""                      # 会话ID
    character: Optional[CharacterInfo] = None  # 关联角色


class BaseDataSource(ABC):
    """
    数据源抽象基类
    
    职责:
    1. 获取角色信息
    2. 获取对话历史
    3. 检查可用性
    
    实现类可以是:
    - SillyTavernSource: 从酒馆获取数据
    - LocalSource: 本地测试数据
    - CustomSource: 自定义数据源
    """
    
    @property
    @abstractmethod
    def source_name(self) -> str:
        """数据源名称（用于日志和调试）"""
        pass
    
    @abstractmethod
    async def get_character(self) -> Optional[CharacterInfo]:
        """
        获取当前角色信息
        
        Returns:
            角色信息，如果没有角色返回 None
        """
        pass
    
    @abstractmethod
    async def get_conversation(self, max_messages: int = 20) -> ConversationData:
        """
        获取对话历史
        
        Args:
            max_messages: 最大消息数
            
        Returns:
            对话数据
        """
        pass
    
    @abstractmethod
    async def is_available(self) -> bool:
        """
        检查数据源是否可用
        
        Returns:
            是否可用
        """
        pass
    
    async def sync_message(self, message: Dict) -> bool:
        """
        同步消息到数据源（可选实现）
        
        Args:
            message: 消息 {role, content}
            
        Returns:
            是否成功
        """
        return True  # 默认不做任何操作
