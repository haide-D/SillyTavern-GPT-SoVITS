import asyncio
from typing import Optional

from telegram import Update
from telegram.constants import UpdateType
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    MessageReactionHandler,
    filters,
    ContextTypes,
)

from telegram_app.application.command_service import TelegramCommandService
from telegram_app.application.conversation_service import TelegramConversationService
from telegram_app.domain.history import SessionHistoryRepository
from telegram_app.domain.models import InboundMessage, ReactionEvent
from telegram_app.domain.policies import is_group_chat, should_reply_in_group
from telegram_app.integrations.llm_client import TelegramLlmClient
from telegram_app.integrations.memory_bridge import TelegramMemoryBridge
from telegram_app.integrations.response_parser import LlmResponseParser
from telegram_app.integrations.tts_service import TelegramTtsService
from telegram_app.integrations.user_repository import TelegramUserRepository
from telegram_app.integrations.voice_sender import VoiceSender
from telegram_app.settings import get_telegram_settings


class TelegramBotService:
    """Telegram Bot 服务 - 负责长轮询生命周期和事件路由机制"""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(TelegramBotService, cls).__new__(cls)
            cls._instance.initialized = False
        return cls._instance

    def __init__(self):
        if self.initialized:
            return

        self.app: Optional[Application] = None
        self.is_running = False

        self.history = SessionHistoryRepository()
        self.user_repo = TelegramUserRepository()
        self.memory_bridge = TelegramMemoryBridge()
        self.llm_client = TelegramLlmClient()
        self.response_parser = LlmResponseParser()
        self.conversation_service = TelegramConversationService(
            history_repo=self.history,
            user_repo=self.user_repo,
            memory_bridge=self.memory_bridge,
            llm_client=self.llm_client,
            response_parser=self.response_parser,
        )
        self.command_service = TelegramCommandService(
            history_repo=self.history,
            user_repo=self.user_repo,
        )
        self.tts_service = TelegramTtsService()
        self.voice_sender = VoiceSender()

        self.initialized = True

    def _get_settings(self):
        return get_telegram_settings()

    def _check_auth(self, chat_id: str) -> bool:
        """检查用户权限"""
        settings = self._get_settings()
        if not settings.allowed_chat_ids:
            return True
        return str(chat_id) in settings.allowed_chat_ids

    async def start(self) -> bool:
        """启动长轮询"""
        if self.is_running:
            return True

        settings = self._get_settings()
        if not settings.enabled:
            print("[TelegramBot] 未启用, 跳过启动")
            return False

        token = settings.bot_token
        if not token:
            print("[TelegramBot] 未配置 Token, 跳过启动")
            return False

        try:
            proxy_config = {
                "enabled": settings.proxy_enabled,
                "http": settings.proxy_http,
            }
            builder = Application.builder().token(token)

            if proxy_config.get("enabled"):
                proxy_url = proxy_config.get("http")
                if proxy_url:
                    print(f"[TelegramBot] 使用代理: {proxy_url}")
                    from telegram.request import HTTPXRequest

                    request_obj = HTTPXRequest(proxy=proxy_url)
                    get_updates_request_obj = HTTPXRequest(proxy=proxy_url)
                    builder = builder.request(request_obj).get_updates_request(
                        get_updates_request_obj
                    )

            self.app = builder.build()
            self.voice_sender.bot_app = self.app  # 绑定应用，以便发送语音

            # 注册 handlers
            self.app.add_handler(CommandHandler("start", self._cmd_start))
            self.app.add_handler(CommandHandler("clear", self._cmd_clear))
            self.app.add_handler(CommandHandler("setpersona", self._cmd_setpersona))
            self.app.add_handler(CommandHandler("whoami", self._cmd_whoami))
            self.app.add_handler(MessageReactionHandler(self._handle_reaction))

            # 【临时增加的终极全捕获 DEBUG】
            async def _debug_all_events(
                update: Update, context: ContextTypes.DEFAULT_TYPE
            ):
                try:
                    if update.effective_chat and update.effective_chat.type in [
                        "group",
                        "supergroup",
                    ]:
                        print(f"\n[DEBUG 底层事件捕获] 📥 => {update.to_dict()}\n")
                except:
                    pass

            self.app.add_handler(
                MessageHandler(filters.ALL, _debug_all_events), group=-1
            )

            self.app.add_handler(
                MessageHandler(filters.TEXT & ~filters.COMMAND, self._handle_text)
            )
            self.app.add_handler(MessageHandler(filters.VOICE, self._handle_voice))

            # 开始轮训
            await self.app.initialize()
            await self.app.start()

            print("[TelegramBot] 开始长轮询...")
            allowed_updates = [UpdateType.MESSAGE, UpdateType.MESSAGE_REACTION]
            await self.app.updater.start_polling(
                drop_pending_updates=True, allowed_updates=allowed_updates
            )

            self.is_running = True
            print("[TelegramBot] ✅ 启动成功!")
            return True

        except Exception as e:
            print(f"[TelegramBot] ❌ 启动失败: {e}")
            import traceback

            traceback.print_exc()
            self.is_running = False
            return False

    async def stop(self):
        """停止长轮询服务"""
        if not self.is_running or not self.app:
            return

        print("[TelegramBot] 正在停止...")
        try:
            await self.app.updater.stop()
            await self.app.stop()
            await self.app.shutdown()
        except Exception as e:
            print(f"[TelegramBot] 停止时出错: {e}")

        self.is_running = False
        self.app = None
        print("[TelegramBot] 🛑 已停止.")

    async def _cmd_start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if not self._check_auth(chat_id):
            await update.effective_message.reply_text("抱歉，您没有使用此 Bot 的权限。")
            return

        reply_text = self.command_service.handle_start(chat_id)
        await update.effective_message.reply_text(reply_text)

    async def _cmd_clear(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if not self._check_auth(chat_id):
            return
        reply_text = self.command_service.handle_clear(chat_id)
        await update.effective_message.reply_text(reply_text)

    async def _cmd_setpersona(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if not self._check_auth(chat_id):
            return

        user = update.effective_user
        if not user:
            return

        # extract persona text
        args = context.args
        if not args:
            await update.effective_message.reply_text(
                "请提供人设描述，例如: /setpersona 我是一个喜欢在群里潜水的内向宅男。"
            )
            return

        persona_text = " ".join(args)
        reply_text = self.command_service.handle_setpersona(user, chat_id, persona_text)
        await update.effective_message.reply_text(reply_text)

    async def _cmd_whoami(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if not self._check_auth(chat_id):
            return

        user = update.effective_user
        if not user:
            return

        reply_text = self.command_service.handle_whoami(user)
        await update.effective_message.reply_text(reply_text)

    async def _handle_text(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        user = update.effective_user
        user_text = update.effective_message.text or ""
        chat_type = update.effective_chat.type
        bot_username = context.bot.username
        is_reply = False
        is_mention = False

        # 记录用户活跃并提取名字
        self.user_repo.update_user_activity(user, chat_id)
        display_name = self.user_repo.get_user_display_name(user)
        user_id = str(user.id) if user else "Unknown"

        print(
            f"[TelegramBot] 收到消息: [{chat_id}]({chat_type}) {display_name}: {user_text}"
        )

        if is_group_chat(chat_type):
            is_reply = (
                update.effective_message.reply_to_message
                and update.effective_message.reply_to_message.from_user
                and update.effective_message.reply_to_message.from_user.username
                == bot_username
            )
            is_mention = f"@{bot_username}" in user_text

            if not should_reply_in_group(is_reply, is_mention):
                # 记录但不回复 (旁听模式 eavesdropping)
                if self._check_auth(chat_id):
                    user_text_record = f"【群内闲聊旁听】[{display_name}]: {user_text}"
                    self.history.add_message(
                        chat_id,
                        "user",
                        user_text_record,
                        speaker_name=display_name,
                        speaker_id=user_id,
                    )
                return

            user_text = user_text.replace(f"@{bot_username}", "").strip()

        if not self._check_auth(chat_id):
            print(
                f"[TelegramBot] 🚨 拦截消息：群组/用户 {chat_id} 不在白名单中。如果您需要机器人在本群回复，请将此数字添加进 allowed_chat_ids。"
            )
            return

        await context.bot.send_chat_action(
            chat_id=update.effective_chat.id, action="typing"
        )

        try:
            inbound = InboundMessage(
                chat_id=chat_id,
                chat_type=chat_type,
                text=user_text,
                user_id=user_id,
                user_display_name=display_name,
                message_id=update.effective_message.message_id,
                is_group=is_group_chat(chat_type),
                is_reply_to_bot=is_reply if is_group_chat(chat_type) else False,
                is_mention=is_mention if is_group_chat(chat_type) else False,
            )
            llm_response = await self.conversation_service.handle_text(inbound)

            if not llm_response:
                await update.effective_message.reply_text(
                    "[系统] LLM 未返回有效响应，请检查配置。"
                )
                return

            settings = self._get_settings()
            import random

            for i, msg in enumerate(llm_response):
                text = msg.text
                if not text:
                    continue

                use_tts = msg.use_tts
                emotion = msg.emotion

                if not settings.voice_reply:
                    use_tts = False

                success = False
                if use_tts:
                    if not settings.character:
                        print("[TelegramAudio] 未配置绑定角色(character)，跳过 TTS")
                    else:
                        ogg_path = await self.tts_service.generate_ogg_file(
                            chat_id, text, emotion=emotion, char_name=settings.character
                        )
                        if ogg_path:
                            try:
                                success = await self.voice_sender.send_voice_file(
                                    chat_id,
                                    ogg_path,
                                    reply_to_message_id=update.effective_message.message_id,
                                )
                            finally:
                                import os

                                if os.path.exists(ogg_path):
                                    os.remove(ogg_path)

                if i == 0:
                    # 首条消息进行 reply 引用（如果是文字的话）
                    if success:
                        pass  # 语音内部用的直接发送
                    else:
                        if use_tts and settings.voice_reply:
                            await update.effective_message.reply_text(
                                f"(语音发送失败)\n{text}"
                            )
                        else:
                            await update.effective_message.reply_text(text)
                else:
                    # 后续消息直接 send_message 避免多条引用看起来烦杂
                    if not success:
                        await context.bot.send_message(
                            chat_id=chat_id,
                            text=text,
                            reply_to_message_id=update.effective_message.message_id
                            if i == 0
                            else None,
                        )

                # 如果不是最后一条，假装手速延时，增添拟真度
                if i < len(llm_response) - 1:
                    await context.bot.send_chat_action(chat_id=chat_id, action="typing")
                    await asyncio.sleep(random.uniform(1.5, 3.5))

        except Exception as e:
            print(f"[TelegramBot] 处理文字消息失败: {e}")
            await update.effective_message.reply_text(f"[系统错误] 处理消息失败: {e}")

    async def _handle_voice(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if not self._check_auth(chat_id):
            return
        await update.effective_message.reply_text(
            "[系统提示] 多模态语音输入还在施工中，暂不可用哦~请发文字。"
        )

    async def _handle_reaction(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ):
        reaction = update.message_reaction
        if not reaction:
            return

        chat_id = str(reaction.chat.id)
        if not self._check_auth(chat_id):
            return

        user = reaction.user
        if not user:
            return

        # 记录用户活跃并提取名字
        self.user_repo.update_user_activity(user, chat_id)
        display_name = self.user_repo.get_user_display_name(user)
        user_id = str(user.id)

        # 提取新添加的 emoji
        new_emojis = [
            r.emoji for r in reaction.new_reaction if getattr(r, "emoji", None)
        ]
        old_emojis = [
            r.emoji for r in reaction.old_reaction if getattr(r, "emoji", None)
        ]

        added_emojis = [e for e in new_emojis if e not in old_emojis]
        if not added_emojis:
            return

        emoji_str = "、".join(added_emojis)
        print(
            f"[TelegramBot] 收到 Reaction: [{chat_id}] {display_name} 给消息点了 {emoji_str}"
        )

        await context.bot.send_chat_action(chat_id=reaction.chat.id, action="typing")
        try:
            reaction_event = ReactionEvent(
                chat_id=chat_id,
                chat_type=reaction.chat.type,
                user_id=user_id,
                user_display_name=display_name,
                message_id=reaction.message_id,
                added_emojis=added_emojis,
            )
            llm_response = await self.conversation_service.handle_reaction(
                reaction_event
            )

            if llm_response:
                settings = self._get_settings()
                import random

                for i, msg in enumerate(llm_response):
                    text = msg.text
                    if not text:
                        continue

                    use_tts = msg.use_tts
                    emotion = msg.emotion

                    if not settings.voice_reply:
                        use_tts = False

                    success = False
                    if use_tts:
                        if not settings.character:
                            print("[TelegramAudio] 未配置绑定角色(character)，跳过 TTS")
                        else:
                            ogg_path = await self.tts_service.generate_ogg_file(
                                chat_id,
                                text,
                                emotion=emotion,
                                char_name=settings.character,
                            )
                            if ogg_path:
                                try:
                                    success = await self.voice_sender.send_voice_file(
                                        chat_id,
                                        ogg_path,
                                        reply_to_message_id=reaction.message_id,
                                    )
                                finally:
                                    import os

                                    if os.path.exists(ogg_path):
                                        os.remove(ogg_path)

                    if not success:
                        await context.bot.send_message(
                            chat_id=reaction.chat.id,
                            text=text,
                            reply_to_message_id=reaction.message_id,
                        )

                    # 拟真延时
                    if i < len(llm_response) - 1:
                        await context.bot.send_chat_action(
                            chat_id=chat_id, action="typing"
                        )
                        await asyncio.sleep(random.uniform(1.5, 3.5))

        except Exception as e:
            print(f"[TelegramBot] 处理 Reaction 失败: {e}")


# 暴露单例
telegram_service = TelegramBotService()
