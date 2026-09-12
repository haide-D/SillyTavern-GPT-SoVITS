"""
对话追踪服务

用于生成多人私下对话内容
"""
import os
import random
from typing import List, Dict, Optional
from config import load_json, SETTINGS_FILE, get_current_dirs, get_sovits_host
from services.llm_service import LLMService
from services.emotion_service import EmotionService
from phone_call_utils.prompt_builder import PromptBuilder
from phone_call_utils.response_parser import ResponseParser
from phone_call_utils.models import MultiSpeakerSegment, EavesdropResult
from phone_call_utils.tts_service import TTSService
from phone_call_utils.audio_merger import AudioMerger
from utils import scan_audio_files
from database import DatabaseManager


class EavesdropService:
    """对话追踪服务 - 生成多人私下对话"""
    
    def __init__(self):
        self.db = DatabaseManager()
        self.llm_service = LLMService()
        self.emotion_service = EmotionService()
        self.prompt_builder = PromptBuilder()
        self.response_parser = ResponseParser()
        self.tts_service = TTSService(get_sovits_host())
        self.audio_merger = AudioMerger()
    
    async def build_prompt(
        self,
        context: List[Dict],
        speakers: List[str],
        user_name: str = "用户",
        text_lang: str = "zh",
        max_context_messages: int = 20,
        scene_description: str = None,
        eavesdrop_config: Dict = None,  # 分析 LLM 提供的对话主题和框架
        preset_id: Optional[str] = None,
        prompt_template: Optional[str] = None,
        target: Optional[str] = None,
        theme: Optional[str] = None,
        call_reason: Optional[str] = None,
        call_tone: Optional[str] = None,
        character_persona: Optional[str] = None,
        world_info: Optional[str] = None,
        story_summary: Optional[str] = None,
        chat_branch: Optional[str] = None
    ) -> Dict:
        """
        构建对话追踪 Prompt (支持定向窃听与自定义主题)
        
        Args:
            context: 对话上下文
            speakers: 参与角色列表（在场角色）
            user_name: 用户名
            text_lang: 文本语言
            max_context_messages: 最大上下文消息数
            scene_description: 场景描述（可选）
            eavesdrop_config: 分析 LLM 提供的对话主题、框架等配置
            preset_id: 指定预设 ID (可选)
            prompt_template: 直接指定的 Prompt 模板 (可选)
            target: 目标被议论人 (默认 user_name)
            theme: 对话主题
            call_reason: 剧情起因/动机
            call_tone: 氛围张力
            character_persona: 人设补充
            world_info: 世界书/世界观设定
            
        Returns:
            包含 prompt、speakers_emotions 等信息的字典
        """
        effective_target = (target or user_name or "用户").strip()
        print(f"[EavesdropService] 构建 Prompt: speakers={speakers}, 目标={effective_target}, text_lang={text_lang}, 指定预设={preset_id}")
        
        if eavesdrop_config:
            print(f"[EavesdropService] [CONFIG] LLM analysis config:")
            print(f"  - Theme: {eavesdrop_config.get('conversation_theme', 'none')}")
            print(f"  - Tension: {eavesdrop_config.get('dramatic_tension', 'none')}")
        
        # 获取所有说话人的可用情绪
        speakers_emotions = {}
        valid_speakers = []
        
        for speaker in speakers:
            try:
                emotions = self.emotion_service.get_available_emotions(speaker)
                if not emotions:
                    emotions = ["default", "neutral"]
                speakers_emotions[speaker] = emotions
                valid_speakers.append(speaker)
                print(f"[EavesdropService] {speaker} emotions: {emotions}")
            except Exception as e:
                print(f"[EavesdropService] [WARN] Speaker {speaker} has no model, fallback to defaults: {e}")
                speakers_emotions[speaker] = ["default", "neutral", "whisper"]
                valid_speakers.append(speaker)
        
        if len(valid_speakers) < 2:
            raise ValueError(f"需要至少2个有效角色进行对话追踪,当前只有 {len(valid_speakers)} 个")
        
        # 预设模板自适应 (显式指定 > 显式preset_id > 智能分析匹配生效池)
        custom_template = prompt_template
        settings = load_json(SETTINGS_FILE)
        phone_call_config = settings.get("phone_call", {})

        if not custom_template:
            from services.preset_service import PresetService
            if preset_id:
                preset = PresetService.get_preset("eavesdrop", preset_id)
            else:
                active_ids = phone_call_config.get("active_eavesdrop_preset_ids")
                if not active_ids or not isinstance(active_ids, list):
                    single = phone_call_config.get("active_eavesdrop_preset_id") or phone_call_config.get("eavesdrop_preset_id") or "standard_eavesdrop"
                    active_ids = [single]
                effective_theme = theme or (eavesdrop_config.get('conversation_theme') if eavesdrop_config else None)
                preset = PresetService.match_best_preset("eavesdrop", active_ids, context=context, trigger_reason=effective_theme, call_tone=call_tone)

            if preset and preset.get("prompt_template"):
                custom_template = preset["prompt_template"]
                print(f"[EavesdropService] [PRESET] Adopt preset: {preset.get('name', 'unnamed')} (id={preset.get('id')})")


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
            if not effective_summary and valid_speakers:
                for spk in valid_speakers:
                    history = self.db.get_character_history(character_name=spk, limit=1)
                    if history:
                        s = history[0].get("summary", "")
                        sc = history[0].get("scene_summary", "")
                        parts = []
                        if s: parts.append(f"[前情剧情总结]: {s}")
                        if sc: parts.append(f"[当前场景背景]: {sc}")
                        effective_summary = "\n".join(parts)
                        break

        # 构建 Prompt（使用分析 LLM 提供的配置与自定义定向参数）
        prompt = self.prompt_builder.build_eavesdrop_prompt(
            context=context,
            speakers_emotions=speakers_emotions,
            user_name=effective_target,
            text_lang=text_lang,
            max_context_messages=max_context_messages,
            eavesdrop_config=eavesdrop_config,
            template=custom_template,
            target=effective_target,
            theme=theme,
            call_reason=call_reason,
            call_tone=call_tone,
            character_persona=character_persona,
            world_info=world_info,
            story_summary=effective_summary
        )
        
        # 读取 LLM 配置
        llm_config = phone_call_config.get("llm", {})
        
        print(f"[EavesdropService] [SUCCESS] Prompt built: {len(prompt)} chars")
        
        return {
            "prompt": prompt,
            "speakers": valid_speakers,
            "speakers_emotions": speakers_emotions,
            "text_lang": text_lang,
            "llm_config": {
                "api_url": llm_config.get("api_url"),
                "api_key": llm_config.get("api_key"),
                "model": llm_config.get("model"),
                "temperature": llm_config.get("temperature", 0.8),
                "max_tokens": llm_config.get("max_tokens", 5000)
            },
            "message": "请使用前端 LLM 调用此 Prompt,然后将响应发送到 /api/eavesdrop/complete_generation"
        }
    
    async def complete_generation(
        self,
        llm_response: str,
        speakers_emotions: Dict[str, List[str]],
        text_lang: str = "zh"
    ) -> Dict:
        """
        完成对话追踪生成（解析 LLM 响应并生成音频）
        
        优化策略：按说话人分组生成，减少模型权重切换次数
        
        Args:
            llm_response: LLM 返回的响应
            speakers_emotions: 说话人情绪映射
            text_lang: 文本语言
            
        Returns:
            包含 segments、audio_url 等信息的字典
        """
        from services.model_weight_service import model_weight_service
        from phone_call_utils.response_parser import EmotionSegment
        from collections import defaultdict
        
        print(f"[EavesdropService] Parse response and start TTS")
        
        # 1. 解析响应
        segments = self.response_parser.parse_multi_speaker_response(
            response=llm_response,
            speakers_emotions=speakers_emotions
        )
        
        if not segments:
            raise ValueError("未能解析出任何对话片段")
        
        print(f"[EavesdropService] Parsed {len(segments)} segments")
        
        # 读取 TTS 配置
        settings = load_json(SETTINGS_FILE)
        tts_config = dict(settings.get("phone_call", {}).get("tts_config", {}))
        if text_lang and text_lang != "auto":
            tts_config["text_lang"] = text_lang
        
        # 2. 按说话人分组，记录原始索引
        # 格式: {speaker: [(original_index, segment, ref_audio), ...]}
        speaker_groups = defaultdict(list)
        
        for i, seg in enumerate(segments):
            ref_audio = self._select_ref_audio(seg.speaker, seg.emotion)
            if not ref_audio:
                print(f"[EavesdropService] [WARN] Skip segment {i}: No ref audio for {seg.speaker}")
                continue
            speaker_groups[seg.speaker].append((i, seg, ref_audio))
        
        print(f"[EavesdropService] Grouped speakers: {', '.join(f'{s}({len(items)})' for s, items in speaker_groups.items())}")
        
        # 3. 按说话人批量生成音频（MiniMax 免 GPU 锁，SoVITS 独占切换）
        # 格式: {original_index: audio_bytes}
        audio_results = {}
        from config import is_minimax_character
        
        for speaker, items in speaker_groups.items():
            print(f"[EavesdropService] Synthesizing {len(items)} segments for {speaker}")
            is_mm = is_minimax_character(speaker)

            if is_mm:
                # MiniMax 云端说话人：直调生成
                for original_index, seg, ref_audio in items:
                    try:
                        emotion_segment = EmotionSegment(
                            emotion=seg.emotion,
                            text=seg.text,
                            speed=seg.speed
                        )
                        audio_bytes = await self.tts_service.generate_audio(
                            segment=emotion_segment,
                            ref_audio=ref_audio,
                            tts_config=tts_config,
                            previous_ref_audio=None
                        )
                        audio_results[original_index] = audio_bytes
                        print(f"[EavesdropService] [SUCCESS] MiniMax Segment {original_index} ({speaker}) synthesized")
                    except Exception as e:
                        print(f"[EavesdropService] [WARN] MiniMax Segment {original_index} ({speaker}) TTS failed: {e}")
                        continue
            else:
                # GPT-SoVITS 本地说话人：使用 ModelWeightService 切换并加锁
                async with model_weight_service.use_model(speaker, f"eavesdrop_{speaker}") as success:
                    if not success:
                        print(f"[EavesdropService] [ERROR] Cannot switch model to {speaker}, skipped")
                        continue
                    
                    # 批量生成该说话人的所有片段
                    for original_index, seg, ref_audio in items:
                        try:
                            emotion_segment = EmotionSegment(
                                emotion=seg.emotion,
                                text=seg.text,
                                speed=seg.speed
                            )
                            
                            audio_bytes = await self.tts_service.generate_audio(
                                segment=emotion_segment,
                                ref_audio=ref_audio,
                                tts_config=tts_config,
                                previous_ref_audio=None  # 分组生成时不使用情绪过渡
                            )
                            
                            audio_results[original_index] = audio_bytes
                            print(f"[EavesdropService] [SUCCESS] Segment {original_index} ({speaker}) synthesized")
                            
                        except Exception as e:
                            print(f"[EavesdropService] [WARN] Segment {original_index} ({speaker}) TTS failed: {e}")
                            continue
        
        missing = [i + 1 for i in range(len(segments)) if not audio_results.get(i)]
        if missing:
            raise RuntimeError(f"窃听语音合成不完整，失败片段: {missing}，请重试")

        # 4. 按原始顺序重组音频列表
        audio_bytes_list = []
        valid_segments = []
        
        for i, seg in enumerate(segments):
            if i in audio_results:
                audio_bytes_list.append(audio_results[i])
                valid_segments.append(seg)

        
        if not audio_bytes_list:
            raise ValueError("所有片段的 TTS 生成都失败了")
        
        print(f"[EavesdropService] [SUCCESS] Total valid segments: {len(audio_bytes_list)}")
        
        # 5. 合并音频
        settings = load_json(SETTINGS_FILE)
        phone_call_config = settings.get("phone_call", {})
        audio_merger_config = phone_call_config.get("audio_merge", {})
        
        # 添加多说话人合并配置
        audio_merger_config["speaker_change_pause"] = audio_merger_config.get("speaker_change_pause", 0.6)
        audio_merger_config["same_speaker_pause"] = audio_merger_config.get("same_speaker_pause", 0.3)
        
        merged_audio = self.audio_merger.merge_multi_speaker_segments(
            segments=valid_segments,  # 使用按原始顺序排列的有效片段
            audio_bytes_list=audio_bytes_list,
            config=audio_merger_config
        )
        
        print(f"[EavesdropService] [SUCCESS] Audio merged: {len(merged_audio)} bytes")
        
        # 6. 保存音频文件
        import time
        timestamp = int(time.time())
        filename = f"eavesdrop_{timestamp}.wav"
        
        _, cache_root = get_current_dirs()
        cache_dir = os.path.join(cache_root, "eavesdrop")
        os.makedirs(cache_dir, exist_ok=True)
        
        audio_path = os.path.join(cache_dir, filename)
        with open(audio_path, "wb") as f:
            f.write(merged_audio)
        
        print(f"[EavesdropService] ✅ 音频保存到: {audio_path}")
        
        # 7. 返回结果
        return {
            "segments": [seg.model_dump() for seg in valid_segments],
            "audio_path": audio_path,
            "audio_url": f"/api/audio/eavesdrop/{filename}",
            "segment_count": len(audio_bytes_list)
        }
    
    def _select_ref_audio(self, char_name: str, emotion: str) -> Optional[Dict]:
        """根据情绪选择参考音频 (统一复用 EmotionService)"""
        return EmotionService.select_ref_audio(char_name, emotion)

