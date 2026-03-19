from typing import Optional

from database import DatabaseManager
from telegram_app.domain.models import TelegramSessionState
from telegram_app.settings import TelegramSettings


class TelegramSessionService:
    def __init__(self, db: Optional[DatabaseManager] = None):
        self._db = db or DatabaseManager()

    @staticmethod
    def build_namespace_key(
        chat_id: str, mode: str, story_id: Optional[str] = None
    ) -> str:
        if story_id:
            return f"tg:{chat_id}:{mode}:{story_id}"
        return f"tg:{chat_id}:{mode}"

    def ensure_active_session(
        self,
        chat_id: str,
        settings: TelegramSettings,
        mode: Optional[str] = None,
        story_id: Optional[str] = None,
        title: Optional[str] = None,
    ) -> TelegramSessionState:
        active = self._db.get_active_telegram_session(chat_id)
        if active and not mode and not story_id:
            return TelegramSessionState(
                namespace_key=active["namespace_key"],
                chat_id=active["chat_id"],
                mode=active["mode"],
                story_id=active.get("story_id"),
                title=active.get("title"),
                summary=active.get("summary"),
            )

        resolved_mode = mode or settings.default_mode
        resolved_story = story_id
        namespace_key = self.build_namespace_key(chat_id, resolved_mode, resolved_story)
        self._db.set_active_telegram_session(
            chat_id=chat_id,
            namespace_key=namespace_key,
            mode=resolved_mode,
            story_id=resolved_story,
            title=title,
        )
        return TelegramSessionState(
            namespace_key=namespace_key,
            chat_id=chat_id,
            mode=resolved_mode,
            story_id=resolved_story,
            title=title,
        )

    def switch_mode(
        self,
        chat_id: str,
        settings: TelegramSettings,
        mode: str,
        story_id: Optional[str] = None,
        title: Optional[str] = None,
    ) -> TelegramSessionState:
        return self.ensure_active_session(
            chat_id=chat_id,
            settings=settings,
            mode=mode,
            story_id=story_id,
            title=title,
        )

    def list_sessions(self, chat_id: str):
        return self._db.get_telegram_sessions(chat_id)
