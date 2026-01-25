# 事件调度器 - 可扩展的事件系统

from typing import Callable, Dict, List, Optional, Any
from dataclasses import dataclass, field
from enum import Enum
import time


class EventType(Enum):
    """内置事件类型"""
    SILENCE_DETECTED = "silence_detected"    # 沉默检测
    GREETING_TRIGGER = "greeting_trigger"    # 主动问候
    MOOD_CHANGE = "mood_change"              # 情绪变化
    SCENE_SWITCH = "scene_switch"            # 场景切换
    CONVERSATION_START = "conversation_start"  # 对话开始
    CONVERSATION_END = "conversation_end"      # 对话结束


@dataclass
class DialogueEvent:
    """对话事件"""
    event_type: str                          # 事件类型（字符串支持自定义）
    data: Dict = field(default_factory=dict) # 事件数据
    timestamp: float = field(default_factory=time.time)  # 事件时间戳
    source: str = ""                         # 事件来源


class EventDispatcher:
    """
    事件调度器
    
    职责:
    1. 注册事件处理器
    2. 触发事件
    3. 沉默检测
    4. 配置管理
    """
    
    def __init__(self):
        self._handlers: Dict[str, List[Callable]] = {}
        self._config = {
            "silence_threshold": 5.0,        # 沉默阈值（秒）
            "greeting_cooldown": 30.0,       # 问候冷却（秒）
            "auto_greeting_enabled": True,   # 是否启用自动问候
        }
        self._last_greeting_time: float = 0
    
    def on(self, event_type: str, handler: Callable) -> 'EventDispatcher':
        """
        注册事件处理器（支持链式调用）
        
        Args:
            event_type: 事件类型（可以是 EventType 枚举值或自定义字符串）
            handler: 处理函数，接收 DialogueEvent 参数
            
        Returns:
            self，支持链式调用
        """
        # 支持 EventType 枚举
        if isinstance(event_type, EventType):
            event_type = event_type.value
        
        if event_type not in self._handlers:
            self._handlers[event_type] = []
        
        self._handlers[event_type].append(handler)
        print(f"[EventDispatcher] 📌 注册处理器: {event_type}")
        return self
    
    def off(self, event_type: str, handler: Callable = None) -> None:
        """
        移除事件处理器
        
        Args:
            event_type: 事件类型
            handler: 要移除的处理器，如果为 None 则移除该类型所有处理器
        """
        if isinstance(event_type, EventType):
            event_type = event_type.value
        
        if event_type not in self._handlers:
            return
        
        if handler is None:
            del self._handlers[event_type]
            print(f"[EventDispatcher] 🗑️ 移除所有处理器: {event_type}")
        else:
            self._handlers[event_type] = [
                h for h in self._handlers[event_type] if h != handler
            ]
    
    def emit(self, event: DialogueEvent) -> List[Any]:
        """
        触发事件
        
        Args:
            event: 对话事件
            
        Returns:
            所有处理器的返回值列表
        """
        handlers = self._handlers.get(event.event_type, [])
        
        if not handlers:
            return []
        
        print(f"[EventDispatcher] 📢 触发事件: {event.event_type} -> {len(handlers)} 个处理器")
        
        results = []
        for handler in handlers:
            try:
                result = handler(event)
                results.append(result)
            except Exception as e:
                print(f"[EventDispatcher] ❌ 处理器异常: {e}")
                results.append(None)
        
        return results
    
    def emit_simple(self, event_type: str, data: Dict = None) -> List[Any]:
        """
        简化的事件触发
        
        Args:
            event_type: 事件类型
            data: 事件数据
            
        Returns:
            处理结果列表
        """
        if isinstance(event_type, EventType):
            event_type = event_type.value
        
        event = DialogueEvent(
            event_type=event_type,
            data=data or {},
            source="dispatcher"
        )
        return self.emit(event)
    
    def check_silence(self, silence_duration: float) -> Optional[DialogueEvent]:
        """
        检查是否应触发沉默事件
        
        Args:
            silence_duration: 当前沉默时长（秒）
            
        Returns:
            如果应触发则返回 DialogueEvent，否则返回 None
        """
        threshold = self._config["silence_threshold"]
        
        if silence_duration < threshold:
            return None
        
        # 检查冷却时间
        cooldown = self._config["greeting_cooldown"]
        if time.time() - self._last_greeting_time < cooldown:
            return None
        
        if not self._config["auto_greeting_enabled"]:
            return None
        
        self._last_greeting_time = time.time()
        
        return DialogueEvent(
            event_type=EventType.SILENCE_DETECTED.value,
            data={
                "silence_duration": silence_duration,
                "threshold": threshold
            },
            source="silence_detector"
        )
    
    def configure(self, **kwargs) -> None:
        """
        配置事件参数
        
        Args:
            **kwargs: 配置键值对
        """
        for key, value in kwargs.items():
            if key in self._config:
                old_value = self._config[key]
                self._config[key] = value
                print(f"[EventDispatcher] ⚙️ 配置 {key}: {old_value} -> {value}")
            else:
                print(f"[EventDispatcher] ⚠️ 未知配置: {key}")
    
    def get_config(self, key: str = None) -> Any:
        """
        获取配置
        
        Args:
            key: 配置键，如果为 None 返回所有配置
            
        Returns:
            配置值或完整配置字典
        """
        if key is None:
            return self._config.copy()
        return self._config.get(key)
