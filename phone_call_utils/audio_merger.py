from pydub import AudioSegment
from pydub.effects import normalize
from io import BytesIO
from typing import List, Dict


class AudioMerger:
    """音频合并工具"""
    
    @staticmethod
    def merge_segments(
        audio_bytes_list: List[bytes],
        config: Dict
    ) -> bytes:
        """
        合并多段音频
        
        Args:
            audio_bytes_list: 音频字节列表
            config: 合并配置
                - silence_between_segments: 片段间静音时长(秒)
                - normalize_volume: 是否归一化音量
                - output_format: 输出格式(wav/mp3)
        
        Returns:
            合并后的音频字节
        """
        if not audio_bytes_list:
            raise ValueError("音频列表为空")
        
        silence_ms = int(config.get("silence_between_segments", 0.3) * 1000)
        normalize_vol = config.get("normalize_volume", True)
        output_fmt = config.get("output_format", "wav")
        
        # 加载所有音频片段
        segments = []
        for audio_bytes in audio_bytes_list:
            segment = AudioSegment.from_file(BytesIO(audio_bytes), format="wav")
            segments.append(segment)
        
        # 插入静音并合并
        silence = AudioSegment.silent(duration=silence_ms)
        merged = segments[0]
        for seg in segments[1:]:
            merged += silence + seg
        
        # 音量归一化
        if normalize_vol:
            merged = normalize(merged)
        
        # 导出
        output = BytesIO()
        merged.export(output, format=output_fmt)
        return output.getvalue()
