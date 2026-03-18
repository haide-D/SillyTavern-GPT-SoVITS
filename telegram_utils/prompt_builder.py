class PromptBuilder:
    """
    负责组装提供给 LLM 的 System Prompt。
    将长文本记忆和核心规则（不准发动作等）进行结构化隔离，防止核心约束被稀释。
    """

    @staticmethod
    def build_system_prompt(base_prompt: str, memory_context: str) -> str:
        parts = []

        if memory_context:
            parts.append("============== 【背景与上下文信息】 ==============")
            parts.append("以下是你的记忆和人设世界观信息，仅作为背景参考：\n")
            parts.append(memory_context.strip())
            parts.append("\n==================================================")

        # 把严格的规则放在最下面，通常大模型对末尾的指令遵循度更高
        parts.append("============== 【核心行事准则（最高优先级）】 ==============")
        parts.append(base_prompt.strip())

        return "\n\n".join(parts)
