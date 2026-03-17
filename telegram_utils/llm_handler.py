import httpx
from typing import List, Dict
from telegram_utils.memory_manager import MemoryManager
from config import load_json, SETTINGS_FILE

class TelegramLLMHandler:
    """处理 Telegram 的 LLM 请求和 Prompt 组装"""
    def __init__(self, memory_manager: MemoryManager):
        self.memory = memory_manager
        
    def _get_config(self) -> dict:
        settings = load_json(SETTINGS_FILE)
        return settings.get("telegram", {})
        
    async def generate_reply(self, chat_id: str, user_text: str) -> str:
        config = self._get_config()
        llm_config = config.get("llm", {})
        
        api_url = llm_config.get("api_url")
        api_key = llm_config.get("api_key")
        model = llm_config.get("model")
        system_prompt = llm_config.get("system_prompt", "你是一个聊天助理。")
        
        if not api_url or not api_key:
            raise ValueError("Telegram 的 LLM 未配置 (api_url, api_key 缺失)")
            
        api_url = api_url.strip()
        if '/chat/completions' not in api_url:
            api_url = api_url.rstrip('/') + '/chat/completions'

        # 1. 记录用户消息
        self.memory.add_message(chat_id, "user", user_text)
        
        # 2. [预留] 构建增强语境 (世界书、短摘要等) 
        wb_context = await self.memory.inject_worldbook(chat_id, user_text)
        mem_context = await self.memory.recall_memory(chat_id, user_text)
        
        # 3. 组装最终 messages
        messages = [{"role": "system", "content": system_prompt}]
        
        if wb_context or mem_context:
            # P2/P3: 这里可以将额外上下文以 user/system 身份插入
            pass
            
        messages.extend(self.memory.get_messages(chat_id))
        
        payload = {
            "model": model,
            "messages": messages,
            "temperature": llm_config.get("temperature", 0.8),
            "max_tokens": llm_config.get("max_tokens", 2000),
            "stream": False
        }
        
        print(f"[TelegramLLM] 请求 LLM: URL={api_url}, 模型={model}")
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            response = await client.post(api_url, json=payload, headers=headers)
            response.raise_for_status()
            
            data = response.json()
            content = ""
            
            if data.get("choices") and len(data["choices"]) > 0:
                message = data["choices"][0].get("message", {})
                content = message.get("content", "").strip()
                
            if content:
                self.memory.add_message(chat_id, "assistant", content)
                return content
            return ""
