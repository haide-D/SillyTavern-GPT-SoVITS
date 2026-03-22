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
        clue_text: str = "",
    ) -> str:
        parts: List[str] = []

        parts.append("============== 【导演职责】 ==============")
        parts.append(base_prompt.strip())
        parts.append(
            "你正在导演多个 Telegram Bot 扮演不同角色。根据场景，选择合适的1-3个角色发言。不要让无关的人物一直发言"
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
            lang_label = {"zh": "中文", "ja": "日语", "en": "英语"}.get(getattr(bot, "voice_lang", "zh"), "中文")
            voice_tag = f"{voice_mode}/{lang_label}" if bot.voice_enabled else voice_mode
            parts.append(f"- {bot.character_name} ({bot.character_ref}, {voice_tag})")
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

        if clue_text:
            parts.append("============== 【已发现的线索】 ==============")
            parts.append(clue_text)

        if memory_context:
            parts.append("============== 【记忆摘要】 ==============")
            parts.append(memory_context.strip())

        parts.append("============== 【输出规则】 ==============")
        parts.append(f"- 本轮最多让 {mode_config.max_speakers_per_turn} 个角色发言。考虑角色间的关系以及性格，不适合开口的人物坚决不能硬插话")
        parts.append("- 优先回应刚刚触发你的用户，不要让所有角色轮流刷屏。主持人除了被直接对话外，不得主动发言")
        parts.append("- ⚠️【点名回应】如果近期对话中有人使用 `[对某某说]` 明确点名了某个角色，**必须优先让被点名的角色出面回应**。其他角色除非有极强的剧情需要，否则保持沉默。")
        parts.append("- 每条回复都必须通过工具 `emit_bot_message` 发出。")
        parts.append("- ⚠️【身份卡/秘密信息 禁止群发】发放身份卡、独家线索等秘密内容时，必须用 `emit_private_message` 私聊发送给对应玩家。严禁在群聊中泄露任何玩家的身份卡内容！")
        parts.append("- ⚠️【Bot 角色身份卡】可用角色列表中的 Bot（如萧炎等）也是游戏参与者，也必须有身份卡。发放身份卡时，用 `save_clue(visibility=private, related_character=角色名)` 为每个Bot角色保存其秘密身份，这样你后续扮演该角色时能记住身份设定。")
        parts.append("- 当剧情出现重要发现、线索、转折时，使用 `save_clue` 工具记录下来，确保后续对话能持续引用。")
        parts.append("- 严禁输出对人物动作神态描写的括号或星号，必须完全是说出来的话。")
        parts.append("- ⚠️【畅所欲言与争吵】如果此刻适合激烈争吵或深入推理，请角色们务必畅所欲言！**系统在底层会自动将你们的长篇大论切割成连续的一条条短消息进行发送（模拟真实群聊刷屏效果）**。所以你不需要刻意压抑字数，觉得该说多少就说多少！")
        parts.append("- ⚠️【高频互动】在一轮回复中，你可以调用多次 `emit_bot_message` 让不同角色交替发言，形成激烈的互相抢话、打断、接梗的多人对话场景！让对话看起来就像一群活生生的人在实时吵架！")
        parts.append("- ⚠️【除了旁白】只有“旁白”角色可以做环境、动作、气氛的客观描写。其他普通角色的发言框里，绝对不允许出现任何动作描写。")
        parts.append('- ⚠️【强制语音】标注为"可语音"的角色，delivery 必须、必定、绝对只能填 `voice`！只有旁白或没有语音标签的角色才能填 `text`。')
        parts.append('- 🌐【多语种语音】如果角色标记的语音语言不是中文（如"可语音/日语"），则 `voice_text` 必须填写该语言的原文台词（如日语），而 `text` 填写对应的中文翻译。对话记录只保留 text（中文）；voice_text 仅用于语音合成。语音语言为中文的角色无需填 voice_text。')

        if recent_messages:
            parts.append("============== 【近期对话提示】 ==============")
            print(f"[DEBUG] prompt_builder 收到 recent_messages={len(recent_messages)} 条")
            merged: list = []
            for msg in recent_messages:
                speaker = (
                    msg.get("sender_display_name")
                    or msg.get("character_name")
                    or msg.get("role")
                )
                content = msg.get("content", "")
                if merged and merged[-1][0] == speaker:
                    merged[-1] = (speaker, merged[-1][1] + "\n" + content)
                else:
                    merged.append((speaker, content))
            for speaker, content in merged:
                parts.append(f"- {speaker}: {content}")

        return "\n".join(parts)
