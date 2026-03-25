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
        asset_pack_id: Optional[str] = None,
        title: Optional[str] = None,
    ) -> TelegramSessionState:
        active = self._db.get_active_telegram_session(chat_id)
        if active and not mode and not story_id and asset_pack_id is None:
            return self._row_to_state(active)

        resolved_mode = (
            mode or (active.get("mode") if active else None) or settings.default_mode
        )
        resolved_story = (
            story_id
            if story_id is not None
            else (active.get("story_id") if active else None)
        )
        resolved_pack = (
            asset_pack_id
            if asset_pack_id is not None
            else (active.get("asset_pack_id") if active else None)
            or settings.default_asset_pack_id
        )
        namespace_key = self.build_namespace_key(chat_id, resolved_mode, resolved_story)
        self._db.set_active_telegram_session(
            chat_id=chat_id,
            namespace_key=namespace_key,
            mode=resolved_mode,
            story_id=resolved_story,
            asset_pack_id=resolved_pack,
            title=title,
        )
        return TelegramSessionState(
            namespace_key=namespace_key,
            chat_id=chat_id,
            mode=resolved_mode,
            story_id=resolved_story,
            asset_pack_id=resolved_pack,
            title=title,
        )

    def switch_mode(
        self,
        chat_id: str,
        settings: TelegramSettings,
        mode: str,
        story_id: Optional[str] = None,
        asset_pack_id: Optional[str] = None,
        title: Optional[str] = None,
    ) -> TelegramSessionState:
        return self.ensure_active_session(
            chat_id=chat_id,
            settings=settings,
            mode=mode,
            story_id=story_id,
            asset_pack_id=asset_pack_id,
            title=title,
        )

    def bind_asset_pack(
        self, chat_id: str, settings: TelegramSettings, asset_pack_id: str
    ) -> TelegramSessionState:
        active = self._db.get_active_telegram_session(chat_id)
        if not active:
            return self.ensure_active_session(
                chat_id, settings, asset_pack_id=asset_pack_id
            )
        self._db.update_telegram_session_asset_pack(
            active["namespace_key"], asset_pack_id
        )
        active["asset_pack_id"] = asset_pack_id
        return self._row_to_state(active)

    def list_sessions(self, chat_id: str):
        return self._db.get_telegram_sessions(chat_id)

    @staticmethod
    def _row_to_state(row: dict) -> TelegramSessionState:
        return TelegramSessionState(
            namespace_key=row["namespace_key"],
            chat_id=row["chat_id"],
            mode=row["mode"],
            story_id=row.get("story_id"),
            asset_pack_id=row.get("asset_pack_id"),
            title=row.get("title"),
            summary=row.get("summary"),
        )
