class TelegramMemoryBridge:
    def __init__(self):
        self._char_initialized = False

    def ensure_character_initialized(self, char_name: str):
        if self._char_initialized or not char_name:
            return
        try:
            from services.character_loader import CharacterLoader

            loader = CharacterLoader()
            loader.init_profiles(char_name)
            self._char_initialized = True
        except Exception as e:
            print(f"[TelegramLLM] 角色初始化失败: {e}")

    def get_memory_context(self, char_name: str, chat_id: str) -> str:
        if not char_name:
            return ""
        try:
            from services.memory_service import MemoryService

            mem_svc = MemoryService()
            return mem_svc.get_context_for_prompt(
                char_name=char_name, tg_chat_id=str(chat_id)
            )
        except Exception as e:
            print(f"[TelegramLLM] 获取记忆上下文失败: {e}")
            return ""

    async def process_conversation_snapshot(
        self,
        chat_id: str,
        char_name: str,
        messages: list,
        round_count: int,
    ):
        try:
            from services.memory_service import MemoryService
            from database import DatabaseManager

            mem_svc = MemoryService()
            db = DatabaseManager()

            recent = messages[-10:] if len(messages) >= 10 else messages
            round_num = round_count // 10
            fingerprint = f"tg_{chat_id}_{round_num}"
            parent_fp = db.get_latest_tavern_fingerprint()

            print(
                f"[TelegramLLM] 🧠 触发记忆处理 (累积第 {round_count} 轮, parent_fp={parent_fp})"
            )

            await mem_svc.process_conversation(
                source="telegram",
                source_id=str(chat_id),
                context_fingerprint=fingerprint,
                messages=recent,
                speakers=[char_name],
                parent_fingerprint=parent_fp,
            )
        except Exception as e:
            print(f"[TelegramLLM] 记忆处理失败: {e}")
