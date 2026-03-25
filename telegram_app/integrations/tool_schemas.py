from typing import Dict, Iterable, List

from telegram_app.assets.models import ResolvedTelegramCharacter


def _get_character_emotions(bots: List[ResolvedTelegramCharacter]) -> Dict[str, List[str]]:
    """动态获取每个有语音的角色支持的情绪标签"""
    result = {}
    try:
        from services.emotion_service import EmotionService
        for bot in bots:
            if not bot.voice_enabled:
                continue
            # 依次尝试 tts_character（英文 ref）和 character_name（中文名）
            candidates = [n for n in [bot.tts_character, bot.character_name] if n]
            print(f"[ToolSchema] 检查角色 {bot.character_name}: 候选名={candidates}")
            for name in candidates:
                try:
                    voice_lang = getattr(bot, "voice_lang", "zh")
                    emotions = EmotionService.get_available_emotions(name, voice_lang=voice_lang)
                    if not emotions:
                        # 如果指定语言没找到，回退找默认全量
                        emotions = EmotionService.get_available_emotions(name)
                    if emotions:
                        print(f"[ToolSchema] ✅ {bot.character_name} (via '{name}') 可用情绪: {emotions}")
                        result[bot.character_name] = emotions
                        break
                except Exception:
                    continue
            if bot.character_name not in result:
                print(f"[ToolSchema] ⚠️ {bot.character_name} 未找到可用情绪")
    except ImportError as e:
        print(f"[ToolSchema] ❌ EmotionService 导入失败: {e}")
    return result


def get_chat_tools(
    character_names: Iterable[str],
    allow_voice: bool,
    active_user_names: List[str] = None,
    bots: List[ResolvedTelegramCharacter] = None,
) -> list[dict]:
    character_text = "、".join(character_names)
    delivery_enum = ["text", "voice"] if allow_voice else ["text"]
    delivery_desc = (
        "发送方式。如果该角色标签中包含'可语音'，此项必定、绝对只能填 'voice'，严禁填 'text'！"
        if allow_voice
        else "发送方式，固定为 text"
    )

    # 动态获取各角色可用情绪
    char_emotions = _get_character_emotions(bots or [])
    if char_emotions:
        emotion_lines = []
        for name, emos in char_emotions.items():
            emotion_lines.append(f"{name}: {', '.join(emos)}")
        emotion_desc = "情绪标签，决定语音的情感色彩。各角色可用情绪：" + "；".join(emotion_lines) + "。必须根据角色当前心情选择合适的情绪。"
        all_emotions = sorted(set(e for emos in char_emotions.values() for e in emos))
        all_emotions = ["default"] + [e for e in all_emotions if e != "default"]
    else:
        emotion_desc = "情绪标签，决定语音的情感色彩。必须根据角色当前心情选择，不要一直用 default。"
        all_emotions = ["default"]

    tools = [
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
                            "enum": all_emotions,
                            "description": emotion_desc,
                        },
                        "reply_to_trigger": {
                            "type": "boolean",
                            "description": "是否对本轮触发消息进行引用回复。通常只有第一条回复需要 true。",
                        },
                        "voice_text": {
                            "type": "string",
                            "description": "仅当角色语音语言非中文时必填。填写该语言的原文台词（如日语/英语），用于语音合成。text 字段仍填中文翻译。",
                        },
                    },
                    "required": ["character_name", "text", "delivery", "emotion"],
                },
            },
        }
    ]

    # 私聊工具：向特定玩家发送秘密消息（身份卡、线索等）
    user_names_text = "、".join(active_user_names) if active_user_names else "当前群内活跃用户"
    tools.append(
        {
            "type": "function",
            "function": {
                "name": "emit_private_message",
                "description": "通过 Bot 私聊向指定玩家发送秘密消息（如身份卡、独家线索）。该消息不会在群聊中显示。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "character_name": {
                            "type": "string",
                            "description": f"由哪个角色发送，必须从可用角色中选择：{character_text}",
                        },
                        "target_user_display_name": {
                            "type": "string",
                            "description": f"目标玩家的显示名称，从当前群成员中选择：{user_names_text}",
                        },
                        "text": {
                            "type": "string",
                            "description": "私聊消息正文。",
                        },
                    },
                    "required": ["character_name", "target_user_display_name", "text"],
                },
            },
        }
    )

    # 线索工具：将重要线索/发现记录下来，后续对话可持续引用
    tools.append(
        {
            "type": "function",
            "function": {
                "name": "save_clue",
                "description": "记录一条重要线索或发现。已保存的线索会在后续对话中持续可见，确保剧情连贯。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clue_text": {
                            "type": "string",
                            "description": "线索内容，用自然语言描述即可。例如：'古河胸口有一个焦黑掌印，疑似异火所伤'。",
                        },
                        "visibility": {
                            "type": "string",
                            "enum": ["public", "private"],
                            "description": "public=所有人可见的公开线索, private=仅特定角色知晓的秘密线索。",
                        },
                        "related_character": {
                            "type": "string",
                            "description": "可选，与此线索相关的角色名。",
                        },
                    },
                    "required": ["clue_text", "visibility"],
                },
            },
        }
    )

    return tools
