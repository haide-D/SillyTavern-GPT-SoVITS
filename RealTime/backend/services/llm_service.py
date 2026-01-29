# LLM 服务 - 实时对话后端专用
# 提供流式 LLM 调用功能

import httpx
from typing import Dict, AsyncGenerator, Optional
import json
import sys
import os

# 添加父目录到路径，以便导入项目配置
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))))
from config import load_json, SETTINGS_FILE


class LLMService:
    """实时对话 LLM 服务"""
    
    def __init__(self):
        self._config = None
        self._load_config()
    
    def _load_config(self):
        """从 system_settings.json 加载 LLM 配置"""
        try:
            settings = load_json(SETTINGS_FILE)
            llm_config = settings.get("phone_call", {}).get("llm", {})
            
            self._config = {
                "api_url": llm_config.get("api_url", ""),
                "api_key": llm_config.get("api_key", ""),
                "model": llm_config.get("model", ""),
                "temperature": llm_config.get("temperature", 0.8),
                "max_tokens": llm_config.get("max_tokens", 2048)
            }
            print(f"[LLMService] ✅ 配置已加载: model={self._config['model']}")
        except Exception as e:
            print(f"[LLMService] ❌ 加载配置失败: {e}")
            self._config = {}
    
    def get_config(self) -> Dict:
        """获取当前 LLM 配置"""
        if not self._config:
            self._load_config()
        return self._config
    
    async def call_stream(
        self,
        messages: list,
        config: Optional[Dict] = None
    ) -> AsyncGenerator[str, None]:
        """
        流式调用 LLM API
        
        Args:
            messages: 消息列表 [{"role": "user", "content": "..."}]
            config: 可选的配置覆盖
            
        Yields:
            文本片段 (token)
        """
        cfg = config or self._config
        if not cfg:
            self._load_config()
            cfg = self._config
        
        api_url = cfg.get("api_url", "").strip()
        api_key = cfg.get("api_key", "")
        model = cfg.get("model", "")
        
        if not api_url or not api_key or not model:
            raise ValueError("LLM 配置不完整: api_url, api_key, model")
        
        # 自动添加 /chat/completions 后缀
        if '/chat/completions' not in api_url:
            api_url = api_url.rstrip('/') + '/chat/completions'
        
        request_body = {
            "model": model,
            "messages": messages,
            "temperature": cfg.get("temperature", 0.8),
            "max_tokens": cfg.get("max_tokens", 2048),
            "stream": True
        }
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream"
        }
        
        print(f"[LLMService] 🚀 流式请求: {model}")
        print(f"[LLMService] 📝 消息数: {len(messages)}")
        print(f"[LLMService] ════════════ LLM 请求详情 ════════════")
        print(f"[LLMService] API URL: {api_url}")
        print(f"[LLMService] Model: {model}")
        print(f"[LLMService] Temperature: {cfg.get('temperature', 0.8)}")
        print(f"[LLMService] Max Tokens: {cfg.get('max_tokens', 2048)}")
        print(f"[LLMService] ──────────── Messages ────────────")
        for i, msg in enumerate(messages):
            role = msg.get('role', 'unknown')
            content = msg.get('content', '')
            # 限制每条消息的显示长度
            content_preview = content[:500] + '...' if len(content) > 500 else content
            print(f"[LLMService] [{i}] {role}:")
            for line in content_preview.split('\n'):
                print(f"[LLMService]     {line}")
        print(f"[LLMService] ════════════════════════════════════")

        
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                api_url,
                headers=headers,
                json=request_body
            ) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    raise Exception(f"LLM API 错误 {response.status_code}: {error_text.decode()[:200]}")
                
                # 解析 SSE 流
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    
                    if line.startswith("data: "):
                        data = line[6:]
                        
                        if data == "[DONE]":
                            break
                        
                        try:
                            chunk = json.loads(data)
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            content = delta.get("content", "")
                            
                            if content:
                                yield content
                                
                        except json.JSONDecodeError:
                            continue
        
        print(f"[LLMService] ✅ 流式完成")


# 单例实例
_llm_service = None

def get_llm_service() -> LLMService:
    """获取 LLM 服务单例"""
    global _llm_service
    if _llm_service is None:
        _llm_service = LLMService()
    return _llm_service
