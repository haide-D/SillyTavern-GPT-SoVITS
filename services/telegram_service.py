import asyncio
import os
import random
from dataclasses import dataclass
from typing import Dict, Optional, Set

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
    bot_id: int = 0


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
        self._director_runtime: Optional[BotRuntime] = None

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

    def _is_director(self, bot) -> bool:
        """判断当前 Bot 是否为主持人（唯一负责接收群聊消息的 Bot）"""
        return self._director_runtime is not None and bot.id == self._director_runtime.bot_id

    def _managed_user_ids(self) -> Set[int]:
        return {
            runtime.bot_id for runtime in self._runtimes.values() if runtime.bot_id
        }

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
            is_first = True
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

                if is_first:
                    # 主持人 Bot：注册全部 Handler，负责接收所有群聊消息
                    self._register_director_handlers(runtime)
                else:
                    # 演员 Bot：只注册私聊 /start（供用户开启私聊通道）
                    self._register_actor_handlers(runtime)

                await app.initialize()
                await app.start()
                me = await app.bot.get_me()
                runtime.username = me.username or ""
                runtime.bot_id = me.id
                runtimes[bot_cfg.bot_id] = runtime

                if is_first:
                    self._director_runtime = runtime
                    is_first = False

            # 只有主持人 Bot 需要长轮询接收消息
            director = self._director_runtime
            if director:
                print(
                    f"[TelegramBot] 🎬 主持人 Bot 开始长轮询: {director.config.bot_id} @{director.username}"
                )
                await director.app.updater.start_polling(
                    drop_pending_updates=True,
                    allowed_updates=[UpdateType.MESSAGE, UpdateType.MESSAGE_REACTION],
                )

            self._runtimes = runtimes
            self.is_running = True
            actor_ids = [k for k in runtimes if k != director.config.bot_id] if director else []
            print(f"[TelegramBot] Startup complete. 主持人={director.config.bot_id if director else '-'}, 演员={actor_ids}")
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
        # 先停主持人的轮询
        if self._director_runtime:
            try:
                await self._director_runtime.app.updater.stop()
            except Exception as e:
                print(f"[TelegramBot] 停止主持人轮询时出错: {e}")
        # 停止所有 Bot 的 Application
        for runtime in self._runtimes.values():
            try:
                await runtime.app.stop()
                await runtime.app.shutdown()
            except Exception as e:
                print(f"[TelegramBot] 停止 {runtime.config.bot_id} 时出错: {e}")
        self._runtimes = {}
        self._director_runtime = None
        self.is_running = False
        print("[TelegramBot] Stopped.")

    def _register_director_handlers(self, runtime: BotRuntime):
        """主持人 Bot：注册全部 Handler（命令 + 文字 + 语音 + 表情反应）"""
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

    def _register_actor_handlers(self, runtime: BotRuntime):
        """演员 Bot：只注册私聊 /start，用于建立私聊通道"""
        app = runtime.app
        app.add_handler(CommandHandler("start", self._cmd_start))

    def _is_allowed_for_any_bot(self, chat_id: str) -> bool:
        settings = self._get_settings()
        for bot in settings.get_enabled_bots():
            if not bot.allowed_chat_ids or str(chat_id) in bot.allowed_chat_ids:
                return True
        return False

    async def _cmd_start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if not self._is_allowed_for_any_bot(chat_id):
            await update.effective_message.reply_text(
                "抱歉，您没有使用此 Bot 集群的权限。"
            )
            return
        reply_text = self.command_service.handle_start(chat_id, self._get_settings())
        await update.effective_message.reply_text(reply_text)

    async def _cmd_clear(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if not self._is_allowed_for_any_bot(chat_id):
            return
        reply_text = self.command_service.handle_clear(chat_id, self._get_settings())
        await update.effective_message.reply_text(reply_text)

    async def _cmd_mode(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if not self._is_allowed_for_any_bot(chat_id):
            return
        mode = context.args[0].strip() if context.args else None
        reply_text = self.command_service.handle_mode(
            chat_id, self._get_settings(), mode
        )
        await update.effective_message.reply_text(reply_text)

    async def _cmd_story(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if not self._is_allowed_for_any_bot(chat_id):
            return
        story_id = context.args[0].strip() if context.args else None
        reply_text = self.command_service.handle_story(
            chat_id, self._get_settings(), story_id
        )
        await update.effective_message.reply_text(reply_text)

    async def _cmd_pack(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if not self._is_allowed_for_any_bot(chat_id):
            return
        pack_id = context.args[0].strip() if context.args else None
        reply_text = self.command_service.handle_pack(
            chat_id, self._get_settings(), pack_id
        )
        await update.effective_message.reply_text(reply_text)

    async def _cmd_setpersona(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
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
        if not self._is_allowed_for_any_bot(chat_id):
            return
        user = update.effective_user
        if not user:
            return
        reply_text = self.command_service.handle_whoami(user)
        await update.effective_message.reply_text(reply_text)

    async def _handle_text(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """由主持人 Bot 统一处理所有群聊文字消息"""
        if not update.effective_message or not update.effective_chat:
            return
        if update.effective_user and update.effective_user.is_bot:
            return

        chat_id = str(update.effective_chat.id)
        message_id = update.effective_message.message_id

        if not self._is_allowed_for_any_bot(chat_id):
            return

        user = update.effective_user
        user_text = update.effective_message.text or ""
        chat_type = update.effective_chat.type

        # 解析 Telegram 回复上下文
        managed_usernames = self._managed_usernames()
        managed_user_ids = self._managed_user_ids()
        replied_msg = update.effective_message.reply_to_message
        replied_user = replied_msg.from_user if replied_msg else None

        is_reply = False
        if replied_user:
            if replied_user.id in managed_user_ids:
                is_reply = True
            elif replied_user.username and replied_user.username in managed_usernames:
                is_reply = True

        reply_to_message_id = replied_msg.message_id if replied_msg else None
        is_mention = any(
            f"@{username}" in user_text for username in managed_usernames if username
        )

        # 触发条件：私聊，或者群聊被回复/艾特
        is_trigger = not is_group_chat(chat_type) or should_reply_in_group(is_reply, is_mention)

        display_name = self.user_repo.get_user_display_name(user)
        user_id = str(user.id) if user else "Unknown"
        self.user_repo.update_user_activity(user, chat_id)

        # 替换 @bot_username 为 [对角色名说]，回复功能也自动加点名标记
        for runtime in self._runtimes.values():
            target_name = runtime.config.character_name or runtime.config.character_ref

            if runtime.username and f"@{runtime.username}" in user_text:
                user_text = user_text.replace(f"@{runtime.username}", f"[对{target_name}说]")

            if is_reply and replied_user:
                if replied_user.id == runtime.bot_id or (
                    runtime.username and replied_user.username == runtime.username
                ):
                    mention_text = f"[对{target_name}说]"
                    if mention_text not in user_text:
                        user_text = f"{mention_text} {user_text}"

        user_text = user_text.strip()
        print(f"[TelegramBot] 主持人收到消息: (chat={chat_id}, user={display_name}, reply={is_reply}, trigger={is_trigger}, text={user_text[:30]}...)")

        if is_trigger:
            await context.bot.send_chat_action(
                chat_id=update.effective_chat.id, action="typing"
            )

        try:
            director = self._director_runtime
            inbound = InboundMessage(
                chat_id=chat_id,
                chat_type=chat_type,
                text=user_text,
                user_id=user_id,
                user_display_name=display_name,
                source_bot_id=director.config.bot_id if director else "unknown",
                source_bot_username=director.username if director else "",
                message_id=message_id,
                reply_to_message_id=reply_to_message_id,
                is_group=is_group_chat(chat_type),
                is_reply_to_bot=is_reply,
                is_mention=is_mention,
            )

            if not is_trigger:
                await self.conversation_service.save_passive_message(inbound)
                return

            llm_response = await self.conversation_service.handle_text(inbound)
            if not llm_response:
                print(f"[TelegramBot] 导演模型未产生任何 Bot 回复，静默处理 (chat={chat_id})")
                return
            await self._dispatch_messages(chat_id, message_id, llm_response)
        except Exception as e:
            print(f"[TelegramBot] 处理文字消息失败: {e}")
            import traceback
            traceback.print_exc()

    async def _handle_voice(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not update.effective_message or not update.effective_chat:
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

            # ===== 私聊发送路径 =====
            if msg.is_private:
                await self._send_private_message(
                    runtime, chat_id, msg.target_user_display_name, msg.text
                )
                continue

            # ===== 群发路径 =====
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
                    except Exception as e:
                        if "reply" in str(e).lower() or "not found" in str(e).lower():
                            print(f"[TelegramAudio] 发送语音失败(回复对象未找到)，尝试无引用发送...")
                            try:
                                success = await VoiceSender(runtime.app).send_voice_file(
                                    chat_id,
                                    ogg_path,
                                    reply_to_message_id=None,
                                )
                            except Exception as e2:
                                print(f"[TelegramAudio] 无引用发送语音也失败: {e2}")
                        else:
                            print(f"[TelegramAudio] 发送语音发生异常: {e}")
                    finally:
                        if os.path.exists(ogg_path):
                            os.remove(ogg_path)

            if not success:
                try:
                    await runtime.app.bot.send_message(
                        chat_id=chat_id,
                        text=msg.text,
                        reply_to_message_id=reply_target,
                    )
                except Exception as e:
                    if "reply" in str(e).lower() or "not found" in str(e).lower():
                        print(f"[TelegramBot] Bot @{runtime.username} 无法回复消息。降级直接群发...")
                        await runtime.app.bot.send_message(
                            chat_id=chat_id,
                            text=msg.text,
                            reply_to_message_id=None,
                        )
                    else:
                        raise

            if i < len(messages) - 1:
                try:
                    await runtime.app.bot.send_chat_action(chat_id=chat_id, action="typing")
                except Exception:
                    pass
                await asyncio.sleep(random.uniform(1.0, 2.5))

    async def _send_private_message(
        self, runtime: BotRuntime, group_chat_id: str, target_name: str, text: str
    ):
        """通过 Bot 私聊向指定玩家发送秘密消息"""
        user_id = self.user_repo.find_user_id_by_display_name(target_name)
        if not user_id:
            print(f"[TelegramBot] 私聊发送失败: 找不到用户 '{target_name}'")
            await runtime.app.bot.send_message(
                chat_id=group_chat_id,
                text=f"[系统提示] 无法向 {target_name} 发送私聊，未找到该用户记录。",
            )
            return

        try:
            await runtime.app.bot.send_message(chat_id=int(user_id), text=text)
            print(f"[TelegramBot] ✅ 私聊已发送给 {target_name} (uid={user_id})")
        except Exception as e:
            error_msg = str(e).lower()
            if "forbidden" in error_msg or "initiate" in error_msg or "blocked" in error_msg:
                print(f"[TelegramBot] 私聊失败(用户未 /start): {target_name}")
                await runtime.app.bot.send_message(
                    chat_id=group_chat_id,
                    text=f"📩 @{target_name}，请先私聊 @{runtime.username} 发送 /start，然后我才能给你发送秘密信息哦~",
                )
            else:
                print(f"[TelegramBot] 私聊发送异常: {e}")
                await runtime.app.bot.send_message(
                    chat_id=group_chat_id,
                    text=f"[系统提示] 向 {target_name} 发送私聊失败: {e}",
                )


telegram_service = TelegramBotService()
