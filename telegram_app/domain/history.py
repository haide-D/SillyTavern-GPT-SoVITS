from typing import Dict, List, Optional

from database import DatabaseManager


class SessionHistoryRepository:
    """Namespace-aware Telegram history backed by SQLite."""

    def __init__(self):
        self._db = DatabaseManager()

    def clear_history(self, namespace_key: str):
        self._db.clear_telegram_messages(namespace_key)

    def add_message(
        self,
        namespace_key: str,
        chat_id: str,
        role: str,
        content: str,
        speaker_type: str,
        source_bot_id: Optional[str] = None,
        source_bot_username: Optional[str] = None,
        sender_user_id: Optional[str] = None,
        sender_display_name: Optional[str] = None,
        character_id: Optional[str] = None,
        character_name: Optional[str] = None,
        delivery: str = "text",
        emotion: Optional[str] = None,
        telegram_message_id: Optional[int] = None,
        reply_to_message_id: Optional[int] = None,
    ):
        self._db.add_telegram_message(
            namespace_key=namespace_key,
            chat_id=chat_id,
            speaker_type=speaker_type,
            role=role,
            content=content,
            source_bot_id=source_bot_id,
            source_bot_username=source_bot_username,
            sender_user_id=sender_user_id,
            sender_display_name=sender_display_name,
            character_id=character_id,
            character_name=character_name,
            delivery=delivery,
            emotion=emotion,
            telegram_message_id=telegram_message_id,
            reply_to_message_id=reply_to_message_id,
        )

    def get_messages(self, namespace_key: str, limit: int = 50) -> List[Dict[str, str]]:
        return self._db.get_telegram_messages(namespace_key, limit=limit)
