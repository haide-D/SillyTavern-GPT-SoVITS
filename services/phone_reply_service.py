"""
电话回复服务

职责:
- 接收用户回复
- 格式化为消息对象
- 插入到聊天历史(通过 WebSocket 通知前端)
"""
from typing import Optional, Dict
from datetime import datetime


class PhoneReplyService:
    """电话回复服务 - 处理用户在电话后的回复"""
    
    def __init__(self):
        print("[PhoneReplyService] 初始化完成")
    
    def process_reply(
        self,
        char_name: str,
        user_reply: str,
        call_id: Optional[int] = None
    ) -> Dict:
        """
        处理用户回复
        
        Args:
            char_name: 角色名称
            user_reply: 用户回复内容
            call_id: 电话记录ID(可选)
            
        Returns:
            格式化后的消息对象,供前端插入聊天历史
        """
        try:
            print(f"[PhoneReplyService] 处理用户回复: {char_name} <- {user_reply[:30]}")
            
            # 格式化为消息对象
            message = {
                "type": "phone_reply",
                "char_name": char_name,
                "call_id": call_id,
                "content": user_reply,
                "timestamp": datetime.now().isoformat(),
                
                # 用于前端插入聊天历史的字段
                "message_data": {
                    "name": "{{user}}",  # 标记为用户消息
                    "is_user": True,
                    "mes": f"*[回复电话]* {user_reply}",
                    "send_date": datetime.now().timestamp() * 1000
                }
            }
            
            print(f"[PhoneReplyService] ✅ 回复已处理,准备发送到前端")
            return message
            
        except Exception as e:
            print(f"[PhoneReplyService] ❌ 处理回复失败: {e}")
            return {
                "type": "phone_reply_error",
                "error": str(e)
            }
    
    def format_reply_for_context(self, user_reply: str) -> str:
        """
        格式化回复为上下文消息
        
        Args:
            user_reply: 用户回复
            
        Returns:
            格式化后的消息文本
        """
        return f"*[回复电话]* {user_reply}"
