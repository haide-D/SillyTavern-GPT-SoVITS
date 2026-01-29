# 上下文提供者 - 提供历史上下文数据
#
# 职责:
# - 从各种来源获取历史上下文（酒馆、本地文件等）
# - 格式转换和过滤
# - 与 call_memory 分离：call_memory 管理通话记忆，本模块提供历史上下文
#
# 设计理念:
# - 可插拔的数据源（酒馆、本地、自定义）
# - 统一的输出格式
# - 支持过滤和提取

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from abc import ABC, abstractmethod

from st_utils import ContextConverter, MessageFilter, DataExtractor
from st_utils.message_filter import FilterConfig


@dataclass
class ContextConfig:
    """上下文配置"""
    max_messages: int = 20                     # 最大消息数
    filter_config: Optional[FilterConfig] = None  # 过滤配置
    extractors: List[Dict] = field(default_factory=list)  # 数据提取器配置


@dataclass
class HistoryContext:
    """历史上下文数据"""
    messages: List[Dict] = field(default_factory=list)   # 标准格式消息 [{role, content}]
    character: Optional[Dict] = None                      # 角色信息
    chat_id: str = ""                                     # 聊天ID
    extracted_data: Dict = field(default_factory=dict)    # 提取的数据
    source: str = ""                                      # 数据来源
    
    def to_dict(self) -> Dict:
        return {
            "messages": self.messages,
            "character": self.character,
            "chat_id": self.chat_id,
            "extracted_data": self.extracted_data,
            "source": self.source,
            "message_count": len(self.messages)
        }


class BaseContextProvider(ABC):
    """上下文提供者基类"""
    
    @property
    @abstractmethod
    def source_name(self) -> str:
        """数据源名称"""
        pass
    
    @abstractmethod
    def get_context(self, config: ContextConfig = None) -> HistoryContext:
        """获取历史上下文"""
        pass
    
    @abstractmethod
    def update(self, data: Dict) -> bool:
        """更新数据（供前端推送）"""
        pass


class SillyTavernContextProvider(BaseContextProvider):
    """
    酒馆上下文提供者
    
    从 SillyTavern 获取历史上下文数据
    """
    
    def __init__(self):
        # 缓存数据（由前端推送更新）
        self._raw_context: Dict = {}
        self._character: Optional[Dict] = None
        self._messages: List[Dict] = []
        self._chat_id: str = ""
        
        print("[SillyTavernContextProvider] ✅ 初始化完成")
    
    @property
    def source_name(self) -> str:
        return "SillyTavern"
    
    def update(self, data: Dict) -> bool:
        """
        更新上下文数据（由前端推送）
        
        Args:
            data: 上下文数据，支持两种格式:
                1. 完整上下文: {chat, characters, characterId, chatId, ...}
                2. 简化格式: {messages, character, chatId}
        
        Returns:
            是否成功更新
        """
        try:
            self._raw_context = data
            
            # 解析角色信息
            if "character" in data:
                self._character = data["character"]
            elif "characters" in data:
                chars = data.get("characters", [])
                char_id = data.get("characterId")
                if chars and char_id is not None:
                    for c in chars:
                        if c.get("avatar") == char_id:
                            self._character = {
                                "name": c.get("name", ""),
                                "persona": c.get("description") or c.get("persona", ""),
                                "first_message": c.get("first_mes", ""),
                                "scenario": c.get("scenario", "")
                            }
                            break
            
            # 解析消息
            raw_messages = data.get("messages") or data.get("chat", [])
            self._messages = ContextConverter.convert_to_standard_format(raw_messages)
            
            # 聊天ID
            self._chat_id = data.get("chatId") or data.get("chat_id", "")
            
            char_name = self._character.get("name", "未知") if self._character else "未知"
            print(f"[SillyTavernContextProvider] ✅ 更新: 角色={char_name}, 消息数={len(self._messages)}")
            return True
            
        except Exception as e:
            print(f"[SillyTavernContextProvider] ❌ 更新失败: {e}")
            return False
    
    def get_context(self, config: ContextConfig = None) -> HistoryContext:
        """
        获取历史上下文
        
        Args:
            config: 上下文配置（可选）
        
        Returns:
            HistoryContext 实例
        """
        config = config or ContextConfig()
        
        # 限制消息数量
        messages = self._messages[-config.max_messages:] if self._messages else []
        
        # 应用过滤
        if config.filter_config:
            messages = self._filter_messages(messages, config.filter_config)
        
        # 提取数据
        extracted = {}
        if config.extractors:
            extracted = DataExtractor.extract(messages, config.extractors)
        
        return HistoryContext(
            messages=messages,
            character=self._character,
            chat_id=self._chat_id,
            extracted_data=extracted,
            source=self.source_name
        )
    
    def _filter_messages(self, messages: List[Dict], filter_config: FilterConfig) -> List[Dict]:
        """过滤消息内容"""
        filtered = []
        for msg in messages:
            content = msg.get("content", "")
            filtered_content = MessageFilter.filter(content, filter_config)
            filtered.append({
                "role": msg.get("role"),
                "content": filtered_content
            })
        return filtered
    
    def get_character_name(self) -> str:
        """获取当前角色名"""
        if self._character:
            return self._character.get("name", "")
        return ""
    
    def is_available(self) -> bool:
        """检查是否有可用数据"""
        return bool(self._messages or self._character)


class ContextProviderManager:
    """
    上下文提供者管理器
    
    管理多个数据源，提供统一的访问接口
    """
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self._initialized = True
        self._providers: Dict[str, BaseContextProvider] = {}
        self._default_provider: str = ""
        
        # 注册默认提供者
        self.register("sillytavern", SillyTavernContextProvider())
        self.set_default("sillytavern")
        
        print("[ContextProviderManager] ✅ 初始化完成")
    
    def register(self, name: str, provider: BaseContextProvider) -> None:
        """注册上下文提供者"""
        self._providers[name] = provider
        print(f"[ContextProviderManager] 📝 注册提供者: {name}")
    
    def set_default(self, name: str) -> bool:
        """设置默认提供者"""
        if name in self._providers:
            self._default_provider = name
            return True
        return False
    
    def get(self, name: str = None) -> Optional[BaseContextProvider]:
        """获取提供者"""
        name = name or self._default_provider
        return self._providers.get(name)
    
    def update_context(self, data: Dict, provider_name: str = None) -> bool:
        """更新上下文数据"""
        provider = self.get(provider_name)
        if provider:
            return provider.update(data)
        return False
    
    def get_context(self, config: ContextConfig = None, provider_name: str = None) -> HistoryContext:
        """获取历史上下文"""
        provider = self.get(provider_name)
        if provider:
            return provider.get_context(config)
        return HistoryContext()


# 全局实例
context_provider = ContextProviderManager()
