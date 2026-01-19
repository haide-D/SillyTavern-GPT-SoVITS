import requests
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
            "streaming_mode": "false"  # 明确关闭流式
        }
        
        # 添加语速参数(如果指定)
        if segment.speed is not None:
            params["speed_factor"] = segment.speed
            print(f"[TTSService] 使用语速: {segment.speed}x")
        
        print(f"[TTSService] 调用 SoVITS: {url}")
        print(f"[TTSService] 参数: text={params['text'][:30]}..., ref_audio={ref_audio['path']}")
        print(f"[TTSService] 完整参数: {params}")
        
        try:
            # 使用 requests 而不是 httpx,与 tts_proxy 保持一致
            response = requests.get(url, params=params, timeout=120)
            
            if response.status_code != 200:
                print(f"[TTSService] ❌ HTTP错误: {response.status_code}")
                print(f"[TTSService] 错误详情: {response.text[:500]}")
                raise Exception(f"SoVITS Error: {response.status_code}")
            
            print(f"[TTSService] ✅ 音频生成成功: {len(response.content)} 字节")
            return response.content
            
        except requests.exceptions.RequestException as e:
            print(f"[TTSService] ❌ 请求失败: {e}")
            raise
