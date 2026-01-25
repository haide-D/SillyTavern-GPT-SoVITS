# 会话管理器 - 统一管理实时对话的所有状态

from typing import Dict, Optional, Any
from dataclasses import dataclass, field
import time
import asyncio

from .prompt import DialogueContext, EventDispatcher, SceneManager, PromptContext
from .prompt.data_source import SillyTavernSource


@dataclass
class SessionConfig:
    """会话配置"""
    max_history: int = 20              # 最大历史消息数
    default_scene: str = "roleplay"    # 默认场景
    silence_threshold: float = 5.0     # 沉默检测阈值（秒）
    auto_greeting: bool = True         # 是否启用主动问候


class SessionManager:
    """
    会话管理器
    
    统一管理实时对话的所有状态，包括：
    1. 对话上下文（历史、角色信息）
    2. 数据源连接（酒馆等）
    3. 事件调度
    4. 场景切换
    5. 其他扩展状态
    """
    
    _instance = None  # 单例
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self._initialized = True
        
        # 配置
        self.config = SessionConfig()
        
        # 数据源
        self.data_source = SillyTavernSource()
        
        # 对话上下文
        self.context = DialogueContext(
            data_source=self.data_source,
            max_history=self.config.max_history
        )
        self.context.switch_scene(self.config.default_scene)
        
        # 事件调度器
        self.dispatcher = EventDispatcher()
        self.dispatcher.configure(
            silence_threshold=self.config.silence_threshold,
            auto_greeting_enabled=self.config.auto_greeting
        )
        
        # 扩展状态存储
        self._state: Dict[str, Any] = {}
        
        # 会话状态
        self._session_active = False
        self._last_activity_time = 0.0
        
        print("[SessionManager] ✅ 初始化完成")
    
    # ==================== 上下文更新 ====================
    
    def update_from_sillytavern(self, data: Dict) -> bool:
        """
        从酒馆更新上下文数据
        
        Args:
            data: 酒馆上下文数据，可包含:
                - character: 角色信息
                - chat: 对话历史
                - chatId: 会话ID
                - 或完整的 getContext() 输出
        
        Returns:
            是否成功更新
        """
        try:
            # 检查是否是完整上下文
            if "characters" in data or "chat" in data:
                self.data_source.update_from_context(data)
            else:
                # 分别更新
                if "character" in data:
                    self.data_source.update_character(data["character"])
                if "messages" in data:
                    self.data_source.update_conversation(
                        data["messages"],
                        data.get("chatId", "")
                    )
            
            # 同步到对话上下文
            self._sync_from_data_source()
            
            self._last_activity_time = time.time()
            print("[SessionManager] ✅ 上下文已更新")
            return True
            
        except Exception as e:
            print(f"[SessionManager] ❌ 更新失败: {e}")
            return False
    
    def _sync_from_data_source(self) -> None:
        """从数据源同步数据到对话上下文"""
        if self.data_source._character_cache:
            char = self.data_source._character_cache
            self.context.character_name = char.name
            self.context.character_persona = char.persona
            self.context.scenario = char.scenario
            self.context.first_message = char.first_message
        
        if self.data_source._conversation_cache:
            conv = self.data_source._conversation_cache
            self.context.history = conv.messages.copy()
    
    # ==================== 对话管理 ====================
    
    def add_user_message(self, content: str) -> None:
        """添加用户消息"""
        self.context.add_user_message(content)
        self._session_active = True
        self._last_activity_time = time.time()
    
    def add_assistant_message(self, content: str) -> None:
        """添加助手消息"""
        self.context.add_assistant_message(content)
        self._last_activity_time = time.time()
    
    def get_prompt_context(
        self, 
        user_input: str,
        event_type: str = None
    ) -> PromptContext:
        """
        获取提示词构建上下文
        
        Args:
            user_input: 用户输入
            event_type: 事件类型（可选）
            
        Returns:
            PromptContext 实例
        """
        return self.context.to_prompt_context(
            user_input=user_input,
            event_type=event_type,
            extra_data=self._state.copy()
        )
    
    def build_messages(self, user_input: str, event_type: str = None) -> list:
        """
        构建 LLM 消息列表
        
        Args:
            user_input: 用户输入
            event_type: 事件类型
            
        Returns:
            OpenAI 格式的 messages 列表
        """
        scene_id = self.context.scene_id
        builder = SceneManager.get_or_default(scene_id)
        
        if builder is None:
            print(f"[SessionManager] ⚠️ 无可用场景，使用空提示词")
            return [{"role": "user", "content": user_input}]
        
        prompt_ctx = self.get_prompt_context(user_input, event_type)
        return builder.build_messages(prompt_ctx)
    
    # ==================== 场景和事件 ====================
    
    def switch_scene(self, scene_id: str) -> bool:
        """切换场景"""
        if not SceneManager.has(scene_id):
            print(f"[SessionManager] ⚠️ 场景不存在: {scene_id}")
            return False
        
        self.context.switch_scene(scene_id)
        self.dispatcher.emit_simple("scene_switch", {"scene_id": scene_id})
        return True
    
    def get_current_scene(self) -> Dict:
        """获取当前场景信息"""
        scene_id = self.context.scene_id
        builder = SceneManager.get(scene_id)
        return {
            "id": scene_id,
            "name": builder.scene_name if builder else "未知"
        }
    
    def check_silence(self) -> Optional[Dict]:
        """
        检查沉默事件
        
        Returns:
            如果触发沉默事件，返回事件数据；否则返回 None
        """
        if not self._session_active:
            return None
        
        silence_duration = self.context.get_silence_duration()
        event = self.dispatcher.check_silence(silence_duration)
        
        if event:
            return {
                "event_type": event.event_type,
                "data": event.data
            }
        return None
    
    # ==================== 状态管理 ====================
    
    def set_state(self, key: str, value: Any) -> None:
        """设置扩展状态"""
        self._state[key] = value
    
    def get_state(self, key: str, default: Any = None) -> Any:
        """获取扩展状态"""
        return self._state.get(key, default)
    
    def clear_state(self, key: str = None) -> None:
        """清除状态"""
        if key is None:
            self._state.clear()
        elif key in self._state:
            del self._state[key]
    
    # ==================== 会话控制 ====================
    
    def start_session(self) -> None:
        """开始新会话"""
        self._session_active = True
        self._last_activity_time = time.time()
        self.dispatcher.emit_simple("conversation_start")
        print("[SessionManager] 🎬 会话开始")
    
    def end_session(self) -> None:
        """结束会话"""
        self._session_active = False
        self.dispatcher.emit_simple("conversation_end")
        print("[SessionManager] 🏁 会话结束")
    
    def reset(self) -> None:
        """重置会话（清空历史和状态）"""
        self.context.clear()
        self._state.clear()
        self._session_active = False
        self._last_activity_time = 0.0
        print("[SessionManager] 🔄 会话已重置")
    
    def get_status(self) -> Dict:
        """获取会话状态"""
        return {
            "active": self._session_active,
            "scene": self.get_current_scene(),
            "history_count": len(self.context.history),
            "character_name": self.context.character_name,
            "silence_duration": self.context.get_silence_duration() if self._session_active else 0,
            "data_source": self.data_source.source_name,
            "data_source_connected": self.data_source._is_connected
        }


# 全局单例
session_manager = SessionManager()
