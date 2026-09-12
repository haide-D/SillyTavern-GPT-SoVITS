import os
import re
import json
import time
import asyncio
import base64
from datetime import datetime
from typing import List, Dict, Optional, Any, Tuple
from fastapi import HTTPException

from config import load_json, SETTINGS_FILE, get_current_dirs, get_sovits_host
from database import DatabaseManager
from services.llm_service import LLMService
from services.emotion_service import EmotionService
from services.preset_service import PresetService
from services.notification_service import NotificationService
from phone_call_utils.data_extractor import DataExtractor
from phone_call_utils.prompt_builder import PromptBuilder
from phone_call_utils.response_parser import ResponseParser, EmotionSegment
from phone_call_utils.audio_pipeline import AudioPipeline


class PhoneCallService:
    """主动电话生成与流转编排服务"""

    def __init__(self):
        self.llm_service = LLMService()
        self.emotion_service = EmotionService()
        self.data_extractor = DataExtractor()
        self.prompt_builder = PromptBuilder()
        self.response_parser = ResponseParser()
        self.audio_pipeline = AudioPipeline()
        self.notification_service = NotificationService()
        self.db = DatabaseManager()

    async def build_prompt(
        self,
        char_name: str,
        context: List[Dict[str, Any]],
        user_name: Optional[str] = None,
        preset_id: Optional[str] = None,
        prompt_template: Optional[str] = None,
        caller: Optional[str] = None,
        target: Optional[str] = None,
        receiver: Optional[str] = None,
        call_reason: Optional[str] = None,
        call_tone: Optional[str] = None,
        character_persona: Optional[str] = None,
        world_info: Optional[str] = None,
        story_summary: Optional[str] = None,
        chat_branch: Optional[str] = None,
        text_lang: Optional[str] = None,
        last_call_info: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        构建 LLM 提示词与配置 (深度融合世界书、人设与历史剧情总结)
        """
        effective_caller = (caller or char_name or "").strip()
        effective_target = (target or receiver or user_name or "用户").strip()

        print(f"\n[PhoneCallService] 开始构建提示词: 发起人={effective_caller}, 目标={effective_target}, 上下文={len(context)}条消息, 指定预设={preset_id}")

        settings = load_json(SETTINGS_FILE)
        phone_call_config = settings.get("phone_call", {})

        llm_config = phone_call_config.get("llm", {})
        extractors = phone_call_config.get("data_extractors", [])
        
        # 预设模板自适应 (显式指定 > 显式preset_id > 智能分析匹配生效池)
        if not prompt_template:
            if preset_id:
                preset = PresetService.get_preset("phone_call", preset_id)
            else:
                active_ids = phone_call_config.get("active_preset_ids")
                if not active_ids or not isinstance(active_ids, list):
                    single = phone_call_config.get("active_preset_id") or phone_call_config.get("preset_id") or "standard_call"
                    active_ids = [single]
                preset = PresetService.match_best_preset("phone_call", active_ids, context=context, trigger_reason=call_reason, call_tone=call_tone)

            if preset and preset.get("prompt_template"):
                prompt_template = preset["prompt_template"]
                print(f"[PhoneCallService] [PRESET] Adopt preset: {preset.get('name', 'unnamed')} (id={preset.get('id')})")
            else:
                prompt_template = phone_call_config.get("prompt_template", "")

        tts_config = phone_call_config.get("tts_config", {})
        effective_lang = text_lang or tts_config.get("text_lang", "zh")

        # 提取上下文数据与可用情绪
        extracted_data = self.data_extractor.extract(context, extractors)
        speaker_for_emotions = effective_caller or char_name
        try:
            emotions = self.emotion_service.get_available_emotions(speaker_for_emotions, lang=effective_lang)
            if not emotions:
                emotions = ["default", "neutral"]
        except HTTPException:
            raise
        except Exception as err:
            print(f"[PhoneCallService] ⚠️ 获取可用情绪异常，使用默认兜底: {err}")
            emotions = ["default", "neutral", "happy", "sad", "angry", "whisper"]

        # 尝试从数据库补充前情剧情总结 (三级梯队：指纹 -> 分支ID -> 角色最近记录)
        effective_summary = story_summary or ""
        if not effective_summary:
            fingerprints = [c.get("fingerprint") or c.get("fp") for c in context if isinstance(c, dict) and (c.get("fingerprint") or c.get("fp"))]
            if fingerprints:
                sum_ctx = self.db.get_latest_summary_context(fingerprints=fingerprints)
                effective_summary = sum_ctx.get("formatted", "")
            if not effective_summary and chat_branch:
                sum_ctx = self.db.get_latest_summary_context(chat_branch=chat_branch)
                effective_summary = sum_ctx.get("formatted", "")
            if not effective_summary and effective_caller:
                history = self.db.get_character_history(character_name=effective_caller, limit=1)
                if history:
                    s = history[0].get("summary", "")
                    sc = history[0].get("scene_summary", "")
                    parts = []
                    if s: parts.append(f"【前情剧情总结】: {s}")
                    if sc: parts.append(f"【当前场景背景】: {sc}")
                    effective_summary = "\n".join(parts)

        prompt = self.prompt_builder.build(
            template=prompt_template,
            char_name=speaker_for_emotions,
            context=context,
            extracted_data=extracted_data,
            emotions=emotions,
            text_lang=effective_lang,
            user_name=effective_target,
            call_reason=call_reason or "",
            call_tone=call_tone or "",
            caller=effective_caller,
            target=effective_target,
            receiver=effective_target,
            character_persona=character_persona or "",
            world_info=world_info or "",
            story_summary=effective_summary,
            last_call_info=last_call_info
        )

        print(f"[PhoneCallService] [SUCCESS] Prompt built: {len(prompt)} chars")

        return {
            "status": "success",
            "prompt": prompt,
            "llm_config": {
                "api_url": llm_config.get("api_url"),
                "api_key": llm_config.get("api_key"),
                "model": llm_config.get("model"),
                "temperature": llm_config.get("temperature", 0.8),
                "max_tokens": min(int(llm_config.get("max_tokens", 4000) or 4000), 8192),
                "max_retries": min(int(llm_config.get("max_retries", 2) or 2), 3)
            },
            "emotions": emotions,
            "caller": effective_caller,
            "target": effective_target
        }

    async def complete_generation(
        self,
        call_id: int,
        llm_response: str,
        chat_branch: str,
        speakers: List[str],
        char_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        完成自动电话生成：解析 LLM 响应、合成音频、更新数据库并发送推送
        """
        conn = self.db._get_connection()
        try:
            cursor = conn.execute("UPDATE auto_phone_calls SET status = 'synthesizing' WHERE id = ? AND chat_branch = ? AND status IN ('pending', 'generating')", (call_id, chat_branch))
            conn.commit()
            if cursor.rowcount == 0:
                return {"status": "duplicate", "call_id": call_id, "message": "任务已处理或正在合成"}
        finally:
            conn.close()
        print(f"\n[PhoneCallService] Received LLM response: call_id={call_id}")
        print(f"[PhoneCallService] LLM response length: {len(llm_response)} chars")

        try:
            # 清理 markdown 代码块
            llm_response_cleaned = llm_response.strip()
            markdown_pattern = r'^```(?:json)?\s*\n(.*?)\n```$'
            match = re.match(markdown_pattern, llm_response_cleaned, re.DOTALL)
            if match:
                llm_response_cleaned = match.group(1).strip()
                print(f"[PhoneCallService] Markdown block cleaned")

            # 解析 JSON 响应
            try:
                response_data = json.loads(llm_response_cleaned)
                print(f"[PhoneCallService] [SUCCESS] JSON parsed")
            except json.JSONDecodeError as e:
                print(f"[PhoneCallService] [ERROR] JSON parse failed: {str(e)}")
                raise ValueError(f"LLM 响应不是有效的 JSON 格式: {str(e)}")

            selected_speaker = response_data.get("speaker")
            if not selected_speaker or selected_speaker not in speakers:
                raise ValueError(f"LLM 返回的说话人 '{selected_speaker}' 无效，可用说话人: {speakers}")

            print(f"[PhoneCallService] LLM 选择的说话人: {selected_speaker}")

            available_emotions = self.emotion_service.get_available_emotions(selected_speaker)

            # 解析情绪片段
            settings = load_json(SETTINGS_FILE)
            parser_config = settings.get("phone_call", {}).get("response_parser", {})
            segments = self.response_parser.parse_json_response(
                llm_response_cleaned,
                parser_config,
                available_emotions=available_emotions
            )

            print(f"[PhoneCallService] 解析到 {len(segments)} 个情绪片段")

            # 调用音频流水线生成并合并音频
            tts_config = settings.get("phone_call", {}).get("tts_config", {})
            audio_merge_config = settings.get("phone_call", {}).get("audio_merge", {})

            merged_audio, segments = await self.audio_pipeline.synthesize_segments(
                char_name=selected_speaker,
                segments=segments,
                tts_config=tts_config,
                audio_merge_config=audio_merge_config,
                lock_context_id=f"phone_call_{call_id}"
            )

            audio_path = None
            audio_url = None
            if merged_audio:
                audio_path, audio_url = await self._save_audio(
                    call_id,
                    selected_speaker,
                    merged_audio,
                    audio_merge_config.get("output_format", "wav")
                )

            # 更新数据库
            conn = self.db._get_connection()
            cursor = conn.cursor()
            try:
                cursor.execute(
                    "UPDATE auto_phone_calls SET status = ?, char_name = ?, audio_path = ?, audio_url = ?, segments = ? WHERE id = ?",
                    ("completed", selected_speaker, audio_path, audio_url, json.dumps([seg.dict() for seg in segments], ensure_ascii=False), call_id)
                )
                conn.commit()
            finally:
                conn.close()

            print(f"[PhoneCallService] ✅ 生成完成: call_id={call_id}, speaker={selected_speaker}, url={audio_url}")

            # WebSocket 推送通知前端
            ws_target = char_name if char_name else selected_speaker
            await self.notification_service.notify_phone_call_ready(
                char_name=ws_target,
                call_id=call_id,
                segments=[seg.dict() for seg in segments],
                audio_path=audio_path,
                audio_url=audio_url,
                selected_speaker=selected_speaker
            )

            # 移除运行中标记
            self._cleanup_running_task(call_id)

            return {
                "status": "success",
                "message": "生成完成",
                "call_id": call_id,
                "selected_speaker": selected_speaker,
                "segments": [seg.dict() for seg in segments],
                "audio_path": audio_path,
                "audio_url": audio_url
            }

        except Exception as e:
            print(f"[PhoneCallService] ❌ 失败: {str(e)}")
            try:
                self.db.update_auto_call_status(
                    call_id=call_id,
                    status="failed",
                    error_message=str(e)
                )
            except Exception as update_err:
                print(f"[PhoneCallService] 更新状态失败: {update_err}")

            self._cleanup_running_task(call_id)
            raise HTTPException(status_code=500, detail=str(e))

    async def _save_audio(self, call_id: int, char_name: str, audio_data: bytes, audio_format: str) -> Tuple[str, str]:
        """保存合成的电话音频文件并返回本地路径和 HTTP URL"""
        settings = load_json(SETTINGS_FILE)
        cache_dir = settings.get("cache_dir", "Cache")
        auto_call_dir = os.path.join(cache_dir, "auto_phone_calls", char_name)
        os.makedirs(auto_call_dir, exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"auto_call_{call_id}_{timestamp}.{audio_format}"
        audio_path = os.path.join(auto_call_dir, filename)

        if isinstance(audio_data, str):
            audio_data = base64.b64decode(audio_data)

        with open(audio_path, "wb") as f:
            f.write(audio_data)

        relative_path = f"{char_name}/{filename}"
        audio_url = f"/auto_call_audio/{relative_path}"

        print(f"[PhoneCallService] 音频已保存: {audio_path}")
        print(f"[PhoneCallService] 音频 URL: {audio_url}")
        return audio_path, audio_url

    def _cleanup_running_task(self, call_id: int):
        """清理已调度任务的运行中标记"""
        try:
            from services.auto_call_scheduler import AutoCallScheduler
            # 延迟引用以防循环依赖
            conn = self.db._get_connection()
            cursor = conn.cursor()
            try:
                cursor.execute("SELECT trigger_floor FROM auto_phone_calls WHERE id = ?", (call_id,))
                row = cursor.fetchone()
                if row:
                    trigger_floor = row[0]
                    # 如果有全局调度器实例可在此移除
                    print(f"[PhoneCallService] 任务完成，对应楼层: {trigger_floor}")
            finally:
                conn.close()
        except Exception as cleanup_err:
            print(f"[PhoneCallService] 清理运行中标记异常: {cleanup_err}")

    async def parse_and_generate(
        self,
        char_name: str,
        llm_response: str,
        generate_audio: bool = True,
        chat_branch: Optional[str] = None,
        context_fingerprint: Optional[str] = None,
        trigger_floor: Optional[int] = None,
        target_user: Optional[str] = None,
        text_lang: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        解析 LLM 响应并按需生成音频，同时自动保存音频文件与入库
        """
        print(f"\n[PhoneCallService] 开始解析: 角色={char_name}, 响应长度={len(llm_response)} 字符, 指定语言={text_lang}")

        settings = load_json(SETTINGS_FILE)
        phone_call_config = settings.get("phone_call", {})
        parser_config = phone_call_config.get("response_parser", {})
        try:
            emotions = self.emotion_service.get_available_emotions(char_name, lang=text_lang)
        except Exception as em_err:
            print(f"[PhoneCallService] ⚠️ 无法获取可用情绪: {em_err}")
            emotions = ["default", "neutral"]
        if not emotions:
            emotions = ["default", "neutral"]

        parse_format = parser_config.get("format", "json")

        async def parse_with_timeout():
            if parse_format == "json":
                return self.response_parser.parse_json_response(
                    llm_response,
                    parser_config,
                    available_emotions=emotions
                )
            else:
                return self.response_parser.parse_emotion_segments(
                    llm_response,
                    parser_config,
                    available_emotions=emotions
                )

        max_retries = 1
        timeout_seconds = 90
        segments = None

        for attempt in range(max_retries + 1):
            try:
                segments = await asyncio.wait_for(parse_with_timeout(), timeout=timeout_seconds)
                break
            except asyncio.TimeoutError:
                if attempt >= max_retries:
                    raise HTTPException(status_code=504, detail=f"解析响应超时 (>{timeout_seconds}秒)")
            except Exception:
                raise

        if segments is None:
            raise HTTPException(status_code=500, detail="解析失败，未获取到有效片段")

        result = {
            "status": "success",
            "segments": [seg.model_dump() if hasattr(seg, 'model_dump') else seg.dict() for seg in segments],
            "total_segments": len(segments)
        }

        if generate_audio and segments:
            tts_config = dict(phone_call_config.get("tts_config", {}))
            if text_lang and text_lang != "auto":
                tts_config["text_lang"] = text_lang
                tts_config["prompt_lang"] = text_lang
            audio_merge_config = phone_call_config.get("audio_merge", {})

            merged_audio, segments = await self.audio_pipeline.synthesize_segments(
                char_name=char_name,
                segments=segments,
                tts_config=tts_config,
                audio_merge_config=audio_merge_config,
                lock_context_id=f"parse_generate_{char_name}"
            )
            result["segments"] = [seg.model_dump() if hasattr(seg, 'model_dump') else seg.dict() for seg in segments]

            if merged_audio:
                audio_format = audio_merge_config.get("format", "wav")
                call_id_int = int(time.time())
                audio_path, audio_url = await self._save_audio(call_id_int, char_name, merged_audio, audio_format)
                result["audio_path"] = audio_path
                result["audio_url"] = audio_url

                # 如果传入了对话分支或指纹，持久化写入数据库
                if chat_branch or context_fingerprint:
                    branch = chat_branch or "default"
                    fp = context_fingerprint or f"manual_{call_id_int}"
                    floor = trigger_floor or 1
                    try:
                        record_id = self.db.create_auto_call(
                            chat_branch=branch,
                            context_fingerprint=fp,
                            trigger_floor=floor,
                            char_name=char_name,
                            segments=[seg.model_dump() if hasattr(seg, 'model_dump') else seg.dict() for seg in segments],
                            audio_path=audio_path,
                            status="completed"
                        )
                        if record_id:
                            # 补全 audio_url
                            conn = self.db._get_connection()
                            cur = conn.cursor()
                            cur.execute("UPDATE auto_phone_calls SET audio_url = ? WHERE id = ?", (audio_url, record_id))
                            conn.commit()
                            conn.close()
                            result["call_id"] = record_id
                            print(f"[PhoneCallService] [SUCCESS] Persisted call history record ID: {record_id}")
                    except Exception as db_err:
                        print(f"[PhoneCallService] [WARN] Persist call history record failed: {db_err}")

        return result

    async def generate(
        self,
        char_name: str,
        context: List[Dict],
        user_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """向后兼容的直接生成入口"""
        return await self.build_prompt(char_name=char_name, context=context, user_name=user_name)

    def _select_ref_audio(self, char_name: str, emotion: str) -> Optional[Dict[str, str]]:
        """向后兼容的参考音频选择器方法"""
        return self.emotion_service.select_ref_audio(char_name, emotion)
