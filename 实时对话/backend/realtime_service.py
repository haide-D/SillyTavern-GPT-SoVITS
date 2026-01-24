# 实时对话服务 - 流式TTS调用

import httpx
from typing import AsyncGenerator, Dict, Optional
import sys
import os

# 添加父目录到路径，以便导入项目配置
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from config import get_sovits_host, load_json, SETTINGS_FILE


class RealtimeService:
    """
    实时对话服务
    
    核心功能:
    1. 流式TTS调用 (streaming_mode=2)
    2. 支持打断 (通过取消请求)
    """
    
    def __init__(self):
        self.sovits_host = get_sovits_host()
        self._current_request: Optional[httpx.Response] = None
    
    async def stream_tts(
        self,
        text: str,
        ref_audio_path: str,
        prompt_text: str = "",
        text_lang: str = "zh",
        prompt_lang: str = "zh"
    ) -> AsyncGenerator[bytes, None]:
        """
        流式TTS生成
        
        Args:
            text: 要合成的文本
            ref_audio_path: 参考音频路径
            prompt_text: 参考音频的提示文本
            text_lang: 文本语言
            prompt_lang: 提示语言
            
        Yields:
            音频数据块 (bytes)
        """
        url = f"{self.sovits_host}/tts"
        
        # 为实时对话优化的参数
        params = {
            "text": text,
            "text_lang": text_lang,
            "ref_audio_path": ref_audio_path,
            "prompt_text": prompt_text,
            "prompt_lang": prompt_lang,
            "text_split_method": "cut0",  # 不切分，由前端控制分段
            "streaming_mode": 2,           # 中等质量，较快响应
            "min_chunk_length": 8,         # 减少音频块大小
            "fragment_interval": 0.1,      # 减少片段间隔
            "parallel_infer": True,
            "speed_factor": 1.0,
        }
        
        print(f"[RealtimeService] 流式TTS请求: text='{text[:30]}...' ")
        print(f"[RealtimeService] 参数: {params}")
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                async with client.stream("GET", url, params=params) as response:
                    self._current_request = response
                    
                    if response.status_code != 200:
                        error = await response.aread()
                        print(f"[RealtimeService] ❌ HTTP错误: {response.status_code}")
                        raise Exception(f"TTS Error: {response.status_code} - {error.decode()}")
                    
                    chunk_count = 0
                    total_bytes = 0
                    
                    async for chunk in response.aiter_bytes(chunk_size=4096):
                        chunk_count += 1
                        total_bytes += len(chunk)
                        yield chunk
                    
                    print(f"[RealtimeService] ✅ 流式完成: {chunk_count}块, {total_bytes}字节")
                    
            except httpx.RequestError as e:
                print(f"[RealtimeService] ❌ 请求失败: {e}")
                raise
            finally:
                self._current_request = None
    
    def cancel(self) -> bool:
        """
        取消当前的TTS请求 (用于打断)
        
        Returns:
            是否成功取消
        """
        if self._current_request:
            print("[RealtimeService] 取消当前请求")
            # httpx的stream会在上下文退出时自动关闭
            self._current_request = None
            return True
        return False
    
    def get_default_ref_audio(self, char_name: str = None) -> Dict:
        """
        获取默认参考音频
        
        Args:
            char_name: 角色名称 (可选)
            
        Returns:
            {path, text} 参考音频信息
        """
        # 加载配置
        settings = load_json(SETTINGS_FILE)
        phone_call_config = settings.get("phone_call", {})
        tts_config = phone_call_config.get("tts_config", {})
        
        # TODO: 根据角色获取参考音频，暂用配置中的默认值
        return {
            "path": tts_config.get("default_ref_audio_path", ""),
            "text": tts_config.get("default_prompt_text", ""),
            "lang": tts_config.get("prompt_lang", "zh")
        }


# 简单测试
if __name__ == "__main__":
    import asyncio
    
    async def test():
        service = RealtimeService()
        print(f"SoVITS Host: {service.sovits_host}")
        
        # 获取默认参考音频
        ref = service.get_default_ref_audio()
        print(f"默认参考音频: {ref}")
    
    asyncio.run(test())
