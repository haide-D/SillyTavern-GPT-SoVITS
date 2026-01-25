# SillyTavern 数据源适配器

from typing import Optional, List, Dict
from .base import BaseDataSource, CharacterInfo, ConversationData


class SillyTavernSource(BaseDataSource):
    """
    SillyTavern 数据源适配器
    
    通过 HTTP API 或前端传递的数据获取酒馆的角色和对话信息。
    
    由于酒馆的上下文存储在前端 (window.SillyTavern.getContext())，
    后端需要通过 API 或 WebSocket 从前端获取数据。
    
    使用方式:
    1. 前端主动推送数据（推荐）
    2. 后端轮询 API（备用）
    """
    
    def __init__(self, base_url: str = "http://127.0.0.1:8000"):
        """
        初始化酒馆数据源
        
        Args:
            base_url: 后端服务 URL（用于 API 调用）
        """
        self.base_url = base_url
        
        # 缓存数据（由前端推送或 API 获取）
        self._character_cache: Optional[CharacterInfo] = None
        self._conversation_cache: Optional[ConversationData] = None
        self._is_connected: bool = False
    
    @property
    def source_name(self) -> str:
        return "SillyTavern"
    
    async def get_character(self) -> Optional[CharacterInfo]:
        """
        获取当前角色信息
        
        数据来源:
        - window.SillyTavern.getContext().characters
        - window.SillyTavern.getContext().characterId
        """
        # 优先使用缓存
        if self._character_cache:
            return self._character_cache
        
        # TODO: 实现 API 获取
        # 目前返回空，等待前端推送
        return None
    
    async def get_conversation(self, max_messages: int = 20) -> ConversationData:
        """
        获取对话历史
        
        数据来源:
        - window.SillyTavern.getContext().chat
        - window.SillyTavern.getContext().chatId
        """
        # 优先使用缓存
        if self._conversation_cache:
            # 限制消息数量
            messages = self._conversation_cache.messages[-max_messages:]
            return ConversationData(
                messages=messages,
                chat_id=self._conversation_cache.chat_id,
                character=self._conversation_cache.character
            )
        
        # TODO: 实现 API 获取
        return ConversationData()
    
    async def is_available(self) -> bool:
        """检查酒馆是否可用"""
        return self._is_connected
    
    # ==================== 数据更新方法（由前端调用）====================
    
    def update_character(self, data: Dict) -> None:
        """
        更新角色信息（由前端推送）
        
        Args:
            data: 角色数据字典
                - name: 角色名
                - persona/description: 人设
                - first_mes: 开场白
                - scenario: 场景
        """
        self._character_cache = CharacterInfo(
            name=data.get("name", ""),
            persona=data.get("persona") or data.get("description", ""),
            first_message=data.get("first_mes") or data.get("first_message", ""),
            scenario=data.get("scenario", ""),
            extra=data
        )
        self._is_connected = True
        print(f"[SillyTavernSource] ✅ 更新角色: {self._character_cache.name}")
    
    def update_conversation(self, messages: List[Dict], chat_id: str = "") -> None:
        """
        更新对话历史（由前端推送）
        
        Args:
            messages: 消息列表，每条消息包含:
                - is_user: 是否用户消息
                - mes: 消息内容
            chat_id: 会话 ID
        """
        # 转换格式
        converted = []
        for msg in messages:
            # 跳过系统消息
            if msg.get("is_system"):
                continue
            
            role = "user" if msg.get("is_user") else "assistant"
            content = msg.get("mes", "")
            
            if content:
                converted.append({
                    "role": role,
                    "content": content
                })
        
        self._conversation_cache = ConversationData(
            messages=converted,
            chat_id=chat_id,
            character=self._character_cache
        )
        self._is_connected = True
        print(f"[SillyTavernSource] ✅ 更新对话: {len(converted)} 条消息")
    
    def update_from_context(self, context: Dict) -> None:
        """
        一次性更新全部数据（由前端推送完整上下文）
        
        Args:
            context: 酒馆上下文（来自 window.SillyTavern.getContext()）
                - chat: 对话历史
                - chatId: 会话 ID
                - characters: 角色列表
                - characterId: 当前角色 ID
        """
        # 更新角色
        characters = context.get("characters", [])
        char_id = context.get("characterId")
        if characters and char_id is not None and char_id < len(characters):
            char_data = characters[char_id]
            self.update_character(char_data)
        
        # 更新对话
        chat = context.get("chat", [])
        chat_id = context.get("chatId", "")
        if chat:
            self.update_conversation(chat, chat_id)
        
        self._is_connected = True
    
    def disconnect(self) -> None:
        """断开连接，清除缓存"""
        self._character_cache = None
        self._conversation_cache = None
        self._is_connected = False
        print("[SillyTavernSource] 🔌 已断开连接")
