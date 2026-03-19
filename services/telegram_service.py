import asyncio
import os
import random
from dataclasses import dataclass
from typing import Dict, Optional, Set, Tuple

from telegram import Update
from telegram.constants import UpdateType
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    MessageReactionHandler,
    filters,
)

from telegram_app.application.command_service import TelegramCommandService
from telegram_app.application.conversation_service import TelegramConversationService
from telegram_app.application.session_service import TelegramSessionService
from telegram_app.assets.repository import TelegramAssetRepository
from telegram_app.domain.history import SessionHistoryRepository
from telegram_app.domain.models import InboundMessage, ReactionEvent
from telegram_app.domain.policies import is_group_chat, should_reply_in_group
from telegram_app.integrations.llm_client import TelegramLlmClient
from telegram_app.integrations.memory_bridge import TelegramMemoryBridge
from telegram_app.integrations.response_parser import LlmResponseParser
from telegram_app.integrations.tts_service import TelegramTtsService
from telegram_app.integrations.user_repository import TelegramUserRepository
from telegram_app.integrations.voice_sender import VoiceSender
from telegram_app.settings import TelegramBotConfig, get_telegram_settings


@dataclass
class BotRuntime:
    config: TelegramBotConfig
    app: Application
    username: str = ""


class TelegramBotService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(TelegramBotService, cls).__new__(cls)
            cls._instance.initialized = False
        return cls._instance

    def __init__(self):
        if self.initialized:
            return

        self.is_running = False
        self._runtimes: Dict[str, BotRuntime] = {}
        self._processed_messages: Set[Tuple[str, int]] = set()

        self.history = SessionHistoryRepository()
        self.user_repo = TelegramUserRepository()
        self.memory_bridge = TelegramMemoryBridge()
        self.llm_client = TelegramLlmClient()
        self.response_parser = LlmResponseParser()
        self.session_service = TelegramSessionService()
        self.asset_repo = TelegramAssetRepository()
        self.conversation_service = TelegramConversationService(
            history_repo=self.history,
            user_repo=self.user_repo,
            memory_bridge=self.memory_bridge,
            llm_client=self.llm_client,
            response_parser=self.response_parser,
            session_service=self.session_service,
            asset_repo=self.asset_repo,
        )
        self.command_service = TelegramCommandService(
            history_repo=self.history,
            user_repo=self.user_repo,
            session_service=self.session_service,
            asset_repo=self.asset_repo,
        )
        self.tts_service = TelegramTtsService()
        self.initialized = True

    def _get_settings(self):
        return get_telegram_settings()

    def _is_message_processed(self, chat_id: str, message_id: Optional[int]) -> bool:
        if message_id is None:
            return False
        key = (chat_id, message_id)
        if key in self._processed_messages:
            return True
        self._processed_messages.add(key)
        if len(self._processed_messages) > 5000:
            self._processed_messages = set(list(self._processed_messages)[-2500:])
        return False

    def _managed_usernames(self) -> Set[str]:
        return {
            runtime.username for runtime in self._runtimes.values() if runtime.username
        }

    async def start(self) -> bool:
        if self.is_running:
            return True

        settings = self._get_settings()
        if not settings.enabled:
            print("[TelegramBot] 未启用, 跳过启动")
            return False

        bots = settings.get_enabled_bots()
        if not bots:
            print("[TelegramBot] 未配置任何启用中的 bots")
            return False

        try:
            runtimes: Dict[str, BotRuntime] = {}
            for bot_cfg in bots:
                builder = Application.builder().token(bot_cfg.bot_token)
                if settings.proxy_enabled and settings.proxy_http:
                    from telegram.request import HTTPXRequest

                    request_obj = HTTPXRequest(proxy=settings.proxy_http)
                    get_updates_request_obj = HTTPXRequest(proxy=settings.proxy_http)
                    builder = builder.request(request_obj).get_updates_request(
                        get_updates_request_obj
                    )

                app = builder.build()
                runtime = BotRuntime(config=bot_cfg, app=app)
                self._register_handlers(runtime)
                await app.initialize()
                await app.start()
                me = await app.bot.get_me()
                runtime.username = me.username or ""
                runtimes[bot_cfg.bot_id] = runtime

            for runtime in runtimes.values():
                print(
                    f"[TelegramBot] 开始长轮询: {runtime.config.bot_id} @{runtime.username}"
                )
                await runtime.app.updater.start_polling(
                    drop_pending_updates=True,
                    allowed_updates=[UpdateType.MESSAGE, UpdateType.MESSAGE_REACTION],
                )

            self._runtimes = runtimes
            self.is_running = True
            print(f"[TelegramBot] Startup complete. bots={list(self._runtimes.keys())}")
            return True
        except Exception as e:
            print(f"[TelegramBot] Startup failed: {e}")
            import traceback

            traceback.print_exc()
            await self.stop()
            return False

    async def stop(self):
        if not self._runtimes:
            self.is_running = False
            return
        for runtime in self._runtimes.values():
            try:
                await runtime.app.updater.stop()
                await runtime.app.stop()
                await runtime.app.shutdown()
            except Exception as e:
                print(f"[TelegramBot] 停止 {runtime.config.bot_id} 时出错: {e}")
        self._runtimes = {}
        self.is_running = False
        print("[TelegramBot] Stopped.")

    def _register_handlers(self, runtime: BotRuntime):
        app = runtime.app
        app.add_handler(CommandHandler("start", self._cmd_start))
        app.add_handler(CommandHandler("clear", self._cmd_clear))
        app.add_handler(CommandHandler("mode", self._cmd_mode))
        app.add_handler(CommandHandler("pack", self._cmd_pack))
        app.add_handler(CommandHandler("story", self._cmd_story))
        app.add_handler(CommandHandler("setpersona", self._cmd_setpersona))
        app.add_handler(CommandHandler("whoami", self._cmd_whoami))
        app.add_handler(MessageReactionHandler(self._handle_reaction))
        app.add_handler(
            MessageHandler(filters.TEXT & ~filters.COMMAND, self._handle_text)
        )
        app.add_handler(MessageHandler(filters.VOICE, self._handle_voice))

    def _is_allowed_for_any_bot(self, chat_id: str) -> bool:
        settings = self._get_settings()
        for bot in settings.get_enabled_bots():
            if not bot.allowed_chat_ids or str(chat_id) in bot.allowed_chat_ids:
                return True
        return False

    async def _cmd_start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if self._is_message_processed(chat_id, update.effective_message.message_id):
            return
        if not self._is_allowed_for_any_bot(chat_id):
            await update.effective_message.reply_text(
                "抱歉，您没有使用此 Bot 集群的权限。"
            )
            return
        reply_text = self.command_service.handle_start(chat_id, self._get_settings())
        await update.effective_message.reply_text(reply_text)

    async def _cmd_clear(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if self._is_message_processed(chat_id, update.effective_message.message_id):
            return
        if not self._is_allowed_for_any_bot(chat_id):
            return
        reply_text = self.command_service.handle_clear(chat_id, self._get_settings())
        await update.effective_message.reply_text(reply_text)

    async def _cmd_mode(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if self._is_message_processed(chat_id, update.effective_message.message_id):
            return
        if not self._is_allowed_for_any_bot(chat_id):
            return
        mode = context.args[0].strip() if context.args else None
        reply_text = self.command_service.handle_mode(
            chat_id, self._get_settings(), mode
        )
        await update.effective_message.reply_text(reply_text)

    async def _cmd_story(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if self._is_message_processed(chat_id, update.effective_message.message_id):
            return
        if not self._is_allowed_for_any_bot(chat_id):
            return
        story_id = context.args[0].strip() if context.args else None
        reply_text = self.command_service.handle_story(
            chat_id, self._get_settings(), story_id
        )
        await update.effective_message.reply_text(reply_text)

    async def _cmd_pack(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if self._is_message_processed(chat_id, update.effective_message.message_id):
            return
        if not self._is_allowed_for_any_bot(chat_id):
            return
        pack_id = context.args[0].strip() if context.args else None
        reply_text = self.command_service.handle_pack(
            chat_id, self._get_settings(), pack_id
        )
        await update.effective_message.reply_text(reply_text)

    async def _cmd_setpersona(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if self._is_message_processed(chat_id, update.effective_message.message_id):
            return
        if not self._is_allowed_for_any_bot(chat_id):
            return
        user = update.effective_user
        if not user:
            return
        if not context.args:
            await update.effective_message.reply_text(
                "请提供人设描述，例如: /setpersona 我是一个沉默寡言的侦探。"
            )
            return
        reply_text = self.command_service.handle_setpersona(
            user, chat_id, " ".join(context.args)
        )
        await update.effective_message.reply_text(reply_text)

    async def _cmd_whoami(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if self._is_message_processed(chat_id, update.effective_message.message_id):
            return
        if not self._is_allowed_for_any_bot(chat_id):
            return
        user = update.effective_user
        if not user:
            return
        reply_text = self.command_service.handle_whoami(user)
        await update.effective_message.reply_text(reply_text)

    async def _handle_text(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not update.effective_message or not update.effective_chat:
            return
        if update.effective_user and update.effective_user.is_bot:
            return

        chat_id = str(update.effective_chat.id)
        message_id = update.effective_message.message_id
        if self._is_message_processed(chat_id, message_id):
            return
        if not self._is_allowed_for_any_bot(chat_id):
            return

        user = update.effective_user
        user_text = update.effective_message.text or ""
        chat_type = update.effective_chat.type
        display_name = self.user_repo.get_user_display_name(user)
        user_id = str(user.id) if user else "Unknown"
        self.user_repo.update_user_activity(user, chat_id)

        managed_usernames = self._managed_usernames()
        replied_user = (
            update.effective_message.reply_to_message.from_user
            if update.effective_message.reply_to_message
            else None
        )
        replied_username = replied_user.username if replied_user else ""
        is_reply = bool(replied_username and replied_username in managed_usernames)
        is_mention = any(
            f"@{username}" in user_text for username in managed_usernames if username
        )

        if is_group_chat(chat_type) and not should_reply_in_group(is_reply, is_mention):
            return

        for username in managed_usernames:
            user_text = user_text.replace(f"@{username}", "").strip()

        await context.bot.send_chat_action(
            chat_id=update.effective_chat.id, action="typing"
        )

        try:
            source_runtime = self._runtime_for_username(context.bot.username)
            inbound = InboundMessage(
                chat_id=chat_id,
                chat_type=chat_type,
                text=user_text,
                user_id=user_id,
                user_display_name=display_name,
                source_bot_id=source_runtime.config.bot_id
                if source_runtime
                else "unknown",
                source_bot_username=context.bot.username or "",
                message_id=message_id,
                is_group=is_group_chat(chat_type),
                is_reply_to_bot=is_reply,
                is_mention=is_mention,
            )
            llm_response = await self.conversation_service.handle_text(inbound)
            if not llm_response:
                await update.effective_message.reply_text(
                    "[系统] 导演模型未返回有效响应，请检查配置。"
                )
                return
            await self._dispatch_messages(chat_id, message_id, llm_response)
        except Exception as e:
            print(f"[TelegramBot] 处理文字消息失败: {e}")
            await update.effective_message.reply_text(f"[系统错误] 处理消息失败: {e}")

    async def _handle_voice(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not update.effective_message or not update.effective_chat:
            return
        chat_id = str(update.effective_chat.id)
        if self._is_message_processed(chat_id, update.effective_message.message_id):
            return
        await update.effective_message.reply_text(
            "[系统提示] 多 Bot 模式下的语音输入还未接通，请先发送文字。"
        )

    async def _handle_reaction(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ):
        reaction = update.message_reaction
        if not reaction:
            return
        chat_id = str(reaction.chat.id)
        if not self._is_allowed_for_any_bot(chat_id):
            return
        user = reaction.user
        if not user or user.is_bot:
            return
        new_emojis = [
            r.emoji for r in reaction.new_reaction if getattr(r, "emoji", None)
        ]
        old_emojis = [
            r.emoji for r in reaction.old_reaction if getattr(r, "emoji", None)
        ]
        added_emojis = [e for e in new_emojis if e not in old_emojis]
        if not added_emojis:
            return
        source_runtime = self._runtime_for_username(context.bot.username)
        event = ReactionEvent(
            chat_id=chat_id,
            chat_type=reaction.chat.type,
            user_id=str(user.id),
            user_display_name=self.user_repo.get_user_display_name(user),
            source_bot_id=source_runtime.config.bot_id if source_runtime else "unknown",
            source_bot_username=context.bot.username or "",
            message_id=reaction.message_id,
            added_emojis=added_emojis,
        )
        llm_response = await self.conversation_service.handle_reaction(event)
        if llm_response:
            await self._dispatch_messages(chat_id, reaction.message_id, llm_response)

    def _runtime_for_username(self, username: Optional[str]) -> Optional[BotRuntime]:
        if not username:
            return None
        for runtime in self._runtimes.values():
            if runtime.username == username:
                return runtime
        return None

    def _runtime_for_character(self, character_id: str) -> Optional[BotRuntime]:
        for runtime in self._runtimes.values():
            if runtime.config.character_ref == character_id:
                return runtime
        return None

    async def _dispatch_messages(
        self, chat_id: str, reply_to_message_id: int, messages
    ):
        for i, msg in enumerate(messages):
            runtime = self._runtime_for_character(msg.character_id)
            if not runtime:
                print(f"[TelegramBot] 未找到角色对应 runtime: {msg.character_id}")
                continue

            reply_target = (
                reply_to_message_id if (i == 0 or msg.reply_to_trigger) else None
            )
            success = False
            if msg.use_tts and runtime.config.voice_enabled:
                ogg_path = await self.tts_service.generate_ogg_file(
                    chat_id,
                    msg.text,
                    emotion=msg.emotion,
                    char_name=runtime.config.tts_character
                    or runtime.config.character_name,
                )
                if ogg_path:
                    try:
                        success = await VoiceSender(runtime.app).send_voice_file(
                            chat_id,
                            ogg_path,
                            reply_to_message_id=reply_target,
                        )
                    finally:
                        if os.path.exists(ogg_path):
                            os.remove(ogg_path)

            if not success:
                await runtime.app.bot.send_message(
                    chat_id=chat_id,
                    text=msg.text,
                    reply_to_message_id=reply_target,
                )

            if i < len(messages) - 1:
                await runtime.app.bot.send_chat_action(chat_id=chat_id, action="typing")
                await asyncio.sleep(random.uniform(1.0, 2.5))


telegram_service = TelegramBotService()
