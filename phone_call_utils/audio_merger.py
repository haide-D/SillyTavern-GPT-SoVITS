from pydub import AudioSegment
from pydub.effects import normalize
from io import BytesIO
from typing import List, Dict, Optional


class AudioMerger:
    """音频合并工具"""
    
    @staticmethod
    def merge_segments(
        audio_bytes_list: List[bytes],
        config: Dict,
        pause_durations: Optional[List[Optional[float]]] = None,
        filler_word_audios: Optional[List[Optional[bytes]]] = None
    ) -> bytes:
        """
        合并多段音频,支持动态停顿和语气词插入
        
        Args:
            audio_bytes_list: 音频字节列表
            config: 合并配置
                - silence_between_segments: 默认片段间静音时长(秒)
                - normalize_volume: 是否归一化音量
                - output_format: 输出格式(wav/mp3)
            pause_durations: 每个片段后的停顿时长列表(秒)
                - 长度应与 audio_bytes_list 相同
                - None 或元素为 None 时使用默认值
                - 示例: [0.5, None, 0.8] 表示第1段后停0.5秒,第2段用默认,第3段停0.8秒
            filler_word_audios: 每个片段后的语气词音频字节列表
                - 长度应与 audio_bytes_list 相同
                - None 或元素为 None 时不插入语气词
                - 语气词会插入在停顿之后
                - 示例: [b'...', None, b'...'] 表示第1段后加语气词,第2段不加,第3段加
        
        Returns:
            合并后的音频字节
        
        示例:
            # 基础用法(向后兼容)
            merged = AudioMerger.merge_segments(audios, config)
            
            # 动态停顿
            merged = AudioMerger.merge_segments(
                audios, 
                config,
                pause_durations=[0.5, 0.3, 0.8]  # 每段自定义停顿
            )
            
            # 添加语气词
            merged = AudioMerger.merge_segments(
                audios,
                config,
                pause_durations=[0.3, 0.2, 0.5],
                filler_word_audios=[filler1_bytes, None, filler2_bytes]
            )
        """
        if not audio_bytes_list:
            raise ValueError("音频列表为空")
        
        default_silence_ms = int(config.get("silence_between_segments", 0.3) * 1000)
        normalize_vol = config.get("normalize_volume", True)
        output_fmt = config.get("output_format", "wav")
        
        # 加载所有音频片段
        segments = []
        for audio_bytes in audio_bytes_list:
            segment = AudioSegment.from_file(BytesIO(audio_bytes), format="wav")
            segments.append(segment)
        
        # 加载语气词音频(如果提供)
        filler_segments = []
        if filler_word_audios:
            for filler_bytes in filler_word_audios:
                if filler_bytes:
                    filler_seg = AudioSegment.from_file(BytesIO(filler_bytes), format="wav")
                    filler_segments.append(filler_seg)
                else:
                    filler_segments.append(None)
        
        # 合并音频
        merged = segments[0]
        
        for i, seg in enumerate(segments[1:], start=1):
            # 确定此片段前的停顿时长
            prev_idx = i - 1
            if pause_durations and prev_idx < len(pause_durations) and pause_durations[prev_idx] is not None:
                silence_ms = int(pause_durations[prev_idx] * 1000)
            else:
                silence_ms = default_silence_ms
            
            # 添加停顿
            silence = AudioSegment.silent(duration=silence_ms)
            merged += silence
            
            # 添加语气词(如果有)
            if filler_segments and prev_idx < len(filler_segments) and filler_segments[prev_idx]:
                merged += filler_segments[prev_idx]
                # 语气词后再加一小段停顿(可选,让语气词更自然)
                merged += AudioSegment.silent(duration=100)  # 0.1秒
            
            # 添加当前片段
            merged += seg
        
        # 音量归一化
        if normalize_vol:
            merged = normalize(merged)
        
        # 导出
        output = BytesIO()
        merged.export(output, format=output_fmt)
        return output.getvalue()
    
    @staticmethod
    def merge_multi_speaker_segments(
        segments: List["MultiSpeakerSegment"],
        audio_bytes_list: List[bytes],
        config: Dict
    ) -> bytes:
        """
        合并多说话人音频，说话人切换时使用更长停顿
        
        会同步更新 segments 中每个元素的 start_time 和 audio_duration 字段（原地修改）
        
        Args:
            segments: 多说话人片段列表（包含 speaker 信息）
            audio_bytes_list: 对应的音频字节列表
            config: 合并配置
                - speaker_change_pause: 说话人切换时的停顿(秒)，默认 0.6
                - same_speaker_pause: 同一说话人内的停顿(秒)，默认 0.3
                - normalize_volume: 是否归一化音量
                - output_format: 输出格式(wav/mp3)
                
        Returns:
            合并后的音频字节
        """
        from phone_call_utils.models import MultiSpeakerSegment
        
        if not audio_bytes_list:
            raise ValueError("音频列表为空")
        
        if len(segments) != len(audio_bytes_list):
            raise ValueError(f"片段数({len(segments)})与音频数({len(audio_bytes_list)})不匹配")
        
        speaker_change_pause_ms = int(config.get("speaker_change_pause", 0.6) * 1000)
        same_speaker_pause_ms = int(config.get("same_speaker_pause", 0.3) * 1000)
        normalize_vol = config.get("normalize_volume", True)
        output_fmt = config.get("output_format", "wav")
        
        # 加载所有音频片段并计算时长
        audio_segments = []
        for audio_bytes in audio_bytes_list:
            audio_seg = AudioSegment.from_file(BytesIO(audio_bytes), format="wav")
            audio_segments.append(audio_seg)
        
        # 计算每个 segment 的时间信息
        current_time_ms = 0
        
        for i, (seg, audio_seg) in enumerate(zip(segments, audio_segments)):
            # 更新这个 segment 的开始时间和时长
            seg.start_time = current_time_ms / 1000.0  # 转为秒
            seg.audio_duration = len(audio_seg) / 1000.0  # pydub len 返回毫秒
            
            # 累加时间：当前片段时长
            current_time_ms += len(audio_seg)
            
            # 添加后续停顿时间（用于下一个 segment 的计算）
            if i < len(segments) - 1:
                next_speaker = segments[i + 1].speaker
                current_speaker = seg.speaker
                
                if next_speaker != current_speaker:
                    current_time_ms += speaker_change_pause_ms
                else:
                    if seg.pause_after is not None:
                        current_time_ms += int(seg.pause_after * 1000)
                    else:
                        current_time_ms += same_speaker_pause_ms
        
        # 合并音频
        merged = audio_segments[0]
        previous_speaker = segments[0].speaker
        
        for i in range(1, len(audio_segments)):
            current_speaker = segments[i].speaker
            prev_segment = segments[i - 1]
            
            # 确定停顿时长
            if current_speaker != previous_speaker:
                # 说话人切换，使用更长停顿
                silence_ms = speaker_change_pause_ms
                print(f"[AudioMerger] 说话人切换: {previous_speaker} -> {current_speaker}, 停顿 {silence_ms}ms")
            else:
                # 同一说话人，使用较短停顿
                # 优先使用 segment 指定的 pause_after
                if prev_segment.pause_after is not None:
                    silence_ms = int(prev_segment.pause_after * 1000)
                else:
                    silence_ms = same_speaker_pause_ms
            
            # 添加停顿
            silence = AudioSegment.silent(duration=silence_ms)
            merged += silence
            
            # 添加当前片段
            merged += audio_segments[i]
            previous_speaker = current_speaker
        
        # 音量归一化
        if normalize_vol:
            merged = normalize(merged)
        
        # 导出
        output = BytesIO()
        merged.export(output, format=output_fmt)
        
        print(f"[AudioMerger] ✅ 多说话人音频合并完成: {len(audio_segments)} 段, {len(merged)}ms")
        print(f"[AudioMerger] 📊 时间信息已更新到 segments")
        return output.getvalue()

