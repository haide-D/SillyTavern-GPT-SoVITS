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
        
    async def generate_reply(self, chat_id: str, user_text: str, 
                             speaker_name: str = None, speaker_id: str = None, 
                             chat_type: str = "private") -> str:
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
        if chat_type in ['group', 'supergroup'] and speaker_name:
            user_text_record = f"【对你讲话】[{speaker_name}]: {user_text}"
        else:
            user_text_record = user_text
            
        self.memory.add_message(chat_id, "user", user_text_record, speaker_name=speaker_name, speaker_id=speaker_id)
        
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
        
        from telegram_utils.prompt_builder import PromptBuilder
        system_prompt = PromptBuilder.build_system_prompt(base_prompt, memory_context)
        
        # 3.5 动态拼接多用户与环境系统设定
        from telegram_utils.user_manager import user_manager
        
        history_messages = self.memory.get_messages(chat_id)
        active_uids = list(set([m.get("speaker_id") for m in history_messages if m.get("speaker_id")]))
        active_personas = user_manager.get_active_personas_in_chat(chat_id, active_uids)
        
        group_context = ""
        if chat_type in ['group', 'supergroup']:
            group_context += "\n\n============== 【当前系统动态环境】 ==============\n"
            group_context += "当前场景：这是一个【多人群组聊天室】。\n"
            group_context += "请务必通过用户言论最前端的 `[群友名字]:` 标签来分辨不同的群友，不要认错人。\n"
            if active_personas:
                group_context += "\n以下是本群当前活跃成员的真实人设信息：\n"
                for name, p in active_personas.items():
                    group_context += f"- [{name}]: {p}\n"
            
            if speaker_name:
                group_context += f"\n👉 【高优先级提示】：此刻刚刚对你讲最后一句活、正等着你回话的人是 [{speaker_name}]。请主要对 Ta 作出回应。\n"
            group_context += "==================================================\n"
        else:
            group_context += "\n\n============== 【当前系统动态环境】 ==============\n"
            group_context += "当前场景：这是你与用户的一对一【私密聊天房间】。\n"
            if speaker_id:
                persona = user_manager.get_user_persona(speaker_id)
                if persona:
                    group_context += f"\n【警告】当前与你私聊的用户给自己设定的专属人设是：\n{persona}\n请务必结合此核心人设给予针对性的反应和对待方式！\n"
            group_context += "==================================================\n"
            
        system_prompt += group_context
        
        # 4. 组装最终 messages
        messages = [{"role": "system", "content": system_prompt}]
        # 传递给 LLM 时去除无用的附加数据，保障兼容性
        # 并合并连续的相同角色消息（防止某些 LLM API 严格校验交替发言而丢弃旁听群聊消息）
        clean_history = []
        for m in history_messages:
            if clean_history and clean_history[-1]["role"] == m["role"]:
                clean_history[-1]["content"] += f"\n\n{m['content']}"
            else:
                clean_history.append({"role": m["role"], "content": m["content"]})
                
        messages.extend(clean_history)
        
        payload = {
            "model": model,
            "messages": messages,
            "temperature": llm_config.get("temperature", 0.8),
            "max_tokens": llm_config.get("max_tokens", 2000),
            "stream": False
        }
        
        print("\n" + "="*60)
        print("【Telegram LLM 请求调试信息】")
        print(f"🔗 URL: {api_url} | 🤖 Model: {model}")
        if memory_context:
            print(f"📚 记忆上下文: 已注入 {len(memory_context)} 字符")
        print("-" * 60)
        print("【System Prompt】\n")
        print(system_prompt)
        print("\n" + "-" * 60)
        print("【聊天历史 (Chat History)】\n")
        for msg in messages[1:]:
            role = msg.get("role", "unknown").upper()
            text = msg.get("content", "")
            # 为了防止内容过长单行挤在一起，打印时自动带上换行
            print(f"[{role}]: {text}\n")
        print("="*60 + "\n")
        
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
            
        # 更新并获取该 chat_id 的历史总轮次计数
        self._round_counter[chat_id] = self._round_counter.get(chat_id, 0) + 1
        current_round = self._round_counter[chat_id]
        
        history = self.memory.get_messages(chat_id)
        # 每确切的第 10 轮触发一次
        if current_round > 0 and current_round % 10 == 0:
            try:
                from services.memory_service import MemoryService
                from database import DatabaseManager
                
                mem_svc = MemoryService()
                db = DatabaseManager()
                
                # 取最近 10 条消息作为分析切片
                recent = history[-10:] if len(history) >= 10 else history
                round_num = current_round // 10
                
                # 生成 TG 专用指纹
                fingerprint = f"tg_{chat_id}_{round_num}"
                
                # 查找最新的酒馆指纹作为 parent
                parent_fp = db.get_latest_tavern_fingerprint()
                
                print(f"[TelegramLLM] 🧠 触发记忆处理 (累积第 {current_round} 轮, parent_fp={parent_fp})")
                
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
