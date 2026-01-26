# 通话记忆管理 - 独立模块
#
# 管理实时通话过程中的记忆数据：
# - 初始上下文（从酒馆收集）
# - 对话历史（通话过程中产生）
# - 通话结果（用于注入酒馆）

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
import uuid

from st_utils import ContextConverter, MessageFilter
from st_utils.message_filter import FilterConfig


@dataclass
class CallSession:
    """单次通话会话"""
    call_id: str
    start_time: datetime
    end_time: Optional[datetime] = None
    
    # 初始上下文
    initial_context: Dict = field(default_factory=dict)
    character_name: str = ""
    chat_id: str = ""
    
    # 对话历史 [{role, content, timestamp}]
    messages: List[Dict] = field(default_factory=list)
    
    # 状态
    status: str = "active"  # active | ended
    
    def to_dict(self) -> Dict:
        """转换为字典（用于 API 返回）"""
        return {
            "call_id": self.call_id,
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "character_name": self.character_name,
            "chat_id": self.chat_id,
            "messages": self.messages,
            "status": self.status,
            "message_count": len(self.messages)
        }


class CallMemory:
    """
    通话记忆管理器
    
    独立模块，管理实时通话的记忆数据。
    
    使用方式:
        memory = CallMemory()
        call_id = memory.start(initial_context)
        memory.add_message(call_id, "user", "你好")
        memory.add_message(call_id, "assistant", "你好呀！")
        result = memory.end(call_id)
    """
    
    def __init__(self):
        # 活跃会话 {call_id: CallSession}
        self._sessions: Dict[str, CallSession] = {}
        
        # 过滤配置（可选）
        self._filter_config: Optional[FilterConfig] = None
        
        print("[CallMemory] ✅ 初始化完成")
    
    def set_filter_config(self, config: FilterConfig) -> None:
        """设置消息过滤配置"""
        self._filter_config = config
    
    def start(
        self, 
        initial_context: Dict,
        filter_config: Optional[Dict] = None
    ) -> str:
        """
        开始通话，收集初始上下文
        
        Args:
            initial_context: 初始上下文（角色、历史等）
            filter_config: 过滤配置（可选）
            
        Returns:
            call_id 通话ID
        """
        call_id = str(uuid.uuid4())[:8]
        
        # 设置过滤配置
        if filter_config:
            self._filter_config = FilterConfig(**filter_config)
        
        # 提取角色名和聊天ID
        character_name = ""
        chat_id = initial_context.get("chatId", "")
        
        if "character" in initial_context:
            character_name = initial_context["character"].get("name", "")
        elif "characters" in initial_context:
            # 完整 getContext() 格式
            chars = initial_context.get("characters", [])
            char_id = initial_context.get("characterId")
            if chars and char_id is not None:
                for c in chars:
                    if c.get("avatar") == char_id:
                        character_name = c.get("name", "")
                        break
        
        # 处理初始历史消息
        processed_context = self._process_context(initial_context)
        
        # 创建会话
        session = CallSession(
            call_id=call_id,
            start_time=datetime.now(),
            initial_context=processed_context,
            character_name=character_name,
            chat_id=chat_id
        )
        
        self._sessions[call_id] = session
        
        print(f"[CallMemory] 🎬 通话开始: call_id={call_id}, 角色={character_name}")
        return call_id
    
    def add_message(
        self, 
        call_id: str, 
        role: str, 
        content: str
    ) -> bool:
        """
        添加对话消息
        
        Args:
            call_id: 通话ID
            role: "user" | "assistant"
            content: 消息内容
            
        Returns:
            是否成功
        """
        session = self._sessions.get(call_id)
        if not session:
            print(f"[CallMemory] ⚠️ 会话不存在: {call_id}")
            return False
        
        if session.status != "active":
            print(f"[CallMemory] ⚠️ 会话已结束: {call_id}")
            return False
        
        # 过滤内容
        if self._filter_config:
            content = MessageFilter.filter(content, self._filter_config)
        
        message = {
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat()
        }
        
        session.messages.append(message)
        print(f"[CallMemory] 💬 添加消息: [{role}] {content[:30]}...")
        return True
    
    def end(self, call_id: str) -> Optional[Dict]:
        """
        结束通话，返回全部记录
        
        Args:
            call_id: 通话ID
            
        Returns:
            通话记录（用于注入酒馆）
        """
        session = self._sessions.get(call_id)
        if not session:
            print(f"[CallMemory] ⚠️ 会话不存在: {call_id}")
            return None
        
        session.end_time = datetime.now()
        session.status = "ended"
        
        result = session.to_dict()
        
        # 保留会话记录（可选：清理或归档）
        # del self._sessions[call_id]
        
        print(f"[CallMemory] 🏁 通话结束: call_id={call_id}, 消息数={len(session.messages)}")
        return result
    
    def get_session(self, call_id: str) -> Optional[CallSession]:
        """获取会话"""
        return self._sessions.get(call_id)
    
    def get_messages(self, call_id: str) -> List[Dict]:
        """获取会话消息列表"""
        session = self._sessions.get(call_id)
        if session:
            return session.messages.copy()
        return []
    
    def _process_context(self, context: Dict) -> Dict:
        """处理初始上下文"""
        processed = context.copy()
        
        # 转换消息格式
        if "messages" in processed:
            processed["messages"] = ContextConverter.convert_to_standard_format(
                processed["messages"]
            )
        elif "chat" in processed:
            processed["messages"] = ContextConverter.convert_to_standard_format(
                processed["chat"]
            )
        
        # 应用过滤
        if self._filter_config and "messages" in processed:
            for msg in processed["messages"]:
                if "content" in msg:
                    msg["content"] = MessageFilter.filter(
                        msg["content"], 
                        self._filter_config
                    )
        
        return processed


# 全局实例
call_memory = CallMemory()
