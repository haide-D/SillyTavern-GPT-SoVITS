def get_chat_tools(emotions_str: str) -> list[dict]:
    """返回供大模型使用的 Function Calling (Tools) 结构化定义。"""
    return [
        {
            "type": "function",
            "function": {
                "name": "send_text_message",
                "description": "发送一条纯文本消息。当你不需要语音播报或当前文字只适合作为附加说明时使用此工具。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "text": {
                            "type": "string",
                            "description": "要发送的具体文本内容。",
                        }
                    },
                    "required": ["text"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "send_voice_message",
                "description": "发送一条带情感表现的语音消息。这是你的主要发声方式。为了模拟真实的语音聊天体验，你可以多次调用此工具拆分短句陆续发出。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "text": {
                            "type": "string",
                            "description": "将要合成语音的文本内容。",
                        },
                        "emotion": {
                            "type": "string",
                            "description": f"说话时的情绪状态。请务必优先选择具体的、带感情的标签。可用情绪={emotions_str}",
                        },
                    },
                    "required": ["text", "emotion"],
                },
            },
        },
    ]
