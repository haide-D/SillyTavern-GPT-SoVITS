import time
import httpx
from typing import List, Dict
from telegram_utils.memory_manager import MemoryManager
from config import load_json, SETTINGS_FILE


class TelegramLLMHandler:
    """处理 Telegram 的 LLM 请求和 Prompt 组装"""
    def __init__(self, memory_manager: MemoryManager):
        self.memory = memory_manager
        self._char_initialized = False
        self._round_counter: Dict[str, int] = {}  # chat_id -> 轮次计数
        
    def _get_config(self) -> dict:
        settings = load_json(SETTINGS_FILE)
        return settings.get("telegram", {})
    
    def _ensure_character_init(self, char_name: str):
        """确保角色画像已初始化（只执行一次）"""
        if self._char_initialized or not char_name:
            return
        try:
            from services.character_loader import CharacterLoader
            loader = CharacterLoader()
            loader.init_profiles(char_name)
            self._char_initialized = True
        except Exception as e:
            print(f"[TelegramLLM] 角色初始化失败: {e}")
        
    async def generate_reply(self, chat_id: str, user_text: str) -> str:
        config = self._get_config()
        llm_config = config.get("llm", {})
        
        api_url = llm_config.get("api_url")
        api_key = llm_config.get("api_key")
        model = llm_config.get("model")
        
        if not api_url or not api_key:
            raise ValueError("Telegram 的 LLM 未配置 (api_url, api_key 缺失)")
            
        api_url = api_url.strip()
        if '/chat/completions' not in api_url:
            api_url = api_url.rstrip('/') + '/chat/completions'

        # 0. 确保角色画像已初始化
        char_name = config.get("character", "")
        self._ensure_character_init(char_name)

        # 1. 记录用户消息
        self.memory.add_message(chat_id, "user", user_text)
        
        # 2. 从 MemoryService 获取记忆上下文
        memory_context = ""
        if char_name:
            try:
                from services.memory_service import MemoryService
                mem_svc = MemoryService()
                memory_context = mem_svc.get_context_for_prompt(
                    char_name=char_name,
                    tg_chat_id=str(chat_id)
                )
            except Exception as e:
                print(f"[TelegramLLM] 获取记忆上下文失败: {e}")
        
        # 3. 组装 system prompt
        base_prompt = llm_config.get("system_prompt", "你是一个聊天助理。")
        
        if memory_context:
            system_prompt = f"""{base_prompt}

以下是你的记忆和人设信息，请在回复时参考：

{memory_context}"""
        else:
            system_prompt = base_prompt
        
        # 4. 组装最终 messages
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(self.memory.get_messages(chat_id))
        
        payload = {
            "model": model,
            "messages": messages,
            "temperature": llm_config.get("temperature", 0.8),
            "max_tokens": llm_config.get("max_tokens", 2000),
            "stream": False
        }
        
        print(f"[TelegramLLM] 请求 LLM: URL={api_url}, 模型={model}")
        if memory_context:
            print(f"[TelegramLLM] 📚 注入了 {len(memory_context)} 字符的记忆上下文")
        
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
                
                # 5. 检查是否需要触发记忆处理（每 10 轮）
                await self._check_memory_trigger(chat_id, char_name)
                
                return content
            return ""
    
    async def _check_memory_trigger(self, chat_id: str, char_name: str):
        """检查是否需要触发记忆快照（每 10 轮对话）"""
        if not char_name:
            return
            
        history = self.memory.get_messages(chat_id)
        if len(history) > 0 and len(history) % 10 == 0:
            try:
                from services.memory_service import MemoryService
                from database import DatabaseManager
                
                mem_svc = MemoryService()
                db = DatabaseManager()
                
                # 取最近 10 条消息
                recent = history[-10:]
                round_num = len(history) // 10
                
                # 生成 TG 专用指纹
                fingerprint = f"tg_{chat_id}_{round_num}"
                
                # 查找最新的酒馆指纹作为 parent
                parent_fp = db.get_latest_tavern_fingerprint()
                
                print(f"[TelegramLLM] 🧠 触发记忆处理 (第 {len(history)} 轮, parent_fp={parent_fp})")
                
                await mem_svc.process_conversation(
                    source="telegram",
                    source_id=str(chat_id),
                    context_fingerprint=fingerprint,
                    messages=recent,
                    speakers=[char_name],
                    parent_fingerprint=parent_fp
                )
            except Exception as e:
                print(f"[TelegramLLM] 记忆处理失败: {e}")
