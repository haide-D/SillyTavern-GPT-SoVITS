from dataclasses import dataclass
from typing import List, Optional


@dataclass
class InboundMessage:
    chat_id: str
    chat_type: str
    text: str
    user_id: str
    user_display_name: str
    message_id: Optional[int] = None
    is_group: bool = False
    is_reply_to_bot: bool = False
    is_mention: bool = False


@dataclass
class ReactionEvent:
    chat_id: str
    chat_type: str
    user_id: str
    user_display_name: str
    message_id: Optional[int]
    added_emojis: List[str]


@dataclass
class OutboundMessage:
    text: str
    use_tts: bool = True
    emotion: str = "default"
