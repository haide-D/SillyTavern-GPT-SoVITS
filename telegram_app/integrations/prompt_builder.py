from typing import List, Optional

from telegram_app.assets.models import AssetPack, ResolvedTelegramCharacter, StoryAsset
from telegram_app.domain.models import TelegramSessionState
from telegram_app.settings import TelegramModeConfig


class PromptBuilder:
    @staticmethod
    def build_system_prompt(
        base_prompt: str,
        session: TelegramSessionState,
        bots: List[ResolvedTelegramCharacter],
        asset_pack: Optional[AssetPack],
        story_asset: Optional[StoryAsset],
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
            "你正在导演多个 Telegram Bot 扮演不同角色。根据场景，选择最合适的 1~2 个角色发言。"
        )

        parts.append("============== 【当前会话】 ==============")
        parts.append(f"namespace={session.namespace_key}")
        parts.append(f"mode={session.mode}")
        if session.story_id:
            parts.append(f"story_id={session.story_id}")
        if session.asset_pack_id:
            parts.append(f"asset_pack_id={session.asset_pack_id}")

        if asset_pack:
            parts.append("============== 【资产包】 ==============")
            parts.append(f"pack={asset_pack.name} ({asset_pack.pack_id})")
            if asset_pack.world.title:
                parts.append(f"world={asset_pack.world.title}")
            if asset_pack.world.summary:
                parts.append(asset_pack.world.summary)
            for rule in asset_pack.world.rules[:6]:
                parts.append(f"- 世界规则: {rule}")
            for lore in asset_pack.world.lore[:4]:
                parts.append(f"- 背景: {lore}")
            if asset_pack.director_prompt:
                parts.append(f"- 额外导演约束: {asset_pack.director_prompt}")

        if story_asset:
            parts.append("============== 【剧本资源】 ==============")
            parts.append(f"story={story_asset.title or story_asset.story_id}")
            if story_asset.opening:
                parts.append(story_asset.opening)
            for rule in story_asset.story_rules[:6]:
                parts.append(f"- 剧本规则: {rule}")

        parts.append("============== 【可用角色】 ==============")
        for bot in bots:
            voice_mode = "可语音" if allow_voice and bot.voice_enabled else "纯文本"
            parts.append(f"- {bot.character_name} ({bot.character_ref}, {voice_mode})")
            if bot.description:
                parts.append(f"  角色描述: {bot.description}")
            if bot.personality:
                parts.append(f"  性格: {bot.personality}")
            if bot.system_prompt_fragment:
                parts.append(f"  附加约束: {bot.system_prompt_fragment}")
            if bot.dialogue_examples:
                parts.append(f"  示例: {bot.dialogue_examples[0]}")

        if active_personas:
            parts.append("============== 【群成员人设】 ==============")
            for name, persona in active_personas.items():
                parts.append(f"- {name}: {persona}")

        if story_state:
            parts.append("============== 【当前剧情状态】 ==============")
            chapter = story_state.get("chapter_id") or ""
            goal = story_state.get("current_goal") or ""
            summary = story_state.get("summary") or ""
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
        parts.append(f"- 本轮最多让 {mode_config.max_speakers_per_turn} 个角色发言。")
        parts.append("- 优先回应刚刚触发你的用户，不要让所有角色轮流刷屏。")
        parts.append("- 每条回复都必须通过工具 `emit_bot_message` 发出。")
        parts.append("- 严禁输出旁白、解释、系统说明或未通过工具的文本。")
        parts.append("- 文本必须像即时聊天，不写小说段落。")
        parts.append("- 只有在角色本身支持且确实适合时，才使用 voice。")

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
