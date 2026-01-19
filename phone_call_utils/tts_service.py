import httpx
from typing import Dict
from phone_call_utils.response_parser import EmotionSegment


class TTSService:
    """TTS服务封装 - 用于主动电话"""
    
    def __init__(self, sovits_host: str):
        self.sovits_host = sovits_host
    
    async def generate_audio(
        self,
        segment: EmotionSegment,
        ref_audio: Dict,
        tts_config: Dict
    ) -> bytes:
        """
        为单个情绪片段生成音频
        
        Args:
            segment: 情绪片段
            ref_audio: 参考音频信息 {path, text}
            tts_config: TTS配置参数
        
        Returns:
            音频字节数据
        """
        url = f"{self.sovits_host}/tts"
        
        # 合并配置
        params = {
            "text": segment.text,
            "text_lang": tts_config.get("text_lang", "zh"),
            "ref_audio_path": ref_audio["path"],
            "prompt_text": ref_audio["text"],
            "prompt_lang": tts_config.get("prompt_lang", "zh"),
        }
        
        # 添加所有TTS高级参数
        for key in [
            "aux_ref_audio_paths", "top_k", "top_p", "temperature",
            "text_split_method", "batch_size", "batch_threshold",
            "split_bucket", "speed_factor", "fragment_interval",
            "seed", "parallel_infer", "repetition_penalty",
            "sample_steps", "super_sampling", "overlap_length",
            "min_chunk_length"
        ]:
            if key in tts_config:
                params[key] = tts_config[key]
        
        # 强制非流式
        params["streaming_mode"] = False
        
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            return response.content
