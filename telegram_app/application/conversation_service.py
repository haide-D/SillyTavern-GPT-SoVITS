import json
from typing import List, Optional

from database import DatabaseManager
from telegram_app.application.session_service import TelegramSessionService
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
        round_counter: Optional[RoundCounter] = None,
        settings_provider=get_telegram_settings,
    ):
        self._history = history_repo
        self._users = user_repo
        self._memory = memory_bridge
        self._llm_client = llm_client
        self._parser = response_parser
        self._sessions = session_service
        self._round_counter = round_counter or RoundCounter()
        self._settings_provider = settings_provider
        self._db = DatabaseManager()

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

        for bot in active_bots:
            self._memory.ensure_character_initialized(bot.character_name)
            self._db.upsert_telegram_bot(
                bot_id=bot.bot_id,
                character_id=bot.character_id,
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
        )

        primary_bot = active_bots[0]
        memory_context = self._memory.get_memory_context(
            primary_bot.character_name,
            session.namespace_key,
            max_snapshots=mode_config.max_snapshots,
        )
        history_messages = self._history.get_messages(
            session.namespace_key,
            limit=mode_config.max_history,
        )
        recent_messages = history_messages[-mode_config.recent_messages :]
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

        allow_voice = any(bot.voice_enabled for bot in active_bots)
        system_prompt = PromptBuilder.build_system_prompt(
            base_prompt=llm.system_prompt,
            session=session,
            bots=active_bots[: mode_config.max_active_characters],
            memory_context=memory_context,
            story_state=story_state,
            active_personas=active_personas,
            recent_messages=recent_messages,
            mode_config=mode_config,
            allow_voice=allow_voice,
        )

        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(self._format_history_for_llm(recent_messages))

        payload = {
            "model": llm.model,
            "messages": messages,
            "temperature": llm.temperature,
            "max_tokens": llm.max_tokens,
            "stream": False,
            "tools": get_chat_tools(
                [
                    bot.character_name
                    for bot in active_bots[: mode_config.max_active_characters]
                ],
                allow_voice=allow_voice,
            ),
            "tool_choice": "auto",
        }

        print("\n" + "=" * 60)
        print("【Telegram Director 请求调试信息】")
        print(f"URL: {llm.api_url} | Model: {llm.model} | ns={session.namespace_key}")
        print(system_prompt)
        print("=" * 60 + "\n")

        data = await self._llm_client.chat_completions(
            llm.api_url, llm.api_key, payload
        )

        print("\n" + "=" * 60)
        print("【LLM 原始全量返回参数 (Raw Response)】")
        try:
            print(json.dumps(data, indent=2, ensure_ascii=False))
        except Exception:
            print(str(data))
        print("=" * 60 + "\n")

        parsed_messages = self._parser.parse(data, active_bots)
        if parsed_messages:
            for message in parsed_messages:
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
            if should_trigger_memory(current_round, mode_config.memory_interval):
                await self._memory.process_conversation_snapshot(
                    namespace_key=session.namespace_key,
                    mode=session.mode,
                    story_id=session.story_id or "",
                    primary_character=primary_bot.character_name,
                    messages=self._history.get_messages(
                        session.namespace_key, limit=mode_config.max_history
                    ),
                    round_count=current_round,
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
        selected = []
        for bot in bots:
            if bot.allowed_chat_ids and str(chat_id) not in bot.allowed_chat_ids:
                continue
            selected.append(bot)
        return selected

    @staticmethod
    def _format_history_for_llm(history_messages: List[dict]) -> List[dict]:
        messages = []
        for item in history_messages:
            if item.get("speaker_type") == "human":
                speaker = (
                    item.get("sender_display_name")
                    or item.get("sender_user_id")
                    or "用户"
                )
                content = f"[{speaker}] {item.get('content', '')}"
                messages.append({"role": "user", "content": content})
            else:
                speaker = (
                    item.get("character_name")
                    or item.get("sender_display_name")
                    or "角色"
                )
                delivery = item.get("delivery", "text")
                content = f"[{speaker}][{delivery}] {item.get('content', '')}"
                messages.append({"role": "assistant", "content": content})
        return messages
