"""
行动处理器 - 处理角色的各种潜在行动

职责:
- phone_call: 生成电话音频
- side_conversation: 生成私下对话
- leave_scene: 显示离场提示
- self_talk: 生成内心独白
"""
from typing import Dict, Any, Optional
from services.notification_service import NotificationService


class ActionHandlerRegistry:
    """行动处理器注册表"""
    
    def __init__(self):
        self.notification_service = NotificationService()
        self.handlers = {
            "phone_call": PhoneCallHandler(self.notification_service),
            "side_conversation": SideConversationHandler(self.notification_service),
            "leave_scene": LeaveSceneHandler(self.notification_service),
            "self_talk": SelfTalkHandler(self.notification_service),
        }
    
    def handle(self, action_type: str, action_data: Dict, character_state: Dict) -> Dict:
        """
        根据行动类型分发到对应的处理器
        
        Args:
            action_type: 行动类型
            action_data: 行动数据
            character_state: 角色状态
            
        Returns:
            处理结果
        """
        handler = self.handlers.get(action_type)
        if handler:
            return handler.handle(action_data, character_state)
        else:
            # 未知类型,使用通用处理
            return self._handle_generic(action_data, character_state)
    
    def _handle_generic(self, action_data: Dict, character_state: Dict) -> Dict:
        """通用处理器"""
        print(f"[ActionHandler] 未知行动类型: {action_data.get('type')}")
        return {
            "success": False,
            "reason": "unknown_action_type"
        }


class BaseActionHandler:
    """行动处理器基类"""
    
    def __init__(self, notification_service: NotificationService):
        self.notification_service = notification_service
    
    def handle(self, action_data: Dict, character_state: Dict) -> Dict:
        """
        处理行动
        
        Args:
            action_data: 行动数据
            character_state: 角色状态
            
        Returns:
            处理结果
        """
        raise NotImplementedError


class PhoneCallHandler(BaseActionHandler):
    """电话处理器"""
    
    def handle(self, action_data: Dict, character_state: Dict) -> Dict:
        """
        触发电话生成
        
        流程:
        1. 构建电话场景提示
        2. 发送通知到前端
        3. 前端生成电话音频
        """
        character_name = action_data.get("character_name")
        target = action_data.get("target")
        reason = action_data.get("reason")
        urgency = action_data.get("urgency", 0)
        
        print(f"[PhoneCallHandler] 🔔 触发电话: {character_name} -> {target}, 原因: {reason}")
        
        # 构建电话场景
        phone_context = {
            "character_name": character_name,
            "target": target or character_name,
            "reason": reason,
            "urgency": urgency,
            "emotional_state": character_state.get("emotional", {}),
            "cognitive_state": character_state.get("cognitive", {}),
            "trigger_source": "live_character_engine"
        }
        
        # 发送WebSocket通知
        import asyncio
        asyncio.create_task(
            self.notification_service.broadcast_to_char(character_name, {
                "type": "live_action_triggered",
                "action_type": "phone_call",
                "data": phone_context
            })
        )
        
        return {
            "success": True,
            "action_type": "phone_call",
            "character_name": character_name
        }


class SideConversationHandler(BaseActionHandler):
    """私下对话处理器"""
    
    def handle(self, action_data: Dict, character_state: Dict) -> Dict:
        """
        触发私下对话生成
        
        场景:
        - 两个在场角色私下交流
        - 用户可能听不到
        - 显示提示或生成音频
        """
        character_name = action_data.get("character_name")
        target = action_data.get("target")
        topic = action_data.get("topic", action_data.get("reason"))
        urgency = action_data.get("urgency", 0)
        
        print(f"[SideConversationHandler] 💬 私下对话: {character_name} 和 {target}, 话题: {topic}")
        
        # 构建私下对话场景
        conversation_context = {
            "speakers": [character_name, target],
            "topic": topic,
            "urgency": urgency,
            "character_states": {
                character_name: character_state
            },
            "trigger_source": "live_character_engine"
        }
        
        # 发送WebSocket通知
        import asyncio
        asyncio.create_task(
            self.notification_service.broadcast_to_char(character_name, {
                "type": "live_action_triggered",
                "action_type": "side_conversation",
                "data": conversation_context
            })
        )
        
        return {
            "success": True,
            "action_type": "side_conversation",
            "speakers": [character_name, target]
        }


class LeaveSceneHandler(BaseActionHandler):
    """离场处理器"""
    
    def handle(self, action_data: Dict, character_state: Dict) -> Dict:
        """
        处理角色离场
        
        显示提示:
        - "XX想要离开..."
        - 原因
        """
        character_name = action_data.get("character_name")
        reason = action_data.get("reason")
        urgency = action_data.get("urgency", 0)
        
        print(f"[LeaveSceneHandler] 🚪 {character_name} 想要离开: {reason}")
        
        # 构建离场提示
        leave_context = {
            "character_name": character_name,
            "reason": reason,
            "urgency": urgency,
            "emotional_state": character_state.get("emotional", {}),
            "message": f"{character_name}看起来想要离开 ({reason})"
        }
        
        # 发送WebSocket通知
        import asyncio
        asyncio.create_task(
            self.notification_service.broadcast_to_char(character_name, {
                "type": "live_action_triggered",
                "action_type": "leave_scene",
                "data": leave_context
            })
        )
        
        return {
            "success": True,
            "action_type": "leave_scene",
            "character_name": character_name
        }


class SelfTalkHandler(BaseActionHandler):
    """内心独白处理器"""
    
    def handle(self, action_data: Dict, character_state: Dict) -> Dict:
        """
        处理内心独白/自言自语
        
        显示:
        - 角色的内心想法
        - 可能是文本或音频
        """
        character_name = action_data.get("character_name")
        content = action_data.get("reason", action_data.get("content"))
        urgency = action_data.get("urgency", 0)
        
        print(f"[SelfTalkHandler] 💭 {character_name} 内心独白: {content}")
        
        # 构建内心独白
        self_talk_context = {
            "character_name": character_name,
            "content": content,
            "urgency": urgency,
            "emotional_state": character_state.get("emotional", {}),
            "hidden_thoughts": character_state.get("social", {}).get("hidden_thoughts"),
            "trigger_source": "live_character_engine"
        }
        
        # 发送WebSocket通知
        import asyncio
        asyncio.create_task(
            self.notification_service.broadcast_to_char(character_name, {
                "type": "live_action_triggered",
                "action_type": "self_talk",
                "data": self_talk_context
            })
        )
        
        return {
            "success": True,
            "action_type": "self_talk",
            "character_name": character_name
        }
