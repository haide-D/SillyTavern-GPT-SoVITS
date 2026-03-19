from typing import Iterable, List, Optional

from telegram_app.domain.models import TelegramSessionState
from telegram_app.settings import TelegramBotConfig, TelegramModeConfig


class PromptBuilder:
    @staticmethod
    def build_system_prompt(
        base_prompt: str,
        session: TelegramSessionState,
        bots: List[TelegramBotConfig],
        memory_context: str,
        story_state: Optional[dict],
        active_personas: Optional[dict],
        recent_messages: List[dict],
        mode_config: TelegramModeConfig,
        allow_voice: bool,
    ) -> str:
        parts: List[str] = []

        parts.append("============== 【导演职责】 ==============")
        parts.append(base_prompt.strip())
        parts.append(
            "你正在导演多个 Telegram Bot 扮演不同角色。你必须根据当前场景，选择最合适的 1~2 个角色发言。"
        )

        parts.append("============== 【当前会话】 ==============")
        parts.append(f"namespace={session.namespace_key}")
        parts.append(f"mode={session.mode}")
        if session.story_id:
            parts.append(f"story_id={session.story_id}")

        parts.append("============== 【可用角色】 ==============")
        for bot in bots:
            persona = bot.persona.strip() or "未提供额外 persona"
            voice_mode = "可语音" if allow_voice and bot.voice_enabled else "纯文本"
            parts.append(
                f"- {bot.character_name} ({bot.character_id}, {voice_mode}): {persona}"
            )

        if active_personas:
            parts.append("============== 【群成员人设】 ==============")
            for name, persona in active_personas.items():
                parts.append(f"- {name}: {persona}")

        if story_state:
            parts.append("============== 【当前剧情状态】 ==============")
            summary = story_state.get("summary") or ""
            goal = story_state.get("current_goal") or ""
            chapter = story_state.get("chapter_id") or ""
            if chapter:
                parts.append(f"chapter={chapter}")
            if goal:
                parts.append(f"goal={goal}")
            if summary:
                parts.append(summary)
            state_json = story_state.get("state_json") or {}
            if state_json:
                parts.append(f"structured_state={state_json}")

        if memory_context:
            parts.append("============== 【记忆摘要】 ==============")
            parts.append(memory_context.strip())

        parts.append("============== 【输出规则】 ==============")
        parts.append(
            f"- 本轮最多让 {mode_config.max_speakers_per_turn} 个角色发言；没人有必要说话时，可只让一个角色回应。"
        )
        parts.append("- 优先回应刚刚触发你的用户，不要让所有角色轮流刷屏。")
        parts.append("- 每条回复都必须通过工具 `emit_bot_message` 发出。")
        parts.append("- 严禁输出旁白、解释、系统说明或未通过工具的文本。")
        parts.append("- 文本必须像即时聊天，不写小说段落。")
        if allow_voice:
            parts.append("- 只有角色支持语音时才可使用 delivery=voice。")
        else:
            parts.append("- 当前只允许 delivery=text。")

        if recent_messages:
            parts.append("============== 【近期对话提示】 ==============")
            for msg in recent_messages[-6:]:
                speaker = (
                    msg.get("sender_display_name")
                    or msg.get("character_name")
                    or msg.get("role")
                )
                parts.append(f"- {speaker}: {msg.get('content', '')}")

        return "\n".join(parts)
