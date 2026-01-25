# 预热服务 - GPT-SoVITS 模型预热和参考音频切换

import time
import requests
from typing import Dict

from .config_service import ConfigService


class WarmupService:
    """
    预热服务
    
    负责 GPT-SoVITS 模型预热和参考音频切换：
    1. warmup() - 通过短文本请求预热模型，减少首次请求延迟
    2. switch_ref_audio() - 切换参考音频（角色切换时使用）
    3. get_warmup_status() - 获取当前预热状态
    """
    
    def __init__(self, config_service: ConfigService):
        self.config = config_service
        
        # 当前参考音频状态（用于跟踪是否需要重新预热）
        self._current_ref_audio: Dict = {
            "path": None,
            "text": None,
            "lang": None,
            "is_warmed_up": False
        }
        print(f"[WarmupService] 初始化完成")
    
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
            {success, message, ref_audio_path, elapsed_ms, skipped}
        """
        # 如果未指定参数，使用默认配置
        if ref_audio_path is None or prompt_text is None or prompt_lang is None:
            default_ref = self.config.get_default_ref_audio()
            ref_audio_path = ref_audio_path or default_ref["path"]
            prompt_text = prompt_text or default_ref["text"]
            prompt_lang = prompt_lang or default_ref["lang"]
        
        # 检查是否需要预热
        if not force and self._current_ref_audio["is_warmed_up"]:
            if (self._current_ref_audio["path"] == ref_audio_path and
                self._current_ref_audio["text"] == prompt_text):
                print(f"[WarmupService] ⏩ 跳过预热，参考音频已缓存")
                return {
                    "success": True,
                    "message": "已预热，无需重复",
                    "ref_audio_path": ref_audio_path,
                    "elapsed_ms": 0,
                    "skipped": True
                }
        
        print(f"[WarmupService] 🔥 开始预热...")
        print(f"[WarmupService]   ref_audio_path: {ref_audio_path}")
        print(f"[WarmupService]   prompt_text: {prompt_text[:50]}..." if len(prompt_text) > 50 else f"[WarmupService]   prompt_text: {prompt_text}")
        
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
        
        url = f"{self.config.sovits_host}/tts"
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
                print(f"[WarmupService] ✅ 预热完成！耗时: {elapsed_ms}ms")
                return {
                    "success": True,
                    "message": f"预热成功，耗时 {elapsed_ms}ms",
                    "ref_audio_path": ref_audio_path,
                    "elapsed_ms": elapsed_ms,
                    "skipped": False
                }
            else:
                error_msg = response.text[:200] if response.text else f"HTTP {response.status_code}"
                print(f"[WarmupService] ⚠️ 预热失败: {error_msg}")
                return {
                    "success": False,
                    "message": f"预热失败: {error_msg}",
                    "ref_audio_path": ref_audio_path,
                    "elapsed_ms": elapsed_ms,
                    "skipped": False
                }
                
        except requests.exceptions.RequestException as e:
            elapsed_ms = int((time.perf_counter() - start_time) * 1000)
            print(f"[WarmupService] ❌ 预热异常: {e}")
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
            {success, message, old_path, new_path, warmup_result}
        """
        print(f"[WarmupService] 🔄 切换参考音频...")
        print(f"[WarmupService]   新路径: {ref_audio_path}")
        
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
