import json
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from telegram_app.assets.models import ResolvedTelegramCharacter
from telegram_app.domain.models import OutboundMessage


@dataclass
class ClueRecord:
    clue_text: str
    visibility: str = "public"
    related_character: str = ""


import re

def _split_message_text(text: str, max_chunk_len: int = 50) -> List[str]:
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    chunks = []
    for line in lines:
        if len(line) <= max_chunk_len:
            chunks.append(line)
            continue
        sub_chunks = re.split(r'([。！？…~]+)', line)
        current = ""
        for i in range(0, len(sub_chunks) - 1, 2):
            piece = sub_chunks[i] + sub_chunks[i+1]
            if len(current) + len(piece) > max_chunk_len and current:
                chunks.append(current.strip())
                current = piece
            else:
                current += piece
        if len(sub_chunks) % 2 != 0:
            last_piece = sub_chunks[-1]
            if len(current) + len(last_piece) > max_chunk_len and current:
                chunks.append(current.strip())
                current = last_piece
            else:
                current += last_piece
        if current:
            chunks.append(current.strip())
    return [c for c in chunks if c]


class LlmResponseParser:
    def parse(
        self, data: dict, bots: List[ResolvedTelegramCharacter]
    ) -> Tuple[List[OutboundMessage], List[ClueRecord]]:
        if not data.get("choices"):
            return [], []

        bot_by_name: Dict[str, ResolvedTelegramCharacter] = {
            bot.character_name: bot for bot in bots
        }
        bot_by_ref: Dict[str, ResolvedTelegramCharacter] = {
            bot.character_ref: bot for bot in bots
        }

        message = data["choices"][0].get("message", {})
        tool_calls = message.get("tool_calls", [])
        parsed: List[OutboundMessage] = []
        clues: List[ClueRecord] = []

        is_first_reply = True

        for tc in tool_calls:
            func_name = tc.get("function", {}).get("name")
            args_str = tc.get("function", {}).get("arguments", "{}")
            try:
                args = json.loads(args_str)
            except Exception as exc:
                print(f"[TelegramLLM] 工具参数解析失败: {exc}\n参数: {args_str}")
                continue

            if func_name in ("emit_bot_message", "emit_private_message"):
                character_name = (args.get("character_name") or "").strip()
                bot = bot_by_name.get(character_name) or bot_by_ref.get(character_name)
                if not bot:
                    print(f"[TelegramLLM] 未找到角色对应 bot: {character_name}")
                    continue

                raw_text = (args.get("text") or "").strip()
                for chunk in _split_message_text(raw_text):
                    parsed.append(
                        OutboundMessage(
                            character_id=bot.character_ref,
                            character_name=bot.character_name,
                            text=chunk,
                            delivery=(args.get("delivery") or "text").strip() or "text",
                            emotion=(args.get("emotion") or "default").strip() or "default",
                            reply_to_trigger=bool(args.get("reply_to_trigger", False)) and is_first_reply,
                            target_user_display_name=(
                                (args.get("target_user_display_name") or "").strip() or None
                            )
                            if func_name == "emit_private_message"
                            else None,
                        )
                    )
                    is_first_reply = False

            elif func_name == "save_clue":
                clue_text = (args.get("clue_text") or "").strip()
                if clue_text:
                    clues.append(
                        ClueRecord(
                            clue_text=clue_text,
                            visibility=(args.get("visibility") or "public").strip(),
                            related_character=(args.get("related_character") or "").strip(),
                        )
                    )

        return [item for item in parsed if item.text], clues
