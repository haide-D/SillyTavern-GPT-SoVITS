import json
from typing import List, Optional

from telegram_app.domain.history import SessionHistoryRepository
from telegram_app.domain.models import InboundMessage, OutboundMessage, ReactionEvent
from telegram_app.domain.policies import RoundCounter, should_trigger_memory
from telegram_app.integrations.llm_client import TelegramLlmClient
from telegram_app.integrations.memory_bridge import TelegramMemoryBridge
from telegram_app.integrations.prompt_builder import PromptBuilder
from telegram_app.integrations.response_parser import LlmResponseParser
from telegram_app.integrations.tool_schemas import get_chat_tools
from telegram_app.integrations.user_repository import TelegramUserRepository
from telegram_app.settings import get_telegram_settings


class TelegramConversationService:
    def __init__(
        self,
        history_repo: SessionHistoryRepository,
        user_repo: TelegramUserRepository,
        memory_bridge: TelegramMemoryBridge,
        llm_client: TelegramLlmClient,
        response_parser: LlmResponseParser,
        round_counter: Optional[RoundCounter] = None,
        settings_provider=get_telegram_settings,
    ):
        self._history = history_repo
        self._users = user_repo
        self._memory = memory_bridge
        self._llm_client = llm_client
        self._parser = response_parser
        self._round_counter = round_counter or RoundCounter()
        self._settings_provider = settings_provider

    async def handle_text(self, inbound: InboundMessage) -> List[OutboundMessage]:
        settings = self._settings_provider()

        if not settings.llm_api_url or not settings.llm_api_key:
            raise ValueError("Telegram 的 LLM 未配置 (api_url, api_key 缺失)")

        char_name = settings.character
        self._memory.ensure_character_initialized(char_name)

        if inbound.is_group and inbound.user_display_name:
            user_text_record = (
                f"【对你讲话】[{inbound.user_display_name}]: {inbound.text}"
            )
        else:
            user_text_record = inbound.text

        self._history.add_message(
            inbound.chat_id,
            "user",
            user_text_record,
            speaker_name=inbound.user_display_name,
            speaker_id=inbound.user_id,
        )

        memory_context = self._memory.get_memory_context(char_name, inbound.chat_id)

        base_prompt = settings.llm_system_prompt

        available_emotions = []
        try:
            from services.emotion_service import EmotionService

            available_emotions = EmotionService.get_available_emotions(char_name)
        except Exception as e:
            print(f"[TelegramLLM] 获取情绪列表失败: {e}")

        emotions_str = (
            "、".join(available_emotions) if available_emotions else "default"
        )
        system_prompt = PromptBuilder.build_system_prompt(
            base_prompt, memory_context, emotions_str
        )

        history_messages = self._history.get_messages(inbound.chat_id)
        active_uids = list(
            {m.get("speaker_id") for m in history_messages if m.get("speaker_id")}
        )
        active_personas = self._users.get_active_personas_in_chat(
            inbound.chat_id, active_uids
        )

        group_context = ""
        if inbound.is_group:
            group_context += "\n\n============== 【当前系统动态环境】 ==============\n"
            group_context += "当前场景：这是一个【多人群组聊天室】。\n"
            group_context += "请务必通过用户言论最前端的 `[群友名字]:` 标签来分辨不同的群友，不要认错人。\n"
            if active_personas:
                group_context += "\n以下是本群当前活跃成员的真实人设信息：\n"
                for name, persona in active_personas.items():
                    group_context += f"- [{name}]: {persona}\n"

            if inbound.user_display_name:
                group_context += (
                    f"\n👉 【高优先级提示】：此刻刚刚对你讲最后一句活、正等着你回话的人是 [{inbound.user_display_name}]。"
                    "请主要对 Ta 作出回应。\n"
                )
            group_context += "==================================================\n"
        else:
            group_context += "\n\n============== 【当前系统动态环境】 ==============\n"
            group_context += "当前场景：这是你与用户的一对一【私密聊天房间】。\n"
            if inbound.user_id:
                persona = self._users.get_user_persona(inbound.user_id)
                if persona:
                    group_context += (
                        "\n【警告】当前与你私聊的用户给自己设定的专属人设是：\n"
                        f"{persona}\n"
                        "请务必结合此核心人设给予针对性的反应和对待方式！\n"
                    )
            group_context += "==================================================\n"

        system_prompt += group_context

        messages = [{"role": "system", "content": system_prompt}]
        clean_history = []
        for m in history_messages:
            if clean_history and clean_history[-1]["role"] == m["role"]:
                clean_history[-1]["content"] += f"\n\n{m['content']}"
            else:
                clean_history.append({"role": m["role"], "content": m["content"]})

        messages.extend(clean_history)

        tools = get_chat_tools(emotions_str)
        payload = {
            "model": settings.llm_model,
            "messages": messages,
            "temperature": settings.llm_temperature,
            "max_tokens": settings.llm_max_tokens,
            "stream": False,
            "tools": tools,
            "tool_choice": "auto",
        }

        print("\n" + "=" * 60)
        print("【Telegram LLM 请求调试信息】")
        print(f"🔗 URL: {settings.llm_api_url} | 🤖 Model: {settings.llm_model}")
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
            print(f"[{role}]: {text}\n")
        print("=" * 60 + "\n")

        data = await self._llm_client.chat_completions(
            settings.llm_api_url, settings.llm_api_key, payload
        )

        print("\n" + "=" * 60)
        print("【LLM 原始全量返回参数 (Raw Response)】")
        try:
            print(json.dumps(data, indent=2, ensure_ascii=False))
        except Exception:
            print(str(data))
        print("=" * 60 + "\n")

        parsed_messages = self._parser.parse(data)
        if parsed_messages:
            combined_text = "\n".join([m.text for m in parsed_messages if m.text])
            if combined_text.strip():
                self._history.add_message(
                    inbound.chat_id, "assistant", combined_text.strip()
                )

            current_round = self._round_counter.increment(inbound.chat_id)
            if char_name and should_trigger_memory(current_round):
                await self._memory.process_conversation_snapshot(
                    inbound.chat_id,
                    char_name,
                    self._history.get_messages(inbound.chat_id),
                    current_round,
                )

        return parsed_messages

    async def handle_reaction(self, reaction: ReactionEvent) -> List[OutboundMessage]:
        if not reaction.added_emojis:
            return []

        emoji_str = "、".join(reaction.added_emojis)
        print(
            f"[TelegramBot] 收到 Reaction: [{reaction.chat_id}] {reaction.user_display_name} 给消息点了 {emoji_str}"
        )

        action_text = (
            f"*(刚才我对你的上一条消息作出了反应，添加了 {emoji_str} 的表情图标)*"
        )
        inbound = InboundMessage(
            chat_id=reaction.chat_id,
            chat_type=reaction.chat_type,
            text=action_text,
            user_id=reaction.user_id,
            user_display_name=reaction.user_display_name,
            message_id=reaction.message_id,
            is_group=reaction.chat_type in ["group", "supergroup"],
        )
        return await self.handle_text(inbound)
