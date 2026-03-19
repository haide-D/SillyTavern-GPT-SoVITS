class VoiceSender:
    def __init__(self, bot_app=None):
        self.bot_app = bot_app

    async def send_voice_file(
        self, chat_id: str, ogg_path: str, reply_to_message_id=None
    ) -> bool:
        try:
            if not self.bot_app:
                print("[TelegramAudio] 未绑定 Bot 实例，无法发送")
                return False
            print(f"[TelegramAudio] 发送语音给 {chat_id}")
            with open(ogg_path, "rb") as f:
                await self.bot_app.bot.send_voice(
                    chat_id=chat_id, voice=f, reply_to_message_id=reply_to_message_id
                )
            return True
        except Exception as e:
            print(f"[TelegramAudio] 发送语音失败: {e}")
            return False
