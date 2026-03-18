import asyncio
from typing import Optional
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from config import load_json, SETTINGS_FILE
from telegram_utils.memory_manager import MemoryManager
from telegram_utils.llm_handler import TelegramLLMHandler
from telegram_utils.audio_handler import TelegramAudioHandler

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
        
        # 挂载独立职责对象
        self.memory = MemoryManager()
        self.llm_handler = TelegramLLMHandler(self.memory)
        self.audio_handler = TelegramAudioHandler()
        
        self.initialized = True
        
    def _get_config(self) -> dict:
        settings = load_json(SETTINGS_FILE)
        return settings.get("telegram", {})
        
    def _check_auth(self, chat_id: str) -> bool:
        """检查用户权限"""
        config = self._get_config()
        allowed = config.get("allowed_chat_ids", [])
        if not allowed:
            return True
        return str(chat_id) in allowed

    async def start(self) -> bool:
        """启动长轮询"""
        if self.is_running:
            return True
            
        config = self._get_config()
        if not config.get("enabled"):
            print("[TelegramBot] 未启用, 跳过启动")
            return False
            
        token = config.get("bot_token")
        if not token:
            print("[TelegramBot] 未配置 Token, 跳过启动")
            return False
            
        try:
            proxy_config = config.get("proxy", {})
            builder = Application.builder().token(token)
            
            if proxy_config.get("enabled"):
                proxy_url = proxy_config.get("http")
                if proxy_url:
                    print(f"[TelegramBot] 使用代理: {proxy_url}")
                    from telegram.request import HTTPXRequest
                    request_obj = HTTPXRequest(proxy=proxy_url)
                    get_updates_request_obj = HTTPXRequest(proxy=proxy_url)
                    builder = builder.request(request_obj).get_updates_request(get_updates_request_obj)

            self.app = builder.build()
            self.audio_handler.bot_app = self.app  # 给音频库绑定应用，以便发送语音
            
            # 注册 handlers
            self.app.add_handler(CommandHandler("start", self._cmd_start))
            self.app.add_handler(CommandHandler("clear", self._cmd_clear))
            
            # 【临时增加的终极全捕获 DEBUG】
            async def _debug_all_events(update: Update, context: ContextTypes.DEFAULT_TYPE):
                try:
                    if update.effective_chat and update.effective_chat.type in ['group', 'supergroup']:
                        print(f"\n[DEBUG 底层事件捕获] 📥 => {update.to_dict()}\n")
                except:
                    pass
            self.app.add_handler(MessageHandler(filters.ALL, _debug_all_events), group=-1)
            
            self.app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, self._handle_text))
            self.app.add_handler(MessageHandler(filters.VOICE, self._handle_voice))

            # 开始轮训
            await self.app.initialize()
            await self.app.start()
            
            print("[TelegramBot] 开始长轮询...")
            await self.app.updater.start_polling(drop_pending_updates=True)
            
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
            
        self.memory.clear_history(chat_id)
        await update.effective_message.reply_text("你好! 我是 SillyTavern 终端。发送 /clear 可以清空聊天历史。")

    async def _cmd_clear(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if not self._check_auth(chat_id):
            return
        self.memory.clear_history(chat_id)
        await update.effective_message.reply_text("脑子空空......历史记录已清除。")

    async def _handle_text(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        user_text = update.effective_message.text or ""
        chat_type = update.effective_chat.type
        bot_username = context.bot.username
        
        print(f"[TelegramBot] 收到消息: [{chat_id}]({chat_type}) {user_text}")
        
        if chat_type in ['group', 'supergroup']:
            is_reply = (update.effective_message.reply_to_message and 
                       update.effective_message.reply_to_message.from_user and 
                       update.effective_message.reply_to_message.from_user.username == bot_username)
            is_mention = f"@{bot_username}" in user_text
            
            if not (is_reply or is_mention):
                return
                
            user_text = user_text.replace(f"@{bot_username}", "").strip()

        if not self._check_auth(chat_id):
            print(f"[TelegramBot] 🚨 拦截消息：群组/用户 {chat_id} 不在白名单中。如果您需要机器人在本群回复，请将此数字添加进 allowed_chat_ids。")
            return
            
        await context.bot.send_chat_action(chat_id=update.effective_chat.id, action='typing')
        
        try:
            # LLM 交互
            llm_response = await self.llm_handler.generate_reply(chat_id, user_text)
            
            if not llm_response:
                await update.effective_message.reply_text("[系统] LLM 未返回有效响应，请检查配置。")
                return
                
            config = self._get_config()
            
            # 如果没开语音，或者生成语音失败，降级回文字发送
            if not config.get("voice_reply", True):
                await update.effective_message.reply_text(llm_response)
            else:
                # 尝试生成音频
                success = await self.audio_handler.reply_voice(chat_id, llm_response)
                # 兜底：如果没发出去语音，依然发文字
                if not success:
                    await update.effective_message.reply_text(f"(语音发送失败)\n{llm_response}")
                
        except Exception as e:
            print(f"[TelegramBot] 处理文字消息失败: {e}")
            await update.effective_message.reply_text(f"[系统错误] 处理消息失败: {e}")
            
    async def _handle_voice(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        chat_id = str(update.effective_chat.id)
        if not self._check_auth(chat_id):
            return
        await update.effective_message.reply_text("[系统提示] 多模态语音输入还在施工中，暂不可用哦~请发文字。")

# 暴露单例
telegram_service = TelegramBotService()
