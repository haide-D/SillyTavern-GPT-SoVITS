import asyncio
import json
from typing import List, Optional, Tuple

from database import DatabaseManager
from telegram_app.application.session_service import TelegramSessionService
from telegram_app.assets.models import AssetPack, ResolvedTelegramCharacter, StoryAsset
from telegram_app.assets.repository import TelegramAssetRepository
from telegram_app.domain.history import SessionHistoryRepository
from telegram_app.domain.models import InboundMessage, OutboundMessage, ReactionEvent
from telegram_app.domain.policies import RoundCounter, should_trigger_memory
from telegram_app.integrations.llm_client import TelegramLlmClient
from telegram_app.integrations.memory_bridge import TelegramMemoryBridge
from telegram_app.integrations.prompt_builder import PromptBuilder
from telegram_app.integrations.response_parser import LlmResponseParser
from telegram_app.integrations.tool_schemas import get_chat_tools
from telegram_app.integrations.user_repository import TelegramUserRepository
from telegram_app.settings import TelegramBotConfig, get_telegram_settings


class TelegramConversationService:
    def __init__(
        self,
        history_repo: SessionHistoryRepository,
        user_repo: TelegramUserRepository,
        memory_bridge: TelegramMemoryBridge,
        llm_client: TelegramLlmClient,
        response_parser: LlmResponseParser,
        session_service: TelegramSessionService,
        asset_repo: Optional[TelegramAssetRepository] = None,
        round_counter: Optional[RoundCounter] = None,
        settings_provider=get_telegram_settings,
    ):
        self._history = history_repo
        self._users = user_repo
        self._memory = memory_bridge
        self._llm_client = llm_client
        self._parser = response_parser
        self._sessions = session_service
        self._asset_repo = asset_repo or TelegramAssetRepository()
        self._round_counter = round_counter or RoundCounter()
        self._settings_provider = settings_provider
        self._db = DatabaseManager()

    async def save_passive_message(self, inbound: InboundMessage) -> None:
        """静默保存用户消息到历史记录，不触发 LLM 回复"""
        settings = self._settings_provider()
        session = self._sessions.ensure_active_session(
            inbound.chat_id,
            settings,
            mode=inbound.mode,
            story_id=inbound.story_id,
        )
        self._history.add_message(
            namespace_key=session.namespace_key,
            chat_id=inbound.chat_id,
            role="user",
            content=inbound.text,
            speaker_type="human",
            source_bot_id=inbound.source_bot_id,
            source_bot_username=inbound.source_bot_username,
            sender_user_id=inbound.user_id,
            sender_display_name=inbound.user_display_name,
            telegram_message_id=inbound.message_id,
            reply_to_message_id=inbound.reply_to_message_id,
        )

    async def handle_text(self, inbound: InboundMessage) -> List[OutboundMessage]:
        settings = self._settings_provider()
        llm = settings.shared_llm
        if not llm.api_url or not llm.api_key:
            raise ValueError("Telegram 的共享 LLM 未配置 (api_url, api_key 缺失)")

        session = self._sessions.ensure_active_session(
            inbound.chat_id,
            settings,
            mode=inbound.mode,
            story_id=inbound.story_id,
        )
        inbound.namespace_key = session.namespace_key
        inbound.mode = session.mode
        inbound.story_id = session.story_id
        mode_config = settings.get_mode(session.mode)

        active_bots = self._select_active_bots(
            settings.get_enabled_bots(), inbound.chat_id
        )
        if not active_bots:
            raise ValueError("Telegram 未找到可用 bot 配置")

        asset_pack = self._asset_repo.get_pack(
            session.asset_pack_id or settings.default_asset_pack_id
        )
        resolved_bots = self._resolve_bots(active_bots, asset_pack)
        if not resolved_bots:
            raise ValueError("没有可用的角色绑定；请检查 character_ref 与 asset pack")
        story_asset = asset_pack.get_story(session.story_id) if asset_pack else None

        for bot in resolved_bots:
            self._memory.ensure_character_initialized(bot.character_name)
            self._db.upsert_telegram_bot(
                bot_id=bot.bot_id,
                character_id=bot.character_ref,
                character_name=bot.character_name,
                bot_token=bot.bot_token,
                tts_character=bot.tts_character,
                voice_enabled=bot.voice_enabled,
                allowed_chat_ids=bot.allowed_chat_ids,
                enabled=bot.enabled,
            )

        self._history.add_message(
            namespace_key=session.namespace_key,
            chat_id=inbound.chat_id,
            role="user",
            content=inbound.text,
            speaker_type="human",
            source_bot_id=inbound.source_bot_id,
            source_bot_username=inbound.source_bot_username,
            sender_user_id=inbound.user_id,
            sender_display_name=inbound.user_display_name,
            telegram_message_id=inbound.message_id,
            reply_to_message_id=inbound.reply_to_message_id,
        )

        primary_bot = resolved_bots[0]
        memory_context = self._memory.get_memory_context(
            primary_bot.character_name,
            session.namespace_key,
            max_snapshots=mode_config.max_snapshots,
        )
        history_messages = self._history.get_messages(
            session.namespace_key, limit=mode_config.max_history
        )
        recent_messages = history_messages[-mode_config.recent_messages :]
        print(f"[DEBUG] max_history={mode_config.max_history}, DB返回={len(history_messages)}, recent_messages切片={len(recent_messages)} (配置值={mode_config.recent_messages})")
        story_state = self._db.get_telegram_story_state(session.namespace_key)
        if not story_state and story_asset and story_asset.initial_state:
            self._db.upsert_telegram_story_state(
                namespace_key=session.namespace_key,
                mode=session.mode,
                story_id=session.story_id,
                chapter_id=str(story_asset.initial_state.get("chapter") or "") or None,
                summary=story_asset.opening or None,
                state_json=story_asset.initial_state,
            )
            story_state = self._db.get_telegram_story_state(session.namespace_key)

        active_uids = list(
            {
                m.get("sender_user_id")
                for m in recent_messages
                if m.get("sender_user_id")
            }
        )
        active_personas = self._users.get_active_personas_in_chat(
            inbound.chat_id, active_uids
        )

        allow_voice = any(bot.voice_enabled for bot in resolved_bots)

        # 读取已有线索
        from telegram_app.integrations.clue_store import read_all_clues
        clue_text = read_all_clues(session.namespace_key)

        # 提取活跃用户昵称列表（供 emit_private_message 工具引用）
        active_user_names = list(active_personas.keys()) if active_personas else []

        system_prompt = PromptBuilder.build_system_prompt(
            base_prompt=llm.system_prompt,
            session=session,
            bots=resolved_bots[: mode_config.max_active_characters],
            asset_pack=asset_pack,
            story_asset=story_asset,
            memory_context=memory_context,
            story_state=story_state,
            active_personas=active_personas,
            recent_messages=recent_messages,
            mode_config=mode_config,
            allow_voice=allow_voice,
            clue_text=clue_text,
        )

        payload = {
            "model": llm.model,
            "messages": [{"role": "system", "content": system_prompt}]
            + self._format_history_for_llm(recent_messages),
            "temperature": llm.temperature,
            "max_tokens": llm.max_tokens,
            "stream": False,
            "tools": get_chat_tools(
                [
                    bot.character_name
                    for bot in resolved_bots[: mode_config.max_active_characters]
                ],
                allow_voice=allow_voice,
                active_user_names=active_user_names,
                bots=resolved_bots[: mode_config.max_active_characters],
            ),
            "tool_choice": "auto",
        }

        print("\n" + "=" * 60)
        print("【Telegram Director 请求调试信息】")
        print(
            f"URL: {llm.api_url} | Model: {llm.model} | ns={session.namespace_key} | pack={session.asset_pack_id or '-'}"
        )
        print(system_prompt)
        print("=" * 60 + "\n")

        proxy = settings.proxy_http if settings.proxy_enabled else None
        data = await self._llm_client.chat_completions(
            llm.api_url, llm.api_key, payload, proxy=proxy
        )

        print("\n" + "=" * 60)
        print("【LLM 原始全量返回参数 (Raw Response)】")
        try:
            print(json.dumps(data, indent=2, ensure_ascii=False))
        except Exception:
            print(str(data))
        print("=" * 60 + "\n")

        parsed_messages, parsed_clues = self._parser.parse(data, resolved_bots)

        # 保存线索
        from telegram_app.integrations.clue_store import append_clue

        if parsed_clues:
            for clue in parsed_clues:
                append_clue(
                    namespace_key=session.namespace_key,
                    clue_text=clue.clue_text,
                    visibility=clue.visibility,
                    related_character=clue.related_character,
                )

        # 🔑 私聊消息（身份卡等）自动存为线索，防止 LLM 遗忘
        for message in parsed_messages:
            if message.is_private:
                append_clue(
                    namespace_key=session.namespace_key,
                    clue_text=f"[已私聊发给{message.target_user_display_name}] {message.text}",
                    visibility="private",
                    related_character=message.target_user_display_name,
                )

        if parsed_messages:
            for message in parsed_messages:
                # 私聊消息不存入群聊历史（已存入线索文件），防止身份卡泄露到对话提示中
                if message.is_private:
                    continue
                self._history.add_message(
                    namespace_key=session.namespace_key,
                    chat_id=inbound.chat_id,
                    role="assistant",
                    content=message.text,
                    speaker_type="bot",
                    character_id=message.character_id,
                    character_name=message.character_name,
                    delivery=message.delivery,
                    emotion=message.emotion,
                )

            current_round = self._round_counter.increment(session.namespace_key)
            print(f"[DEBUG] 轮次计数: round={current_round}, memory_interval={mode_config.memory_interval}, 触发={current_round % mode_config.memory_interval == 0}")
            if should_trigger_memory(current_round, mode_config.memory_interval):
                asyncio.create_task(
                    self._memory.process_conversation_snapshot(
                        namespace_key=session.namespace_key,
                        mode=session.mode,
                        story_id=session.story_id or "",
                        primary_character=primary_bot.character_name,
                        messages=self._history.get_messages(
                            session.namespace_key, limit=mode_config.max_history
                        ),
                        round_count=current_round,
                        memory_interval=mode_config.memory_interval,
                    )
                )

        return parsed_messages

    async def handle_reaction(self, reaction: ReactionEvent) -> List[OutboundMessage]:
        if not reaction.added_emojis:
            return []

        action_text = f"用户给上一条消息添加了表情：{'、'.join(reaction.added_emojis)}"
        inbound = InboundMessage(
            chat_id=reaction.chat_id,
            chat_type=reaction.chat_type,
            text=action_text,
            user_id=reaction.user_id,
            user_display_name=reaction.user_display_name,
            source_bot_id=reaction.source_bot_id,
            source_bot_username=reaction.source_bot_username,
            message_id=reaction.message_id,
            is_group=reaction.chat_type in ["group", "supergroup"],
        )
        return await self.handle_text(inbound)

    @staticmethod
    def _select_active_bots(
        bots: List[TelegramBotConfig], chat_id: str
    ) -> List[TelegramBotConfig]:
        selected: List[TelegramBotConfig] = []
        for bot in bots:
            if bot.allowed_chat_ids and str(chat_id) not in bot.allowed_chat_ids:
                continue
            selected.append(bot)
        return selected

    @staticmethod
    def _resolve_bots(
        bots: List[TelegramBotConfig], asset_pack: Optional[AssetPack]
    ) -> List[ResolvedTelegramCharacter]:
        resolved: List[ResolvedTelegramCharacter] = []
        for bot in bots:
            asset = asset_pack.get_character(bot.character_ref) if asset_pack else None
            character_name = bot.character_name or (
                asset.name if asset else bot.character_ref
            )
            resolved.append(
                ResolvedTelegramCharacter(
                    bot_id=bot.bot_id,
                    bot_token=bot.bot_token,
                    character_ref=bot.character_ref,
                    character_id=bot.character_ref,
                    character_name=character_name,
                    tts_character=bot.tts_character or character_name,
                    voice_enabled=bot.voice_enabled,
                    voice_lang=bot.voice_lang,
                    allowed_chat_ids=bot.allowed_chat_ids,
                    enabled=bot.enabled,
                    description=asset.description if asset else "",
                    personality=asset.personality if asset else "",
                    system_prompt_fragment=asset.system_prompt_fragment
                    if asset
                    else "",
                    first_message=asset.first_message if asset else "",
                    dialogue_examples=asset.dialogue_examples if asset else [],
                )
            )
        return resolved

    @staticmethod
    def _format_history_for_llm(history_messages: List[dict]) -> List[dict]:
        msg_map = {m.get("telegram_message_id"): m for m in history_messages if m.get("telegram_message_id")}

        # 第一步：构建带说话人标记的原始列表
        raw_items: List[dict] = []
        for item in history_messages:
            content = item.get("content", "")
            reply_to_id = item.get("reply_to_message_id")

            if reply_to_id and reply_to_id in msg_map:
                replied_msg = msg_map[reply_to_id]
                replied_speaker = (
                    replied_msg.get("sender_display_name")
                    or replied_msg.get("character_name")
                    or "某人"
                )
                replied_content = replied_msg.get("content", "")
                if len(replied_content) > 30:
                    replied_content = replied_content[:30] + "..."
                content = f"[回复 {replied_speaker}: \"{replied_content}\"]\n{content}"

            if item.get("speaker_type") == "human":
                speaker = (
                    item.get("sender_display_name")
                    or item.get("sender_user_id")
                    or "用户"
                )
                raw_items.append({"role": "user", "speaker": speaker, "content": content})
            else:
                speaker = (
                    item.get("character_name")
                    or item.get("sender_display_name")
                    or "角色"
                )
                delivery = item.get("delivery", "text")
                raw_items.append({"role": "assistant", "speaker": speaker, "content": content, "delivery": delivery})

        # 第二步：合并同一说话人连续的消息
        messages: List[dict] = []
        for entry in raw_items:
            if (
                messages
                and messages[-1]["role"] == entry["role"]
                and messages[-1].get("_speaker") == entry["speaker"]
            ):
                messages[-1]["content"] += "\n" + entry["content"]
            else:
                if entry["role"] == "user":
                    messages.append({
                        "role": "user",
                        "content": f"[{entry['speaker']}] {entry['content']}",
                        "_speaker": entry["speaker"],
                    })
                else:
                    messages.append({
                        "role": "assistant",
                        "content": f"[{entry['speaker']}][{entry.get('delivery', 'text')}] {entry['content']}",
                        "_speaker": entry["speaker"],
                    })

        # 清理内部标记
        for m in messages:
            m.pop("_speaker", None)
        return messages

