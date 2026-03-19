from typing import Dict


def is_group_chat(chat_type: str) -> bool:
    return chat_type in ["group", "supergroup"]


def should_reply_in_group(is_reply_to_bot: bool, is_mention: bool) -> bool:
    return bool(is_reply_to_bot or is_mention)


class RoundCounter:
    """记录 chat_id 的轮次数，用于记忆触发。"""

    def __init__(self):
        self._rounds: Dict[str, int] = {}

    def increment(self, chat_id: str) -> int:
        self._rounds[chat_id] = self._rounds.get(chat_id, 0) + 1
        return self._rounds[chat_id]


def should_trigger_memory(round_count: int, interval: int = 10) -> bool:
    return round_count > 0 and round_count % interval == 0
