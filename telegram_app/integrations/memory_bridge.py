class TelegramMemoryBridge:
    def __init__(self):
        self._initialized_characters: set[str] = set()

    def ensure_character_initialized(self, char_name: str):
        if not char_name or char_name in self._initialized_characters:
            return
        try:
            from services.character_loader import CharacterLoader

            loader = CharacterLoader()
            loader.init_profiles(char_name)
            self._initialized_characters.add(char_name)
        except Exception as e:
            print(f"[TelegramLLM] 角色初始化失败: {e}")

    def get_memory_context(
        self, char_name: str, namespace_key: str, max_snapshots: int
    ) -> str:
        if not char_name:
            return ""
        try:
            from services.memory_service import MemoryService

            mem_svc = MemoryService()
            return mem_svc.get_context_for_prompt(
                char_name=char_name,
                tg_chat_id=None,
                namespace_key=namespace_key,
                max_snapshots=max_snapshots,
            )
        except Exception as e:
            print(f"[TelegramLLM] 获取记忆上下文失败: {e}")
            return ""

    async def process_conversation_snapshot(
        self,
        namespace_key: str,
        mode: str,
        story_id: str,
        primary_character: str,
        messages: list,
        round_count: int,
    ):
        try:
            from services.memory_service import MemoryService

            mem_svc = MemoryService()
            recent = messages[-10:] if len(messages) >= 10 else messages
            round_num = max(1, round_count)
            fingerprint = f"{namespace_key}:{round_num}"

            print(
                f"[TelegramLLM] Trigger memory snapshot namespace={namespace_key} round={round_count}"
            )

            await mem_svc.process_conversation(
                source="telegram",
                source_id=namespace_key,
                context_fingerprint=fingerprint,
                messages=recent,
                speakers=[primary_character],
                parent_fingerprint=None,
                namespace_key=namespace_key,
                mode=mode,
                story_id=story_id,
            )
        except Exception as e:
            print(f"[TelegramLLM] 记忆处理失败: {e}")
