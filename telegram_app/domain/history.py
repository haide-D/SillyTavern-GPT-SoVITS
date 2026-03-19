from typing import Dict, List

from telegram_app.settings import get_telegram_settings


class SessionHistoryRepository:
    """短期会话历史缓存 (chat_id -> messages)。"""

    def __init__(self, settings_provider=get_telegram_settings):
        self._settings_provider = settings_provider
        self._history: Dict[str, List[Dict[str, str]]] = {}

    def clear_history(self, chat_id: str):
        self._history[chat_id] = []

    def add_message(
        self,
        chat_id: str,
        role: str,
        content: str,
        speaker_name: str = None,
        speaker_id: str = None,
    ):
        if chat_id not in self._history:
            self._history[chat_id] = []

        msg_record = {"role": role, "content": content}
        if speaker_name:
            msg_record["speaker_name"] = speaker_name
        if speaker_id:
            msg_record["speaker_id"] = speaker_id

        self._history[chat_id].append(msg_record)

        max_history = self._settings_provider().max_history
        if len(self._history[chat_id]) > max_history:
            self._history[chat_id] = self._history[chat_id][-max_history:]

    def get_messages(self, chat_id: str) -> List[Dict[str, str]]:
        return [dict(m) for m in self._history.get(chat_id, [])]
