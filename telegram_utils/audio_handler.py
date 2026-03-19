import os
import tempfile
import asyncio
import subprocess
from typing import Optional
from config import load_json, SETTINGS_FILE, get_sovits_host, get_character_mappings, get_current_dirs

class TelegramAudioHandler:
    """处理语音生成、格式转换和发送"""
    def __init__(self, bot_app=None):
        # type of bot_app is telegram.ext.Application
        self.bot_app = bot_app
        
    def _get_config(self) -> dict:
        settings = load_json(SETTINGS_FILE)
        return settings.get("telegram", {})
        
    async def reply_voice(self, chat_id: str, text: str, emotion: str = "default", reply_to_message_id: int = None) -> bool:
        config = self._get_config()
        if not config.get("voice_reply", True):
            return False
            
        try:
            from phone_call_utils.tts_service import TTSService
            from phone_call_utils.response_parser import EmotionSegment
            from services.model_weight_service import model_weight_service
            
            char_name = config.get("character", "")
            if not char_name:
                print("[TelegramAudio] 未配置绑定角色(character)，跳过 TTS")
                return False
                
            mappings = get_character_mappings()
            if char_name not in mappings:
                print(f"[TelegramAudio] 角色 {char_name} 未绑定模型，跳过 TTS")
                return False
                
            model_folder = mappings[char_name]
            base_dir, _ = get_current_dirs()
            
            # 依据传入的情绪寻找参考音频
            ref_dir = os.path.join(base_dir, model_folder, "reference_audios", "Chinese", "emotions")
            
            if not os.path.exists(ref_dir):
                print(f"[TelegramAudio] 参考音频 emotions 目录不存在: {ref_dir}，尝试寻找其它层级")
                ref_dir = os.path.join(base_dir, model_folder, "reference_audios")

            from utils import scan_audio_files
            import random
            audio_files = scan_audio_files(ref_dir)
            if not audio_files:
                print(f"[TelegramAudio] 参考音频库为空，跳过 TTS。搜索路径: {ref_dir}")
                return False
                
            # 过滤符合情绪的音频
            matched_files = [f for f in audio_files if f.get("emotion") == emotion]
            if not matched_files:
                # 找不到就随机选一个 fallback
                matched_files = audio_files
                
            selected_ref = random.choice(matched_files)
            ref_audio = {"path": selected_ref["path"], "text": selected_ref["text"]}
            
            tts_config = {
                "text_lang": "zh",
                "prompt_lang": "zh",
                "text_split_method": "cut0",
                "use_aux_ref_audio": False
            }
            
            tts_service = TTSService(get_sovits_host())
            segment = EmotionSegment(emotion=emotion, text=text, speed=1.0)
            
            print(f"[TelegramAudio] 正在生成语音: {text[:20]}...")
            
            # 这里是关键: 必须带锁切换模型, 防止并发使用时错乱
            async with model_weight_service.use_model(char_name, task_name=f"telegram_{chat_id}"):
                # 生成 WAV 字节
                wav_bytes = await tts_service.generate_audio(segment, ref_audio, tts_config)
                
            if not wav_bytes:
                return False
                
            # 保存到临时文件并转码为 OGG
            fd, temp_wav = tempfile.mkstemp(suffix=".wav")
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(wav_bytes)
                
                ogg_path = await self._convert_to_ogg(temp_wav)
                if ogg_path:
                    success = await self._send_voice_file(chat_id, ogg_path, reply_to_message_id=reply_to_message_id)
                    os.remove(ogg_path)
                    return success
                return False
            finally:
                if os.path.exists(temp_wav):
                    os.remove(temp_wav)
                    
        except Exception as e:
            print(f"[TelegramAudio] 语音生成/发送失败: {e}")
            import traceback
            traceback.print_exc()
            return False
            
    async def _convert_to_ogg(self, wav_path: str) -> Optional[str]:
        """将 WAV 转换为 OGG OPUS 格式以供 TG 发送"""
        ogg_path = wav_path.replace(".wav", ".ogg")
        print(f"[TelegramAudio] 正在转换格式: WAV -> OGG (OPUS)")
        try:
            command = [
                "ffmpeg", "-y", "-i", wav_path,
                "-c:a", "libopus", "-b:a", "32k", "-vbr", "on", ogg_path
            ]
            process = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL
            )
            await process.communicate()
            if process.returncode != 0:
                print(f"[TelegramAudio] ffmpeg 转换失败，退出码: {process.returncode}")
                return None
            return ogg_path
        except Exception as e:
            print(f"[TelegramAudio] ffmpeg 转换异常: {e}")
            return None
            
    async def _send_voice_file(self, chat_id: str, ogg_path: str, reply_to_message_id: int = None) -> bool:
        """发送 OGG 文件到 TG"""
        try:
            if not self.bot_app:
                print("[TelegramAudio] 未绑定 Bot 实例，无法发送")
                return False
            print(f"[TelegramAudio] 发送语音给 {chat_id}")
            with open(ogg_path, "rb") as f:
                await self.bot_app.bot.send_voice(chat_id=chat_id, voice=f, reply_to_message_id=reply_to_message_id)
            return True
        except Exception as e:
            print(f"[TelegramAudio] 发送语音失败: {e}")
            return False
