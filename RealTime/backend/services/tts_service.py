# TTS 服务 - 核心流式 TTS 调用

from typing import AsyncGenerator, Optional
import httpx

from .config_service import ConfigService


class TTSService:
    """
    TTS 服务
    
    核心功能：
    1. 流式 TTS 调用 (streaming_mode=2)
    2. 支持打断 (通过取消请求)
    """
    
    def __init__(self, config_service: ConfigService):
        self.config = config_service
        self._current_request: Optional[httpx.Response] = None
        print(f"[TTSService] 初始化完成")
    
    @property
    def sovits_host(self) -> str:
        """获取 GPT-SoVITS 服务地址"""
        return self.config.sovits_host
    
    async def stream_tts(
        self,
        text: str,
        ref_audio_path: str,
        prompt_text: str = "",
        text_lang: str = "zh",
        prompt_lang: str = "zh",
        is_first_chunk: bool = False
    ) -> AsyncGenerator[bytes, None]:
        """
        流式 TTS 生成
        
        Args:
            text: 要合成的文本
            ref_audio_path: 参考音频路径
            prompt_text: 参考音频的提示文本
            text_lang: 文本语言
            prompt_lang: 提示语言
            is_first_chunk: 是否是第一个文本块（用于首包优化）
            
        Yields:
            音频数据块 (bytes)
        """
        url = f"{self.config.sovits_host}/tts"
        
        # 为实时对话优化的参数
        # 第一个文本块使用 cut5 切分（按逗号、句号等停顿符切分），让 GPT-SoVITS 更快返回首个音频
        # 后续文本块使用 cut0（不切分），因为前端已经做了合理分段
        text_split_method = "cut5" if is_first_chunk else "cut0"
        
        params = {
            "text": text,
            "text_lang": text_lang,
            "ref_audio_path": ref_audio_path,
            "prompt_text": prompt_text,
            "prompt_lang": prompt_lang,
            "text_split_method": text_split_method,
            # streaming_mode: 0=禁用, 1=分段返回(慢), 2=流式推理(推荐), 3=快速流式(质量稍低)
            "streaming_mode": 2,  # 流式推理模式（推荐）
            "min_chunk_length": 8,   # 降低以加速首包
            "fragment_interval": 0.2, # 降低以加速首包
            "parallel_infer": False,  # 与 streaming_mode=2 冲突，必须关闭
            "speed_factor": 1.0,
        }
        
        print(f"[TTSService] 🔊 流式TTS请求 (首块优化: {is_first_chunk}, 切分: {text_split_method})")
        print(f"[TTSService] 📝 文本: '{text[:50]}...' (长度: {len(text)})")
        print(f"[TTSService] 🔗 URL: {url}")
        print(f"[TTSService] 📋 参数详情:")
        for k, v in params.items():
            val_str = str(v)[:80] if len(str(v)) > 80 else str(v)
            print(f"[TTSService]   - {k}: {val_str}")
        
        # 专门打印完整的 ref_audio_path（不截断）
        print(f"[TTSService] 🔊 完整 ref_audio_path: {params.get('ref_audio_path', 'N/A')}")
        
        # 使用 httpx 异步流式传输（不阻塞事件循环）
        try:
            print(f"[TTSService] 🚀 发送流式请求...")
            
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream("GET", url, params=params) as r:
                    print(f"[TTSService] 📥 响应状态: {r.status_code}")
                    print(f"[TTSService] 📥 Content-Type: {r.headers.get('content-type', 'N/A')}")
                    
                    if r.status_code != 200:
                        error_text = await r.aread()
                        print(f"[TTSService] ❌ HTTP错误: {r.status_code}")
                        raise Exception(f"TTS Error: {r.status_code} - {error_text[:500]}")
                    
                    chunk_count = 0
                    total_bytes = 0
                    first_chunk_logged = False
                    
                    async for chunk in r.aiter_bytes(chunk_size=4096):
                        if chunk:
                            chunk_count += 1
                            total_bytes += len(chunk)
                            
                            if not first_chunk_logged and len(chunk) > 4:
                                header_str = chunk[:4].decode('latin-1', errors='replace')
                                print(f"[TTSService] 🎵 首块头部: '{header_str}' (期望: 'RIFF')")
                                first_chunk_logged = True
                            
                            yield chunk
                    
                    print(f"[TTSService] ✅ 流式完成: {chunk_count}块, {total_bytes}字节")
                
        except httpx.RequestError as e:
            print(f"[TTSService] ❌ 请求失败: {type(e).__name__}: {e}")
            raise
    
    def cancel(self) -> bool:
        """
        取消当前的 TTS 请求 (用于打断)
        
        Returns:
            是否成功取消
        """
        if self._current_request:
            print("[TTSService] 取消当前请求")
            # httpx 的 stream 会在上下文退出时自动关闭
            self._current_request = None
            return True
        return False
