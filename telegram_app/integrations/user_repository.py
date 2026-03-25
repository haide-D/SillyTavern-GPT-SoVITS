import logging
from typing import Dict, Optional

from database import DatabaseManager


logger = logging.getLogger(__name__)


class TelegramUserRepository:
    def __init__(self):
        self.db = DatabaseManager()

    def get_user_display_name(self, user) -> str:
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

        return name

    def update_user_activity(self, user, chat_id: str):
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
                first_name=first_name,
            )
        except Exception as e:
            logger.error(f"[UserManager] 更新用户活跃状态失败: {e}")

    def set_user_persona(self, user_id: str, persona: str) -> bool:
        try:
            self.db.upsert_telegram_user(user_id=str(user_id), persona=persona)
            return True
        except Exception as e:
            logger.error(f"[UserManager] 设置用户人设失败: {e}")
            return False

    def get_user_persona(self, user_id: str) -> Optional[str]:
        try:
            record = self.db.get_telegram_user(str(user_id))
            if record and record.get("persona"):
                return record["persona"]
        except Exception as e:
            logger.error(f"[UserManager] 获取用户人设失败: {e}")
        return None

    def get_active_personas_in_chat(
        self, chat_id: str, active_user_ids: list = None
    ) -> Dict[str, str]:
        personas = {}
        try:
            if not active_user_ids:
                return personas

            for uid in active_user_ids:
                record = self.db.get_telegram_user(str(uid))
                if record and record.get("persona"):
                    name = (
                        record.get("first_name")
                        or record.get("username")
                        or f"User{uid}"
                    )
                    personas[name] = record.get("persona")
        except Exception as e:
            logger.error(f"[UserManager] 获取群内人设失败: {e}")

        return personas

    def find_user_id_by_display_name(self, display_name: str) -> Optional[str]:
        """根据显示名查找 Telegram 用户 ID（用于私聊发送）"""
        try:
            user = self.db.find_telegram_user_by_name(display_name)
            if user:
                return user.get("user_id")
        except Exception as e:
            logger.error(f"[UserManager] 按名称查找用户失败: {e}")
        return None
