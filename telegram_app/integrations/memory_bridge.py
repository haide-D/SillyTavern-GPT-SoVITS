import asyncio


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
        memory_interval: int = 10,
    ):
        """后台执行记忆总结，带重试机制。"""
        # 动态计算消息窗口：memory_interval × 4，下限 20、上限 80
        window = max(20, min(80, memory_interval * 4))
        recent = messages[-window:] if len(messages) >= window else messages

        # 从消息中提取所有说话人
        speakers = list(
            {
                m.get("character_name") or m.get("sender_display_name") or ""
                for m in recent
                if (m.get("character_name") or m.get("sender_display_name"))
            }
        )
        if not speakers:
            speakers = [primary_character]

        round_num = max(1, round_count)
        fingerprint = f"{namespace_key}:{round_num}"

        print(
            f"[TelegramLLM] Trigger memory snapshot namespace={namespace_key} "
            f"round={round_count} window={len(recent)}"
        )

        max_retries = 2
        for attempt in range(1, max_retries + 1):
            try:
                from services.memory_service import MemoryService

                mem_svc = MemoryService()
                result = await mem_svc.process_conversation(
                    source="telegram",
                    source_id=namespace_key,
                    context_fingerprint=fingerprint,
                    messages=recent,
                    speakers=speakers,
                    parent_fingerprint=None,
                    namespace_key=namespace_key,
                    mode=mode,
                    story_id=story_id,
                )
                if result.get("success"):
                    return  # 成功，退出
                # LLM 返回但解析失败等情况
                error = result.get("error", "unknown")
                print(
                    f"[TelegramLLM] 记忆总结未成功 (attempt {attempt}/{max_retries}): {error}"
                )
            except Exception as e:
                print(
                    f"[TelegramLLM] 记忆总结异常 (attempt {attempt}/{max_retries}): {e}"
                )

            if attempt < max_retries:
                await asyncio.sleep(3)

        print(f"[TelegramLLM] 记忆总结最终失败，已耗尽 {max_retries} 次重试")
