from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class InboundMessage:
    chat_id: str
    chat_type: str
    text: str
    user_id: str
    user_display_name: str
    source_bot_id: str
    source_bot_username: str
    message_id: Optional[int] = None
    is_group: bool = False
    is_reply_to_bot: bool = False
    is_mention: bool = False
    namespace_key: Optional[str] = None
    mode: Optional[str] = None
    story_id: Optional[str] = None


@dataclass
class ReactionEvent:
    chat_id: str
    chat_type: str
    user_id: str
    user_display_name: str
    source_bot_id: str
    source_bot_username: str
    message_id: Optional[int]
    added_emojis: List[str]


@dataclass
class TelegramSessionState:
    namespace_key: str
    chat_id: str
    mode: str
    story_id: Optional[str] = None
    asset_pack_id: Optional[str] = None
    title: Optional[str] = None
    summary: Optional[str] = None


@dataclass
class OutboundMessage:
    character_id: str
    character_name: str
    text: str
    delivery: str = "text"
    emotion: str = "default"
    reply_to_trigger: bool = False
    target_user_display_name: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def use_tts(self) -> bool:
        return self.delivery == "voice"

    @property
    def is_private(self) -> bool:
        return bool(self.target_user_display_name)
