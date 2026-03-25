import asyncio
import os
import tempfile
from typing import Optional

from config import get_character_mappings, get_current_dirs, get_sovits_host


class TelegramTtsService:
    async def generate_ogg_file(
        self, chat_id: str, text: str, emotion: str, char_name: str,
        voice_lang: str = "zh",
    ) -> Optional[str]:
        try:
            from phone_call_utils.tts_service import TTSService
            from phone_call_utils.response_parser import EmotionSegment
            from services.model_weight_service import model_weight_service
            from utils import scan_audio_files
            import random

            mappings = get_character_mappings()
            if char_name not in mappings:
                print(f"[TelegramAudio] 角色 {char_name} 未绑定模型，跳过 TTS")
                return None

            model_folder = mappings[char_name]
            base_dir, _ = get_current_dirs()
            
            # 根据 voice_lang 决定参考音频目录
            lang_map = {
                "zh": "Chinese",
                "en": "English",
                "ja": "Japanese"
            }
            lang_dir = lang_map.get(voice_lang, "Chinese")
            
            ref_dir = os.path.join(
                base_dir, model_folder, "reference_audios", lang_dir, "emotions"
            )
            if not os.path.exists(ref_dir):
                print(
                    f"[TelegramAudio] 参考音频 emotions 目录不存在: {ref_dir}，尝试寻找其它层级"
                )
                ref_dir = os.path.join(base_dir, model_folder, "reference_audios")

            audio_files = scan_audio_files(ref_dir)
            if not audio_files:
                print(f"[TelegramAudio] 参考音频库为空，跳过 TTS。搜索路径: {ref_dir}")
                return None

            matched_files = [f for f in audio_files if f.get("emotion") == emotion]
            if not matched_files:
                matched_files = audio_files

            selected_ref = random.choice(matched_files)
            ref_audio = {"path": selected_ref["path"], "text": selected_ref["text"]}

            tts_config = {
                "text_lang": voice_lang,
                "prompt_lang": "zh",
                "text_split_method": "cut0",
                "use_aux_ref_audio": False,
            }

            tts_service = TTSService(get_sovits_host())
            segment = EmotionSegment(emotion=emotion, text=text, speed=1.0)

            print(f"[TelegramAudio] 正在生成语音: {text[:20]}...")

            async with model_weight_service.use_model(
                char_name, task_name=f"telegram_{chat_id}"
            ):
                wav_bytes = await tts_service.generate_audio(
                    segment, ref_audio, tts_config
                )

            if not wav_bytes:
                return None

            fd, temp_wav = tempfile.mkstemp(suffix=".wav")
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(wav_bytes)

                ogg_path = await self._convert_to_ogg(temp_wav)
                return ogg_path
            finally:
                if os.path.exists(temp_wav):
                    os.remove(temp_wav)

        except Exception as e:
            print(f"[TelegramAudio] 语音生成失败: {e}")
            import traceback

            traceback.print_exc()
            return None

    async def _convert_to_ogg(self, wav_path: str) -> Optional[str]:
        ogg_path = wav_path.replace(".wav", ".ogg")
        print("[TelegramAudio] 正在转换格式: WAV -> OGG (OPUS)")
        try:
            command = [
                "ffmpeg",
                "-y",
                "-i",
                wav_path,
                "-c:a",
                "libopus",
                "-b:a",
                "32k",
                "-vbr",
                "on",
                ogg_path,
            ]
            process = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await process.communicate()
            if process.returncode != 0:
                print(f"[TelegramAudio] ffmpeg 转换失败，退出码: {process.returncode}")
                return None
            return ogg_path
        except Exception as e:
            print(f"[TelegramAudio] ffmpeg 转换异常: {e}")
            return None
