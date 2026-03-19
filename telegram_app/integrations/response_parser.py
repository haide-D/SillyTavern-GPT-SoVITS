import json
from typing import Dict, List

from telegram_app.domain.models import OutboundMessage
from telegram_app.settings import TelegramBotConfig


class LlmResponseParser:
    def parse(self, data: dict, bots: List[TelegramBotConfig]) -> List[OutboundMessage]:
        if not data.get("choices"):
            return []

        bot_by_name: Dict[str, TelegramBotConfig] = {
            bot.character_name: bot for bot in bots
        }
        bot_by_id: Dict[str, TelegramBotConfig] = {
            bot.character_id: bot for bot in bots
        }

        message = data["choices"][0].get("message", {})
        tool_calls = message.get("tool_calls", [])
        parsed: List[OutboundMessage] = []

        for tc in tool_calls:
            func_name = tc.get("function", {}).get("name")
            if func_name != "emit_bot_message":
                continue
            args_str = tc.get("function", {}).get("arguments", "{}")
            try:
                args = json.loads(args_str)
            except Exception as exc:
                print(f"[TelegramLLM] 工具参数解析失败: {exc}\n参数: {args_str}")
                continue

            character_name = (args.get("character_name") or "").strip()
            bot = bot_by_name.get(character_name) or bot_by_id.get(character_name)
            if not bot:
                print(f"[TelegramLLM] 未找到角色对应 bot: {character_name}")
                continue

            parsed.append(
                OutboundMessage(
                    character_id=bot.character_id,
                    character_name=bot.character_name,
                    text=(args.get("text") or "").strip(),
                    delivery=(args.get("delivery") or "text").strip() or "text",
                    emotion=(args.get("emotion") or "default").strip() or "default",
                    reply_to_trigger=bool(args.get("reply_to_trigger", False)),
                )
            )

        return [item for item in parsed if item.text]
