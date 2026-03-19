import json
import re
from typing import List

from telegram_app.domain.models import OutboundMessage


class LlmResponseParser:
    def parse(self, data: dict) -> List[OutboundMessage]:
        if not data.get("choices"):
            return []

        message = data["choices"][0].get("message", {})
        tool_calls = message.get("tool_calls", [])
        parsed_messages: List[OutboundMessage] = []

        if tool_calls:
            for tc in tool_calls:
                func_name = tc.get("function", {}).get("name")
                args_str = tc.get("function", {}).get("arguments", "{}")
                try:
                    args = json.loads(args_str)
                    if func_name == "send_text_message":
                        parsed_messages.append(
                            OutboundMessage(
                                text=args.get("text", ""),
                                use_tts=False,
                                emotion="default",
                            )
                        )
                    elif func_name == "send_voice_message":
                        parsed_messages.append(
                            OutboundMessage(
                                text=args.get("text", ""),
                                use_tts=True,
                                emotion=args.get("emotion", "default"),
                            )
                        )
                except Exception as e:
                    print(f"[TelegramLLM] 工具参数解析失败: {e}\n参数: {args_str}")

        raw_content = message.get("content", "")
        if not parsed_messages and raw_content:
            try:
                clean_content = raw_content.strip()
                if clean_content.startswith("```"):
                    clean_content = re.sub(r"^```(?:json)?\s*", "", clean_content)
                    clean_content = re.sub(r"\s*```$", "", clean_content)

                parsed_json = json.loads(clean_content)
                if isinstance(parsed_json, list):
                    for item in parsed_json:
                        if isinstance(item, dict):
                            parsed_messages.append(
                                OutboundMessage(
                                    text=item.get("text", raw_content),
                                    use_tts=bool(item.get("use_tts", True)),
                                    emotion=item.get("emotion", "default"),
                                )
                            )
                else:
                    parsed_messages.append(
                        OutboundMessage(
                            text=raw_content, use_tts=True, emotion="default"
                        )
                    )
            except Exception:
                parsed_messages.append(
                    OutboundMessage(text=raw_content, use_tts=True, emotion="default")
                )

        return parsed_messages
