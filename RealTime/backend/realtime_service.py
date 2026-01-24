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
    3. 预热机制 (warmup) - 提前加载参考音频，减少首次请求延迟
    4. 参考音频切换 (switch_ref_audio) - 支持角色切换
    """
    
    def __init__(self):
        self.sovits_host = get_sovits_host()
        print(f"[RealtimeService] 🔧 初始化，sovits_host = {self.sovits_host}")
        self._current_request: Optional[httpx.Response] = None
        
        # 当前参考音频状态（用于跟踪是否需要重新预热）
        self._current_ref_audio: Dict = {
            "path": None,
            "text": None,
            "lang": None,
            "is_warmed_up": False
        }
    
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
        流式TTS生成
        
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
        url = f"{self.sovits_host}/tts"
        
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
            "min_chunk_length": 16,
            "fragment_interval": 0.3,
            "parallel_infer": True,
            "speed_factor": 1.0,
        }
        
        print(f"[RealtimeService] 🔊 流式TTS请求 (首块优化: {is_first_chunk}, 切分: {text_split_method})")
        print(f"[RealtimeService] 📝 文本: '{text[:50]}...' (长度: {len(text)})")
        print(f"[RealtimeService] 🔗 URL: {url}")
        print(f"[RealtimeService] 📋 参数详情:")
        for k, v in params.items():
            val_str = str(v)[:80] if len(str(v)) > 80 else str(v)
            print(f"[RealtimeService]   - {k}: {val_str}")
        
        # 专门打印完整的 ref_audio_path（不截断）
        print(f"[RealtimeService] 🔊 完整 ref_audio_path: {params.get('ref_audio_path', 'N/A')}")
        
        # 使用 requests 库的流式传输
        import requests
        
        try:
            print(f"[RealtimeService] 🚀 发送流式请求...")
            
            # 使用 stream=True 实现流式传输
            r = requests.get(url, params=params, stream=True, timeout=120)
            
            print(f"[RealtimeService] 📥 响应状态: {r.status_code}")
            print(f"[RealtimeService] 📥 Content-Type: {r.headers.get('content-type', 'N/A')}")
            
            if r.status_code != 200:
                error_text = r.text
                print(f"[RealtimeService] ❌ HTTP错误: {r.status_code}")
                print(f"[RealtimeService] ❌ 错误内容: {error_text[:500]}")
                raise Exception(f"TTS Error: {r.status_code} - {error_text}")
            
            # 流式传输：逐块读取音频数据
            chunk_count = 0
            total_bytes = 0
            first_chunk_logged = False
            
            for chunk in r.iter_content(chunk_size=4096):
                if chunk:  # 过滤掉 keep-alive 的空块
                    chunk_count += 1
                    total_bytes += len(chunk)
                    
                    # 记录第一个块的头部，用于诊断
                    if not first_chunk_logged and len(chunk) > 4:
                        header_str = chunk[:4].decode('latin-1', errors='replace')
                        print(f"[RealtimeService] 🎵 首块头部: '{header_str}' (期望: 'RIFF')")
                        first_chunk_logged = True
                    
                    yield chunk
            
            print(f"[RealtimeService] ✅ 流式完成: {chunk_count}块, {total_bytes}字节")
                
        except requests.exceptions.RequestException as e:
            print(f"[RealtimeService] ❌ 请求失败: {type(e).__name__}: {e}")
            raise
    
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
    
    def warmup(
        self, 
        ref_audio_path: str = None, 
        prompt_text: str = None, 
        prompt_lang: str = None,
        force: bool = False
    ) -> Dict:
        """
        预热 GPT-SoVITS 模型
        
        通过发送一个短文本请求，让 GPT-SoVITS 的 prompt_cache 提前缓存参考音频特征。
        预热完成后，后续使用相同参考音频的请求将大幅减少延迟（从 ~3s 降至 ~0.3s）。
        
        Args:
            ref_audio_path: 参考音频路径（可选，默认使用配置中的值）
            prompt_text: 提示文本（可选，默认使用配置中的值）
            prompt_lang: 提示语言（可选，默认使用配置中的值）
            force: 是否强制重新预热（即使已预热过相同参考音频）
            
        Returns:
            {success, message, ref_audio_path, elapsed_ms}
        """
        import requests
        import time
        
        # 如果未指定参数，使用默认配置
        if ref_audio_path is None or prompt_text is None or prompt_lang is None:
            default_ref = self.get_default_ref_audio()
            ref_audio_path = ref_audio_path or default_ref["path"]
            prompt_text = prompt_text or default_ref["text"]
            prompt_lang = prompt_lang or default_ref["lang"]
        
        # 检查是否需要预热
        if not force and self._current_ref_audio["is_warmed_up"]:
            if (self._current_ref_audio["path"] == ref_audio_path and
                self._current_ref_audio["text"] == prompt_text):
                print(f"[RealtimeService] ⏩ 跳过预热，参考音频已缓存")
                return {
                    "success": True,
                    "message": "已预热，无需重复",
                    "ref_audio_path": ref_audio_path,
                    "elapsed_ms": 0,
                    "skipped": True
                }
        
        print(f"[RealtimeService] 🔥 开始预热...")
        print(f"[RealtimeService]   ref_audio_path: {ref_audio_path}")
        print(f"[RealtimeService]   prompt_text: {prompt_text[:50]}..." if len(prompt_text) > 50 else f"[RealtimeService]   prompt_text: {prompt_text}")
        
        # 发送一个短文本请求，触发 GPT-SoVITS 的 prompt_cache 构建
        params = {
            "text": "预热测试。",  # 短文本，用于触发缓存
            "text_lang": prompt_lang,
            "ref_audio_path": ref_audio_path,
            "prompt_text": prompt_text,
            "prompt_lang": prompt_lang,
            "streaming_mode": 0,  # 非流式，减少开销
            "text_split_method": "cut0",
        }
        
        url = f"{self.sovits_host}/tts"
        start_time = time.perf_counter()
        
        try:
            response = requests.get(url, params=params, timeout=60)
            elapsed_ms = int((time.perf_counter() - start_time) * 1000)
            
            if response.status_code == 200:
                # 更新当前参考音频状态
                self._current_ref_audio = {
                    "path": ref_audio_path,
                    "text": prompt_text,
                    "lang": prompt_lang,
                    "is_warmed_up": True
                }
                print(f"[RealtimeService] ✅ 预热完成！耗时: {elapsed_ms}ms")
                return {
                    "success": True,
                    "message": f"预热成功，耗时 {elapsed_ms}ms",
                    "ref_audio_path": ref_audio_path,
                    "elapsed_ms": elapsed_ms,
                    "skipped": False
                }
            else:
                error_msg = response.text[:200] if response.text else f"HTTP {response.status_code}"
                print(f"[RealtimeService] ⚠️ 预热失败: {error_msg}")
                return {
                    "success": False,
                    "message": f"预热失败: {error_msg}",
                    "ref_audio_path": ref_audio_path,
                    "elapsed_ms": elapsed_ms,
                    "skipped": False
                }
                
        except requests.exceptions.RequestException as e:
            elapsed_ms = int((time.perf_counter() - start_time) * 1000)
            print(f"[RealtimeService] ❌ 预热异常: {e}")
            return {
                "success": False,
                "message": f"预热异常: {str(e)}",
                "ref_audio_path": ref_audio_path,
                "elapsed_ms": elapsed_ms,
                "skipped": False
            }
    
    def switch_ref_audio(
        self,
        ref_audio_path: str,
        prompt_text: str,
        prompt_lang: str = "zh",
        auto_warmup: bool = True
    ) -> Dict:
        """
        切换参考音频（用于角色切换）
        
        Args:
            ref_audio_path: 新的参考音频路径
            prompt_text: 新的提示文本
            prompt_lang: 新的提示语言
            auto_warmup: 是否自动预热（默认 True）
            
        Returns:
            {success, message, warmup_result}
        """
        print(f"[RealtimeService] 🔄 切换参考音频...")
        print(f"[RealtimeService]   新路径: {ref_audio_path}")
        
        # 标记旧缓存失效
        old_path = self._current_ref_audio.get("path")
        self._current_ref_audio["is_warmed_up"] = False
        
        result = {
            "success": True,
            "message": "参考音频已切换",
            "old_path": old_path,
            "new_path": ref_audio_path,
            "warmup_result": None
        }
        
        # 自动预热
        if auto_warmup:
            warmup_result = self.warmup(ref_audio_path, prompt_text, prompt_lang, force=True)
            result["warmup_result"] = warmup_result
            result["success"] = warmup_result["success"]
            if warmup_result["success"]:
                result["message"] = f"参考音频已切换并预热 ({warmup_result['elapsed_ms']}ms)"
            else:
                result["message"] = f"参考音频已切换，但预热失败: {warmup_result['message']}"
        
        return result
    
    def get_warmup_status(self) -> Dict:
        """
        获取当前预热状态
        
        Returns:
            {is_warmed_up, ref_audio_path, prompt_text, prompt_lang}
        """
        return {
            "is_warmed_up": self._current_ref_audio["is_warmed_up"],
            "ref_audio_path": self._current_ref_audio["path"],
            "prompt_text": self._current_ref_audio["text"],
            "prompt_lang": self._current_ref_audio["lang"]
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
