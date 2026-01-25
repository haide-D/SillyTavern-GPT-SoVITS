# Prompt Builder System
# 实时对话提示词构建系统

from .base import BasePromptBuilder, PromptContext
from .context import DialogueContext, DialogueState
from .scene_manager import SceneManager
from .event_dispatcher import EventDispatcher, DialogueEvent, EventType

# 注册内置场景
from .scenes import CasualChatBuilder, RoleplayBuilder

SceneManager.register(CasualChatBuilder())
SceneManager.register(RoleplayBuilder())

__all__ = [
    'BasePromptBuilder',
    'PromptContext',
    'DialogueContext',
    'DialogueState',
    'SceneManager',
    'EventDispatcher',
    'DialogueEvent',
    'EventType',
]
