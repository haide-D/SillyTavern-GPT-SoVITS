from typing import Dict


def is_group_chat(chat_type: str) -> bool:
    return chat_type in ["group", "supergroup"]


def should_reply_in_group(is_reply_to_bot: bool, is_mention: bool) -> bool:
    return bool(is_reply_to_bot or is_mention)


class RoundCounter:
    def __init__(self):
        self._rounds: Dict[str, int] = {}

    def increment(self, namespace_key: str) -> int:
        self._rounds[namespace_key] = self._rounds.get(namespace_key, 0) + 1
        return self._rounds[namespace_key]


def should_trigger_memory(round_count: int, interval: int) -> bool:
    return interval > 0 and round_count > 0 and round_count % interval == 0
