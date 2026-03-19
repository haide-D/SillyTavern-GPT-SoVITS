from typing import Optional

from telegram_app.application.session_service import TelegramSessionService
from telegram_app.domain.history import SessionHistoryRepository
from telegram_app.integrations.user_repository import TelegramUserRepository
from telegram_app.settings import TelegramSettings


class TelegramCommandService:
    def __init__(
        self,
        history_repo: SessionHistoryRepository,
        user_repo: TelegramUserRepository,
        session_service: TelegramSessionService,
    ):
        self._history = history_repo
        self._users = user_repo
        self._sessions = session_service

    def handle_start(self, chat_id: str, settings: TelegramSettings) -> str:
        session = self._sessions.ensure_active_session(chat_id, settings)
        return (
            "多 Bot 导演模式已就绪。\n"
            f"当前模式: {session.mode}\n"
            f"当前命名空间: {session.namespace_key}\n"
            "使用 /mode 查看或切换模式，/story <id> 进入指定剧本。"
        )

    def handle_clear(self, chat_id: str, settings: TelegramSettings) -> str:
        session = self._sessions.ensure_active_session(chat_id, settings)
        self._history.clear_history(session.namespace_key)
        return f"已清空当前会话命名空间历史: {session.namespace_key}"

    def handle_mode(
        self, chat_id: str, settings: TelegramSettings, mode: Optional[str]
    ) -> str:
        if not mode:
            session = self._sessions.ensure_active_session(chat_id, settings)
            return f"当前模式: {session.mode}\n命名空间: {session.namespace_key}"
        session = self._sessions.switch_mode(chat_id, settings, mode=mode)
        return f"已切换模式到 {session.mode}\n命名空间: {session.namespace_key}"

    def handle_story(
        self,
        chat_id: str,
        settings: TelegramSettings,
        story_id: Optional[str],
    ) -> str:
        if not story_id:
            sessions = self._sessions.list_sessions(chat_id)
            if not sessions:
                return "当前没有已保存剧本会话。"
            lines = ["当前群聊已存在的会话："]
            for item in sessions[:10]:
                marker = "*" if item.get("is_active") else "-"
                lines.append(
                    f"{marker} {item.get('mode')} | story={item.get('story_id') or '-'} | {item.get('namespace_key')}"
                )
            return "\n".join(lines)

        session = self._sessions.switch_mode(
            chat_id,
            settings,
            mode="scripted_story",
            story_id=story_id,
            title=story_id,
        )
        return (
            f"已切换到剧本 {story_id}\n"
            f"旧剧本记忆已冻结，新命名空间为: {session.namespace_key}"
        )

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
