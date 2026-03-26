# 角色扮演场景 - 使用 YAML 预设系统

from typing import Optional, List, Dict
from ..base import BasePromptBuilder, PromptContext
from ..preset_loader import PresetLoader, PromptAssembler, build_variables_from_context


class RoleplayBuilder(BasePromptBuilder):
    """
    角色扮演场景

    特点:
    - 使用 YAML 预设文件定义提示词区块
    - 支持 {{var}} 变量注入
    - 支持条件区块（有数据时才注入）
    - 支持 after_history 位置注入（作者注）
    - 修改预设文件后无需重启
    """

    # 预设名称（对应 presets/roleplay.yaml）
    PRESET_NAME = "roleplay"

    @property
    def scene_id(self) -> str:
        return "roleplay"

    @property
    def scene_name(self) -> str:
        return "角色扮演"

    @property
    def active_preset_name(self) -> str:
        """动态获取当前激活的预设名称"""
        return PresetLoader.get_active()

    def _load_and_assemble(self, ctx: PromptContext):
        """
        加载预设并组装提示词

        每次调用都从文件读取，修改后无需重启

        Returns:
            AssembledPrompt 实例
        """
        preset_name = self.active_preset_name
        try:
            preset = PresetLoader.load(preset_name)
        except FileNotFoundError:
            print(f"[RoleplayBuilder] ⚠️ 预设文件不存在，使用内置默认值")
            return None

        variables = build_variables_from_context(ctx)
        assembler = PromptAssembler(preset["blocks"])
        result = assembler.assemble(variables)

        print(f"[RoleplayBuilder] ✅ 预设组装完成: 注入区块={result.injected_blocks}")
        return result

    def build_system_prompt(self, ctx: PromptContext) -> str:
        """构建系统提示词"""
        assembled = self._load_and_assemble(ctx)

        if assembled is None:
            # 兜底：预设加载失败时使用硬编码默认值
            return self._fallback_system_prompt(ctx)

        return assembled.system_prompt

    def build_user_prompt(self, ctx: PromptContext) -> str:
        """构建用户提示词"""
        return ctx.user_input

    def build_messages(self, ctx: PromptContext) -> List[Dict]:
        """
        构建完整的 messages 列表

        重写基类方法，支持 after_history 位置注入
        """
        assembled = self._load_and_assemble(ctx)

        if assembled is None:
            # 兜底：使用基类默认逻辑
            return super().build_messages(ctx)

        messages = [
            {"role": "system", "content": assembled.system_prompt}
        ]

        # 添加历史消息
        for msg in ctx.conversation_history:
            messages.append({
                "role": msg.get("role", "user"),
                "content": msg.get("content", "")
            })

        # 插入 after_history 区块（作者注等）
        if assembled.after_history_prompt:
            messages.append({
                "role": "system",
                "content": assembled.after_history_prompt
            })

        # 添加当前用户输入
        if ctx.user_input:
            user_content = ctx.user_input
            if ctx.event_type:
                event_prompt = self.build_event_prompt(ctx, ctx.event_type)
                if event_prompt:
                    user_content = f"{event_prompt}\n{ctx.user_input}"

            messages.append({"role": "user", "content": user_content})

        return messages

    def build_event_prompt(self, ctx: PromptContext, event_type: str) -> Optional[str]:
        """事件触发提示"""
        char_name = ctx.character_name or "你"

        if event_type == "silence_detected":
            return f"（沉默了一会儿，{char_name}想主动说点什么打破沉默）"

        if event_type == "greeting_trigger":
            return f"（{char_name}想主动和对方打个招呼或者说点什么）"

        if event_type == "mood_change":
            mood = ctx.extra_data.get("mood", "普通")
            return f"（{char_name}的心情变成了{mood}）"

        return None

    def format_history(self, history, max_turns: int = 10):
        """自定义历史格式化 - 使用角色名"""
        if not history:
            return ""

        lines = []
        for msg in history[-max_turns:]:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")

            if role == "user":
                lines.append(f"对方: {content}")
            elif role == "assistant":
                lines.append(f"你: {content}")

        return "\n".join(lines)

    # ---- 兜底默认值 ----

    @staticmethod
    def _fallback_system_prompt(ctx: PromptContext) -> str:
        """预设文件不可用时的硬编码兜底"""
        char_name = ctx.character_name or "助手"
        persona = ctx.character_persona or "亲切、自然、像真人一样说话"

        prompt = (
            f"你正在扮演 {char_name}。\n\n"
            f"【人设】\n{persona}\n\n"
            "【对话规则】\n"
            f"1. 始终保持 {char_name} 的身份，用第一人称说话\n"
            "2. 回复简短自然，符合口语习惯，像真人说话\n"
            "3. 只输出对话内容，不要输出动作描写、旁白或任何括号内容\n"
            "4. 根据情境自然使用语气词和情绪表达\n"
            "5. 每次回复控制在1-3句话，保持对话节奏"
        )

        if ctx.scenario:
            prompt += f"\n\n【当前情境】\n{ctx.scenario}"

        if ctx.first_message:
            prompt += f"\n\n【开场白参考】\n{ctx.first_message}"

        return prompt
