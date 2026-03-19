from telegram_app.domain.history import SessionHistoryRepository
from telegram_app.integrations.user_repository import TelegramUserRepository


class TelegramCommandService:
    def __init__(
        self,
        history_repo: SessionHistoryRepository,
        user_repo: TelegramUserRepository,
    ):
        self._history = history_repo
        self._users = user_repo

    def handle_start(self, chat_id: str) -> str:
        self._history.clear_history(chat_id)
        return "你好! 我是 SillyTavern 终端。发送 /clear 可以清空聊天历史。"

    def handle_clear(self, chat_id: str) -> str:
        self._history.clear_history(chat_id)
        return "脑子空空......历史记录已清除。"

    def handle_setpersona(self, user, chat_id: str, persona_text: str) -> str:
        success = self._users.set_user_persona(str(user.id), persona_text)
        if success:
            self._users.update_user_activity(user, chat_id)
            display_name = self._users.get_user_display_name(user)
            return f"已为您 [{display_name}] 设定群聊人设：\n{persona_text}"
        return "人设设定失败，请检查终端日志。"

    def handle_whoami(self, user) -> str:
        persona = self._users.get_user_persona(str(user.id))
        display_name = self._users.get_user_display_name(user)
        if persona:
            return f"您的身份是 [{display_name}]\n当前人设设定为:\n{persona}"
        return f"您的身份是 [{display_name}]\n当前并未设定自定义人设。使用 /setpersona 马上设定！"
