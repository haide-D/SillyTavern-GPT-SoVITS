from typing import Any, Dict, List

from config import load_json, SETTINGS_FILE


class TelegramSettings:
    def __init__(
        self,
        enabled: bool,
        bot_token: str,
        proxy_enabled: bool,
        proxy_http: str,
        allowed_chat_ids: List[str],
        voice_reply: bool,
        max_history: int,
        character: str,
        llm_api_url: str,
        llm_api_key: str,
        llm_model: str,
        llm_temperature: float,
        llm_max_tokens: int,
        llm_system_prompt: str,
    ):
        self.enabled = enabled
        self.bot_token = bot_token
        self.proxy_enabled = proxy_enabled
        self.proxy_http = proxy_http
        self.allowed_chat_ids = allowed_chat_ids
        self.voice_reply = voice_reply
        self.max_history = max_history
        self.character = character
        self.llm_api_url = llm_api_url
        self.llm_api_key = llm_api_key
        self.llm_model = llm_model
        self.llm_temperature = llm_temperature
        self.llm_max_tokens = llm_max_tokens
        self.llm_system_prompt = llm_system_prompt


def _get_telegram_config() -> Dict[str, Any]:
    settings = load_json(SETTINGS_FILE)
    return settings.get("telegram", {})


def get_telegram_settings() -> TelegramSettings:
    config = _get_telegram_config()
    llm_config = config.get("llm", {})
    proxy_config = config.get("proxy", {})

    return TelegramSettings(
        enabled=bool(config.get("enabled")),
        bot_token=config.get("bot_token") or "",
        proxy_enabled=bool(proxy_config.get("enabled")),
        proxy_http=proxy_config.get("http") or "",
        allowed_chat_ids=[str(cid) for cid in config.get("allowed_chat_ids", [])],
        voice_reply=bool(config.get("voice_reply", True)),
        max_history=int(config.get("max_history", 20)),
        character=config.get("character", "") or "",
        llm_api_url=llm_config.get("api_url", "") or "",
        llm_api_key=llm_config.get("api_key", "") or "",
        llm_model=llm_config.get("model", "") or "",
        llm_temperature=float(llm_config.get("temperature", 0.8)),
        llm_max_tokens=int(llm_config.get("max_tokens", 2000)),
        llm_system_prompt=llm_config.get("system_prompt", "你是一个聊天助理。") or "",
    )
