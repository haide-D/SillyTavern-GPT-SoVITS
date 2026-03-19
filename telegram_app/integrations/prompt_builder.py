class PromptBuilder:
    """
    负责组装提供给 LLM 的 System Prompt。
    将长文本记忆和核心规则进行结构化隔离，防止核心约束被稀释。
    """

    @staticmethod
    def build_system_prompt(
        base_prompt: str, memory_context: str, emotions_str: str = "default"
    ) -> str:
        parts = []

        if memory_context:
            parts.append("============== 【背景与上下文信息】 ==============")
            parts.append("以下是你的记忆和人设世界观信息，仅作为背景参考：\n")
            parts.append(memory_context.strip())
            parts.append("\n==================================================")

        parts.append("============== 【核心行事准则（最高优先级）】 ==============")
        parts.append(base_prompt.strip())

        tool_instruction = f"""
请使用提供的工具 `send_text_message` (仅发送纯文本) 或 `send_voice_message` (发送带情感表现的语音) 来回复用户。
为了模拟真实的聊天软件体验，你应该将长回复拆分成多段短消息，连续多次调用工具发出。
【⚠️强烈要求】：当使用 `send_voice_message` 时，请务必细致体会当前语境和人物性格，优先选择具体的、带情感的情绪标签！展现出你丰富的情感波动！
【当前可用情绪列表参考】: {emotions_str}
"""
        parts.append(tool_instruction.strip())

        return "\n\n".join(parts)
