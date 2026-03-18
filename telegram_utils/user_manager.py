import logging
from typing import Optional, Dict, Any
from database import DatabaseManager

logger = logging.getLogger(__name__)

class TelegramUserManager:
    """管理 Telegram 多用户身份信息、人设(Persona) 等数据"""
    
    def __init__(self):
        self.db = DatabaseManager()

    def get_user_display_name(self, user) -> str:
        """从 Telegram User 对象中提取最佳显示名称"""
        if not user:
            return "未知用户"
        if user.first_name and user.last_name:
            name = f"{user.first_name} {user.last_name}"
        elif user.first_name:
            name = user.first_name
        elif user.username:
            name = user.username
        else:
            name = f"User{user.id}"
            
        # 可以加上 username 后缀或者只返回姓名
        return name

    def update_user_activity(self, user, chat_id: str):
        """记录用户的最新活跃状态和基础信息"""
        if not user:
            return
            
        user_id = str(user.id)
        username = user.username or ""
        first_name = self.get_user_display_name(user)
        
        try:
            self.db.upsert_telegram_user(
                user_id=user_id,
                chat_id=str(chat_id),
                username=username,
                first_name=first_name
            )
        except Exception as e:
            logger.error(f"[UserManager] 更新用户活跃状态失败: {e}")

    def set_user_persona(self, user_id: str, persona: str) -> bool:
        """设置/更新用户自定义人设"""
        try:
            # 保证记录存在，即使由于某些原因之前没记录 activity
            self.db.upsert_telegram_user(user_id=str(user_id), persona=persona)
            return True
        except Exception as e:
            logger.error(f"[UserManager] 设置用户人设失败: {e}")
            return False

    def get_user_persona(self, user_id: str) -> Optional[str]:
        """获取指定用户的人设"""
        try:
            record = self.db.get_telegram_user(str(user_id))
            if record and record.get("persona"):
                return record["persona"]
        except Exception as e:
            logger.error(f"[UserManager] 获取用户人设失败: {e}")
        return None

    def get_active_personas_in_chat(self, chat_id: str, active_user_ids: list = None) -> Dict[str, str]:
        """
        获取群组中活跃成员的人设。
        传入 active_user_ids (最近发言的 user_id 列表) 来精确匹配。
        返回 Dict: {显示名称: persona}
        """
        personas = {}
        try:
            if not active_user_ids:
                return personas
                
            for uid in active_user_ids:
                record = self.db.get_telegram_user(str(uid))
                if record and record.get("persona"):
                    # 优先使用记录里的 first_name 当作代号
                    name = record.get("first_name") or record.get("username") or f"User{uid}"
                    personas[name] = record.get("persona")
        except Exception as e:
            logger.error(f"[UserManager] 获取群内人设失败: {e}")
            
        return personas

# 全局单例
user_manager = TelegramUserManager()
