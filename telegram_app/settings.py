from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from config import SETTINGS_FILE, load_json

DEFAULT_DIRECTOR_PROMPT = (
"你是一个负责多角色 Telegram 群聊编排的导演 AI。可用角色中的“旁白”仅用于且必须用于推进剧情、描写环境、刻画动作。当群聊遭遇剧情转折或需要场景描写时，一定要直接调度“旁白”角色来发言。除旁白外，其他角色发言必须保持口语化，严禁其他角色夹带动作描写。"
)


@dataclass
class TelegramBotConfig:
    bot_id: str
    bot_token: str
    character_ref: str
    character_name: str = ""
    tts_character: str = ""
    voice_enabled: bool = False
    voice_lang: str = "zh"
    allowed_chat_ids: List[str] = field(default_factory=list)
    enabled: bool = True


@dataclass
class TelegramModeConfig:
    max_history: int = 60
    memory_interval: int = 10
    max_snapshots: int = 3
    prompt_token_budget: int = 1800
    recent_messages: int = 50
    max_active_characters: int = 20
    max_speakers_per_turn: int = 3


@dataclass
class TelegramSharedLlmConfig:
    api_url: str
    api_key: str
    model: str
    temperature: float
    max_tokens: int
    system_prompt: str


@dataclass
class TelegramSettings:
    enabled: bool
    proxy_enabled: bool
    proxy_http: str
    bots: List[TelegramBotConfig]
    default_mode: str
    default_asset_pack_id: str
    shared_llm: TelegramSharedLlmConfig
    modes: Dict[str, TelegramModeConfig]

    def get_mode(self, mode: Optional[str]) -> TelegramModeConfig:
        mode_name = mode or self.default_mode
        return self.modes.get(mode_name, self.modes[self.default_mode])

    def get_enabled_bots(self) -> List[TelegramBotConfig]:
        return [bot for bot in self.bots if bot.enabled and bot.bot_token]

    def get_bot(self, bot_id: str) -> Optional[TelegramBotConfig]:
        for bot in self.bots:
            if bot.bot_id == bot_id:
                return bot
        return None


def _normalize_bot(raw: Dict[str, Any], index: int) -> TelegramBotConfig:
    character_ref = (
        raw.get("character_ref")
        or raw.get("character_id")
        or raw.get("character_name")
        or f"bot_{index}"
    ).strip()
    bot_id = (raw.get("bot_id") or character_ref or f"bot_{index}").strip()
    character_name = (raw.get("character_name") or "").strip()
    return TelegramBotConfig(
        bot_id=bot_id,
        bot_token=(raw.get("bot_token") or "").strip(),
        character_ref=character_ref,
        character_name=character_name,
        tts_character=(
            raw.get("tts_character") or character_name or character_ref
        ).strip(),
        voice_enabled=bool(raw.get("voice_enabled", False)),
        voice_lang=(raw.get("voice_lang") or "zh").strip() or "zh",
        allowed_chat_ids=[str(cid) for cid in raw.get("allowed_chat_ids", [])],
        enabled=bool(raw.get("enabled", True)),
    )


def _normalize_modes(raw_modes: Dict[str, Any]) -> Dict[str, TelegramModeConfig]:
    defaults = {
        "free_chat": TelegramModeConfig(),
        "scripted_story": TelegramModeConfig(
            max_history=70,
            memory_interval=6,
            max_snapshots=20,
            prompt_token_budget=2400,
            recent_messages=60,
            max_active_characters=4,
            max_speakers_per_turn=2,
        ),
        "murder_mystery": TelegramModeConfig(
            max_history=40,
            memory_interval=4,
            max_snapshots=6,
            prompt_token_budget=2600,
            recent_messages=30,
            max_active_characters=4,
            max_speakers_per_turn=2,
        ),
    }

    modes: Dict[str, TelegramModeConfig] = {}
    for name, base in defaults.items():
        raw = raw_modes.get(name, {}) if isinstance(raw_modes.get(name), dict) else {}
        modes[name] = TelegramModeConfig(
            max_history=int(raw.get("max_history", base.max_history)),
            memory_interval=int(raw.get("memory_interval", base.memory_interval)),
            max_snapshots=int(raw.get("max_snapshots", base.max_snapshots)),
            prompt_token_budget=int(
                raw.get("prompt_token_budget", base.prompt_token_budget)
            ),
            recent_messages=int(raw.get("recent_messages", base.recent_messages)),
            max_active_characters=int(
                raw.get("max_active_characters", base.max_active_characters)
            ),
            max_speakers_per_turn=int(
                raw.get("max_speakers_per_turn", base.max_speakers_per_turn)
            ),
        )
    return modes


def _get_telegram_config() -> Dict[str, Any]:
    settings = load_json(SETTINGS_FILE)
    config = settings.get("telegram", {})
    if not isinstance(config, dict):
        return {}
    return config


def get_telegram_settings() -> TelegramSettings:
    config = _get_telegram_config()
    proxy_config = (
        config.get("proxy", {}) if isinstance(config.get("proxy"), dict) else {}
    )
    llm_config = config.get("shared_llm", config.get("llm", {}))
    if not isinstance(llm_config, dict):
        llm_config = {}

    bots_raw = config.get("bots", [])
    if not isinstance(bots_raw, list):
        bots_raw = []

    if not bots_raw and config.get("bot_token"):
        legacy_name = str(config.get("character") or "legacy").strip() or "legacy"
        bots_raw = [
            {
                "bot_id": "legacy",
                "bot_token": config.get("bot_token", ""),
                "character_ref": legacy_name,
                "character_name": legacy_name,
                "tts_character": legacy_name,
                "voice_enabled": bool(config.get("voice_reply", False)),
                "allowed_chat_ids": config.get("allowed_chat_ids", []),
                "enabled": bool(config.get("enabled", False)),
            }
        ]

    bots = [_normalize_bot(raw, idx + 1) for idx, raw in enumerate(bots_raw)]
    modes = _normalize_modes(config.get("modes", {}))
    default_mode = (config.get("default_mode") or "free_chat").strip() or "free_chat"
    if default_mode not in modes:
        default_mode = "free_chat"

    return TelegramSettings(
        enabled=bool(config.get("enabled")),
        proxy_enabled=bool(proxy_config.get("enabled")),
        proxy_http=(proxy_config.get("http") or "").strip(),
        bots=bots,
        default_mode=default_mode,
        default_asset_pack_id=(config.get("default_asset_pack_id") or "").strip(),
        shared_llm=TelegramSharedLlmConfig(
            api_url=(llm_config.get("api_url") or "").strip(),
            api_key=(llm_config.get("api_key") or "").strip(),
            model=(llm_config.get("model") or "").strip(),
            temperature=float(llm_config.get("temperature", 0.8)),
            max_tokens=int(llm_config.get("max_tokens", 2000)),
            system_prompt=(
                llm_config.get("system_prompt") or DEFAULT_DIRECTOR_PROMPT
            ).strip(),
        ),
        modes=modes,
    )
