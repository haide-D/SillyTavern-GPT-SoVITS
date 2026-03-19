from typing import Iterable


def get_chat_tools(character_names: Iterable[str], allow_voice: bool) -> list[dict]:
    character_text = "、".join(character_names)
    delivery_enum = ["text", "voice"] if allow_voice else ["text"]
    delivery_desc = (
        "发送方式，可选 text 或 voice" if allow_voice else "发送方式，固定为 text"
    )

    return [
        {
            "type": "function",
            "function": {
                "name": "emit_bot_message",
                "description": "安排一个角色对应的 Telegram Bot 发送一条消息。可重复调用以形成多人对话。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "character_name": {
                            "type": "string",
                            "description": f"必须从当前可用角色中选择：{character_text}",
                        },
                        "text": {
                            "type": "string",
                            "description": "消息正文，必须像真实聊天消息一样自然简短。",
                        },
                        "delivery": {
                            "type": "string",
                            "enum": delivery_enum,
                            "description": delivery_desc,
                        },
                        "emotion": {
                            "type": "string",
                            "description": "语音情绪标签；如果 delivery=text 可填 default。",
                        },
                        "reply_to_trigger": {
                            "type": "boolean",
                            "description": "是否对本轮触发消息进行引用回复。通常只有第一条回复需要 true。",
                        },
                    },
                    "required": ["character_name", "text", "delivery"],
                },
            },
        }
    ]
