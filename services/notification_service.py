from typing import Dict, List, Optional, Set
from fastapi import WebSocket
import json
import asyncio


class NotificationService:
    """推送通知服务 - 管理 WebSocket 连接,推送生成结果"""
    
    # 类级别的连接池: {char_name: Set[WebSocket]}
    _connections: Dict[str, Set[WebSocket]] = {}
    _lock = asyncio.Lock()
    
    @classmethod
    async def register_connection(cls, char_name: str, websocket: WebSocket):
        """
        注册 WebSocket 连接
        
        Args:
            char_name: 角色名称
            websocket: WebSocket 连接对象
        """
        async with cls._lock:
            if char_name not in cls._connections:
                cls._connections[char_name] = set()
            cls._connections[char_name].add(websocket)
            print(f"[NotificationService] ✅ 连接已注册: {char_name}, 当前连接数={len(cls._connections[char_name])}")
    
    @classmethod
    async def unregister_connection(cls, char_name: str, websocket: WebSocket):
        """
        注销 WebSocket 连接
        
        Args:
            char_name: 角色名称
            websocket: WebSocket 连接对象
        """
        async with cls._lock:
            if char_name in cls._connections:
                cls._connections[char_name].discard(websocket)
                if not cls._connections[char_name]:
                    del cls._connections[char_name]
                print(f"[NotificationService] 连接已注销: {char_name}")
    
    
    @classmethod
    async def notify_llm_request(cls, call_id: int, char_name: str, prompt: str, llm_config: Dict, speakers: List[str], chat_branch: str):
        """
        推送LLM调用请求通知 (新架构)
        
        通知前端需要调用LLM,前端调用后将结果发送到 /api/phone_call/complete_generation
        
        Args:
            call_id: 电话记录ID
            char_name: 角色名称
            prompt: LLM提示词
            llm_config: LLM配置
            speakers: 说话人列表
            chat_branch: 对话分支ID
        """
        message = {
            "type": "llm_request",
            "call_id": call_id,
            "char_name": char_name,
            "prompt": prompt,
            "llm_config": llm_config,
            "speakers": speakers,
            "chat_branch": chat_branch,
            "timestamp": asyncio.get_event_loop().time()
        }
        
        print(f"[NotificationService] 📤 通知前端调用LLM: call_id={call_id}, char={char_name}")
        await cls.broadcast_to_char(char_name, message)
    
    @classmethod
    async def notify_eavesdrop_llm_request(cls, record_id: int, char_name: str, prompt: str, 
                                            llm_config: Dict, speakers: List[str], 
                                            chat_branch: str, scene_description: Optional[str] = None):
        """
        推送对话追踪LLM调用请求通知
        
        通知前端需要调用LLM,前端调用后将结果发送到 /api/eavesdrop/complete_generation
        
        Args:
            record_id: 对话追踪记录ID
            char_name: 角色名称 (用于WebSocket路由)
            prompt: LLM提示词
            llm_config: LLM配置
            speakers: 说话人列表
            chat_branch: 对话分支ID
            scene_description: 场景描述
        """
        message = {
            "type": "eavesdrop_llm_request",
            "record_id": record_id,
            "char_name": char_name,
            "prompt": prompt,
            "llm_config": llm_config,
            "speakers": speakers,
            "chat_branch": chat_branch,
            "scene_description": scene_description,
            "timestamp": asyncio.get_event_loop().time()
        }
        
        print(f"[NotificationService] 📤 通知前端调用LLM(对话追踪): record_id={record_id}, speakers={speakers}")
        await cls.broadcast_to_char(char_name, message)
    
    @classmethod
    async def notify_scene_analysis_request(
        cls, 
        request_id: str,
        char_name: str, 
        prompt: str, 
        llm_config: Dict, 
        speakers: List[str], 
        chat_branch: str,
        trigger_floor: int,
        context_fingerprint: str,
        context: List[Dict],
        user_name: Optional[str] = None
    ):
        """
        推送场景分析 LLM 请求通知
        
        通知前端调用 LLM 进行场景分析，前端调用后将结果发送到 /api/scene_analysis/complete
        
        Args:
            request_id: 请求唯一ID
            char_name: 角色名称 (用于WebSocket路由)
            prompt: LLM提示词
            llm_config: LLM配置
            speakers: 说话人列表
            chat_branch: 对话分支ID
            trigger_floor: 触发楼层
            context_fingerprint: 上下文指纹
            context: 对话上下文
            user_name: 用户名
        """
        message = {
            "type": "scene_analysis_request",
            "request_id": request_id,
            "char_name": char_name,
            "prompt": prompt,
            "llm_config": llm_config,
            "speakers": speakers,
            "chat_branch": chat_branch,
            "trigger_floor": trigger_floor,
            "context_fingerprint": context_fingerprint,
            "context": context,
            "user_name": user_name,
            "timestamp": asyncio.get_event_loop().time()
        }
        
        print(f"[NotificationService] 📤 通知前端调用LLM(场景分析): request_id={request_id}, speakers={speakers}")
        await cls.broadcast_to_char(char_name, message)
    
    @classmethod
    async def notify_phone_call_ready(cls, char_name: str, call_id: int, segments: List[Dict], audio_path: Optional[str], audio_url: Optional[str] = None, selected_speaker: Optional[str] = None):
        """
        推送电话生成完成通知
        
        Args:
            char_name: 角色名称 (用于 WebSocket 路由)
            call_id: 电话记录ID
            segments: 情绪片段
            audio_path: 音频文件路径
            audio_url: 音频 HTTP URL
            selected_speaker: LLM 选择的实际打电话人 (可能与 char_name 不同)
        """
        message = {
            "type": "phone_call_ready",
            "char_name": char_name,
            "selected_speaker": selected_speaker or char_name,  # 实际打电话人
            "call_id": call_id,
            "segments": segments,
            "audio_path": audio_path,
            "audio_url": audio_url,
            "timestamp": asyncio.get_event_loop().time()
        }
        
        await cls.broadcast_to_char(char_name, message)
    
    @classmethod
    async def notify_eavesdrop_ready(cls, char_name: str, record_id: int, 
                                      speakers: List[str], segments: List[Dict],
                                      audio_url: Optional[str] = None,
                                      scene_description: Optional[str] = None):
        """
        推送对话追踪生成完成通知
        
        Args:
            char_name: 角色名称 (用于确定推送目标)
            record_id: 记录ID
            speakers: 参与对话的角色列表
            segments: 对话片段
            audio_url: 音频 HTTP URL
            scene_description: 场景描述
        """
        message = {
            "type": "eavesdrop_ready",
            "record_id": record_id,
            "speakers": speakers,
            "segments": segments,
            "audio_url": audio_url,
            "scene_description": scene_description,
            "notification_text": f"检测到 {' 和 '.join(speakers[:2])} 正在私下对话，点击监听",
            "timestamp": asyncio.get_event_loop().time()
        }
        
        print(f"[NotificationService] 📤 对话追踪已就绪: speakers={speakers}")
        await cls.broadcast_to_char(char_name, message)
    
    @classmethod
    async def broadcast_to_char(cls, char_name: str, message: Dict):
        """
        向指定角色的所有连接广播消息
        
        Args:
            char_name: 角色名称
            message: 消息内容
        """
        async with cls._lock:
            if char_name not in cls._connections or not cls._connections[char_name]:
                print(f"[NotificationService] ⚠️ 无活跃连接: {char_name}, 消息未推送")
                return
            
            # 复制连接集合,避免迭代时修改
            connections = cls._connections[char_name].copy()
        
        # 发送消息
        message_json = json.dumps(message, ensure_ascii=False)
        disconnected = []
        
        for ws in connections:
            try:
                await ws.send_text(message_json)
                print(f"[NotificationService] ✅ 消息已推送: {char_name}, type={message.get('type')}")
            except Exception as e:
                print(f"[NotificationService] ❌ 推送失败: {char_name}, 错误={str(e)}")
                disconnected.append(ws)
        
        # 清理断开的连接
        if disconnected:
            async with cls._lock:
                for ws in disconnected:
                    cls._connections[char_name].discard(ws)
    
    @classmethod
    def get_connection_count(cls, char_name: Optional[str] = None) -> int:
        """
        获取连接数量
        
        Args:
            char_name: 角色名称,为 None 时返回总连接数
            
        Returns:
            连接数量
        """
        if char_name:
            return len(cls._connections.get(char_name, set()))
        else:
            return sum(len(conns) for conns in cls._connections.values())
